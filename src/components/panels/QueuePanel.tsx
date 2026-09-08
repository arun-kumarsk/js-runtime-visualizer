import { motion, AnimatePresence } from 'framer-motion'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import { activeItem, inactiveItem } from '@/lib/activeHighlight'
import type { TaskView } from '@/engine'

interface QueuePanelProps {
  title: string
  accent: string
  items: TaskView[]
  /** FIFO direction hint shown when there are items. */
  hint?: string
}

/**
 * A FIFO queue of callbacks (used for both the macrotask and microtask queues).
 * Items animate in at the back and out from the front, so you can see ordering.
 */
export function QueuePanel({ title, accent, items, hint }: QueuePanelProps) {
  return (
    <Panel title={title} tag="FIFO" accent={accent} badge={items.length || undefined}>
      {items.length === 0 ? (
        <p className="text-xs italic text-ink-muted">empty</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {hint && <span className="text-[10px] uppercase tracking-wide text-ink-muted">{hint}</span>}
          <AnimatePresence initial={false}>
            {items.map((item, i) => {
              const next = i === 0
              const hl = next ? activeItem(accent) : inactiveItem()
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className={cn('flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs', hl.className)}
                  style={hl.style}
                >
                  <span
                    className="tabular-nums text-[10px]"
                    style={{ color: next ? accent : 'var(--color-ink-muted)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-ink-muted">{item.label}</span>
                  <span className="font-semibold text-ink">
                    <span className="font-serif italic" style={next ? { color: accent } : undefined}>
                      ƒ
                    </span>{' '}
                    {item.callbackName}
                  </span>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  )
}
