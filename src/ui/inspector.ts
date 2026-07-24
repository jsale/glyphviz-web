// Editable node inspector panel (interaction phase 6b). Read-only identity
// rows on top; every CSV-backed visual field below is a live control that
// mutates the parsed node on commit ('change' event = blur/Enter) and asks
// the host to rebuild the scene. Structural fields (id, parent, branch
// level) stay read-only — reparenting is a later, deliberate feature.

import type { GvNode } from '../gv/types'
import {
  GEOMETRY_NAMES,
  NODE_TYPE_NAMES,
  RotationMode,
  TOPO_NAMES,
} from '../gv/types'

export interface InspectorHost {
  /** Called after an edit mutates the node: rebuild scene, then re-show. */
  onNodeEdited(node: GvNode): void
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

export class Inspector {
  readonly element: HTMLDivElement

  private node: GvNode | null = null
  private host: InspectorHost

  constructor(host: InspectorHost) {
    this.host = host
    this.element = el('div', { id: 'inspector', hidden: true })
  }

  hide(): void {
    this.element.hidden = true
    this.node = null
  }

  show(node: GvNode, worldPos: WorldPos | null): void {
    this.node = node
    this.element.replaceChildren(...this.build(node, worldPos))
    this.element.hidden = false
  }

  /** Mutate the current node and hand off to the host for rebuild+refresh. */
  private commit(mutate: (n: GvNode) => void): void {
    if (!this.node) return
    mutate(this.node)
    this.host.onNodeEdited(this.node)
  }

  private numberInput(
    value: number,
    apply: (n: GvNode, v: number) => void,
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
      this.commit((n) => apply(n, v))
    })
    return input
  }

  private vec3Row(
    label: string,
    get: (n: GvNode) => { x: number; y: number; z: number },
  ): HTMLDivElement {
    const node = this.node!
    return row(
      label,
      this.numberInput(get(node).x, (n, v) => (get(n).x = v)),
      this.numberInput(get(node).y, (n, v) => (get(n).y = v)),
      this.numberInput(get(node).z, (n, v) => (get(n).z = v)),
    )
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
    select.addEventListener('change', () => this.commit((n) => apply(n, Number(select.value))))
    return select
  }

  private textInput(value: string, apply: (n: GvNode, v: string) => void): HTMLInputElement {
    const input = el('input', { type: 'text', value })
    input.addEventListener('change', () => this.commit((n) => apply(n, input.value)))
    return input
  }

  private build(node: GvNode, worldPos: WorldPos | null): HTMLElement[] {
    const swatch = el('span', { id: 'ins-swatch' })
    swatch.style.background = toHex(node.color.r, node.color.g, node.color.b)
    const title = el('div', { id: 'ins-title' })
    title.append(swatch, `Node ${node.id}`)

    const typeName = NODE_TYPE_NAMES[node.type] ?? 'Glyph-like'
    const parts: HTMLElement[] = [
      title,
      row('type', `${typeName} (${node.type})`),
      row('parent', node.parentId === 0 ? 'root (0)' : String(node.parentId)),
      row('branch level', String(node.branchLevel)),
    ]
    if (worldPos) {
      parts.push(
        row('world pos', `${worldPos.x.toFixed(4)}, ${worldPos.y.toFixed(4)}, ${worldPos.z.toFixed(4)}`),
      )
    }

    parts.push(
      this.vec3Row('translate', (n) => n.translate),
      this.vec3Row('rotate', (n) => n.rotate),
      row(
        'rot. mode',
        this.idSelect(
          { [RotationMode.EulerXYZ]: 'Euler XYZ', [RotationMode.HeadingTiltRoll]: 'Heading/Tilt/Roll' },
          node.rotationMode,
          (n, v) => (n.rotationMode = v),
        ),
      ),
      this.vec3Row('scale', (n) => n.scale),
    )

    const colorPicker = el('input', { type: 'color', value: toHex(node.color.r, node.color.g, node.color.b) })
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
        this.numberInput(node.color.a, (n, v) => (n.color.a = v), {
          min: 0,
          max: 255,
          integer: true,
          width: '54px',
        }),
      ),
      row('geometry', this.idSelect(GEOMETRY_NAMES, node.geometry, (n, v) => (n.geometry = v))),
      row('topo', this.idSelect(TOPO_NAMES, node.topo, (n, v) => (n.topo = v))),
      row(
        'ratio',
        this.numberInput(node.ratio, (n, v) => (n.ratio = v), { width: '70px' }),
      ),
      row(
        'facet',
        this.numberInput(node.subspace + 1, (n, v) => (n.subspace = v - 1), {
          min: 1,
          max: 6,
          integer: true,
          width: '54px',
        }),
      ),
    )

    const hide = el('input', { type: 'checkbox', checked: node.hide !== 0 })
    hide.addEventListener('change', () => this.commit((n) => (n.hide = hide.checked ? 1 : 0)))
    parts.push(
      row('hide', hide),
      row('text', this.textInput(node.text, (n, v) => (n.text = v))),
      row('link', this.textInput(node.link, (n, v) => (n.link = v))),
    )

    const extras = Object.keys(node.extras)
    if (extras.length > 0) {
      parts.push(row('extras', `${extras.length} column(s): ${extras.join(', ')}`))
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
