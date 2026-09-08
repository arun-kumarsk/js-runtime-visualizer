import type * as ESTree from 'estree'
import {
  Ref,
  typeOf,
  ReturnSignal,
  BreakSignal,
  ContinueSignal,
  ThrowSignal,
  BudgetExceeded,
} from './runtime'
import type { RV } from './runtime'
import { Environment } from './environment'
import { Heap, type HeapObject } from './heap'
import type { ParseResult } from './parser'
import { SyntaxParseError } from './parser'
import { parseProgram } from './parser'
import { buildAstView } from './astView'
import {
  CONSOLE_ID,
  SET_TIMEOUT_ID,
  SET_INTERVAL_ID,
  CLEAR_TIMEOUT_ID,
  CLEAR_INTERVAL_ID,
  PROMISE_ID,
  QUEUE_MICROTASK_ID,
  GLOBAL_BUILTINS,
  FUTURE_GLOBALS,
  nativeName,
  isNativeId,
} from './builtins'
import { isPromiseObject, type MicrotaskKind } from './async'
import type {
  Snapshot,
  StepKind,
  Phase,
  ValueView,
  EnvView,
  BindingView,
  FrameView,
  HeapNodeView,
  ConsoleEntry,
  WebApiView,
  TaskView,
  RunResult,
  RunOptions,
  SourceSpan,
  EngineError,
} from './types'

const DEFAULT_MAX_STEPS = 50_000
const DEFAULT_MAX_MS = 4_000

type FnObject = Extract<HeapObject, { kind: 'function' }>

/** A pending timer in the Web APIs region. */
interface Timer {
  id: string
  numId: number
  kind: 'timeout' | 'interval'
  delay: number
  fireAt: number
  cb: FnObject
  args: RV[]
  seq: number
  callbackNode: ESTree.Node
}

/** A callback queued to run (macrotask). */
interface Job {
  id: string
  numId: number
  callbackName: string
  source: 'timeout' | 'interval'
  callbackNode: ESTree.Node
  run: () => Generator<Step, RV>
}

/** Thrown for syntax we don't interpret yet — not catchable by user `try`. */
class UnsupportedSyntax extends Error {
  constructor(
    message: string,
    public readonly node: ESTree.Node,
  ) {
    super(message)
    this.name = 'UnsupportedSyntax'
  }
}

interface Step {
  /** `'await'` is an internal suspension marker, never turned into a snapshot. */
  kind: StepKind | 'await'
  node: ESTree.Node
  env: Environment
  /** The promise being awaited, when `kind === 'await'`. */
  promise?: Ref
}

/** A queued microtask (promise reaction, await resumption, queueMicrotask). */
interface MicroJob {
  id: string
  kind: MicrotaskKind
  label: string
  callbackName: string
  node: ESTree.Node
  run: () => Generator<Step, void>
}

interface Frame {
  id: string
  fnName: string
  env: Environment
  args: RV[]
  calleeNodeId?: string
  returnValue?: RV
  returning: boolean
}

/**
 * The interpreter: a generator-based tree-walker. `run()` drives the generator,
 * building one immutable `Snapshot` per yielded step. All execution ordering is
 * decided here, deterministically — no real-time, no randomness.
 */
export class Interpreter {
  private readonly program: ESTree.Program
  private readonly meta: ParseResult['meta']
  private readonly maxSteps: number
  private readonly maxMs: number

  private readonly heap = new Heap()
  private readonly envs: Environment[] = []
  private readonly callStack: Frame[] = []
  private console: ConsoleEntry[] = []
  private readonly snapshots: Snapshot[] = []
  private error: EngineError | null = null

  private stepId = 0
  private envCounter = 0
  private frameCounter = 0
  private consoleCounter = 0
  private startTime = 0
  private lastErrorNode: ESTree.Node | null = null

  // Event loop
  private clock = 0
  private phase: Phase = 'sync'
  private timerSeq = 1
  private eventSeq = 0
  private webApis: Timer[] = []
  private macrotaskQueue: Job[] = []
  private microtaskQueue: MicroJob[] = []
  private globalEnv!: Environment

  private readonly envViewCache = new Map<string, { rev: number; view: EnvView }>()
  private readonly heapViewCache = new Map<string, { rev: number; view: HeapNodeView }>()

  constructor(parsed: ParseResult, options: RunOptions = {}) {
    this.program = parsed.program
    this.meta = parsed.meta
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.maxMs = options.maxMs ?? DEFAULT_MAX_MS
  }

  run(): RunResult {
    this.startTime = Date.now()
    const global = this.newEnv('global', null, 'global')
    this.globalEnv = global
    global.declareOwn('undefined', 'var', undefined, true, true)
    global.declareOwn('NaN', 'var', NaN, true, true)
    global.declareOwn('Infinity', 'var', Infinity, true, true)
    for (const b of GLOBAL_BUILTINS) {
      global.declareOwn(b.name, 'const', new Ref(b.id), true, true)
    }

    try {
      const gen = this.executeAll(global)
      let r = gen.next()
      while (!r.done) {
        // 'await' steps are intercepted by the async driver and never reach here.
        if (r.value.kind !== 'await') {
          this.pushSnapshot(r.value)
          this.guard()
        }
        r = gen.next()
      }
      // Terminal snapshot: final state after the loop drains (incl. trailing
      // console output produced after the last statement step).
      this.pushSnapshot({ kind: 'program', node: this.program, env: global })
    } catch (e) {
      this.error = this.toEngineError(e)
    }

    return {
      snapshots: this.snapshots,
      error: this.error,
      ast: buildAstView(this.program, this.meta),
    }
  }

  /**
   * Runs the whole program: the main script as the first task, then the event
   * loop. Between tasks the call stack is empty — that emptiness is *why* a
   * queued callback gets to run, and the visualization shows it. All ordering
   * is decided by the logical clock + insertion order, never real time.
   */
  private *executeAll(global: Environment): Generator<Step, void> {
    // Main script — runs in a global frame that pops when the script ends.
    this.callStack.push({
      id: `f${this.frameCounter++}`,
      fnName: '(main)',
      env: global,
      args: [],
      returning: false,
    })
    this.phase = 'sync'
    yield* this.execProgram(this.program, global)
    this.callStack.pop()

    // Timers already due at script end (e.g. setTimeout(…, 0)) move to the
    // callback queue now — before microtasks drain, so they visibly wait there.
    this.expireDueTimers()

    // Microtasks queued during the sync script run before any macrotask.
    yield* this.drainMicrotasks()

    // Event loop: drain the macrotask queue (each followed by a full microtask
    // drain); when empty, advance the clock to the next due timer(s).
    this.phase = 'macrotask'
    for (;;) {
      if (this.macrotaskQueue.length > 0) {
        // Emit before dequeuing so the callback is visible in the queue on this
        // step; running it is then the next step.
        yield* this.emit('task', this.macrotaskQueue[0].callbackNode, global)
        const job = this.macrotaskQueue.shift()!
        try {
          yield* job.run()
        } catch (e) {
          if (e instanceof ThrowSignal) this.reportUncaught(e.value, job.callbackNode)
          else throw e
        }
        // Timers that came due while the macrotask ran queue before the next
        // microtask checkpoint.
        this.expireDueTimers()
        yield* this.drainMicrotasks()
      } else if (this.webApis.length > 0) {
        const fireAt = Math.min(...this.webApis.map((t) => t.fireAt))
        const earliest = this.webApis.find((t) => t.fireAt === fireAt)!
        // Show the timers waiting in Web APIs while the call stack is empty,
        // before the clock advances and they move to the queue.
        yield* this.emit('timer', earliest.callbackNode, global)
        this.clock = fireAt
        this.expireDueTimers()
      } else {
        break
      }
    }
  }

  // --- native built-ins (console / timers) ----------------------------------

  private callNative(id: string, args: RV[], node: ESTree.Node): RV {
    switch (id) {
      case SET_TIMEOUT_ID:
        return this.scheduleTimer('timeout', args, node)
      case SET_INTERVAL_ID:
        return this.scheduleTimer('interval', args, node)
      case CLEAR_TIMEOUT_ID:
      case CLEAR_INTERVAL_ID:
        return this.clearTimer(args[0])
      case QUEUE_MICROTASK_ID:
        return this.queueMicrotaskNative(args, node)
      case PROMISE_ID:
        this.lastErrorNode = node
        throw this.makeThrow('TypeError', "Promise constructor cannot be invoked without 'new'")
      default:
        this.lastErrorNode = node
        throw this.makeThrow('TypeError', `${nativeName(id)} is not a function`)
    }
  }

  private queueMicrotaskNative(args: RV[], node: ESTree.Node): RV {
    const cb = args[0]
    if (!(cb instanceof Ref) || isNativeId(cb.id) || this.heap.get(cb).kind !== 'function') {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', 'queueMicrotask expects a function')
    }
    const fnObj = this.heap.get(cb) as FnObject
    this.enqueueMicrotask(
      'queueMicrotask',
      'queueMicrotask',
      fnObj.name || 'anonymous',
      fnObj.node ?? this.program,
      () => this.callVoid(fnObj, node),
    )
    return undefined
  }

  private scheduleTimer(kind: 'timeout' | 'interval', args: RV[], node: ESTree.Node): RV {
    const cb = args[0]
    if (!(cb instanceof Ref) || isNativeId(cb.id) || this.heap.get(cb).kind !== 'function') {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', 'Timer callback must be a function')
    }
    const fnObj = this.heap.get(cb) as FnObject
    const raw = this.toNum(args[1] ?? 0)
    const delay = Number.isFinite(raw) ? Math.max(0, raw) : 0
    const numId = this.timerSeq++
    this.webApis.push({
      id: `w${numId}`,
      numId,
      kind,
      delay,
      fireAt: this.clock + delay,
      cb: fnObj,
      args: args.slice(2),
      seq: this.eventSeq++,
      callbackNode: fnObj.node ?? node,
    })
    return numId
  }

  private clearTimer(idArg: RV): RV {
    const numId = this.toNum(idArg)
    this.webApis = this.webApis.filter((t) => t.numId !== numId)
    this.macrotaskQueue = this.macrotaskQueue.filter((j) => j.numId !== numId)
    return undefined
  }

  private timerToJob(t: Timer): Job {
    return {
      id: `job${this.eventSeq++}`,
      numId: t.numId,
      callbackName: t.cb.name || 'anonymous',
      source: t.kind,
      callbackNode: t.callbackNode,
      run: () => this.callAny(t.cb, t.args, t.callbackNode),
    }
  }

  /**
   * Move every timer whose delay has already elapsed (`fireAt <= clock`) out of
   * Web APIs and into the macrotask queue, in fire order. This is a silent state
   * transition — no dedicated step — so it happens "async" between steps; the
   * queued callback becomes visible on the next emitted snapshot. A timer's hop
   * is driven by its delay elapsing (not by the microtask queue draining), so a
   * `setTimeout(…, 0)` already sits in the callback queue while microtasks run.
   */
  private expireDueTimers(): void {
    const due = this.webApis
      .filter((t) => t.fireAt <= this.clock)
      .sort((a, b) => a.seq - b.seq)
    for (const t of due) {
      this.webApis = this.webApis.filter((x) => x !== t)
      this.macrotaskQueue.push(this.timerToJob(t))
      if (t.kind === 'interval') {
        this.webApis.push({ ...t, fireAt: this.clock + t.delay, seq: this.eventSeq++ })
      }
    }
  }

  // --- microtasks & promises ------------------------------------------------

  private *drainMicrotasks(): Generator<Step, void> {
    if (this.microtaskQueue.length === 0) return
    const prev = this.phase
    this.phase = 'microtask'
    while (this.microtaskQueue.length > 0) {
      // Show the microtask waiting in the queue before it's dequeued and run.
      yield* this.emit('microtask', this.microtaskQueue[0].node, this.globalEnv)
      const mj = this.microtaskQueue.shift()!
      try {
        yield* mj.run()
      } catch (e) {
        if (e instanceof ThrowSignal) this.reportUncaught(e.value, mj.node)
        else throw e
      }
    }
    this.phase = prev
  }

  private enqueueMicrotask(
    kind: MicrotaskKind,
    label: string,
    callbackName: string,
    node: ESTree.Node,
    run: () => Generator<Step, void>,
  ): void {
    this.microtaskQueue.push({
      id: `mt${this.eventSeq++}`,
      kind,
      label,
      callbackName,
      node,
      run,
    })
  }

  private makePromise(): Ref {
    return this.heap.allocPromise()
  }

  private promiseOf(ref: Ref): Extract<HeapObject, { kind: 'promise' }> {
    const o = this.heap.get(ref)
    if (o.kind !== 'promise') throw new Error('expected promise')
    return o
  }

  /** Settle a pending promise with a value (adopting it if it's a thenable). */
  private resolvePromise(ref: Ref, value: RV): void {
    const p = this.promiseOf(ref)
    if (p.state !== 'pending') return
    if (value instanceof Ref && !isNativeId(value.id) && isPromiseObject(this.heap.get(value))) {
      // Resolving with a thenable is a PromiseResolveThenableJob: it runs on the
      // microtask queue, and subscribing to the (already-settled) inner promise
      // defers the outer settlement by a further microtask. So adoption is never
      // synchronous — it costs ~2 ticks, matching real engines.
      this.enqueueMicrotask('resolve', 'adopt thenable', 'anonymous', this.program, () =>
        this.adoptThenable(ref, value),
      )
      return
    }
    p.state = 'fulfilled'
    p.value = value
    p.rev++
    this.fireListeners(p)
  }

  // eslint-disable-next-line require-yield
  private *adoptThenable(ref: Ref, inner: Ref): Generator<Step, void> {
    // Subscribe to the inner promise; when it settles, schedule the outer
    // promise's settlement as a *further* microtask (the second adoption tick).
    this.addSettleListener(inner, (state, v) => {
      this.enqueueMicrotask('resolve', 'adopt thenable', 'anonymous', this.program, () =>
        this.settleAdopted(ref, state, v),
      )
    })
  }

  // eslint-disable-next-line require-yield
  private *settleAdopted(
    ref: Ref,
    state: 'fulfilled' | 'rejected',
    value: RV,
  ): Generator<Step, void> {
    if (state === 'fulfilled') this.resolvePromise(ref, value)
    else this.rejectPromise(ref, value)
  }

  private rejectPromise(ref: Ref, reason: RV): void {
    const p = this.promiseOf(ref)
    if (p.state !== 'pending') return
    p.state = 'rejected'
    p.value = reason
    p.rev++
    this.fireListeners(p)
  }

  private fireListeners(p: Extract<HeapObject, { kind: 'promise' }>): void {
    const listeners = p.listeners
    p.listeners = []
    const state = p.state as 'fulfilled' | 'rejected'
    for (const l of listeners) l(state, p.value)
  }

  /** Register a settle listener; if already settled, fire it now. */
  private addSettleListener(
    ref: Ref,
    listener: (state: 'fulfilled' | 'rejected', value: RV) => void,
  ): void {
    const p = this.promiseOf(ref)
    if (p.state === 'pending') p.listeners.push(listener)
    else listener(p.state, p.value)
  }

  /** `p.then(onF, onR)` / `.catch` / `.finally` — returns the dependent promise. */
  private promiseThen(ref: Ref, onF: FnObject | null, onR: FnObject | null): Ref {
    const child = this.makePromise()
    this.addSettleListener(ref, (state, value) => {
      const handler = state === 'fulfilled' ? onF : onR
      const name = handler?.name || 'anonymous'
      this.enqueueMicrotask('then', 'Promise.then', name, handler?.node ?? this.program, () =>
        this.runReaction(state, value, handler, child),
      )
    })
    return child
  }

  private promiseFinally(ref: Ref, onFinally: FnObject | null): Ref {
    const child = this.makePromise()
    this.addSettleListener(ref, (state, value) => {
      this.enqueueMicrotask('finally', 'Promise.finally', onFinally?.name || 'anonymous', onFinally?.node ?? this.program, () =>
        this.runFinally(state, value, onFinally, child),
      )
    })
    return child
  }

  private *runReaction(
    state: 'fulfilled' | 'rejected',
    value: RV,
    handler: FnObject | null,
    child: Ref,
  ): Generator<Step, void> {
    if (handler == null) {
      // pass-through
      if (state === 'fulfilled') this.resolvePromise(child, value)
      else this.rejectPromise(child, value)
      return
    }
    try {
      const out = yield* this.callAny(handler, [value], handler.node ?? this.program)
      this.resolvePromise(child, out)
    } catch (e) {
      if (e instanceof ThrowSignal) this.rejectPromise(child, e.value)
      else throw e
    }
  }

  private *runFinally(
    state: 'fulfilled' | 'rejected',
    value: RV,
    onFinally: FnObject | null,
    child: Ref,
  ): Generator<Step, void> {
    try {
      if (onFinally) yield* this.callAny(onFinally, [], onFinally.node ?? this.program)
      // finally passes the original settlement through
      if (state === 'fulfilled') this.resolvePromise(child, value)
      else this.rejectPromise(child, value)
    } catch (e) {
      if (e instanceof ThrowSignal) this.rejectPromise(child, e.value)
      else throw e
    }
  }

  /** Wrap a value in a promise for `await` (a promise is returned as-is). */
  private toPromise(v: RV): Ref {
    if (v instanceof Ref && !isNativeId(v.id) && isPromiseObject(this.heap.get(v))) return v
    const ref = this.makePromise()
    this.resolvePromise(ref, v)
    return ref
  }

  // --- function dispatch (sync vs async) ------------------------------------

  /** Call any function value: native, async, or plain. */
  private *callAny(fnObj: FnObject, args: RV[], callNode: ESTree.Node): Generator<Step, RV> {
    if (fnObj.native) return fnObj.native(args)
    if (fnObj.node?.async) return yield* this.runAsyncCall(fnObj, args, callNode)
    return yield* this.callFunction(fnObj, args, callNode)
  }

  /** Run an async function: returns a promise immediately; the body is a coroutine. */
  private *runAsyncCall(fnObj: FnObject, args: RV[], callNode: ESTree.Node): Generator<Step, RV> {
    const resultPromise = this.makePromise()
    const fnNode = fnObj.node!
    const fnEnv = this.newEnv('function', fnObj.closureEnv!, fnObj.name || 'async')
    fnNode.params.forEach((p, i) => {
      if (p.type !== 'Identifier') this.unsupported(p, 'parameter pattern')
      fnEnv.declareOwn((p as ESTree.Identifier).name, 'param', args[i], true)
    })
    const frame: Frame = {
      id: `f${this.frameCounter++}`,
      fnName: fnObj.name || 'async',
      env: fnEnv,
      args,
      calleeNodeId: this.idOf(callNode),
      returning: false,
    }
    this.callStack.push(frame)
    yield* this.emit('call', fnNode, fnEnv)

    const body = this.asyncBody(fnNode, fnEnv)
    yield* this.driveAsync(body, frame, resultPromise, undefined, false)
    return resultPromise
  }

  private *asyncBody(fnNode: ESTree.Function, fnEnv: Environment): Generator<Step, RV> {
    if (fnNode.body.type === 'BlockStatement') {
      this.hoist(fnNode.body.body, fnEnv, fnEnv)
      yield* this.execStatements(fnNode.body.body, fnEnv)
      return undefined
    }
    return yield* this.evalExpr(fnNode.body, fnEnv)
  }

  /** Pump an async body until it awaits, returns, or throws. */
  private *driveAsync(
    body: Generator<Step, RV>,
    frame: Frame,
    resultPromise: Ref,
    input: RV | ThrowSignal,
    throwMode: boolean,
  ): Generator<Step, void> {
    for (;;) {
      let r: IteratorResult<Step, RV>
      try {
        r = throwMode ? body.throw(input) : body.next(input as RV)
      } catch (e) {
        this.popFrame(frame)
        if (e instanceof ReturnSignal) this.resolvePromise(resultPromise, e.value)
        else if (e instanceof ThrowSignal) this.rejectPromise(resultPromise, e.value)
        else throw e
        return
      }
      if (r.done) {
        this.popFrame(frame)
        this.resolvePromise(resultPromise, r.value)
        return
      }
      const y = r.value
      if (y.kind === 'await' && y.promise) {
        // Suspend: the async fn leaves the stack until its awaited promise settles.
        this.popFrame(frame)
        const resumeNode = y.node
        this.addSettleListener(y.promise, (state, value) => {
          this.enqueueMicrotask('await', 'await', frame.fnName, resumeNode, () =>
            this.resumeAsync(body, frame, resultPromise, state, value),
          )
        })
        return
      }
      yield y
      input = undefined
      throwMode = false
    }
  }

  private *resumeAsync(
    body: Generator<Step, RV>,
    frame: Frame,
    resultPromise: Ref,
    state: 'fulfilled' | 'rejected',
    value: RV,
  ): Generator<Step, void> {
    this.callStack.push(frame)
    if (state === 'fulfilled') yield* this.driveAsync(body, frame, resultPromise, value, false)
    else yield* this.driveAsync(body, frame, resultPromise, new ThrowSignal(value), true)
  }

  private popFrame(frame: Frame): void {
    const i = this.callStack.lastIndexOf(frame)
    if (i >= 0) this.callStack.splice(i, 1)
  }

  // --- driver helpers -------------------------------------------------------

  private newEnv(
    kind: Environment['kind'],
    parent: Environment | null,
    name?: string,
  ): Environment {
    const env = new Environment(`e${this.envCounter++}`, kind, parent, name)
    this.envs.push(env)
    return env
  }

  private *emit(kind: StepKind, node: ESTree.Node, env: Environment): Generator<Step, void> {
    yield { kind, node, env }
  }

  private guard(): void {
    if (this.snapshots.length >= this.maxSteps) {
      throw new BudgetExceeded('Step budget exceeded — possible infinite loop')
    }
    if ((this.snapshots.length & 1023) === 0 && Date.now() - this.startTime > this.maxMs) {
      throw new BudgetExceeded('Time budget exceeded — possible infinite loop')
    }
  }

  private idOf(node: ESTree.Node): string {
    return this.meta.get(node)?.id ?? '?'
  }

  private spanOf(node: ESTree.Node): SourceSpan | null {
    return this.meta.get(node)?.span ?? null
  }

  // --- snapshot serialization (structural sharing via rev caches) -----------

  private pushSnapshot(step: Step): void {
    const kind = step.kind as StepKind
    const snap: Snapshot = {
      stepId: this.stepId++,
      kind,
      phase: this.phase,
      clock: this.clock,
      astNodeId: this.idOf(step.node),
      source: this.spanOf(step.node),
      callStack: this.callStack.map((f) => this.frameView(f)),
      activeEnvId: step.env.id,
      environments: this.serializeEnvs(),
      heap: this.serializeHeap(),
      webApis: this.webApis.map((t) => this.webApiView(t)),
      macrotaskQueue: this.macrotaskQueue.map((j) => this.taskView(j)),
      microtaskQueue: this.microtaskQueue.map((m) => this.microView(m)),
      console: this.console.slice(),
      explain: this.explainFor(kind),
    }
    this.snapshots.push(snap)
  }

  private microView(m: MicroJob): TaskView {
    return { id: m.id, label: m.label, callbackName: m.callbackName }
  }

  private explainFor(kind: StepKind): string | undefined {
    if (kind === 'microtask') {
      return this.macrotaskQueue.length > 0 || this.webApis.length > 0
        ? 'Microtasks drain completely before the next macrotask runs.'
        : 'Running a microtask (promise reaction / await continuation).'
    }
    if (kind === 'timer') return 'Timer elapsed → its callback is queued as a macrotask.'
    if (kind === 'task') return 'The call stack is empty, so the next queued callback runs.'
    return undefined
  }

  private webApiView(t: Timer): WebApiView {
    return {
      id: t.id,
      kind: t.kind,
      label: t.kind === 'interval' ? 'setInterval' : 'setTimeout',
      delay: t.delay,
      callbackName: t.cb.name || 'anonymous',
    }
  }

  private taskView(j: Job): TaskView {
    return {
      id: j.id,
      label: j.source === 'interval' ? 'setInterval' : 'setTimeout',
      callbackName: j.callbackName,
    }
  }

  private serializeEnvs(): Record<string, EnvView> {
    const out: Record<string, EnvView> = {}
    for (const env of this.envs) out[env.id] = this.serializeEnv(env)
    return out
  }

  private serializeEnv(env: Environment): EnvView {
    const cached = this.envViewCache.get(env.id)
    if (cached && cached.rev === env.rev) return cached.view
    const bindings: BindingView[] = []
    let cacheable = true
    for (const [name, b] of env.bindings) {
      if (b.initialized && this.reprVolatile(b.value)) cacheable = false
      bindings.push({
        name,
        value: b.initialized ? this.valueView(b.value) : null,
        initialized: b.initialized,
        declaredAs: b.kind,
        builtin: b.builtin ?? false,
      })
    }
    const view: EnvView = {
      id: env.id,
      kind: env.kind,
      name: env.name,
      parentId: env.parent?.id ?? null,
      bindings,
    }
    // Only cache when no binding embeds another object's mutable state in its
    // repr (arrays/promises), since env.rev doesn't bump when that target
    // mutates — a cached view would go stale and corrupt time-travel.
    if (cacheable) this.envViewCache.set(env.id, { rev: env.rev, view })
    return view
  }

  /**
   * True when a value's serialized `repr` depends on ANOTHER object's mutable
   * state — i.e. a ref to a heap array (`[…N]`) or promise (`Promise <state>`).
   * Object (`{…}`) and function (`ƒ name`) reprs are stable, so they don't count.
   */
  private reprVolatile(v: RV): boolean {
    if (!(v instanceof Ref) || isNativeId(v.id)) return false
    const kind = this.heap.get(v).kind
    return kind === 'array' || kind === 'promise'
  }

  private serializeHeap(): Record<string, HeapNodeView> {
    const out: Record<string, HeapNodeView> = {}
    for (const obj of this.heap.all()) out[obj.id] = this.heapView(obj)
    return out
  }

  private heapView(obj: HeapObject): HeapNodeView {
    const cached = this.heapViewCache.get(obj.id)
    if (cached && cached.rev === obj.rev) return cached.view
    let view: HeapNodeView
    let cacheable = true
    if (obj.kind === 'object') {
      cacheable = ![...obj.props.values()].some((v) => this.reprVolatile(v))
      view = {
        id: obj.id,
        kind: 'object',
        entries: [...obj.props].map(([key, value]) => ({ key, value: this.valueView(value) })),
      }
    } else if (obj.kind === 'array') {
      cacheable = !obj.elements.some((v) => this.reprVolatile(v))
      view = { id: obj.id, kind: 'array', elements: obj.elements.map((v) => this.valueView(v)) }
    } else if (obj.kind === 'promise') {
      cacheable = !this.reprVolatile(obj.value)
      view = { id: obj.id, kind: 'promise', state: obj.state, value: this.valueView(obj.value) }
    } else {
      view = {
        id: obj.id,
        kind: 'function',
        name: obj.name,
        closureEnvId: obj.closureEnv?.id ?? null,
      }
    }
    // Skip caching when an entry/element embeds a mutable array/promise repr,
    // since this object's rev doesn't bump when that referenced target mutates.
    if (cacheable) this.heapViewCache.set(obj.id, { rev: obj.rev, view })
    return view
  }

  private frameView(f: Frame): FrameView {
    return {
      id: f.id,
      fnName: f.fnName,
      envId: f.env.id,
      args: f.args.map((a) => this.valueView(a)),
      returnValue: f.returning ? this.valueView(f.returnValue) : undefined,
      calleeNodeId: f.calleeNodeId,
    }
  }

  private valueView(v: RV): ValueView {
    if (v instanceof Ref) return { kind: 'ref', refId: v.id, repr: this.refRepr(v) }
    const t = typeOf(v) as 'number' | 'string' | 'boolean' | 'undefined' | 'null'
    return { kind: 'primitive', type: t, repr: this.primRepr(v) }
  }

  private primRepr(v: RV): string {
    if (typeof v === 'string') return JSON.stringify(v)
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    return String(v)
  }

  private refRepr(ref: Ref): string {
    if (isNativeId(ref.id)) return nativeName(ref.id)
    const o = this.heap.get(ref)
    if (o.kind === 'function') return `ƒ ${o.name || 'anonymous'}`
    if (o.kind === 'array') return `[…${o.elements.length}]`
    if (o.kind === 'promise') return `Promise <${o.state}>`
    return '{…}'
  }

  // --- statements -----------------------------------------------------------

  private *execProgram(program: ESTree.Program, env: Environment): Generator<Step, void> {
    // sourceType is 'script', so the body is plain statements (no import/export)
    const body = program.body as ESTree.Statement[]
    this.hoist(body, env, env)
    yield* this.emit('program', program, env)
    yield* this.execStatements(body, env)
  }

  private *execStatements(stmts: ESTree.Statement[], env: Environment): Generator<Step, void> {
    for (const s of stmts) yield* this.execStatement(s, env)
  }

  private *execStatement(node: ESTree.Statement, env: Environment): Generator<Step, void> {
    switch (node.type) {
      case 'VariableDeclaration': {
        yield* this.emit('statement', node, env)
        for (const decl of node.declarations) {
          if (decl.id.type !== 'Identifier') {
            this.unsupported(decl.id, 'destructuring declaration')
          }
          const value = decl.init ? yield* this.evalExpr(decl.init, env) : undefined
          this.initBinding(env, decl.id.name, value)
        }
        return
      }
      case 'FunctionDeclaration':
        // already hoisted (bound to a function value); nothing to execute
        return
      case 'ExpressionStatement': {
        yield* this.emit('statement', node, env)
        yield* this.evalExpr(node.expression, env)
        return
      }
      case 'BlockStatement': {
        const blockEnv = this.newEnv('block', env)
        this.hoist(node.body, blockEnv, blockEnv.functionScope())
        yield* this.execStatements(node.body, blockEnv)
        return
      }
      case 'EmptyStatement':
        return
      case 'IfStatement': {
        yield* this.emit('statement', node, env)
        const test = yield* this.evalExpr(node.test, env)
        if (this.truthy(test)) {
          yield* this.execStatement(node.consequent, env)
        } else if (node.alternate) {
          yield* this.execStatement(node.alternate, env)
        }
        return
      }
      case 'WhileStatement': {
        for (;;) {
          yield* this.emit('statement', node, env)
          const test = yield* this.evalExpr(node.test, env)
          if (!this.truthy(test)) break
          try {
            yield* this.execStatement(node.body, env)
          } catch (e) {
            if (e instanceof BreakSignal) break
            if (e instanceof ContinueSignal) continue
            throw e
          }
        }
        return
      }
      case 'DoWhileStatement': {
        for (;;) {
          yield* this.emit('statement', node, env)
          try {
            yield* this.execStatement(node.body, env)
          } catch (e) {
            if (e instanceof BreakSignal) break
            if (!(e instanceof ContinueSignal)) throw e
          }
          const test = yield* this.evalExpr(node.test, env)
          if (!this.truthy(test)) break
        }
        return
      }
      case 'ForStatement': {
        yield* this.execFor(node, env)
        return
      }
      case 'ForOfStatement': {
        yield* this.execForOf(node, env)
        return
      }
      case 'ReturnStatement': {
        yield* this.emit('statement', node, env)
        const value = node.argument ? yield* this.evalExpr(node.argument, env) : undefined
        throw new ReturnSignal(value)
      }
      case 'BreakStatement':
        yield* this.emit('statement', node, env)
        throw new BreakSignal()
      case 'ContinueStatement':
        yield* this.emit('statement', node, env)
        throw new ContinueSignal()
      case 'ThrowStatement': {
        yield* this.emit('statement', node, env)
        const value = yield* this.evalExpr(node.argument, env)
        this.lastErrorNode = node
        throw new ThrowSignal(value)
      }
      case 'TryStatement': {
        yield* this.emit('statement', node, env)
        try {
          try {
            yield* this.execStatement(node.block, env)
          } catch (e) {
            if (e instanceof ThrowSignal && node.handler) {
              const catchEnv = this.newEnv('block', env)
              if (node.handler.param && node.handler.param.type === 'Identifier') {
                catchEnv.declareOwn(node.handler.param.name, 'let', e.value, true)
              }
              yield* this.execStatement(node.handler.body, catchEnv)
            } else {
              throw e
            }
          }
        } finally {
          if (node.finalizer) yield* this.execStatement(node.finalizer, env)
        }
        return
      }
      default:
        this.unsupported(node, 'statement')
    }
  }

  private *execFor(node: ESTree.ForStatement, env: Environment): Generator<Step, void> {
    const forEnv = this.newEnv('block', env)
    let perIteration = false
    if (node.init) {
      if (node.init.type === 'VariableDeclaration') {
        this.hoist([node.init], forEnv, forEnv.functionScope())
        yield* this.execStatement(node.init, forEnv)
        perIteration = node.init.kind === 'let' || node.init.kind === 'const'
      } else {
        yield* this.evalExpr(node.init, forEnv)
      }
    }
    let iterEnv = perIteration ? this.copyEnv(forEnv, env) : forEnv
    for (;;) {
      yield* this.emit('statement', node, iterEnv)
      if (node.test) {
        const test = yield* this.evalExpr(node.test, iterEnv)
        if (!this.truthy(test)) break
      }
      try {
        yield* this.execStatement(node.body, iterEnv)
      } catch (e) {
        if (e instanceof BreakSignal) break
        if (!(e instanceof ContinueSignal)) throw e
      }
      if (perIteration) iterEnv = this.copyEnv(iterEnv, env)
      if (node.update) yield* this.evalExpr(node.update, iterEnv)
    }
  }

  private *execForOf(node: ESTree.ForOfStatement, env: Environment): Generator<Step, void> {
    const right = yield* this.evalExpr(node.right, env)
    const items = this.iterableValues(right, node.right)
    for (const item of items) {
      const iterEnv = this.newEnv('block', env)
      if (node.left.type === 'VariableDeclaration') {
        const id = node.left.declarations[0]?.id
        if (id?.type !== 'Identifier') this.unsupported(node.left, 'for-of binding')
        iterEnv.declareOwn(
          (id as ESTree.Identifier).name,
          node.left.kind as 'var' | 'let' | 'const',
          item,
          true,
        )
      } else if (node.left.type === 'Identifier') {
        this.setVar(node.left.name, item, env, node.left)
      } else {
        this.unsupported(node.left, 'for-of target')
      }
      yield* this.emit('statement', node, iterEnv)
      try {
        yield* this.execStatement(node.body, iterEnv)
      } catch (e) {
        if (e instanceof BreakSignal) break
        if (!(e instanceof ContinueSignal)) throw e
      }
    }
  }

  // --- expressions ----------------------------------------------------------

  private *evalExpr(node: ESTree.Expression, env: Environment): Generator<Step, RV> {
    switch (node.type) {
      case 'Literal': {
        const v = node.value
        if (typeof v === 'object' && v !== null) this.unsupported(node, 'literal (regex/bigint)')
        return v as RV
      }
      case 'Identifier':
        return this.getVar(node.name, env, node)
      case 'ThisExpression':
        return undefined
      case 'TemplateLiteral': {
        let out = ''
        for (let i = 0; i < node.quasis.length; i++) {
          out += node.quasis[i].value.cooked ?? ''
          if (i < node.expressions.length) {
            out += this.toStr(yield* this.evalExpr(node.expressions[i], env))
          }
        }
        return out
      }
      case 'ArrayExpression': {
        const elements: RV[] = []
        for (const el of node.elements) {
          if (el === null) elements.push(undefined)
          else if (el.type === 'SpreadElement') this.unsupported(el, 'spread element')
          else elements.push(yield* this.evalExpr(el, env))
        }
        return this.heap.allocArray(elements)
      }
      case 'ObjectExpression': {
        const ref = this.heap.allocObject()
        const obj = this.heap.get(ref)
        if (obj.kind !== 'object') throw new Error('unreachable')
        for (const prop of node.properties) {
          if (prop.type !== 'Property') this.unsupported(prop, 'object spread')
          const key = this.propertyKeyName(prop)
          const value = yield* this.evalExpr(prop.value as ESTree.Expression, env)
          obj.props.set(key, value)
        }
        obj.rev++
        return ref
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionExpression' && node.id) {
          // Named function expression: bind its own name (read-only) in a
          // wrapper scope that's the function's closure env, so the body can
          // recurse by that name without leaking it to the enclosing scope.
          const wrapper = this.newEnv('block', env, node.id.name)
          const ref = this.heap.allocFunction(node.id.name, node, wrapper)
          wrapper.declareOwn(node.id.name, 'const', ref, true)
          return ref
        }
        return this.heap.allocFunction('', node, env)
      }
      case 'UnaryExpression':
        return yield* this.evalUnary(node, env)
      case 'UpdateExpression':
        return yield* this.evalUpdate(node, env)
      case 'BinaryExpression': {
        if (node.operator === 'in') {
          const key = yield* this.evalExpr(node.left as ESTree.Expression, env)
          const obj = yield* this.evalExpr(node.right, env)
          return this.inOperator(key, obj, node)
        }
        if (node.operator === 'instanceof') {
          this.unsupported(node, "operator 'instanceof'")
        }
        const left = yield* this.evalExpr(node.left as ESTree.Expression, env)
        const right = yield* this.evalExpr(node.right, env)
        return this.binary(node.operator, left, right)
      }
      case 'LogicalExpression': {
        const left = yield* this.evalExpr(node.left, env)
        if (node.operator === '&&') return this.truthy(left) ? yield* this.evalExpr(node.right, env) : left
        if (node.operator === '||') return this.truthy(left) ? left : yield* this.evalExpr(node.right, env)
        // ??
        return left === null || left === undefined ? yield* this.evalExpr(node.right, env) : left
      }
      case 'ConditionalExpression': {
        const test = yield* this.evalExpr(node.test, env)
        return this.truthy(test)
          ? yield* this.evalExpr(node.consequent, env)
          : yield* this.evalExpr(node.alternate, env)
      }
      case 'AssignmentExpression':
        return yield* this.evalAssignment(node, env)
      case 'SequenceExpression': {
        let result: RV = undefined
        for (const expr of node.expressions) result = yield* this.evalExpr(expr, env)
        return result
      }
      case 'MemberExpression': {
        const { obj, key } = yield* this.resolveMember(node, env)
        return this.readMember(obj, key, node)
      }
      case 'CallExpression':
        return yield* this.evalCall(node, env)
      case 'NewExpression':
        return yield* this.evalNew(node, env)
      case 'AwaitExpression': {
        const v = yield* this.evalExpr(node.argument, env)
        const p = this.toPromise(v)
        const settled = (yield { kind: 'await', node, env, promise: p }) as RV
        return settled
      }
      default:
        this.unsupported(node, 'expression')
    }
  }

  private *evalNew(node: ESTree.NewExpression, env: Environment): Generator<Step, RV> {
    const callee = node.callee
    if (callee.type === 'Super') this.unsupported(callee, 'new super')
    const fn = yield* this.evalExpr(callee as ESTree.Expression, env)
    if (fn instanceof Ref && fn.id === PROMISE_ID) {
      const executor = (yield* this.evalArgs(node.arguments, env))[0]
      return yield* this.newPromise(executor, node)
    }
    this.unsupported(node, 'new (only `new Promise` is supported)')
  }

  private *newPromise(executor: RV, node: ESTree.Node): Generator<Step, RV> {
    if (!(executor instanceof Ref) || isNativeId(executor.id) || this.heap.get(executor).kind !== 'function') {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', 'Promise executor must be a function')
    }
    const executorFn = this.heap.get(executor) as FnObject
    const promiseRef = this.makePromise()
    const resolveFn = this.heap.allocNativeFunction('resolve', (a) => {
      this.resolvePromise(promiseRef, a[0])
      return undefined
    })
    const rejectFn = this.heap.allocNativeFunction('reject', (a) => {
      this.rejectPromise(promiseRef, a[0])
      return undefined
    })
    try {
      yield* this.callAny(executorFn, [resolveFn, rejectFn], node)
    } catch (e) {
      if (e instanceof ThrowSignal) this.rejectPromise(promiseRef, e.value)
      else throw e
    }
    return promiseRef
  }

  private callPromiseMethod(ref: Ref, key: 'then' | 'catch' | 'finally', args: RV[]): RV {
    const asFn = (v: RV): FnObject | null => {
      if (v instanceof Ref && !isNativeId(v.id)) {
        const o = this.heap.get(v)
        if (o.kind === 'function') return o
      }
      return null
    }
    if (key === 'then') return this.promiseThen(ref, asFn(args[0]), asFn(args[1]))
    if (key === 'catch') return this.promiseThen(ref, null, asFn(args[0]))
    return this.promiseFinally(ref, asFn(args[0]))
  }

  private *callVoid(fnObj: FnObject, node: ESTree.Node): Generator<Step, void> {
    yield* this.callAny(fnObj, [], node)
  }

  private *evalUnary(node: ESTree.UnaryExpression, env: Environment): Generator<Step, RV> {
    if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
      // typeof on an undeclared name must not throw
      const target = env.resolve(node.argument.name)
      if (!target) return 'undefined'
    }
    const v = yield* this.evalExpr(node.argument, env)
    switch (node.operator) {
      case '!':
        return !this.truthy(v)
      case '-':
        return -this.toNum(v)
      case '+':
        return this.toNum(v)
      case 'typeof':
        return this.jsTypeof(v)
      case 'void':
        return undefined
      default:
        this.unsupported(node, `unary '${node.operator}'`)
    }
  }

  private *evalUpdate(node: ESTree.UpdateExpression, env: Environment): Generator<Step, RV> {
    const delta = node.operator === '++' ? 1 : -1
    const arg = node.argument
    if (arg.type === 'Identifier') {
      const old = this.toNum(this.getVar(arg.name, env, arg))
      const next = old + delta
      this.setVar(arg.name, next, env, arg)
      return node.prefix ? next : old
    }
    if (arg.type === 'MemberExpression') {
      const { obj, key } = yield* this.resolveMember(arg, env)
      const old = this.toNum(this.readMember(obj, key, arg))
      const next = old + delta
      this.writeMember(obj, key, next, arg)
      return node.prefix ? next : old
    }
    this.unsupported(arg, 'update target')
  }

  private *evalAssignment(node: ESTree.AssignmentExpression, env: Environment): Generator<Step, RV> {
    const target = node.left
    if (node.operator === '=') {
      const value = yield* this.evalExpr(node.right as ESTree.Expression, env)
      yield* this.assign(target, value, env)
      return value
    }
    // Logical assignment (||=, &&=, ??=) — short-circuits: read the target,
    // and only evaluate + assign the RHS when the operator calls for it.
    if (node.operator === '||=' || node.operator === '&&=' || node.operator === '??=') {
      return yield* this.logicalAssign(node, env)
    }
    // compound assignment (+=, -=, ...)
    const op = node.operator.slice(0, -1)
    const rhs = yield* this.evalExpr(node.right as ESTree.Expression, env)
    if (target.type === 'Identifier') {
      const cur = this.getVar(target.name, env, target)
      const value = this.binary(op, cur, rhs)
      this.setVar(target.name, value, env, target)
      return value
    }
    if (target.type === 'MemberExpression') {
      const { obj, key } = yield* this.resolveMember(target, env)
      const cur = this.readMember(obj, key, target)
      const value = this.binary(op, cur, rhs)
      this.writeMember(obj, key, value, target)
      return value
    }
    this.unsupported(target, 'assignment target')
  }

  private *logicalAssign(
    node: ESTree.AssignmentExpression,
    env: Environment,
  ): Generator<Step, RV> {
    const target = node.left
    const shouldAssign = (cur: RV): boolean =>
      node.operator === '||='
        ? !this.truthy(cur)
        : node.operator === '&&='
          ? this.truthy(cur)
          : cur === null || cur === undefined // ??=
    if (target.type === 'Identifier') {
      const cur = this.getVar(target.name, env, target)
      if (!shouldAssign(cur)) return cur
      const value = yield* this.evalExpr(node.right as ESTree.Expression, env)
      this.setVar(target.name, value, env, target)
      return value
    }
    if (target.type === 'MemberExpression') {
      const { obj, key } = yield* this.resolveMember(target, env)
      const cur = this.readMember(obj, key, target)
      if (!shouldAssign(cur)) return cur
      const value = yield* this.evalExpr(node.right as ESTree.Expression, env)
      this.writeMember(obj, key, value, target)
      return value
    }
    this.unsupported(target, 'assignment target')
  }

  private *assign(
    target: ESTree.Pattern | ESTree.Expression,
    value: RV,
    env: Environment,
  ): Generator<Step, void> {
    if (target.type === 'Identifier') {
      this.setVar(target.name, value, env, target)
      return
    }
    if (target.type === 'MemberExpression') {
      const { obj, key } = yield* this.resolveMember(target, env)
      this.writeMember(obj, key, value, target)
      return
    }
    this.unsupported(target, 'assignment target')
  }

  private *evalCall(node: ESTree.CallExpression, env: Environment): Generator<Step, RV> {
    const callee = node.callee
    if (callee.type === 'Super') this.unsupported(callee, 'super call')
    if (callee.type === 'MemberExpression') {
      const { obj, key } = yield* this.resolveMember(callee, env)
      // console.* — runs as a native frame on the call stack
      if (obj instanceof Ref && obj.id === CONSOLE_ID && typeof key === 'string') {
        const args = yield* this.evalArgs(node.arguments, env)
        return yield* this.runBuiltin(`console.${key}`, args, node, env, () => {
          this.doConsole(key, args, node)
          return undefined
        })
      }
      // Promise statics: Promise.resolve / Promise.reject
      if (obj instanceof Ref && obj.id === PROMISE_ID && typeof key === 'string') {
        const args = yield* this.evalArgs(node.arguments, env)
        return yield* this.runBuiltin(`Promise.${key}`, args, node, env, () => {
          if (key === 'resolve') {
            const a = args[0]
            // Promise.resolve(promise) returns the same promise (identity) — no
            // new wrapper, no adoption ticks.
            if (a instanceof Ref && !isNativeId(a.id) && isPromiseObject(this.heap.get(a))) return a
            const p = this.makePromise()
            this.resolvePromise(p, a)
            return p
          }
          if (key === 'reject') {
            const p = this.makePromise()
            this.rejectPromise(p, args[0])
            return p
          }
          this.lastErrorNode = callee
          throw this.makeThrow('TypeError', `Promise.${key} is not supported yet`)
        })
      }
      if (obj instanceof Ref && !isNativeId(obj.id) && typeof key === 'string') {
        const h = this.heap.get(obj)
        // a couple of array methods, since we don't model prototype methods
        if (h.kind === 'array' && (key === 'push' || key === 'pop')) {
          const args = yield* this.evalArgs(node.arguments, env)
          return yield* this.runBuiltin(`Array.${key}`, args, node, env, () =>
            this.arrayMethod(h, key, args),
          )
        }
        // promise instance methods
        if (h.kind === 'promise' && (key === 'then' || key === 'catch' || key === 'finally')) {
          const args = yield* this.evalArgs(node.arguments, env)
          return yield* this.runBuiltin(`Promise.${key}`, args, node, env, () =>
            this.callPromiseMethod(obj, key, args),
          )
        }
      }
      const fn = this.readMember(obj, key, callee)
      const args = yield* this.evalArgs(node.arguments, env)
      return yield* this.invoke(fn, args, node)
    }
    const fn = yield* this.evalExpr(callee, env)
    const args = yield* this.evalArgs(node.arguments, env)
    // native built-ins (setTimeout, …) are opaque @-refs — run as a native frame
    if (fn instanceof Ref && isNativeId(fn.id)) {
      return yield* this.runBuiltin(nativeName(fn.id), args, node, env, () =>
        this.callNative(fn.id as string, args, node),
      )
    }
    return yield* this.invoke(fn, args, node)
  }

  /**
   * Run a host built-in (console, timers, Promise.*, …) as a transient frame on
   * the call stack — pushed, shown for its step, then popped — mirroring how a
   * real engine momentarily has a native frame on the stack.
   */
  private *runBuiltin(
    name: string,
    args: RV[],
    node: ESTree.Node,
    env: Environment,
    exec: () => RV,
  ): Generator<Step, RV> {
    const frame: Frame = {
      id: `f${this.frameCounter++}`,
      fnName: name,
      env,
      args,
      calleeNodeId: this.idOf(node),
      returning: false,
    }
    this.callStack.push(frame)
    let result: RV
    try {
      result = exec()
    } catch (e) {
      this.callStack.pop()
      throw e
    }
    // A built-in runs in a single combined step: it briefly appears on the call
    // stack (with its result) rather than emitting separate call + return steps.
    frame.returnValue = result
    frame.returning = true
    yield* this.emit('return', node, env)
    this.callStack.pop()
    return result
  }

  private *evalArgs(
    args: Array<ESTree.Expression | ESTree.SpreadElement>,
    env: Environment,
  ): Generator<Step, RV[]> {
    const out: RV[] = []
    for (const a of args) {
      if (a.type === 'SpreadElement') this.unsupported(a, 'spread argument')
      out.push(yield* this.evalExpr(a, env))
    }
    return out
  }

  private *invoke(fn: RV, args: RV[], callNode: ESTree.CallExpression): Generator<Step, RV> {
    if (!(fn instanceof Ref)) {
      this.lastErrorNode = callNode
      throw this.makeThrow('TypeError', `${this.primRepr(fn)} is not a function`)
    }
    const obj = this.heap.get(fn)
    if (obj.kind !== 'function') {
      this.lastErrorNode = callNode
      throw this.makeThrow('TypeError', `${this.refRepr(fn)} is not a function`)
    }
    return yield* this.callAny(obj, args, callNode)
  }

  private *callFunction(
    fnObj: FnObject,
    args: RV[],
    callNode: ESTree.Node,
  ): Generator<Step, RV> {
    const fnNode = fnObj.node!
    const fnEnv = this.newEnv('function', fnObj.closureEnv ?? null, fnObj.name || 'anonymous')
    fnNode.params.forEach((p, i) => {
      if (p.type !== 'Identifier') this.unsupported(p, 'parameter pattern')
      fnEnv.declareOwn((p as ESTree.Identifier).name, 'param', args[i], true)
    })

    const frame: Frame = {
      id: `f${this.frameCounter++}`,
      fnName: fnObj.name || 'anonymous',
      env: fnEnv,
      args,
      calleeNodeId: this.idOf(callNode),
      returning: false,
    }
    this.callStack.push(frame)
    yield* this.emit('call', fnNode, fnEnv)

    let result: RV = undefined
    try {
      if (fnNode.body.type === 'BlockStatement') {
        this.hoist(fnNode.body.body, fnEnv, fnEnv)
        yield* this.execStatements(fnNode.body.body, fnEnv)
      } else {
        result = yield* this.evalExpr(fnNode.body, fnEnv)
      }
    } catch (e) {
      if (e instanceof ReturnSignal) {
        result = e.value
      } else {
        this.callStack.pop()
        throw e
      }
    }

    frame.returnValue = result
    frame.returning = true
    yield* this.emit('return', fnNode, fnEnv)
    this.callStack.pop()
    return result
  }

  // --- members --------------------------------------------------------------

  private *resolveMember(
    node: ESTree.MemberExpression,
    env: Environment,
  ): Generator<Step, { obj: RV; key: string | number }> {
    const obj = yield* this.evalExpr(node.object as ESTree.Expression, env)
    let key: string | number
    if (node.computed) {
      const k = yield* this.evalExpr(node.property as ESTree.Expression, env)
      key = typeof k === 'number' ? k : this.toStr(k)
    } else {
      key = (node.property as ESTree.Identifier).name
    }
    return { obj, key }
  }

  private readMember(obj: RV, key: string | number, node: ESTree.Node): RV {
    if (typeof obj === 'string') {
      if (key === 'length') return obj.length
      const i = Number(key)
      return Number.isInteger(i) ? (obj[i] ?? undefined) : undefined
    }
    if (obj instanceof Ref) {
      if (isNativeId(obj.id)) return undefined
      const h = this.heap.get(obj)
      if (h.kind === 'array') {
        if (key === 'length') return h.elements.length
        const i = Number(key)
        return Number.isInteger(i) ? (h.elements[i] ?? undefined) : undefined
      }
      if (h.kind === 'object') return h.props.get(String(key)) ?? undefined
      if (h.kind === 'function') {
        if (key === 'name') return h.name
        if (key === 'length') return h.node?.params.length ?? 0
        return undefined
      }
    }
    if (obj === null || obj === undefined) {
      this.lastErrorNode = node
      throw this.makeThrow(
        'TypeError',
        `Cannot read properties of ${this.primRepr(obj)} (reading '${key}')`,
      )
    }
    return undefined
  }

  private writeMember(obj: RV, key: string | number, value: RV, node: ESTree.Node): void {
    if (!(obj instanceof Ref) || isNativeId(obj.id)) {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', `Cannot set properties of ${this.primRepr(obj)}`)
    }
    const h = this.heap.get(obj)
    if (h.kind === 'array') {
      const i = Number(key)
      if (Number.isInteger(i) && i >= 0) {
        h.elements[i] = value
        h.rev++
        return
      }
      if (key === 'length') {
        h.elements.length = this.toNum(value)
        h.rev++
        return
      }
    }
    if (h.kind === 'object') {
      h.props.set(String(key), value)
      h.rev++
      return
    }
    // functions: ignore property writes in the teaching subset
  }

  private arrayMethod(h: Extract<HeapObject, { kind: 'array' }>, key: 'push' | 'pop', args: RV[]): RV {
    if (key === 'push') {
      h.elements.push(...args)
      h.rev++
      return h.elements.length
    }
    const v = h.elements.pop()
    h.rev++
    return v
  }

  // --- variables & hoisting -------------------------------------------------

  private getVar(name: string, env: Environment, node: ESTree.Node): RV {
    const target = env.resolve(name)
    if (!target) {
      this.lastErrorNode = node
      const hint = FUTURE_GLOBALS[name]
      const message = hint
        ? `${name} is not supported yet (arrives in ${hint})`
        : `${name} is not defined`
      throw this.makeThrow('ReferenceError', message)
    }
    const b = target.bindings.get(name)!
    if (!b.initialized) {
      this.lastErrorNode = node
      throw this.makeThrow('ReferenceError', `Cannot access '${name}' before initialization`)
    }
    return b.value
  }

  private setVar(name: string, value: RV, env: Environment, node: ESTree.Node): void {
    const target = env.resolve(name)
    if (!target) {
      this.lastErrorNode = node
      throw this.makeThrow('ReferenceError', `${name} is not defined`)
    }
    const b = target.bindings.get(name)!
    if (b.kind === 'const' && b.initialized) {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', 'Assignment to constant variable.')
    }
    if (!b.initialized) {
      this.lastErrorNode = node
      throw this.makeThrow('ReferenceError', `Cannot access '${name}' before initialization`)
    }
    b.value = value
    b.initialized = true
    target.rev++
  }

  private initBinding(env: Environment, name: string, value: RV): void {
    const target = env.resolve(name)
    if (!target) {
      // shouldn't happen (hoisted), but be safe
      env.declareOwn(name, 'var', value, true)
      return
    }
    const b = target.bindings.get(name)!
    b.value = value
    b.initialized = true
    target.rev++
  }

  /** Hoist function declarations + `let`/`const` (TDZ) into `blockEnv`; `var` into `fnScope`. */
  private hoist(stmts: ESTree.Statement[], blockEnv: Environment, fnScope: Environment): void {
    for (const s of stmts) {
      if (s.type === 'FunctionDeclaration' && s.id) {
        const ref = this.heap.allocFunction(s.id.name, s, blockEnv)
        blockEnv.declareOwn(s.id.name, 'fn', ref, true)
      }
    }
    for (const name of this.collectVarNames(stmts)) {
      if (!fnScope.hasOwn(name)) fnScope.declareOwn(name, 'var', undefined, true)
    }
    for (const s of stmts) {
      if (s.type === 'VariableDeclaration' && (s.kind === 'let' || s.kind === 'const')) {
        for (const d of s.declarations) {
          if (d.id.type === 'Identifier' && !blockEnv.hasOwn(d.id.name)) {
            blockEnv.declareOwn(d.id.name, s.kind, undefined, false)
          }
        }
      }
    }
  }

  private collectVarNames(stmts: ESTree.Statement[]): string[] {
    const names: string[] = []
    const visit = (s: ESTree.Statement): void => {
      switch (s.type) {
        case 'VariableDeclaration':
          if (s.kind === 'var') {
            for (const d of s.declarations) if (d.id.type === 'Identifier') names.push(d.id.name)
          }
          break
        case 'BlockStatement':
          s.body.forEach(visit)
          break
        case 'IfStatement':
          visit(s.consequent)
          if (s.alternate) visit(s.alternate)
          break
        case 'ForStatement':
          if (s.init && s.init.type === 'VariableDeclaration') visit(s.init)
          visit(s.body)
          break
        case 'ForOfStatement':
        case 'ForInStatement':
          if (s.left.type === 'VariableDeclaration') visit(s.left)
          visit(s.body)
          break
        case 'WhileStatement':
        case 'DoWhileStatement':
          visit(s.body)
          break
        case 'TryStatement':
          visit(s.block)
          if (s.handler) visit(s.handler.body)
          if (s.finalizer) visit(s.finalizer)
          break
        default:
          break
      }
    }
    stmts.forEach(visit)
    return names
  }

  private copyEnv(src: Environment, parent: Environment): Environment {
    const copy = this.newEnv('block', parent)
    for (const [name, b] of src.bindings) {
      copy.declareOwn(name, b.kind, b.value, b.initialized)
    }
    return copy
  }

  // --- operators & coercion -------------------------------------------------

  private binary(op: string, l: RV, r: RV): RV {
    switch (op) {
      case '+': {
        // ToPrimitive both sides first: if either becomes a string, concatenate;
        // otherwise add numerically. This is why `{} + 1` is "[object Object]1"
        // and `"" + [1,2,3]` is "1,2,3".
        const lp = this.toPrimitive(l)
        const rp = this.toPrimitive(r)
        if (typeof lp === 'string' || typeof rp === 'string') return this.toStr(lp) + this.toStr(rp)
        return this.toNum(lp) + this.toNum(rp)
      }
      case '-':
        return this.toNum(l) - this.toNum(r)
      case '*':
        return this.toNum(l) * this.toNum(r)
      case '/':
        return this.toNum(l) / this.toNum(r)
      case '%':
        return this.toNum(l) % this.toNum(r)
      case '**':
        return this.toNum(l) ** this.toNum(r)
      case '===':
        return this.strictEquals(l, r)
      case '!==':
        return !this.strictEquals(l, r)
      case '==':
        return this.looseEquals(l, r)
      case '!=':
        return !this.looseEquals(l, r)
      case '<':
      case '>':
      case '<=':
      case '>=':
        return this.relational(op as '<' | '>' | '<=' | '>=', l, r)
      case '&':
        return this.toNum(l) & this.toNum(r)
      case '|':
        return this.toNum(l) | this.toNum(r)
      case '^':
        return this.toNum(l) ^ this.toNum(r)
      case '<<':
        return this.toNum(l) << this.toNum(r)
      case '>>':
        return this.toNum(l) >> this.toNum(r)
      case '>>>':
        return this.toNum(l) >>> this.toNum(r)
      default:
        // Safety net — `in`/`instanceof` are handled at the BinaryExpression
        // level; anything else surfaces as a normal thrown error, not a leak.
        throw this.makeThrow('SyntaxError', `Unsupported operator: ${op}`)
    }
  }

  private strictEquals(l: RV, r: RV): boolean {
    if (l instanceof Ref && r instanceof Ref) return l.id === r.id
    if (l instanceof Ref || r instanceof Ref) return false
    return l === r
  }

  private looseEquals(l: RV, r: RV): boolean {
    const lRef = l instanceof Ref
    const rRef = r instanceof Ref
    // object == object → reference identity
    if (lRef && rRef) return this.strictEquals(l, r)
    if (lRef || rRef) {
      const ref = lRef ? l : r
      const other = lRef ? r : l
      // object == null/undefined is false (no coercion); otherwise ToPrimitive
      // the object and loose-compare, so `[1] == 1` is true and `{} == 1` false.
      if (other === null || other === undefined) return false
      return this.looseEquals(this.toPrimitive(ref), other)
    }
    // both primitives — defer to JS loose equality
    return l == r
  }

  /**
   * Relational comparison. Strings compare lexically; otherwise both sides
   * coerce to numbers. Computing each operator directly (rather than folding a
   * 3-way ordering) means any `NaN` operand correctly yields `false`.
   */
  private relational(op: '<' | '>' | '<=' | '>=', l: RV, r: RV): boolean {
    const lp = this.toPrimitive(l)
    const rp = this.toPrimitive(r)
    let a: number | string
    let b: number | string
    if (typeof lp === 'string' && typeof rp === 'string') {
      a = lp
      b = rp
    } else {
      a = this.toNum(lp)
      b = this.toNum(rp)
    }
    switch (op) {
      case '<':
        return a < b
      case '>':
        return a > b
      case '<=':
        return a <= b
      case '>=':
        return a >= b
    }
  }

  private truthy(v: RV): boolean {
    if (v instanceof Ref) return true
    return Boolean(v)
  }

  private toNum(v: RV): number {
    if (v instanceof Ref) {
      const p = this.toPrimitive(v)
      // Our refs ToPrimitive to a string; Number('')→0, Number('5')→5, else NaN.
      return typeof p === 'string' ? Number(p) : NaN
    }
    return Number(v)
  }

  private toStr(v: RV): string {
    if (v instanceof Ref) return this.refToString(v)
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    return String(v)
  }

  /**
   * ToPrimitive for our value kinds. Primitives pass through; every heap ref
   * converts to its string form (arrays join with ',', plain objects become
   * "[object Object]"), matching JS's default ToPrimitive for `+`/`==`/relational.
   */
  private toPrimitive(v: RV): RV {
    return v instanceof Ref ? this.refToString(v) : v
  }

  /** JS ToString for a heap ref (cycle-guarded for self-referential arrays). */
  private refToString(ref: Ref, seen: Set<string> = new Set()): string {
    if (isNativeId(ref.id)) return nativeName(ref.id)
    const o = this.heap.get(ref)
    if (o.kind === 'array') {
      if (seen.has(ref.id)) return ''
      seen.add(ref.id)
      const out = o.elements
        .map((el) =>
          el === null || el === undefined
            ? ''
            : el instanceof Ref
              ? this.refToString(el, seen)
              : this.toStr(el),
        )
        .join(',')
      seen.delete(ref.id)
      return out
    }
    if (o.kind === 'object') return '[object Object]'
    if (o.kind === 'function') return `ƒ ${o.name || 'anonymous'}`
    if (o.kind === 'promise') return '[object Promise]'
    return '{…}'
  }

  private jsTypeof(v: RV): string {
    if (v instanceof Ref) {
      return isNativeId(v.id) || this.heap.get(v).kind === 'function' ? 'function' : 'object'
    }
    if (v === null) return 'object'
    return typeof v
  }

  /** The `in` operator: is `key` a property of the object/array `obj`? */
  private inOperator(key: RV, obj: RV, node: ESTree.Node): boolean {
    if (!(obj instanceof Ref) || isNativeId(obj.id)) {
      this.lastErrorNode = node
      throw this.makeThrow('TypeError', "Cannot use 'in' operator to search in a non-object")
    }
    const o = this.heap.get(obj)
    const k = this.toStr(key)
    if (o.kind === 'object') return o.props.has(k)
    if (o.kind === 'array') {
      if (k === 'length') return true
      const idx = Number(k)
      return Number.isInteger(idx) && idx >= 0 && idx < o.elements.length
    }
    return false
  }

  // --- misc helpers ---------------------------------------------------------

  private iterableValues(v: RV, node: ESTree.Node): RV[] {
    if (typeof v === 'string') return [...v]
    if (v instanceof Ref && !isNativeId(v.id)) {
      const h = this.heap.get(v)
      if (h.kind === 'array') return [...h.elements]
    }
    this.lastErrorNode = node
    throw this.makeThrow('TypeError', `${this.toStr(v)} is not iterable`)
  }

  private propertyKeyName(prop: ESTree.Property): string {
    if (prop.computed) throw new UnsupportedSyntax('computed object key', prop)
    if (prop.key.type === 'Identifier') return prop.key.name
    if (prop.key.type === 'Literal') return String(prop.key.value)
    throw new UnsupportedSyntax('object key', prop)
  }

  private doConsole(method: string, args: RV[], node: ESTree.Node): void {
    const m =
      method === 'warn' || method === 'error' || method === 'info' ? method : 'log'
    this.console.push({
      id: `c${this.consoleCounter++}`,
      method: m,
      parts: args.map((a) => this.valueView(a)),
      stepId: this.stepId,
      nodeId: this.idOf(node),
    })
  }

  /** Readable text for a value thrown out of a task/microtask callback. */
  private uncaughtText(value: RV): string {
    if (value instanceof Ref && !isNativeId(value.id)) {
      const o = this.heap.get(value)
      if (o.kind === 'object') {
        const name = o.props.get('name')
        const message = o.props.get('message')
        if (name !== undefined || message !== undefined) {
          return `${name ?? 'Error'}${message !== undefined ? `: ${message}` : ''}`
        }
      }
      return this.refRepr(value)
    }
    return typeof value === 'string' ? value : this.primRepr(value)
  }

  /**
   * Surface an uncaught error from a timer/microtask callback WITHOUT aborting
   * the run — real engines report it to the host and keep the event loop going.
   */
  private reportUncaught(value: RV, node: ESTree.Node): void {
    this.console.push({
      id: `c${this.consoleCounter++}`,
      method: 'error',
      parts: [{ kind: 'primitive', type: 'string', repr: `Uncaught ${this.uncaughtText(value)}` }],
      stepId: this.stepId,
      nodeId: this.idOf(node),
    })
  }

  private makeThrow(name: string, message: string): ThrowSignal {
    const ref = this.heap.allocObject()
    const o = this.heap.get(ref)
    if (o.kind === 'object') {
      o.props.set('name', name)
      o.props.set('message', message)
      o.rev++
    }
    return new ThrowSignal(ref)
  }

  private unsupported(node: ESTree.Node, what: string): never {
    this.lastErrorNode = node
    throw new UnsupportedSyntax(`Unsupported ${what}: ${node.type}`, node)
  }

  private toEngineError(e: unknown): EngineError {
    const errSpan = this.lastErrorNode ? this.spanOf(this.lastErrorNode) : null
    const errNodeId = this.lastErrorNode ? this.idOf(this.lastErrorNode) : undefined
    if (e instanceof BudgetExceeded) {
      return { name: 'RangeError', message: e.message }
    }
    if (e instanceof SyntaxParseError) {
      return { name: 'SyntaxError', message: e.message, source: e.span }
    }
    if (e instanceof UnsupportedSyntax) {
      return {
        name: 'UnsupportedSyntax',
        message: e.message,
        nodeId: this.idOf(e.node),
        source: this.spanOf(e.node),
      }
    }
    if (e instanceof ThrowSignal) {
      const v = e.value
      let name = 'Error'
      let message: string
      if (v instanceof Ref) {
        const o = this.heap.get(v)
        if (o.kind === 'object') {
          name = this.toStr(o.props.get('name') ?? 'Error')
          message = this.toStr(o.props.get('message') ?? '')
        } else {
          message = this.refRepr(v)
        }
      } else {
        message = this.toStr(v)
      }
      return { name, message, nodeId: errNodeId, source: errSpan }
    }
    return { name: 'InternalError', message: String(e), nodeId: errNodeId, source: errSpan }
  }
}

/** Parse + run `source`, producing the full deterministic snapshot stream. */
export function runProgram(source: string, options: RunOptions = {}): RunResult {
  let parsed: ParseResult
  try {
    parsed = parseProgram(source)
  } catch (e) {
    if (e instanceof SyntaxParseError) {
      return { snapshots: [], error: { name: 'SyntaxError', message: e.message, source: e.span }, ast: null }
    }
    return { snapshots: [], error: { name: 'SyntaxError', message: String(e) }, ast: null }
  }
  return new Interpreter(parsed, options).run()
}
