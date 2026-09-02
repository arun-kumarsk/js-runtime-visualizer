import { useVisualizerStore, useCurrentSnapshot } from '@/store/useVisualizerStore'
import { cn } from '@/lib/cn'
import type { ConsoleEntry } from '@/engine'

const NO_ENTRIES: ConsoleEntry[] = []

const METHOD_STYLE: Record<ConsoleEntry['method'], string> = {
  log: 'text-ink',
  info: 'text-[var(--color-stack)]',
  warn: 'text-[var(--color-webapi)]',
  error: 'text-red-400',
}

/**
 * Console output for the current step. Cumulative (the snapshot carries all
 * output up to now); clicking a line jumps the timeline to the step that
 * produced it. A runtime/parse error is surfaced as a final red line.
 */
export function ConsolePanel() {
  const snap = useCurrentSnapshot()
  const entries = snap?.console ?? NO_ENTRIES
  const error = useVisualizerStore((s) => s.error)
  const goto = useVisualizerStore((s) => s.goto)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-edge bg-panel">
      <header className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Console
        </span>
        {entries.length > 0 && (
          <span className="text-xs text-ink-muted">{entries.length}</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-xs">
        {entries.length === 0 && !error ? (
          <span className="italic text-ink-muted">Console output will appear here.</span>
        ) : (
          <ul className="flex flex-col">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => goto(e.stepId)}
                  className={cn(
                    'w-full rounded px-1.5 py-0.5 text-left hover:bg-panel-muted',
                    METHOD_STYLE[e.method],
                  )}
                  title={`Jump to step ${e.stepId}`}
                >
                  {e.parts.map((p) => p.repr).join(' ')}
                </button>
              </li>
            ))}
            {error && (
              <li className="px-1.5 py-0.5 text-red-400">
                ⛔ {error.name}: {error.message}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
