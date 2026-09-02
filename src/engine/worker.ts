import * as Comlink from 'comlink'
import { runProgram } from './interpreter'
import type { RunOptions, RunResult } from './types'

/**
 * The engine endpoint, exposed over comlink. Runs entirely off the main thread
 * so a long or infinite program never janks the UI. `run` returns the full
 * deterministic snapshot stream; structured-clone preserves the structural
 * sharing between snapshots across the worker boundary.
 */
const api = {
  run(source: string, options?: RunOptions): RunResult {
    return runProgram(source, options)
  },
}

export type EngineApi = typeof api

Comlink.expose(api)
