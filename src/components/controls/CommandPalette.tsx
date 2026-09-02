import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useVisualizerStore } from '@/store/useVisualizerStore'
import { EXAMPLES } from '@/examples'
import { cn } from '@/lib/cn'

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

/**
 * A ⌘K / Ctrl+K command palette: fuzzy-ish filter over actions + examples,
 * arrow keys to navigate, Enter to run. Built on Radix Dialog (focus trap + Esc).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const openPalette = () => {
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  // Global ⌘K / Ctrl+K toggle (and an explicit open event for the toolbar button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => {
          if (!o) {
            setQuery('')
            setActive(0)
          }
          return !o
        })
      }
    }
    const onOpen = () => openPalette()
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  const commands = useMemo<Command[]>(() => {
    const s = useVisualizerStore.getState()
    const close = () => setOpen(false)
    const actions: Command[] = [
      { id: 'run', label: 'Run', hint: 'R', run: () => { s.run(); close() } },
      { id: 'playpause', label: 'Play / Pause', hint: 'Space', run: () => { s.togglePlay(); close() } },
      { id: 'reset', label: 'Reset to start', run: () => { s.reset(); close() } },
      { id: 'fwd', label: 'Step forward / into', hint: '→', run: () => { s.stepForward(); close() } },
      { id: 'back', label: 'Step back', hint: '←', run: () => { s.stepBackward(); close() } },
      { id: 'over', label: 'Step over', run: () => { s.stepOver(); close() } },
      { id: 'out', label: 'Step out', run: () => { s.stepOut(); close() } },
      { id: 'guided', label: 'Toggle guided mode', run: () => { s.toggleGuided(); close() } },
    ]
    const examples: Command[] = EXAMPLES.map((ex) => ({
      id: `ex-${ex.id}`,
      label: `Example: ${ex.title}`,
      run: () => { s.loadExample(ex.code); close() },
    }))
    return [...actions, ...examples]
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  // Focus the input when the palette opens (side effect only — no setState).
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[active]?.run()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-[18%] z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-edge bg-panel shadow-xl"
          onKeyDown={onListKey}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Type a command or example…"
            className="w-full border-b border-edge bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <ul className="max-h-72 overflow-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs italic text-ink-muted">No matches.</li>
            ) : (
              filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => c.run()}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm',
                      i === active ? 'bg-accent text-[var(--panel)]' : 'text-ink hover:bg-panel-muted',
                    )}
                  >
                    <span>{c.label}</span>
                    {c.hint && (
                      <kbd className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">{c.hint}</kbd>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
