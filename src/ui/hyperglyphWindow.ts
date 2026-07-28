// The Hyperglyph Generator window — a port of the desktop's
// `glyphviz_gl/hyperglyph_dialog.py` (verified against source 2026-07-28):
// parameters, a Regenerate button, a live 3D preview of the design, and Insert
// into Scene.
//
// It is a FLOATING window rather than one of this app's docked HUD panels,
// which is the one piece of chrome in GlyphViz Web that is. That is deliberate
// and it is what Jeff asked for: the desktop's is a QDialog you can drag off to
// the side while you look at the scene behind it, generate a few designs, and
// drop the one you like in. A docked panel would have had to be dismissed to
// see the result of using it. Being modeless is also parity — the desktop's
// `dlg.exec()` is modal, but its Insert into Scene edits the live scene behind
// it, so the modality buys nothing there and costs the ability to reposition
// the camera between insertions here.
//
// The preview is its OWN WebGL renderer on its own canvas, not a viewport of
// the main one: the window moves, and a second context is far simpler than
// scissoring a rectangle that has to track a draggable element. It reuses
// buildScene and the app's own lighting rig, so a design looks in the preview
// exactly as it will once inserted.
//
// One rule worth keeping if this is edited: NOTHING here regenerates a design
// except the Regenerate button. Not opening the window, not changing a
// parameter, not toggling a checkbox. The desktop learned that the hard way —
// auto-rerolling on every edit made "Randomize" impossible to inspect before
// committing to it.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  buildHyperglyphNodes,
  DETERMINISTIC_SEED,
  generateHyperglyph,
} from '../gv/hyperglyph'
import type { HyperglyphDesign } from '../gv/hyperglyph'
import { applyRateAnimation, rateCandidates } from '../gv/rates'
import type { GvNode } from '../gv/types'
import { buildScene } from '../render/buildScene'
import type { SceneBuildResult } from '../render/buildScene'
import { DynamicNodes } from '../render/dynamicNodes'
import { applyDesktopColorPipeline, SceneLighting } from '../render/lighting'

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

  private readonly host: HyperglyphWindowHost
  private readonly maxNodes: HTMLInputElement
  private readonly branchLevels: HTMLInputElement
  private readonly randomize: HTMLInputElement
  private readonly seed: HTMLInputElement
  private readonly idleMotion: HTMLInputElement
  private readonly info: HTMLDivElement
  private readonly insertButton: HTMLButtonElement
  private readonly previewBox: HTMLDivElement

  // --- Preview renderer (built lazily, on the first open) ---
  private renderer: THREE.WebGLRenderer | null = null
  private previewScene: THREE.Scene | null = null
  private previewCamera: THREE.PerspectiveCamera | null = null
  private previewControls: OrbitControls | null = null
  private lighting: SceneLighting | null = null
  private built: SceneBuildResult | null = null
  private dynamic: DynamicNodes | null = null
  /** Materials cloned out of the shared cache — see rebuildPreview(). */
  private privateMaterials: THREE.Material[] = []
  private previewRateNodes: GvNode[] = []

  private design: HyperglyphDesign | null = null
  private open = false

  constructor(host: HyperglyphWindowHost) {
    this.host = host

    this.element = el('div', { id: 'hyperglyph-window', className: 'float-window' })
    this.element.hidden = true

    // --- Header (drag handle + close) ---
    const header = el('div', { className: 'float-window-header' })
    const title = el('span', { className: 'float-window-title', textContent: 'Hyperglyph Generator' })
    const hotkey = el('span', { className: 'panel-hotkey', textContent: 'Ctrl+H' })
    const close = el('button', {
      type: 'button',
      className: 'panel-close',
      textContent: '×',
      title: 'Close this window  (Ctrl+H brings it back)',
    })
    close.addEventListener('click', () => this.setOpen(false))
    header.append(title, hotkey, close)
    this.makeDraggable(header)

    const body = el('div', { className: 'float-window-body' })

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
      this.row('Max Nodes', this.maxNodes, 'Upper bound on total node count (a cap, not a target).'),
    )

    this.branchLevels = el('input', {
      type: 'number',
      min: String(BRANCH_LEVELS_MIN),
      max: String(BRANCH_LEVELS_MAX),
      step: '1',
      value: String(BRANCH_LEVELS_DEFAULT),
    })
    body.appendChild(
      this.row(
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
      this.row(
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
        "Rate Motion in the Channels panel freezes a live hyperglyph in place.",
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

    this.previewBox = el('div', { className: 'hyperglyph-preview' })
    body.appendChild(this.previewBox)

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

    this.element.append(header, body)
  }

  private row(label: string, input: HTMLElement, title: string): HTMLDivElement {
    const div = el('div', { className: 'hud-create-row', title })
    div.append(el('span', { textContent: label }), input)
    return div
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

  // ---------------------------------------------------------------- open/close

  get isOpen(): boolean {
    return this.open
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  setOpen(value: boolean): void {
    this.open = value
    this.element.hidden = !value
    if (!value) return
    this.ensureRenderer()
    // Opening deliberately does NOT generate: the desktop dropped that
    // behaviour because it produced a hyperglyph already mid-animation before
    // the user had done anything.
    this.resizePreview()
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
    this.rebuildPreview(nodes)

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

  // ------------------------------------------------------------------- preview

  private ensureRenderer(): void {
    if (this.renderer) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    applyDesktopColorPipeline(renderer)
    renderer.setPixelRatio(window.devicePixelRatio)
    this.previewBox.appendChild(renderer.domElement)
    this.renderer = renderer

    this.previewScene = new THREE.Scene()
    this.previewCamera = new THREE.PerspectiveCamera(60, 1, 0.001, 1000)
    this.previewCamera.up.set(0, 0, 1)
    this.lighting = new SceneLighting(this.previewScene)

    this.previewControls = new OrbitControls(this.previewCamera, renderer.domElement)
    this.previewControls.enableDamping = false

    // The window is resizable, and its body reflows as the info line wraps.
    new ResizeObserver(() => this.resizePreview()).observe(this.previewBox)
  }

  private resizePreview(): void {
    if (!this.renderer || !this.previewCamera) return
    const width = Math.max(1, this.previewBox.clientWidth)
    const height = Math.max(1, this.previewBox.clientHeight)
    this.renderer.setSize(width, height, false)
    this.previewCamera.aspect = width / height
    this.previewCamera.updateProjectionMatrix()
  }

  private rebuildPreview(nodes: GvNode[]): void {
    this.ensureRenderer()
    const scene = this.previewScene!
    this.disposePreviewScene()

    // No textures and no meshes: a generated design references neither (the
    // generator excludes Mesh geometry outright, having no model to point at).
    const built = buildScene(nodes, {
      showHidden: false,
      textures: new Map(),
      meshes: new Map(),
      drawLimit: null,
    })
    this.built = built
    scene.add(built.root)
    scene.background = built.background

    // Glyph materials come from a module-level cache shared with the main
    // scene, and loading a scene there calls clearMaterialCache() — which would
    // dispose materials this preview is still drawing with. Clone once per
    // UNIQUE material (they are shared by the hundred within a design) and the
    // preview owns its own, immune to that and safe to dispose on rebuild.
    this.privateMaterials = privatiseSharedMaterials(built.root)

    // Idle Motion is rotate_rate, so the preview has to integrate rates for
    // the spin to show — the desktop's mini viewport is a full Viewport and
    // animates them for the same reason.
    this.previewRateNodes = rateCandidates(nodes, new Set())
    this.dynamic = new DynamicNodes(
      nodes,
      built.frames,
      {
        transform: new Set(this.previewRateNodes.map((n) => n.id)),
        appearance: new Set(),
        scaled: new Set(),
      },
      new Map(),
    )

    built.root.updateMatrixWorld()
    this.frameCamera(built.root)
  }

  private frameCamera(root: THREE.Object3D): void {
    const camera = this.previewCamera!
    const controls = this.previewControls!
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) {
      controls.target.set(0, 0, 0)
      camera.position.set(4, -6, 4)
      controls.update()
      return
    }
    const center = box.getCenter(new THREE.Vector3())
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const distance = Math.max(1, (sphere.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.2)
    camera.position.copy(center).addScaledVector(new THREE.Vector3(0.7, -1, 0.55).normalize(), distance)
    camera.far = Math.max(1000, distance * 100)
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()
  }

  /**
   * One preview frame. Called from the host's animation loop rather than a
   * second requestAnimationFrame, so the two renderers share a clock and a
   * closed window costs exactly one boolean test.
   */
  renderFrame(dtMs: number): void {
    if (!this.open || !this.renderer || !this.previewScene || !this.previewCamera) return
    if (this.previewRateNodes.length > 0) {
      if (applyRateAnimation(this.previewRateNodes, dtMs).size > 0) this.dynamic?.update()
    }
    this.previewControls?.update()
    this.lighting?.update(this.previewCamera)
    this.built?.links.update()
    this.built?.overlays.update()
    this.renderer.render(this.previewScene, this.previewCamera)
  }

  private disposePreviewScene(): void {
    if (this.built && this.previewScene) this.previewScene.remove(this.built.root)
    this.dynamic?.dispose()
    this.dynamic = null
    this.built?.overlays.dispose()
    this.built = null
    for (const material of this.privateMaterials) material.dispose()
    this.privateMaterials = []
    this.previewRateNodes = []
  }

  /** Release the second GL context — for a host teardown, not for a close. */
  dispose(): void {
    this.disposePreviewScene()
    this.previewControls?.dispose()
    this.renderer?.dispose()
    this.renderer = null
  }
}

/**
 * Give `root` private copies of every material it draws with, one clone per
 * unique original. Geometry stays shared (those caches are never cleared and
 * are safe across renderers); only materials have a disposal path that can be
 * triggered from outside this window.
 */
function privatiseSharedMaterials(root: THREE.Object3D): THREE.Material[] {
  const clones = new Map<THREE.Material, THREE.Material>()
  root.traverse((object) => {
    const drawable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    const material = drawable.material
    if (!material || Array.isArray(material)) return
    let clone = clones.get(material)
    if (!clone) {
      clone = material.clone()
      clones.set(material, clone)
    }
    drawable.material = clone
  })
  return [...clones.values()]
}
