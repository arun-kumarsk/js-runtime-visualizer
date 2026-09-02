import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import { activeItem, inactiveItem } from '@/lib/activeHighlight'
import type { FrameView } from '@/engine'

const NO_FRAMES: FrameView[] = []

/**
 * The call stack, newest frame on top. Frames animate in/out with framer-motion
 * `layout`, so pushes and pops read as the stack growing and shrinking. A frame
 * shows its function name + arguments, and its return value as it pops.
 */
export function CallStackPanel() {
  const snap = useCurrentSnapshot()
  const frames = snap?.callStack ?? NO_FRAMES
  const ordered = [...frames].reverse() // top (current) first

  return (
    <Panel title="Call Stack" accent="var(--color-stack)" badge={frames.length || undefined}>
      <div className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {ordered.map((f, i) => {
            const active = i === 0
            const depth = ordered.length - i // bottom frame = 1
            const hl = active ? activeItem('var(--color-stack)') : inactiveItem()
            return (
              <motion.div
                key={f.id}
                layout
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                className={cn('px-2.5 py-1.5', hl.className)}
                style={hl.style}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-1.5 font-mono text-xs">
                    <span
                      className={cn(
                        'tabular-nums',
                        active ? 'text-[var(--color-stack)]' : 'text-ink-muted',
                      )}
                    >
                      {depth}
                    </span>
                    <span
                      className={cn(
                        'font-serif italic',
                        active ? 'text-[var(--color-stack)]' : 'text-ink-muted',
                      )}
                      title="function"
                    >
                      ƒ
                    </span>
                    <span>
                      <span className={cn('font-semibold', active ? 'text-ink' : 'text-ink')}>
                        {f.fnName}
                      </span>
                      <span className="text-ink-muted">
                        ({f.args.map((a) => a.repr).join(', ')})
                      </span>
                    </span>
                  </span>
                  {f.returnValue && (
                    <span className="shrink-0 font-mono text-[11px] text-[var(--color-microtask)]">
                      ⟵ {f.returnValue.repr}
                    </span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </Panel>
  )
}
