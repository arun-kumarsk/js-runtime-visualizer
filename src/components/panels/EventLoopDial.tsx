import { AnimatePresence, motion } from 'framer-motion'
import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import type { Phase } from '@/engine'

const PHASE_COLOR: Record<Phase, string> = {
  sync: 'var(--color-stack)',
  macrotask: 'var(--color-macrotask)',
  microtask: 'var(--color-microtask)',
}

/**
 * The phases the event loop cycles through, in order. Each step maps to a
 * `Snapshot.phase` (Rerender has no phase — it's a teaching placeholder that is
 * never "active" since our visualizer doesn't paint). Mirrors jsv9000.app.
 */
const STEPS: { phase: Phase | null; label: string; description: string }[] = [
  {
    phase: 'sync',
    label: 'Evaluate Script',
    description:
      'Synchronously execute the script as though it were a function body. Run until the Call Stack is empty.',
  },
  {
    phase: 'macrotask',
    label: 'Run a Task',
    description:
      'Select the oldest Task from the Task Queue. Run it until the Call Stack is empty.',
  },
  {
    phase: 'microtask',
    label: 'Run all Microtasks',
    description:
      'Select the oldest Microtask from the Microtask Queue. Run it until the Call Stack is empty. Repeat until the Microtask Queue is empty.',
  },
  {
    phase: null,
    label: 'Rerender',
    description: 'Render any changes to the page. (No-op in this visualizer.)',
  },
]

/**
 * The event loop, as the canonical four-step cycle. The step matching the
 * current snapshot's phase is highlighted and expands to reveal its
 * description; the rest stay dimmed. A pure render of `snapshot.phase`.
 */
export function EventLoopDial() {
  const snap = useCurrentSnapshot()
  const phase: Phase = snap?.phase ?? 'sync'

  return (
    <Panel title="Event Loop" accent="var(--color-ink-muted)">
      <ol className="flex flex-col py-1">
        {STEPS.map((step, i) => {
          const active = step.phase === phase
          const color = step.phase ? PHASE_COLOR[step.phase] : 'var(--color-ink-muted)'
          const isLast = i === STEPS.length - 1
          return (
            <li key={step.label} className="flex gap-2.5">
              {/* number badge + connector rail */}
              <div className="flex flex-col items-center">
                <motion.span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  animate={{
                    backgroundColor: active ? color : 'var(--color-edge)',
                    color: active ? '#fff' : 'var(--color-ink-muted)',
                  }}
                  transition={{ duration: 0.2 }}
                >
                  {i + 1}
                </motion.span>
                {!isLast && <div className="w-px flex-1 bg-edge" />}
              </div>

              <div className={cn('flex-1 pb-3', isLast && 'pb-0')}>
                <span
                  className={cn(
                    'text-sm leading-6 transition-colors',
                    active ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {step.label}
                </span>
                <AnimatePresence initial={false}>
                  {active && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden text-xs leading-5 text-ink-muted"
                    >
                      <span className="block pt-1">{step.description}</span>
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
