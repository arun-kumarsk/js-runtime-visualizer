# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web app that visualizes JavaScript execution — call stack, scopes/closures, the event loop
(Web APIs → macrotask queue → microtask queue), an object/reference graph, and a synced AST —
all scrubbable like a video. It is **not** a real JS engine wrapper: we run user code in our own
generator-based tree-walking **interpreter** so we can pause, step, rewind, and expose the
internal queues that real engines hide. The teaching subset is documented in `docs/PLAN.md`.

The build is sequenced into phases in `docs/IMPLEMENTATION_PLAN.md` (engine before UI; vertical
slice by Phase 4). **Read that file before starting work** — it lists the next phase's tasks, key
files, tests, and definition of done, and marks what's already built. `docs/PLAN.md` holds the
vision, architecture rationale, and the `Snapshot` data model.

## Commands

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # tsc -b (project refs) + vite build
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint .
npm test             # vitest run (headless, one-shot)
npm run test:watch   # vitest watch
npm run test:coverage

# single test file / single test by name
npx vitest run src/engine/interpreter.test.ts
npx vitest run -t "closure capture"
```

Tests are co-located (`*.test.ts` next to source). Engine correctness is verified by Vitest only —
**there is no e2e/Playwright**; UI behavior is checked manually in the browser.

## Architecture — the load-bearing ideas

These four principles are what make the app work; violating them breaks things in non-obvious ways.

1. **Deterministic logic, cosmetic timing.** The interpreter computes the _entire_ execution as a
   deterministic, ordered stream of `Snapshot`s up front. Wall-clock timing (a `setTimeout(…,1000)`
   taking ~1s on screen) only affects **playback pacing** in `src/player/`, never the computed
   ordering. This is what lets real-time animation and reliable scrub/step-back coexist. Never make
   execution ordering depend on real time, `Date.now()`, or `Math.random()`.

2. **One snapshot is the single source of truth.** Every panel (source highlight, AST, call stack,
   scopes, queues, heap graph, console) is a **pure render of the current `Snapshot`**. Panels hold
   no independent execution state. Stepping = moving an index in the zustand store; everything
   re-derives. If a panel needs to show something, it must be a field on `Snapshot`
   (`src/engine/types.ts`) — add it there first, don't smuggle state into a component.

3. **The engine runs in a Web Worker** (`src/engine/worker.ts`, via comlink) so a long or infinite
   program never janks the 60fps UI. A step-budget + wall-clock guard aborts runaway code.

4. **Structural sharing for time-travel.** Environments and heap objects are persistent, versioned,
   and referenced by **id** across snapshots — keeping thousands of steps cheap. Don't deep-copy
   whole state per step; reference shared env/heap nodes by id.

Pipeline: `source ──acorn──► AST (node ids) ──► interpreter (generator tree-walker) + event-loop
scheduler ──► Snapshot stream ──► zustand store ──► pure-render panels (motion + React Flow)`.

## Code layout (intent)

- `src/engine/` — pure, framework-free, fully unit-tested. `parser.ts` (acorn + node ids),
  `interpreter.ts` (`function* evalNode(node, env)`), `environment.ts` (scope chain / closures),
  `heap.ts`, `eventLoop.ts` (scheduler + queues), `async.ts` (Promise/await as microtask jobs),
  `types.ts` (`Snapshot` and view types), `worker.ts` (comlink endpoint). This directory must not
  import React or DOM.
- `src/store/useVisualizerStore.ts` — zustand+immer; holds `{ snapshots, index, status, ... }` and
  the step/goto actions. The bridge between worker output and the UI.
- `src/player/player.ts` — playback engine: play/pause, speed, Real-time⇄Step pacing,
  run-to-breakpoint. Drives the store index; does not compute execution.
- `src/components/` — `layout/` (Dock, Panel shell), `editor/` (CodeMirror 6 via
  `@uiw/react-codemirror`; decorations layered as extensions), `panels/` (one per runtime region),
  `controls/` (Toolbar, Scrubber, etc).

## Conventions

- **Path alias:** import app code as `@/…` (maps to `src/`).
- **Styling:** Tailwind **v4** (no `tailwind.config.js`). Design tokens are CSS vars defined under
  `@theme` / `:root` / `.dark` in `src/index.css` and surfaced as utilities like `bg-panel`,
  `text-ink`, `border-edge`, and region accents (`--color-stack`, `--color-macrotask`,
  `--color-microtask`, `--color-webapi`). Use `cn()` from `@/lib/cn` to compose classes. Dark mode
  is the `.dark` class on `<html>`.
- **TS is strict with `verbatimModuleSyntax`** — type-only imports must use `import type { … }`.
  `noUnusedLocals`/`noUnusedParameters` are on. There is no `baseUrl` (deprecated in TS6); `paths`
  resolve relative to the tsconfig.
- **Animation:** prefer framer-motion's `layout` prop for stack/queue reflow over manual tweening;
  honor `prefers-reduced-motion` (already globally damped in `index.css`).
- New runtime data a panel needs → add a field to `Snapshot` in `src/engine/types.ts`, populate it
  in the engine, then render it. Keep engine changes covered by a Vitest snapshot-sequence test.
