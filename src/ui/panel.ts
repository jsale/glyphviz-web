// HUD panel chrome, in three states rather than two.
//
//   open      header bar + body
//   collapsed header bar only — parked, but still on screen and clickable
//   closed    nothing at all — the panel leaves no pixels behind
//
// Closed exists because a collapsed panel still puts a bar over the scene, and
// a screengrab of an otherwise pristine viewport is one of the things users
// actually want. Collapsed stays because it is the only state a MOUSE can get
// back from: once a panel is closed its hotkey is the only way in, so the
// header bar is what keeps a parked panel discoverable. The hotkey cycles all
// three; the header click stays a plain open/collapsed toggle (clicking a
// header should never make the thing you clicked vanish), and the × closes.

export type PanelMode = 'open' | 'collapsed' | 'closed'

/**
 * Hotkey step: open → collapsed → closed → open, with one rule on top —
 * **the hotkey only shrinks a panel further when the hotkey is what shrank
 * it.** Reaching for a panel's key when the panel is parked always opens it.
 *
 * Without that, the key would be a plain 3-cycle and the Node Table (which
 * starts collapsed, so its header bar can advertise Alt+N) would answer the
 * very first Alt+N by vanishing — the opposite of what the press asked for.
 * `shrinking` also resets on a header click, so a panel collapsed with the
 * mouse opens on the next key press rather than closing.
 */
export function nextPanelMode(
  mode: PanelMode,
  shrinking: boolean,
): { mode: PanelMode; shrinking: boolean } {
  if (mode === 'open') return { mode: 'collapsed', shrinking: true }
  if (mode === 'collapsed' && shrinking) return { mode: 'closed', shrinking: true }
  return { mode: 'open', shrinking: false }
}

/**
 * Bubbled on every mode change, so the host can report a close in the status
 * bar — a closed panel is otherwise invisible, and its hotkey is the only way
 * back. Listen on `document`.
 */
export const PANEL_MODE_EVENT = 'panelmodechange'

export interface PanelModeChangeDetail {
  mode: PanelMode
  title: string
  hotkey?: string
}

export interface PanelOptions {
  /** DOM id for the panel root (also the CSS hook). */
  id: string
  title: string
  /** Shown greyed in the header, e.g. 'Ctrl+P'. */
  hotkey?: string
  mode?: PanelMode
  /**
   * Fired whenever the mode changes, however it changed (header click, ×,
   * hotkey, or a direct assignment). A panel whose body is expensive to fill —
   * the Node Table's virtualized rows — uses this to do that work only while
   * it is actually on screen.
   */
  onModeChange?: (mode: PanelMode) => void
}

export class Panel {
  readonly element: HTMLDivElement
  readonly body: HTMLDivElement

  private header: HTMLDivElement
  private headerButton: HTMLButtonElement
  private closeButton: HTMLButtonElement
  private caret: HTMLSpanElement
  private currentMode: PanelMode = 'open'
  /** True when the hotkey is the reason this panel is parked — see cycle(). */
  private shrinking = false
  private title: string
  private hotkey?: string
  private onModeChange?: (mode: PanelMode) => void

  constructor(options: PanelOptions) {
    this.onModeChange = options.onModeChange
    this.title = options.title
    this.hotkey = options.hotkey
    this.element = document.createElement('div')
    this.element.id = options.id
    this.element.className = 'panel'

    this.header = document.createElement('div')
    this.header.className = 'panel-header'

    this.headerButton = document.createElement('button')
    this.headerButton.className = 'panel-header-main'
    this.headerButton.type = 'button'

    this.caret = document.createElement('span')
    this.caret.className = 'panel-caret'

    const title = document.createElement('span')
    title.className = 'panel-title'
    title.textContent = options.title

    this.headerButton.append(this.caret, title)
    if (options.hotkey) {
      const hint = document.createElement('span')
      hint.className = 'panel-hotkey'
      hint.textContent = options.hotkey
      this.headerButton.appendChild(hint)
    }
    this.headerButton.addEventListener('click', () => this.toggle())

    this.closeButton = document.createElement('button')
    this.closeButton.className = 'panel-close'
    this.closeButton.type = 'button'
    this.closeButton.textContent = '×'
    this.closeButton.title = options.hotkey
      ? `Close this panel  (${options.hotkey} brings it back)`
      : 'Close this panel'
    this.closeButton.addEventListener('click', () => (this.mode = 'closed'))

    this.header.append(this.headerButton, this.closeButton)

    this.body = document.createElement('div')
    this.body.className = 'panel-body'

    this.element.append(this.header, this.body)
    this.mode = options.mode ?? 'open'
  }

  get mode(): PanelMode {
    return this.currentMode
  }

  set mode(value: PanelMode) {
    this.currentMode = value
    const bodyHidden = value !== 'open'
    this.body.hidden = bodyHidden
    this.element.hidden = value === 'closed'
    this.element.classList.toggle('collapsed', bodyHidden)
    this.element.classList.toggle('closed', value === 'closed')
    this.caret.textContent = bodyHidden ? '▸' : '▾'
    this.headerButton.title = bodyHidden ? 'Expand' : 'Collapse'
    this.onModeChange?.(value)
    this.element.dispatchEvent(
      new CustomEvent<PanelModeChangeDetail>(PANEL_MODE_EVENT, {
        bubbles: true,
        detail: { mode: value, title: this.title, hotkey: this.hotkey },
      }),
    )
  }

  /** True whenever the body is off screen — collapsed OR closed. */
  get collapsed(): boolean {
    return this.currentMode !== 'open'
  }

  /** Header click: open ↔ collapsed, never straight to closed. */
  toggle(): void {
    this.shrinking = false // a mouse-collapsed panel opens on the next hotkey
    this.mode = this.currentMode === 'open' ? 'collapsed' : 'open'
  }

  /** Hotkey: open → collapsed → closed → open (see nextPanelMode). */
  cycle(): void {
    const next = nextPanelMode(this.currentMode, this.shrinking)
    this.shrinking = next.shrinking
    this.mode = next.mode
  }
}
