// The Epitrochoid Generator window — a port of the desktop's
// `glyphviz_gl/epicycle_dialog.py` (verified against source 2026-08-31, commit
// 862fffc), reached by Ctrl+Shift+E or the Create panel's button.
//
// One row per arm, a live preview that keeps moving, and a readout that says
// what the design actually IS rather than what it looks like. All the maths
// lives in `../gv/epicycles` (pure, and diffed against the desktop engine by
// epicycles.parity.test.ts) and `../render/epicyclePath` (the traced curve), so
// this file is only the controls.
//
// The window frame is `floatWindow.ts` and the preview `glyphPreview.ts`, both
// shared with the Hyperglyph Generator and the Glyph Composer.
//
// WHAT IT WRITES
// --------------
// Node CSVs, not a recipe JSON. The Glyph Composer hands out a template because
// a glyph IS a recipe, but an epicycle chain's whole point is the traced path,
// which only exists once the curve has been walked — so Save Scene writes the
// scene: a node CSV, a tag CSV, and the ch-map/ch-tracks pair when Self-drawing
// trail is on. Save Design is the small secondary convenience that reopens a
// hand-tuned design HERE; it is never needed to view or share a result.
//
// THE THREE KNOBS PER ARM, and what each does to the curve
// --------------------------------------------------------
// * RATE X sets the harmonic, through the ladder h_k = h_{k-1} + (−1)^(k−1)·r_k.
//   The sign alternates because each level's rotate = (90, 90, 0) cancels the
//   Torus base rotation and flips the frame's handedness — so the MAGNITUDES
//   add, and (1, −1, 1, −1) climbs 1, 2, 3, 4.
// * LENGTH is that arm's amplitude, in world units. It is produced by the SCALE
//   of the node one level up (a node's torus is the circle its child rides),
//   which the builder telescopes for you.
// * PHASE X rotates the term's starting angle: same spectrum, different shape.
//
// and the two that leave the plane: TILT leans this arm's orbit out of the
// previous arm's, exactly (it is written as the parent's rotate_y); TUBE /
// RATE Y / PHASE Y give the arm a SECOND circle riding the first, around the
// torus tube — a sideband generator, and the one that makes torus knots.
//
// The preview ALWAYS runs on translate_rate with the trail fully drawn, even
// when Self-drawing is checked — so the pen is visibly riding a curve computed
// independently of it, which is the correctness check, on screen. Self-drawing
// changes only what Save Scene writes.
//
// Divergences from the desktop dialog, all of them platform rather than
// behaviour:
//
//   - LAYOUT. The desktop is a 1240×780 dialog with a splitter, controls left
//     and preview right. A floating window in a browser viewport is narrower,
//     so the same pieces STACK in the desktop's own reading order. The arms
//     TABLE is kept as a table — seeing every arm's rate at once is what makes
//     the ladder legible — and scrolls sideways inside its own box if the
//     window is dragged narrow.
//   - CHORD. Ctrl+E is this app's Selection panel and predates the feature, so
//     the web key is Ctrl+Shift+E — the same substitution Show Selection Box
//     already makes for the desktop's Ctrl+B.
//   - OUTPUT is downloads rather than a folder the app creates. Putting the
//     files in one folder is therefore the user's step, and the status line
//     says so, because Channels auto-load only when exactly one ch-map and one
//     ch-tracks sit beside the node CSV.
//   - The path is RE-TRACED on Insert and on Save rather than reusing the
//     preview's (`self._path`), so neither can act on a stale curve when
//     Auto-preview is off. Tracing is deterministic and costs a few
//     milliseconds, so there is nothing to gain by caching it.

import {
  buildEpicycleNodes,
  continuedArm,
  defaultArm,
  describeDesign,
  designFromJson,
  designToJson,
  formatG,
  frameCount,
  MAX_ARMS,
  MAX_CLOSURE_FRAMES,
  MAX_TRAIL_POINTS,
  maxFoldForArms,
  weaveOf,
  MIN_ARMS,
  preset,
  PRESET_NAMES,
  pyRound,
  randomDesign,
  randomSymmetricDesign,
  RATE_LIMIT,
  symmetricArms,
} from '../gv/epicycles'
import type { Arm, EpicycleDesign } from '../gv/epicycles'
import { PALETTE_NAMES } from '../gv/colorPalette'
import { PythonRandom } from '../gv/pythonRandom'
import { traceEpicyclePath } from '../render/epicyclePath'
import type { Vec3 } from '../gv/types'
import { FloatWindow, windowRow } from './floatWindow'
import { GlyphPreview } from './glyphPreview'

/** `_preview_timer.start(350)`. */
const PREVIEW_DELAY_MS = 350

/** Seed field range: CPython's own `random.randrange(2 ** 31)`. */
const MAX_SEED = 2 ** 31 - 1

/**
 * Rotational orders the Symmetry control offers. 1 is "off" — the free,
 * desktop-parity Randomize, and no constraint on a hand-typed rate. The top is
 * 16 because a fold that high already wants 16+ arms to show more than one ring
 * of petals, and `maxFoldForArms` clamps it down where the arm count cannot
 * carry it.
 */
const MAX_FOLD = 16

interface ArmColumn {
  label: string
  key: keyof Arm
  min: number
  max: number
  /**
   * The design's authoring PRECISION, not a display choice: the table is read
   * back on every preview, so whatever it cannot represent is not in the
   * design. Four places on the lengths is what keeps a 12/7 square-wave term
   * exact enough to round-trip, and the presets are rounded to match.
   */
  decimals: number
  step: number
  title: string
}

/** `ARM_COLUMNS`, verbatim — labels, ranges, precision and tooltips. */
const ARM_COLUMNS: ArmColumn[] = [
  {
    label: 'Length',
    key: 'length',
    min: 0.01,
    max: 1000,
    decimals: 4,
    step: 0.5,
    title:
      "This arm's radius, in world units — the term's amplitude.\n" +
      "Produced by the scale of the node one level up: a node's torus IS\n" +
      'the circle its child rides.',
  },
  {
    label: 'Rate X',
    key: 'rateX',
    min: -RATE_LIMIT,
    max: RATE_LIMIT,
    decimals: 2,
    step: 1,
    title:
      'Orbit angle, degrees per frame. This is what sets the harmonic,\n' +
      'through h_k = h_(k-1) + (-1)^(k-1) * r_k — the frame flips at every\n' +
      'level, so the MAGNITUDES add. Whole numbers close in 360 frames.\n' +
      'Symmetry ▸ Apply writes this whole column for you: a rosette wants\n' +
      'one carrier followed by an alternating ±fold.',
  },
  {
    label: 'Phase X',
    key: 'phaseX',
    min: -360,
    max: 360,
    decimals: 1,
    step: 15,
    title:
      'Starting orbit angle. Changes the SHAPE of the figure without\n' +
      'changing its spectrum at all.',
  },
  {
    label: 'Tube',
    key: 'tube',
    min: 0,
    max: 1000,
    decimals: 4,
    step: 0.5,
    title:
      'Radius of a second circle this arm rides, around the torus tube —\n' +
      'world units, 0 = a flat arm. With Rate Y it is a sideband generator:\n' +
      'harmonic h becomes h, h-rateY and h+rateY, plus out-of-plane motion.',
  },
  {
    label: 'Rate Y',
    key: 'rateY',
    min: -RATE_LIMIT,
    max: RATE_LIMIT,
    decimals: 2,
    step: 1,
    title: 'Tube angle, degrees per frame. Does nothing while Tube is 0.',
  },
  {
    label: 'Phase Y',
    key: 'phaseY',
    min: -360,
    max: 360,
    decimals: 1,
    step: 15,
    title: 'Starting tube angle.',
  },
  {
    label: 'Tilt',
    key: 'tilt',
    min: -180,
    max: 180,
    decimals: 1,
    step: 5,
    title:
      "Degrees this arm's orbit plane leans out of the previous arm's.\n" +
      "Exact — it is written as the parent node's rotate_y.",
  },
]

export interface EpicycleWindowHost {
  /**
   * Add the design to the scene already open, as new ROOT objects — the chain
   * and the trail are two independent roots (desktop `_insert_into_scene`).
   */
  insert(design: EpicycleDesign, path: readonly Vec3[]): void
  /** Write the scene's CSV files and report where they went. */
  saveScene(design: EpicycleDesign, path: readonly Vec3[]): void
  /** Report a message on the status line. */
  status(message: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export class EpicycleWindow {
  readonly element: HTMLDivElement

  private readonly window: FloatWindow
  private readonly preview = new GlyphPreview()
  private readonly host: EpicycleWindowHost

  private readonly presetSelect: HTMLSelectElement
  private readonly seedInput: HTMLInputElement
  private readonly allow3d: HTMLInputElement
  private readonly armCount: HTMLInputElement
  private readonly fold: HTMLInputElement
  private readonly weave: HTMLInputElement
  private readonly foldApply: HTMLButtonElement
  private readonly foldNote: HTMLDivElement
  private readonly tableBody: HTMLTableSectionElement
  private readonly trailPalette: HTMLSelectElement
  private readonly penSize: HTMLInputElement
  private readonly showRings: HTMLInputElement
  private readonly showArms: HTMLInputElement
  private readonly trail: HTMLInputElement
  private readonly trailPoints: HTMLInputElement
  private readonly selfDrawing: HTMLInputElement
  private readonly framesInput: HTMLInputElement
  private readonly autoPreview: HTMLInputElement
  private readonly readout: HTMLDivElement
  private readonly loadInput: HTMLInputElement

  /** The name is not on screen; it comes from the preset or from Randomize. */
  private name = "Fourier_V1"
  /** The arms, which the table cells write into directly. */
  private arms: Arm[] = []
  private previewTimer: number | null = null
  /** Set while the table is being repopulated, so filling a cell previews nothing. */
  private loading = false

  constructor(host: EpicycleWindowHost) {
    this.host = host

    this.window = new FloatWindow({
      id: 'epicycle-window',
      title: 'Epitrochoid Generator',
      hotkey: 'Ctrl+Shift+E',
      className: 'epicycle-window',
    })
    this.element = this.window.element
    this.window.onOpen = () => {
      this.preview.setLive(true)
      // Like the Composer and unlike the Generator, opening previews: this
      // window opens ON a design (the ANTz original), and an empty preview
      // would be showing nothing about it.
      this.doPreview()
    }

    const body = this.window.body
    const scroll = el('div', { className: 'epicycle-scroll' })
    body.appendChild(scroll)

    scroll.appendChild(
      el('div', {
        className: 'sel-hint',
        textContent:
          'A chain of nested Torus-topology parents IS a Fourier series: each arm is ' +
          'one term, and the pen traces their sum. Rate X sets the harmonic, Length ' +
          'its amplitude, Phase X its starting angle — and Tilt or Tube take the ' +
          'figure out of the plane.',
      }),
    )

    // --- Start from -------------------------------------------------------
    scroll.appendChild(el('div', { className: 'composer-heading', textContent: 'Start from' }))

    this.presetSelect = el('select')
    for (const name of PRESET_NAMES) {
      this.presetSelect.appendChild(el('option', { value: name, textContent: name }))
    }
    const applyButton = el('button', {
      type: 'button',
      textContent: 'Apply',
      title: 'Replace the arms below with this preset.',
    })
    applyButton.addEventListener('click', () => this.applyPreset())
    const presetRow = el('div', { className: 'epicycle-inline' })
    presetRow.append(this.presetSelect, applyButton)
    scroll.appendChild(windowRow('Preset', presetRow))

    this.seedInput = el('input', {
      type: 'number',
      min: '0',
      max: String(MAX_SEED),
      step: '1',
      value: '1',
      title:
        "The design's identity: the same seed and arm count always\n" +
        'regenerate the identical design, in desktop GlyphViz too.',
    })
    this.allow3d = el('input', { type: 'checkbox', checked: true })
    const allow3dLabel = el('label', {
      className: 'sel-check',
      title:
        'Let Randomize use Tilt and Tube. Unchecked keeps every design\n' +
        'flat in the z = 0 plane.',
    })
    allow3dLabel.append(this.allow3d, document.createTextNode('3-D'))
    const randomButton = el('button', {
      type: 'button',
      textContent: 'Randomize',
      title:
        'Draw a fresh seed and build a new design from it.\n' +
        'Rates stay small whole numbers so the curve closes and reads\n' +
        'as a figure; arm lengths decay, because a series whose later\n' +
        'terms are as long as its first is noise, not a curve.',
    })
    randomButton.addEventListener('click', () => this.randomize())
    const seedRow = el('div', { className: 'epicycle-inline' })
    seedRow.append(this.seedInput, allow3dLabel, randomButton)
    scroll.appendChild(windowRow('Seed', seedRow))

    // --- Arms -------------------------------------------------------------
    scroll.appendChild(el('div', { className: 'composer-heading', textContent: 'Arms' }))

    this.armCount = el('input', {
      type: 'number',
      min: String(MIN_ARMS),
      max: String(MAX_ARMS),
      step: '1',
      value: '4',
      title:
        'Terms in the series. Adding one appends an arm continuing the\n' +
        'existing pattern; removing one drops the last.',
    })
    this.armCount.addEventListener('change', () => this.onArmCount())
    scroll.appendChild(windowRow('Arms', this.armCount))

    // --- Symmetry ---------------------------------------------------------
    // The answer to "setting hundreds of parameters": at 32 arms nobody is
    // typing 224 numbers, and the ones worth having are not independent anyway.
    // A rosette's harmonics are an arithmetic progression, so ONE number — the
    // fold — determines the whole Rate X column, and Apply writes it.
    this.fold = el('input', {
      type: 'number',
      min: '1',
      max: String(MAX_FOLD),
      step: '1',
      value: '1',
      title:
        'Rotational order to build: 6 makes a six-fold figure, 12 a rose\n' +
        'window. 1 is off — no constraint at all.\n\n' +
        'It is exact, not an approximation: a curve turns onto itself every\n' +
        '1/fold of a revolution precisely when every harmonic leaves the same\n' +
        'remainder mod the fold, so the harmonics run 1, 1±fold, 1±2·fold, …\n' +
        'Phases of 0 or 180 add the MIRROR on top, giving the full dihedral\n' +
        'symmetry of a rose window.',
    })
    // The second knob, and the difference between a star and a piece of lace.
    // At 0 the biggest term is the fundamental, so the pen goes round once and
    // the figure is a clean m-pointed star however many arms are piled on; past
    // 0 the biggest term is a high harmonic, the pen winds that many times, and
    // the passes interleave. Measured — see `symmetricArms`.
    this.weave = el('input', {
      type: 'number',
      min: '0',
      max: '8',
      step: '1',
      value: '0',
      title:
        'How far out the longest arm sits, in steps of the fold.\n\n' +
        '0 — the longest arm IS the fundamental: the pen goes round once and\n' +
        'the figure is a clean star, however many arms it has.\n' +
        'Higher — the longest arm is a fast harmonic, so the pen winds that\n' +
        'many times before the cycle closes and the passes interleave. This is\n' +
        'where the lace comes from, and it needs arms to spend: try 3 or 4 at\n' +
        '24 arms and up.',
    })
    this.weave.addEventListener('change', () => this.syncFoldNote())
    this.foldApply = el('button', {
      type: 'button',
      textContent: 'Apply',
      title:
        'Re-lay every arm as a rosette of this order, at the current arm\n' +
        'count: harmonics from the progression, amplitudes falling as 1/|h|,\n' +
        'phases zeroed.\n\n' +
        'This is how you build a big design — set Arms to 32 and press this.\n' +
        'Adding arms one at a time halves each length and the deep ones\n' +
        'vanish, which is right for a short chain and useless for a long one.',
    })
    this.foldApply.addEventListener('click', () => this.applySymmetry())
    this.fold.addEventListener('change', () => this.syncFoldNote())
    const foldRow = el('div', { className: 'epicycle-inline' })
    foldRow.append(this.fold, el('span', { textContent: 'weave' }), this.weave, this.foldApply)
    scroll.appendChild(windowRow('Symmetry', foldRow))
    this.foldNote = el('div', { className: 'composer-note' })
    scroll.appendChild(this.foldNote)

    const tableWrap = el('div', { className: 'epicycle-table-wrap' })
    const table = el('table', { className: 'epicycle-table' })
    const head = el('thead')
    const headRow = el('tr')
    headRow.appendChild(el('th', { textContent: '#' }))
    for (const column of ARM_COLUMNS) {
      // The label, plus a fill button — the other half of the "hundreds of
      // parameters" problem. Length, Phase, Tube, Rate Y and Tilt are the
      // columns a symmetric design wants UNIFORM, and one click beats 32 edits.
      const cell = el('th', { title: column.title })
      cell.append(el('span', { textContent: column.label }))
      const fill = el('button', {
        type: 'button',
        className: 'epicycle-fill',
        // A plain U+2193, not one of the prettier arrow-to-bar glyphs: this
        // app has been caught once already assuming a browser's fallback font
        // carries a symbol (the wrist panel's transport, roadmap 9 P2).
        textContent: '↓',
        title:
          `Set every arm's ${column.label} to arm 1's.\n` +
          (column.key === 'rateX'
            ? 'On Rate X this flattens the ladder to one alternating harmonic —\n' +
              'usually you want Symmetry ▸ Apply instead.'
            : 'Uniform down the chain, which is what a symmetric design wants.'),
      })
      fill.addEventListener('click', () => this.fillColumn(column))
      cell.append(fill)
      headRow.appendChild(cell)
    }
    head.appendChild(headRow)
    this.tableBody = el('tbody')
    table.append(head, this.tableBody)
    tableWrap.appendChild(table)
    scroll.appendChild(tableWrap)

    // --- Scene ------------------------------------------------------------
    scroll.appendChild(el('div', { className: 'composer-heading', textContent: 'Scene' }))

    this.penSize = this.numberInput(1.5, 0.05, 50, 2, 0.1)
    scroll.appendChild(
      windowRow(
        'Pen size',
        this.penSize,
        'World radius of the pen sphere at the end of the chain.',
      ),
    )

    this.showRings = el('input', { type: 'checkbox', checked: true })
    const ringsLabel = el('label', {
      className: 'sel-check',
      title:
        "Draw each arm's circle as a torus glyph. Off draws them as\n" +
        'wireframe instead — lighter, and easier to see the trail through.',
    })
    ringsLabel.append(this.showRings, document.createTextNode('Orbit rings'))
    this.showArms = el('input', { type: 'checkbox', checked: true })
    const armsLabel = el('label', {
      className: 'sel-check',
      title:
        'Draw the arms as type-7 Link nodes wearing Cylinder geometry —\n' +
        'real rods stretched between consecutive ring centres.',
    })
    armsLabel.append(this.showArms, document.createTextNode('Linkage rods'))
    const showRow = el('div', { className: 'epicycle-inline' })
    showRow.append(ringsLabel, armsLabel)
    scroll.appendChild(windowRow('Show', showRow))

    this.trail = el('input', { type: 'checkbox', checked: true })
    const trailLabel = el('label', {
      className: 'sel-check',
      title:
        'The traced curve: a transparent Plot-topology parent holding one\n' +
        'Point bead per sampled frame. Plot draws its polyline through\n' +
        'them in row order, so the polyline IS the curve.',
    })
    trailLabel.append(this.trail, document.createTextNode('Trail'))
    this.trailPoints = this.numberInput(720, 30, MAX_TRAIL_POINTS, 0, 30)
    this.trailPoints.title =
      'Beads along the curve. More is smoother and heavier; the count\n' +
      'is capped by the frame count, since one bead per frame is as\n' +
      'fine as the path is sampled.'
    const trailRow = el('div', { className: 'epicycle-inline' })
    trailRow.append(trailLabel, el('span', { textContent: 'points:' }), this.trailPoints)
    scroll.appendChild(windowRow('', trailRow))

    // The trail is the one place in this scene where position means TIME — the
    // pen visits the beads in order — so a palette swept once across the cycle
    // says WHEN each part of the figure was drawn, which is exactly what a
    // complex closed curve hides. The beads carry palette_id and color_index as
    // well as the literal colour, so they arrive as ordinary palette-authored
    // nodes that the Properties panel and the = / − keys understand.
    this.trailPalette = el('select', {
      title:
        'Sweep a GlyphViz palette along the trail, start of the cycle to end.\n' +
        'Solid is the plain amber, which is what desktop GlyphViz draws.\n' +
        'Rainbow Heatmap closes back on its own first colour, so a closed\n' +
        'curve comes out with no seam.',
    })
    this.trailPalette.appendChild(el('option', { value: '', textContent: 'Solid (amber)' }))
    for (const id of Object.keys(PALETTE_NAMES).map(Number).sort((a, b) => a - b)) {
      this.trailPalette.appendChild(
        el('option', { value: String(id), textContent: `${id} · ${PALETTE_NAMES[id]}` }),
      )
    }
    this.trailPalette.addEventListener('change', () => this.onChange())
    scroll.appendChild(windowRow('Trail color', this.trailPalette))

    this.selfDrawing = el('input', { type: 'checkbox' })
    const selfLabel = el('label', {
      className: 'sel-check',
      title:
        'Save Scene then also writes a ch-map/ch-tracks pair: the arms are\n' +
        'driven by Channels instead of translate_rate, and each bead alpha\n' +
        'steps on as the pen arrives, so the curve draws itself.\n' +
        'Press Space in the main window to play it.\n\n' +
        'The preview here always shows the rate-driven version with the\n' +
        'trail fully drawn, whichever way this is set.',
    })
    selfLabel.append(this.selfDrawing, document.createTextNode('Self-drawing trail (Channels)'))
    scroll.appendChild(selfLabel)

    this.framesInput = this.numberInput(0, 0, MAX_CLOSURE_FRAMES, 0, 30)
    this.framesInput.title =
      'Frames the trail is sampled over. 0 = auto: the exact period after\n' +
      'which every angle is back where it started, so the curve closes\n' +
      'instead of stopping mid-stroke.'
    scroll.appendChild(windowRow('Frames', this.framesInput, this.framesInput.title))

    for (const input of [this.penSize, this.trailPoints, this.framesInput]) {
      input.addEventListener('change', () => this.onChange())
    }
    for (const box of [this.showRings, this.showArms, this.trail, this.selfDrawing]) {
      box.addEventListener('change', () => this.onChange())
    }

    // --- Preview (pinned below the scroller) ------------------------------
    body.appendChild(this.preview.element)
    this.readout = el('div', { className: 'sel-hint epicycle-readout' })
    body.appendChild(this.readout)

    // --- Footer -----------------------------------------------------------
    // Three rows, not five: every 8 px the footer takes is 8 px the arms table
    // does not get, and the table is the control this window is FOR. Stacking
    // the Auto checkbox and the four buttons on a line of their own cost 80 px
    // and put arm 4 below the fold at the default design (found by looking at
    // the window, after 59 measured checks had passed).
    const footer = el('div', { className: 'float-window-footer' })

    this.autoPreview = el('input', { type: 'checkbox', checked: true })
    const autoRow = el('label', {
      className: 'sel-check',
      title: 'Rebuild the preview shortly after every edit.',
    })
    autoRow.append(this.autoPreview, document.createTextNode('Auto'))

    const previewNow = el('button', {
      type: 'button',
      textContent: 'Preview Now',
      title: 'Rebuild the preview from the current parameters.',
    })
    previewNow.addEventListener('click', () => this.doPreview())
    const resetView = el('button', {
      type: 'button',
      textContent: 'Reset View',
      title: 'Re-frame the preview camera on the whole figure.',
    })
    resetView.addEventListener('click', () => this.preview.refit())
    const previewButtons = el('div', { className: 'epicycle-inline epicycle-footer-row' })
    previewButtons.append(autoRow, previewNow, resetView)
    footer.appendChild(previewButtons)

    const ioButtons = el('div', { className: 'hud-create-buttons' })
    const loadLabel = el('label', {
      className: 'hud-file-button',
      textContent: 'Load Design…',
      title: 'Reopen a design .json saved from this window, or from desktop GlyphViz.',
    })
    this.loadInput = el('input', { type: 'file', accept: '.json,application/json' })
    this.loadInput.addEventListener('change', () => this.loadDesignFile())
    loadLabel.appendChild(this.loadInput)
    const saveDesign = el('button', {
      type: 'button',
      textContent: 'Save Design…',
      title:
        'Download the parameters as .json so this design can be reopened and\n' +
        'tuned later. Not needed to view or share the result — that is what\n' +
        "Save Scene's CSVs are.",
    })
    saveDesign.addEventListener('click', () => this.saveDesignFile())
    ioButtons.append(loadLabel, saveDesign)
    footer.appendChild(ioButtons)

    const actions = el('div', { className: 'hud-create-buttons epicycle-actions' })
    const saveScene = el('button', {
      type: 'button',
      textContent: 'Save Scene (CSV)…',
      title:
        'Download a complete, loadable scene: node CSV + tag CSV, plus the\n' +
        'ch-map/ch-tracks pair when Self-drawing is on.\n\n' +
        'Put them in ONE folder of their own, and not with other scenes:\n' +
        'GlyphViz auto-loads Channels only when exactly one ch-map and one\n' +
        'ch-tracks file sit beside the node CSV.',
    })
    saveScene.addEventListener('click', () => this.saveScene())

    const insert = el('button', {
      type: 'button',
      textContent: 'Insert into Scene',
      title:
        'Add this design to the scene already open, as new root objects.\n' +
        'The window stays open.',
    })
    insert.addEventListener('click', () => this.insert())
    actions.append(saveScene, insert)
    footer.appendChild(actions)

    body.appendChild(footer)

    this.loadDesign(preset(PRESET_NAMES[0]))
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

  // ------------------------------------------------------- design ↔ widgets

  /** Push a whole design into the controls, without previewing on the way. */
  private loadDesign(design: EpicycleDesign): void {
    this.loading = true
    try {
      this.name = design.name
      this.arms = design.arms.map((a) => ({ ...a }))
      this.armCount.value = String(this.arms.length)
      this.rebuildTable()
      this.penSize.value = String(design.penSize)
      this.showRings.checked = design.showRings
      this.showArms.checked = design.showArms
      this.trail.checked = design.trail
      this.trailPoints.value = String(Math.trunc(design.trailPoints))
      this.trailPalette.value = design.trailPalette === null ? '' : String(design.trailPalette)
      this.selfDrawing.checked = design.selfDrawing
      this.framesInput.value = String(design.frames ?? 0)
      // The fold is MEASURED off the arms rather than remembered, so loading a
      // design (or a preset, or a hand-edited file) shows the symmetry it
      // actually has instead of whatever the box was last set to.
      const measured = describeDesign(design, [], 1).fold
      this.fold.value = String(Math.min(MAX_FOLD, measured))
      this.weave.value = String(Math.min(8, weaveOf(design)))
      this.syncFoldNote()
    } finally {
      this.loading = false
    }
  }

  /** The Symmetry row's own state line — what the number will do if applied. */
  private syncFoldNote(): void {
    const asked = Math.round(Number(this.fold.value) || 1)
    const count = this.arms.length
    const usable = maxFoldForArms(count)
    this.foldApply.disabled = asked < 2
    if (asked < 2) {
      this.foldNote.textContent = 'Off — Randomize rolls every rate freely.'
      return
    }
    const applied = Math.min(asked, usable)
    const weave = Math.max(0, Math.round(Number(this.weave.value) || 0))
    const petals = `${applied}-fold, ${count} terms`
    const shape =
      weave > 0
        ? `woven on harmonic ${1 + weave * applied}`
        : `harmonics 1, 1±${applied}, 1±${2 * applied}, …`
    // "Apply builds", because this row describes the PENDING action. The fold
    // and weave boxes are filled from the design on load, but the moment either
    // is touched they are a request rather than a report — and what the design
    // in hand actually IS gets measured and said in the readout below.
    this.foldNote.textContent =
      applied === asked
        ? `Apply builds ${petals} — ${shape}`
        : `Apply builds ${petals} — ${asked} needs fewer arms to stay inside ±${RATE_LIMIT}.`
  }

  /** Set every arm's value in one column to arm 1's. */
  private fillColumn(column: ArmColumn): void {
    if (this.arms.length === 0) return
    const value = this.arms[0][column.key]
    for (const arm of this.arms) arm[column.key] = value
    this.loading = true
    try {
      this.rebuildTable()
    } finally {
      this.loading = false
    }
    this.host.status(
      `Epitrochoid Generator: set ${column.label} to ${formatG(value)} on all ` +
        `${this.arms.length} arms.`,
    )
    this.onChange()
  }

  /**
   * Re-lay the current arms as a rosette of the chosen order, keeping the arm
   * count and the scene dressing. The tube is carried across from whichever arm
   * had one, snapped onto the fold's lattice so the solid keeps the symmetry.
   */
  private applySymmetry(): void {
    const asked = Math.round(Number(this.fold.value) || 0)
    if (asked < 2) return
    const count = this.arms.length
    const applied = Math.min(asked, maxFoldForArms(count))
    const tubeArm = this.arms.find((a) => a.tube > 0)
    const base = Math.max(...this.arms.map((a) => a.length), 1)
    this.arms = symmetricArms({
      fold: applied,
      count,
      base,
      // 1.3 rather than 1: measured across the presets as the falloff that
      // reads as a crisp figure at any arm count, where 1 leaves the far terms
      // strong enough to fuzz the line.
      decay: 1.3,
      weave: Math.max(0, Math.round(Number(this.weave.value) || 0)),
      tubeFraction: tubeArm ? Math.min(0.9, tubeArm.tube / Math.max(1e-6, tubeArm.length)) : 0,
      tubeRate: tubeArm ? tubeArm.rateY : 0,
    })
    this.loading = true
    try {
      this.fold.value = String(applied)
      this.rebuildTable()
      this.syncFoldNote()
    } finally {
      this.loading = false
    }
    this.host.status(
      `Epitrochoid Generator: laid ${count} arms as a ${applied}-fold rosette` +
        (applied === asked ? '.' : ` (${asked} would alias at this arm count).`),
    )
    this.doPreview(true)
  }

  /** The design the controls currently describe. */
  private designFromUi(): EpicycleDesign {
    const base = preset(PRESET_NAMES[0])
    return {
      name: this.name,
      arms: this.arms.map((a) => ({ ...a })),
      penSize: Number(this.penSize.value),
      ringRatio: base.ringRatio,
      showRings: this.showRings.checked,
      showArms: this.showArms.checked,
      armRatio: base.armRatio,
      trail: this.trail.checked,
      trailPoints: Number(this.trailPoints.value),
      trailPalette: this.trailPalette.value === '' ? null : Number(this.trailPalette.value),
      selfDrawing: this.selfDrawing.checked,
      beadGroup: base.beadGroup,
      frames: Number(this.framesInput.value) || null,
    }
  }

  private rebuildTable(): void {
    this.tableBody.textContent = ''
    this.arms.forEach((arm, index) => {
      const row = el('tr')
      row.appendChild(el('th', { scope: 'row', textContent: String(index + 1) }))
      for (const column of ARM_COLUMNS) {
        const cell = el('td')
        const input = this.numberInput(
          arm[column.key],
          column.min,
          column.max,
          column.decimals,
          column.step,
        )
        input.title = column.title
        input.addEventListener('change', () => {
          const value = this.commitNumber(input, column.min, column.max, column.decimals)
          arm[column.key] = value
          this.onChange()
        })
        cell.appendChild(input)
        row.appendChild(cell)
      }
      this.tableBody.appendChild(row)
    })
  }

  /**
   * `_on_arm_count` — grow by continuing the PATTERN rather than appending a
   * default: a new arm half the length of the last, spinning the other way, is
   * the next term of a series, where a length-10 arm on the end of a decaying
   * chain would swamp everything before it.
   */
  private onArmCount(): void {
    const n = Math.min(MAX_ARMS, Math.max(MIN_ARMS, Math.round(Number(this.armCount.value) || 0)))
    this.armCount.value = String(n)
    while (this.arms.length > n) this.arms.pop()
    while (this.arms.length < n) {
      this.arms.push(this.arms.length > 0 ? continuedArm(this.arms[this.arms.length - 1]) : defaultArm())
    }
    this.loading = true
    try {
      this.rebuildTable()
      this.syncFoldNote()
    } finally {
      this.loading = false
    }
    this.onChange()
  }

  private applyPreset(): void {
    this.loadDesign(preset(this.presetSelect.value))
    this.doPreview(true)
  }

  /**
   * Roll a design. With Symmetry off this is the desktop's own generator,
   * seed for seed; with a fold set it is `randomSymmetricDesign`, which rolls
   * everything EXCEPT the harmonics — those are what the symmetry is, and the
   * reason the free version reads as a wormy tangle is that it rolls them too.
   */
  private randomize(): void {
    const seed = Math.floor(Math.random() * (MAX_SEED + 1))
    this.seedInput.value = String(seed)
    const count = Math.round(Number(this.armCount.value))
    const asked = Math.round(Number(this.fold.value) || 0)
    const design =
      asked >= 2
        ? randomSymmetricDesign(new PythonRandom(seed), {
            fold: asked,
            count,
            allow3d: this.allow3d.checked,
            name: `Rosette_${Math.min(asked, maxFoldForArms(count))}_${seed}`,
          })
        : randomDesign(
            new PythonRandom(seed),
            count,
            this.allow3d.checked,
            `Epitrochoid_${seed}`,
          )
    // Keep the scene-dressing choices the user has made; only the arms and the
    // pen are what Randomize is for.
    const current = this.designFromUi()
    design.showRings = current.showRings
    design.showArms = current.showArms
    design.trail = current.trail
    design.trailPoints = current.trailPoints
    design.trailPalette = current.trailPalette
    design.selfDrawing = current.selfDrawing
    this.loadDesign(design)
    // loadDesign measures the fold off the arms, which for a free roll is
    // usually 1 — the box is the user's setting, so put it back.
    this.fold.value = String(asked)
    this.syncFoldNote()
    this.doPreview(true)
  }

  // ------------------------------------------------------------------ preview

  private onChange(): void {
    if (this.loading) return
    if (!this.autoPreview.checked) return
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null
      this.doPreview()
    }, PREVIEW_DELAY_MS)
  }

  /**
   * Rebuild and redraw, holding the camera where the user put it — auto-framing
   * is right on the first build and wrong on every keystroke afterwards, since
   * zooming into a cusp and being yanked back to an overview on the next edit
   * makes close-up work impossible (the fix the Glyph Composer's preview needed
   * first).
   */
  private doPreview(resetCamera = false): void {
    if (!this.window.isOpen) return
    const design = this.designFromUi()
    const frames = frameCount(design)
    const path = traceEpicyclePath(design, frames)
    // ALWAYS the rate-driven build: it moves on its own and its trail is fully
    // drawn, so the pen can be seen riding a curve computed independently of it.
    const nodes = buildEpicycleNodes({ ...design, selfDrawing: false }, { path })
    this.preview.setNodes(nodes, !resetCamera)
    this.updateReadout(design, path, frames, nodes.length)
  }

  private updateReadout(
    design: EpicycleDesign,
    path: readonly Vec3[],
    frames: number,
    nodeCount: number,
  ): void {
    const info = describeDesign(design, path, frames)
    this.readout.textContent = ''

    const line = (label: string, ...rest: Array<string | Node>) => {
      const div = el('div')
      div.appendChild(el('b', { textContent: label }))
      div.append(' ', ...rest)
      this.readout.appendChild(div)
    }

    // Every rung at a handful of arms; at 32 the full ladder wraps to four
    // lines and pushes the preview off the bottom, so it elides the middle —
    // the ends are what say what the design spans, and the count says the rest.
    const rungs = info.harmonics.map((h) => formatG(h))
    const ladder =
      rungs.length <= 10
        ? rungs.join(' → ')
        : `${rungs.slice(0, 4).join(' → ')} → … → ${rungs.slice(-2).join(' → ')}` +
          ` (${rungs.length} terms)`
    const closes =
      info.closes !== null
        ? `closes in ${info.closes} frames`
        : `does not close within ${MAX_CLOSURE_FRAMES} frames — sampled over ${frames}`
    const closesNode = el('span', {
      className: info.closes !== null ? '' : 'epicycle-warn',
      textContent: closes,
    })
    line('Harmonic ladder', ladder, '  |  ', closesNode)

    const spectrum = el('span')
    if (info.spectrum.length === 0) {
      spectrum.textContent = '—'
    } else {
      info.spectrum.slice(0, 8).forEach(([h, a], i) => {
        if (i > 0) spectrum.append(', ')
        spectrum.append(formatG(h))
        spectrum.appendChild(el('span', { className: 'epicycle-dim', textContent: `×${a.toFixed(2)}` }))
      })
    }
    line('Spectrum', spectrum)

    const shape = info.planar ? 'planar (z = 0)' : `3-D, ${info.zExtent.toFixed(1)} units deep`
    // The fold is MEASURED off the harmonics, so it reports the symmetry a
    // hand-typed design turns out to have as readily as one Apply built.
    const symmetry = info.fold > 1 ? `${info.fold}-fold symmetric` : 'no rotational symmetry'
    line(
      'Figure',
      `${shape}, ${symmetry}, half-span ${info.halfSpan.toFixed(1)} | ${nodeCount} nodes`,
    )

    // The one real ceiling on how complex a design can be, and it is NYQUIST
    // rather than the machine: a bead every `step` frames cannot describe an
    // angle faster than 180/step, so past that the beads still land ON the
    // curve while the polyline between them draws something else entirely.
    // This is the honest version of 'that many arms might be too many' -
    // nothing crashes, and what DOES degrade is measurable and says its own
    // remedy.
    if (info.aliased) {
      const warn = el('div')
      warn.appendChild(
        el('span', {
          className: 'epicycle-warn',
          textContent:
            `Harmonic ${formatG(info.peakHarmonic)} is past the ` +
            `${formatG(info.nyquist)} this trail can sample`,
        }),
      )
      warn.append(
        ' - raise Trail points, or lower Frames. The beads sit on the curve; ' +
          'the line between them does not.',
      )
      this.readout.appendChild(warn)
    }
  }

  renderFrame(dtMs: number): void {
    this.preview.renderFrame(dtMs)
  }

  // ------------------------------------------------------------------- output

  private insert(): void {
    const design = this.designFromUi()
    this.host.insert(design, traceEpicyclePath(design, frameCount(design)))
  }

  private saveScene(): void {
    const design = this.designFromUi()
    this.host.saveScene(design, traceEpicyclePath(design, frameCount(design)))
  }

  private saveDesignFile(): void {
    const design = this.designFromUi()
    const stem = design.name.trim() || 'epitrochoid'
    const text = `${JSON.stringify(designToJson(design), null, 2)}\n`
    const blob = new Blob([text], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${stem}_design.json`
    a.click()
    URL.revokeObjectURL(a.href)
    this.host.status(`Epitrochoid Generator: saved design as ${stem}_design.json.`)
  }

  private async loadDesignFile(): Promise<void> {
    const file = this.loadInput.files?.[0]
    // Clear it either way, so picking the same file twice fires a change event.
    this.loadInput.value = ''
    if (!file) return
    try {
      const design = designFromJson(JSON.parse(await file.text()))
      this.loadDesign(design)
      // A different figure entirely — frame it, rather than keeping a camera
      // aimed at the one it replaced.
      this.doPreview(true)
      this.host.status(
        `Epitrochoid Generator: loaded "${design.name}" (${design.arms.length} arm(s)).`,
      )
    } catch (error) {
      // The design in progress is left alone — a bad file must not replace it.
      this.host.status(
        `Epitrochoid Generator: could not read ${file.name} — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  dispose(): void {
    this.preview.dispose()
  }

  // ------------------------------------------------------------------ helpers

  private numberInput(
    value: number,
    min: number,
    max: number,
    decimals: number,
    step: number,
  ): HTMLInputElement {
    return el('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(pyRound(value, decimals)),
    })
  }

  /**
   * Clamp and round on commit, exactly as a QDoubleSpinBox does — a spinbox
   * cannot be typed out of range, and it stores only its own decimals. That
   * second half is load-bearing rather than cosmetic: the table IS the design,
   * so a value it cannot represent is not in the design.
   */
  private commitNumber(
    input: HTMLInputElement,
    min: number,
    max: number,
    decimals: number,
  ): number {
    const raw = Number(input.value)
    const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, min), max) : min
    const value = pyRound(clamped, decimals)
    input.value = String(value)
    return value
  }
}
