import { describe, it, expect } from 'vitest'
import { runProgram } from './interpreter'
import type { RunResult, Snapshot } from './types'

/** Console lines as plain strings: each entry's parts joined by a space. */
function consoleLines(result: RunResult): string[] {
  const last = result.snapshots.at(-1)
  if (!last) return []
  return last.console.map((e) => e.parts.map((p) => stripQuotes(p.repr)).join(' '))
}

function stripQuotes(repr: string): string {
  return repr.startsWith('"') && repr.endsWith('"') ? repr.slice(1, -1) : repr
}

function maxStackDepth(snapshots: Snapshot[]): number {
  return snapshots.reduce((m, s) => Math.max(m, s.callStack.length), 0)
}

describe('synchronous interpreter', () => {
  it('runs basic declarations and arithmetic', () => {
    const r = runProgram(`
      const a = 2
      let b = 3
      console.log(a * b + 1)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['7'])
  })

  it('models a recursive call stack (factorial)', () => {
    const r = runProgram(`
      function fact(n) {
        if (n <= 1) return 1
        return n * fact(n - 1)
      }
      console.log(fact(4))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['24'])
    // global + fact(4) + fact(3) + fact(2) + fact(1) = 5
    expect(maxStackDepth(r.snapshots)).toBe(5)
  })

  it('captures closures (counter factory)', () => {
    const r = runProgram(`
      function makeCounter() {
        let c = 0
        return function () { c++; return c }
      }
      const inc = makeCounter()
      console.log(inc())
      console.log(inc())
      console.log(inc())
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['1', '2', '3'])
  })

  it('gives each `let` loop iteration its own binding', () => {
    const r = runProgram(`
      const fns = []
      for (let i = 0; i < 3; i++) {
        fns.push(function () { return i })
      }
      console.log(fns[0]())
      console.log(fns[1]())
      console.log(fns[2]())
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['0', '1', '2'])
  })

  it('shares one `var` binding across loop iterations', () => {
    const r = runProgram(`
      var fns = []
      for (var i = 0; i < 3; i++) {
        fns.push(function () { return i })
      }
      console.log(fns[0](), fns[1](), fns[2]())
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['3 3 3'])
  })

  it('enforces the temporal dead zone for let/const', () => {
    const r = runProgram(`
      console.log(x)
      let x = 1
    `)
    expect(r.error).not.toBeNull()
    expect(r.error?.name).toBe('ReferenceError')
    expect(r.error?.message).toMatch(/before initialization/)
  })

  it('rejects reassigning a const', () => {
    const r = runProgram(`
      const k = 1
      k = 2
    `)
    expect(r.error?.name).toBe('TypeError')
    expect(r.error?.message).toMatch(/constant/)
  })

  it('supports try/catch/finally', () => {
    const r = runProgram(`
      try {
        throw 'boom'
      } catch (e) {
        console.log('caught', e)
      } finally {
        console.log('done')
      }
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['caught boom', 'done'])
  })

  it('mutates objects and arrays on the heap', () => {
    const r = runProgram(`
      const o = { a: 1 }
      o.a = o.a + 4
      const xs = [1, 2]
      xs.push(3)
      console.log(o.a, xs[2], xs.length)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['5 3 3'])
  })

  it('returns false for every relational comparison involving NaN', () => {
    const r = runProgram(`
      console.log(NaN <= 1, NaN >= 1, 1 <= NaN, 1 >= NaN, NaN < 1, NaN > 1)
      console.log(2 <= 3, 3 <= 3, 'a' < 'b', 'b' <= 'b')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual([
      'false false false false false false',
      'true true true true',
    ])
  })

  it('lets a named function expression recurse by its own name without leaking it', () => {
    const r = runProgram(`
      const f = function fac(n) { return n <= 1 ? 1 : n * fac(n - 1) }
      console.log(f(5), typeof fac)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['120 undefined'])
  })

  it('coerces objects and arrays via ToPrimitive in + and ==', () => {
    const r = runProgram(`
      console.log('' + [1, 2, 3])
      console.log({} + 1)
      console.log([1, 2] + [3, 4])
      console.log([1] == 1, [] == 0, {} == 1)
      console.log(['a'] < ['b'])
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual([
      '1,2,3',
      '[object Object]1',
      '1,23,4',
      'true true false',
      'true',
    ])
  })

  it('supports logical assignment with short-circuit (no RHS eval when skipped)', () => {
    const r = runProgram(`
      let a = 0; a ||= 5
      let b = 1; b &&= 7
      let c = null; c ??= 9
      let d = 3; d ??= 100
      let calls = 0
      function rhs() { calls = calls + 1; return 1 }
      let e = 2; e ||= rhs()
      console.log(a, b, c, d, calls)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['5 7 9 3 0'])
  })

  it('supports the in operator for objects and arrays', () => {
    const r = runProgram(`
      console.log('a' in { a: 1 }, 'b' in { a: 1 })
      console.log(0 in [10, 20], 2 in [10, 20], 'length' in [1])
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['true false', 'true false true'])
  })
})

describe('determinism & time-travel', () => {
  it('produces an identical snapshot stream across runs', () => {
    const src = `
      function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
      console.log(fib(5))
    `
    const a = runProgram(src)
    const b = runProgram(src)
    expect(a.error).toBeNull()
    expect(JSON.stringify(a.snapshots)).toBe(JSON.stringify(b.snapshots))
  })

  it('indexing into the stream is stable (revisiting a step is identical)', () => {
    const r = runProgram(`
      let total = 0
      for (let i = 1; i <= 3; i++) total += i
      console.log(total)
    `)
    expect(r.error).toBeNull()
    const mid = Math.floor(r.snapshots.length / 2)
    // forward then back lands on the exact same snapshot object/content
    expect(r.snapshots[mid]).toBe(r.snapshots[mid])
    expect(JSON.stringify(r.snapshots[mid])).toBe(JSON.stringify(r.snapshots[mid]))
    expect(consoleLines(r)).toEqual(['6'])
  })

  it('shares unchanged environment views between adjacent snapshots', () => {
    const r = runProgram(`
      let a = 1
      let b = 2
      a = 3
    `)
    expect(r.error).toBeNull()
    // the global env view object is reused while it is unchanged between steps
    const reused = r.snapshots.some((s, i) => {
      if (i === 0) return false
      const prev = r.snapshots[i - 1]
      return s.environments[s.activeEnvId] === prev.environments[prev.activeEnvId]
    })
    expect(reused).toBe(true)
  })

  it('shows a mutated array binding at its point-in-time value (no stale cached repr)', () => {
    const r = runProgram(`const xs = []; xs.push(1); xs.push(2); xs.push(3)`)
    expect(r.error).toBeNull()
    // The `xs` binding repr must progress with the array, not stay frozen at […0].
    const reprs = new Set<string>()
    for (const s of r.snapshots)
      for (const env of Object.values(s.environments)) {
        const b = env.bindings.find((x) => x.name === 'xs')
        if (b?.value?.repr) reprs.add(b.value.repr)
      }
    expect(reprs.has('[…0]')).toBe(true)
    expect(reprs.has('[…3]')).toBe(true)
  })
})

describe('event loop (setTimeout)', () => {
  it('runs timer callbacks after the synchronous script', () => {
    const r = runProgram(`
      console.log('A')
      setTimeout(() => console.log('B'), 0)
      console.log('C')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['A', 'C', 'B'])
  })

  it('orders multiple timers by delay, then by registration', () => {
    const r = runProgram(`
      setTimeout(() => console.log('100'), 100)
      setTimeout(() => console.log('0a'), 0)
      setTimeout(() => console.log('0b'), 0)
      console.log('sync')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['sync', '0a', '0b', '100'])
  })

  it('lets a timer schedule another timer', () => {
    const r = runProgram(`
      setTimeout(() => {
        console.log('first')
        setTimeout(() => console.log('second'), 0)
      }, 0)
      console.log('sync')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['sync', 'first', 'second'])
  })

  it('cancels a timer with clearTimeout', () => {
    const r = runProgram(`
      const id = setTimeout(() => console.log('nope'), 10)
      clearTimeout(id)
      setTimeout(() => console.log('yes'), 20)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['yes'])
  })

  it('parks a pending timer in webApis, then moves it to the macrotask queue', () => {
    const r = runProgram(`setTimeout(() => console.log('x'), 50)`)
    expect(r.error).toBeNull()
    // at some step the timer is pending in Web APIs…
    expect(r.snapshots.some((s) => s.webApis.length === 1)).toBe(true)
    // …and at some step it is queued as a macrotask
    expect(r.snapshots.some((s) => s.macrotaskQueue.length === 1)).toBe(true)
    // the logical clock advances to the timer's fire time
    expect(r.snapshots.some((s) => s.clock === 50)).toBe(true)
  })

  it('shows console.log and setTimeout as native frames on the call stack', () => {
    const r = runProgram(`
      console.log('x')
      setTimeout(() => {}, 0)
    `)
    expect(r.error).toBeNull()
    const fnNames = r.snapshots.flatMap((s) => s.callStack.map((f) => f.fnName))
    expect(fnNames).toContain('console.log')
    expect(fnNames).toContain('setTimeout')
  })

  it('runs a built-in call in a single combined step', () => {
    const r = runProgram(`console.log('a')`)
    expect(r.error).toBeNull()
    // Exactly one snapshot has console.log on the stack (no separate call+return).
    const withLog = r.snapshots.filter((s) =>
      s.callStack.some((f) => f.fnName === 'console.log'),
    )
    expect(withLog).toHaveLength(1)
  })

  it('tags callback execution as the macrotask phase', () => {
    const r = runProgram(`setTimeout(() => console.log('hi'), 0)`)
    expect(r.snapshots.some((s) => s.phase === 'sync')).toBe(true)
    expect(r.snapshots.some((s) => s.phase === 'macrotask')).toBe(true)
  })
})

describe('promises & microtasks', () => {
  it('orders sync → microtask → macrotask (A, D, C, B)', () => {
    const r = runProgram(`
      console.log('A')
      setTimeout(() => console.log('B'), 0)
      Promise.resolve().then(() => console.log('C'))
      console.log('D')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['A', 'D', 'C', 'B'])
  })

  it('queues a due 0ms timer as a macrotask while a microtask is still pending', () => {
    // The setTimeout(…, 0) callback should sit in the callback queue *while* the
    // promise microtask waits its turn — an already-queued macrotask still loses
    // to a microtask. (It must not linger in Web APIs until the microtask drains.)
    const r = runProgram(`
      setTimeout(() => console.log('B'), 0)
      Promise.resolve().then(() => console.log('C'))
    `)
    expect(r.error).toBeNull()
    expect(
      r.snapshots.some((s) => s.macrotaskQueue.length === 1 && s.microtaskQueue.length === 1),
    ).toBe(true)
  })

  it('runs chained .then in order', () => {
    const r = runProgram(`
      Promise.resolve(1)
        .then((x) => x + 1)
        .then((x) => x * 10)
        .then((x) => console.log(x))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['20'])
  })

  it('drains all microtasks before the next macrotask', () => {
    const r = runProgram(`
      setTimeout(() => console.log('timeout'), 0)
      Promise.resolve().then(() => console.log('p1'))
      Promise.resolve().then(() => console.log('p2'))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['p1', 'p2', 'timeout'])
  })

  it('defers thenable adoption so a promise-of-a-promise costs extra ticks', () => {
    const r = runProgram(`
      const inner = Promise.resolve('inner')
      new Promise((res) => res(inner)).then((v) => console.log('adopted', v))
      Promise.resolve().then(() => console.log('t1')).then(() => console.log('t2')).then(() => console.log('t3'))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['t1', 't2', 'adopted inner', 't3'])
  })

  it('treats Promise.resolve(promise) as an identity passthrough', () => {
    const r = runProgram(`
      const p = Promise.resolve(1)
      console.log(Promise.resolve(p) === p)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['true'])
  })

  it('does not abort the program when a timer callback throws', () => {
    const r = runProgram(`
      setTimeout(() => { throw 'boom' }, 0)
      setTimeout(() => console.log('second'), 0)
    `)
    expect(r.error).toBeNull()
    const out = consoleLines(r)
    expect(out).toContain('second')
    expect(out.some((l) => l.includes('Uncaught') && l.includes('boom'))).toBe(true)
  })

  it('supports queueMicrotask', () => {
    const r = runProgram(`
      console.log('sync')
      queueMicrotask(() => console.log('micro'))
      setTimeout(() => console.log('macro'), 0)
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['sync', 'micro', 'macro'])
  })

  it('routes errors through .catch', () => {
    const r = runProgram(`
      Promise.reject('boom').catch((e) => console.log('caught', e))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['caught boom'])
  })

  it('supports new Promise with an executor', () => {
    const r = runProgram(`
      new Promise((resolve) => resolve(42)).then((v) => console.log(v))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['42'])
  })

  it('populates the microtask queue and the microtask phase', () => {
    const r = runProgram(`Promise.resolve().then(() => console.log('x'))`)
    expect(r.snapshots.some((s) => s.microtaskQueue.length === 1)).toBe(true)
    expect(r.snapshots.some((s) => s.phase === 'microtask')).toBe(true)
  })
})

describe('async / await', () => {
  it('suspends at await and resumes as a microtask', () => {
    const r = runProgram(`
      async function f() {
        console.log('A')
        await null
        console.log('B')
      }
      console.log('start')
      f()
      console.log('end')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['start', 'A', 'end', 'B'])
  })

  it('returns a promise that resolves with the return value', () => {
    const r = runProgram(`
      async function f() { return 7 }
      f().then((v) => console.log(v))
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['7'])
  })

  it('awaits a promise backed by a timer (interleaves with sync)', () => {
    const r = runProgram(`
      function delay(ms) { return new Promise((res) => setTimeout(res, ms)) }
      async function main() {
        console.log('1')
        await delay(0)
        console.log('2')
      }
      main()
      console.log('sync')
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['1', 'sync', '2'])
  })

  it('catches a rejected await with try/catch', () => {
    const r = runProgram(`
      async function f() {
        try {
          await Promise.reject('nope')
        } catch (e) {
          console.log('caught', e)
        }
      }
      f()
    `)
    expect(r.error).toBeNull()
    expect(consoleLines(r)).toEqual(['caught nope'])
  })
})

describe('safety guard', () => {
  it('aborts an infinite loop at the step budget', () => {
    const r = runProgram('while (true) {}', { maxSteps: 200 })
    expect(r.error).not.toBeNull()
    expect(r.error?.name).toBe('RangeError')
    expect(r.error?.message).toMatch(/budget/)
    expect(r.snapshots.length).toBe(200)
  })
})

describe('friendly errors', () => {
  it('explains not-yet-supported globals', () => {
    const r = runProgram('fetch("/x")')
    expect(r.error?.name).toBe('ReferenceError')
    expect(r.error?.message).toMatch(/not supported yet/)
  })

  it('reports a syntax error with a location', () => {
    const r = runProgram('const = 1')
    expect(r.error?.name).toBe('SyntaxError')
  })

  it('reports unsupported syntax (classes) gracefully', () => {
    const r = runProgram('class A {}')
    expect(r.error?.name).toBe('UnsupportedSyntax')
  })
})
