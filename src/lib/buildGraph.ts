import type { Snapshot, ValueView } from '@/engine'

export type GraphNodeKind = 'scope' | 'object' | 'array' | 'function' | 'promise'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  title: string
  lines: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string
  /** A closure/variable capture edge (function → its defining scope). */
  capture?: boolean
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** A ref pointing at a real heap object (not a native built-in like console). */
function heapRef(v: ValueView): string | null {
  return v.kind === 'ref' && !v.refId.startsWith('@') ? v.refId : null
}

/**
 * Build the object/reference graph from a snapshot: the scopes that matter
 * (the active chain + every closure's captured scope) plus all heap objects,
 * wired by reference. This is what makes closures visible — a function node
 * links to the scope it captured, whose variables point at heap values.
 */
export function buildGraph(snap: Snapshot | null): Graph {
  if (!snap) return { nodes: [], edges: [] }

  // Which scopes to show.
  const envIds = new Set<string>()
  const seen = new Set<string>()
  let id: string | null = snap.activeEnvId
  while (id && !seen.has(id)) {
    seen.add(id)
    envIds.add(id)
    id = snap.environments[id]?.parentId ?? null
  }
  for (const h of Object.values(snap.heap)) {
    if (h.kind === 'function' && h.closureEnvId) envIds.add(h.closureEnvId)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const addEdge = (e: GraphEdge) => {
    if (!edges.some((x) => x.id === e.id)) edges.push(e)
  }

  // Scope nodes
  for (const envId of envIds) {
    const env = snap.environments[envId]
    if (!env) continue
    const userBindings = env.bindings.filter((b) => !b.builtin)
    nodes.push({
      id: env.id,
      kind: 'scope',
      title: `${env.name ?? env.kind} scope`,
      lines: userBindings.map((b) => `${b.name} = ${b.value?.repr ?? '⟂'}`),
    })
    if (env.parentId && envIds.has(env.parentId)) {
      addEdge({ id: `${env.id}->${env.parentId}:parent`, source: env.id, target: env.parentId, label: 'parent' })
    }
    for (const b of userBindings) {
      if (!b.value) continue
      const ref = heapRef(b.value)
      if (ref && snap.heap[ref]) {
        addEdge({ id: `${env.id}->${ref}:${b.name}`, source: env.id, target: ref, label: b.name })
      }
    }
  }

  // Heap nodes + their reference edges
  for (const h of Object.values(snap.heap)) {
    if (h.kind === 'object') {
      nodes.push({ id: h.id, kind: 'object', title: '{ } object', lines: h.entries.map((e) => `${e.key}: ${e.value.repr}`) })
      for (const e of h.entries) {
        const ref = heapRef(e.value)
        if (ref && snap.heap[ref]) addEdge({ id: `${h.id}->${ref}:${e.key}`, source: h.id, target: ref, label: e.key })
      }
    } else if (h.kind === 'array') {
      nodes.push({ id: h.id, kind: 'array', title: `[ ] array(${h.elements.length})`, lines: h.elements.map((v, i) => `${i}: ${v.repr}`) })
      h.elements.forEach((v, i) => {
        const ref = heapRef(v)
        if (ref && snap.heap[ref]) addEdge({ id: `${h.id}->${ref}:${i}`, source: h.id, target: ref, label: String(i) })
      })
    } else if (h.kind === 'function') {
      nodes.push({ id: h.id, kind: 'function', title: `ƒ ${h.name || 'anonymous'}`, lines: [] })
      if (h.closureEnvId && envIds.has(h.closureEnvId)) {
        addEdge({ id: `${h.id}->${h.closureEnvId}:closure`, source: h.id, target: h.closureEnvId, label: 'captures', capture: true })
      }
    } else {
      nodes.push({ id: h.id, kind: 'promise', title: 'Promise', lines: [`<${h.state}>`, h.value.repr !== 'undefined' ? h.value.repr : ''].filter(Boolean) })
      const ref = heapRef(h.value)
      if (ref && snap.heap[ref]) addEdge({ id: `${h.id}->${ref}:value`, source: h.id, target: ref, label: 'value' })
    }
  }

  return { nodes, edges }
}
