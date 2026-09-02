import type { CSSProperties } from 'react'

/**
 * Shared "this is the active/current item" treatment used across the runtime
 * panels (call-stack top frame, queue front, soonest timer, innermost scope…):
 * a tinted fill plus a 3px left accent stripe and a thin accent ring — strong
 * enough to read at a glance, where a border alone washed out.
 *
 * `accent` is a CSS color, normally a region token like `var(--color-stack)`.
 * Colors go through inline `style` (not Tailwind classes) so the token can be
 * passed dynamically; the structural bits stay in `className`.
 */
export function activeItem(accent: string): { className: string; style: CSSProperties } {
  return {
    className: 'rounded-md border border-l-[3px] shadow-sm transition-colors',
    style: {
      borderColor: accent,
      borderLeftColor: accent,
      background: `color-mix(in oklab, ${accent} 22%, var(--color-panel))`,
      boxShadow: `0 0 0 1px color-mix(in oklab, ${accent} 45%, transparent)`,
    },
  }
}

/** The quiet counterpart — same box geometry so the highlight is the only difference. */
export function inactiveItem(): { className: string; style: undefined } {
  return {
    className:
      'rounded-md border border-l-[3px] border-edge border-l-transparent bg-panel-muted transition-colors',
    style: undefined,
  }
}
