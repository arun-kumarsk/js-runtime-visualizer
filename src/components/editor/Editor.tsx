import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import { execHighlightField, setHighlight } from './editorHighlight'
import {
  breakpointGutter,
  heatmapGutter,
  valueBubble,
  setBreakpoints,
  setHeatmap,
  setBubble,
} from './editorGutters'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  /** Doc-offset range of the currently-executing expression, or null. */
  highlight: { from: number; to: number } | null
  breakpoints: number[]
  onToggleBreakpoint: (line: number) => void
  /** Line → execution intensity (0–1) for the heatmap gutter. */
  heatmap: Record<number, number>
  /** Inline value bubble for the current identifier, or null. */
  bubble: { to: number; text: string } | null
  readOnly?: boolean
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
})

/**
 * The source editor. Decorations (current-execution highlight, breakpoints,
 * heatmap, value bubble) are driven by dispatching effects when their inputs
 * change — the extension set itself is built once so the editor never
 * reconfigures.
 */
export function Editor({
  value,
  onChange,
  highlight,
  breakpoints,
  onToggleBreakpoint,
  heatmap,
  bubble,
  readOnly = false,
}: EditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null)

  // `onToggleBreakpoint` is a stable zustand action, so this memo is built once.
  const extensions = useMemo(
    () => [
      javascript({ jsx: false, typescript: false }),
      baseTheme,
      execHighlightField,
      ...breakpointGutter(onToggleBreakpoint),
      ...heatmapGutter,
      ...valueBubble,
    ],
    [onToggleBreakpoint],
  )

  const from = highlight?.from ?? null
  const to = highlight?.to ?? null
  useEffect(() => {
    const view = ref.current?.view
    if (!view) return
    view.dispatch({
      effects: setHighlight.of(from != null && to != null ? { from, to } : null),
    })
  }, [from, to])

  const bpKey = breakpoints.join(',')
  useEffect(() => {
    ref.current?.view?.dispatch({ effects: setBreakpoints.of(breakpoints) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpKey])

  useEffect(() => {
    ref.current?.view?.dispatch({ effects: setHeatmap.of(heatmap) })
  }, [heatmap])

  const bubbleTo = bubble?.to ?? null
  const bubbleText = bubble?.text ?? null
  useEffect(() => {
    ref.current?.view?.dispatch({
      effects: setBubble.of(bubbleTo != null && bubbleText != null ? { to: bubbleTo, text: bubbleText } : null),
    })
  }, [bubbleTo, bubbleText])

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme="dark"
      height="100%"
      style={{ height: '100%' }}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        autocompletion: false,
      }}
    />
  )
}
