import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { RotateCw } from 'lucide-react'
import { useCurrentSnapshot, useVisualizerStore } from '@/store/useVisualizerStore'
import type { Phase } from '@/engine'

const PHASE_COLOR: Record<Phase, string> = {
  sync: 'var(--color-stack)',
  macrotask: 'var(--color-macrotask)',
  microtask: 'var(--color-microtask)',
}

const PHASE_LABEL: Record<Phase, string> = {
  sync: 'Sync',
  macrotask: 'Task',
  microtask: 'Microtask',
}

/**
 * A compact spinning "event loop" wheel. It turns one notch (120°) each time the
 * loop dispatches a callback (a `task`/`microtask` step), is tinted by the current
 * phase, and pulls a token toward the centre as each callback runs. A pure render
 * of the current snapshot + timeline index — scrubbing rewinds it.
 */
export function EventLoopWheel() {
  const snap = useCurrentSnapshot()
  const index = useVisualizerStore((s) => s.index)
  const snapshots = useVisualizerStore((s) => s.snapshots)

  // Callbacks the loop has dispatched up to now — the wheel turns a notch each.
  const dispatches = useMemo(() => {
    let n = 0
    const end = Math.min(index, snapshots.length - 1)
    for (let i = 0; i <= end; i++) {
      const k = snapshots[i].kind
      if (k === 'task' || k === 'microtask') n++
    }
    return n
  }, [index, snapshots])

  const phase: Phase = snap?.phase ?? 'sync'
  const color = PHASE_COLOR[phase]
  const dispatching = snap?.kind === 'task' || snap?.kind === 'microtask'
  const stackN = snap?.callStack.length ?? 0
  const taskN = snap?.macrotaskQueue.length ?? 0
  const microN = snap?.microtaskQueue.length ?? 0

  return (
    <div className="flex flex-col items-center gap-1 pb-1">
      <div className="relative flex h-20 w-20 items-center justify-center">
        {/* the loop arrow — turns a notch per dispatched callback */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ rotate: dispatches * 120 }}
          transition={{ type: 'spring', stiffness: 120, damping: 14 }}
          style={{ color }}
        >
          <RotateCw size={72} strokeWidth={1.25} />
        </motion.div>

        {/* centre phase label (sits in the arrow's open middle) */}
        <div className="relative flex flex-col items-center leading-none">
          <span className="text-[8px] uppercase tracking-wider text-ink-muted">loop</span>
          <span className="text-[11px] font-semibold" style={{ color }}>
            {PHASE_LABEL[phase]}
          </span>
        </div>

        {/* callback token pulled from the queue side toward the centre on dispatch */}
        {dispatching && (
          <motion.span
            key={index}
            className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
            style={{ background: color, marginLeft: -4, marginTop: -4 }}
            initial={{ y: 34, opacity: 0, scale: 0.5 }}
            animate={{ y: 0, opacity: [0, 1, 0], scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        )}
      </div>

      {/* live region counts for context */}
      <div className="flex w-14 flex-col gap-0.5 font-mono text-[10px] text-ink-muted">
        <span className="flex justify-between">
          <span>stack</span>
          <span className="font-semibold text-ink">{stackN}</span>
        </span>
        <span className="flex justify-between" style={{ color: 'var(--color-macrotask)' }}>
          <span>task</span>
          <span className="font-semibold">{taskN}</span>
        </span>
        <span className="flex justify-between" style={{ color: 'var(--color-microtask)' }}>
          <span>micro</span>
          <span className="font-semibold">{microN}</span>
        </span>
      </div>
    </div>
  )
}
