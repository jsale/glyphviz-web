// The selected node's tag label as a camera-facing billboard, for immersive
// mode — a port of the desktop spike's `text_billboard.py`.
//
// The scene's ordinary labels are painted on a 2D canvas stacked over the
// WebGL one (labelOverlay.ts), which is a DOM element and therefore invisible
// the moment an immersive session starts. The spike met the same wall and
// answered it the same way: draw ONE label, for the selected node, as a
// textured quad in the scene itself. Same single-entry cache too — the texture
// is redrawn only when the text changes, i.e. on a selection change, not per
// frame.

import * as THREE from 'three'

/** Desktop `_FONT_PX` / `_PADDING`. */
const FONT_PX = 64
const PADDING = 10
/** Desktop `_LABEL_HEIGHT_M`: the quad's height in REAL metres, so a label
 *  stays the same physical size whatever the scene is scaled to. */
export const LABEL_HEIGHT_M = 0.6

/** Draw one line of label text, returning its canvas and aspect ratio. */
function drawLabel(canvas: HTMLCanvasElement, text: string): number {
  const ctx = canvas.getContext('2d')!
  const font = `${FONT_PX}px Arial, sans-serif`
  ctx.font = font
  const width = Math.max(1, Math.ceil(ctx.measureText(text).width))
  const height = Math.ceil(FONT_PX * 1.35)
  canvas.width = width + PADDING * 2
  canvas.height = height + PADDING * 2
  // Resizing the canvas resets the context, so the font goes back on after.
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const baseline = PADDING + Math.round(FONT_PX * 1.05)
  // The desktop's dark drop shadow at +2px, then the pale yellow face — the
  // same pair labelOverlay.ts paints, and what keeps a label readable against
  // both bright glyphs and a bright background.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.86)'
  ctx.fillText(text, PADDING + 2, baseline + 2)
  ctx.fillStyle = 'rgba(255, 255, 200, 1)'
  ctx.fillText(text, PADDING, baseline)
  return canvas.width / canvas.height
}

/**
 * One billboard, parked in the scene and moved to whatever node is selected.
 *
 * It hangs off the SCENE rather than the built root, like the selection halos:
 * it is chrome, so it has to outlive every rebuild and stay out of
 * `fitCameraTo`'s bounds and `applyRenderMode`'s material walk.
 */
export class XrLabel {
  readonly sprite: THREE.Sprite
  private readonly canvas = document.createElement('canvas')
  private texture: THREE.CanvasTexture | null = null
  private text: string | null = null
  private aspect = 1

  constructor() {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    })
    this.sprite = new THREE.Sprite(material)
    this.sprite.visible = false
    this.sprite.renderOrder = 10
    this.sprite.raycast = () => {} // chrome is never a pick target
    this.sprite.userData.isSelectionBox = true // …and never takes a blend mode
  }

  /**
   * Show `text` at a world position, sized for a rig of `worldUnitsPerMetre`.
   * An empty or missing text hides the billboard, exactly as an unlabelled
   * node draws nothing on the desktop.
   */
  show(text: string | null, position: THREE.Vector3, worldUnitsPerMetre: number): void {
    if (!text) {
      this.hide()
      return
    }
    if (text !== this.text) {
      this.aspect = drawLabel(this.canvas, text)
      this.texture?.dispose()
      this.texture = new THREE.CanvasTexture(this.canvas)
      // Raw pixels, like every other texture in this app — the colour pipeline
      // writes straight to the framebuffer (lighting.ts).
      this.texture.colorSpace = THREE.NoColorSpace
      const material = this.sprite.material as THREE.SpriteMaterial
      material.map = this.texture
      material.needsUpdate = true
      this.text = text
    }
    // The quad's size is in METRES and its position in WORLD units, which reads
    // like an inconsistency and is not: three's sprite shader takes the size
    // from the model matrix but offsets it in EYE space, and the immersive rig
    // carries the world→metres scale on the camera (xrNav.ts). So the view
    // matrix shrinks the position by that scale and leaves the size alone —
    // the rig scale belongs on the offset below and nowhere else. Multiplying
    // it into the size too drew the label an entire scene wide.
    this.sprite.scale.set(LABEL_HEIGHT_M * this.aspect, LABEL_HEIGHT_M, 1)
    // Clear of the glyph it names, in the direction GlyphViz calls up.
    const offset = LABEL_HEIGHT_M * worldUnitsPerMetre * 0.9
    this.sprite.position.set(position.x, position.y, position.z + offset)
    this.sprite.visible = true
  }

  hide(): void {
    this.sprite.visible = false
  }

  dispose(): void {
    this.texture?.dispose()
    this.texture = null
    this.text = null
    ;(this.sprite.material as THREE.SpriteMaterial).dispose()
  }
}
