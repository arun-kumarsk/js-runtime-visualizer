import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentSnapshot, useVisualizerStore } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import { activeItem, inactiveItem } from '@/lib/activeHighlight'
import type { WebApiView } from '@/engine'

const NONE: WebApiView[] = []

/**
 * The Web APIs region: pending timers parked here until their delay elapses,
 * then they move to the callback queue. In real-time playback, the bar counts
 * down while the player waits out the timer (driven by `pendingWait`).
 */
export function WebApisPanel() {
  const timers = useCurrentSnapshot()?.webApis ?? NONE
  const pendingWait = useVisualizerStore((s) => s.pendingWait)

  return (
    <Panel title="Web APIs" accent="var(--color-webapi)" badge={timers.length || undefined}>
      {timers.length === 0 ? (
        <p className="text-xs italic text-ink-muted">No pending timers.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {timers.map((t, i) => {
              const soonest = i === 0
              const hl = soonest ? activeItem('var(--color-webapi)') : inactiveItem()
              return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                className={cn('px-2.5 py-1.5', hl.className)}
                style={hl.style}
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <span>
                    <span className="text-ink-muted">{t.label}</span>{' '}
                    <span className="font-semibold text-ink">
                      <span
                        className="font-serif italic"
                        style={soonest ? { color: 'var(--color-webapi)' } : undefined}
                      >
                        ƒ
                      </span>{' '}
                      {t.callbackName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[var(--color-webapi)]">{t.delay}ms</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-edge">
                  {pendingWait ? (
                    <motion.div
                      key={pendingWait.token}
                      className="h-full rounded-full"
                      style={{ background: 'var(--color-webapi)' }}
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: pendingWait.durationMs / 1000, ease: 'linear' }}
                    />
                  ) : (
                    <div
                      className="h-full w-full rounded-full opacity-30"
                      style={{ background: 'var(--color-webapi)' }}
                    />
                  )}
                </div>
              </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  )
}
