// The Node Table panel — a port of the desktop's node_table.py dock.
//
// Flat, sortable table over every row in the scene (World, Camera and World
// Grid rows included: "the table always shows them", and clicking one is the
// documented way to select a node the bulk commands deliberately skip).
//
// Two things about the desktop version are load-bearing and are ported, not
// just its look:
//
//  - Rows are VIRTUALIZED. QTableView draws only the visible viewport, which
//    is what lets it hold Event_Cloud's 209k rows; a DOM table with 209k <tr>
//    is not a slower version of that, it is an unusable one. Only the rows in
//    view (plus a small overscan) exist as elements, and they are pooled and
//    rewritten in place rather than recreated.
//  - Sorting is KEY-BASED over a copy of the node list (nodeTableModel.ts),
//    never a comparator that re-reads whole nodes, and never a mutation of the
//    scene's own array — that array is the CSV's file order.
//
// The display order is also the SELECTION order: the desktop's inspector reads
// `_selected_nodes[0]` off this table's row-ordered selection, so sorting the
// table changes which node is primary. `displayOrder()` is what main.ts asks
// for that, which keeps the two apps agreeing about what "primary" means.

import type { GvNode } from '../gv/types'
import { Panel } from './panel'
import type { NodeColumn, SortDirection } from './nodeTableModel'
import { NODE_TABLE_COLUMNS, NODE_TABLE_WIDTH, sortNodesForTable } from './nodeTableModel'

/** Desktop `vh.setDefaultSectionSize(20)`. */
const ROW_H = 20
const HEADER_H = 22
/** Rows rendered beyond the viewport, so a fast flick doesn't show gaps. */
const OVERSCAN = 6

export interface NodeTableHost {
  /** Replace the selection with these ids, in the order given. */
  selectIds(ids: number[]): void
  /** Add these ids to the current selection (Ctrl+Shift+click range). */
  addIds(ids: number[]): void
  /** Ctrl+click: toggle exactly one row in or out. */
  toggleId(id: number): void
  /**
   * The display order changed (a header click). The primary node may now be a
   * different one, so the host re-derives it from `displayOrder()`.
   */
  orderChanged(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

interface PooledRow {
  root: HTMLDivElement
  cells: HTMLSpanElement[]
  swatch: HTMLSpanElement
}

export class NodeTable {
  readonly panel: Panel

  private host: NodeTableHost
  private scroll = el('div', { className: 'nt-scroll' })
  private inner = el('div', { className: 'nt-inner' })
  private headerRow = el('div', { className: 'nt-header' })
  private footer = el('div', { className: 'nt-footer' })
  private headerCells = new Map<string, HTMLSpanElement>()

  private nodes: readonly GvNode[] = []
  /** Sorted view of `nodes`; identical to it while no column is sorted. */
  private ordered: readonly GvNode[] = []
  /** Set when `nodes` changed and a sort still has to be re-applied. */
  private orderStale = false
  private sortColumn: NodeColumn | null = null
  private sortDirection: SortDirection = 'asc'

  private selected: ReadonlySet<number> = new Set()
  private primary: number | null = null
  /** Row index the next Shift+click extends from (Qt's selection anchor). */
  private anchor: number | null = null

  private pool: PooledRow[] = []
  private rowById = new Map<number, number>()
  private rowMapStale = true
  private firstRendered = -1
  private lastRendered = -1
  private ready = false
  /** True while a row click is calling back into the host (see setSelection). */
  private inRowClick = false

  constructor(host: NodeTableHost) {
    this.host = host
    // Collapsed by default: it is an inspection tool, and a table unrolled
    // over the viewport on every load is in the way of the thing being
    // inspected. The header bar (and Alt+N) is always there to open it.
    this.panel = new Panel({
      id: 'node-table',
      title: 'Node Table',
      hotkey: 'Alt+N',
      collapsed: true,
      onToggle: (collapsed) => {
        if (this.ready && !collapsed) this.onExpand()
      },
    })

    this.buildHeader()
    this.inner.style.width = `${NODE_TABLE_WIDTH}px`
    this.inner.append(this.headerRow)
    this.scroll.append(this.inner)
    this.scroll.addEventListener('scroll', () => this.render(false), { passive: true })
    // The scroll box is user-resizable (CSS `resize: vertical`), and dragging
    // it taller asks for rows that no scroll event will ever request.
    new ResizeObserver(() => this.render(true)).observe(this.scroll)
    this.inner.addEventListener('click', (e) => this.onRowClick(e))
    this.panel.body.append(this.scroll, this.footer)
    this.ready = true
  }

  get element(): HTMLDivElement {
    return this.panel.element
  }

  private buildHeader(): void {
    for (const column of NODE_TABLE_COLUMNS) {
      const cell = el('span', { className: 'nt-head', title: `${column.title}\n(click to sort)` })
      cell.style.width = `${column.width}px`
      cell.dataset.column = column.id
      cell.addEventListener('click', () => this.toggleSort(column))
      this.headerCells.set(column.id, cell)
      this.headerRow.appendChild(cell)
    }
    this.paintHeader()
  }

  /** Column labels plus the Qt-style ▲/▼ indicator on the sorted one. */
  private paintHeader(): void {
    for (const column of NODE_TABLE_COLUMNS) {
      const cell = this.headerCells.get(column.id)!
      const sorted = this.sortColumn?.id === column.id
      cell.textContent = sorted
        ? `${column.label} ${this.sortDirection === 'asc' ? '▲' : '▼'}`
        : column.label
      cell.classList.toggle('sorted', sorted)
    }
  }

  /** Header click: first click sorts ascending, the next flips it (Qt). */
  private toggleSort(column: NodeColumn): void {
    if (this.sortColumn?.id === column.id) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      this.sortColumn = column
      this.sortDirection = 'asc'
    }
    this.orderStale = true
    this.paintHeader()
    this.render(true)
    // Sorting moved the rows, so the first-selected row — the primary — may
    // now be a different node. The host re-reads displayOrder() for it.
    this.host.orderChanged()
  }

  /**
   * The rows in display order. Also the order main.ts resolves the primary
   * node from, so it must stay cheap: with no sort applied this is the scene
   * array itself, with no copy and no work.
   */
  displayOrder(): readonly GvNode[] {
    if (this.orderStale) {
      this.ordered = this.sortColumn
        ? sortNodesForTable(this.nodes, this.sortColumn, this.sortDirection)
        : this.nodes
      this.orderStale = false
      this.rowMapStale = true
    }
    return this.ordered
  }

  private rowOf(nodeId: number): number | undefined {
    if (this.rowMapStale) {
      const order = this.displayOrder()
      this.rowById = new Map()
      for (let i = 0; i < order.length; i++) this.rowById.set(order[i].id, i)
      this.rowMapStale = false
    }
    return this.rowById.get(nodeId)
  }

  /** New scene, or an edit that went through a rebuild. */
  setNodes(nodes: readonly GvNode[]): void {
    this.nodes = nodes
    this.ordered = nodes
    this.orderStale = true
    this.rowMapStale = true
    this.inner.style.height = `${HEADER_H + nodes.length * ROW_H}px`
    this.render(true)
  }

  setSelection(ids: ReadonlySet<number>, primary: number | null): void {
    this.selected = ids
    this.primary = primary
    // Collapsed: remember it and do nothing else — expanding replays both.
    if (this.panel.collapsed) return
    // A selection made elsewhere (a 3D click, Select All Matching, Tab-nav)
    // has no anchor of its own, so the primary row becomes one and a following
    // Shift+click extends from what is on screen. A selection this table made
    // itself keeps the anchor the click set: Qt leaves the anchor put across a
    // Shift+click so the same run can be re-dragged from either end.
    if (!this.inRowClick && primary !== null) this.anchor = this.rowOf(primary) ?? null
    this.render(true)
    if (!this.inRowClick) this.scrollPrimaryIntoView()
  }

  /** Re-opened: the selection and the rows may have moved on without us. */
  private onExpand(): void {
    if (this.primary !== null) this.anchor = this.rowOf(this.primary) ?? null
    this.render(true)
    this.scrollPrimaryIntoView()
  }

  /**
   * Rewrite the rows currently on screen without touching scroll or selection.
   * Channels playback moves values every frame; ~30 visible rows is a trivial
   * repaint, and it is skipped entirely while the panel is collapsed.
   */
  refreshVisible(): void {
    if (this.panel.collapsed) return
    this.render(true)
  }

  private scrollPrimaryIntoView(): void {
    if (this.panel.collapsed || this.primary === null) return
    const row = this.rowOf(this.primary)
    if (row === undefined) return
    const top = row * ROW_H
    const viewTop = this.scroll.scrollTop
    const viewHeight = this.scroll.clientHeight - HEADER_H
    if (top >= viewTop && top + ROW_H <= viewTop + viewHeight) return
    // Land it a little below the sticky header rather than flush against it.
    this.scroll.scrollTop = Math.max(0, top - Math.max(0, viewHeight - ROW_H) / 2)
  }

  private ensurePool(count: number): void {
    while (this.pool.length < count) {
      const root = el('div', { className: 'nt-row' })
      const cells: HTMLSpanElement[] = []
      let swatch: HTMLSpanElement | null = null
      for (const column of NODE_TABLE_COLUMNS) {
        const cell = el('span', { className: 'nt-cell' })
        cell.style.width = `${column.width}px`
        if (column.swatch) {
          swatch = el('span', { className: 'nt-swatch' })
          cell.appendChild(swatch)
          cell.appendChild(document.createTextNode(''))
        }
        cells.push(cell)
        root.appendChild(cell)
      }
      this.inner.appendChild(root)
      this.pool.push({ root, cells, swatch: swatch! })
    }
  }

  /**
   * Draw the visible window. `force` re-writes even when the window has not
   * moved (the data or the selection changed under it); a plain scroll passes
   * false and returns immediately whenever the same rows are already up.
   */
  private render(force: boolean): void {
    if (this.panel.collapsed) return
    const order = this.displayOrder()
    const total = order.length
    const viewHeight = Math.max(0, this.scroll.clientHeight - HEADER_H)
    const first = Math.max(0, Math.floor(this.scroll.scrollTop / ROW_H) - OVERSCAN)
    const last = Math.min(total, Math.ceil((this.scroll.scrollTop + viewHeight) / ROW_H) + OVERSCAN)
    if (!force && first === this.firstRendered && last === this.lastRendered) return
    this.firstRendered = first
    this.lastRendered = last

    const count = Math.max(0, last - first)
    this.ensurePool(count)
    const colorIndex = NODE_TABLE_COLUMNS.findIndex((c) => c.swatch)

    for (let k = 0; k < this.pool.length; k++) {
      const row = this.pool[k]
      if (k >= count) {
        row.root.hidden = true
        continue
      }
      const index = first + k
      const node = order[index]
      row.root.hidden = false
      row.root.style.top = `${HEADER_H + index * ROW_H}px`
      row.root.dataset.row = String(index)
      row.root.classList.toggle('odd', index % 2 === 1)
      row.root.classList.toggle('selected', this.selected.has(node.id))
      row.root.classList.toggle('primary', node.id === this.primary)
      for (let c = 0; c < NODE_TABLE_COLUMNS.length; c++) {
        const text = NODE_TABLE_COLUMNS[c].text(node)
        if (c === colorIndex) {
          // The swatch element has to survive, so only the trailing text node
          // is rewritten (textContent would drop the swatch with it).
          row.cells[c].lastChild!.nodeValue = text
          row.swatch.style.background = text
        } else if (row.cells[c].textContent !== text) {
          row.cells[c].textContent = text
        }
      }
    }

    const sorted = this.sortColumn
      ? ` · sorted by ${this.sortColumn.label} ${this.sortDirection === 'asc' ? '▲' : '▼'}`
      : ' · file order'
    this.footer.textContent =
      `${total} row(s)${sorted} · ${this.selected.size} selected` +
      ' — click selects · Ctrl+click toggles · Shift+click extends'
  }

  /**
   * Qt ExtendedSelection over rows: plain click replaces, Ctrl+click toggles,
   * Shift+click takes the run from the anchor, Ctrl+Shift+click adds that run.
   */
  private onRowClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement | null)?.closest('.nt-row')
    if (!(target instanceof HTMLElement) || target.dataset.row === undefined) return
    const index = Number(target.dataset.row)
    const order = this.displayOrder()
    const node = order[index]
    if (!node) return
    const additive = e.ctrlKey || e.metaKey

    this.inRowClick = true
    try {
      if (e.shiftKey && this.anchor !== null) {
        // Qt keeps the anchor put across a Shift+click, so the run can be
        // re-dragged from either end.
        const from = Math.min(this.anchor, index)
        const to = Math.max(this.anchor, index)
        const ids: number[] = []
        for (let i = from; i <= to; i++) ids.push(order[i].id)
        if (additive) this.host.addIds(ids)
        else this.host.selectIds(ids)
        return
      }
      this.anchor = index
      if (additive) this.host.toggleId(node.id)
      else this.host.selectIds([node.id])
    } finally {
      this.inRowClick = false
    }
  }
}
