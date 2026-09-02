import { useMemo } from 'react'
import { useVisualizerStore } from '@/store/useVisualizerStore'

/**
 * Timeline scrubber. Drag to jump to any step. Tick marks flag event-loop
 * moments (a timer firing or a task being dequeued) so you can scrub to them.
 */
export function Scrubber() {
  const snapshots = useVisualizerStore((s) => s.snapshots)
  const index = useVisualizerStore((s) => s.index)
  const goto = useVisualizerStore((s) => s.goto)

  const total = snapshots.length
  const max = Math.max(0, total - 1)

  const markers = useMemo(() => {
    const out: { i: number; color: string }[] = []
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i]
      if (s.kind === 'timer') out.push({ i, color: 'var(--color-webapi)' })
      else if (s.kind === 'task') out.push({ i, color: 'var(--color-macrotask)' })
      else if (s.kind === 'microtask') out.push({ i, color: 'var(--color-microtask)' })
      else if (i > 0 && s.console.length > snapshots[i - 1].console.length)
        out.push({ i, color: 'var(--color-stack)' })
    }
    return out
  }, [snapshots])

  if (total === 0) return null

  return (
    <div className="flex items-center gap-3 border-b border-edge bg-panel px-3 py-2">
      <div className="relative flex-1">
        {/* event markers */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2">
          {markers.map(({ i, color }) => (
            <span
              key={i}
              className="absolute top-0 h-3 w-px"
              style={{
                left: `${max === 0 ? 0 : (i / max) * 100}%`,
                background: color,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={max}
          value={index}
          onChange={(e) => goto(Number(e.target.value))}
          className="relative w-full accent-[var(--color-accent)]"
          aria-label="Timeline scrubber"
        />
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
        {index + 1} / {total}
      </span>
    </div>
  )
}
