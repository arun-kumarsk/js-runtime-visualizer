import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { QueuePanel } from './QueuePanel'
import type { TaskView } from '@/engine'

const NONE: TaskView[] = []

/**
 * The microtask queue — drained completely between macrotasks. Empty until
 * Phase 4 wires up promises / queueMicrotask.
 */
export function MicrotaskQueuePanel() {
  const items = useCurrentSnapshot()?.microtaskQueue ?? NONE
  return (
    <QueuePanel
      title="Microtask Queue"
      accent="var(--color-microtask)"
      items={items}
      hint="drains fully before the next macrotask ↓"
    />
  )
}
