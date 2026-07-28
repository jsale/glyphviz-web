// The Hyperglyph Generator window — a port of the desktop's
// `glyphviz_gl/hyperglyph_dialog.py` (verified against source 2026-07-28):
// parameters, a Regenerate button, a live 3D preview of the design, and Insert
// into Scene.
//
// The window frame is `floatWindow.ts` and the preview is `glyphPreview.ts`,
// both shared with the Glyph Composer (Ctrl+G) — see those files for why this
// app's two tool windows float rather than dock, and why the preview is a
// second renderer.
//
// One rule worth keeping if this is edited: NOTHING here regenerates a design
// except the Regenerate button. Not opening the window, not changing a
// parameter, not toggling a checkbox. The desktop learned that the hard way —
// auto-rerolling on every edit made "Randomize" impossible to inspect before
// committing to it. (The Composer is the opposite, and correctly so: it has an
// Auto-preview checkbox, because it edits a design rather than rolling one.)

import {
  buildHyperglyphNodes,
  DETERMINISTIC_SEED,
  generateHyperglyph,
} from '../gv/hyperglyph'
import type { HyperglyphDesign } from '../gv/hyperglyph'
import { FloatWindow, windowRow } from './floatWindow'
import { GlyphPreview } from './glyphPreview'

/** Seed field range: CPython's own `random.randrange(2 ** 31)`. */
const MAX_SEED = 2 ** 31 - 1

/** Desktop spinbox ranges and defaults, verbatim. */
const MAX_NODES_DEFAULT = 500
const MAX_NODES_MIN = 2
const MAX_NODES_MAX = 20000
const BRANCH_LEVELS_DEFAULT = 5
const BRANCH_LEVELS_MIN = 1
const BRANCH_LEVELS_MAX = 10

export interface HyperglyphWindowHost {
  /** Add the design's nodes to the live scene and report it on the status bar. */
  insert(design: HyperglyphDesign): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export class HyperglyphWindow {
  readonly element: HTMLDivElement

  private readonly window: FloatWindow
  private readonly preview = new GlyphPreview()
  private readonly host: HyperglyphWindowHost
  private readonly maxNodes: HTMLInputElement
  private readonly branchLevels: HTMLInputElement
  private readonly randomize: HTMLInputElement
  private readonly seed: HTMLInputElement
  private readonly idleMotion: HTMLInputElement
  private readonly info: HTMLDivElement
  private readonly insertButton: HTMLButtonElement

  private design: HyperglyphDesign | null = null

  constructor(host: HyperglyphWindowHost) {
    this.host = host

    this.window = new FloatWindow({
      id: 'hyperglyph-window',
      title: 'Hyperglyph Generator',
      hotkey: 'Ctrl+H',
    })
    this.element = this.window.element
    this.window.onOpen = () => {
      // Opening deliberately does NOT generate: the desktop dropped that
      // behaviour because it produced a hyperglyph already mid-animation
      // before the user had done anything.
      this.preview.setLive(true)
    }

    const body = this.window.body

    body.appendChild(
      el('div', {
        className: 'sel-hint',
        textContent:
          'One randomized multi-level hyperglyph at a time, from a branch-level ' +
          'count and a node budget.',
      }),
    )

    // --- Parameters ---
    this.maxNodes = el('input', {
      type: 'number',
      min: String(MAX_NODES_MIN),
      max: String(MAX_NODES_MAX),
      step: '50',
      value: String(MAX_NODES_DEFAULT),
    })
    body.appendChild(
      windowRow(
        'Max Nodes',
        this.maxNodes,
        'Upper bound on total node count (a cap, not a target).',
      ),
    )

    this.branchLevels = el('input', {
      type: 'number',
      min: String(BRANCH_LEVELS_MIN),
      max: String(BRANCH_LEVELS_MAX),
      step: '1',
      value: String(BRANCH_LEVELS_DEFAULT),
    })
    body.appendChild(
      windowRow(
        'Branch Levels',
        this.branchLevels,
        'Number of branch levels, including the trunk (root).',
      ),
    )

    this.randomize = el('input', { type: 'checkbox', checked: true })
    const randomizeRow = el('label', {
      className: 'sel-check',
      title:
        'Checked: every Regenerate draws a new random seed (shown below).\n' +
        "Unchecked: Regenerate reuses the Seed field's value exactly — the same\n" +
        'Seed / Max Nodes / Branch Levels always regenerate the identical design.\n' +
        'Uncheck right after a result you like to lock in that exact seed for\n' +
        'further tweaking.',
    })
    randomizeRow.append(this.randomize, document.createTextNode('Randomize'))
    // A pure UI-state update: which field is live. Toggling this must never
    // itself reroll the design (desktop `_on_randomize_toggled`).
    this.randomize.addEventListener('change', () => {
      this.seed.disabled = this.randomize.checked
    })
    body.appendChild(randomizeRow)

    this.seed = el('input', {
      type: 'number',
      min: '0',
      max: String(MAX_SEED),
      step: '1',
      value: String(DETERMINISTIC_SEED),
      disabled: true, // Randomize starts checked
    })
    body.appendChild(
      windowRow(
        'Seed',
        this.seed,
        'Only used when Randomize is unchecked. While Randomize is checked, each\n' +
          'Regenerate draws a new seed and displays it here.\n' +
          'A seed names the same design in desktop GlyphViz.',
      ),
    )

    this.idleMotion = el('input', { type: 'checkbox', checked: true })
    const idleRow = el('label', {
      className: 'sel-check',
      title:
        'Gentle counter-rotating spin per branch level, evolving the hyperglyph\n' +
        'through new orientations continuously. The static design underneath is\n' +
        'already complete without it.\n' +
        'Rate Motion in the Channels panel freezes a live hyperglyph in place.',
    })
    idleRow.append(this.idleMotion, document.createTextNode('Idle Motion (rotate_rate)'))
    body.appendChild(idleRow)

    const regenerate = el('button', {
      type: 'button',
      className: 'float-window-action',
      textContent: 'Regenerate',
      title: 'Generate a new design. Nothing else in this window ever rerolls one.',
    })
    regenerate.addEventListener('click', () => this.regenerate())
    body.appendChild(regenerate)

    this.info = el('div', {
      className: 'sel-hint',
      textContent: 'No hyperglyph generated yet — click Regenerate.',
    })
    body.appendChild(this.info)

    body.appendChild(this.preview.element)

    // --- Footer ---
    const footer = el('div', { className: 'float-window-footer' })
    this.insertButton = el('button', {
      type: 'button',
      className: 'float-window-action',
      textContent: 'Insert into Scene',
      disabled: true,
      title:
        'Add this design to the scene: under the selected node, or as a new\n' +
        'root object with nothing selected. The window stays open.',
    })
    this.insertButton.addEventListener('click', () => this.insert())
    footer.appendChild(this.insertButton)
    body.appendChild(footer)
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

  // ------------------------------------------------------------------ generate

  private regenerate(): void {
    const branchLevels = this.clamp(this.branchLevels, BRANCH_LEVELS_MIN, BRANCH_LEVELS_MAX)
    const maxNodes = this.clamp(this.maxNodes, MAX_NODES_MIN, MAX_NODES_MAX)
    const randomize = this.randomize.checked

    let seed: number
    if (randomize) {
      seed = Math.floor(Math.random() * (MAX_SEED + 1))
      this.seed.value = String(seed)
    } else {
      seed = this.clamp(this.seed, 0, MAX_SEED)
    }

    const design = generateHyperglyph({
      branchLevels,
      maxNodes,
      seed,
      idleMotion: this.idleMotion.checked,
    })
    this.design = design
    this.insertButton.disabled = false

    const nodes = buildHyperglyphNodes(design)
    // Every Regenerate is a different design of a different size, so the
    // preview camera reframes — unlike the Composer's, which is editing one.
    this.preview.setNodes(nodes)

    const seedDesc = randomize ? 'random seed' : 'fixed seed (Randomize off)'
    this.info.textContent =
      `${nodes.length} nodes | family=${design.meta.geometryFamily} | ` +
      `palette=${design.meta.paletteScheme} | ${seedDesc}: ${seed}`
  }

  /** Read a number field, clamped — a spinbox cannot be typed out of range. */
  private clamp(input: HTMLInputElement, min: number, max: number): number {
    const value = Math.round(Number(input.value))
    const clamped = Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min
    input.value = String(clamped)
    return clamped
  }

  private insert(): void {
    if (!this.design) return
    this.host.insert(this.design)
  }

  renderFrame(dtMs: number): void {
    this.preview.renderFrame(dtMs)
  }

  /** Release the second GL context — for a host teardown, not for a close. */
  dispose(): void {
    this.preview.dispose()
  }
}
