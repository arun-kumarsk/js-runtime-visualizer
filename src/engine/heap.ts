import type * as ESTree from 'estree'
import { Ref, type RV } from './runtime'
import type { Environment } from './environment'

/**
 * Heap-allocated values. Each carries a `rev` that bumps on mutation so the
 * snapshot serializer can structurally share unchanged nodes across steps.
 * Functions hold a live reference to their defining scope (`closureEnv`) — that
 * link *is* the closure.
 */
export type PromiseState = 'pending' | 'fulfilled' | 'rejected'

/** Called when a promise settles — used by the interpreter to schedule reactions. */
export type PromiseSettleListener = (state: 'fulfilled' | 'rejected', value: RV) => void

/** A built-in callback implemented in TS (e.g. a promise `resolve`/`reject`). */
export type NativeFn = (args: RV[]) => RV

export type HeapObject =
  | { id: string; kind: 'object'; rev: number; props: Map<string, RV> }
  | { id: string; kind: 'array'; rev: number; elements: RV[] }
  | {
      id: string
      kind: 'function'
      rev: number
      name: string
      /** Present for user functions; absent for native callbacks. */
      node?: ESTree.Function
      closureEnv?: Environment
      native?: NativeFn
    }
  | {
      id: string
      kind: 'promise'
      rev: number
      state: PromiseState
      value: RV
      listeners: PromiseSettleListener[]
    }

export class Heap {
  private counter = 0
  private readonly objects = new Map<string, HeapObject>()

  private nextId(): string {
    return `h${this.counter++}`
  }

  allocObject(): Ref {
    const id = this.nextId()
    this.objects.set(id, { id, kind: 'object', rev: 0, props: new Map() })
    return new Ref(id)
  }

  allocArray(elements: RV[] = []): Ref {
    const id = this.nextId()
    this.objects.set(id, { id, kind: 'array', rev: 0, elements })
    return new Ref(id)
  }

  allocFunction(name: string, node: ESTree.Function, closureEnv: Environment): Ref {
    const id = this.nextId()
    this.objects.set(id, { id, kind: 'function', rev: 0, name, node, closureEnv })
    return new Ref(id)
  }

  /** A built-in callback (e.g. a promise `resolve`) the user can call. */
  allocNativeFunction(name: string, native: NativeFn): Ref {
    const id = this.nextId()
    this.objects.set(id, { id, kind: 'function', rev: 0, name, native })
    return new Ref(id)
  }

  allocPromise(): Ref {
    const id = this.nextId()
    this.objects.set(id, { id, kind: 'promise', rev: 0, state: 'pending', value: undefined, listeners: [] })
    return new Ref(id)
  }

  get(ref: Ref | string): HeapObject {
    const id = typeof ref === 'string' ? ref : ref.id
    const obj = this.objects.get(id)
    if (!obj) throw new Error(`heap: unknown ref ${id}`)
    return obj
  }

  /** All live objects — serialized into every snapshot (small for teaching code). */
  all(): IterableIterator<HeapObject> {
    return this.objects.values()
  }
}
