import { useVisualizerStore, type PlayMode } from '@/store/useVisualizerStore'
import { cn } from '@/lib/cn'

const MODES: { value: PlayMode; label: string; title: string }[] = [
  { value: 'realtime', label: 'Real-time', title: 'Honor timer delays during playback' },
  { value: 'step', label: 'Step', title: 'Uniform pace, ignore timer delays' },
]

/** Toggle between Real-time (timers count down) and Step (uniform pace) playback. */
export function ModeToggle() {
  const mode = useVisualizerStore((s) => s.mode)
  const setMode = useVisualizerStore((s) => s.setMode)

  return (
    <div className="flex items-center rounded-md border border-edge p-0.5">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.title}
          onClick={() => setMode(m.value)}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            mode === m.value ? 'bg-accent text-[var(--panel)]' : 'text-ink-muted hover:text-ink',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
