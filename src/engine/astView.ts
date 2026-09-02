import type * as ESTree from 'estree'
import type { ParseResult } from './parser'
import type { AstNodeView } from './types'

/** Node properties that are not child AST nodes. */
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'comments'])

function isNode(v: unknown): v is ESTree.Node {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string'
}

function childNodes(node: ESTree.Node): ESTree.Node[] {
  const out: ESTree.Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      for (const v of value) if (isNode(v)) out.push(v)
    } else if (isNode(value)) {
      out.push(value)
    }
  }
  return out
}

/** A short, human-friendly label for an AST node (shown next to its type). */
function labelFor(node: ESTree.Node): string {
  switch (node.type) {
    case 'Identifier':
      return node.name
    case 'Literal':
      return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value)
    case 'VariableDeclaration':
      return node.kind
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return node.id ? node.id.name : '(anonymous)'
    case 'ArrowFunctionExpression':
      return '=>'
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'AssignmentExpression':
    case 'UpdateExpression':
    case 'UnaryExpression':
      return node.operator
    case 'MemberExpression':
      return node.computed ? '[ ]' : '.'
    default:
      return ''
  }
}

function build(node: ESTree.Node, meta: ParseResult['meta']): AstNodeView {
  return {
    id: meta.get(node)?.id ?? '?',
    type: node.type,
    label: labelFor(node),
    children: childNodes(node).map((c) => build(c, meta)),
  }
}

/** Build a serializable AST tree (with node ids) for the AST inspector panel. */
export function buildAstView(program: ESTree.Program, meta: ParseResult['meta']): AstNodeView {
  return build(program, meta)
}
