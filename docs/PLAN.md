# Plan: Advanced JavaScript Runtime Visualizer ("Loupe × JSV9000, supercharged")

## Vision

An interactive, **richly animated** web app where you type JavaScript and *watch it think* —
the call stack breathing, scopes and closures lighting up as values change, timers counting
down in real time, the event loop arm sweeping callbacks from queue to stack, microtasks
draining before the next macrotask, an object graph rewiring as references form. It is a
**debugger you can scrub like a video**, with the structural depth of an academic tool and
the kinetic feel of a great explainer.

We are explicitly fusing two references and surpassing both:

| | **Loupe** (latentflip) | **JS Visualizer 9000** | **This project** |
|---|---|---|---|
| Event loop animation | ⭐ visceral, real-time | ✗ none | ⭐ real-time **+** step + scrub |
| Microtask queue | ✗ | partial | ⭐ first-class, distinct from macrotasks |
| Call stack | ✓ animated | ✓ static | ⭐ animated, args + return values |
| Scopes / closures | ✗ | ⭐ | ⭐ animated, with closure-capture links |
| AST view | ✗ | ⭐ | ⭐ synced, click-to-explain |
| Object / reference graph | ✗ | ✗ | ⭐ live force-graph (closures, shared refs) |
| Time-travel (step back) | ✗ | partial | ⭐ full bidirectional + timeline scrubber |
| Breakpoints / step in-out-over | ✗ | ✗ | ⭐ real-debugger controls |
| Language coverage | ES5-ish | modern subset | modern teaching subset (Promises/async-await) |

---

## Foundational design principles

1. **Deterministic logic, cosmetic timing.** The interpreter computes the execution as a
   deterministic, ordered stream of steps. Wall-clock timing (`setTimeout(…, 1000)` taking ~1s
   on screen) only affects **playback pacing**, never the computed ordering. This is what lets
   real-time animation and reliable scrub/step-back/replay coexist — a thing neither reference
   tool achieves.
2. **One snapshot is the single source of truth.** Every panel (source highlight, AST, call
   stack, scopes, queues, heap graph, console) is a pure render of the *current snapshot*. No
   panel holds independent state. Stepping = moving an index; everything re-derives.
3. **Engine off the main thread.** The interpreter runs in a Web Worker so a 10k-step program
   or an infinite loop never janks the 60fps animation layer.
4. **Structural sharing for time-travel.** Environments and heap objects are persistent,
   versioned, and referenced by id across snapshots — so keeping thousands of steps in memory
   stays cheap instead of deep-copying state every step.

---

## Architecture

```
 source ──acorn──► AST ──► Interpreter (generator tree-walker)  ──► Step/Snapshot stream
                    │         + Event-Loop scheduler                     │ (deterministic,
                    │         + Environment/Heap stores                  │  id-referenced,
                    │            [runs in Web Worker via comlink]        │  structurally shared)
                    │                                                    ▼
                    └────────────────────────────► UI (React) ◄── timeline store (zustand)
                                                       │
   Player: step ◄ ►, step in/out/over, play/pause, speed, REAL-TIME⇄STEP, scrubber, breakpoints
                                                       │
   Panels (all pure functions of the current snapshot), animated with motion + React Flow:
   ┌ Editor (CM6: line + sub-expression highlight, value bubbles, gutter heatmap, breakpoints)
   ├ AST Inspector (React Flow tree, current node highlighted, click-to-explain)
   ├ Call Stack (animated push/pop, args + return values)
   ├ Scopes & Closures (scope chain, value-change pulses, closure-capture links)
   ├ Event Loop (the signature sweeping arm/tick) · Web APIs (live timers)
   ├ Macrotask Queue · Microtask Queue (visually distinct, correct drain order)
   ├ Object / Reference Graph (force-directed; objects, arrays, captured closures)
   └ Console (synced; click a log → jump timeline to the step that produced it)
```

### Execution model — `src/engine/`
- **Parser** (`parser.ts`): `acorn` + `acorn-walk` → ESTree AST with node ids attached. Friendly
  errors for unsupported syntax.
- **Interpreter** (`interpreter.ts`): generator-based tree-walker, `function* evalNode(node, env)`,
  yielding a step at each meaningful node. Step granularity is tagged (`expression` |
  `statement` | `call` | `return`) so the UI can offer **step-into / step-over / step-out**.
- **Environments** (`environment.ts`): `Environment { id, kind, bindings: Map, parent }`. A
  closure is a function value capturing its defining environment id → directly powers the
  closure-capture links in the Scopes panel and edges in the object graph.
- **Heap** (`heap.ts`): objects/arrays/functions as `{ id, kind, edges }`. Powers the object
  graph and shared-reference visualization (references only — not a GC simulation).
- **Event-loop scheduler** (`eventLoop.ts`): four observable regions — `callStack`, `webApis`
  (pending timers w/ logical fire-order + display delay), `macrotaskQueue`, `microtaskQueue`.
  Drains **all** microtasks between each macrotask. Shims: `setTimeout`/`setInterval`/`clearTimeout`,
  `queueMicrotask`, `Promise` + `.then/.catch/.finally`, `async`/`await`, `console.*`.
- **Async model** (`async.ts` — the riskiest module → most tested): async functions are
  generators that yield on `await`; promise reactions are enqueued as microtask jobs. Ordering is
  decided by the scheduler, not by real time.
- **Worker** (`worker.ts` + `comlink`): runs the engine; streams snapshots back. Step-budget +
  wall-clock guard aborts runaway programs with a clear message.

### Snapshot data model — `src/engine/types.ts`
```ts
interface Snapshot {
  stepId: number;
  kind: 'expression' | 'statement' | 'call' | 'return';
  phase: 'sync' | 'microtask' | 'macrotask';
  astNodeId: string;                 // → AST highlight + source sub-token highlight
  source: { line: number; col: number; endLine: number; endCol: number };
  callStack: FrameView[];            // fn, args, locals, return value (on return)
  activeEnvId: string;               // entry into the env graph
  environments: Record<string, EnvView>;   // id-referenced (structural sharing)
  heap: Record<string, HeapNodeView>;       // objects/arrays/closures + edges
  webApis: WebApiView[];             // timers with remaining/fire-at for live countdown
  macrotaskQueue: TaskView[];
  microtaskQueue: TaskView[];
  console: ConsoleEntry[];           // cumulative; each carries originating stepId+nodeId
  explain?: string;                  // guided-mode annotation for this moment
}
```

---

## Feature set

**Core visualization** — animated call stack (args + return values), scopes & closures with
value-change pulses and capture links, the live event loop (sweeping arm), Web APIs with timers
that visibly count down, distinct macrotask & microtask queues with correct drain ordering,
console synced and clickable.

**Structural depth** — synced AST inspector (click a node → plain-English explanation), and a
live **object/reference graph** showing how closures capture variables and how references are
shared/rewired as the program runs.

**Debugger-grade controls** — bidirectional stepping; **step into / over / out**; breakpoints
(click the gutter, run-to-breakpoint); a **timeline scrubber** with event markers (log fired,
timer elapsed, microtask drained, frame pushed); per-line **execution heatmap** in the gutter;
inline **value bubbles** showing each expression's current value (debugger-style).

**Playback** — toggle **Real-time ⇄ Step** mode; play/pause; speed slider; the same deterministic
stream replays either as discrete animated steps or paced by wall-clock so timers feel real.

**UX & polish** — curated **example gallery** of "aha" snippets (timeout-vs-promise ordering,
closure-in-a-loop, recursion, debounce, async/await pitfalls); **guided mode** with contextual
explanations surfacing at the relevant moment; **shareable permalinks** (source + view encoded in
URL); dark/light themes; keyboard shortcuts; `prefers-reduced-motion` fallback; responsive layout
with dockable/collapsible panels.

---

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build/dev | **Vite** | Instant HMR, first-class TS, trivial `?worker` support. |
| Language | **TypeScript** | The engine's types (AST, Env, Heap, Snapshot) are the backbone. |
| Framework | **React 18** | Strongest ecosystem for the graph/animation surface we need. |
| Parser | **acorn** + acorn-walk | Compact, spec-aligned ESTree; easy node tagging. |
| Editor | **CodeMirror 6** | Decorations for line/sub-token highlight, gutter breakpoints + heatmap, inline value-bubble widgets. (Monaco = heavier alternative.) |
| Layout animation | **motion** (framer-motion) | `layout` prop auto-animates stack/queue reflow; spring physics; the event-loop arm. |
| Graphs | **React Flow** (+ **d3-force**) | AST tree **and** object/reference graph: nodes, edges, pan/zoom, minimap, force layout. |
| Worker RPC | **comlink** | Clean async boundary to the engine worker. |
| State | **zustand** (+ immer) | Minimal store for `{ snapshots, index, mode, speed, breakpoints }`. |
| UI primitives | **shadcn/ui** (Radix + Tailwind) | Accessible slider/scrubber, toggles, tooltips, dialogs, command palette — fast and polished. |
| Styling | **Tailwind CSS** | Rapid iteration on a panel-dense layout. |
| Unit tests | **Vitest** | Engine correctness contract (ordering, closures, async). |
| E2E tests | **Playwright** | Drive the real UI; assert ordering + that animations settle. |

---

## Language subset (v1, teaching-focused — explicit)
**Supported:** `var`/`let`/`const`, function decl/expr/arrow, closures, objects & arrays, common
operators, `if`/`for`/`while`/`for..of`, `try`/`catch`/`finally`, `console.*`,
`setTimeout`/`setInterval`/`clearTimeout`, `queueMicrotask`, `Promise` + `.then/.catch/.finally`,
`async`/`await`. **Deferred:** classes, generators (as user syntax), ES modules, full prototype
chain, regex, labeled/exotic control flow. The UI states plainly that this is a learning subset.

---

## File structure
```
js-visualizer/
  index.html  vite.config.ts  tsconfig.json  tailwind.config.js
  src/
    main.tsx  App.tsx
    engine/
      parser.ts  interpreter.ts  environment.ts  heap.ts
      eventLoop.ts  builtins.ts  async.ts  types.ts  worker.ts
      __tests__/            # vitest: ordering, closures, async, time-travel
    store/  useVisualizerStore.ts        # timeline / playback / breakpoints
    player/ player.ts                    # step + real-time pacing, run-to-breakpoint
    components/
      editor/Editor.tsx ValueBubbles.tsx HeatmapGutter.tsx Breakpoints.tsx
      panels/CallStackPanel.tsx ScopesPanel.tsx WebApisPanel.tsx
             TaskQueuePanel.tsx MicrotaskQueuePanel.tsx EventLoopDial.tsx
             ConsolePanel.tsx AstInspector.tsx ObjectGraph.tsx
      controls/Toolbar.tsx Scrubber.tsx SpeedControl.tsx ModeToggle.tsx
      layout/Dock.tsx GuidedTip.tsx
    examples/               # curated teaching snippets
    e2e/                    # playwright specs
```

---

## Milestones (incremental; each independently demoable)

0. **Scaffold** — Vite react-ts; Tailwind + shadcn/ui; motion, React Flow, zustand, acorn,
   comlink, vitest, playwright. Dockable panel shell + CodeMirror editor + Run.
1. **Engine core** — generator interpreter for the sync subset; environments + closures + heap;
   deterministic snapshot stream with AST node ids and structural sharing. Worker + comlink.
   Bidirectional step controls. *Demo: step a recursive `factorial` fwd/back.*
2. **Core panels** — CM6 current-line + sub-expression highlight; animated Call Stack (args +
   return values); Scopes & Closures with value-change pulses + capture links; synced Console.
3. **Event loop (the signature feature)** — scheduler + `setTimeout` → Web APIs (live countdown)
   → Macrotask Queue; the animated event-loop arm sweeping callback → stack; **Real-time ⇄ Step**
   toggle. *Demo: classic log / setTimeout(0) / log ordering, animated.*
4. **Promises & microtasks** — `Promise`/`.then`/`queueMicrotask`/`async`-`await`; distinct
   Microtask Queue; microtasks drain before next macrotask; guided tips at key moments.
   *Demo: A, D, C, B ordering is provably correct and visually obvious.*
5. **Structural depth** — AST Inspector (React Flow, synced highlight, click-to-explain) +
   live Object/Reference Graph (force-directed; closures & shared refs).
6. **Debugger-grade controls** — breakpoints + run-to-breakpoint; step into/over/out; timeline
   scrubber with event markers; gutter execution heatmap; inline value bubbles.
7. **Polish & advanced** — example gallery; guided mode; shareable permalinks; themes; keyboard
   shortcuts + command palette; reduced-motion fallback; perf pass (memoization / canvas for
   large graphs); README + full test suite.

---

## Hard parts / risks (called out up front)
- **Async/await + Promise semantics** are the easiest place to be subtly wrong. Mitigation:
  model async fns as generators yielding on `await`; reactions as microtask jobs; lock behavior
  with an extensive Vitest ordering suite before building the UI on top.
- **Time-travel memory** for long runs. Mitigation: structural sharing + id references + step
  budget + capped/decimated history with a clear "history truncated" indicator (no silent caps).
- **Animation performance** with many nodes (big object graphs / deep stacks). Mitigation:
  engine in worker, memoized pure panels, motion `layout` over manual animation, canvas fallback
  for large graphs, honor `prefers-reduced-motion`.
- **Sync across panels.** Mitigation: the single-snapshot-source-of-truth principle — if it's
  not in the snapshot, no panel can show it.

---

## Verification
- **Vitest (engine contract)** — assert the *snapshot sequence* for canonical programs:
  recursion (stack depth), closure capture (counter factory), closure-in-a-loop (`var` vs `let`),
  and especially **async ordering** (sync → microtask → macrotask). Assert **time-travel**:
  step N forward then back returns an identical snapshot.
- **Playwright (e2e)** — load each gallery example, play through, assert console order, that the
  setTimeout callback parks in Web APIs → Macrotask Queue while the microtask drains first, and
  that animations settle to the expected end state. The canonical eyeball test:
  ```js
  console.log('A');
  setTimeout(() => console.log('B'), 0);
  Promise.resolve().then(() => console.log('C'));
  console.log('D');
  // expected console order: A, D, C, B
  ```
- **Robustness** — `while(true){}` hits the step-budget guard and aborts with a friendly error
  instead of hanging the tab; scrubbing backward over a timer un-fires it cleanly.

---

## Out of scope (v1) / future
Full GC/memory-pressure simulation; classes & user generators; ES modules; multi-file projects;
collaborative/shared sessions; record-to-GIF/video export; mobile-first layout.
