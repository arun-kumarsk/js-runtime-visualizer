/**
 * The `Snapshot` and its view types — the single source of truth the whole UI
 * renders from. Every field here is a *serializable, display-ready* projection
 * of interpreter state at one step. View objects are structurally shared across
 * snapshots (see the interpreter's serialization cache), so holding thousands
 * of snapshots stays cheap.
 *
 * Event-loop regions (web APIs / macrotask / microtask queues) are added in
 * Phase 3–4; keep new runtime data flowing through here, not through component
 * state.
 */

export type Phase = 'sync' | 'microtask' | 'macrotask'

export type StepKind =
  | 'program'
  | 'statement'
  | 'expression'
  | 'call'
  | 'return'
  /** A timer's delay elapsed: it moves from Web APIs → the macrotask queue. */
  | 'timer'
  /** A queued task is dequeued and about to run on the (empty) call stack. */
  | 'task'
  /** A microtask is dequeued and about to run. */
  | 'microtask'

/** A region of source text (char offsets + 1-based line / 0-based column). */
export interface SourceSpan {
  start: number
  end: number
  line: number
  col: number
  endLine: number
  endCol: number
}

/** A value rendered for display — never the live runtime value. */
export type ValueView =
  | { kind: 'primitive'; type: 'number' | 'string' | 'boolean' | 'undefined' | 'null'; repr: string }
  | { kind: 'ref'; refId: string; repr: string }

export type DeclKind = 'var' | 'let' | 'const' | 'param' | 'fn'

export interface BindingView {
  name: string
  /** `null` while a `let`/`const` binding is in its temporal dead zone. */
  value: ValueView | null
  initialized: boolean
  declaredAs: DeclKind
  /** Host-provided global (console, setTimeout, …) — hidden from the UI. */
  builtin: boolean
}

export interface EnvView {
  id: string
  kind: 'global' | 'function' | 'block'
  name?: string
  parentId: string | null
  bindings: BindingView[]
}

export interface FrameView {
  id: string
  fnName: string
  envId: string
  args: ValueView[]
  /** Set once the frame is returning, for the brief "popping" render. */
  returnValue?: ValueView
  calleeNodeId?: string
}

export type HeapNodeView =
  | { id: string; kind: 'object'; entries: { key: string; value: ValueView }[] }
  | { id: string; kind: 'array'; elements: ValueView[] }
  | { id: string; kind: 'function'; name: string; closureEnvId: string | null }
  | { id: string; kind: 'promise'; state: 'pending' | 'fulfilled' | 'rejected'; value: ValueView }

export interface ConsoleEntry {
  id: string
  method: 'log' | 'warn' | 'error' | 'info'
  parts: ValueView[]
  stepId: number
  nodeId: string
}

/** A pending timer parked in the Web APIs region. */
export interface WebApiView {
  id: string
  kind: 'timeout' | 'interval'
  label: string
  /** Requested delay in ms (cosmetic — drives the real-time countdown). */
  delay: number
  callbackName: string
}

/** A callback waiting in the macrotask or microtask queue. */
export interface TaskView {
  id: string
  label: string
  callbackName: string
}

export interface Snapshot {
  stepId: number
  kind: StepKind
  phase: Phase
  /** Id of the AST node this step is "at" — drives source + AST highlight. */
  astNodeId: string
  source: SourceSpan | null
  /** Logical (deterministic) clock in ms — drives real-time playback pacing. */
  clock: number
  /** Bottom (global) frame first, current frame last. */
  callStack: FrameView[]
  /** Env whose scope chain is "active" this step. */
  activeEnvId: string
  environments: Record<string, EnvView>
  heap: Record<string, HeapNodeView>
  /** Pending timers (Web APIs region). */
  webApis: WebApiView[]
  /** Callback (macrotask) queue, FIFO. */
  macrotaskQueue: TaskView[]
  /** Microtask queue, FIFO (populated in Phase 4). */
  microtaskQueue: TaskView[]
  /** Cumulative console output as of this step. */
  console: ConsoleEntry[]
  /** Optional guided-mode annotation for this moment. */
  explain?: string
}

export interface EngineError {
  name: string
  message: string
  nodeId?: string
  source?: SourceSpan | null
}

/** A serializable AST node for the inspector panel. */
export interface AstNodeView {
  id: string
  type: string
  label: string
  children: AstNodeView[]
}

export interface RunResult {
  snapshots: Snapshot[]
  error: EngineError | null
  ast: AstNodeView | null
}

export interface RunOptions {
  /** Max snapshots before aborting (infinite-loop guard). */
  maxSteps?: number
  /** Max wall-clock ms before aborting. */
  maxMs?: number
}
