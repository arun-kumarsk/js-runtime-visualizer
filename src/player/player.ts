import { useEffect, useRef } from 'react'
import { useVisualizerStore } from '@/store/useVisualizerStore'
import { isBreakpointHit } from '@/lib/stepping'

/** Base time per step in step-mode (and for instantaneous gaps), in ms.
 *  Tuned so the default 1× pace is gentle (≈ the old 0.5× rate). */
const BASE_STEP_MS = 560
/** Clamp real-time timer waits to a watchable range, in ms. */
const MIN_WAIT_MS = 280
const MAX_WAIT_MS = 2600

/**
 * The playback engine. It does **not** compute anything — it only advances the
 * store's `index` over time (P1: cosmetic timing). In step-mode every step takes
 * the same wall-clock time; in real-time mode, steps that cross a logical-clock
 * gap (a timer's delay) wait proportionally, so timers visibly count down.
 *
 * It also implements run-to-breakpoint: while playing, it pauses when execution
 * *enters* a breakpoint line — but not the line you resumed from (so "Continue"
 * works like a real debugger).
 */
export function usePlayer(): void {
  const playing = useVisualizerStore((s) => s.playing)
  const index = useVisualizerStore((s) => s.index)
  const mode = useVisualizerStore((s) => s.mode)
  const speed = useVisualizerStore((s) => s.speed)
  const breakpoints = useVisualizerStore((s) => s.breakpoints)
  const guided = useVisualizerStore((s) => s.guided)

  // The index we resumed from — pause checks are skipped for it so "Continue"
  // moves past the step it's parked on (breakpoint or guided annotation).
  const resumeIndex = useRef<number | null>(null)
  const wasPlaying = useRef(false)

  useEffect(() => {
    if (playing && !wasPlaying.current) resumeIndex.current = useVisualizerStore.getState().index
    wasPlaying.current = playing
  }, [playing])

  useEffect(() => {
    if (!playing) return
    const st = useVisualizerStore.getState()
    const { snapshots, stepForward, setPendingWait, pause } = st
    const last = snapshots.length - 1
    if (index >= last) return

    if (index !== resumeIndex.current) {
      const bp = new Set(breakpoints)
      const hitBreakpoint = isBreakpointHit(snapshots, index, bp)
      const hitGuided = guided && snapshots[index]?.explain != null
      if (hitBreakpoint || hitGuided) {
        pause()
        return
      }
    }

    const cur = snapshots[index]
    const next = snapshots[index + 1]
    let delay = BASE_STEP_MS
    let waiting = false
    if (mode === 'realtime' && cur && next) {
      const gap = next.clock - cur.clock
      if (gap > 0) {
        delay = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, gap))
        waiting = true
      }
    }
    delay = delay / speed
    setPendingWait(waiting ? { durationMs: delay, token: index } : null)

    const handle = window.setTimeout(() => stepForward(), delay)
    return () => window.clearTimeout(handle)
  }, [playing, index, mode, speed, breakpoints, guided])
}
