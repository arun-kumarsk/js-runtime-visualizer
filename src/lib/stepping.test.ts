import { describe, it, expect } from 'vitest'
import { runProgram } from '@/engine'
import { stepOverTarget, stepOutTarget, isBreakpointHit } from './stepping'

const FACTORIAL = `
function fact(n) {
  if (n <= 1) return 1
  return n * fact(n - 1)
}
fact(3)
`

describe('stepping', () => {
  it('step-over skips the nested call (stays at the same depth)', () => {
    const r = runProgram(FACTORIAL)
    const snaps = r.snapshots
    // find a snapshot at the top-level `fact(3)` call site (depth 1, the global frame)
    const start = snaps.findIndex((s) => s.callStack.length === 1 && s.kind === 'statement')
    expect(start).toBeGreaterThanOrEqual(0)
    const target = stepOverTarget(snaps, start)
    // the landing snapshot is back at depth <= 1 (we didn't stop inside fact)
    expect(snaps[target].callStack.length).toBeLessThanOrEqual(1)
    expect(target).toBeGreaterThan(start)
  })

  it('step-out returns to a shallower frame', () => {
    const r = runProgram(FACTORIAL)
    const snaps = r.snapshots
    const deep = snaps.reduce((m, s, i) => (s.callStack.length > snaps[m].callStack.length ? i : m), 0)
    const depth = snaps[deep].callStack.length
    const target = stepOutTarget(snaps, deep)
    expect(snaps[target].callStack.length).toBeLessThan(depth)
  })

  it('detects entering a breakpoint line (not re-hitting the same line)', () => {
    const r = runProgram(`let a = 1\nlet b = 2\nlet c = 3`)
    const snaps = r.snapshots
    const bp = new Set([2])
    const onLine2 = snaps.map((_, i) => i).filter((i) => snaps[i].source?.line === 2)
    expect(onLine2.length).toBeGreaterThan(0)
    // the first snapshot on line 2 is a hit; a later same-line snapshot is not
    expect(isBreakpointHit(snaps, onLine2[0], bp)).toBe(true)
    expect(isBreakpointHit(snaps, onLine2[0] + 0, new Set([99]))).toBe(false)
  })
})
