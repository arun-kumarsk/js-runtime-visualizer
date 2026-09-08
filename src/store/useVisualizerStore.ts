import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import * as Comlink from 'comlink'
import EngineWorker from '@/engine/worker?worker'
import type { EngineApi } from '@/engine/worker'
import type { AstNodeView, EngineError, Snapshot } from '@/engine'
import { stepOverTarget, stepOutTarget } from '@/lib/stepping'

export type Status = 'idle' | 'running' | 'ready' | 'error'
export type PlayMode = 'step' | 'realtime'

/** While the player waits out a timer's delay, this drives the Web API countdown. */
export interface PendingWait {
  durationMs: number
  /** Bumps each wait so the countdown animation restarts. */
  token: number
}

interface VisualizerState {
  source: string
  snapshots: Snapshot[]
  ast: AstNodeView | null
  index: number
  status: Status
  error: EngineError | null

  // Playback
  playing: boolean
  mode: PlayMode
  speed: number
  pendingWait: PendingWait | null

  // Debugger
  breakpoints: number[]
  /** Guided mode: pause playback at each annotated (`explain`) step. */
  guided: boolean

  setSource: (source: string) => void
  run: () => Promise<void>
  loadExample: (code: string) => void
  stepForward: () => void
  stepBackward: () => void
  stepOver: () => void
  stepOut: () => void
  goto: (index: number) => void
  reset: () => void
  toggleBreakpoint: (line: number) => void

  play: () => void
  pause: () => void
  togglePlay: () => void
  setMode: (mode: PlayMode) => void
  setSpeed: (speed: number) => void
  setPendingWait: (wait: PendingWait | null) => void
  toggleGuided: () => void
}

let engine: Comlink.Remote<EngineApi> | null = null
function getEngine(): Comlink.Remote<EngineApi> {
  if (!engine) engine = Comlink.wrap<EngineApi>(new EngineWorker())
  return engine
}

export const useVisualizerStore = create<VisualizerState>()(
  immer((set, get) => ({
    source: '',
    snapshots: [],
    ast: null,
    index: 0,
    status: 'idle',
    error: null,

    playing: false,
    mode: 'realtime',
    speed: 1,
    pendingWait: null,

    breakpoints: [],
    guided: false,

    setSource: (source) =>
      set((s) => {
        s.source = source
      }),

    loadExample: (code) => {
      set((s) => {
        s.source = code
      })
      void get().run()
    },

    run: async () => {
      const source = get().source
      set((s) => {
        s.status = 'running'
        s.error = null
        s.snapshots = []
        s.ast = null
        s.index = 0
        s.playing = false
        s.pendingWait = null
      })
      try {
        const result = await getEngine().run(source, { maxSteps: 50_000 })
        set((s) => {
          s.snapshots = result.snapshots
          s.ast = result.ast
          s.index = 0
          s.error = result.error
          s.status = result.snapshots.length === 0 && result.error ? 'error' : 'ready'
          // Run only computes the timeline; it stays paused at the start so the
          // user drives playback (Play / Step) themselves.
          s.playing = false
        })
      } catch (e) {
        set((s) => {
          s.status = 'error'
          s.error = { name: 'WorkerError', message: String(e) }
        })
      }
    },

    stepForward: () =>
      set((s) => {
        const last = Math.max(0, s.snapshots.length - 1)
        s.index = Math.min(s.index + 1, last)
        s.pendingWait = null
        if (s.index >= last) s.playing = false
      }),

    stepBackward: () =>
      set((s) => {
        s.index = Math.max(s.index - 1, 0)
        s.playing = false
        s.pendingWait = null
      }),

    stepOver: () =>
      set((s) => {
        s.index = stepOverTarget(s.snapshots, s.index)
        s.playing = false
        s.pendingWait = null
      }),

    stepOut: () =>
      set((s) => {
        s.index = stepOutTarget(s.snapshots, s.index)
        s.playing = false
        s.pendingWait = null
      }),

    toggleBreakpoint: (line) =>
      set((s) => {
        const i = s.breakpoints.indexOf(line)
        if (i >= 0) s.breakpoints.splice(i, 1)
        else s.breakpoints.push(line)
      }),

    goto: (index) =>
      set((s) => {
        s.index = Math.max(0, Math.min(index, Math.max(0, s.snapshots.length - 1)))
        s.playing = false
        s.pendingWait = null
      }),

    reset: () =>
      set((s) => {
        s.index = 0
        s.playing = false
        s.pendingWait = null
        s.status = s.snapshots.length > 0 ? 'ready' : 'idle'
      }),

    play: () =>
      set((s) => {
        if (s.snapshots.length === 0) return
        // Restart from the beginning if we're parked at the end.
        if (s.index >= s.snapshots.length - 1) s.index = 0
        s.playing = true
      }),

    pause: () =>
      set((s) => {
        s.playing = false
        s.pendingWait = null
      }),

    togglePlay: () => (get().playing ? get().pause() : get().play()),

    setMode: (mode) =>
      set((s) => {
        s.mode = mode
      }),

    setSpeed: (speed) =>
      set((s) => {
        s.speed = speed
      }),

    setPendingWait: (wait) =>
      set((s) => {
        s.pendingWait = wait
      }),

    toggleGuided: () =>
      set((s) => {
        s.guided = !s.guided
      }),
  })),
)

/** The snapshot at the current timeline index, or null before a run. */
export function currentSnapshot(state: VisualizerState): Snapshot | null {
  return state.snapshots[state.index] ?? null
}

/**
 * Hook for the active snapshot. Returns the *stable* snapshot object (or null),
 * so panels can derive `.callStack`/`.console`/etc. in render without tripping
 * useSyncExternalStore's "new value every read" infinite-loop guard.
 */
export function useCurrentSnapshot(): Snapshot | null {
  return useVisualizerStore((s) => s.snapshots[s.index] ?? null)
}
