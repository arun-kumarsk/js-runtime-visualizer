import { describe, it, expect } from 'vitest'
import { runProgram } from '@/engine'
import { buildGraph } from './buildGraph'

describe('buildGraph', () => {
  it('shows a closure capturing its defining scope', () => {
    const r = runProgram(`
      function makeCounter() {
        let c = 0
        return function () { c++; return c }
      }
      const inc = makeCounter()
    `)
    expect(r.error).toBeNull()
    const last = r.snapshots.at(-1)!
    const graph = buildGraph(last)

    // the inner function and a scope node both exist…
    expect(graph.nodes.some((n) => n.kind === 'function')).toBe(true)
    expect(graph.nodes.some((n) => n.kind === 'scope')).toBe(true)
    // …joined by a capture edge (function → its defining scope)
    expect(graph.edges.some((e) => e.capture)).toBe(true)
  })

  it('links an array/object to its referenced heap values', () => {
    const r = runProgram(`
      const child = { n: 1 }
      const parent = { child: child }
      const list = [child]
    `)
    expect(r.error).toBeNull()
    const graph = buildGraph(r.snapshots.at(-1)!)
    // parent.child and list[0] both reference the same child object
    const objectNodes = graph.nodes.filter((n) => n.kind === 'object')
    expect(objectNodes.length).toBeGreaterThanOrEqual(2)
    expect(graph.edges.some((e) => e.label === 'child')).toBe(true)
  })

  it('returns an empty graph for null', () => {
    expect(buildGraph(null)).toEqual({ nodes: [], edges: [] })
  })
})
