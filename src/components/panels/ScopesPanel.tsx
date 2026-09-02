import { useEffect, useRef, useState } from 'react'
import { useCurrentSnapshot } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import { activeItem, inactiveItem } from '@/lib/activeHighlight'
import type { BindingView, EnvView, Snapshot } from '@/engine'

/** Walk the scope chain from the active env outward to the global scope. */
function scopeChain(snap: Snapshot | null): EnvView[] {
  if (!snap) return []
  const chain: EnvView[] = []
  const seen = new Set<string>()
  let id: string | null = snap.activeEnvId
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const env: EnvView | undefined = snap.environments[id]
    if (!env) break
    chain.push(env)
    id = env.parentId
  }
  return chain
}

const KIND_LABEL: Record<BindingView['declaredAs'], string> = {
  var: 'var',
  let: 'let',
  const: 'const',
  param: 'arg',
  fn: 'fn',
}

/** A single binding; flashes when its value changes between steps. */
function BindingRow({ binding }: { binding: BindingView }) {
  const repr = binding.value?.repr ?? null
  const prev = useRef<string | null>(repr)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (prev.current !== repr) {
      prev.current = repr
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 450)
      return () => clearTimeout(t)
    }
  }, [repr])

  return (
    <div
      className="flex items-baseline gap-2 rounded px-1.5 py-0.5 font-mono text-xs transition-colors duration-300"
      style={
        pulse
          ? { backgroundColor: 'color-mix(in oklab, var(--color-microtask) 30%, transparent)' }
          : undefined
      }
    >
      <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
        {KIND_LABEL[binding.declaredAs]}
      </span>
      <span className="font-semibold text-ink">{binding.name}</span>
      <span className="text-ink-muted">=</span>
      {binding.initialized ? (
        <span className="text-ink">{binding.value?.repr}</span>
      ) : (
        <span className="italic text-ink-muted">⟂ uninitialized</span>
      )}
    </div>
  )
}

/**
 * The scope chain for the active frame — innermost scope first, global last.
 * Closures fall out naturally: a function scope's `parent` link is the captured
 * environment. (Rich closure-capture *edges* arrive with the object graph in
 * Phase 5.)
 */
export function ScopesPanel() {
  const snap = useCurrentSnapshot()
  const chain = scopeChain(snap)

  return (
    <Panel
      title="Scopes & Closures"
      accent="var(--color-accent)"
      badge={chain.length || undefined}
    >
      {chain.length === 0 ? (
        <p className="text-xs italic text-ink-muted">No active scope.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {chain.map((env, i) => {
            const active = i === 0
            const hl = active ? activeItem('var(--color-accent)') : inactiveItem()
            return (
            <div key={env.id} className={cn('p-1.5', hl.className)} style={hl.style}>
              <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wide text-ink-muted">
                <span className="font-semibold">{env.name ?? env.kind}</span>
                <span className="opacity-60">{env.kind}</span>
              </div>
              {(() => {
                const visible = env.bindings.filter((b) => !b.builtin)
                return visible.length === 0 ? (
                  <p className="px-1.5 text-xs italic text-ink-muted">empty</p>
                ) : (
                  visible.map((b) => <BindingRow key={b.name} binding={b} />)
                )
              })()}
            </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
