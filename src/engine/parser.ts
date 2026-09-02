import { parse } from 'acorn'
import { full } from 'acorn-walk'
import type * as ESTree from 'estree'
import type { SourceSpan } from './types'

/** acorn attaches these to every node; ESTree's types model them as optional. */
interface Positioned {
  start: number
  end: number
  loc?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  } | null
}

export interface NodeMeta {
  id: string
  span: SourceSpan
}

export interface ParseResult {
  program: ESTree.Program
  /** Stable per-node id + source span, keyed by node identity. */
  meta: WeakMap<ESTree.Node, NodeMeta>
}

export class SyntaxParseError extends Error {
  constructor(
    message: string,
    public readonly span: SourceSpan | null,
  ) {
    super(message)
    this.name = 'SyntaxError'
  }
}

function spanOf(node: ESTree.Node): SourceSpan {
  const p = node as unknown as Positioned
  return {
    start: p.start,
    end: p.end,
    line: p.loc?.start.line ?? 1,
    col: p.loc?.start.column ?? 0,
    endLine: p.loc?.end.line ?? 1,
    endCol: p.loc?.end.column ?? 0,
  }
}

/**
 * Parse source into an ESTree program, assigning each node a stable id (in
 * deterministic walk order) and a source span. Ids live in a WeakMap rather
 * than on the nodes themselves, so nodes stay plain ESTree and snapshots can
 * reference `astNodeId` without us mutating the AST.
 */
export function parseProgram(source: string): ParseResult {
  let program: ESTree.Program
  try {
    program = parse(source, {
      ecmaVersion: 2022,
      sourceType: 'script',
      locations: true,
    }) as unknown as ESTree.Program
  } catch (err) {
    const e = err as Error & { loc?: { line: number; column: number }; pos?: number }
    const span: SourceSpan | null = e.loc
      ? {
          start: e.pos ?? 0,
          end: e.pos ?? 0,
          line: e.loc.line,
          col: e.loc.column,
          endLine: e.loc.line,
          endCol: e.loc.column,
        }
      : null
    throw new SyntaxParseError(e.message, span)
  }

  const meta = new WeakMap<ESTree.Node, NodeMeta>()
  let counter = 0
  full(program as never, (node: unknown) => {
    const n = node as ESTree.Node
    if (!meta.has(n)) {
      meta.set(n, { id: `n${counter++}`, span: spanOf(n) })
    }
  })

  return { program, meta }
}
