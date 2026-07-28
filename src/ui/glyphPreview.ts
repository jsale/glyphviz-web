// The live 3D preview both tool windows show: a SECOND WebGLRenderer on its own
// canvas, not a viewport of the main one. The windows move, and a second
// context is far simpler than scissoring a rectangle that has to track a
// draggable element. It reuses buildScene and the app's own lighting rig, so a
// design looks in the preview exactly as it will once inserted.
//
// The desktop's equivalent is a second `Viewport` widget dropped into each
// dialog (`hyperglyph_dialog._mini_vp`, `glyph_composer_dialog._mini_vp`), which
// is the same decision — a whole renderer per dialog rather than a shared one.
//
// It integrates RATES, because both dialogs produce designs that can carry
// rotate_rate: the Hyperglyph Generator's Idle Motion is nothing but that, and
// a Composer recipe inherits whatever a loaded template holds.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyRateAnimation, rateCandidates } from '../gv/rates'
import type { GvNode } from '../gv/types'
import { buildScene } from '../render/buildScene'
import type { SceneBuildResult } from '../render/buildScene'
import { DynamicNodes } from '../render/dynamicNodes'
import { applyDesktopColorPipeline, SceneLighting } from '../render/lighting'

export class GlyphPreview {
  /** The element to place in the window body; the canvas fills it. */
  readonly element: HTMLDivElement

  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private lighting: SceneLighting | null = null
  private built: SceneBuildResult | null = null
  private dynamic: DynamicNodes | null = null
  /** Materials cloned out of the shared cache — see setNodes(). */
  private privateMaterials: THREE.Material[] = []
  private rateNodes: GvNode[] = []
  /** Whether the host window is currently visible: a closed one draws nothing. */
  private live = false
  /** False until something has been framed — the first design always is. */
  private framed = false

  constructor(className = 'glyph-preview') {
    this.element = Object.assign(document.createElement('div'), { className })
  }

  /**
   * Show or stop drawing. A hidden canvas has a zero client size, so a resize
   * while closed would leave the camera with a broken aspect ratio — reopening
   * re-measures.
   */
  setLive(value: boolean): void {
    this.live = value
    if (!value) return
    this.ensureRenderer()
    this.resize()
  }

  private ensureRenderer(): void {
    if (this.renderer) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    applyDesktopColorPipeline(renderer)
    renderer.setPixelRatio(window.devicePixelRatio)
    this.element.appendChild(renderer.domElement)
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.001, 1000)
    this.camera.up.set(0, 0, 1)
    this.lighting = new SceneLighting(this.scene)

    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.enableDamping = false

    // The window is resizable, and its body reflows as text above wraps.
    new ResizeObserver(() => this.resize()).observe(this.element)
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return
    const width = Math.max(1, this.element.clientWidth)
    const height = Math.max(1, this.element.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /**
   * Draw `nodes`, replacing whatever was previewed before.
   *
   * `keepCamera` holds the current orbit position instead of reframing, which
   * is what the Composer wants: it re-previews on every parameter nudge, and a
   * camera that jumped back to its default each time would make a scale slider
   * impossible to judge. The Generator reframes, since each Regenerate is a
   * different design of a different size.
   */
  setNodes(nodes: GvNode[], keepCamera = false): void {
    this.ensureRenderer()
    const scene = this.scene!
    this.disposeScene()

    // No textures and no meshes: neither dialog's designs reference either (the
    // generator excludes Mesh geometry outright, having no model to point at,
    // and the Composer's geometry list excludes it for the same reason).
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

    this.rateNodes = rateCandidates(nodes, new Set())
    this.dynamic = new DynamicNodes(
      nodes,
      built.frames,
      {
        transform: new Set(this.rateNodes.map((n) => n.id)),
        appearance: new Set(),
        scaled: new Set(),
      },
      new Map(),
    )

    built.root.updateMatrixWorld()
    if (!keepCamera || !this.framed) this.frameCamera(built.root)
  }

  private frameCamera(root: THREE.Object3D): void {
    const camera = this.camera!
    const controls = this.controls!
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
    camera.position
      .copy(center)
      .addScaledVector(new THREE.Vector3(0.7, -1, 0.55).normalize(), distance)
    camera.far = Math.max(1000, distance * 100)
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()
    this.framed = true
  }

  /** Re-frame on the design currently shown (the Composer's "fit" button). */
  refit(): void {
    if (this.built) this.frameCamera(this.built.root)
  }

  /**
   * One preview frame. Called from the host's animation loop rather than a
   * second requestAnimationFrame, so every renderer shares a clock and a closed
   * window costs exactly one boolean test.
   */
  renderFrame(dtMs: number): void {
    if (!this.live || !this.renderer || !this.scene || !this.camera) return
    if (this.rateNodes.length > 0) {
      if (applyRateAnimation(this.rateNodes, dtMs).size > 0) this.dynamic?.update()
    }
    this.controls?.update()
    this.lighting?.update(this.camera)
    this.built?.links.update()
    this.built?.overlays.update()
    this.renderer.render(this.scene, this.camera)
  }

  private disposeScene(): void {
    if (this.built && this.scene) this.scene.remove(this.built.root)
    this.dynamic?.dispose()
    this.dynamic = null
    this.built?.overlays.dispose()
    this.built = null
    for (const material of this.privateMaterials) material.dispose()
    this.privateMaterials = []
    this.rateNodes = []
  }

  /** Release the second GL context — for a host teardown, not for a close. */
  dispose(): void {
    this.disposeScene()
    this.controls?.dispose()
    this.renderer?.dispose()
    this.renderer = null
  }
}

/**
 * Give `root` private copies of every material it draws with, one clone per
 * unique original. Geometry stays shared (those caches are never cleared and
 * are safe across renderers); only materials have a disposal path that can be
 * triggered from outside these windows.
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
