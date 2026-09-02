/**
 * Runtime values and control-flow signals for the interpreter.
 *
 * A runtime value (`RV`) is either a JS primitive held directly, or a `Ref` —
 * an opaque handle into the heap (objects, arrays, functions). Keeping refs
 * distinct from primitives is what lets the heap stay the single owner of
 * mutable state and powers the object-graph view later.
 */

/** Opaque handle to a heap-allocated value (object / array / function). */
export class Ref {
  constructor(public readonly id: string) {}
}

/** A value as seen by the running program. */
export type RV = number | string | boolean | null | undefined | Ref

/** Tagged `typeof`, with `null` and refs called out separately. */
export function typeOf(v: RV): 'number' | 'string' | 'boolean' | 'undefined' | 'null' | 'ref' {
  if (v === null) return 'null'
  if (v instanceof Ref) return 'ref'
  return typeof v as 'number' | 'string' | 'boolean' | 'undefined'
}

// --- Control-flow signals (thrown to unwind generator delegation) -----------

/** `return <value>` */
export class ReturnSignal {
  constructor(public readonly value: RV) {}
}

/** `break` */
export class BreakSignal {}

/** `continue` */
export class ContinueSignal {}

/** A program-level `throw` (or an interpreter-raised error), carrying the thrown value. */
export class ThrowSignal {
  constructor(public readonly value: RV) {}
}

/** Safety abort: too many steps / too much wall-clock — likely an infinite loop. */
export class BudgetExceeded {
  constructor(public readonly message: string) {}
}
