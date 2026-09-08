import type { ReactNode } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Loader2,
  ArrowRightToLine,
  ArrowUpFromLine,
  Lightbulb,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useVisualizerStore } from '@/store/useVisualizerStore'
import { ModeToggle } from './ModeToggle'
import { SpeedControl } from './SpeedControl'
import { ExampleGallery } from './ExampleGallery'

function ToolButton({
  label,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'bg-accent text-[var(--panel)] hover:opacity-90'
          : 'border border-edge bg-panel text-ink hover:bg-panel-muted',
      )}
    >
      {children}
    </button>
  )
}

/** Top control bar: Run, play/pause, step, reset, plus mode + speed. */
export function Toolbar() {
  const status = useVisualizerStore((s) => s.status)
  const playing = useVisualizerStore((s) => s.playing)
  const index = useVisualizerStore((s) => s.index)
  const total = useVisualizerStore((s) => s.snapshots.length)
  const run = useVisualizerStore((s) => s.run)
  const togglePlay = useVisualizerStore((s) => s.togglePlay)
  const stepForward = useVisualizerStore((s) => s.stepForward)
  const stepBackward = useVisualizerStore((s) => s.stepBackward)
  const stepOver = useVisualizerStore((s) => s.stepOver)
  const stepOut = useVisualizerStore((s) => s.stepOut)
  const reset = useVisualizerStore((s) => s.reset)
  const guided = useVisualizerStore((s) => s.guided)
  const toggleGuided = useVisualizerStore((s) => s.toggleGuided)

  const hasRun = total > 0

  return (
    <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
      <span className="mr-2 text-sm font-semibold tracking-tight">JS Runtime Visualizer</span>

      <ExampleGallery />

      <ToolButton label="Run" onClick={run} disabled={status === 'running'} primary>
        {status === 'running' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        Run
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-edge" />

      <ToolButton label="Step back" onClick={stepBackward} disabled={!hasRun || index <= 0}>
        <SkipBack size={15} />
      </ToolButton>
      <ToolButton
        label={playing ? 'Pause' : 'Play'}
        onClick={togglePlay}
        disabled={!hasRun}
        primary={playing}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </ToolButton>
      <ToolButton
        label="Step into / forward"
        onClick={stepForward}
        disabled={!hasRun || index >= total - 1}
      >
        <SkipForward size={15} />
      </ToolButton>
      <ToolButton
        label="Step over (skip nested calls)"
        onClick={stepOver}
        disabled={!hasRun || index >= total - 1}
      >
        <ArrowRightToLine size={15} />
      </ToolButton>
      <ToolButton
        label="Step out (run to caller)"
        onClick={stepOut}
        disabled={!hasRun || index >= total - 1}
      >
        <ArrowUpFromLine size={15} />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-edge" />

      <ToolButton label="Reset" onClick={reset} disabled={!hasRun}>
        <RotateCcw size={15} />
      </ToolButton>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          title="Command palette (⌘K)"
          className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs font-medium text-ink-muted hover:bg-panel-muted"
        >
          ⌘K
        </button>
        <button
          type="button"
          onClick={toggleGuided}
          title="Guided mode: pause at each teaching moment"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            guided
              ? 'border-[var(--color-webapi)] bg-[color-mix(in_oklab,var(--color-webapi)_16%,transparent)] text-[var(--color-webapi)]'
              : 'border-edge bg-panel text-ink-muted hover:bg-panel-muted',
          )}
        >
          <Lightbulb size={14} /> Guided
        </button>
        <ModeToggle />
        <SpeedControl />
        <div className="mx-1 h-5 w-px bg-edge" />
        <a
          href="https://github.com/arun-kumarsk/js-runtime-visualizer"
          target="_blank"
          rel="noreferrer noopener"
          title="View source on GitHub"
          aria-label="View source on GitHub"
          className="flex items-center rounded-md border border-edge bg-panel p-1.5 text-ink-muted transition-colors hover:bg-panel-muted hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </div>
    </div>
  )
}
