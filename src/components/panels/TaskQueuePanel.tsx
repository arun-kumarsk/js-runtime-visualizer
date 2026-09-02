import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { QueuePanel } from './QueuePanel'
import type { TaskView } from '@/engine'

const NONE: TaskView[] = []

/** The callback (macrotask) queue — where timer callbacks wait their turn. */
export function TaskQueuePanel() {
  const items = useCurrentSnapshot()?.macrotaskQueue ?? NONE
  return (
    <QueuePanel
      title="Callback (Macrotask) Queue"
      accent="var(--color-macrotask)"
      items={items}
      hint="front runs next ↓"
    />
  )
}
