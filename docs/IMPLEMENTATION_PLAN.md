# Implementation Plan — Advanced JavaScript Runtime Visualizer

## Context

We're building a greenfield, richly-animated web app that visualizes JS execution: call stack,
scopes/closures, the event loop (Web APIs → macrotask queue → microtask queue), an object/reference
graph, and a synced AST — all scrubbable like a video with real-debugger controls. The full vision,
architecture, data model, and tech-stack rationale live in **`PLAN.md`** (same `docs/` folder); this file is
the **sequenced build plan** — the order in which to construct it, with per-phase deliverables,
key files, and a definition of done (DoD).

**Locked decisions:** React 19 + Vite + TS; custom generator-based tree-walking interpreter in a Web
Worker; deterministic execution stream with cosmetic playback timing; single-snapshot-source-of-truth;
structural sharing for time-travel. Stack: acorn, CodeMirror 6 (`@uiw/react-codemirror`), motion
(framer-motion), React Flow (`@xyflow/react`) + d3-force, comlink, zustand+immer, Radix primitives +
Tailwind v4, Vitest. **Testing: Vitest only** — e2e/Playwright was dropped (engine correctness is all
unit-testable; UI is checked manually in the browser).

**Sequencing principle:** build the **engine before the UI** for each capability, and ship a working
**vertical slice by end of Phase 4** (a real animated event-loop visualizer). Phases 5–8 layer depth
and polish — each phase is independently shippable, so we can stop or reprioritize at any boundary.

---

## Phase 0 — Project scaffold & tooling ✅ DONE

**Objective:** A running React app shell with all libraries wired, CI-able tests, and the panel layout skeleton.

**Tasks (as built)**

- Scaffolded Vite + React 19 + TS manually; installed Tailwind v4, Radix primitives, framer-motion, `@xyflow/react`, d3-force, acorn, acorn-walk, comlink, zustand, immer, CodeMirror 6.
- Vite config: `@tailwindcss/vite` plugin, ES-format worker support, `@` → `src` alias; strict project-references tsconfig (app + node).
- Vitest (jsdom + Testing Library) with smoke test; scripts `dev`, `build`, `test`, `test:coverage`, `lint`, `typecheck`. **No Playwright** (e2e dropped).
- `cspell.json` project dictionary (microtask, macrotask, comlink, dockable, latentflip, …).
- **Dockable layout shell** (`App.tsx`, `layout/Dock.tsx`, `layout/Panel.tsx`): editor pane + collapsible runtime-panel grid + bottom console + top toolbar with full (placeholder-wired) controls.
- CodeMirror 6 editor (`editor/Editor.tsx`) via `@uiw/react-codemirror` + `@codemirror/lang-javascript`, dark theme.

**Key files:** `vite.config.ts`, `tsconfig*.json`, `src/index.css` (Tailwind v4 `@theme` tokens), `cspell.json`, `src/App.tsx`, `src/components/layout/{Dock,Panel}.tsx`, `src/components/editor/Editor.tsx`, `src/components/controls/Toolbar.tsx`, `src/lib/cn.ts`.
**DoD ✅:** `npm run dev` serves the editor + empty panels (HTTP 200); `npm run typecheck`, `npm run lint`, `npm test` (3 passing), and `npm run build` all green.

---

## Phase 1 — Engine core (synchronous interpreter + snapshot stream) ✅ DONE

**Objective:** Deterministic step stream for synchronous JS, runnable in a worker, steppable both directions. No UI panels yet — proven by unit tests.

**Tasks**

- `engine/types.ts` — define `Snapshot`, `FrameView`, `EnvView`, `HeapNodeView`, `TaskView`, `ConsoleEntry` (per `PLAN.md` data model).
- `engine/parser.ts` — acorn wrapper; attach stable `astNodeId` to every node; friendly errors for unsupported syntax.
- `engine/environment.ts` — `Environment { id, kind, bindings, parent }`; lexical scoping, TDZ for `let/const`, hoisting for `var`/function decls.
- `engine/heap.ts` — object/array/function allocation with ids + edges; structural-sharing helpers (versioned, id-referenced).
- `engine/interpreter.ts` — `function* evalNode(node, env)` tree-walker covering the **sync subset**: declarations, functions (decl/expr/arrow) + closures, operators, `if/for/while/for..of`, `try/catch/finally`, member/call/return. Yields a tagged `Snapshot` (`expression|statement|call|return`) at each step.
- `engine/worker.ts` — comlink endpoint; runs program, streams snapshots; **step-budget + wall-clock guard** aborts runaway code.
- `store/useVisualizerStore.ts` — zustand store `{ snapshots, index, status }`; actions: load/run, `stepFwd`, `stepBack`, `goto(index)`.

**Key files:** all of `src/engine/*`, `src/store/useVisualizerStore.ts`.
**Tests (Vitest):** snapshot sequence for recursion (factorial — stack depth), closure capture (counter factory), closure-in-loop (`var` vs `let`); **time-travel invariant**: deterministic across runs + stable indexing; infinite loop hits the guard.
**DoD ✅:** 19 engine tests green (recursion, closures, var/let loop, TDZ, const, try/catch/finally, heap mutation, determinism, structural sharing, step-budget guard, friendly/syntax/unsupported errors). `typecheck`/`lint`/`build` all green.

**As built — notes for later phases:**

- `runtime.ts` holds runtime values (`Ref` + `RV`) and control-flow signals (`ReturnSignal`/`Break`/`Continue`/`ThrowSignal`/`BudgetExceeded`).
- `Snapshot` does **not** yet carry event-loop regions (`webApis`/`macrotaskQueue`/`microtaskQueue`) — add them in Phase 3–4.
- Structural sharing works via a `rev` counter on each `Environment`/heap object + a serialize cache keyed by `(id, rev)`; bump `rev` on every mutation or sharing breaks.
- A **terminal snapshot** (`kind:'program'`) is appended at program end so trailing `console` output is captured; statement steps are emitted _before_ their side effects, so output appears from the following step.
- `console` is special-cased in the interpreter (a sentinel `@console` ref), not a heap native — revisit when adding real built-ins.
- `erasableSyntaxOnly` was removed from tsconfig (the engine uses TS constructor parameter properties).

---

## Phase 2 — Core visual panels (stack, scopes, console, source highlight) ✅ DONE

**Objective:** Watch synchronous code execute — the first visually compelling milestone.

**Tasks**

- Editor decorations: current-line + **sub-expression highlight** from `snapshot.source`; (`components/editor/Editor.tsx`).
- `components/panels/CallStackPanel.tsx` — motion `layout` push/pop animation; frames show fn name, args, and return value on pop.
- `components/panels/ScopesPanel.tsx` — render the active frame's scope chain from `environments`; **pulse animation on value change**; draw **closure-capture links** to defining env.
- `components/panels/ConsolePanel.tsx` — cumulative log, synced per step; click an entry → `goto` its originating step.
- `components/controls/Toolbar.tsx` — Run, Step ◄ ►, Reset wired to the store.

**Key files:** `src/components/panels/{CallStackPanel,ScopesPanel,ConsolePanel}.tsx`, `src/components/editor/{Editor,editorHighlight}.ts(x)`, `src/components/controls/Toolbar.tsx`, `src/App.tsx`, `src/store/useVisualizerStore.ts`.
**DoD ✅:** default factorial program steps fwd/back via toolbar + arrow keys; call stack animates push/pop with args + return values; scope chain renders with value-change pulses; current line + sub-expression highlight in the editor; console syncs per step and click-to-goto. `typecheck`/`lint`/`build` green; dev server mounts cleanly; engine runs in the worker chunk.

**As built — notes:**

- Zustand selectors must return _stable_ references — panels use `useCurrentSnapshot()` (selects the stable snapshot object) and derive `.callStack`/`.console` in render with module-level empty fallbacks. Returning `?? []` _inside_ a selector causes a `useSyncExternalStore` infinite loop.
- Editor highlight is a CM6 `StateField`/`StateEffect` (`editorHighlight.ts`) driven by dispatching `setHighlight` on snapshot change — not by reconfiguring extensions. Uses `snapshot.source` char offsets directly.
- Toolbar play/pause + speed intentionally deferred to Phase 3 (the player); Phase 2 ships Run/Step/Reset + a step counter.
- Closure-capture _edges_ (SVG/graph) deferred to Phase 5; the scope chain already shows the parent links that make closures legible.

---

## Phase 3 — Event loop (the signature feature) ✅ DONE

**Objective:** Animated event loop with real-time timers — the Loupe moment.

**Tasks**

- `engine/eventLoop.ts` — scheduler with `callStack`, `webApis`, `macrotaskQueue`; shim `setTimeout/setInterval/clearTimeout` and `console.*` through it; deterministic fire-order with display delay metadata.
- `engine/builtins.ts` — host globals surface (console, timers).
- `player/player.ts` — playback engine: play/pause, speed, and **Real-time ⇄ Step** mode toggle (wall-clock pacing honors timer display delays; logic stays deterministic). `run-to-end`.
- Panels: `WebApisPanel.tsx` (timers with **live countdown**), `TaskQueuePanel.tsx` (FIFO enqueue/dequeue animation), `EventLoopDial.tsx` (the **sweeping arm** moving callback → stack).
- Controls: `Scrubber.tsx`, `SpeedControl.tsx`, `ModeToggle.tsx`.

**Key files:** `src/engine/{builtins.ts, interpreter.ts}`, `src/player/player.ts`, `src/store/useVisualizerStore.ts`, `src/components/panels/{WebApisPanel,TaskQueuePanel,MicrotaskQueuePanel,QueuePanel,EventLoopDial}.tsx`, `src/components/controls/{Scrubber,SpeedControl,ModeToggle,Toolbar}.tsx`.
**Tests:** `log / setTimeout(0) / log` → A,C,B; multi-timer ordering (delay then registration); nested timers; clearTimeout; timer parks in Web APIs then moves to queue; clock advance; phase tagging.
**DoD ✅:** 25 tests green; `typecheck`/`lint`/`build` clean; dev mounts cleanly. Timer-ordering example animates; timers count down in real-time mode; scrubber + speed + mode work.

**As built — notes:**

- The event loop lives **inside the interpreter** (`executeAll`): main script runs as the first task in a `(main)` frame that pops at script end (so the call stack is _empty_ between tasks — a key teaching beat); then it drains the macrotask queue, advancing a logical `clock` to the next due timer.
- New `Snapshot` fields: `clock`, `webApis`, `macrotaskQueue`, `microtaskQueue` (empty until P4), and `phase` is now populated (`sync` during the script, `macrotask` for callbacks). New `StepKind`s: `timer`, `task`.
- A **pending snapshot** is emitted before the clock advances so a timer is visibly parked in Web APIs before it hops to the queue (otherwise it'd be created and moved between snapshots, never seen).
- Built-ins are opaque `@`-prefixed native refs (`@setTimeout`, …) installed as global `const`s and handled in `callNative` — generalizes the earlier console special-case (`builtins.ts`).
- **Player** (`player/player.ts`) is a `usePlayer()` hook that only advances `index` on a timer; real-time mode waits `clock`-gap ms (clamped 280–2600, ÷speed), step mode uses a uniform 280ms/speed. `pendingWait` in the store drives the Web API countdown bar. Run auto-plays.
- setInterval supported (reschedules); infinite intervals are caught by the existing step-budget guard.

---

## Phase 4 — Promises, microtasks & async/await ✅ DONE ← end of vertical slice

**Objective:** Correct, visually obvious microtask-vs-macrotask ordering — the key teaching differentiator.

**Tasks**

- `engine/async.ts` — model `Promise` (+ `.then/.catch/.finally`), `queueMicrotask`, and `async`/`await` (async fns as generators yielding on await; reactions as microtask jobs).
- Extend `eventLoop.ts` to **drain all microtasks between each macrotask**.
- `components/panels/MicrotaskQueuePanel.tsx` — visually distinct from the macrotask queue; animated drain.
- `components/layout/GuidedTip.tsx` — surface `snapshot.explain` annotations at key moments (e.g. "microtasks drain before the next macrotask").

**Key files:** `src/engine/{async.ts, heap.ts, interpreter.ts, builtins.ts, types.ts}`, `src/components/panels/MicrotaskQueuePanel.tsx`, `src/components/layout/GuidedTip.tsx`, `src/App.tsx`.
**Tests (Vitest — most extensive):** `A / setTimeout(B,0) / Promise.then(C) / D` → **A, D, C, B**; chained `.then`; microtasks drain before next macrotask; `queueMicrotask`; `.catch`; `new Promise`; async/await suspend-resume; timer-backed `await`; rejected-await `try/catch`. 36 tests total, all green.
**DoD ✅:** A,D,C,B provably correct (engine unit test) + animates in the browser; microtask queue drains before the parked timer fires; `typecheck`/`lint`/`build` clean; dev mounts cleanly. **Shippable vertical slice complete.**

**As built — notes:**

- Promises are heap objects (`{state, value, listeners}`); settling fires listeners that **enqueue microtask jobs**. `.then`/`.catch`/`.finally`, `Promise.resolve`/`reject`, `new Promise(executor)`, `queueMicrotask`, and `await` all funnel through this. `resolve` with a thenable **adopts** it.
- **async/await as a coroutine:** an async call returns a promise immediately; the body is a generator driven by `driveAsync`. `await` yields an internal `{kind:'await'}` step (never a snapshot) that `driveAsync` intercepts — it **pops the async frame** (the fn leaves the stack while waiting) and registers a settle listener that **resumes** the body as a microtask (pushing the frame back). Rejections resume via `body.throw(ThrowSignal)` so user `try/catch` works.
- `callAny` dispatches native vs async vs plain functions; native callbacks (promise `resolve`/`reject`) are heap functions with a TS `native` impl and no `node`/`closureEnv`.
- The event loop now **drains all microtasks after the sync script and after each macrotask** (`drainMicrotasks`). Microtask steps emit _before_ dequeue so the queue is visibly populated (same pattern as the pending-timer fix).
- New `StepKind` `microtask`; `Snapshot.explain` is populated by `explainFor()` and surfaced by `GuidedTip`. `HeapNodeView` gained a `promise` variant (for the Phase 5 object graph).

---

## Phase 5 — Structural depth (AST inspector + object/reference graph) ✅ DONE

**Objective:** JSV9000-grade structure, animated — features neither reference tool fully has.

**Tasks**

- `components/panels/AstInspector.tsx` — React Flow tree from the parsed AST; highlight `snapshot.astNodeId` (synced with source); **click a node → plain-English explanation**.
- `components/panels/ObjectGraph.tsx` — React Flow + d3-force graph of `snapshot.heap`: objects/arrays/closures as nodes, references as edges; animate edges as references form/rewire; show closures capturing variables.
- Performance pass: memoized selectors per panel; canvas fallback path for large graphs.

**Key files:** `src/engine/astView.ts`, `src/engine/types.ts` (`AstNodeView`, `RunResult.ast`), `src/lib/{buildGraph,explainNode}.ts`, `src/components/panels/{AstInspector,ObjectGraph}.tsx`, `src/components/layout/Dock.tsx`, `src/store/useVisualizerStore.ts`.
**DoD ✅:** AST highlights + scrolls to the live node and explains nodes on click; the object graph shows a closure capturing its scope (asserted by `buildGraph.test.ts`). 39 tests green; `typecheck`/`lint`/`build` clean; dev mounts cleanly.

**As built — notes / deviations:**

- The UI can't reach the worker's AST, so the engine emits a **serializable `AstNodeView` tree** once per run (`buildAstView`, on `RunResult.ast`); the store holds it. Node ids match the snapshot's `astNodeId` (same parser meta), so highlight sync is exact.
- **AST is an indented collapsible tree, not a React Flow graph** (a tree reads better indented and avoids a graph-layout dependency) — a deliberate deviation from the original plan. React Flow is used where it shines: the object graph.
- **Object graph** = active scope chain + every closure's captured scope + all heap objects, wired by reference; `buildGraph` is pure (unit-tested). Layout via **d3-force**, memoized by the node/edge-id signature so positions only move when the graph's shape changes (no per-step jitter). Rendered with React Flow (default nodes + JSX labels, pan/zoom).
- Dock right side is now a scrollable column: the 6 runtime panels in a 2-col grid, then the object graph, then the AST.
- Bundle grew (~React Flow + d3-force); code-splitting/lazy-loading these heavy panels is a Phase 7 task.

---

## Phase 6 — Debugger-grade controls ✅ DONE

**Objective:** Make it a real debugger you can scrub.

**Tasks**

- Breakpoints: gutter click (`components/editor/Breakpoints.tsx`) → store; `player.ts` `run-to-breakpoint`.
- **Step into / over / out** using snapshot `kind` + call-depth tracking in `player.ts`.
- Timeline scrubber upgrade: **event markers** (log fired, timer elapsed, microtask drained, frame pushed) derived from the snapshot stream.
- `components/editor/HeatmapGutter.tsx` — per-line execution count heatmap.
- `components/editor/ValueBubbles.tsx` — inline CM6 widgets showing each expression's current value.

**Key files:** `src/lib/stepping.ts`, `src/player/player.ts`, `src/store/useVisualizerStore.ts`, `src/components/editor/{editorGutters.ts, Editor.tsx}`, `src/components/controls/{Toolbar,Scrubber}.tsx`, `src/App.tsx`.
**DoD ✅:** breakpoint gutter toggles + playback pauses on entering a breakpoint line (with "continue past current line"); step over/out skip/exit nested calls; scrubber shows colored event markers (timer/task/microtask/log); cumulative heatmap gutter + inline value bubble update with the timeline. 42 tests green; `typecheck`/`lint`/`build` clean; editor mounts cleanly.

**As built — notes:**

- Stepping is pure (`lib/stepping.ts`, unit-tested via call-depth): step-into = next snapshot; step-over = next snapshot at depth ≤ current; step-out = next snapshot shallower than current.
- Breakpoints live in the store (`breakpoints: number[]`, toggled from a CM6 gutter). The **player** pauses on `isBreakpointHit` (entered a breakpoint _line_), suppressing the line you resumed from so Continue/Play works like a real debugger.
- Three CM6 extensions in `editorGutters.ts` (effect + StateField each): clickable breakpoint gutter, heatmap gutter (per-line intensity), and an inline value-bubble widget. Driven by dispatching effects when inputs change; the extension set is built once (stable store action) so the editor never reconfigures.
- Heatmap is **cumulative up to the current index** (computed in `App`); the value bubble shows the current expression's value when it's a resolvable identifier (UI reads the source span text + scope chain — no engine change).

---

## Phase 7 — Content, UX polish  ✅ DONE

**Objective:** Make it delightful (sharing + themes were dropped from scope).

**Tasks**

- `examples/` — curated "aha" gallery (event-loop ordering, closures let-vs-var, recursion, closure factory, promise chain, async/await, debounce, object references) with a picker dialog.
- Guided/tutorial mode chaining `explain` annotations into a walkthrough.
- keyboard shortcuts + command palette, `prefers-reduced-motion` fallback, responsive layout + code-splitting.

**Key files:** `src/examples/index.ts`, `src/components/controls/{ExampleGallery,CommandPalette,Toolbar}.tsx`, `src/components/layout/{Dock,GuidedTip}.tsx`, `src/player/player.ts`, `src/store/useVisualizerStore.ts`, `src/App.tsx`.
**DoD ✅:** 8-snippet gallery (Radix Dialog) loads + runs on click; guided mode pauses at each `explain` step; ⌘K command palette (actions + examples) with arrow/Enter nav; shortcuts (Space play/pause, R run, ←/→ step); `prefers-reduced-motion` damped globally; graph panel lazy-loaded into its own chunk; responsive single-column under `lg`. 42 tests green; `typecheck`/`lint`/`build` clean; dev mounts cleanly.

**As built — notes:**
- **Guided mode** reuses the player's run-to-breakpoint machinery: a unified `resumeIndex` ref skips the step you resumed from, then pauses on the next breakpoint-line hit *or* `explain`-annotated step.
- `loadExample` sets source then runs; the gallery + palette both call it.
- Command palette opens via ⌘K/Ctrl+K or a `open-command-palette` window event (toolbar ⌘K button dispatches it); global shortcuts are suppressed while a `[role="dialog"]` is open or focus is in an input/editor.
- Code-splitting: `Dock` lazy-imports `ObjectGraph` behind `Suspense` → React Flow + d3-force land in a separate ~190 kB chunk, shrinking the initial bundle. The main bundle is still >500 kB (CodeMirror/React/framer-motion) — acceptable; the warning is advisory.
- Sharing/permalinks and theming were intentionally cut from this phase.

---

## Phase 8 — Hardening & release

**Objective:** Confidence to ship.

**Tasks**

- Full Vitest engine suite green (ordering, closures, async, time-travel invariants); coverage on `engine/`.
- Manual browser pass across all gallery examples: console order, queue parking, animations settle to the expected end state.
- Robustness: runaway-loop guard UX; backward-scrub un-fires timers cleanly; large-program perf budget; error surfacing.
- `README.md` (architecture overview + GIFs), deploy (static host), basic analytics-free telemetry off.

**DoD:** all tests green in CI; deployed build; README complete.

---

## Overall verification

- **Engine (Vitest):** snapshot-sequence assertions for recursion, closures (incl. var/let loop), and async ordering; time-travel determinism (`goto(N)` reproducible); guard aborts infinite loops.
- **UI (manual browser):** each gallery example plays through with correct console order and the canonical
  `A, D, C, B` event-loop behavior — timeout parked in Web APIs → Macrotask Queue while the microtask drains first; animations settle to expected end state.
- **Manual:** `npm run dev`, exercise Real-time vs Step modes, breakpoints, scrubbing forward/back, AST + object-graph sync.

## Out of scope (v1) / future

Full GC/memory-pressure simulation; classes & user generators; ES modules; multi-file projects;
collaborative sessions; record-to-GIF/video export; mobile-first layout.
