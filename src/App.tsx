import { useEffect, useMemo } from 'react'
import { Dock } from './components/layout/Dock'
import { Editor } from './components/editor/Editor'
import { Toolbar } from './components/controls/Toolbar'
import { CommandPalette } from './components/controls/CommandPalette'
import { useVisualizerStore, useCurrentSnapshot } from './store/useVisualizerStore'
import { usePlayer } from './player/player'
import type { EnvView, Snapshot } from './engine'

const DEFAULT_CODE = `// Press Run. Why does this log A, D, C, B?
// Watch the microtask queue drain before the timer fires.
console.log('A')

setTimeout(() => {
  console.log('B')
}, 0)

Promise.resolve().then(() => {
  console.log('C')
})

console.log('D')
`

/** Look up a variable's display value along the active scope chain. */
function lookupVar(snap: Snapshot, name: string): string | null {
  let id: string | null = snap.activeEnvId
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const env: EnvView | undefined = snap.environments[id]
    if (!env) break
    const binding = env.bindings.find((b) => b.name === name)
    if (binding) return binding.initialized ? (binding.value?.repr ?? null) : null
    id = env.parentId
  }
  return null
}

export function App() {
  const source = useVisualizerStore((s) => s.source)
  const setSource = useVisualizerStore((s) => s.setSource)
  const status = useVisualizerStore((s) => s.status)
  const index = useVisualizerStore((s) => s.index)
  const snapshots = useVisualizerStore((s) => s.snapshots)
  const breakpoints = useVisualizerStore((s) => s.breakpoints)
  const toggleBreakpoint = useVisualizerStore((s) => s.toggleBreakpoint)
  const stepForward = useVisualizerStore((s) => s.stepForward)
  const stepBackward = useVisualizerStore((s) => s.stepBackward)
  const run = useVisualizerStore((s) => s.run)
  const togglePlay = useVisualizerStore((s) => s.togglePlay)
  const snap = useCurrentSnapshot()

  usePlayer()

  useEffect(() => {
    if (!source) setSource(DEFAULT_CODE)
  }, [source, setSource])

  // Global keyboard shortcuts (ignored while typing or when a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        target?.closest('.cm-editor') ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable ||
        document.querySelector('[role="dialog"]')
      ) {
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepForward()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepBackward()
      } else if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        void run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepForward, stepBackward, togglePlay, run])

  const highlight = snap?.source ? { from: snap.source.start, to: snap.source.end } : null

  // Cumulative per-line execution intensity for the heatmap gutter.
  const heatmap = useMemo(() => {
    const counts: Record<number, number> = {}
    let max = 0
    for (let i = 0; i <= index && i < snapshots.length; i++) {
      const line = snapshots[i]?.source?.line
      if (line == null) continue
      counts[line] = (counts[line] ?? 0) + 1
      if (counts[line] > max) max = counts[line]
    }
    if (max === 0) return {}
    const out: Record<number, number> = {}
    for (const [line, c] of Object.entries(counts)) out[Number(line)] = 0.15 + 0.85 * (c / max)
    return out
  }, [snapshots, index])

  // Inline value bubble for the current identifier (if it resolves to a variable).
  const bubble = useMemo(() => {
    const src = snap?.source
    if (!src) return null
    const text = source.slice(src.start, src.end).trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(text)) return null
    const repr = lookupVar(snap, text)
    return repr != null ? { to: src.end, text: ` = ${repr}` } : null
  }, [snap, source])

  return (
    <>
      <Dock
        toolbar={<Toolbar />}
        editor={
          <Editor
            value={source}
            onChange={setSource}
            highlight={highlight}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
            heatmap={heatmap}
            bubble={bubble}
            readOnly={status === 'running'}
          />
        }
      />
      <CommandPalette />
    </>
  )
}
