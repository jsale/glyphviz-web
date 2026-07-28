// The floating-window shell: a draggable, resizable, closable frame with a
// title bar, used by the two tool windows this app has — the Hyperglyph
// Generator (Ctrl+H) and the Glyph Composer (Ctrl+G).
//
// It is the only non-docked chrome in GlyphViz Web, and deliberately so. Both
// desktop counterparts are QDialogs you drag aside to look at the scene behind
// them, build a design in, and drop into that scene; a docked HUD panel would
// have to be dismissed to see the result of using it. See `panel.ts` for the
// docked kind, which has an entirely different state machine (open → collapsed
// → closed) because a docked panel has a column to sit in.
//
// Modeless where the desktop's `dlg.exec()` is modal: Insert into Scene edits
// the live scene on both sides, so modality buys the desktop nothing and would
// cost the ability to move the camera between insertions here.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export interface FloatWindowOptions {
  /** DOM id, also the CSS hook for per-window sizing. */
  id: string
  title: string
  /** Shown greyed in the header, and named in the close button's tooltip. */
  hotkey: string
  /** Extra class on the root, for windows that need their own layout. */
  className?: string
}

export class FloatWindow {
  readonly element: HTMLDivElement
  readonly body: HTMLDivElement
  readonly header: HTMLDivElement

  /** Called the first time the window is shown, and on every show after. */
  onOpen: (() => void) | null = null

  private open = false

  constructor(options: FloatWindowOptions) {
    this.element = el('div', {
      id: options.id,
      className: options.className ? `float-window ${options.className}` : 'float-window',
    })
    this.element.hidden = true

    this.header = el('div', { className: 'float-window-header' })
    const title = el('span', { className: 'float-window-title', textContent: options.title })
    const hotkey = el('span', { className: 'panel-hotkey', textContent: options.hotkey })
    const close = el('button', {
      type: 'button',
      className: 'panel-close',
      textContent: '×',
      title: `Close this window  (${options.hotkey} brings it back)`,
    })
    close.addEventListener('click', () => this.setOpen(false))
    this.header.append(title, hotkey, close)
    this.makeDraggable(this.header)

    this.body = el('div', { className: 'float-window-body' })
    this.element.append(this.header, this.body)
  }

  get isOpen(): boolean {
    return this.open
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  setOpen(value: boolean): void {
    this.open = value
    this.element.hidden = !value
    if (value) this.onOpen?.()
  }

  /** Drag by the header, clamped so the window can never leave the viewport. */
  private makeDraggable(handle: HTMLElement): void {
    let start: { x: number; y: number; left: number; top: number } | null = null
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      const rect = this.element.getBoundingClientRect()
      start = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top }
      handle.setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    handle.addEventListener('pointermove', (e) => {
      if (!start) return
      const rect = this.element.getBoundingClientRect()
      // Keep a strip of the header reachable on every edge, so a window
      // dragged off the corner can always be dragged back.
      const left = Math.min(
        Math.max(start.left + (e.clientX - start.x), 24 - rect.width),
        window.innerWidth - 24,
      )
      const top = Math.min(Math.max(start.top + (e.clientY - start.y), 0), window.innerHeight - 24)
      this.element.style.left = `${left}px`
      this.element.style.top = `${top}px`
      this.element.style.right = 'auto'
    })
    const end = (e: PointerEvent) => {
      if (start && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      start = null
    }
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
}

/** A `<div class="hud-create-row">` label/control pair, the HUD's own row. */
export function windowRow(label: string, input: HTMLElement, title = ''): HTMLDivElement {
  const div = el('div', { className: 'hud-create-row', title })
  div.append(el('span', { textContent: label }), input)
  return div
}
