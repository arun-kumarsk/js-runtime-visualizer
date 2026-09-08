import { motion } from 'framer-motion'
import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { EventLoopWheel } from './EventLoopWheel'
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
const STEPS: { phase: Phase | null; label: string; short: string; description: string }[] = [
  {
    phase: 'sync',
    label: 'Evaluate Script',
    short: 'Script',
    description:
      'Synchronously execute the script as though it were a function body. Run until the Call Stack is empty.',
  },
  {
    phase: 'macrotask',
    label: 'Run a Task',
    short: 'Task',
    description:
      'Select the oldest Task from the Task Queue. Run it until the Call Stack is empty.',
  },
  {
    phase: 'microtask',
    label: 'Run all Microtasks',
    short: 'Micro',
    description:
      'Select the oldest Microtask from the Microtask Queue. Run it until the Call Stack is empty. Repeat until the Microtask Queue is empty.',
  },
  {
    phase: null,
    label: 'Rerender',
    short: 'Render',
    description: 'Render any changes to the page. (No-op in this visualizer.)',
  },
]

/**
 * The event loop, as the canonical four-step cycle — laid out as a compact
 * horizontal stepper. The step matching the current snapshot's phase is
 * highlighted, and its description shows in one line below. A pure render of
 * `snapshot.phase`.
 */
export function EventLoopDial() {
  const snap = useCurrentSnapshot()
  const phase: Phase = snap?.phase ?? 'sync'
  const activeStep = STEPS.find((s) => s.phase === phase) ?? STEPS[0]

  return (
    <Panel title="Event Loop" accent="var(--color-ink-muted)">
      <div className="flex gap-3">
        {/* column 1 — the loop animation */}
        <div className="shrink-0">
          <EventLoopWheel />
        </div>

        {/* column 2 — the loop steps */}
        <ol className="flex shrink-0 flex-col justify-center gap-1.5">
          {STEPS.map((step, i) => {
            const active = step.phase === phase
            const color = step.phase ? PHASE_COLOR[step.phase] : 'var(--color-ink-muted)'
            return (
              <li key={step.label} className="flex items-center gap-2" title={step.description}>
                <motion.span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  animate={{
                    backgroundColor: active ? color : 'var(--color-edge)',
                    color: active ? '#fff' : 'var(--color-ink-muted)',
                  }}
                  transition={{ duration: 0.2 }}
                >
                  {i + 1}
                </motion.span>
                <span
                  className={cn(
                    'text-xs leading-tight',
                    active ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {step.short}
                </span>
              </li>
            )
          })}
        </ol>

        {/* column 3 — the active step's detail, to the right of the steps */}
        <motion.div
          key={phase}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="min-w-0 flex-1 self-center border-l border-edge pl-3 text-xs leading-5 text-ink-muted"
        >
          <span className="font-semibold text-ink">{activeStep.label}</span>
          <p className="mt-0.5">{activeStep.description}</p>
        </motion.div>
      </div>
    </Panel>
  )
}
