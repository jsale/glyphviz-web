// Collapsible HUD panel chrome.
//
// Collapsing hides the body but keeps the header bar on screen, so a panel is
// never lost — the caret and its keyboard shortcut are always there to bring
// it back. Clicking the header toggles; the host wires the shortcut.

export interface PanelOptions {
  /** DOM id for the panel root (also the CSS hook). */
  id: string
  title: string
  /** Shown greyed in the header, e.g. 'Ctrl+P'. */
  hotkey?: string
  collapsed?: boolean
  /**
   * Fired whenever the collapsed state changes, however it changed (header
   * click, hotkey, or a direct assignment). A panel whose body is expensive to
   * fill — the Node Table's virtualized rows — uses this to do that work only
   * while it is actually on screen.
   */
  onToggle?: (collapsed: boolean) => void
}

export class Panel {
  readonly element: HTMLDivElement
  readonly body: HTMLDivElement

  private header: HTMLButtonElement
  private caret: HTMLSpanElement
  private isCollapsed = false
  private onToggle?: (collapsed: boolean) => void

  constructor(options: PanelOptions) {
    this.onToggle = options.onToggle
    this.element = document.createElement('div')
    this.element.id = options.id
    this.element.className = 'panel'

    this.header = document.createElement('button')
    this.header.className = 'panel-header'
    this.header.type = 'button'

    this.caret = document.createElement('span')
    this.caret.className = 'panel-caret'

    const title = document.createElement('span')
    title.className = 'panel-title'
    title.textContent = options.title

    this.header.append(this.caret, title)
    if (options.hotkey) {
      const hint = document.createElement('span')
      hint.className = 'panel-hotkey'
      hint.textContent = options.hotkey
      this.header.appendChild(hint)
    }
    this.header.addEventListener('click', () => this.toggle())

    this.body = document.createElement('div')
    this.body.className = 'panel-body'

    this.element.append(this.header, this.body)
    this.collapsed = options.collapsed ?? false
  }

  get collapsed(): boolean {
    return this.isCollapsed
  }

  set collapsed(value: boolean) {
    this.isCollapsed = value
    this.body.hidden = value
    this.element.classList.toggle('collapsed', value)
    this.caret.textContent = value ? '▸' : '▾'
    this.header.title = value ? 'Expand' : 'Collapse'
    this.onToggle?.(value)
  }

  toggle(): void {
    this.collapsed = !this.collapsed
  }
}
