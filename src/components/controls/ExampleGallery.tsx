import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BookOpen } from 'lucide-react'
import { useVisualizerStore } from '@/store/useVisualizerStore'
import { EXAMPLES } from '@/examples'
import type { Example } from '@/examples'

const SECTIONS: { category: Example['category']; label: string }[] = [
  { category: 'basic', label: 'Basics — start here' },
  { category: 'advanced', label: 'Advanced — event loop, closures & async' },
]

/** A gallery of curated snippets; selecting one loads it into the editor and runs. */
export function ExampleGallery() {
  const [open, setOpen] = useState(false)
  const loadExample = useVisualizerStore((s) => s.loadExample)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-edge bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-panel-muted"
        >
          <BookOpen size={15} /> Examples
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-edge bg-panel p-4 shadow-xl">
          <Dialog.Title className="text-sm font-semibold text-ink">Examples</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-ink-muted">
            Pick a snippet — it loads into the editor and runs.
          </Dialog.Description>
          {SECTIONS.map((section) => (
            <div key={section.category} className="mb-4 last:mb-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {section.label}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {EXAMPLES.filter((ex) => ex.category === section.category).map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => {
                      loadExample(ex.code)
                      setOpen(false)
                    }}
                    className="rounded-lg border border-edge bg-panel-muted p-3 text-left transition-colors hover:border-accent"
                  >
                    <div className="text-sm font-semibold text-ink">{ex.title}</div>
                    <div className="mt-1 text-xs text-ink-muted">{ex.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
