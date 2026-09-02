import { lazy, Suspense, useCallback, useState, type PointerEvent, type ReactNode } from 'react'
import { CallStackPanel } from '../panels/CallStackPanel'
import { ScopesPanel } from '../panels/ScopesPanel'
import { ConsolePanel } from '../panels/ConsolePanel'
import { WebApisPanel } from '../panels/WebApisPanel'
import { EventLoopDial } from '../panels/EventLoopDial'
import { TaskQueuePanel } from '../panels/TaskQueuePanel'
import { MicrotaskQueuePanel } from '../panels/MicrotaskQueuePanel'
import { AstInspector } from '../panels/AstInspector'
import { Scrubber } from '../controls/Scrubber'
import { GuidedTip } from './GuidedTip'

// Code-split the graph panel — it pulls in React Flow + d3-force (a big chunk).
const ObjectGraph = lazy(() =>
  import('../panels/ObjectGraph').then((m) => ({ default: m.ObjectGraph })),
)

interface DockProps {
  toolbar: ReactNode
  editor: ReactNode
}

const CONSOLE_MIN = 80
const CONSOLE_DEFAULT = 160

/**
 * Top-level layout: toolbar, then the timeline scrubber, then the source editor
 * (left) beside the runtime-panel grid (right). The console lives beneath the
 * editor in the same column, so it matches the editor's width, and its height
 * is drag-resizable from the handle along its top edge. Every panel is a pure
 * render of the current snapshot.
 */
export function Dock({ toolbar, editor }: DockProps) {
  const [consoleHeight, setConsoleHeight] = useState(CONSOLE_DEFAULT)

  // Drag the handle to grow/shrink the console; dragging up makes it taller.
  const onResizeStart = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = consoleHeight
      const maxHeight = window.innerHeight * 0.7
      const onMove = (ev: globalThis.PointerEvent) => {
        const next = startHeight + (startY - ev.clientY)
        setConsoleHeight(Math.max(CONSOLE_MIN, Math.min(maxHeight, next)))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [consoleHeight],
  )

  return (
    <div className="flex h-screen flex-col">
      {toolbar}
      <Scrubber />
      <GuidedTip />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="flex min-h-[35vh] flex-col border-b border-edge bg-panel lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-hidden">{editor}</div>
          <div
            className="flex shrink-0 flex-col"
            style={{ height: consoleHeight }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize console"
              onPointerDown={onResizeStart}
              className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-t border-edge bg-panel-muted"
            >
              <div className="h-0.5 w-8 rounded-full bg-edge transition-colors group-hover:bg-[var(--color-stack)]" />
            </div>
            <div className="min-h-0 flex-1 bg-panel-muted p-2">
              <ConsolePanel />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-auto bg-panel-muted p-2">
          <div className="grid grid-cols-1 gap-2 auto-rows-[minmax(150px,auto)] sm:grid-cols-2">
            <CallStackPanel />
            <ScopesPanel />
            <WebApisPanel />
            <EventLoopDial />
            <TaskQueuePanel />
            <MicrotaskQueuePanel />
          </div>
          <Suspense
            fallback={
              <div className="flex h-80 items-center justify-center rounded-lg border border-edge bg-panel text-xs text-ink-muted">
                Loading graph…
              </div>
            }
          >
            <ObjectGraph />
          </Suspense>
          <div className="h-80 shrink-0">
            <AstInspector />
          </div>
        </div>
      </div>
    </div>
  )
}
