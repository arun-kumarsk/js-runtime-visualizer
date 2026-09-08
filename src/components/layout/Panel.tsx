import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PanelProps {
  title: string
  /** Optional accent color (CSS color) shown as a left bar + title tint. */
  accent?: string
  /** Small pill next to the title (e.g. ordering discipline: "LIFO" / "FIFO"). */
  tag?: string
  /** Right-aligned content in the header (e.g. a count badge). */
  badge?: ReactNode
  /** Start collapsed. */
  defaultCollapsed?: boolean
  className?: string
  children?: ReactNode
}

/**
 * A collapsible titled card — the building block of the visualizer dock.
 * Every runtime region (call stack, queues, scopes, …) lives in one of these.
 */
export function Panel({
  title,
  accent,
  tag,
  badge,
  defaultCollapsed = false,
  className,
  children,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-sm',
        className,
      )}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2"
        style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-1.5 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={14}
            className={cn(
              'text-ink-muted transition-transform',
              collapsed && '-rotate-90',
            )}
          />
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={accent ? { color: accent } : undefined}
          >
            {title}
          </span>
          {tag && (
            <span
              className="rounded border border-edge px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted"
              title={
                tag === 'LIFO'
                  ? 'Last In, First Out'
                  : tag === 'FIFO'
                    ? 'First In, First Out'
                    : undefined
              }
            >
              {tag}
            </span>
          )}
        </button>
        {badge != null && (
          <span className="text-xs text-ink-muted">{badge}</span>
        )}
      </header>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
          {children ?? (
            <p className="text-xs italic text-ink-muted">
              Nothing to show yet — run some code.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
