import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** Set (or clear) the currently-executing source range. `from`/`to` are doc offsets. */
export const setHighlight = StateEffect.define<{ from: number; to: number } | null>()

const lineDeco = Decoration.line({ class: 'cm-exec-line' })
const exprDeco = Decoration.mark({ class: 'cm-exec-expr' })

function build(state: EditorState, range: { from: number; to: number } | null): DecorationSet {
  if (!range) return Decoration.none
  const len = state.doc.length
  const from = Math.max(0, Math.min(range.from, len))
  const to = Math.max(from, Math.min(range.to, len))
  const decos = [lineDeco.range(state.doc.lineAt(from).from)]
  if (to > from) decos.push(exprDeco.range(from, to))
  return Decoration.set(decos, true)
}

/**
 * Decoration layer that highlights the current execution line + sub-expression.
 * The UI dispatches `setHighlight` whenever the active snapshot changes; the
 * field maps existing decorations through edits so they survive typing.
 */
export const execHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setHighlight)) next = build(tr.state, e.value)
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})
