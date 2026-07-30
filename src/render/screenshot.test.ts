import { describe, expect, it } from 'vitest'
import { screenshotFilename } from './screenshot'

// composeScreenshot / downloadCanvasPng need a real canvas and a document; this
// suite runs in plain node, so what is tested here is the naming rule — the part
// that is a port (desktop `_save_scene_png`'s default path) rather than platform
// plumbing. The compositing is verified by driving the app.
describe('screenshot filename', () => {
  it('swaps the extension, keeping the scene name whole', () => {
    // Desktop `Path(self._current_path).with_suffix(".png")` — the _gv_node tail
    // stays, so a folder of shots says which scene each came from.
    expect(screenshotFilename('Topology_Example_gv_node.csv')).toBe('Topology_Example_gv_node.png')
    expect(screenshotFilename('sd_quakes_gv_node.CSV')).toBe('sd_quakes_gv_node.png')
  })

  it('falls back to the desktop default with no scene open', () => {
    expect(screenshotFilename(null)).toBe('scene.png')
    expect(screenshotFilename('')).toBe('scene.png')
    expect(screenshotFilename('   ')).toBe('scene.png')
  })

  it('does not mistake part of a name for an extension', () => {
    // A scene named after its folder has no extension to swap, and a dotted
    // version number is not one either — `with_suffix` would eat the ".2".
    expect(screenshotFilename('Global_Terrorism_Example')).toBe('Global_Terrorism_Example.png')
    expect(screenshotFilename('ybco_v1.2_gv_node.csv')).toBe('ybco_v1.2_gv_node.png')
    expect(screenshotFilename('scene_v1.2')).toBe('scene_v1.2.png')
  })
})
