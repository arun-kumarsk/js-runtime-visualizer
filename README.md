<div align="center">

# 🛰️ JS Runtime Visualizer

### A time-travel visualizer for the JavaScript runtime.

**Type JavaScript and watch it execute** — see the call stack breathe, closures light up, timers count down, and the event loop sweep callbacks from the queues onto the stack. Microtasks drain before macrotasks, right in front of you. Step, scrub, and rewind it all.

<br/>

[![Made with React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-⚡-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-license)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

<br/>

*Not a wrapper around a real engine — it runs your code in a custom generator-based interpreter, so it can **pause, step, rewind, and reveal the queues real engines hide**.*

</div>

---

## ✨ Why this exists

The hardest parts of JavaScript are the parts you **can't see**: the event loop, the micro/macrotask split, closures, `async`/`await`. Every developer eventually gets burned by *"why did this log in **that** order?"*

This tool makes the invisible visible — and lets you **rewind and replay** it until it clicks.

```js
console.log('A')
setTimeout(() => console.log('B'), 0)
Promise.resolve().then(() => console.log('C'))
console.log('D')
// A, D, C, B  — and now you can *watch* exactly why.
```

You'll see `B` park in **Web APIs**, hop to the **Callback Queue**, and wait there while the **microtask** `C` cuts the line — the whole dance, step by step.

---

## 🚀 Features

- 🎞️ **Time-travel debugging** — step forward *and back*, or scrub the timeline like a video.
- 🔁 **A real event-loop animation** — a spinning loop wheel + callback tokens that physically fly between the Call Stack, Web APIs, and the queues.
- ⏱️ **Live timers** — `setTimeout` bars count down in real time; toggle **Real-time ⇄ Step** pacing.
- 🧠 **Scopes & closures** — value-change pulses and capture links, so closures stop being magic.
- 🕸️ **Object / reference graph** — a force-directed view of how references are shared and rewired.
- 🌳 **Synced AST inspector** — the live node highlights as you step; click any node for a plain-English explanation.
- 🐛 **Debugger-grade controls** — breakpoints, step into/over/out, execution heatmap, inline value bubbles.
- 📚 **Curated example gallery** — from beginner fundamentals to the classic interview "gotchas."
- 🎓 **Guided mode** — contextual explanations surface at exactly the right moment.
- ⌨️ **Command palette** (`⌘K`) + keyboard shortcuts, dark UI, reduced-motion aware.

---

## ⚡ Quick start

```bash
git clone <your-repo-url> js-visualizer
cd js-visualizer
npm install
npm run dev          # → http://localhost:4000
```

That's it — paste some code, hit **Run**, and press **Play** (or step through with `←` / `→`).

```bash
npm run build        # production build
npm test             # run the Vitest suite
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint .
```

---

## 🧩 How it works (the 60-second version)

```
 source ──acorn──► AST ──► generator interpreter + event-loop scheduler
                            (runs in a Web Worker)
                                     │
                                     ▼
                        deterministic Snapshot[] stream
                                     │
                        zustand store  ──►  pure-render panels
                                     │
                     Player: play/pause · speed · Real-time⇄Step · scrub
```

Four ideas make it work:

1. **Deterministic logic, cosmetic timing.** The *entire* run is computed up front as an ordered stream of immutable snapshots. Wall-clock timing only affects *playback* — which is why reliable step-back and real-time animation can coexist.
2. **One snapshot is the single source of truth.** Every panel is a pure function of the current snapshot; stepping just moves an index.
3. **The engine runs in a Web Worker,** so even an infinite loop never janks the 60fps UI (a step-budget guard catches runaways).
4. **Structural sharing** keeps thousands of steps cheap — environments and heap objects are versioned and referenced by id.

📖 **Full write-up:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 🛠️ Tech stack

**React 19** · **TypeScript** (strict) · **Vite** · **acorn** (parser) · **CodeMirror 6** (editor) · **framer-motion** (animation) · **React Flow + d3-force** (graph) · **comlink** (worker RPC) · **zustand + immer** (state) · **Radix + Tailwind v4** (UI) · **Vitest** (tests)

---

## 🎯 Supported language subset

A focused, teaching-oriented slice of modern JS:

`var`/`let`/`const` · functions (decl / expr / arrow) & closures · objects & arrays · operators with proper coercion · `if`/`for`/`while`/`for..of` · `try`/`catch`/`finally` · template literals · `console.*` · `setTimeout`/`setInterval`/`clearTimeout` · `queueMicrotask` · `Promise` + `.then`/`.catch`/`.finally` · `async`/`await`.

> Deferred (for now): classes, generators, ES modules, the full prototype chain, regex. The UI states plainly that this is a learning subset.

---

## 🗺️ Roadmap

- [ ] Shareable permalinks (encode source + view in the URL)
- [ ] Light theme
- [ ] Record-to-GIF / video export
- [ ] Broader language coverage (classes, more array methods)
- [ ] Embeddable widget mode

---

## 🤝 Contributing

Contributions are welcome! Good places to start:

- Add an example to the gallery (`src/examples/index.ts`).
- Extend the language subset in `src/engine/interpreter.ts` (add a Vitest test).
- Polish a panel or animation in `src/components/`.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it explains the snapshot model and the invariants that keep time-travel correct. Please keep `npm test`, `npm run typecheck`, and `npm run lint` green.

---

## 📄 License

[MIT](#-license) — free to use, learn from, and build on.

<div align="center">
<br/>

**If this made the event loop finally click for you, drop a ⭐ — it helps others find it.**

</div>
