// The Glyph Composer window — a port of the desktop's
// `glyphviz_gl/glyph_composer_dialog.py` (verified against source 2026-07-28),
// reached by Ctrl+G (the desktop's own chord for Tools ▸ Glyph Composer…) or
// the Create panel's button.
//
// Where the Hyperglyph Generator ROLLS a design from a seed, this one BUILDS
// one by hand: a list of branch levels, a parameter form for the selected
// level, a live preview, and Insert into Scene. Both end in the same
// `generateNodes` call over the same `GlyphRecipe`, so a composed glyph and a
// generated one are the same kind of thing — ordinary CSV rows that save, edit
// and animate like any other.
//
// The window frame is `floatWindow.ts` and the preview `glyphPreview.ts`, both
// shared with the Generator.
//
// Divergences from the desktop dialog, all of them platform rather than
// behaviour, and each marked at the code below:
//
//   - LAYOUT. The desktop is a 900×700 dialog with a splitter: levels on the
//     left, the parameter form on the right. A floating window in a browser
//     viewport is narrow, so the same pieces STACK — level list, form, preview,
//     footer — in the desktop's own top-to-bottom reading order. Nothing is
//     added or removed; it is one column instead of two.
//   - ALPHA. `<input type="color">` has no alpha channel, where the desktop's
//     QColorDialog is opened with ShowAlphaChannel. Each colour therefore gets
//     its own 0–255 alpha field beside the swatch. Recipes carry RGBA either
//     way, so a template still round-trips.
//   - LIVE BINDING. The desktop reads its widgets back into the LevelSpec in
//     one `_save_params` pass (and its module docstring is a note about the
//     stale-QWidget crash that design caused). Here every control writes its
//     own field the moment it changes, so there is no save pass to forget and
//     no widget to outlive its spec.
//   - TEMPLATE I/O is a download and a file picker rather than QFileDialog
//     paths, but the JSON is byte-compatible in both directions — see
//     `recipeToJson` / `recipeFromJson`.
//
// And one divergence that IS a behaviour choice, called out as such: the
// preview camera HOLDS its position across re-previews. The desktop's mini
// viewport re-frames on every one, because `_do_preview` calls
// `Viewport.set_nodes` and that method resets `_cam_target` / `_cam_distance`
// and rebuilds `_cameras` — which is right for loading a scene, the job it was
// written for, but here it fires 350 ms after every keystroke, so an orbited
// preview snaps back the moment a value is nudged and a scale or spacing change
// cannot be judged against the view it was made in. Holding the camera is the
// simplest default that makes Auto-preview usable; a Fit View button puts the
// desktop's behaviour one click away, and the first preview of a design always
// frames it.

import {
  addedLevelSpec,
  defaultRecipe,
  Dist,
  DIST_LABELS,
  generateNodes,
  NONROOT_DIST_MODES,
  recipeFromJson,
  recipeToJson,
  ROOT_DIST_MODES,
} from '../gv/glyphRecipe'
import type { DistMode, GlyphRecipe, RecipeColor } from '../gv/glyphRecipe'
import { GEOMETRY_NAMES, Geometry, TOPO_NAMES } from '../gv/types'
import { FloatWindow, windowRow } from './floatWindow'
import { GlyphPreview } from './glyphPreview'

/** Auto-preview debounce — `_preview_timer.start(350)`. */
const PREVIEW_DELAY_MS = 350

/**
 * Geometry choices: `_GEO_ITEMS` — every geometry EXCEPT Mesh (23), which has
 * no model to point at from a recipe. The link-only ids (27/28) are left in
 * because the desktop leaves them in.
 */
const GEO_ITEMS: [number, string][] = Object.keys(GEOMETRY_NAMES)
  .map(Number)
  .sort((a, b) => a - b)
  .filter((id) => id !== Geometry.Mesh)
  .map((id) => [id, GEOMETRY_NAMES[id]])

const TOPO_ITEMS: [number, string][] = Object.keys(TOPO_NAMES)
  .map(Number)
  .sort((a, b) => a - b)
  .map((id) => [id, TOPO_NAMES[id]])

export interface GlyphComposerHost {
  /**
   * Add the recipe's nodes to the live scene: under the primary selected node,
   * or as a new root object with nothing selected. Reports on the status line.
   */
  insert(recipe: GlyphRecipe): void
  /** Report a message on the status line (a failed template load, say). */
  status(message: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

function hex(color: RecipeColor): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`
}

export class GlyphComposerWindow {
  readonly element: HTMLDivElement

  private readonly window: FloatWindow
  private readonly preview = new GlyphPreview()
  private readonly host: GlyphComposerHost

  private readonly levelList: HTMLDivElement
  private readonly removeButton: HTMLButtonElement
  private readonly form: HTMLDivElement
  private readonly nameInput: HTMLInputElement
  private readonly autoPreview: HTMLInputElement
  private readonly info: HTMLDivElement
  private readonly loadInput: HTMLInputElement

  private recipe: GlyphRecipe = defaultRecipe()
  private currentLevel = 0
  /** `_scale_locked` — a dialog-wide flag, not a per-level one. */
  private scaleLocked = false
  private previewTimer: number | null = null
  /** Set while a form is being built, so populating a field previews nothing. */
  private loading = false
  /** The three scale spinboxes of the form on screen — see Lock X/Y/Z. */
  private scaleFields: HTMLInputElement[] = []

  constructor(host: GlyphComposerHost) {
    this.host = host

    this.window = new FloatWindow({
      id: 'glyph-composer-window',
      title: 'Glyph Composer',
      hotkey: 'Ctrl+G',
    })
    this.element = this.window.element
    this.window.onOpen = () => {
      this.preview.setLive(true)
      // The desktop previews 250 ms after the dialog opens. Unlike the
      // Generator — where opening must NOT roll a design — a composer with an
      // empty preview would be showing nothing about the recipe it is editing.
      this.doPreview()
    }

    const body = this.window.body

    body.appendChild(
      el('div', {
        className: 'sel-hint',
        textContent:
          'Build a hierarchical glyph one branch level at a time: each level says ' +
          'how many children every node of the level above gets, and what they look like.',
      }),
    )

    // --- Branch levels ---
    body.appendChild(el('div', { className: 'composer-heading', textContent: 'Branch Levels' }))
    this.levelList = el('div', { className: 'composer-levels' })
    body.appendChild(this.levelList)

    const levelButtons = el('div', { className: 'hud-create-buttons' })
    const addButton = el('button', {
      type: 'button',
      textContent: '+ Add Level',
      title: 'Append a level of children below the deepest one.',
    })
    addButton.addEventListener('click', () => this.addLevel())
    this.removeButton = el('button', {
      type: 'button',
      textContent: '− Remove',
      title: 'Remove the selected level. The recipe always keeps at least one.',
    })
    this.removeButton.addEventListener('click', () => this.removeLevel())
    levelButtons.append(addButton, this.removeButton)
    body.appendChild(levelButtons)

    // --- Parameter form for the selected level ---
    this.form = el('div', { className: 'composer-form' })
    body.appendChild(this.form)

    // --- Preview ---
    body.appendChild(this.preview.element)
    this.info = el('div', { className: 'sel-hint' })
    body.appendChild(this.info)

    // --- Footer ---
    const footer = el('div', { className: 'float-window-footer' })

    this.nameInput = el('input', { type: 'text', value: this.recipe.name })
    this.nameInput.addEventListener('input', () => {
      this.recipe.name = this.nameInput.value
    })
    footer.appendChild(
      windowRow(
        'Template',
        this.nameInput,
        'Name this design is saved under. Not written into the scene — a glyph ' +
          'inserted from a template is ordinary nodes.',
      ),
    )

    const ioButtons = el('div', { className: 'hud-create-buttons' })
    const saveTemplate = el('button', {
      type: 'button',
      textContent: 'Save Template…',
      title: 'Download this recipe as a .json template — the same file desktop\nGlyphViz reads and writes.',
    })
    saveTemplate.addEventListener('click', () => this.saveTemplate())
    const loadLabel = el('label', {
      className: 'hud-file-button',
      textContent: 'Load Template…',
      title: 'Open a .json glyph template, from this app or from desktop GlyphViz.',
    })
    this.loadInput = el('input', { type: 'file', accept: '.json,application/json' })
    this.loadInput.addEventListener('change', () => this.loadTemplate())
    loadLabel.appendChild(this.loadInput)
    ioButtons.append(saveTemplate, loadLabel)
    footer.appendChild(ioButtons)

    this.autoPreview = el('input', { type: 'checkbox', checked: true })
    const autoRow = el('label', {
      className: 'sel-check',
      title:
        'Re-draw the preview shortly after every parameter change.\n' +
        'Switch it off for a recipe big enough that rebuilding is slow, and use\n' +
        'Preview Now instead.',
    })
    autoRow.append(this.autoPreview, document.createTextNode('Auto-preview'))
    footer.appendChild(autoRow)

    const previewButtons = el('div', { className: 'hud-create-buttons' })
    const previewNow = el('button', {
      type: 'button',
      textContent: 'Preview Now',
      title: 'Re-draw the preview from the current parameters.',
    })
    previewNow.addEventListener('click', () => this.doPreview())
    const fitView = el('button', {
      type: 'button',
      textContent: 'Fit View',
      title: 'Re-frame the preview camera on the whole glyph.',
    })
    fitView.addEventListener('click', () => this.preview.refit())
    previewButtons.append(previewNow, fitView)
    footer.appendChild(previewButtons)

    const insertButton = el('button', {
      type: 'button',
      className: 'float-window-action',
      textContent: 'Insert into Scene',
      title:
        'Add this glyph to the scene: under the selected node, or as a new root\n' +
        'object with nothing selected. The window stays open.',
    })
    insertButton.addEventListener('click', () => this.host.insert(this.recipe))
    footer.appendChild(insertButton)

    body.appendChild(footer)

    this.refreshLevelList()
    this.buildForm(0)
  }

  // ---------------------------------------------------------------- open/close

  get isOpen(): boolean {
    return this.window.isOpen
  }

  toggle(): void {
    this.setOpen(!this.window.isOpen)
  }

  setOpen(value: boolean): void {
    this.window.setOpen(value)
    if (!value) this.preview.setLive(false)
  }

  // -------------------------------------------------------------- level list

  /** `_level_label` — "Root  ×6  Sphere" / "Level 2  ×6  Cube". */
  private levelLabel(index: number): string {
    const spec = this.recipe.levels[index]
    const geo = GEOMETRY_NAMES[spec.geometry] ?? String(spec.geometry)
    const prefix = index === 0 ? 'Root' : `Level ${index}`
    return `${prefix}  ×${spec.count}  ${geo}`
  }

  private refreshLevelList(): void {
    this.levelList.textContent = ''
    this.recipe.levels.forEach((_, index) => {
      const row = el('button', {
        type: 'button',
        className: index === this.currentLevel ? 'composer-level is-current' : 'composer-level',
        textContent: this.levelLabel(index),
      })
      row.addEventListener('click', () => this.selectLevel(index))
      this.levelList.appendChild(row)
    })
    // `_remove_level` refuses to empty the recipe — a recipe with no levels
    // generates nothing and has no form to show.
    this.removeButton.disabled = this.recipe.levels.length <= 1
  }

  /** Refresh only the selected row's text, as `_save_params`' tail does. */
  private refreshCurrentLabel(): void {
    const row = this.levelList.children[this.currentLevel]
    if (row instanceof HTMLElement) row.textContent = this.levelLabel(this.currentLevel)
  }

  private selectLevel(index: number): void {
    if (index < 0 || index >= this.recipe.levels.length) return
    this.currentLevel = index
    this.refreshLevelList()
    this.buildForm(index)
  }

  private addLevel(): void {
    const index = this.recipe.levels.length
    this.recipe.levels.push(addedLevelSpec(index))
    this.selectLevel(index)
    this.schedulePreview()
  }

  private removeLevel(): void {
    if (this.recipe.levels.length <= 1) return
    this.recipe.levels.splice(this.currentLevel, 1)
    this.selectLevel(Math.min(this.currentLevel, this.recipe.levels.length - 1))
    this.schedulePreview()
  }

  // ------------------------------------------------------------ parameter form

  private buildForm(levelIndex: number): void {
    this.loading = true
    const spec = this.recipe.levels[levelIndex]
    const isRoot = levelIndex === 0
    this.form.textContent = ''

    this.form.appendChild(
      el('div', {
        className: 'composer-heading',
        textContent: isRoot
          ? 'Root placement'
          : `Level ${levelIndex} — children of Level ${levelIndex - 1}`,
      }),
    )

    // --- Basic ---
    this.form.appendChild(
      windowRow(
        'Count',
        this.numberField(
          spec.count,
          { min: 1, max: 200, step: 1, integer: true, relabel: true },
          (v) => {
            spec.count = v
          },
        ),
        isRoot
          ? 'How many copies of the trunk to place.'
          : 'How many children EVERY node of the level above gets.',
      ),
    )
    this.form.appendChild(
      windowRow(
        'Geometry',
        this.idSelect(GEO_ITEMS, spec.geometry, (value) => {
          spec.geometry = value
        }, true),
        "This level's own shape.",
      ),
    )
    this.form.appendChild(
      windowRow(
        'Topology',
        this.idSelect(TOPO_ITEMS, spec.topo, (value) => {
          spec.topo = value
        }),
        'Topology of THIS node — determines how its children are placed.',
      ),
    )
    this.form.appendChild(
      windowRow(
        'Ratio',
        this.numberField(spec.ratio, { min: 0.01, max: 2, step: 0.05 }, (v) => {
          spec.ratio = v
        }),
        'Torus tube ratio / other topology-specific size.',
      ),
    )

    // --- Placement ---
    this.form.appendChild(el('div', { className: 'composer-heading', textContent: 'Placement' }))

    // ROOT_DIST_MODES / NONROOT_DIST_MODES: a mode the level cannot use falls
    // back to the first it can, exactly as `_build_param_form` does — that is
    // what makes a template whose root is Angular still open.
    const modes = isRoot ? ROOT_DIST_MODES : NONROOT_DIST_MODES
    const currentMode = modes.includes(spec.distMode) ? spec.distMode : modes[0]
    spec.distMode = currentMode

    const modeSelect = el('select')
    for (const mode of modes) {
      modeSelect.appendChild(el('option', { value: mode, textContent: DIST_LABELS[mode] }))
    }
    modeSelect.value = currentMode
    this.form.appendChild(windowRow('Mode', modeSelect))

    // One panel per applicable mode, all built and all but one hidden — the
    // desktop's `_dist_panels` / `_update_dist_panel`. Keeping them built means
    // switching modes back and forth never loses what was typed.
    const panels = new Map<DistMode, HTMLDivElement>()
    const panel = (mode: DistMode): HTMLDivElement => {
      const div = el('div', { className: 'composer-dist-panel' })
      panels.set(mode, div)
      this.form.appendChild(div)
      return div
    }

    if (modes.includes(Dist.Angular)) {
      const p = panel(Dist.Angular)
      p.append(
        windowRow(
          'Tilt / Lat Y',
          this.numberField(spec.distTilt, { min: -360, max: 360, step: 5 }, (v) => {
            spec.distTilt = v
          }),
          'translate_y of children: latitude/tilt depending on parent topology',
        ),
        windowRow(
          'Altitude Z',
          this.numberField(spec.distTz, { min: -100, max: 100, step: 0.1 }, (v) => {
            spec.distTz = v
          }),
          'translate_z of children: altitude/radius offset',
        ),
      )
    }
    if (modes.includes(Dist.Linear)) {
      const p = panel(Dist.Linear)
      const axis = el('select')
      for (const [index, name] of ['X', 'Y', 'Z'].entries()) {
        axis.appendChild(el('option', { value: String(index), textContent: name }))
      }
      axis.value = String(spec.distAxis)
      axis.addEventListener('change', () => {
        spec.distAxis = Number(axis.value)
        this.onChange()
      })
      p.append(
        windowRow(
          'Step',
          this.numberField(spec.distStep, { min: 0.01, max: 500, step: 0.5 }, (v) => {
            spec.distStep = v
          }),
        ),
        windowRow('Axis', axis),
      )
    }
    if (modes.includes(Dist.Circular)) {
      const p = panel(Dist.Circular)
      p.append(
        windowRow(
          'Radius',
          this.numberField(spec.distRadius, { min: 0.01, max: 500, step: 0.5 }, (v) => {
            spec.distRadius = v
          }),
        ),
      )
    }
    if (modes.includes(Dist.Grid)) {
      const p = panel(Dist.Grid)
      p.append(
        windowRow(
          'Columns',
          this.numberField(spec.distGridCols, { min: 1, max: 50, step: 1, integer: true }, (v) => {
            spec.distGridCols = v
          }),
        ),
        windowRow(
          'Spacing X',
          this.numberField(spec.distGridSx, { min: 0.01, max: 500, step: 0.5 }, (v) => {
            spec.distGridSx = v
          }),
        ),
        windowRow(
          'Spacing Y',
          this.numberField(spec.distGridSy, { min: 0.01, max: 500, step: 0.5 }, (v) => {
            spec.distGridSy = v
          }),
        ),
      )
    }
    if (modes.includes(Dist.Random)) {
      const p = panel(Dist.Random)
      p.append(
        windowRow(
          'Bounds (±)',
          this.numberField(spec.distBounds, { min: 0.1, max: 1000, step: 1 }, (v) => {
            spec.distBounds = v
          }),
          'Uniform random inside this half-width. Re-rolled on every preview and\n' +
            'again on insert, so what is inserted is NOT what was previewed — the\n' +
            'desktop behaves the same way.',
        ),
      )
    }

    const showPanels = (mode: DistMode) => {
      for (const [key, div] of panels) div.hidden = key !== mode
    }
    showPanels(currentMode)
    modeSelect.addEventListener('change', () => {
      spec.distMode = modeSelect.value as DistMode
      showPanels(spec.distMode)
      this.onChange()
    })

    // --- Transform ---
    this.form.appendChild(el('div', { className: 'composer-heading', textContent: 'Transform' }))
    const scaleOptions = { min: 0.001, max: 100, step: 0.1, scaleAxis: true } as const
    const sx = this.numberField(spec.scaleX, scaleOptions, (v) => {
      spec.scaleX = v
    })
    const sy = this.numberField(spec.scaleY, scaleOptions, (v) => {
      spec.scaleY = v
    })
    const sz = this.numberField(spec.scaleZ, scaleOptions, (v) => {
      spec.scaleZ = v
    })
    this.scaleFields = [sx, sy, sz]
    this.form.append(windowRow('Scale X', sx), windowRow('Scale Y', sy), windowRow('Scale Z', sz))

    const lock = el('input', { type: 'checkbox', checked: this.scaleLocked })
    const lockRow = el('label', { className: 'sel-check', title: 'Keep X, Y, Z scale equal.' })
    lockRow.append(lock, document.createTextNode('Lock X/Y/Z'))
    lock.addEventListener('change', () => {
      // `_on_lock_toggled` only records the flag — it does not equalise what is
      // already there. The next scale edit is what pulls the other two along.
      this.scaleLocked = lock.checked
    })
    this.form.appendChild(lockRow)

    const rotateOptions = { min: -360, max: 360, step: 5 } as const
    this.form.append(
      windowRow(
        'Rotate X',
        this.numberField(spec.rotateX, rotateOptions, (v) => {
          spec.rotateX = v
        }),
      ),
      windowRow(
        'Rotate Y',
        this.numberField(spec.rotateY, rotateOptions, (v) => {
          spec.rotateY = v
        }),
      ),
      windowRow(
        'Rotate Z',
        this.numberField(spec.rotateZ, rotateOptions, (v) => {
          spec.rotateZ = v
        }),
      ),
    )

    // --- Colour ---
    this.form.appendChild(el('div', { className: 'composer-heading', textContent: 'Color' }))
    this.form.appendChild(
      windowRow(
        'Color',
        this.colorField(
          () => spec.colorStart,
          (value) => {
            spec.colorStart = value
          },
        ),
        "The level's colour — the start of its gradient when one is enabled.",
      ),
    )

    const gradient = el('input', { type: 'checkbox', checked: spec.colorEnd !== null })
    const gradientRow = el('label', {
      className: 'sel-check',
      title:
        "Fade this level's items from the first colour to the second, across the\n" +
        'level in placement order.',
    })
    gradientRow.append(gradient, document.createTextNode('Enable gradient'))
    this.form.appendChild(gradientRow)

    // The end colour is remembered while the gradient is off, so unchecking and
    // rechecking restores it — the desktop keeps it in `self._color_end` for
    // exactly that reason. Its row stays VISIBLE and goes grey rather than
    // disappearing (`_w_color_end_btn.setEnabled`), so what is remembered can
    // still be seen.
    let endColor: RecipeColor = spec.colorEnd ?? [80, 200, 180, 255]
    const endField = this.colorField(
      () => endColor,
      (value) => {
        endColor = value
        if (gradient.checked) spec.colorEnd = value
      },
    )
    const endInputs = [...endField.querySelectorAll('input')]
    const setEndEnabled = (enabled: boolean) => {
      for (const input of endInputs) input.disabled = !enabled
    }
    setEndEnabled(spec.colorEnd !== null)
    this.form.appendChild(windowRow('Gradient to', endField))
    gradient.addEventListener('change', () => {
      spec.colorEnd = gradient.checked ? endColor : null
      setEndEnabled(gradient.checked)
      this.onChange()
    })

    this.loading = false
  }

  /**
   * A numeric spinbox writing straight into the spec through `apply`.
   * `relabel` also refreshes the level list row (Count appears in its label);
   * `scaleAxis` routes the value through the Lock X/Y/Z rule.
   */
  private numberField(
    current: number,
    options: {
      min: number
      max: number
      step: number
      integer?: boolean
      relabel?: boolean
      scaleAxis?: boolean
    },
    apply: (value: number) => void,
  ): HTMLInputElement {
    const input = el('input', {
      type: 'number',
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
      value: String(current),
    })
    input.addEventListener('change', () => {
      // A spinbox cannot be typed out of range on the desktop; clamp on commit.
      const raw = Number(input.value)
      let value = Number.isFinite(raw)
        ? Math.min(Math.max(raw, options.min), options.max)
        : options.min
      if (options.integer) value = Math.round(value)
      input.value = String(value)
      apply(value)
      if (options.scaleAxis && this.scaleLocked) {
        for (const other of this.scaleFields) {
          if (other !== input) other.value = String(value)
        }
        const spec = this.recipe.levels[this.currentLevel]
        spec.scaleX = spec.scaleY = spec.scaleZ = value
      }
      if (options.relabel) this.refreshCurrentLabel()
      this.onChange()
    })
    return input
  }

  /** A `<select>` of (id, name) pairs. */
  private idSelect(
    items: [number, string][],
    current: number,
    apply: (value: number) => void,
    relabel = false,
  ): HTMLSelectElement {
    const select = el('select')
    for (const [id, name] of items) {
      select.appendChild(el('option', { value: String(id), textContent: `${name} (${id})` }))
    }
    select.value = String(current)
    select.addEventListener('change', () => {
      apply(Number(select.value))
      if (relabel) this.refreshCurrentLabel()
      this.onChange()
    })
    return select
  }

  /**
   * A colour swatch plus its own alpha field. `<input type="color">` carries no
   * alpha channel, where the desktop opens QColorDialog with ShowAlphaChannel —
   * so the one control becomes two rather than dropping the channel, which the
   * recipe format has and glyphs are drawn with.
   */
  private colorField(read: () => RecipeColor, write: (value: RecipeColor) => void): HTMLDivElement {
    const wrap = el('div', { className: 'composer-color' })
    const swatch = el('input', { type: 'color', value: hex(read()) })
    const alpha = el('input', {
      type: 'number',
      min: '0',
      max: '255',
      step: '1',
      value: String(read()[3]),
      title: 'Alpha 0–255. 255 is opaque.',
    })
    const commit = () => {
      const rgb = swatch.value
      const a = Math.min(255, Math.max(0, Math.round(Number(alpha.value) || 0)))
      alpha.value = String(a)
      write([
        parseInt(rgb.slice(1, 3), 16),
        parseInt(rgb.slice(3, 5), 16),
        parseInt(rgb.slice(5, 7), 16),
        a,
      ])
      this.onChange()
    }
    swatch.addEventListener('input', commit)
    alpha.addEventListener('change', commit)
    wrap.append(swatch, alpha)
    return wrap
  }

  // ------------------------------------------------------------------- preview

  private onChange(): void {
    if (this.loading) return
    this.schedulePreview()
  }

  /** `_schedule_preview` — debounced, and only while Auto-preview is on. */
  private schedulePreview(): void {
    if (!this.autoPreview.checked) return
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null
      this.doPreview()
    }, PREVIEW_DELAY_MS)
  }

  private doPreview(): void {
    if (!this.window.isOpen) return
    const nodes = generateNodes(this.recipe, { startId: 1 })
    // keepCamera: the Composer re-previews on every nudge, and a camera that
    // reset each time would make a scale or spacing change impossible to judge.
    this.preview.setNodes(nodes, true)
    this.info.textContent = `${nodes.length} node(s) across ${this.recipe.levels.length} level(s)`
  }

  renderFrame(dtMs: number): void {
    this.preview.renderFrame(dtMs)
  }

  // ------------------------------------------------------------- template I/O

  private saveTemplate(): void {
    const name = this.recipe.name.trim() || 'My Glyph'
    const text = `${JSON.stringify(recipeToJson(this.recipe), null, 2)}\n`
    const blob = new Blob([text], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    this.host.status(`Glyph Composer: saved template "${name}".`)
  }

  private async loadTemplate(): Promise<void> {
    const file = this.loadInput.files?.[0]
    // Clear it either way, so picking the same file twice fires a change event.
    this.loadInput.value = ''
    if (!file) return
    try {
      const recipe = recipeFromJson(JSON.parse(await file.text()))
      this.recipe = recipe
      this.currentLevel = 0
      this.nameInput.value = recipe.name
      this.refreshLevelList()
      this.buildForm(0)
      this.doPreview()
      this.host.status(
        `Glyph Composer: loaded template "${recipe.name}" (${recipe.levels.length} level(s)).`,
      )
    } catch (error) {
      // The design in progress is left alone — a bad file must not replace it.
      this.host.status(`Glyph Composer: could not read ${file.name} — ${describe(error)}`)
    }
  }

  dispose(): void {
    this.preview.dispose()
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
