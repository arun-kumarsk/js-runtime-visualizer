# Architecture

A deep dive into how the **JS Runtime Visualizer** works. It's a web app where you
type JavaScript and *watch it run* — the call stack, scopes/closures, the event loop
(Web APIs → macrotask queue → microtask queue), an object/reference graph, and a
synced AST — all scrubbable like a video.

It is **not** a wrapper around a real JS engine. User code runs in a custom,
generator-based tree-walking **interpreter** so execution can be paused, stepped,
rewound, and — crucially — so the queues that real engines hide can be exposed.

---

## Table of contents

1. [The four load-bearing principles](#the-four-load-bearing-principles)
2. [Pipeline overview](#pipeline-overview)
3. [The engine (`src/engine/`)](#the-engine-srcengine)
4. [The `Snapshot` — single source of truth](#the-snapshot--single-source-of-truth)
5. [Step granularity](#step-granularity)
6. [The event-loop model](#the-event-loop-model)
7. [The async model (promises & async/await)](#the-async-model)
8. [Structural sharing & time-travel](#structural-sharing--time-travel)
9. [Worker boundary](#worker-boundary)
10. [Store (`src/store/`)](#store)
11. [Player (`src/player/`)](#player)
12. [UI layer (`src/components/`)](#ui-layer)
13. [Animations](#animations)
14. [Determinism guarantees](#determinism-guarantees)
15. [Testing](#testing)
16. [Build & tooling](#build--tooling)
17. [Extending the project](#extending-the-project)

---

## The four load-bearing principles

These are what make the app work; violating them breaks things in non-obvious ways.

1. **Deterministic logic, cosmetic timing.** The interpreter computes the *entire*
   execution up front as a deterministic, ordered stream of `Snapshot`s. Wall-clock
   timing (a `setTimeout(…, 1000)` taking ~1s on screen) only affects **playback
   pacing** in `src/player/`, never the computed ordering. This is what lets
   real-time animation and reliable scrub/step-back coexist. Execution ordering must
   never depend on real time, `Date.now()`, or `Math.random()`.

2. **One snapshot is the single source of truth.** Every panel (source highlight,
   AST, call stack, scopes, queues, heap graph, console) is a **pure render of the
   current `Snapshot`**. Panels hold no independent execution state. Stepping = moving
   an index in the store; everything re-derives. If a panel needs to show something,
   it must be a field on `Snapshot` (`src/engine/types.ts`).

3. **The engine runs in a Web Worker** (`src/engine/worker.ts`, via comlink) so a long
   or infinite program never janks the 60fps UI. A step-budget + wall-clock guard
   aborts runaway code.

4. **Structural sharing for time-travel.** Environments and heap objects are
   persistent, versioned (a `rev` counter), and referenced by **id** across snapshots
   — keeping thousands of steps cheap. Never deep-copy whole state per step.

---

## Pipeline overview

```
 source ──acorn──► AST (node ids) ──► interpreter (generator tree-walker)
                    │                    + event-loop scheduler
                    │                    [runs in a Web Worker via comlink]
                    │                             │
                    │                             ▼
                    │                    deterministic Snapshot[] stream
                    │                    (id-referenced, structurally shared)
                    ▼                             │
             AstNodeView tree                     ▼
                    └──────────────► zustand store { snapshots, index, … }
                                                  │
             Player: play/pause, speed, Real-time⇄Step, scrubber, breakpoints
                                                  │
                    ┌─────────────────────────────┴─────────────────────────────┐
                    ▼    Panels — each a pure function of the current Snapshot    ▼
      Editor (CM6: highlight, breakpoints, heatmap, value bubbles) · AST Inspector
      Call Stack · Scopes & Closures · Event Loop (wheel + steps) · Web APIs
      Callback Queue · Microtask Queue · Object/Reference Graph · Console
      + FlyingCallbacks overlay (tokens animating between sections)
```

---

## The engine (`src/engine/`)

Pure, framework-free, fully unit-tested. **Must not import React or DOM.**

| File | Responsibility |
|---|---|
| `parser.ts` | acorn wrapper; attaches a stable `astNodeId` to every node; friendly errors for unsupported syntax. |
| `types.ts` | `Snapshot` and all view types (`FrameView`, `EnvView`, `HeapNodeView`, `WebApiView`, `TaskView`, `ConsoleEntry`, `AstNodeView`, …). The contract between engine and UI. |
| `runtime.ts` | Runtime values (`Ref` + `RV`) and control-flow signals (`ReturnSignal` / `Break` / `Continue` / `ThrowSignal` / `BudgetExceeded`). |
| `environment.ts` | `Environment { id, kind, bindings, parent, rev }`; lexical scoping, TDZ for `let`/`const`, hoisting for `var`/function decls, per-iteration `let` bindings. |
| `heap.ts` | Object/array/function/promise allocation with ids + edges; the `rev` versioning helpers. |
| `interpreter.ts` | The core: `function* evalNode(node, env)` tree-walker **and** the event-loop scheduler (`executeAll`). Emits the `Snapshot` stream. |
| `async.ts` | Promise/microtask types and helpers used by the interpreter's async model. |
| `builtins.ts` | Host globals surface (console, timers) as opaque `@`-prefixed native refs. |
| `astView.ts` | Builds the serializable `AstNodeView` tree once per run for the AST panel. |
| `worker.ts` | comlink endpoint; runs a program and returns `RunResult`. |
| `index.ts` | Public barrel for the engine (types + `runProgram`). |

### Language subset (v1, teaching-focused)

**Supported:** `var`/`let`/`const`, function decl/expr (incl. named-function-expression
self-recursion) & arrow, closures, objects & arrays, common operators with ToPrimitive
coercion, `==`/`===`, relational (NaN-correct), logical + logical-assignment
(`||=`/`&&=`/`??=`), `in`, `if`/`for`/`while`/`for..of`, `try`/`catch`/`finally`,
template literals, ternary/sequence, `console.*`, `setTimeout`/`setInterval`/
`clearTimeout`, `queueMicrotask`, `Promise` + `.then`/`.catch`/`.finally`,
`Promise.resolve`/`reject`, `async`/`await`.

**Deferred:** classes, user generators, ES modules, full prototype chain / most
`Array.prototype` methods (only `push`/`pop` modeled), regex, `instanceof`,
destructuring, spread, default params. Unsupported syntax raises a friendly error.

---

## The `Snapshot` — single source of truth

Defined in `src/engine/types.ts`. Every field is a **serializable, display-ready
projection** of interpreter state at one step:

```ts
interface Snapshot {
  stepId: number
  kind: StepKind                 // 'program'|'statement'|'expression'|'call'|'return'|'timer'|'task'|'microtask'
  phase: 'sync' | 'microtask' | 'macrotask'
  astNodeId: string              // → source + AST highlight
  source: SourceSpan | null      // char offsets + line/col
  clock: number                  // logical (deterministic) ms — drives real-time pacing
  callStack: FrameView[]         // bottom (global) first, current last
  activeEnvId: string
  environments: Record<string, EnvView>   // id-referenced (structural sharing)
  heap: Record<string, HeapNodeView>       // objects/arrays/functions/promises + edges
  webApis: WebApiView[]          // pending timers, sorted by fire time
  macrotaskQueue: TaskView[]     // FIFO
  microtaskQueue: TaskView[]     // FIFO
  console: ConsoleEntry[]        // cumulative; each carries originating stepId + nodeId
  explain?: string               // guided-mode annotation for this moment
}
```

Because panels are pure renders of this object, **adding new runtime data to the UI
always starts by adding a field here**, populating it in the interpreter, then
rendering it — never by smuggling state into a component.

---

## Step granularity

The interpreter emits a snapshot at meaningful points via a private `emit(kind, node,
env)`. The `StepKind` set is deliberately coarse so stepping feels natural:

- **`program`** — the initial and terminal frames (the terminal snapshot captures
  trailing console output produced after the last statement).
- **`statement`** — one per executed statement. Emitted *before* the statement's side
  effect, so output appears from the following snapshot.
- **`call` / `return`** — pushing/popping a **user-defined** function frame. This is
  the core call-stack teaching (recursion, closures).
- **`timer` / `task` / `microtask`** — event-loop beats (see below).
- **`expression`** — reserved in the type but **not currently emitted** (there are no
  sub-expression steps).

**Built-ins run in a single combined step.** `console.*`, timers, `queueMicrotask`,
`Promise.resolve`/`reject`, `Array.push`/`pop` go through `runBuiltin`, which executes
the native op and then emits **one** step (the built-in briefly on the call stack with
its result) rather than a separate `call` + `return`. So `console.log("a")` takes two
steps (statement, then the built-in), not three. User functions keep both steps.

---

## The event-loop model

The event loop lives **inside the interpreter** (`executeAll` in `interpreter.ts`), not
in a separate module. The shape:

1. The main script runs as the first task in a `(main)` frame; the frame pops at
   script end, so the call stack is **empty between tasks** — a key teaching beat.
2. `expireDueTimers()` promotes timers whose `fireAt <= clock` from `webApis` into the
   macrotask queue. This is a **silent** state transition (no dedicated step) — the
   move is reflected on the next emitted snapshot.
3. All microtasks drain (`drainMicrotasks`) — after the sync script and after every
   macrotask.
4. The loop then dispatches one macrotask; when the macrotask queue is empty it
   advances the logical `clock` to the next due timer and repeats.

Key details:

- **`clock`** is a logical, deterministic millisecond counter. It advances to the next
  due timer only when the loop is otherwise idle; it never uses wall-clock time.
- A `0 ms` timer is *already due* at script end, so it lands in the callback queue
  **before** microtasks drain — correctly teaching that an already-queued macrotask
  still loses to a microtask (the canonical `A, D, C, B`).
- The `webApis` view is **sorted by fire time** so index 0 is the next-to-fire timer.
- An **uncaught throw inside a timer/microtask callback** is surfaced as an
  `Uncaught …` console error and the loop continues — it does not abort the run.
- `setInterval` re-arms with a fresh `fireAt`; infinite intervals hit the step-budget
  guard.

---

## The async model

Promises are **heap objects** (`{ state, value, listeners }`). Settling a promise
fires its listeners, which **enqueue microtask jobs**. `.then`/`.catch`/`.finally`,
`Promise.resolve`/`reject`, and `await` all funnel through this.

- **async/await as a coroutine.** An async call returns a promise immediately; the
  body is a generator driven by `driveAsync`. `await` yields an internal step that
  `driveAsync` intercepts — it **pops the async frame** (the function leaves the stack
  while suspended) and registers a settle listener that **resumes** the body as a
  microtask (re-pushing the frame). Rejections resume via `body.throw(ThrowSignal)` so
  user `try/catch` works.
- **Thenable adoption is deferred.** Resolving a promise with another promise models
  the spec's `PromiseResolveThenableJob`: it runs on the microtask queue and subscribes
  to the inner promise, costing the correct extra tick(s) instead of settling
  synchronously. `Promise.resolve(promise)` is an identity passthrough (no wrapper, no
  ticks).
- Native callbacks (promise `resolve`/`reject`) are heap functions with a TS `native`
  impl and no `node`/`closureEnv`; they execute without emitting steps.

---

## Structural sharing & time-travel

Keeping thousands of snapshots cheap relies on **not** deep-copying state per step:

- Each `Environment` and heap object carries a **`rev` counter**, bumped on every
  mutation. Serialization caches (`envViewCache`, `heapViewCache`) are keyed by
  `(id, rev)` — an unchanged env/heap object reuses its exact view object across
  adjacent snapshots.
- **Caveat that bit us once:** a `Ref`'s display `repr` embeds the *target's* mutable
  state (`[…N]` for arrays, `Promise <state>`). Since a container's `rev` doesn't bump
  when a *referenced* array/promise mutates, views that embed such a ref are **not
  cached** (`reprVolatile` guards `serializeEnv`/`heapView`), so time-travel shows
  correct point-in-time values. Object (`{…}`) and function (`ƒ name`) reprs are
  stable, so they stay cacheable.
- Snapshot arrays (`callStack`, `webApis`, queues, `console`) are **copied** into each
  snapshot (map/slice), never handed over as live mutable references.

Result: `goto(N)` reproduces an identical snapshot; forward-then-back lands on the
exact same content.

---

## Worker boundary

`src/engine/worker.ts` is a comlink endpoint. The store calls `getEngine().run(source,
{ maxSteps })`; the worker parses, interprets to completion, and returns a
`RunResult { snapshots, error, ast }`. Because the whole run is computed up front, the
main thread only ever indexes into an array — no per-step round-trips. A **step-budget
+ wall-clock guard** (`guard()`) aborts infinite loops with a friendly error.

---

## Store

`src/store/useVisualizerStore.ts` — zustand + immer. Holds
`{ source, snapshots, ast, index, status, error, playing, mode, speed, breakpoints,
pendingWait, guided }` and the actions (`run`, `loadExample`, `stepForward/Backward`,
`stepOver/Out`, `goto`, `play/pause/togglePlay`, `toggleBreakpoint`, …).

- **`run()` computes the timeline and stays paused at index 0** (no auto-play); the
  user drives playback.
- Selectors must return **stable references**. Panels use `useCurrentSnapshot()` (the
  stable snapshot object) and derive fields in render with module-level empty
  fallbacks — returning `?? []` *inside* a selector causes a `useSyncExternalStore`
  infinite loop.

---

## Player

`src/player/player.ts` — a `usePlayer()` hook that **only advances the store `index`
over time**; it computes nothing.

- **Step mode:** uniform `BASE_STEP_MS` per step.
- **Real-time mode:** steps that cross a logical-clock gap (a timer's delay) wait
  proportionally (clamped `MIN_WAIT_MS`..`MAX_WAIT_MS`), so timers visibly count down.
- Sets `pendingWait { durationMs, token }` on a clock-gap transition, which drives the
  Web APIs countdown bar; advances via `stepForward()` only after the wait — so a timer
  moves to the queue exactly when its countdown completes.
- Implements **run-to-breakpoint** and guided-mode pauses: while playing it pauses when
  execution *enters* a breakpoint line (or an `explain`-annotated step), skipping the
  line it resumed from so Continue behaves like a real debugger.

Stepping helpers are pure (`src/lib/stepping.ts`): step-into = next snapshot;
step-over = next at call-depth ≤ current; step-out = next shallower than current.

---

## UI layer

`src/components/` — all pure renders of the current snapshot.

- **`layout/`** — `Dock` (top-level grid: toolbar, scrubber, editor+console column,
  runtime-panel grid), `Panel` (collapsible titled card; supports `tag`, `badge`,
  `region` anchor), `GuidedTip`.
- **`editor/`** — CodeMirror 6 via `@uiw/react-codemirror`. Decorations are layered as
  CM6 `StateField`/`StateEffect` extensions driven by dispatched effects (never by
  reconfiguring): current line + sub-expression highlight (`editorHighlight.ts`),
  clickable breakpoint gutter, per-line heatmap, and inline value bubbles
  (`editorGutters.ts`).
- **`panels/`** — one per runtime region: `CallStackPanel`, `ScopesPanel`,
  `WebApisPanel`, `EventLoopDial` (+ `EventLoopWheel`), `TaskQueuePanel` /
  `MicrotaskQueuePanel` (both via `QueuePanel`), `ObjectGraph` (React Flow + d3-force,
  lazy-loaded), `AstInspector`, `ConsolePanel`, and the `FlyingCallbacks` overlay.
- **`controls/`** — `Toolbar`, `Scrubber` (event markers), `SpeedControl`,
  `ModeToggle`, `ExampleGallery`, `CommandPalette` (⌘K).

Pure derivations that don't belong on the snapshot live in `src/lib/` (`buildGraph`,
`explainNode`, `activeHighlight`, `stepping`, `cn`).

---

## Animations

Layout/queue reflow uses framer-motion's `layout` prop rather than manual tweening,
and honors `prefers-reduced-motion` (damped globally in `index.css`). The signature
event-loop animations:

- **`EventLoopWheel`** — a loop arrow that turns a notch (120°) each time the loop
  dispatches a callback (a `task`/`microtask` step, counted up to the current index),
  tinted by `phase`, with live stack/task/micro counts. Pure render of the timeline.
- **`FlyingCallbacks`** — a fixed, pointer-transparent overlay that flies a labeled
  token between region panels as callbacks move. It is **diff-based**: each step, it
  compares every region against the previous snapshot and animates whatever moved —
  Call Stack → Web APIs (register a timer), Call Stack → Microtask Queue (register a
  microtask), Web APIs → Callback Queue (timer elapses), Callback/Microtask Queue →
  Call Stack (dispatch). Panels expose a `data-region` anchor (via `Panel`'s `region`
  prop) so tokens fly to their live positions.
- **Web APIs countdown bar** — drains full→empty as a timer approaches firing (paced by
  `pendingWait` in real-time, self-running while paused/stepping).

Because these all derive from the snapshot stream + index, **scrubbing rewinds them**.

---

## Determinism guarantees

- Execution ordering is a pure function of the source — identical across runs
  (asserted by tests) and independent of wall-clock, `Date.now`, `Math.random` (which
  are unavailable / never used for ordering).
- `goto(N)` is reproducible; revisiting a step yields byte-identical content.
- Real-time pacing is **cosmetic** — it changes when snapshots are shown, never their
  order or content.

---

## Testing

Vitest only — **no e2e/Playwright**; UI is checked manually in the browser. Tests are
co-located (`*.test.ts` next to source). The suite covers engine correctness
(recursion, closures, `var`/`let` loop, TDZ, coercion, named-fn-expr recursion, logical
assignment, `in`), async ordering (`A, D, C, B`, chained `.then`, microtask-before-
macrotask, thenable-adoption ticks, `await` suspend/resume), event-loop behavior
(timer parking, fire-order, uncaught-callback isolation), time-travel/determinism, and
structural-sharing (point-in-time reprs). Pure UI logic (`buildGraph`, `stepping`,
`cn`) is unit-tested too.

```bash
npm test              # vitest run (headless)
npm run test:watch
npm run test:coverage
npx vitest run src/engine/interpreter.test.ts     # single file
npx vitest run -t "closure capture"               # single test by name
```

---

## Build & tooling

```bash
npm run dev        # Vite dev server (http://localhost:4000)
npm run build      # tsc -b (project refs) + vite build
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint .
```

- **Vite + React 19 + TypeScript** (strict, `verbatimModuleSyntax` → type-only imports
  must use `import type`). Path alias `@/…` → `src/`.
- **Tailwind v4** (no config file). Design tokens are CSS vars under `@theme`/`:root`/
  `.dark` in `src/index.css`, surfaced as utilities (`bg-panel`, `text-ink`,
  `border-edge`) and region accents (`--color-stack`, `--color-macrotask`,
  `--color-microtask`, `--color-webapi`). Compose classes with `cn()` from `@/lib/cn`.
- Worker is bundled in ES format; the object graph (React Flow + d3-force) is
  code-split into its own chunk.

---

## Extending the project

**Add a language feature** (e.g. a new operator): implement it in the relevant
`evalExpr`/`execStatement` branch of `interpreter.ts` (reuse `toNum`/`toStr`/
`toPrimitive`/`relational`/`looseEquals`), keep coercion correct, and add a Vitest
snapshot/behavior test. Raise a friendly error for anything still unsupported rather
than leaking an internal error.

**Show new runtime data in a panel:** add the field to `Snapshot` in
`src/engine/types.ts`, populate it in `interpreter.ts` (remember the `rev`-bump /
copy-into-snapshot rules), then render it in a panel as a pure function of the
snapshot. Cover the engine change with a test.

**Add an animation between sections:** give the panel a `region` anchor and let
`FlyingCallbacks`' diff detect the movement, or drive a new motion from
`snapshot`-derived state so it stays scrubbable.
