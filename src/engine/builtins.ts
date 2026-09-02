/**
 * Host built-ins surface. These globals are exposed to user code as opaque
 * "native" references (ids starting with `@`). The interpreter recognises the
 * ids and implements their behavior directly (console output, timer scheduling)
 * rather than executing JS for them.
 */

export const CONSOLE_ID = '@console'
export const SET_TIMEOUT_ID = '@setTimeout'
export const SET_INTERVAL_ID = '@setInterval'
export const CLEAR_TIMEOUT_ID = '@clearTimeout'
export const CLEAR_INTERVAL_ID = '@clearInterval'
export const PROMISE_ID = '@Promise'
export const QUEUE_MICROTASK_ID = '@queueMicrotask'

/** Globals installed into the global scope as `const` native references. */
export const GLOBAL_BUILTINS: { name: string; id: string }[] = [
  { name: 'console', id: CONSOLE_ID },
  { name: 'setTimeout', id: SET_TIMEOUT_ID },
  { name: 'setInterval', id: SET_INTERVAL_ID },
  { name: 'clearTimeout', id: CLEAR_TIMEOUT_ID },
  { name: 'clearInterval', id: CLEAR_INTERVAL_ID },
  { name: 'Promise', id: PROMISE_ID },
  { name: 'queueMicrotask', id: QUEUE_MICROTASK_ID },
]

const NATIVE_NAMES: Record<string, string> = {
  [CONSOLE_ID]: 'console',
  [SET_TIMEOUT_ID]: 'setTimeout',
  [SET_INTERVAL_ID]: 'setInterval',
  [CLEAR_TIMEOUT_ID]: 'clearTimeout',
  [CLEAR_INTERVAL_ID]: 'clearInterval',
  [PROMISE_ID]: 'Promise',
  [QUEUE_MICROTASK_ID]: 'queueMicrotask',
}

/** Display name for a native ref id (e.g. `@setTimeout` → `setTimeout`). */
export function nativeName(id: string): string {
  return NATIVE_NAMES[id] ?? id.replace(/^@/, '')
}

/** Is this a native built-in reference? */
export function isNativeId(id: string): boolean {
  return id.startsWith('@')
}

/** Globals that arrive in later phases — friendlier "not yet" message. */
export const FUTURE_GLOBALS: Record<string, string> = {
  fetch: 'a later phase',
  requestAnimationFrame: 'a later phase',
}
