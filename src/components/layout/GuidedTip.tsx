import { AnimatePresence, motion } from 'framer-motion'
import { Lightbulb } from 'lucide-react'
import { useCurrentSnapshot } from '@/store/useVisualizerStore'

/**
 * A slim banner that surfaces the current snapshot's `explain` annotation —
 * contextual "why did that happen?" tips at event-loop moments (a timer firing,
 * the microtask queue draining before the next macrotask, …).
 */
export function GuidedTip() {
  const explain = useCurrentSnapshot()?.explain ?? null

  return (
    <AnimatePresence>
      {explain && (
        <motion.div
          key={explain}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2 border-b border-edge bg-[color-mix(in_oklab,var(--color-accent)_8%,var(--panel))] px-3 py-1.5 text-xs text-ink"
        >
          <Lightbulb size={14} className="shrink-0 text-[var(--color-webapi)]" />
          <span>{explain}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
