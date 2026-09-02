# Architecture Overview (the friendly version)

A 5-minute tour of how the app works and where code lives. For the deep dive (full diagrams,
decision log, performance details), see `ARCHITECTURE.md`.

---

## What it is

You type JavaScript, press **Run**, and watch it execute step by step — the call stack growing
and shrinking, variables changing, console output appearing.

We **don't** use the browser's real JavaScript engine. We run your code in our **own little
interpreter** instead. Why? Because the real engine hides everything we want to show (the call
stack, the scopes, the event-loop queues). Our own interpreter lets us pause, rewind, and look
inside.

---

## The one big idea

> Run the program **once**, save a picture at every step, then let you scrub through those
> pictures like frames in a video.

Each saved picture is called a **snapshot** — a plain object describing the program at one moment
(what's on the call stack, what variables exist, what's been logged, which line is running).

Because the whole run is computed up front, **stepping forward/back is just changing a number**
(which frame you're looking at). That's why scrubbing is instant and rewinding is free.

```
  your code            our engine                a list of snapshots
  ─────────            (runs it once)            (one per step)
 ┌──────────┐         ┌────────────┐            ┌───┬───┬───┬───┬───┐
 │ factorial│  ───▶   │ interpreter│   ───▶     │ 0 │ 1 │ 2 │ 3 │ … │
 │   (5)    │         └────────────┘            └───┴───┴───┴───┴───┘
 └──────────┘                                         │
                                                      │  you move this pointer
                                                      ▼  (Run / arrow keys)
                                                  ┌───────┐
                                                  │ frame │ ──▶ the screen draws this one
                                                  │   2   │
                                                  └───────┘
```

---

## Four simple rules

1. **Decide everything up front.** The engine figures out the entire run with no regard for
   real time. Clock time only controls *playback speed* later (so a `setTimeout(…, 1000)` looks
   like ~1 second on screen, but it never changes the order things happen). This is what makes
   rewinding reliable.

2. **One snapshot drives the whole screen.** Every panel (call stack, scopes, console, …) just
   *draws the current snapshot*. Panels don't track their own state. Want to show something new?
   Put it on the snapshot first.

3. **The engine runs in a Web Worker** (a background thread). So even an infinite loop in your
   code can't freeze the page — and there's a safety limit that stops runaway programs.

4. **Reuse unchanged data between snapshots.** Most steps only change a little. We share the
   unchanged parts between frames so keeping thousands of them stays cheap.

---

## What happens when you press Run

Using the default `factorial(5)` program:

1. **You click Run.** The UI hands your source code to the store.
2. **The store sends it to the Web Worker.** The worker runs the interpreter on it.
3. **The interpreter walks the code**, and after every step saves a snapshot. It ends up with an
   ordered list of snapshots (plus an error, if your code had one).
4. **The list comes back to the store**, which sets the current frame to `0`.
5. **The panels draw frame 0.** Call stack, scopes, console, and the highlighted line all come
   from that one snapshot.
6. **You step.** Pressing ▸ (or the → arrow key) moves the pointer to frame 1, 2, 3… Each move
   re-draws the panels from the new frame. The editor highlights the line that frame is on.

Nothing is re-computed when you step — you're just looking at a different saved frame.

---

## The pieces

```
  ┌──────────────────────────────────────────────┐
  │  Screens  (React components)                   │   what you see + click
  │   App, Toolbar, Editor, Call Stack, Scopes…    │
  └───────────────────────┬────────────────────────┘
                          │ reads the current snapshot
  ┌───────────────────────▼────────────────────────┐
  │  Store  (the timeline)                          │   holds snapshots[] + which
  │   useVisualizerStore: snapshots, index, status  │   frame is showing (index)
  └───────────────────────┬────────────────────────┘
                          │ asks the worker to run code
  ┌───────────────────────▼────────────────────────┐
  │  Worker  (background thread)                     │   keeps heavy work off the
  │   worker.ts                                      │   main thread
  └───────────────────────┬────────────────────────┘
                          │ calls
  ┌───────────────────────▼────────────────────────┐
  │  Engine  (the brain — plain TypeScript)          │   parses + runs your code,
  │   parser, interpreter, environment, heap, types  │   produces snapshots
  └──────────────────────────────────────────────────┘
```

| Folder | Job | Plain-English |
|--------|-----|---------------|
| `src/engine/` | Run the code, produce snapshots | The brain. Pure logic, no UI. |
| `src/engine/worker.ts` | Run the engine in the background | Keeps the page smooth. |
| `src/store/` | Hold the snapshot list + current frame | The video timeline. |
| `src/components/` | Draw the snapshot, handle clicks | The screens. |

**One important rule:** the **engine never imports React or anything UI**. It's just logic you
could run in a plain Node script (which is exactly how it's tested). The screens are allowed to
*read the engine's types*, but they never call the engine directly — they go through the store.

---

## The snapshot (the object everything reads)

Everything on screen comes from one of these (simplified from `src/engine/types.ts`):

```ts
interface Snapshot {
  kind        // what kind of step this is (statement, function call, return…)
  source      // which part of the code is running (for the editor highlight)
  callStack   // the function frames, bottom to top (name, args, return value)
  activeEnvId // which scope is "current" (the Scopes panel walks up from here)
  environments// all scopes right now (variables and their values)
  heap        // all objects/arrays/functions in memory
  console     // everything logged so far
  // event-loop queues (Web APIs, macrotask, microtask) come in later phases
}
```

If a panel needs to show something, that something has to live here first. That's the whole
trick behind "one snapshot drives the screen."

---

## Adding something new (the recipe)

Want a new panel or a new thing to visualize? Three steps:

1. **Add a field** to `Snapshot` in `src/engine/types.ts`.
2. **Fill it in** inside the interpreter when it builds each snapshot.
3. **Draw it** in a panel that reads the current snapshot.

(For a new language feature instead — like `switch` — you add a case to the interpreter and a
test, no UI needed.)

---

## Where things live

```
src/
  engine/          the brain (run code → snapshots). No UI in here.
    parser.ts          turns code text into a tree
    interpreter.ts     walks the tree, makes snapshots
    environment.ts     scopes / closures
    heap.ts            objects, arrays, functions
    types.ts           the Snapshot shape (the contract)
    worker.ts          runs the engine in the background
  store/
    useVisualizerStore.ts   the timeline: snapshots + current frame
  components/
    layout/    the overall page layout
    editor/    the code editor + line highlight
    panels/    call stack, scopes, console (more coming)
    controls/  the toolbar (Run, step, reset)
docs/
  PLAN.md                 the vision
  IMPLEMENTATION_PLAN.md  the build steps, phase by phase
  ARCHITECTURE.md         the detailed architecture
  ARCHITECTURE_OVERVIEW.md  ← you are here
```

That's the whole picture. Press Run, watch frames, scrub the timeline — and every frame is a
snapshot the screens simply draw.
