import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCurrentSnapshot, useVisualizerStore } from '@/store/useVisualizerStore'

/**
 * Style 3 of the event-loop animation: a callback token that physically flies
 * across the gap between the existing panels as it moves through the loop —
 * a timer elapsing (Web APIs → Callback Queue), a task being run (Callback Queue
 * → Call Stack), or a microtask draining (Microtask Queue → Call Stack).
 *
 * It's a pure render of the current step: each `timer` / `task` / `microtask`
 * snapshot triggers one flight between the two region panels (anchored by their
 * `data-region` attributes). Purely cosmetic and pointer-transparent.
 */

interface Point {
  x: number
  y: number
}
interface Flight {
  key: number
  from: Point
  to: Point
  label: string
  color: string
}

const REGION_COLOR: Record<string, string> = {
  callbackq: 'var(--color-macrotask)',
  microq: 'var(--color-microtask)',
}

/** Centre-top of a region panel in viewport coords (matches a fixed overlay). */
function anchor(region: string): Point | null {
  const el = document.querySelector(`[data-region="${region}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + Math.min(28, r.height / 2) }
}

export function FlyingCallbacks() {
  const snap = useCurrentSnapshot()
  const index = useVisualizerStore((s) => s.index)

  // A flight is a pure function of the current step. The panels don't move, so
  // reading their positions here (committed layout) is stable.
  const flight = useMemo<Flight | null>(() => {
    if (!snap) return null
    let src: string | null = null
    let dst: string | null = null
    let label = ''
    let color = ''
    if (snap.kind === 'timer' && snap.webApis[0]) {
      src = 'webapis'
      dst = 'callbackq'
      label = snap.webApis[0].callbackName
      color = REGION_COLOR.callbackq
    } else if (snap.kind === 'task' && snap.macrotaskQueue[0]) {
      src = 'callbackq'
      dst = 'stack'
      label = snap.macrotaskQueue[0].callbackName
      color = REGION_COLOR.callbackq
    } else if (snap.kind === 'microtask' && snap.microtaskQueue[0]) {
      src = 'microq'
      dst = 'stack'
      label = snap.microtaskQueue[0].callbackName
      color = REGION_COLOR.microq
    }
    if (!src || !dst) return null
    const from = anchor(src)
    const to = anchor(dst)
    if (!from || !to) return null
    return { key: index, from, to, label, color }
  }, [index, snap])

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <AnimatePresence>
        {flight && (
          <motion.div
            key={flight.key}
            className="absolute"
            style={{ left: flight.from.x, top: flight.from.y }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
            animate={{
              x: flight.to.x - flight.from.x,
              y: flight.to.y - flight.from.y,
              opacity: [0, 1, 1, 0],
              scale: 1,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut', times: [0, 0.15, 0.8, 1] }}
          >
            <div
              className="-translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 font-mono text-[11px] font-semibold shadow-lg"
              style={{ background: flight.color, color: '#0b0f17' }}
            >
              ƒ {flight.label}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
