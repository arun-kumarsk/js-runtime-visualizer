import { StateField, StateEffect, RangeSet, type EditorState } from '@codemirror/state'
import {
  gutter,
  GutterMarker,
  WidgetType,
  Decoration,
  EditorView,
  type DecorationSet,
} from '@codemirror/view'

// --- Breakpoints ------------------------------------------------------------

export const setBreakpoints = StateEffect.define<number[]>()

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-bp-dot'
    return el
  }
}
const bpMarker = new BreakpointMarker()

function markersForLines(state: EditorState, lines: number[]): RangeSet<GutterMarker> {
  const valid = lines.filter((n) => n >= 1 && n <= state.doc.lines).sort((a, b) => a - b)
  return RangeSet.of(valid.map((n) => bpMarker.range(state.doc.line(n).from)))
}

const bpField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty
  },
  update(set, tr) {
    let next = set.map(tr.changes)
    for (const e of tr.effects) if (e.is(setBreakpoints)) next = markersForLines(tr.state, e.value)
    return next
  },
})

/** Clickable breakpoint gutter; `onToggle` receives the 1-based line number. */
export function breakpointGutter(onToggle: (line: number) => void) {
  return [
    bpField,
    gutter({
      class: 'cm-bp-gutter',
      markers: (v) => v.state.field(bpField),
      initialSpacer: () => bpMarker,
      domEventHandlers: {
        mousedown(view, line) {
          onToggle(view.state.doc.lineAt(line.from).number)
          return true
        },
      },
    }),
  ]
}

// --- Heatmap (per-line execution intensity) ---------------------------------

export const setHeatmap = StateEffect.define<Record<number, number>>()

class HeatMarker extends GutterMarker {
  constructor(readonly intensity: number) {
    super()
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-heat-cell'
    el.style.opacity = String(this.intensity)
    return el
  }
}

const heatField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty
  },
  update(set, tr) {
    let next = set.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setHeatmap)) {
        const entries = Object.entries(e.value)
          .map(([ln, a]) => ({ ln: Number(ln), a }))
          .filter((x) => x.ln >= 1 && x.ln <= tr.state.doc.lines)
          .sort((a, b) => a.ln - b.ln)
        next = RangeSet.of(
          entries.map((x) => new HeatMarker(x.a).range(tr.state.doc.line(x.ln).from)),
        )
      }
    }
    return next
  },
})

export const heatmapGutter = [
  heatField,
  gutter({ class: 'cm-heat-gutter', markers: (v) => v.state.field(heatField) }),
]

// --- Inline value bubble ----------------------------------------------------

export const setBubble = StateEffect.define<{ to: number; text: string } | null>()

class BubbleWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: BubbleWidget) {
    return other.text === this.text
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-value-bubble'
    el.textContent = this.text
    return el
  }
}

const bubbleField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setBubble)) {
        if (!e.value) next = Decoration.none
        else {
          const to = Math.min(e.value.to, tr.state.doc.length)
          next = Decoration.set([
            Decoration.widget({ widget: new BubbleWidget(e.value.text), side: 1 }).range(to),
          ])
        }
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const valueBubble = [bubbleField]
