import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useVisualizerStore, useCurrentSnapshot } from '@/store/useVisualizerStore'
import { Panel } from '../layout/Panel'
import { cn } from '@/lib/cn'
import { explainNode } from '@/lib/explainNode'
import type { AstNodeView } from '@/engine'

interface RowProps {
  node: AstNodeView
  depth: number
  activeId: string | null
  selectedId: string | null
  onSelect: (node: AstNodeView) => void
}

function AstRow({ node, depth, activeId, selectedId, onSelect }: RowProps) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isActive = node.id === activeId
  const isSelected = node.id === selectedId

  return (
    <div>
      <button
        type="button"
        data-ast-active={isActive ? 'true' : undefined}
        onClick={() => onSelect(node)}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-xs hover:bg-panel-muted',
          isActive && 'bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)]',
          isSelected && !isActive && 'bg-panel-muted',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {hasChildren ? (
          <ChevronRight
            size={12}
            className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-90')}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="font-semibold text-ink">{node.type}</span>
        {node.label && <span className="text-[var(--color-stack)]">{node.label}</span>}
      </button>
      {open &&
        node.children.map((c) => (
          <AstRow
            key={c.id}
            node={c}
            depth={depth + 1}
            activeId={activeId}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

/**
 * The syntax tree, synced to execution: the currently-evaluating node is
 * highlighted (and scrolled into view), and clicking any node explains it.
 */
export function AstInspector() {
  const ast = useVisualizerStore((s) => s.ast)
  const activeId = useCurrentSnapshot()?.astNodeId ?? null
  const [selected, setSelected] = useState<AstNodeView | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the active node visible — but scroll only *this* container, never the
  // ancestors (which `scrollIntoView` would do, yanking the other panels).
  useEffect(() => {
    const container = scrollRef.current
    if (!container || activeId == null) return
    const el = container.querySelector<HTMLElement>('[data-ast-active="true"]')
    if (!el) return
    const c = container.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    if (e.top < c.top) container.scrollTop -= c.top - e.top + 8
    else if (e.bottom > c.bottom) container.scrollTop += e.bottom - c.bottom + 8
  }, [activeId])

  return (
    <Panel title="AST" accent="var(--color-stack)" className="h-full">
      {!ast ? (
        <p className="text-xs italic text-ink-muted">Run some code to see its syntax tree.</p>
      ) : (
        <div className="flex h-full flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <AstRow
              node={ast}
              depth={0}
              activeId={activeId}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          </div>
          {selected && (
            <div className="mt-2 shrink-0 rounded-md border border-edge bg-panel-muted p-2 text-xs">
              <span className="font-mono font-semibold text-ink">{selected.type}</span>
              <p className="mt-1 text-ink-muted">{explainNode(selected.type)}</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
