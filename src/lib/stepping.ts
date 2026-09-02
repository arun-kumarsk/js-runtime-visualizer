import type { Snapshot } from '@/engine'

/**
 * Debugger stepping over the precomputed snapshot stream. "Depth" is the call
 * stack size; step-over/out skip snapshots that are deeper than the current
 * frame.
 */

/** Step into: just the next snapshot (descends into calls). */
export function stepIntoTarget(snapshots: Snapshot[], index: number): number {
  return Math.min(index + 1, Math.max(0, snapshots.length - 1))
}

/** Step over: next snapshot at the same depth or shallower (skips nested calls). */
export function stepOverTarget(snapshots: Snapshot[], index: number): number {
  const cur = snapshots[index]
  if (!cur) return index
  const depth = cur.callStack.length
  let i = index + 1
  while (i < snapshots.length && snapshots[i].callStack.length > depth) i++
  return Math.min(i, snapshots.length - 1)
}

/** Step out: next snapshot shallower than the current frame (returns to caller). */
export function stepOutTarget(snapshots: Snapshot[], index: number): number {
  const cur = snapshots[index]
  if (!cur) return index
  const depth = cur.callStack.length
  let i = index + 1
  while (i < snapshots.length && snapshots[i].callStack.length >= depth) i++
  return Math.min(i, snapshots.length - 1)
}

/**
 * True when playback has just *entered* a breakpoint line — i.e. the current
 * snapshot is on a breakpoint line and the previous one was on a different
 * line. This lets "Continue" run past the line it's parked on.
 */
export function isBreakpointHit(
  snapshots: Snapshot[],
  index: number,
  breakpoints: ReadonlySet<number>,
): boolean {
  if (breakpoints.size === 0) return false
  const cur = snapshots[index]
  const line = cur?.source?.line
  if (line == null || !breakpoints.has(line)) return false
  const prevLine = snapshots[index - 1]?.source?.line
  return prevLine !== line
}
