// Editable node inspector panel (interaction phase 6b, multi-select 6f).
// Read-only identity rows on top; every CSV-backed visual field below is a
// live control that mutates the parsed node(s) on commit ('change' event =
// blur/Enter) and asks the host to rebuild the scene. Structural fields (id,
// parent, branch level) stay read-only — reparenting is a later, deliberate
// feature.
//
// Multi-selection follows the desktop (main_window.py _on_insp_* handlers):
// the fields show the PRIMARY node's values (first selected in scene row
// order), and editing one applies to every selected node —
//
//   - translate and rotate apply the DELTA from the value the field was
//     showing, so a mixed selection keeps its relative arrangement and just
//     shifts/turns as a group;
//   - every other field applies its new value ABSOLUTELY to all of them.
//
// A single selection is the same code path: the anchor equals the node's own
// value, so `+= (new − anchor)` is just `= new`.

import { shiftAxis } from '../gv/multiEdit'
import type { VectorField } from '../gv/multiEdit'
import type { GvNode, Vec3 } from '../gv/types'
import { GEOMETRY_NAMES, NODE_TYPE_NAMES, RotationMode, TOPO_NAMES } from '../gv/types'
import { Panel } from './panel'

export interface InspectorHost {
  /** Called after an edit mutates the selection: rebuild scene, then re-show. */
  onNodesEdited(nodes: GvNode[]): void
}

export interface WorldPos {
  x: number
  y: number
  z: number
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

function row(label: string, ...controls: Array<HTMLElement | string>): HTMLDivElement {
  const div = el('div', { className: 'ins-row' })
  div.appendChild(el('span', { className: 'ins-label', textContent: label }))
  const value = el('span', { className: 'ins-value' })
  for (const c of controls) {
    value.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  div.appendChild(value)
  return div
}

function fmt(v: number): string {
  return Number(v.toFixed(6)).toString()
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Read-only rows show the shared value, or "(multiple)" when they differ. */
function shared<T>(nodes: GvNode[], get: (n: GvNode) => T, render: (v: T) => string): string {
  const first = get(nodes[0])
  return nodes.every((n) => get(n) === first) ? render(first) : '(multiple)'
}

export class Inspector {
  readonly panel: Panel

  private nodes: GvNode[] = []
  private host: InspectorHost
  /** Values the translate/rotate fields are currently showing (see header). */
  private anchorTranslate: Vec3 = { x: 0, y: 0, z: 0 }
  private anchorRotate: Vec3 = { x: 0, y: 0, z: 0 }

  constructor(host: InspectorHost) {
    this.host = host
    this.panel = new Panel({ id: 'inspector', title: 'Properties', hotkey: 'Ctrl+P' })
    this.clear()
  }

  get element(): HTMLDivElement {
    return this.panel.element
  }

  /** No selection: keep the panel (and its shortcut) on screen, just empty. */
  clear(): void {
    this.nodes = []
    this.panel.body.replaceChildren(el('div', { className: 'ins-empty', textContent: 'No selection' }))
  }

  show(nodes: GvNode[], worldPos: WorldPos | null): void {
    if (nodes.length === 0) {
      this.clear()
      return
    }
    this.nodes = nodes
    const primary = nodes[0]
    this.anchorTranslate = { ...primary.translate }
    this.anchorRotate = { ...primary.rotate }
    this.panel.body.replaceChildren(...this.build(nodes, worldPos))
  }

  /** Mutate every selected node and hand off to the host for rebuild+refresh. */
  private commit(mutate: (n: GvNode) => void): void {
    if (this.nodes.length === 0) return
    for (const node of this.nodes) mutate(node)
    this.host.onNodesEdited(this.nodes)
  }

  private numberInput(
    value: number,
    apply: (v: number) => void,
    opts: { min?: number; max?: number; integer?: boolean; width?: string } = {},
  ): HTMLInputElement {
    const input = el('input', { type: 'number', value: fmt(value) })
    input.step = 'any'
    if (opts.min !== undefined) input.min = String(opts.min)
    if (opts.max !== undefined) input.max = String(opts.max)
    if (opts.width) input.style.width = opts.width
    input.addEventListener('change', () => {
      let v = Number(input.value)
      if (!Number.isFinite(v)) {
        input.value = fmt(value)
        return
      }
      if (opts.integer) v = Math.trunc(v)
      if (opts.min !== undefined) v = Math.max(opts.min, v)
      if (opts.max !== undefined) v = Math.min(opts.max, v)
      apply(v)
    })
    return input
  }

  /** translate/rotate: shift the whole selection by the field's change. */
  private deltaVec3Row(label: string, field: VectorField, anchor: Vec3): HTMLDivElement {
    const axisInput = (axis: 'x' | 'y' | 'z') =>
      this.numberInput(field(this.nodes[0])[axis], (v) => {
        shiftAxis(this.nodes, field, axis, anchor, v)
        this.host.onNodesEdited(this.nodes)
      })
    return row(label, axisInput('x'), axisInput('y'), axisInput('z'))
  }

  /** scale and the other vectors: the typed value lands on every node as-is. */
  private absoluteVec3Row(label: string, field: VectorField): HTMLDivElement {
    const axisInput = (axis: 'x' | 'y' | 'z') =>
      this.numberInput(field(this.nodes[0])[axis], (v) => this.commit((n) => (field(n)[axis] = v)))
    return row(label, axisInput('x'), axisInput('y'), axisInput('z'))
  }

  private idSelect(
    names: Record<number, string>,
    value: number,
    apply: (n: GvNode, v: number) => void,
  ): HTMLSelectElement {
    const select = el('select')
    const ids = Object.keys(names).map(Number).sort((a, b) => a - b)
    for (const id of ids) {
      select.appendChild(el('option', { value: String(id), textContent: `${names[id]} (${id})` }))
    }
    if (!ids.includes(value)) {
      select.appendChild(el('option', { value: String(value), textContent: `Unknown (${value})` }))
    }
    select.value = String(value)
    select.addEventListener('change', () =>
      this.commit((n) => apply(n, Number(select.value))),
    )
    return select
  }

  private textInput(value: string, apply: (n: GvNode, v: string) => void): HTMLInputElement {
    const input = el('input', { type: 'text', value })
    input.addEventListener('change', () => this.commit((n) => apply(n, input.value)))
    return input
  }

  private build(nodes: GvNode[], worldPos: WorldPos | null): HTMLElement[] {
    const primary = nodes[0]
    const multi = nodes.length > 1

    const swatch = el('span', { id: 'ins-swatch' })
    swatch.style.background = toHex(primary.color.r, primary.color.g, primary.color.b)
    const title = el('div', { id: 'ins-title' })
    title.append(swatch, multi ? `${nodes.length} nodes selected` : `Node ${primary.id}`)

    const parts: HTMLElement[] = [
      title,
      row('type', shared(nodes, (n) => n.type, (t) => `${NODE_TYPE_NAMES[t] ?? 'Glyph-like'} (${t})`)),
      row('parent', shared(nodes, (n) => n.parentId, (p) => (p === 0 ? 'root (0)' : String(p)))),
      row('branch level', shared(nodes, (n) => n.branchLevel, String)),
    ]
    if (multi) {
      parts.push(
        row('editing', `primary: node ${primary.id}`),
        el('div', {
          className: 'ins-note',
          textContent: 'translate/rotate shift the whole selection; other fields apply to all',
        }),
      )
    } else if (worldPos) {
      parts.push(
        row(
          'world pos',
          `${worldPos.x.toFixed(4)}, ${worldPos.y.toFixed(4)}, ${worldPos.z.toFixed(4)}`,
        ),
      )
    }

    parts.push(
      this.deltaVec3Row('translate', (n) => n.translate, this.anchorTranslate),
      this.deltaVec3Row('rotate', (n) => n.rotate, this.anchorRotate),
      row(
        'rot. mode',
        this.idSelect(
          {
            [RotationMode.EulerXYZ]: 'Euler XYZ',
            [RotationMode.HeadingTiltRoll]: 'Heading/Tilt/Roll',
          },
          primary.rotationMode,
          (n, v) => (n.rotationMode = v),
        ),
      ),
      this.absoluteVec3Row('scale', (n) => n.scale),
    )

    const colorPicker = el('input', {
      type: 'color',
      value: toHex(primary.color.r, primary.color.g, primary.color.b),
    })
    colorPicker.addEventListener('change', () => {
      const hex = colorPicker.value
      this.commit((n) => {
        n.color.r = parseInt(hex.slice(1, 3), 16)
        n.color.g = parseInt(hex.slice(3, 5), 16)
        n.color.b = parseInt(hex.slice(5, 7), 16)
      })
    })
    parts.push(
      row(
        'color / alpha',
        colorPicker,
        this.numberInput(primary.color.a, (v) => this.commit((n) => (n.color.a = v)), {
          min: 0,
          max: 255,
          integer: true,
          width: '54px',
        }),
      ),
      row('geometry', this.idSelect(GEOMETRY_NAMES, primary.geometry, (n, v) => (n.geometry = v))),
      row('topo', this.idSelect(TOPO_NAMES, primary.topo, (n, v) => (n.topo = v))),
      row(
        'ratio',
        this.numberInput(primary.ratio, (v) => this.commit((n) => (n.ratio = v)), { width: '70px' }),
      ),
      row(
        'facet',
        this.numberInput(primary.subspace + 1, (v) => this.commit((n) => (n.subspace = v - 1)), {
          min: 1,
          max: 6,
          integer: true,
          width: '54px',
        }),
      ),
    )

    const hide = el('input', { type: 'checkbox', checked: primary.hide !== 0 })
    hide.addEventListener('change', () => this.commit((n) => (n.hide = hide.checked ? 1 : 0)))
    parts.push(
      row('hide', hide),
      row('text', this.textInput(primary.text, (n, v) => (n.text = v))),
      row('link', this.textInput(primary.link, (n, v) => (n.link = v))),
    )

    if (!multi) {
      const extras = Object.keys(primary.extras)
      if (extras.length > 0) {
        parts.push(row('extras', `${extras.length} column(s): ${extras.join(', ')}`))
      }
    }
    parts.push(
      el('div', {
        id: 'ins-hint',
        textContent: 'Edits apply on Enter/blur · Esc deselect · double-click recenters',
      }),
    )
    return parts
  }
}
