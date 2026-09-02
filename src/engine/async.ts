import type { HeapObject } from './heap'

export type { PromiseState } from './heap'

/**
 * Async/promise plumbing types. The behavior lives in the interpreter (it needs
 * the heap, microtask queue, and call stack), but the shared shapes live here.
 *
 * Model in brief:
 * - A Promise is a heap object with a state + value + settle listeners.
 * - `.then` / `await` / `queueMicrotask` enqueue **microtask jobs**.
 * - The event loop drains *all* microtasks between macrotasks.
 * - An async function runs as a coroutine: `await` suspends it (popping its
 *   frame) and a settle listener resumes it as a microtask.
 */

/** Microtask kinds, for labeling the queue + guided tips. */
export type MicrotaskKind = 'then' | 'finally' | 'await' | 'queueMicrotask' | 'resolve'

export interface MicroJob<Step> {
  id: string
  kind: MicrotaskKind
  label: string
  callbackName: string
  node: unknown
  run: () => Generator<Step, void>
}

export function isPromiseObject(
  o: HeapObject | undefined,
): o is Extract<HeapObject, { kind: 'promise' }> {
  return !!o && o.kind === 'promise'
}
