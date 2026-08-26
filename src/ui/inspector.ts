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

import { PALETTE_NAMES, paletteIndexCount, setColorIndex, setPalette } from '../gv/colorPalette'
import { stepTextureId, textureChoices } from '../gv/media'
import type { MediaIndex } from '../gv/media'
import { hasCaps, isInteriorCylinder, withCaps } from '../gv/interiorGeometry'
import { shiftAxis } from '../gv/multiEdit'
import type { VectorField } from '../gv/multiEdit'
import type { GvNode, Vec3 } from '../gv/types'
import {
  DEFAULT_TOPO_SCALE,
  GEOMETRY_NAMES,
  Geometry,
  NODE_TYPE_NAMES,
  NodeType,
  RotationMode,
  TOPO_NAMES,
  TOPO_SCALE_ANTZ,
} from '../gv/types'
import { gridIsGlobe } from '../gv/worldGrid'
import { MAX_TAGS_PER_FRAME } from '../render/labelOverlay'
import { meshChoices } from '../render/meshLibrary'
import type { MeshLibrary } from '../render/meshLibrary'
import { Panel } from './panel'
import {
  sliderToTopoScale,
  TOPO_SCALE_MAX,
  TOPO_SCALE_MIN,
  TOPO_SCALE_SLIDER_MAX,
  topoScaleToSlider,
} from './topoScale'

export interface EditNotes {
  /**
   * The edit changed `topo`. The host follows a topology change with the
   * scattered-children hint (desktop `_on_insp_topo_changed`'s tail), which
   * would be noise on any other field.
   */
  topologyChanged?: boolean
}

export interface InspectorHost {
  /** Called after an edit mutates the selection: rebuild scene, then re-show. */
  onNodesEdited(nodes: GvNode[], notes?: EditNotes): void
  /** Fetch Basemap… pressed with a single flat World Grid selected. */
  onFetchBasemap(grid: GvNode): void
  /**
   * "Lock X/Y/Z together" was ticked or cleared. The same checkbox governs
   * Scale-mode gizmo drags (desktop `_on_scale_lock_toggled` → `Viewport.
   * uniform_scale`), so the host has to hear about it.
   */
  onScaleLockChanged(locked: boolean): void
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
  /** The loaded scene's media folder, naming the ids the texture row offers. */
  private media: MediaIndex | null = null
  /** Imported models, which the geometry row lists below the built-in shapes. */
  private meshes: MeshLibrary | null = null
  /** Values the translate/rotate fields are currently showing (see header). */
  private anchorTranslate: Vec3 = { x: 0, y: 0, z: 0 }
  private anchorRotate: Vec3 = { x: 0, y: 0, z: 0 }
  /**
   * "Lock X/Y/Z together" (desktop `_insp_scale_lock`). A panel-wide setting,
   * not a per-node one, so it lives here and survives the rebuild every edit
   * triggers — and the selection changing under it.
   */
  private scaleLocked = false

  constructor(host: InspectorHost) {
    this.host = host
    this.panel = new Panel({ id: 'inspector', title: 'Properties', hotkey: 'Ctrl+P' })
    this.clear()
  }

  get element(): HTMLDivElement {
    return this.panel.element
  }

  /**
   * Tell the panel which media the loaded scene supplies (null for a bare CSV,
   * which has no folder to step through). Set before the first show of a
   * scene; the texture row falls back to a plain id field without it.
   */
  setMedia(index: MediaIndex | null): void {
    this.media = index
  }

  /**
   * The session's imported meshes. Held by reference, not copied: the library
   * outlives every scene load (as the desktop's does), and an import made while
   * a node is selected has to show up the next time the panel is built.
   */
  setMeshes(library: MeshLibrary): void {
    this.meshes = library
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
    // Every edit rebuilds this panel through the host, which throws away the
    // control that was just used. Keyed controls come back focused, so the
    // texture steppers can be clicked (or held down on the keyboard) in a run.
    const focusKey =
      document.activeElement instanceof HTMLElement &&
      this.panel.body.contains(document.activeElement)
        ? (document.activeElement.dataset.insKey ?? null)
        : null
    this.panel.body.replaceChildren(...this.build(nodes, worldPos))
    if (focusKey) {
      this.panel.body.querySelector<HTMLElement>(`[data-ins-key="${focusKey}"]`)?.focus()
    }
  }

  /** Mutate every selected node and hand off to the host for rebuild+refresh. */
  private commit(mutate: (n: GvNode) => void, notes?: EditNotes): void {
    if (this.nodes.length === 0) return
    for (const node of this.nodes) mutate(node)
    this.host.onNodesEdited(this.nodes, notes)
  }

  private numberInput(
    value: number,
    apply: (v: number) => void,
    opts: {
      min?: number
      max?: number
      integer?: boolean
      width?: string
      title?: string
    } = {},
  ): HTMLInputElement {
    const input = el('input', { type: 'number', value: fmt(value) })
    input.step = 'any'
    if (opts.min !== undefined) input.min = String(opts.min)
    if (opts.max !== undefined) input.max = String(opts.max)
    if (opts.width) input.style.width = opts.width
    if (opts.title) input.title = opts.title
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

  /**
   * scale: the typed value lands on every selected node as-is (unlike
   * translate/rotate, which shift by the delta), plus the Lock X/Y/Z rule —
   * with the lock on, a value typed into ANY of the three boxes lands on all
   * three, on every selected node.
   *
   * The panel equalizes where a drag can only share a FACTOR (see
   * `uniformScaleFactor`): a spin box states an absolute size, and "make it
   * 2.0" honestly means all three. Desktop `_on_insp_scale_changed`, whose
   * locked branch pushes the sender's value into the other two boxes before
   * writing all three out.
   */
  private scaleRow(): HTMLDivElement {
    const axisInput = (axis: 'x' | 'y' | 'z') =>
      this.numberInput(this.nodes[0].scale[axis], (v) =>
        this.commit((n) => {
          if (this.scaleLocked) {
            n.scale.x = n.scale.y = n.scale.z = v
          } else {
            n.scale[axis] = v
          }
        }),
      )
    return row('scale', axisInput('x'), axisInput('y'), axisInput('z'))
  }

  /**
   * "Lock X/Y/Z together", the desktop's one checkbox for one idea — these
   * three move as a unit. It governs BOTH the boxes above and Scale-mode gizmo
   * drags, which is why the host hears about it (`onScaleLockChanged`); a
   * second checkbox on the gizmo buttons meaning nearly the same thing is what
   * the desktop deliberately avoided.
   *
   * Ticking it deliberately does NOT equalize what is already there (desktop
   * `_on_scale_lock_toggled` only records the flag, as does the Glyph
   * Composer's copy of this control): the next edit is what pulls the other
   * two along, so arming the lock can never silently reshape a glyph.
   */
  private scaleLockRow(): HTMLLabelElement {
    const box = el('input', { type: 'checkbox', checked: this.scaleLocked })
    box.addEventListener('change', () => {
      this.scaleLocked = box.checked
      this.host.onScaleLockChanged(box.checked)
    })
    const label = el('label', {
      className: 'ins-check',
      title:
        'Keep the three scale axes tied together.\n' +
        'In the boxes above: editing one axis sets all three to the same value.\n' +
        'In Scale mode (R): dragging any handle applies the same factor to all\n' +
        'three, so the glyph keeps its proportions rather than being flattened.\n' +
        'Ticking it changes nothing on its own — the next edit is what ties them.',
    })
    label.append(box, document.createTextNode('Lock X/Y/Z together'))
    return label
  }

  /** Whether Scale-mode drags share one factor across all three axes. */
  get isScaleLocked(): boolean {
    return this.scaleLocked
  }

  /**
   * translate_rate / rotate_rate / scale_rate: ANTz per-cycle VELOCITIES the
   * viewport integrates (nominally 60 cycles/second — see gv/rates.ts), not
   * values. A nonzero axis keeps the node moving for as long as the scene is
   * open, with or without Channels.
   *
   * Ported from the desktop's three rate spinbox groups (_on_insp_translate_
   * rate_changed and friends), including their ranges — a value that cannot be
   * authored there cannot be typed here either — and their tooltip wording.
   * The value applies ABSOLUTELY to every selected node, like scale and unlike
   * translate/rotate, which shift by the delta.
   *
   * Divergence: the desktop writes all THREE axes onto every selected node
   * from whatever its spinboxes show (one handler serves the group), so
   * editing X on a mixed selection also flattens Y and Z onto the primary's
   * values. This app's absolute vector rows have always been per axis
   * (`absoluteVec3Row` is the same code path scale uses), and that is what
   * these do.
   *
   * Deliberately NOT keyed with `data-ins-key`: a keyed control comes back
   * focused after the rebuild an edit triggers, which suits the texture
   * steppers (buttons, clicked in a run) but not a text field — the viewport's
   * single-key commands and Ctrl chords stand down while a field has focus, so
   * parking focus here would silently swallow the next J/T/Space/Ctrl+A. The
   * neighbouring translate/rotate/scale rows drop focus on commit; so do these.
   */
  private rateRow(
    label: string,
    field: VectorField,
    limit: number,
    tip: string,
    zTip?: string,
  ): HTMLDivElement {
    const axisInput = (axis: 'x' | 'y' | 'z') => {
      const input = this.numberInput(
        field(this.nodes[0])[axis],
        (v) => this.commit((n) => (field(n)[axis] = v)),
        { min: -limit, max: limit },
      )
      input.title = axis === 'z' && zTip ? `${tip}\n${zTip}` : tip
      input.className = `ins-rate ins-rate-${axis}`
      return input
    }
    return row(label, axisInput('x'), axisInput('y'), axisInput('z'))
  }

  private idSelect(
    names: Record<number, string>,
    value: number,
    apply: (n: GvNode, v: number) => void,
    notes?: EditNotes,
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
      this.commit((n) => apply(n, Number(select.value)), notes),
    )
    return select
  }

  /**
   * texture_id: pick a file out of the scene's media folder, or step through
   * it with the ‹ › buttons.
   *
   * The value applies ABSOLUTELY to every selected node, like the desktop's
   * Texture ID spinbox (_on_insp_texture_id_changed). Without a media folder
   * there is no list to offer, so the row degrades to that same plain id
   * field — an id can be authored before the media it names exists.
   */
  private textureRow(primary: GvNode): HTMLDivElement {
    const setId = (v: number) => this.commit((n) => (n.textureId = v))
    if (!this.media || this.media.entries.length === 0) {
      const input = this.numberInput(primary.textureId, setId, {
        min: 0,
        integer: true,
        width: '70px',
      })
      input.title =
        'texture_id: 0 = none, 1 = first file in the scene’s media/ folder. ' +
        'Open the scene as a folder or .zip to pick by name.'
      return row('texture', input)
    }

    const choices = textureChoices(this.media, primary.textureId)
    const select = el('select', { className: 'ins-tex' })
    select.dataset.insKey = 'texture'
    for (const choice of choices) {
      select.appendChild(el('option', { value: String(choice.id), textContent: choice.label }))
    }
    select.value = String(primary.textureId)
    // The panel is 300px wide, so a long file name is elided in the closed
    // control — the tooltip is where you can still read which file it is.
    const currentLabel = choices.find((c) => c.id === primary.textureId)?.label ?? ''
    select.title = `Media file drawn on this node (texture_id).\n${currentLabel}`
    select.addEventListener('change', () => setId(Number(select.value)))

    const stepButton = (direction: 1 | -1, glyph: string, title: string) => {
      const button = el('button', { className: 'ins-step', textContent: glyph, title })
      button.type = 'button'
      button.dataset.insKey = `texture-${direction}`
      button.addEventListener('click', () =>
        setId(stepTextureId(choices, this.nodes[0]?.textureId ?? 0, direction)),
      )
      // A focused button is not a text field, so the viewport's single-key
      // commands would fire alongside the step it is already doing — Space
      // would flip Channels playback on every press.
      button.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
      })
      return button
    }
    return row(
      'texture',
      select,
      stepButton(-1, '‹', 'Previous texture'),
      stepButton(1, '›', 'Next texture'),
    )
  }

  /**
   * geometry: the built-in shapes, then one entry per imported mesh.
   *
   * Ported from the desktop's geometry combo (`_add_mesh_combo_entry`), whose
   * mesh entries carry the `(GEO_MESH, mesh_id)` PAIR as their data — picking
   * one has to set both fields, since geometry 23 on its own renders as the
   * sphere fallback. Mesh (23) itself is never offered bare for that reason.
   */
  private geometryRow(primary: GvNode): HTMLDivElement {
    const select = el('select')
    select.dataset.insKey = 'geometry'
    const ids = Object.keys(GEOMETRY_NAMES).map(Number).sort((a, b) => a - b)
    for (const id of ids) {
      if (id === Geometry.Mesh) continue
      select.appendChild(el('option', { value: String(id), textContent: `${GEOMETRY_NAMES[id]} (${id})` }))
    }
    if (!ids.includes(primary.geometry)) {
      select.appendChild(
        el('option', { value: String(primary.geometry), textContent: `Unknown (${primary.geometry})` }),
      )
    }
    const isMesh = primary.geometry === Geometry.Mesh
    for (const choice of this.meshes ? meshChoices(this.meshes, isMesh ? primary.meshId : 0) : []) {
      select.appendChild(
        el('option', { value: `${Geometry.Mesh}:${choice.meshId}`, textContent: choice.label }),
      )
    }
    select.value = isMesh ? `${Geometry.Mesh}:${primary.meshId}` : String(primary.geometry)
    select.addEventListener('change', () => {
      const [geometry, meshId] = select.value.split(':').map(Number)
      this.commit((n) => {
        n.geometry = geometry
        if (meshId !== undefined) n.meshId = meshId
      })
    })
    return row('geometry', select)
  }

  /**
   * "End caps" — the interior cylinder's two ids, presented as one checkbox
   * (desktop `_insp_caps`). NOT a node field: capped and open ARE two geometry
   * ids and this only swaps between them, so the choice saves, loads, cycles on
   * O and animates through Channels like any other geometry.
   *
   * Enabled only on that pair, since nothing else has caps to argue about. The
   * checkbox and the Geometry dropdown follow each other in BOTH directions —
   * the panel is rebuilt from the nodes after every edit, so picking the open
   * cylinder above clears the tick and ticking the box re-selects the capped id
   * in the dropdown. (Without that, the next edit anywhere in the panel would
   * write the dropdown's stale id back over this one.)
   *
   * The toggle touches only the interior cylinders in the selection — `withCaps`
   * is a no-op for every other id — so a mixed selection cannot be quietly
   * reshaped.
   */
  private capsRow(primary: GvNode): HTMLLabelElement {
    const applies = isInteriorCylinder(primary.geometry)
    const box = el('input', { type: 'checkbox', checked: applies && hasCaps(primary.geometry) })
    box.disabled = !applies
    box.addEventListener('change', () => {
      const targets = this.nodes.filter((n) => isInteriorCylinder(n.geometry))
      if (targets.length === 0) return
      for (const node of targets) node.geometry = withCaps(node.geometry, box.checked)
      this.host.onNodesEdited(this.nodes)
    })
    const label = el('label', {
      className: 'ins-check',
      title: applies
        ? 'Close the ends of a Cylinder (Interior).\n' +
          'Off: an open tube — a cylindrical panorama you look along, or a link\n' +
          'you fly through.\n' +
          'On: a closed room, the texture also covering both ends.\n' +
          'Stored as the geometry itself, not a separate field, so it saves with\n' +
          'the scene.'
        : 'Only Cylinder (Interior) has end caps to turn on and off.\n' +
          'Pick one of the two interior cylinders above to use this.',
    })
    label.append(box, document.createTextNode('End caps'))
    return label
  }

  /**
   * topo_scale: how far one unit of a CHILD's translate reaches on the axes
   * this node's topology reads as a distance. A number box for an exact value,
   * a log slider to feel for one, and the two preset buttons for the values
   * that mean something — the desktop's own four controls (its "Topo Scale"
   * row), stacked on two lines because this panel is 300px wide where its
   * dialog is not.
   *
   * The value applies ABSOLUTELY to every selected node, like Topology and
   * Ratio above it: Select By ▸ Topology ▸ Cube and one edit retunes every cube
   * parent in the scene.
   *
   * The two number-ish controls are deliberately NOT `data-ins-key` keyed (the
   * rate rows' rule): a keyed control comes back focused after the rebuild an
   * edit triggers, which would park focus in a field where the viewport's
   * single-key commands stand down. The PRESET BUTTONS are keyed, because they
   * are buttons a user clicks in a run against a live scene.
   */
  private topoScaleRow(primary: GvNode): HTMLDivElement {
    const apply = (v: number) => this.commit((n) => (n.topoScale = v))

    const box = this.numberInput(primary.topoScale, apply, {
      min: TOPO_SCALE_MIN,
      max: TOPO_SCALE_MAX,
    })
    const slider = el('input', { type: 'range' })
    slider.min = '0'
    slider.max = String(TOPO_SCALE_SLIDER_MAX)
    slider.step = '1'
    slider.value = String(topoScaleToSlider(primary.topoScale))
    slider.className = 'ins-toposcale-slider'
    // 'input' rather than 'change': a drag should show as it happens, and the
    // rebuild it triggers is the same one the Global Scale slider absorbs.
    slider.addEventListener('input', () => apply(sliderToTopoScale(Number(slider.value))))

    const preset = (label: string, value: number, title: string) => {
      const button = el('button', { className: 'ins-step ins-preset', textContent: label, title })
      button.type = 'button'
      button.dataset.insKey = `toposcale-${label}`
      // Applies the exact constant rather than routing through the box, whose
      // displayed value is a rounded view — ANTz would otherwise be stored as
      // 0.005556. A typed edit still means exactly what it says.
      button.addEventListener('click', () => apply(value))
      button.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
      })
      return button
    }

    const tip =
      'How far one unit of a CHILD’s translate reaches, for the axes this node’s\n' +
      'topology reads as a DISTANCE rather than an angle (a Cube facet’s two axes,\n' +
      'Pin/Cylinder height, altitude above a Sphere, all three axes of a plain\n' +
      'Cartesian topology).\n\n' +
      'Longitude, latitude, orbital and tube angles are never scaled, so this can\n' +
      'never distort a circular layout — turn it down and a sphere’s children stay\n' +
      'exactly on the sphere.\n\n' +
      '1.0 = one translate unit is one world unit (the default).\n' +
      `${TOPO_SCALE_ANTZ.toFixed(6)} = ANTz (360 units across a cube facet).\n\n` +
      'Set on the PARENT — it describes that node’s coordinate system, the same way\n' +
      'Topology and Ratio do. Turn it down when children authored in degrees fly off\n' +
      'under a linear topology.'
    box.title = tip
    slider.title = tip

    const stack = el('div', { className: 'ins-toposcale' })
    const line = el('div', { className: 'ins-toposcale-line' })
    line.append(
      box,
      preset(
        '1:1',
        DEFAULT_TOPO_SCALE,
        'Back to 1.0: one translate unit = one world unit.\n' +
          'GlyphViz’s original behaviour, and what every file that has no\n' +
          'topo_scale column loads as.',
      ),
      preset(
        'ANTz',
        TOPO_SCALE_ANTZ,
        `ANTz convention (${TOPO_SCALE_ANTZ.toFixed(6)} = 1/180): a linear axis spans\n` +
          'this glyph’s own extent, so translate 180 reaches the edge of a cube facet\n' +
          'just as 180 degrees of longitude reaches the far side of a sphere.\n' +
          'This is the setting at which switching between an angular and a linear\n' +
          'topology leaves the children roughly where they were.',
      ),
    )
    stack.append(line, slider)
    return row('topo scale', stack)
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

    // Each rate row sits directly under the vector it drives, which is the
    // desktop form's own order (Pos, Translate Rate, Rotate, Rotate Rate,
    // Rotation Mode, Scale, Scale Rate) — a rate is only readable next to the
    // field it accumulates into.
    parts.push(
      this.deltaVec3Row('translate', (n) => n.translate, this.anchorTranslate),
      this.rateRow(
        'translate rate',
        (n) => n.translateRate,
        1_000_000,
        'Position delta applied every cycle (ANTz convention: nominally 60 ' +
          'cycles/second).\nNonzero values keep this node moving continuously ' +
          'in the viewport.',
      ),
      this.deltaVec3Row('rotate', (n) => n.rotate, this.anchorRotate),
      this.rateRow(
        'rotate rate',
        (n) => n.rotateRate,
        3600,
        'Degrees added every cycle (nominally 60 cycles/second).\nSpins this ' +
          'node continuously about the corresponding axis.',
        'On a Link set to Prism (Textured) geometry this field doubles up as ' +
          'texture\nscroll rate on the desktop. The value is stored and saved ' +
          'here, but this\nbuild does not flow link textures yet.',
      ),
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
      this.scaleRow(),
      this.rateRow(
        'scale rate',
        (n) => n.scaleRate,
        10_000,
        'Scale added every cycle (nominally 60 cycles/second).\nRarely useful ' +
          'at nonzero values — the glyph will continuously grow or shrink ' +
          'without bound.',
      ),
      // Under the scale group it applies to, the desktop's own placement.
      this.scaleLockRow(),
    )

    // Palette / Color Index sit directly above the colour picker, the desktop's
    // own order (Palette, Color Index, Color) — because that IS the
    // relationship: both write the literal colour the picker shows, and the
    // picker then overrides it until the next palette edit. Both apply
    // ABSOLUTELY to every selected node, like the desktop's _on_insp_palette_
    // changed / _on_insp_color_index_changed.
    const paletteSelect = el('select')
    paletteSelect.dataset.insKey = 'palette'
    for (const id of Object.keys(PALETTE_NAMES).map(Number).sort((a, b) => a - b)) {
      paletteSelect.appendChild(el('option', { value: String(id), textContent: PALETTE_NAMES[id] }))
    }
    if (!PALETTE_NAMES[primary.paletteId]) {
      paletteSelect.appendChild(
        el('option', { value: String(primary.paletteId), textContent: `Unknown (${primary.paletteId})` }),
      )
    }
    paletteSelect.value = String(primary.paletteId)
    paletteSelect.title =
      'Colour palette the =/− and Alt+=/Alt+− keys step through (palette_id).\n' +
      'Choosing one re-resolves the node’s colour from the new palette at the\n' +
      'current Color Index.'
    paletteSelect.addEventListener('change', () => {
      setPalette(this.nodes, Number(paletteSelect.value))
      this.host.onNodesEdited(this.nodes)
    })

    const indexCount = paletteIndexCount(primary.paletteId)
    const colorIndexInput = this.numberInput(
      primary.colorIndex,
      (v) => {
        setColorIndex(this.nodes, v)
        this.host.onNodesEdited(this.nodes)
      },
      { min: 0, max: indexCount - 1, integer: true, width: '70px' },
    )
    colorIndexInput.dataset.insKey = 'color-index'
    colorIndexInput.title =
      `Index within the palette above, 0–${indexCount - 1} (color_index; the =/− keys step it).\n` +
      'Resolves immediately into a literal colour — the picker below then\n' +
      'overrides that until you change the palette or index again.'

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
      row('palette', paletteSelect),
      row('color index', colorIndexInput),
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
      this.geometryRow(primary),
      // Directly under Geometry, the desktop's own placement — it names one of
      // the two ids that row is showing.
      this.capsRow(primary),
      row(
        'topo',
        this.idSelect(TOPO_NAMES, primary.topo, (n, v) => (n.topo = v), {
          topologyChanged: true,
        }),
      ),
      // Directly under Topology, the desktop's own placement — it describes the
      // same thing: this node's coordinate system for its children.
      this.topoScaleRow(primary),
      row(
        'ratio',
        this.numberInput(primary.ratio, (v) => this.commit((n) => (n.ratio = v)), {
          width: '70px',
          // The desktop's own tooltip: the field doubles up on several shapes,
          // and the Flat Ring's reading is the one most likely to look like a
          // new meaning when it is the torus's existing one.
          title:
            'Torus minor-radius proportion (GaiaViz/ANTz “ratio”): the tube radius as a\n' +
            'fraction of the torus’s overall radius. Also used to place children riding\n' +
            'on a Torus-topology parent’s surface.\n' +
            'On a Flat Ring it is the same proportion read as the band’s RADIAL width;\n' +
            'the band’s height is the node’s scale z, so equal values give a square\n' +
            'cross-section. Small ratio + large scale z is a tall hoop; large ratio +\n' +
            'small scale z is a flat dial.\n' +
            'On other glyphs this field doubles up: Point geometry uses it as an\n' +
            'on-screen sprite size, and Plot-parent nodes as line width (ratio × 20, in\n' +
            'pixels).\n' +
            'On a Link it is the connector’s THICKNESS, whatever geometry the link\n' +
            'carries: line width in pixels for Line, and the world-space half-width on\n' +
            'both cross-axes for Prism (Textured) or any glyph stretched between the\n' +
            'link’s two ends (the link’s own scale fields play no part).',
        }),
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
      this.textureRow(primary),
    )

    // Fetch Basemap: the desktop keeps this on its World Grid panel; this app
    // has no grid panel yet, so it rides with the texture row it ends up
    // setting. Flat grids only — a regional map can't wrap a globe (a globe
    // still takes any whole-earth equirect image the ordinary way).
    if (!multi && primary.type === NodeType.WorldGrid) {
      const button = el('button', {
        type: 'button',
        className: 'ins-basemap',
        textContent: 'Fetch Basemap…',
      })
      const globe = gridIsGlobe(primary)
      button.disabled = globe
      button.title = globe
        ? 'Fetch Basemap needs the flat form — a regional map can’t wrap a globe.\n' +
          'Switch the grid’s geometry to Grid / Grid Wire first.'
        : 'Download a map image (OpenStreetMap, satellite, or terrain) for this\n' +
          'grid: the lon/lat window is prefilled from the grid’s children, the\n' +
          'map is reprojected to line up exactly with child placement, and\n' +
          'applied as the grid’s texture. Free services, no API key; tiles are\n' +
          'cached so refetches don’t re-download.'
      button.addEventListener('click', () => this.host.onFetchBasemap(primary))
      parts.push(row('basemap', button))
    }

    const hide = el('input', { type: 'checkbox', checked: primary.hide !== 0 })
    hide.addEventListener('change', () => this.commit((n) => (n.hide = hide.checked ? 1 : 0)))

    // "Always Show Text" (show_text): pins this node's label on screen
    // whatever the scene-wide Labels settings say. A mixed selection shows
    // the indeterminate state — Qt's PartiallyChecked — and a click resolves
    // it by pushing ONE value onto every selected node, like the desktop's
    // clicked (not toggled) handler.
    const pinned = nodes.filter((n) => n.showText !== 0).length
    const alwaysShow = el('input', { type: 'checkbox', checked: pinned > 0 })
    alwaysShow.indeterminate = pinned > 0 && pinned < nodes.length
    alwaysShow.addEventListener('change', () =>
      this.commit((n) => (n.showText = alwaysShow.checked ? 1 : 0)),
    )
    // Its own labelled checkbox rather than a label-column row, because the
    // wording is the control here — the same shape the desktop gives it,
    // directly under the Tag Text box.
    const alwaysShowRow = el('label', {
      className: 'ins-check',
      title:
        'Keep this node’s label on screen whatever the scene-wide Labels settings say —\n' +
        'neither Show Tag Labels nor Labels of Selected Only can turn it off, and it is\n' +
        `exempt from the ${MAX_TAGS_PER_FRAME}/frame cap. Hiding the node still hides its label.\n` +
        'Applies to every selected node. Saved with the scene (show_text).',
    })
    alwaysShowRow.append(alwaysShow, document.createTextNode('Always Show Text'))

    parts.push(
      row('hide', hide),
      row('text', this.textInput(primary.text, (n, v) => (n.text = v))),
      alwaysShowRow,
    )
    // Pinning a node that has nothing to say draws nothing, which reads as the
    // checkbox not working. The desktop says so in its status bar; here the
    // note sits with the control it is about.
    const pinnedButEmpty = nodes.filter((n) => n.showText !== 0 && n.text === '').length
    if (pinnedButEmpty > 0) {
      parts.push(
        el('div', {
          className: 'ins-note',
          textContent:
            pinnedButEmpty === nodes.length && !multi
              ? 'nothing to show yet — this node has no tag text'
              : `${pinnedButEmpty} pinned node(s) have no tag text yet`,
        }),
      )
    }
    parts.push(row('link', this.textInput(primary.link, (n, v) => (n.link = v))))

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
