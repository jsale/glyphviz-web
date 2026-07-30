// Save the viewport as a PNG — the desktop's File ▸ Save Scene as PNG (F12,
// `MainWindow._save_scene_png` → `Viewport.save_screenshot`).
//
// The desktop's is one `grabFramebuffer()`: the GL widget's own pixels, at
// whatever size it happens to be, with none of the surrounding Qt panels in the
// image (they are separate widgets). Two things have to be reproduced rather
// than inherited here:
//
//   1. WebGL clears its drawing buffer once the browser composites the frame, so
//      pixels can only be read back inside the same task that drew them — hence
//      the capture runs at the tail of the animation loop, not from the click
//      handler. `preserveDrawingBuffer: true` would be the alternative and costs
//      every frame for the sake of a rare one.
//   2. Tag labels are a SECOND canvas stacked over the WebGL one (labelOverlay.ts,
//      standing in for the desktop's QPainter pass over the same GL widget), so
//      the image has to be composited or every label goes missing from it.
//
// The HUD panels, status line and FPS readout are DOM, so they stay out of the
// image for free — the same as the desktop's, and the point of the screengrab
// chrome work they belong to.

/** MIME + extension the capture produces. PNG for a lossless screengrab. */
const PNG_TYPE = 'image/png'

/**
 * Composite the WebGL canvas and the label overlay into one opaque canvas at
 * the WebGL canvas's device-pixel size.
 *
 * Both canvases are sized `css × devicePixelRatio` and, in stereo, hold the two
 * eyes side by side in that one buffer — so this needs no knowledge of either:
 * whatever was drawn is what gets saved. The overlay is drawn scaled to the
 * target rather than 1:1, so a pixel-ratio change that has not yet reached one
 * of the two canvases cannot offset the labels.
 */
export function composeScreenshot(
  gl: HTMLCanvasElement,
  overlay?: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = Math.max(1, gl.width)
  out.height = Math.max(1, gl.height)
  const ctx = out.getContext('2d')!
  // No background fill: the renderer is created without `alpha`, so its drawing
  // buffer is opaque and the scene's own background colour is already in it.
  ctx.drawImage(gl, 0, 0, out.width, out.height)
  if (overlay && overlay.width > 0 && overlay.height > 0) {
    ctx.drawImage(overlay, 0, 0, out.width, out.height)
  }
  return out
}

/**
 * The PNG's filename, from the scene's own file name.
 *
 * Desktop `_save_scene_png` offers `Path(self._current_path).with_suffix(".png")`
 * — the whole name with the extension swapped, so `Topology_Example_gv_node.csv`
 * becomes `Topology_Example_gv_node.png`, keeping the scene's identity in the
 * image's name — and falls back to `scene.png` when nothing is open. A browser
 * has no Save dialog for a download, so this IS the name, which makes matching
 * that rule exactly the whole of the port.
 */
export function screenshotFilename(sceneFilename: string | null | undefined): string {
  const name = (sceneFilename ?? '').trim()
  if (!name) return 'scene.png'
  // Only a real extension is replaced. `Global_Terrorism_Example` (a
  // folder-named scene) has none, and a trailing version number is not one:
  // `with_suffix` would turn `scene_v1.2` into `scene_v1.png`, which is
  // tolerable in a save DIALOG the user can correct and not here, where this is
  // the final name. Hence "starts with a letter" — the only divergence in the
  // rule.
  const dot = name.lastIndexOf('.')
  const looksLikeExtension = dot > 0 && /^\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(name.slice(dot))
  return `${looksLikeExtension ? name.slice(0, dot) : name}.png`
}

/** Hand a composited canvas to the browser as a download. */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('the canvas could not be encoded as a PNG'))
        return
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
      resolve()
    }, PNG_TYPE)
  })
}
