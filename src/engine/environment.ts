import type { RV } from './runtime'
import type { DeclKind } from './types'

export type EnvKind = 'global' | 'function' | 'block'

export interface Binding {
  value: RV
  /** `false` while a `let`/`const` is hoisted but in its temporal dead zone. */
  initialized: boolean
  kind: DeclKind
  /** Host-provided global (console, setTimeout, …) — hidden from the UI. */
  builtin?: boolean
}

/**
 * One lexical scope. The chain of `parent` links is the scope chain; closures
 * capture an `Environment` by reference. `rev` bumps on every write so the
 * snapshot serializer can cache and structurally share unchanged scopes.
 */
export class Environment {
  rev = 0
  readonly bindings = new Map<string, Binding>()

  constructor(
    readonly id: string,
    readonly kind: EnvKind,
    readonly parent: Environment | null,
    readonly name?: string,
  ) {}

  /** Create/overwrite a binding in *this* scope. */
  declareOwn(
    name: string,
    kind: DeclKind,
    value: RV,
    initialized: boolean,
    builtin = false,
  ): void {
    this.bindings.set(name, { value, initialized, kind, builtin })
    this.rev++
  }

  hasOwn(name: string): boolean {
    return this.bindings.has(name)
  }

  /** Nearest scope (this or ancestor) that declares `name`, or null. */
  resolve(name: string): Environment | null {
    if (this.bindings.has(name)) return this
    return this.parent ? this.parent.resolve(name) : null
  }

  /** Nearest enclosing function/global scope — where `var` and hoisting land. */
  functionScope(): Environment {
    if (this.kind !== 'block' || !this.parent) return this
    return this.parent.functionScope()
  }
}
