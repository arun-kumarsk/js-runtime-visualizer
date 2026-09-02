import { useVisualizerStore } from '@/store/useVisualizerStore'
import { cn } from '@/lib/cn'

const SPEEDS = [0.5, 1]

/** Playback speed multiplier. */
export function SpeedControl() {
  const speed = useVisualizerStore((s) => s.speed)
  const setSpeed = useVisualizerStore((s) => s.setSpeed)

  return (
    <div className="flex items-center rounded-md border border-edge p-0.5">
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSpeed(s)}
          title={`${s}× speed`}
          className={cn(
            'rounded px-1.5 py-1 text-xs font-medium tabular-nums transition-colors',
            speed === s ? 'bg-accent text-[var(--panel)]' : 'text-ink-muted hover:text-ink',
          )}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}
