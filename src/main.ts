import './style.css'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { cycleGeometry, cycleTargets, cycleTopology } from './gv/attrCycle'
import { cycleColorIndex, cyclePalette, PALETTE_NAMES } from './gv/colorPalette'
import { copySubtree, pasteSubtree } from './gv/clipboard'
import type { Clipboard } from './gv/clipboard'
import {
  blankNode,
  createChildNode,
  createRootNode,
  createWorldGrid,
  nextNodeId,
  NEW_OBJECT_DEFAULTS,
} from './gv/createNode'
import type { NewObjectDefaults } from './gv/createNode'
import { placeStamp, shouldStamp } from './gv/drawMode'
import { generateNodes, recipeFromJson } from './gv/glyphRecipe'
import type { GlyphRecipe } from './gv/glyphRecipe'
import { buildHyperglyphNodes } from './gv/hyperglyph'
import { applyDragDelta, snapshotTransform } from './gv/multiEdit'
import type { DragMode, DragSnapshot } from './gv/multiEdit'
import { findScenes, normalizePath, resolveRelative } from './gv/bundle'
import type { SceneCandidate } from './gv/bundle'
import {
  applyChannelFrame,
  bindChannels,
  deriveChannelFilenames,
  emptyChannelAnimation,
  parseGvChMap,
  parseGvChTracks,
  resetChannels,
} from './gv/channels'
import type { ChannelAnimation } from './gv/channels'
import { applyRateAnimation, rateCandidates } from './gv/rates'
import { buildMediaIndex } from './gv/media'
import type { MediaIndex } from './gv/media'
import {
  isDesktopOnlyMeshFileName,
  isMeshFileName,
  MESH_EXTENSIONS,
  parseMeshFile,
} from './gv/meshFile'
import type { MeshData } from './gv/meshFile'
import { parseGvNodeCsv } from './gv/nodeCsv'
import { applyTags, deriveTagFilename, parseGvTagCsv } from './gv/tagCsv'
import { hasAnyLabel, writeGvTagCsv } from './gv/writeTagCsv'
import { expandZips, filesFromDataTransfer, filesFromInput } from './io/browserFiles'
import type { PathedFile } from './io/browserFiles'
import { ChannelAudio, parseAudioManifest } from './io/channelAudio'
import {
  invertSelection,
  isolateSelection,
  selectAllIds,
  selectByCriterion,
  selectByTagText,
  setHidden,
  showAll,
} from './gv/selectionOps'
import type { SelectCriterion } from './gv/selectionOps'
import { deleteSubtree, navFirstChild, navParent, navSibling } from './gv/treeOps'
import type { GvNode, GvParseIssue, Rgb, Vec3 } from './gv/types'
import {
  DEFAULT_TOPO_SCALE,
  GEOMETRY_NAMES,
  Geometry,
  NODE_TYPE_NAMES,
  NodeType,
  TagColorMode,
  TOPO_NAMES,
  TOPO_SCALE_ANTZ,
  Topo,
} from './gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridIsGlobe } from './gv/worldGrid'
import { gridHit } from './render/drawPlane'
import {
  backgroundRgb,
  ensureWorldNode,
  refGridRgb,
  tagTextStyle,
  toggledBwBackground,
  worldNodeOf,
} from './gv/worldNode'
import { writeGvNodeCsv } from './gv/writeNodeCsv'
import { Backdrop } from './render/backdrop'
import {
  baseScale,
  DEFAULT_SCALE_FLOOR,
  formatBaseScale,
  setBaseScale,
  setEnforceScaleFloor,
} from './render/baseScale'
import {
  applyFrameTransform,
  buildScene,
  frameBaseRotation,
  rescaleSceneFrames,
} from './render/buildScene'
import type { SceneBuildResult } from './render/buildScene'
import { buildTopologyOverlay } from './render/topologyOverlay'
import {
  DRAW_LIMIT_DOUBLE,
  DRAW_LIMIT_HALVE,
  drawLimitTotal,
  nextDrawLimit,
} from './render/drawLimit'
import { DynamicNodes } from './render/dynamicNodes'
import { clearMaterialCache } from './render/glyphGeometry'
import { LabelOverlay, pinnedTagNodes } from './render/labelOverlay'
import { meshChoices, MeshLibrary } from './render/meshLibrary'
import type { MeshAsset } from './render/meshLibrary'
import { applyDesktopColorPipeline, SceneLighting } from './render/lighting'
import {
  applyAudioMode,
  disposeTextures,
  emptyTextureLibrary,
  loadTextures,
  mergeTextureLibrary,
  referencedTextureIds,
} from './render/textureLibrary'
import type { AudioMode, TextureLibrary } from './render/textureLibrary'
import { MAX_HALOS, pickNodeId, Selection } from './render/picking'
import { TOPO_SCALE_HINT_RATIO, worstChildPlacementRatio } from './render/scatterHint'
import { composeScreenshot, downloadCanvasPng, screenshotFilename } from './render/screenshot'
import { nodeIdsInRect } from './render/rectSelect'
import {
  applyRenderMode,
  RENDER_MODE_COUNT,
  RENDER_MODE_NAMES,
  RenderMode,
} from './render/renderMode'
import { applySceneFog, installLinearFog } from './render/fog'
import { invertLocalRotation } from './render/rotationInverse'
import { eyeForX, StereoRig } from './render/stereo'
import type { StereoEye } from './render/stereo'
import { XrRig } from './render/xrSession'
import { XrLabel } from './render/xrLabel'
import { XrPanel } from './render/xrPanel'
import { CameraRig, rigFromView } from './render/cameraMode'
import type { OrbitRig } from './render/cameraMode'
import {
  CameraSmoothing,
  SCOPE_ALL,
  SCOPE_COMBO,
  TAU_ANTZ,
  TAU_MAX,
  TAU_OFF,
} from './render/cameraSmoothing'
import type { SmoothingScope } from './render/cameraSmoothing'
import { SmoothOrbitControls } from './render/smoothOrbitControls'
import { parentTopoScale } from './render/topology'
import { invertTopoOffset, pickDominantField } from './render/topologyInverse'
import { BasemapWindow } from './ui/basemapWindow'
import type { BasemapApplyPayload } from './ui/basemapWindow'
import { ChannelsPanel, DEFAULT_CHANNEL_FPS } from './ui/channelsPanel'
import { FpsMeter } from './ui/fpsMeter'
import { GlyphComposerWindow } from './ui/glyphComposerWindow'
import { HyperglyphWindow } from './ui/hyperglyphWindow'
import { Inspector } from './ui/inspector'
import { NodeTable } from './ui/nodeTable'
import { PANEL_MODE_EVENT, Panel } from './ui/panel'
import type { PanelModeChangeDetail } from './ui/panel'
import { SelectionPanel } from './ui/selectionPanel'
import cartesianCsv from './examples/cartesian_example_gv_node.csv?raw'
import linkCsv from './examples/link_example_gv_node.csv?raw'
import plotSurfaceCsv from './examples/plot_surface_example_gv_node.csv?raw'
import sineWaveCsv from './examples/sine_wave_example_gv_node.csv?raw'
import sineWaveTagCsv from './examples/sine_wave_example_gv_tag.csv?raw'
import sineWaveChMapCsv from './examples/sine_wave_example_gv_ch-map.csv?raw'
import sineWaveChTracksCsv from './examples/sine_wave_example_gv_ch-tracks.csv?raw'
import topologyCsv from './gv/fixtures/topology_example_gv_node.csv?raw'
import topologyTagCsv from './gv/fixtures/topology_example_gv_tag.csv?raw'
import worldGridCsv from './gv/fixtures/world_grid_example_gv_node.csv?raw'
import channelParamsCsv from './gv/fixtures/channels/channel_parameters/channel_parameters_gv_node.csv?raw'
import channelParamsChMapCsv from './gv/fixtures/channels/channel_parameters/channel_parameters_gv_ch-map.csv?raw'
import channelParamsChTracksCsv from './gv/fixtures/channels/channel_parameters/channel_parameters_gv_ch-tracks.csv?raw'
import moodBackgroundCsv from './gv/fixtures/channels/mood_background/mood_background_gv_node.csv?raw'
import moodBackgroundChMapCsv from './gv/fixtures/channels/mood_background/mood_background_gv_ch-map.csv?raw'
import moodBackgroundChTracksCsv from './gv/fixtures/channels/mood_background/mood_background_gv_ch-tracks.csv?raw'

// Parse a gv_node.csv, render it with the full topology placement math and
// World Grid geographic placement (verified against the desktop engine by
// src/render/parity.test.ts), orbit camera, select with an editable inspector,
// gizmo dragging (move/rotate/scale), save back to CSV. Grids are selected
// with the G key, never by click.
//
// Selection is a set: click replaces, Ctrl+click toggles, Shift+drag sweeps a
// region (Ctrl+Shift+drag adds it), and the Selection panel matches on branch
// level / geometry / topology, inverts, and drives the per-node hide flag.
// Edits and gizmo drags apply across the whole set — see src/gv/multiEdit.ts.
//
// Channels animation plays a scene's companion gv_ch-map.csv / gv_ch-tracks.csv
// time series over its nodes (Space plays, Shift+Space stops), and the ANTz
// *_rate fields integrate continuously whether or not a channel drives them.
//
// Plot (16) polylines and Surface (17) quad meshes draw over their children
// (src/render/topologyOverlay.ts), refreshed each frame like the Link edges.
//
// The Node Table panel (Alt+N) is the flat, sortable view of every row —
// including the World/Camera/grid rows the bulk commands skip — and its
// display order is what decides the primary node, exactly as on the desktop.

interface BuiltInScene {
  csv: string
  tag?: string
  /** Channels companions, for the scenes that have them. */
  chMap?: string
  chTracks?: string
  filename: string
}

const BUILT_IN_SCENES: Record<string, BuiltInScene> = {
  'Topology example (all 18 topologies)': {
    csv: topologyCsv,
    // Its companion label file, vendored alongside the node CSV — the same
    // pairing 29 of the desktop repo's 36 example scenes use.
    tag: topologyTagCsv,
    filename: 'topology_example_gv_node.csv',
  },
  'Cartesian example': { csv: cartesianCsv, filename: 'cartesian_example_gv_node.csv' },
  'World Grid example (flat, region, globe)': {
    csv: worldGridCsv,
    filename: 'world_grid_example_gv_node.csv',
  },
  'Link example (lines + prisms)': { csv: linkCsv, filename: 'link_example_gv_node.csv' },
  'Plot & Surface example': {
    csv: plotSurfaceCsv,
    filename: 'plot_surface_example_gv_node.csv',
  },
  'Sine wave example (Channels animation)': {
    csv: sineWaveCsv,
    tag: sineWaveTagCsv,
    chMap: sineWaveChMapCsv,
    chTracks: sineWaveChTracksCsv,
    filename: 'sine_wave_example_gv_node.csv',
  },
  // The desktop's two examples for the expanded Channels attribute set —
  // vendored as parity fixtures, and worth surfacing here because each is a
  // teaching scene: one station per newly bindable attribute, and a World row
  // driving background/fog/blend for the whole scene at once.
  'Channel parameters example (shape/palette/visibility tracks)': {
    csv: channelParamsCsv,
    chMap: channelParamsChMapCsv,
    chTracks: channelParamsChTracksCsv,
    filename: 'channel_parameters_gv_node.csv',
  },
  'Mood background example (animated background, fog, blend)': {
    csv: moodBackgroundCsv,
    chMap: moodBackgroundChMapCsv,
    chTracks: moodBackgroundChTracksCsv,
    filename: 'mood_background_gv_node.csv',
  },
}

// GlyphViz worlds are Z-up (ANTz convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

const app = document.querySelector<HTMLDivElement>('#app')!

// Logarithmic depth lets the near plane sit at ~0 (so the camera can enter
// glyphs — z-topologies place children inside the parent) without z-fighting
// at the far end of large scenes.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
applyDesktopColorPipeline(renderer)
// GL_LINEAR fog, not three's smoothstep — patched before any shader compiles
// (render/fog.ts). The World row's fog fields then drive scene.fog below.
installLinearFog()
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

// Tag labels paint on a 2D canvas above the WebGL one, the way the desktop
// paints them with QPainter over the GL scene.
const labels = new LabelOverlay()
labels.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio)
app.appendChild(labels.canvas)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 1000)
camera.up.set(0, 0, 1)

// The desktop's own light rig and colour handling, coefficient for
// coefficient — see lighting.ts. The key light is camera-relative, so it is
// re-aimed once per frame in the animation loop.
const lighting = new SceneLighting(scene)

// Optional ANTz-style camera smoothing (render/cameraSmoothing.ts). Off by
// default, in which case the controls below are plain OrbitControls: the goal
// state and every branch that reads it stand down on one comparison.
const camSmoothing = new CameraSmoothing()

const controls = new SmoothOrbitControls(camera, renderer.domElement, camSmoothing, () =>
  // Camera Mode drives the camera itself and is never smoothed; flyRig is
  // declared further down, so this is read lazily rather than captured.
  flyRig.flyMode,
)
// No OrbitControls damping: three's own is a per-frame constant, which drifts
// with frame rate and cannot be switched off per gesture. The camera-smoothing
// filter above is the app's glide — exponentially exact, scoped, and shared
// with the manual Left+Right combo drag, which OrbitControls never sees.
controls.enableDamping = false

// Desktop-style procedural backdrop: the "infinite" reference grid (hidden
// once the scene contains a real World Grid) and the RGB origin axes.
const backdrop = new Backdrop()
scene.add(backdrop.group)

// --- Immersive mode (WebXR) --------------------------------------------------

// The one label an immersive session can see: the ordinary tag overlay paints
// on a 2D canvas stacked over the WebGL one, which is DOM and therefore not in
// the headset. Hangs off the SCENE, like the selection halos, so it outlives
// every rebuild.
const xrLabel = new XrLabel()
scene.add(xrLabel.sprite)

// The rig takes the camera while a session presents; the scene graph is never
// re-based (render/xrNav.ts says why). Its callbacks run only inside a live
// session, so the later-declared state they read is always initialised by then.
const xrRig = new XrRig(renderer, camera, scene, {
  onPick(raycaster) {
    if (!currentRoot) return
    const nodeId = pickNodeId(raycaster, currentRoot)
    // A ray that hits nothing clears the selection, exactly as a click on
    // empty space does with the mouse.
    setSelection(nodeId)
    status(nodeId === null ? 'Nothing under the ray.' : `Selected node ${nodeId}.`)
  },
  fitTarget() {
    if (!currentRoot) return null
    const box = new THREE.Box3().setFromObject(currentRoot)
    if (box.isEmpty()) return null
    const size = box.getSize(new THREE.Vector3())
    return {
      center: box.getCenter(new THREE.Vector3()),
      extent: Math.max(size.x, size.y, size.z),
    }
  },
  onSecondary() {
    setPlaying(!playing)
  },
  onTogglePanel() {
    xrPanel.visible = !xrPanel.visible
    status(xrPanel.visible ? 'Wrist panel shown.' : 'Wrist panel hidden — press X to bring it back.')
  },
  onStart() {
    // Cross-eye stereo is a second pair of eyes drawn into one flat canvas;
    // in a headset the compositor owns that job.
    setStereo(false)
    controls.enabled = false
    updateGizmoAttachment()
    labels.clear()
    applyLineResolution()
    xrButton.textContent = 'Exit VR'
    status(
      'Immersive mode — left stick: fly, right stick: turn/rise, squeeze: grab ' +
        '(both hands to resize), trigger: select, A/X: re-fit, B/Y: play Channels.',
    )
  },
  onEnd() {
    controls.enabled = !flyRig.flyMode
    // The session restored the desktop camera pose wholesale — a jump, so the
    // smoothing goal takes it rather than dragging the view back to wherever
    // the pre-session goal was.
    snapCameraGoal()
    updateGizmoAttachment()
    xrLabel.hide()
    applyLineResolution()
    xrButton.textContent = 'Enter VR'
    status('Left immersive mode.')
  },
})
renderer.xr.addEventListener('sessionstart', () => xrRig.handleSessionStart())
renderer.xr.addEventListener('sessionend', () => xrRig.handleSessionEnd())

// The wrist panel — the session's stand-in for the DOM HUD, which a headset
// never sees. It rides the left grip (the rig re-parents its anchor once
// handedness resolves) and is driven by the other hand's ray.
const xrPanel = new XrPanel({
  // The same three commands the Channels panel's own buttons run, so the two
  // transports cannot drift apart.
  togglePlay() {
    channelCommands.togglePlay()
  },
  stop() {
    channelCommands.stop()
  },
  seek(fraction) {
    if (channels.frameCount === 0) return
    channelCommands.seek(Math.round(fraction * (channels.frameCount - 1)))
  },
  stepDrawLimit(factor) {
    adjustDrawLimit(factor)
  },
  stepExample(delta) {
    stepBuiltInScene(delta)
  },
  fit(targetMetres) {
    xrRig.requestFit(targetMetres)
  },
})
xrRig.panelAnchor.add(xrPanel.group)
xrRig.setPointerTarget(xrPanel)

// --- HUD -------------------------------------------------------------------

// Panels live in a left column (Scene, Selection) and a right one
// (Properties). Each collapses to its header bar — never disappears — by
// click or keyboard, so the viewport can be cleared without losing the way
// back. Ctrl+N, which would have suited a future Node Table, is reserved by
// the browser and cannot be intercepted; Alt+N is free when that panel lands.
const panelsLeft = document.createElement('div')
panelsLeft.id = 'panels-left'
app.appendChild(panelsLeft)

const scenePanel = new Panel({ id: 'hud', title: 'GlyphViz Web', hotkey: 'Ctrl+B' })
panelsLeft.appendChild(scenePanel.element)

const hud = scenePanel.body
hud.innerHTML = `
  <select id="hud-examples"></select>
  <div id="hud-scene"></div>
  <div id="hud-warnings"></div>
  <div id="hud-open">
    <label title="Pick a gv_node.csv, a scene .zip, or a node CSV together with its companion gv_tag.csv and media files.">Open Files<input type="file" accept=".csv,text/csv,.zip,application/zip" multiple></label>
    <label title="Pick a whole scene folder: the node CSV, its companion tag file and media/ folder are found inside.">Open Folder<input type="file" id="hud-open-folder" webkitdirectory></label>
  </div>
  <select id="hud-scenes" title="Scenes found in the opened folder" hidden></select>
  <div id="hud-save-row">
    <button id="hud-save">Save gv_node.csv</button>
    <button id="hud-save-tags" hidden title="Write the companion label file alongside the node CSV.">Save gv_tag.csv</button>
  </div>
  <div id="hud-modes">
    <button data-mode="translate">Move (W)</button>
    <button data-mode="rotate">Rotate (E)</button>
    <button data-mode="scale">Scale (R)</button>
  </div>
  <div id="hud-create">
    <div class="hud-create-buttons">
      <button id="hud-new-node" title="New object at the world origin, stepping +10 in X per press. If a child-level node is selected, adds a child instead.">New Node (N)</button>
      <button id="hud-new-child" title="New child under the selected node; repeated presses spread children along X." disabled>New Child (Shift+N)</button>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-new-grid" title="New World Grid at the world origin: the whole-earth window (lon −180…180, lat −90…90) at 1:1 world units.&#10;G selects and cycles grids; New Child, paste and Draw Mode add glyphs onto it.">New World Grid</button>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-copy" title="Copy the selected node and its whole descendant subtree.&#10;Exactly one node — a partial subtree is never copied." disabled>Copy (Ctrl+C)</button>
      <button id="hud-paste" title="Paste the copied subtree with fresh ids: as a child of the selected node, or as a new root object with nothing selected." disabled>Paste (Ctrl+V)</button>
    </div>
    <div class="hud-create-buttons">
      <label id="hud-import-mesh" class="hud-file-button" title="Import a 3D model (.obj / .stl) as a Mesh glyph.&#10;With one node selected the model is assigned to it; with nothing selected it becomes a new object.&#10;Models can also just be dropped on the window.">Import Mesh…<input type="file" accept=".obj,.stl" multiple></label>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-hyperglyph" title="Procedurally generate a randomized multi-level hyperglyph from a branch-level count and a node budget, preview it, and drop it into the scene.&#10;The same seed produces the same design in desktop GlyphViz.">Hyperglyph… (Ctrl+H)</button>
      <button id="hud-composer" title="Build a hierarchical glyph by hand, one branch level at a time — count, geometry, topology, placement, transform and colour — with a live preview.&#10;Templates are the same .json desktop GlyphViz reads and writes.">Composer… (Ctrl+G)</button>
    </div>
    <div class="hud-create-row"><span>Geometry</span><select id="hud-new-geo"></select></div>
    <div class="hud-create-row"><span>Topology</span><select id="hud-new-topo"></select></div>
    <div class="hud-create-row"><span>Scale</span><input id="hud-new-scale" type="number" min="0.001" step="0.1" value="1"></div>
    <div class="hud-create-row"><span>Color</span><input id="hud-new-color" type="color" value="#c8c8c8"></div>
    <button id="hud-draw-mode" title="Draw Mode — paint objects onto a World Grid with the mouse  [D]&#10;Left click stamps one brush where the cursor meets the grid's plane; click-drag stamps a trail, one per Stamp Spacing pixels of travel. Draw Z is each stamp's elevation above the plane.&#10;Draws onto the selected grid, else the scene's first; entering the mode in a gridless scene creates one. Flat grids only.&#10;Right-drag still orbits, the wheel still zooms, Shift+drag still region-selects and Ctrl+click still adds to the selection — only plain click-select is suspended. Esc or D exits.">Draw Mode (D)</button>
    <div class="hud-create-row" id="hud-draw-stamp-row" title="What one click stamps: a single object built from the New Object Defaults above, or a whole Glyph Composer hyperglyph.&#10;Load a saved template (.json), or send one over with the Glyph Composer's Use as Draw Brush button. Loaded brushes stay in the list, so strokes can alternate.">
      <span>Stamp</span>
      <select id="hud-draw-stamp"></select>
      <label id="hud-draw-brush-load" class="hud-file-button" title="Load a Glyph Composer template (.json) as the Draw Mode brush.">Load…<input type="file" accept=".json,application/json"></label>
    </div>
    <div class="hud-create-row" title="translate_z given to every drawn object — its elevation above the grid's drawing plane. 0 draws directly on the plane.">
      <span>Draw Z</span>
      <input id="hud-draw-z" type="number" min="-100000" max="100000" step="1" value="0">
    </div>
    <div class="hud-create-row" title="While dragging, stamp a new object every this many pixels of cursor travel. 0 stamps on every pointer move (maximum density).">
      <span>Stamp Spacing</span>
      <input id="hud-draw-spacing" type="number" min="0" max="500" step="1" value="30">
    </div>
    <div class="hud-create-row" title="Heading Jitter: spin each stamp by a random heading in ±this many degrees (added to rotate_z, so a hyperglyph turns as a whole).&#10;Scale Jitter: grow or shrink each stamp by a random factor in ±this percent, one factor for all three axes so proportions are kept.&#10;Both are drawn once per stamp; 0 = off.">
      <span>Jitter °/%</span>
      <input id="hud-draw-heading-jitter" type="number" min="0" max="180" step="1" value="0">
      <input id="hud-draw-scale-jitter" type="number" min="0" max="90" step="1" value="0">
    </div>
    <button id="hud-delete" title="Delete the selected node and all of its descendants — children are never reparented." disabled>Delete (Del)</button>
  </div>
  <div id="hud-world">
    <label id="hud-show-grid" class="sel-check" title="Draw the procedural reference grid under the scene.&#10;A scene with a real World Grid node draws that instead — this is the backdrop only.">
      <input type="checkbox" checked>Show Grid
    </label>
    <label id="hud-show-axes" class="sel-check" title="Draw the red/green/blue X/Y/Z axes at the world origin.">
      <input type="checkbox" checked>Show Axes
    </label>
    <div class="hud-create-row" title="Colour of the reference grid — the World row's ref_grid_color, so it saves with the scene.&#10;A World Grid node (type 6) paints its own lattice from its own node colour instead.">
      <span>Grid Color</span>
      <input id="hud-grid-color" type="color" value="#383847">
    </div>
    <div class="hud-create-row" title="Viewport background — the World row's color. A scene without a World row gets one the first time this changes.">
      <span>Background</span>
      <input id="hud-bg-color" type="color" value="#14141f">
      <button id="hud-bg-bw" title="Flip the background between black and white  [B]">B/W</button>
    </div>
    <div class="hud-create-row" title="Scene-wide blend mode for every glyph, link and overlay — the World row's render_mode.&#10;[8] cycles through the seven modes.">
      <span>Render Mode</span>
      <select id="hud-render-mode"></select>
    </div>
    <label id="hud-fog" class="sel-check" title="Linear fog fading the scene toward the background colour with eye distance — the World row's fog_enabled, so it saves with the scene.&#10;Channels can animate it (bind fog_enabled / fog_start / fog_end on the World row).">
      <input type="checkbox">Enable Fog
    </label>
    <div class="hud-create-row" id="hud-fog-row" title="Fog Start: distance where fog begins.&#10;Fog End: distance where fog is fully opaque.&#10;World units of eye-space depth — retune when the camera sits much nearer or farther.">
      <span>Fog Start/End</span>
      <input id="hud-fog-start" type="number" min="0" max="1000000" step="10" value="20" disabled>
      <input id="hud-fog-end" type="number" min="0" max="1000000" step="10" value="200" disabled>
    </div>
    <label id="hud-follow" class="sel-check" title="Keep the camera centred on the selected node as it moves  [F]&#10;Orbit and zoom stay live while following; panning is overridden.">
      <input type="checkbox">Follow Selected (F)
    </label>
    <div class="hud-create-row" id="hud-camera-row" title="Saved camera views — Main is the free orbit camera; +X/+Y/+Z are fixed reference views onto the world origin (zoom only, no orbit or pan).&#10;[Shift+C] cycles through them.">
      <span>Camera</span>
      <select id="hud-camera"></select>
    </div>
    <div class="hud-create-row" id="hud-cam-smooth-row" title="Camera glide (ANTz-style inertia). 0 = Off: the view tracks the mouse exactly.&#10;Higher = the camera eases toward where you drag, which looks smoother in demos and buffers hand tremor.&#10;Unlike ANTz, aim and position ease together, so what you are orbiting never swings out of frame.&#10;A viewer setting: it never reaches the CSV.">
      <span>Smoothing</span>
      <input id="hud-cam-smooth" type="range" min="0" max="60" step="1" value="0">
      <span id="hud-cam-smooth-value">Off</span>
    </div>
    <div class="hud-create-row" id="hud-cam-smooth-presets">
      <span></span>
      <button id="hud-cam-smooth-off" title="No smoothing — the default.">Off</button>
      <button id="hud-cam-smooth-antz" title="ANTz's own feel (0.33 s), without its swing-out-of-frame artefact.">ANTz</button>
    </div>
    <div class="hud-create-row" id="hud-cam-smooth-scope-row" title="Which gestures glide. Left+Right drag only matches ANTz, where smoothing engaged on that combined orbit+zoom gesture.&#10;All camera navigation also covers single-button orbit, pan and wheel zoom — the setting to use for tremor buffering.&#10;Camera Mode (free flight) is never smoothed: it is already rate-based, so it has no jitter to filter.">
      <span>Applies to</span>
      <select id="hud-cam-smooth-scope"></select>
    </div>
    <label id="hud-fly" class="sel-check" title="Camera Mode — free flight  [C]&#10;Left drag: the press point becomes a bearings origin — hold the cursor above/below it to fly forward/back, left/right of it to turn. The offset sets a continuous speed; return to the origin to stop.&#10;Right drag: look around from where the camera stands.&#10;Both buttons: slide sideways / up / down.  Wheel: fly forward/back.&#10;Clicking still selects, and Shift+drag still region-selects, but Move/Rotate/Size gizmos are suspended until Camera Mode is off.&#10;Not available on the fixed +X/+Y/+Z reference views.">
      <input type="checkbox">Camera Mode (C)
    </label>
    <div class="hud-create-row" id="hud-base-scale-row" title="Global Scale — the size of an unscaled glyph, for the whole scene at once.&#10;Children placed on a parent's surface (Sphere, Cube, Torus…) ride outward with it, and small nodes lift off the 0.2 draw floor.&#10;A viewer setting: it never reaches the CSV.">
      <span>Global Scale</span>
      <input id="hud-base-scale" type="range" min="1" max="100" step="1" value="10">
      <span id="hud-base-scale-value">1.0</span>
    </div>
    <label id="hud-scale-floor" class="sel-check" title="Clamp every glyph's rendered size (its scale × Global Scale) to at least 0.2 per axis, so a very small or zero-scale node stays visible and clickable.&#10;Off by default: glyphs render at exactly their authored scale, because clamping makes the encoding lie about the data (a deliberately thin 0.07 axis would draw as 0.2).&#10;World Grids are never clamped.&#10;A viewer setting: it never reaches the CSV.">
      <input type="checkbox">Enforce Minimum Glyph Size (0.2)
    </label>
    <label id="hud-show-fps" class="sel-check" title="Frame rate, this app's CPU time per frame, and the draw calls and triangles the last frame sent to the GPU.&#10;Shown bottom-right; switch it off for a clean screengrab.">
      <input type="checkbox" checked>Show FPS
    </label>
    <button id="hud-save-png" title="Save the viewport exactly as it looks right now as a PNG, tag labels included  [Alt+P]&#10;The HUD panels are not in the image. Desktop GlyphViz puts this on F12, which a browser reserves.">Save PNG</button>
    <label id="hud-stereo" class="sel-check" title="Side-by-side stereo pair, free-viewed by crossing your eyes — no glasses, no headset.&#10;Camera orbit/pan/zoom and click/double-click selection still work; rubber-band region select is disabled while active.">
      <input type="checkbox">Stereo 3D (Cross-Eye)
    </label>
    <div class="hud-create-row" id="hud-stereo-sep-row" title="Distance between the two eyes, as a percentage of the camera's distance to the pivot — so the depth effect holds as you zoom.&#10;Lower if the pair is hard to fuse, higher for more depth.">
      <span>Eye Separation</span>
      <input id="hud-stereo-sep" type="range" min="5" max="150" step="1" value="30">
      <span id="hud-stereo-sep-value">3.0%</span>
    </div>
    <div class="hud-create-row" id="hud-xr-row" hidden title="Walk into the scene with a VR headset.&#10;Left stick: fly where you are looking. Right stick: turn and rise.&#10;Squeeze a grip to grab the world and drag it; squeeze BOTH to resize and turn it.&#10;Trigger: select the node under the ray. A/X: re-fit the scene in front of you. B/Y: play or pause Channels.&#10;The panels stay on the monitor — in the headset the selected node's label is drawn in the scene.">
      <button id="hud-xr">Enter VR</button>
      <span id="hud-xr-note"></span>
    </div>
  </div>
  <div id="hud-hint">or drop a scene folder, .zip or CSV anywhere</div>
`
const hudScene = hud.querySelector<HTMLDivElement>('#hud-scene')!
const hudWarnings = hud.querySelector<HTMLDivElement>('#hud-warnings')!
const fileInput = hud.querySelector<HTMLInputElement>('#hud-open input[type=file]')!
const folderInput = hud.querySelector<HTMLInputElement>('#hud-open-folder')!
const sceneSelect = hud.querySelector<HTMLSelectElement>('#hud-scenes')!
const exampleSelect = hud.querySelector<HTMLSelectElement>('#hud-examples')!
const saveButton = hud.querySelector<HTMLButtonElement>('#hud-save')!
const saveTagsButton = hud.querySelector<HTMLButtonElement>('#hud-save-tags')!
const newNodeButton = hud.querySelector<HTMLButtonElement>('#hud-new-node')!
const newChildButton = hud.querySelector<HTMLButtonElement>('#hud-new-child')!
const newGridButton = hud.querySelector<HTMLButtonElement>('#hud-new-grid')!
const drawModeButton = hud.querySelector<HTMLButtonElement>('#hud-draw-mode')!
const drawStampSelect = hud.querySelector<HTMLSelectElement>('#hud-draw-stamp')!
const drawBrushInput = hud.querySelector<HTMLInputElement>('#hud-draw-brush-load input')!
const drawZInput = hud.querySelector<HTMLInputElement>('#hud-draw-z')!
const drawSpacingInput = hud.querySelector<HTMLInputElement>('#hud-draw-spacing')!
const drawHeadingJitterInput = hud.querySelector<HTMLInputElement>('#hud-draw-heading-jitter')!
const drawScaleJitterInput = hud.querySelector<HTMLInputElement>('#hud-draw-scale-jitter')!
const newGeoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-geo')!
const newTopoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-topo')!
const newScaleInput = hud.querySelector<HTMLInputElement>('#hud-new-scale')!
const newColorInput = hud.querySelector<HTMLInputElement>('#hud-new-color')!
const importMeshInput = hud.querySelector<HTMLInputElement>('#hud-import-mesh input')!
const hyperglyphButton = hud.querySelector<HTMLButtonElement>('#hud-hyperglyph')!
const composerButton = hud.querySelector<HTMLButtonElement>('#hud-composer')!
const copyButton = hud.querySelector<HTMLButtonElement>('#hud-copy')!
const pasteButton = hud.querySelector<HTMLButtonElement>('#hud-paste')!
const deleteButton = hud.querySelector<HTMLButtonElement>('#hud-delete')!
const bgColorInput = hud.querySelector<HTMLInputElement>('#hud-bg-color')!
const bgBwButton = hud.querySelector<HTMLButtonElement>('#hud-bg-bw')!
const showGridCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-grid input')!
const showAxesCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-axes input')!
const gridColorInput = hud.querySelector<HTMLInputElement>('#hud-grid-color')!
const renderModeSelect = hud.querySelector<HTMLSelectElement>('#hud-render-mode')!
const fogCheckbox = hud.querySelector<HTMLInputElement>('#hud-fog input')!
const fogStartInput = hud.querySelector<HTMLInputElement>('#hud-fog-start')!
const fogEndInput = hud.querySelector<HTMLInputElement>('#hud-fog-end')!
const followCheckbox = hud.querySelector<HTMLInputElement>('#hud-follow input')!
const cameraSelect = hud.querySelector<HTMLSelectElement>('#hud-camera')!
const flyCheckbox = hud.querySelector<HTMLInputElement>('#hud-fly input')!
const camSmoothSlider = hud.querySelector<HTMLInputElement>('#hud-cam-smooth')!
const camSmoothValue = hud.querySelector<HTMLSpanElement>('#hud-cam-smooth-value')!
const camSmoothOffButton = hud.querySelector<HTMLButtonElement>('#hud-cam-smooth-off')!
const camSmoothAntzButton = hud.querySelector<HTMLButtonElement>('#hud-cam-smooth-antz')!
const camSmoothScopeRow = hud.querySelector<HTMLDivElement>('#hud-cam-smooth-scope-row')!
const camSmoothScopeSelect = hud.querySelector<HTMLSelectElement>('#hud-cam-smooth-scope')!
const showFpsCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-fps input')!
const scaleFloorCheckbox = hud.querySelector<HTMLInputElement>('#hud-scale-floor input')!
const baseScaleSlider = hud.querySelector<HTMLInputElement>('#hud-base-scale')!
const baseScaleValue = hud.querySelector<HTMLSpanElement>('#hud-base-scale-value')!
const savePngButton = hud.querySelector<HTMLButtonElement>('#hud-save-png')!
const stereoCheckbox = hud.querySelector<HTMLInputElement>('#hud-stereo input')!
const stereoSepRow = hud.querySelector<HTMLDivElement>('#hud-stereo-sep-row')!
const stereoSepSlider = hud.querySelector<HTMLInputElement>('#hud-stereo-sep')!
const stereoSepValue = hud.querySelector<HTMLSpanElement>('#hud-stereo-sep-value')!
const xrRow = hud.querySelector<HTMLDivElement>('#hud-xr-row')!
const xrButton = hud.querySelector<HTMLButtonElement>('#hud-xr')!
const xrNote = hud.querySelector<HTMLSpanElement>('#hud-xr-note')!

// The row appears only where an immersive session can actually start, which is
// a headset browser (or a desktop one with a runtime/emulator attached) over
// HTTPS — never on a plain http:// page, where navigator.xr does not exist.
void XrRig.isSupported().then((supported) => {
  xrRow.hidden = !supported
})
xrButton.addEventListener('click', () => {
  if (xrRig.presenting) {
    xrRig.exit()
    return
  }
  xrNote.textContent = ''
  xrRig.enter().catch((err: unknown) => {
    xrNote.textContent = 'session refused'
    status(`Could not start VR: ${String(err)}`)
  })
})

// Selected while an opened file/folder scene is showing, so the combo never
// claims a built-in that isn't on screen.
const OPENED_SCENE_OPTION = '— opened scene —'
exampleSelect.appendChild(
  Object.assign(document.createElement('option'), {
    value: OPENED_SCENE_OPTION,
    textContent: OPENED_SCENE_OPTION,
    disabled: true,
    hidden: true,
  }),
)
for (const name of Object.keys(BUILT_IN_SCENES)) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = name
  exampleSelect.appendChild(option)
}
exampleSelect.addEventListener('change', () => {
  loadBuiltIn(exampleSelect.value)
})

function download(text: string, filename: string, type = 'text/csv') {
  downloadBlob(new Blob([text], { type }), filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

saveButton.addEventListener('click', () => {
  if (currentNodes.length === 0) return
  // A tag-file scene keeps its authoring style: labels go to the companion
  // file, not into inline columns that would shadow it on reload.
  download(writeGvNodeCsv(currentNodes, { inlineLabels: !labelsFromTagFile }), currentFilename)
})

saveTagsButton.addEventListener('click', () => {
  const tagFilename = deriveTagFilename(currentFilename)
  if (!tagFilename || !hasAnyLabel(currentNodes)) return
  download(writeGvTagCsv(currentNodes), tagFilename)
})

function showMessages(errors: string[], warnings: string[]) {
  const MAX = 8
  const lines = [
    ...errors.map((m) => `<div class="hud-error">${escapeHtml(m)}</div>`),
    ...warnings.slice(0, MAX).map((m) => `<div class="hud-warning">${escapeHtml(m)}</div>`),
  ]
  if (warnings.length > MAX) {
    lines.push(`<div class="hud-warning">…and ${warnings.length - MAX} more warning(s)</div>`)
  }
  hudWarnings.innerHTML = lines.join('')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function issueText(i: GvParseIssue): string {
  return [i.line !== undefined ? `line ${i.line}` : '', i.column ?? '', i.message]
    .filter(Boolean)
    .join(': ')
}

// --- Selection + inspector ---------------------------------------------------

const selection = new Selection()
// The halos are one batched object for the whole selection, and they are
// chrome rather than scene content — so they hang off the scene, not the built
// root, and outlive every rebuild.
scene.add(selection.object)
let nodesById = new Map<number, GvNode>()

const inspector = new Inspector({
  onNodesEdited(nodes, notes) {
    // The mutated nodes live in currentNodes; rebuild in place, keeping the
    // camera and reattaching the selection + inspector.
    rebuildScene(false)
    // A texture_id edit can name a file the scene never referenced, so nothing
    // decoded it at load. Fetch it now; that lands with a second rebuild.
    void decodeTexturesFor(
      nodes.map((n) => n.textureId),
      sceneEpoch,
    )
    // A topology change can throw a subtree off screen; the hint names the
    // field that brings it back (desktop `_on_insp_topo_changed`'s tail).
    if (notes?.topologyChanged) hintScatteredChildren(nodes)
  },
  onFetchBasemap(grid) {
    basemapWindow.open(grid, currentNodes)
  },
})
app.appendChild(inspector.element)

// --- Fetch Basemap -------------------------------------------------------------
//
// Desktop MainWindow._on_fetch_basemap, replumbed for a browser: the window
// (ui/basemapWindow.ts) downloads tiles and produces the reprojected PNG; this
// side wires the image into the scene — grid extents set to the map's exact
// coverage, texture_id assigned (shifting other nodes' ids when the insertion
// changes the media numbering), wire geometry promoted to solid so the texture
// is actually visible.
const basemapWindow = new BasemapWindow({ onApply: applyBasemap })

function applyBasemap(payload: BasemapApplyPayload) {
  const grid = currentNodes.find(
    (n) => n.id === payload.gridId && n.type === NodeType.WorldGrid,
  )
  if (!grid) {
    status(`World Grid ${payload.gridId} is no longer in the scene — basemap not applied.`)
    return
  }

  // A stable per-grid name: refetching overwrites in place (same texture_id,
  // no renumbering); the zz_ prefix keeps it sorted after the scene's own
  // deliberately-ordered media files.
  const name = `zz_basemap_grid${grid.id}.png`
  const pngFile = new File([payload.png], name, { type: 'image/png' })

  // texture_id is a 1-based index into media/ sorted alphanumerically (images
  // first, then videos) — inserting a NEW image shifts every id at or after
  // its sort position, so shift referencing nodes to match. An overwrite
  // keeps its old position: nothing moves.
  const oldEntries = currentMedia?.index.entries ?? []
  const oldFileByName = new Map(
    oldEntries.map((e) => [e.name, currentMedia!.fileById.get(e.textureId)] as const),
  )
  const existed = oldEntries.some((e) => e.name === name)
  const names = existed ? oldEntries.map((e) => e.name) : [...oldEntries.map((e) => e.name), name]
  const index = buildMediaIndex(names)
  const newId = index.entries.find((e) => e.name === name)!.textureId
  if (!existed) {
    for (const n of currentNodes) {
      if (n.textureId >= newId) n.textureId += 1
    }
  }

  // The grid's extents become the map's EXACT coverage (the dialog's planned
  // bbox, never the typed values), so texture and child placement can't drift
  // apart. Extents live in the trigger_lo/hi extras columns, the same storage
  // the desktop and the CSV writer use.
  const f = (v: number) => String(Number(v.toFixed(6)))
  grid.extras['trigger_lo_x'] = f(payload.bbox.lonMin)
  grid.extras['trigger_hi_x'] = f(payload.bbox.lonMax)
  grid.extras['trigger_lo_y'] = f(payload.bbox.latMin)
  grid.extras['trigger_hi_y'] = f(payload.bbox.latMax)
  grid.textureId = newId
  if (grid.geometry === Geometry.GridWire) grid.geometry = Geometry.GridSolid

  const fileById = new Map<number, File>()
  for (const entry of index.entries) {
    const file = entry.name === name ? pngFile : oldFileByName.get(entry.name)
    if (file) fileById.set(entry.textureId, file)
  }
  currentMedia = { index, fileById }
  inspector.setMedia(index)

  // Ids may have shifted, and a refetch changes bytes behind an id that was
  // already decoded — so the texture cache restarts from nothing, exactly as
  // a scene load does. A basemap fetch is rare; the reset is cheap next to it.
  disposeTextures(currentTextures)
  clearMaterialCache()
  currentTextures = emptyTextureLibrary()
  attemptedTextureIds = new Set()
  rebuildScene(false)
  void decodeSceneTextures(sceneEpoch)

  // The browser can't write into the scene folder, so persistence is a
  // download (the same way Save CSV persists the nodes): the saved CSV
  // references media/<name>, and this hands the user that exact file.
  downloadBlob(payload.png, name)
  status(
    `Basemap applied to World Grid ${grid.id}: ${name} (texture ${newId}), ` +
      `extents lon ${payload.bbox.lonMin.toFixed(3)}..${payload.bbox.lonMax.toFixed(3)}, ` +
      `lat ${payload.bbox.latMin.toFixed(3)}..${payload.bbox.latMax.toFixed(3)}. ` +
      `${payload.attribution} — PNG downloaded; keep it in the scene's media/ folder.`,
  )
}

// Bottom-right, opposite the status line — the desktop's status bar reads the
// same way, message left and the FPS label added as a permanent right-hand
// widget. On by default, like the desktop's.
const fpsMeter = new FpsMeter()
app.appendChild(fpsMeter.element)
showFpsCheckbox.addEventListener('change', () => {
  fpsMeter.visible = showFpsCheckbox.checked
})

// --- Global Scale ------------------------------------------------------------
//
// The desktop's Display-panel slider (`_update_scale` → `Viewport.base_scale`),
// range and label included: 0.1–10.0 in tenths, default 1.0. See
// render/baseScale.ts for what the value does — it is both the draw scale and
// every topology's base radius, so glyphs grow AND the children placed on their
// surfaces move outward with them.
//
// Applied in place rather than through rebuildScene: the graph's shape does not
// change, only its numbers, and a slider dragged at Event_Cloud's 209k nodes
// cannot afford re-creating every Object3D, material binding and pick proxy per
// step. Coalesced to one apply per frame for the same reason — a range input
// fires `input` far faster than a big scene can be rewritten.
let baseScaleFrame = 0

function applyBaseScale(value: number) {
  const applied = setBaseScale(value)
  baseScaleValue.textContent = formatBaseScale(applied)
  refreshDrawScales()
}

/**
 * Push the current Global Scale / minimum-size settings onto the live scene.
 * Split out because the checkbox below does exactly what the slider does — both
 * are terms of the same `max(own scale · base_scale, floor)` product, and
 * neither changes the graph's SHAPE, so both take the in-place path.
 */
function refreshDrawScales() {
  if (!currentRoot || !currentFrames) return
  rescaleSceneFrames(currentNodes, currentFrames)
  // Halos are world-space geometry written from these matrices (they are only
  // refreshed from the loop while something is animating), so both have to be
  // brought forward here.
  currentRoot.updateMatrixWorld(true)
  selection.refreshHalos()
  // The inspector's world-pos line is a snapshot taken when the selection last
  // changed, and this is the one edit that moves a node without touching a
  // single CSV field — so nothing else here would refresh it. Found by driving
  // it: the readout sat at its old position while the glyph moved under it.
  if (selection.size > 0) refreshSelectionUi()
}

baseScaleSlider.addEventListener('input', () => {
  if (baseScaleFrame) return
  baseScaleFrame = requestAnimationFrame(() => {
    baseScaleFrame = 0
    applyBaseScale(Number(baseScaleSlider.value) / 10)
  })
})

// The opt-in minimum rendered size (desktop `Scene.scale_floor` /
// `Viewport.enforce_scale_floor`, its commit 6d82d68). It sits in the Global
// Scale group because it is the other half of that group's expression: the
// clamp lands on scale × Global Scale, so raising the slider lifts a small node
// off it. Off by default on both sides — the clamp silently overrode authored
// data, which is what made the desktop turn it off (a deliberately thin 0.07
// axis drew as 0.2 and the encoding then lied about the data).
//
// A viewer setting like Show Grid, never CSV: no writer knows about it, and it
// survives a scene load.
scaleFloorCheckbox.addEventListener('change', () => {
  setEnforceScaleFloor(scaleFloorCheckbox.checked)
  refreshDrawScales()
  status(
    scaleFloorCheckbox.checked
      ? `Minimum glyph size ${DEFAULT_SCALE_FLOOR} enforced.`
      : 'Minimum glyph size off — glyphs render at their authored scale.',
  )
})

// --- Save PNG ----------------------------------------------------------------
//
// Desktop File ▸ Save Scene as PNG (F12). The request is deferred to the tail of
// the animation loop because a WebGL drawing buffer is only readable inside the
// task that drew it — see render/screenshot.ts.
//
// The key is Alt+P, not the desktop's F12: browsers reserve F12 for developer
// tools and deliver the keydown too late to stop it. Same substitution the
// Node Table's Alt+N makes for a reserved Ctrl+N, and Ctrl+P is already the
// Properties panel.
let pngRequested = false

function requestScreenshot() {
  if (pngRequested) return
  if (xrRig.presenting) {
    // The canvas is showing the session's mirror, not the scene as the page
    // would draw it, and the drawing buffer belongs to the XR framebuffer.
    status('Save PNG is not available in VR — leave immersive mode first.')
    return
  }
  pngRequested = true
  status('Saving PNG…')
}

function captureScreenshot() {
  pngRequested = false
  const filename = screenshotFilename(currentNodes.length > 0 ? currentFilename : null)
  try {
    const canvas = composeScreenshot(renderer.domElement, labels.canvas)
    void downloadCanvasPng(canvas, filename)
      .then(() => status(`Saved the viewport to ${filename}`))
      .catch((err: unknown) => status(`Screenshot error: ${String(err)}`))
  } catch (err) {
    status(`Screenshot error: ${String(err)}`)
  }
}

savePngButton.addEventListener('click', requestScreenshot)

// --- Cross-eye stereo --------------------------------------------------------
//
// The desktop's `Viewport.stereo_mode`: the whole scene is drawn twice, side by
// side in the one canvas, and crossing your eyes fuses the pair into 3D with no
// glasses and no headset. All of the camera maths lives in render/stereo.ts;
// what is left here is the frame loop's split, and the three screen-space
// gestures that have to know which half the pointer is in.
//
// The frame counters are read once per frame afterwards, so they have to
// survive two render calls: three resets them at the top of every `render()`
// unless told otherwise, which would leave the FPS panel reporting one eye.
// Resetting once per frame here makes the readout the whole frame's cost in
// both modes.
renderer.info.autoReset = false

const stereo = new StereoRig()

/** Distance from the camera to the orbit pivot — what the separation scales. */
function orbitDistance(): number {
  return camera.position.distanceTo(controls.target)
}

/** This frame's screen halves, or null when drawing mono. */
function stereoEyesNow(): [StereoEye, StereoEye] | null {
  return stereo.eyes(window.innerWidth, orbitDistance())
}

/**
 * Fat-line widths are pixels measured against the viewport being drawn into, so
 * in stereo they have to be told about the half — otherwise every link and plot
 * line renders at double its intended width. The two halves differ by at most
 * the odd pixel; the left one stands for both.
 */
function applyLineResolution() {
  // In a headset the pixels that matter are one eye's half of the XR
  // framebuffer, not the page's — the same per-viewport rule stereo follows,
  // already in device pixels. (A runtime three drives through a projection
  // layer reports no baseLayer; the page size is then the best guess going.)
  const layer = renderer.xr.isPresenting
    ? renderer.xr.getSession()?.renderState.baseLayer
    : undefined
  if (layer) {
    currentLinks?.setResolution(layer.framebufferWidth / 2, layer.framebufferHeight)
    currentOverlays?.setResolution(layer.framebufferWidth / 2, layer.framebufferHeight)
    return
  }
  const width = stereoEyesNow()?.[0].width ?? window.innerWidth
  const pixelWidth = width * window.devicePixelRatio
  const pixelHeight = window.innerHeight * window.devicePixelRatio
  currentLinks?.setResolution(pixelWidth, pixelHeight)
  currentOverlays?.setResolution(pixelWidth, pixelHeight)
}

function setStereo(on: boolean) {
  if (stereo.enabled === on) return
  stereo.enabled = on
  stereoCheckbox.checked = on
  stereoSepRow.classList.toggle('disabled', !on)
  if (!on) {
    // Hand the viewport back whole, and the gizmo back its ordinary camera.
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
    gizmo.camera = camera
  }
  applyLineResolution()
  status(
    on
      ? `Stereo 3D on — cross your eyes to fuse the pair. Eye separation ${stereo.separationPct.toFixed(1)}%. Region select is off while stereo is on.`
      : 'Stereo 3D off.',
  )
}

stereoCheckbox.addEventListener('change', () => setStereo(stereoCheckbox.checked))

// The desktop's slider, tick for tick: 0.5–15.0% in tenths of a percent, so a
// number set here can be read straight across to the other app.
stereoSepSlider.addEventListener('input', () => {
  stereo.separationPct = Number(stereoSepSlider.value) / 10
  stereoSepValue.textContent = `${stereo.separationPct.toFixed(1)}%`
})
stereoSepRow.classList.add('disabled')

// --- Camera Mode (free flight, C key) + camera views (Shift+C) ---------------
//
// The desktop's d66304a ANTz-style rate flight, whole cloth: all of the rig
// math and the pointer state machine live in render/cameraMode.ts (pure, no
// DOM — the behavior spec runs headless); this block owns the OrbitControls
// handoff. Outside Camera Mode the controls are the source of truth and the
// rig is synced from them on demand; inside it the rig is authoritative,
// OrbitControls stands aside entirely, and the animation loop integrates the
// held-offset flight each tick and pushes the rig into the camera.
const flyRig = new CameraRig()
/** Sticky per-press travel flag: a rate flight routinely returns the cursor
 *  to its press point (that is how you stop), so the release-near-press
 *  displacement test alone would misread a whole flight as a click. */
let flyPressMoved = false

for (const [i, cam] of flyRig.cameras.entries()) {
  const opt = document.createElement('option')
  opt.value = String(i)
  opt.textContent = cam.name
  cameraSelect.append(opt)
}

/** Push the rig's eye/target into the camera OrbitControls is standing
 *  aside from. camera.up is world-Z app-wide, so lookAt never rolls. */
function applyRigToCamera() {
  const [ex, ey, ez] = flyRig.eyePosition()
  camera.position.set(ex, ey, ez)
  controls.target.set(flyRig.target[0], flyRig.target[1], flyRig.target[2])
  camera.lookAt(controls.target)
  // Flight is excluded from smoothing and re-derives the rig from the current
  // eye each tick, so the goal tracks it exactly — a lagging actual would feed
  // back into the next frame's derivation and curve the flight path.
  snapCameraGoal()
}

/** Locked axis views are fixed reference views: zoom only (desktop
 *  _orbit_camera returns outright; the pan path checks the same flag). */
function applyLockedViewLimits() {
  const locked = flyRig.activeCameraLocked()
  controls.enableRotate = !locked
  controls.enablePan = !locked
}

function updateCameraUi() {
  cameraSelect.value = String(flyRig.activeCamera)
  flyCheckbox.checked = flyRig.flyMode
}

/** Toggle free-flight Camera Mode (C, the checkbox, or picking a locked
 *  view). Ports the desktop's set_fly_mode + _on_fly_mode_changed pair. */
function setCameraMode(on: boolean) {
  // Flight is excluded from smoothing and re-derives the rig from the current
  // eye, so land any in-progress glide before it takes over.
  if (on) reconcileCameraGoal()
  if (!flyRig.flyMode) flyRig.syncFromView(camera.position, controls.target)
  if (!flyRig.setFlyMode(on)) {
    updateCameraUi()
    return
  }
  if (on) {
    // Following pins the target to a node every frame, which would undo
    // flight's translation on the spot (desktop set_fly_mode).
    followSelected = false
    followCheckbox.checked = false
    // Camera Mode and Draw Mode both claim the left button outright, so they
    // displace each other (desktop set_fly_mode / set_draw_mode).
    setDrawMode(false)
    manualDrag = null // Camera Mode owns every drag button from here
    // The locked-view rule may have switched to Main and loaded its slot.
    applyRigToCamera()
  }
  controls.enabled = !on && rubberStart === null
  applyLockedViewLimits()
  // Move/Rotate/Size drags are suspended until Camera Mode is off; the armed
  // mode stays sticky (the 6h rule), the handles just go away.
  updateGizmoAttachment()
  updateCameraUi()
  status(
    on
      ? 'Camera Mode ON — Left: fly/turn · Right: look around · Both: slide · Wheel: fly  [C]'
      : 'Camera Mode off.',
  )
}

/** Switch to a saved camera view (Shift+C cycling or the Camera row),
 *  saving the live viewpoint into the outgoing slot first. */
function selectCameraView(index: number) {
  const wasFly = flyRig.flyMode
  if (!wasFly) {
    // The outgoing slot saves where the user aimed, not where a glide has got
    // to (desktop _sync_active_camera → _reconcile_camera_goal).
    reconcileCameraGoal()
    flyRig.syncFromView(camera.position, controls.target)
  }
  flyRig.selectCamera(index)
  applyRigToCamera()
  controls.update()
  if (flyRig.flyMode !== wasFly) {
    // Picking a locked reference view leaves Camera Mode (the rig's rule);
    // redo the app-side interlocks the rig cannot reach.
    controls.enabled = rubberStart === null
    updateGizmoAttachment()
  }
  applyLockedViewLimits()
  updateCameraUi()
  status(`Camera: ${flyRig.cameras[flyRig.activeCamera].name}`)
}

/** Scene load (desktop set_nodes): re-derive the axis views' distance from
 *  how far content actually reaches from the origin — they look AT the
 *  origin, so the scene's span around its own center is the wrong measure —
 *  and drop back to Main. Fly mode survives, as on the desktop. */
function resetCameraViews() {
  let originRadius = 0
  if (currentFrames) {
    const p = new THREE.Vector3()
    for (const frame of currentFrames.values()) {
      p.setFromMatrixPosition(frame.matrixWorld)
      originRadius = Math.max(originRadius, p.length())
    }
  }
  const axisDistance = originRadius > 0 ? Math.max(originRadius * 1.5, 50) : 500
  // Main's saved slot becomes the fresh framing fitCameraTo just applied.
  flyRig.syncFromView(camera.position, controls.target)
  flyRig.resetCameras(axisDistance)
  applyLockedViewLimits()
  updateCameraUi()
}

/** Route a canvas pointer event to Camera Mode; true = the mode owns it
 *  (every drag button outright — that is the point of a mode). A Shift
 *  rubber-band sweep in progress keeps the pointer it grabbed first. */
function routeFlyPointer(e: PointerEvent): boolean {
  if (!flyRig.flyMode || rubberStart !== null) return false
  const chord = e.buttons & 3
  if (chord === 3) comboUsedInPress = true // a strafe is never a selection click
  if (
    chord !== 0 &&
    downAt !== null &&
    Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_SLOP_PX
  ) {
    flyPressMoved = true
  }
  flyRig.flyPointerEvent(e.buttons, e.clientX, e.clientY)
  return true
}

flyCheckbox.addEventListener('change', () => setCameraMode(flyCheckbox.checked))
cameraSelect.addEventListener('change', () => selectCameraView(Number(cameraSelect.value)))

// --- Camera smoothing (optional ANTz-style glide) -----------------------------
//
// The desktop's `_cam_*` is the ACTUAL rendered camera and `_cam_goal_*` is
// where the gesture aimed; here the actual is `camera.position` +
// `controls.target`, so the four helpers below are the whole translation
// layer. render/cameraSmoothing.ts holds the filter and the rules; the
// OrbitControls half lives in render/smoothOrbitControls.ts.

/** The rendered camera as an orbit rig — null while the eye sits exactly on
 *  the pivot, which has no angles to ease. */
function cameraActualRig(): OrbitRig | null {
  return rigFromView(
    [camera.position.x, camera.position.y, camera.position.z],
    [controls.target.x, controls.target.y, controls.target.z],
  )
}

/** Point the goal at wherever the rendered camera now is (desktop
 *  `_snap_camera_goal`): every PROGRAMMATIC move — camera presets, scene
 *  framing, double-click focus, Follow Selected, flight, the exit from an
 *  immersive session — is a jump, not a glide, and would otherwise be dragged
 *  straight back toward the pre-jump goal. */
function snapCameraGoal() {
  const actual = cameraActualRig()
  if (actual) camSmoothing.snap(actual)
}

/** Bring goal and camera together before something outside the navigation path
 *  takes over the rig (desktop `_reconcile_camera_goal`): a direct write wins
 *  if nothing was gliding, otherwise the glide lands on its goal. Saving a
 *  viewpoint into a camera slot must record where the user aimed, not where a
 *  half-finished glide happens to have got to. */
function reconcileCameraGoal() {
  const actual = cameraActualRig()
  if (!actual) return
  camSmoothing.adopt(actual)
  controls.applyRig(camSmoothing.goal)
}

/** End a goal-writing gesture (desktop `_settle_camera`): either leave the
 *  goal for the animation loop to chase, or — when smoothing is off or does
 *  not cover this gesture — put the camera on it right now, which is what
 *  makes tau = 0 behave exactly as the code did before this existed. */
function settleCamera(combo: boolean) {
  if (camSmoothing.covers(combo, flyRig.flyMode)) return
  controls.applyRig(camSmoothing.goal)
}

/** One filter step, called once per animation frame after everything that
 *  could have moved the goal (desktop `_apply_camera_smoothing`). */
function applyCameraSmoothing(dtMs: number) {
  const actual = cameraActualRig()
  if (!actual) return
  const next = camSmoothing.step(actual, dtMs)
  if (next) controls.applyRig(next)
}

/** Push the slider + scope select into the smoothing state and relabel
 *  (desktop `_update_camera_smoothing` + `set_camera_smoothing`). */
function applyCameraSmoothingSettings() {
  const tau = Number(camSmoothSlider.value) / 100
  const changed = tau !== camSmoothing.tau
  camSmoothing.tau = Math.max(0, Math.min(tau, TAU_MAX))
  camSmoothing.scope = camSmoothScopeSelect.value as SmoothingScope
  // The desktop's label appends "(ANTz)" at that setting; a 300px panel row
  // has no width for it, so the suffix lives in the status line the presets
  // print instead.
  camSmoothValue.textContent = tau <= 0 ? 'Off' : `${tau.toFixed(2)} s`
  camSmoothScopeRow.classList.toggle('disabled', tau <= 0)
  // Turning the amount up or down re-bases the goal on the live camera. Off,
  // the goal is left behind by every gesture that takes the untouched
  // OrbitControls path, so switching on again would glide toward a viewpoint
  // from minutes ago; and turning off has to land an in-progress glide rather
  // than stranding the camera mid-flight (the desktop's `_finish_camera_glide`
  // in the same handler).
  if (changed) snapCameraGoal()
}

/** A preset moves the slider and lets its own handler do the work, so there is
 *  exactly one path into the smoothing state (desktop
 *  `_set_camera_smoothing_tau`). setValue is a no-op when the slider is
 *  already there, so the call is unconditional rather than silent. */
function setCameraSmoothingTau(tau: number) {
  camSmoothSlider.value = String(Math.round(tau * 100))
  applyCameraSmoothingSettings()
  status(
    tau <= 0
      ? 'Camera smoothing off — the view tracks the mouse exactly.'
      : `Camera smoothing ${tau.toFixed(2)} s${Math.abs(tau - TAU_ANTZ) < 0.005 ? ' (ANTz)' : ''}.`,
  )
}

// Slider units are hundredths of a second of time constant, the desktop's own
// scale, so a value set here reads straight across to the other app.
camSmoothSlider.max = String(Math.round(TAU_MAX * 100))
camSmoothSlider.value = String(Math.round(TAU_OFF * 100))
for (const [value, label] of [
  [SCOPE_COMBO, 'Left+Right drag only'],
  [SCOPE_ALL, 'All camera navigation'],
] as const) {
  const opt = document.createElement('option')
  opt.value = value
  opt.textContent = label
  camSmoothScopeSelect.append(opt)
}
camSmoothScopeSelect.value = SCOPE_COMBO
camSmoothScopeRow.classList.add('disabled')
camSmoothSlider.addEventListener('input', () => applyCameraSmoothingSettings())
camSmoothScopeSelect.addEventListener('change', () => applyCameraSmoothingSettings())
camSmoothOffButton.addEventListener('click', () => setCameraSmoothingTau(TAU_OFF))
camSmoothAntzButton.addEventListener('click', () => setCameraSmoothingTau(TAU_ANTZ))

// In Camera Mode the wheel flies rather than zooms: shortening the arm would
// creep the eye toward a target that's supposed to ride along in front of it,
// and would quietly slow every later drag (flight speed scales off arm
// length). OrbitControls is disabled while flying, so its zoom never fires.
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (!flyRig.flyMode) return
    e.preventDefault()
    if (e.deltaY !== 0) flyRig.wheelFly(e.deltaY < 0 ? 1 : -1)
  },
  { passive: false },
)

// Read-back hook for the headless drive harness (the drive-the-UI pass reads
// camera state through page.evaluate — nothing in the DOM shows the eye
// position). Never read by the app itself.
;(window as unknown as { __gv?: object }).__gv = {
  camera,
  controls,
  flyRig,
  // Where the gesture aimed, as against where the camera has got to — the
  // whole of camera smoothing is the gap between the two, and neither is in
  // the DOM.
  camSmoothing,
  // Deferred: the gizmo is created later in the module; the harness reads it
  // through this getter after boot.
  get gizmo() {
    return gizmo
  },
  // The live scene rows. Draw Mode's whole output is node data — where a stamp
  // landed, what jitter it took, whose child it is — and none of that is
  // legible from the DOM.
  get nodes() {
    return currentNodes
  },
  get frames() {
    return currentFrames
  },
  // Immersive mode: nothing about the rig — where the viewer is, how big the
  // world is, where the headset thinks the head is — reaches the DOM.
  xrRig,
  xrPanel,
  get xrState() {
    return xrRig.state
  },
  get selectionId() {
    return selection.id
  },
  // The wrist panel's own readouts, which exist nowhere else while a session
  // is running: what is drawn, and where the transport stands.
  get drawState() {
    return { limit: drawLimit, drawn: drawnCount, total: currentNodes.length }
  },
  get channelState() {
    return { playing, frame: channelFrame, frames: channels.frameCount }
  },
}

const statusBar = document.createElement('div')
statusBar.id = 'status-bar'
app.appendChild(statusBar)

let statusTimer = 0
/** Transient message line, standing in for the desktop's status bar. */
function status(message: string) {
  statusBar.textContent = message
  window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => (statusBar.textContent = ''), 4000)
}

// A closed panel leaves nothing on screen to click, so its hotkey is the only
// way back — say so at the moment it goes, while the user is still looking.
document.addEventListener(PANEL_MODE_EVENT, (e) => {
  const { mode, title, hotkey } = (e as CustomEvent<PanelModeChangeDetail>).detail
  if (mode !== 'closed') return
  status(
    hotkey ? `${title} panel closed — ${hotkey} brings it back.` : `${title} panel closed.`,
  )
})

function worldPosOf(nodeId: number): THREE.Vector3 | null {
  // Called per gizmo tick — must stay O(depth): frames map lookup, and
  // getWorldPosition refreshes only the ancestor chain (no full-tree pass).
  const frame = currentFrames?.get(nodeId)
  return frame ? frame.getWorldPosition(new THREE.Vector3()) : null
}

/**
 * The one label an immersive session draws: the selected node's own text,
 * billboarded at its position (desktop `text_billboard.draw_label`).
 *
 * Unconditional, as the spike's is — the scene-wide Show Tag Labels toggle
 * lives on a T key and a checkbox, neither of which a headset can reach, and
 * one label for the node you just picked is feedback rather than clutter.
 */
function updateXrLabel() {
  const id = selection.id
  const node = id !== null ? nodesById.get(id) : undefined
  const pos = id !== null ? worldPosOf(id) : null
  if (!node || !pos) {
    xrLabel.hide()
    return
  }
  xrLabel.show(node.text, pos, xrRig.state.scale)
}

/**
 * This frame's readings for the wrist panel. Cheap to call every frame: the
 * panel compares a signature and repaints its texture only when the picture
 * actually changes (ui/xrPanelModel.ts), so a still panel costs one string.
 */
function updateXrPanel() {
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  xrPanel.update({
    sceneName: currentDisplayName || currentFilename,
    nodeCount: currentNodes.length,
    drawnCount,
    drawLimit,
    selection: node
      ? {
          id: node.id,
          text: node.text,
          type: NODE_TYPE_NAMES[node.type] ?? 'Glyph',
        }
      : null,
    channels:
      channels.frameCount > 0
        ? { frame: channelFrame, frames: channels.frameCount, playing }
        : null,
    exampleName: exampleSelect.value,
  })
}

function parentOf(node: GvNode): GvNode | null {
  return node.parentId !== 0 ? (nodesById.get(node.parentId) ?? null) : null
}

/**
 * Node Table row order for a set of ids. The desktop's inspector reads
 * `_selected_nodes[0]` from the table's row-ordered selection, so ordering
 * here is what makes "primary" mean the same thing in both apps — including
 * the consequence that sorting the table can change which node is primary.
 * With no sort applied the table's order IS the scene's file order.
 */
function orderedIds(ids: ReadonlySet<number>): number[] {
  const out: number[] = []
  for (const node of nodeTable.displayOrder()) {
    if (ids.has(node.id)) out.push(node.id)
  }
  return out
}

function selectedNodes(): GvNode[] {
  const out: GvNode[] = []
  for (const id of selection.ids) {
    const node = nodesById.get(id)
    if (node) out.push(node)
  }
  return out
}

/** Replace the selection with these ids (any order; row order is applied). */
function setSelection(ids: ReadonlySet<number> | number | null) {
  if (!currentFrames) return
  const set =
    ids === null ? new Set<number>() : typeof ids === 'number' ? new Set([ids]) : ids
  selection.set(currentFrames, orderedIds(set))
  refreshSelectionUi()
}

/** Ctrl+click / Ctrl+Shift+drag: add these ids to what is already selected. */
function addToSelection(ids: ReadonlySet<number>) {
  const merged = selection.asSet()
  for (const id of ids) merged.add(id)
  setSelection(merged)
}

function toggleInSelection(nodeId: number) {
  const merged = selection.asSet()
  if (!merged.delete(nodeId)) merged.add(nodeId)
  setSelection(merged)
}

/** Re-point the gizmo, inspector, and selection-sensitive buttons. */
function refreshSelectionUi() {
  const nodes = selectedNodes()
  const primary = nodes[0]
  newChildButton.disabled = !primary
  deleteButton.disabled = !primary
  refreshClipboardUi()
  selectionPanel.update(currentNodes, selection.size)
  nodeTable.setSelection(selection.asSet(), selection.id)
  // "Solo to Selection" mixes by what is selected right now.
  if (audioMode === 'selected') refreshAudio()
  // The armed gizmo mode SURVIVES this, including an emptied selection: it is
  // a mode you are in until you turn it off, and the handles simply come and
  // go with whatever is selected. See setGizmoMode for why this diverges.
  updateGizmoAttachment()
  if (!primary) {
    inspector.clear()
    return
  }
  inspector.show(nodes, nodes.length === 1 ? worldPosOf(primary.id) : null)
  // Pointless to report a halo cap while no halos are being drawn.
  if (selection.haloOverflow > 0 && selection.boxVisible) {
    status(`${selection.size} selected — halos drawn for the first ${MAX_HALOS}.`)
  }
}

/** G key, desktop-style: select the first World Grid, or cycle to the next. */
function cycleGridSelection() {
  const grids = currentNodes.filter((n) => n.type === NodeType.WorldGrid)
  if (grids.length === 0) return
  const at = grids.findIndex((n) => n.id === selection.id)
  setSelection(grids[(at + 1) % grids.length].id)
}

// --- Bulk selection + visibility (desktop's Select By / Visibility groups) ---

let showHidden = false
// ANTz \ decimation: null = every node draws; a number caps the drawn set to
// that many rows in file order. Applied at build time (src/render/drawLimit.ts).
let drawLimit: number | null = null
/** How many nodes the last build actually drew — the wrist panel's readout. */
let drawnCount = 0
// Tag labels are off by default, matching the desktop ("press T to see labels").
let showTags = false
let tagsSelectedOnly = false
// Nodes whose show_text pins their label, and the World row's tag styling —
// both cached per scene build so the per-frame overlay never rescans the scene.
let pinnedTags: GvNode[] = []
let tagStyle = tagTextStyle([])
// Muted by default: browsers block audible autoplay, so the desktop's
// everything-audible default is not reachable until the user asks for it.
let audioMode: AudioMode = 'muted'

function selectAllToggle() {
  // Ctrl+A: select all when nothing (or only part) is selected; clear otherwise.
  const all = selectAllIds(currentNodes)
  setSelection(selection.size < all.size ? all : new Set())
}

function applyVisibility(changed: number[], message: string) {
  if (changed.length > 0) rebuildScene(false)
  status(message)
}

// The panel buttons and the H / Shift+H / I keys run the same commands, so
// the host object is a named value rather than an inline literal.
const selectionCommands = {
  selectAll: () => setSelection(selectAllIds(currentNodes)),
  deselectAll: () => setSelection(null),
  invertSelection: () => setSelection(invertSelection(currentNodes, selection.asSet())),
  selectMatching(criterion: SelectCriterion, value: number, additive: boolean) {
    const ids = selectByCriterion(currentNodes, criterion, value)
    if (additive) addToSelection(ids)
    else setSelection(ids)
    status(`${ids.size} node(s) matched.`)
  },
  selectMatchingTags(keyword: string, additive: boolean) {
    const trimmed = keyword.trim()
    if (trimmed === '') return status('Type a keyword to search the tag labels for.')
    const ids = selectByTagText(currentNodes, trimmed)
    if (additive) addToSelection(ids)
    else setSelection(ids)
    status(
      ids.size > 0
        ? `${ids.size} node(s) tagged with "${trimmed}".`
        : `No nodes tagged with "${trimmed}".`,
    )
  },
  hideSelected() {
    if (selection.size === 0) return status('No selection to hide.')
    // The selection is deliberately kept: hidden-but-selected nodes stay
    // manipulable (matching ANTz), so Show Selected undoes this immediately.
    applyVisibility(
      setHidden(currentNodes, selection.asSet(), true),
      `${selection.size} node(s) hidden.`,
    )
  },
  showSelected() {
    if (selection.size === 0) return status('No selection to show.')
    applyVisibility(
      setHidden(currentNodes, selection.asSet(), false),
      `${selection.size} node(s) shown.`,
    )
  },
  isolateSelected() {
    if (selection.size === 0) return status('No selection to isolate.')
    applyVisibility(
      isolateSelection(currentNodes, selection.asSet()),
      `Showing only the ${selection.size} selected node(s).`,
    )
  },
  showAll() {
    const changed = showAll(currentNodes)
    applyVisibility(changed, `All nodes shown (${changed.length} unhidden).`)
  },
  setShowHidden(value: boolean) {
    showHidden = value
    rebuildScene(false)
  },
  setShowTags(value: boolean) {
    showTags = value
    status(value ? 'Tag labels on.' : 'Tag labels off.')
  },
  setShowSelectionBox(value: boolean) {
    // Render-only, exactly as on the desktop: nothing about the selection
    // changes, so every command stays pointed at the same nodes.
    selection.boxVisible = value
    selectionPanel.setShowSelectionBoxChecked(value)
    status(value ? 'Selection box shown.' : 'Selection box hidden (selection still active).')
  },
  setTagsSelectedOnly(value: boolean) {
    tagsSelectedOnly = value
  },
  setTagColor(rgb: Rgb) {
    writeTagStyle((world) => {
      world.tagColor = { ...rgb }
    })
  },
  setTagColorMatchesNode(match: boolean) {
    writeTagStyle((world) => {
      world.tagColorMode = match ? TagColorMode.Node : TagColorMode.Uniform
    })
    status(match ? 'Tag text follows each node’s colour.' : 'Tag text uses one colour.')
  },
  setAudioMode(mode: AudioMode) {
    audioMode = mode
    refreshAudio()
    status(
      mode === 'muted'
        ? 'Video audio muted.'
        : mode === 'all'
          ? 'All video tracks audible.'
          : 'Video audio follows the selection.',
    )
  },
}

/**
 * Push the current audio mode onto the scene's videos. Called when the mode
 * changes and whenever the selection does, since "Solo to Selection" mixes by
 * which nodes are selected right now.
 */
function refreshAudio() {
  applyAudioMode(currentTextures, audioMode, (textureId) =>
    currentNodes.some((n) => n.textureId === textureId && selection.has(n.id)),
  )
}

const selectionPanel = new SelectionPanel(selectionCommands)
panelsLeft.appendChild(selectionPanel.panel.element)

// --- Node Table ----------------------------------------------------------------
// Docked along the bottom rather than in the left column: 20 columns need the
// width, and the desktop keeps it in its own full-width dock too. Selection is
// two-way — clicking a row drives the 3D selection, and every other way of
// selecting scrolls the table to the primary row.
const nodeTable = new NodeTable({
  selectIds: (ids) => setSelection(new Set(ids)),
  addIds: (ids) => addToSelection(new Set(ids)),
  toggleId: (id) => toggleInSelection(id),
  orderChanged() {
    // A new sort can hand "first selected row" to a different node, which is
    // the gizmo target and the inspector's anchor — re-resolve the selection
    // through the new order.
    setSelection(selection.asSet())
  },
})
app.appendChild(nodeTable.element)

// --- Channels playback ---------------------------------------------------------
// The engine writes absolute attribute values into the node rows each frame
// (src/gv/channels.ts) and DynamicNodes pushes just those rows onto the live
// scene graph — never a rebuild, which at Event_Cloud's 209k nodes could not
// run at 60 Hz. Rate fields integrate alongside, with or without channels.

let channels: ChannelAnimation = emptyChannelAnimation()
/** Nodes the rate integrator has to visit — see rates.ts on why it isn't all. */
let rateNodes: GvNode[] = []
let dynamic: DynamicNodes | null = null
/** The nodes whose show_text a channel drives, resolved once per rebuild. */
let showTextBoundNodes: GvNode[] = []
/** Live pinned-label list while a channel drives show_text; null = use the
 *  load-time scan. The desktop's counterpart re-derives has_pinned_tags for
 *  its dynamic set each frame, because its cached scan is keyed on a revision
 *  playback never bumps. */
let animatedPinnedTags: GvNode[] | null = null
/** World render_mode as last pushed onto the materials, so the animated path
 *  only pays the material walk on frames that actually change the mode. */
let appliedWorldRenderMode: number | null = null
const channelAudio = new ChannelAudio()

let playing = false
let channelFrame = 0
let channelFps = DEFAULT_CHANNEL_FPS
let channelLoop = true
let rateMotion = true
/** Fractional frames carried between ticks, so a 7 fps setting isn't quantised
 *  to the display's refresh rate. */
let frameCarry = 0
let lastTickMs = 0

// Named rather than inline: the Space / Shift+Space keys run the same commands
// as the transport buttons, exactly as with selectionCommands.
const channelCommands = {
  togglePlay() {
    if (channels.frameCount === 0) return
    setPlaying(!playing)
  },
  stop() {
    // Desktop Stop: back to frame 0 AND the CSV values restored. The motion a
    // rate binding integrated deliberately stays where it left off.
    setPlaying(false)
    channelFrame = 0
    frameCarry = 0
    resetChannels(channels)
    channelAudio.stop()
    channelsPanel.setFrame(0)
    pushAnimationFrame()
    // An animated World row is back on its CSV values — mirror them into the
    // panel rows the animation deliberately never writes to mid-play.
    syncBackgroundInput()
    syncFogInputs()
    syncRenderMode()
    // The animation loop repaints the table only while frames are ticking;
    // the restore just happened outside one.
    nodeTable.refreshVisible()
  },
  seek(frame: number) {
    channelFrame = frame
    frameCarry = 0
    applyChannelFrame(channels, frame)
    channelsPanel.setFrame(frame)
    if (channelAudio.loaded && channels.frameCount > 1) {
      channelAudio.seekFraction(frame / (channels.frameCount - 1))
    }
    pushAnimationFrame()
    nodeTable.refreshVisible() // scrubbing while paused ticks no frames
  },
  setFps(value: number) {
    channelFps = value
  },
  setLoop(value: boolean) {
    channelLoop = value
  },
  setMotion(value: boolean) {
    rateMotion = value
  },
}

const channelsPanel = new ChannelsPanel(channelCommands)
panelsLeft.appendChild(channelsPanel.panel.element)

function setPlaying(value: boolean) {
  if (value && channels.frameCount === 0) return
  playing = value
  channelsPanel.setPlaying(value)
  if (!value) {
    channelAudio.pause()
    return
  }
  // Pressing Play IS the user gesture browsers require before audible playback.
  channelAudio.play(channelLoop).catch(() => {
    status('The browser blocked audio playback; the animation is running unsynced.')
  })
}

/**
 * Push mutated node rows onto the live graph, then absorb the consequences the
 * per-node fast path cannot see: World-row scene settings, Plot/Surface
 * membership, swapped glyph objects, and the pinned-label list. Every path
 * that applies channel values (tick, seek, Stop) ends here.
 */
function pushAnimationFrame() {
  const report = dynamic?.update()
  syncAnimatedWorld()
  if (report?.overlayDirty) rebuildAnimatedOverlays()
  if (report?.glyphsRebuilt) {
    // Freshly minted materials know nothing of a non-Normal blend state; the
    // walk is a few hundred writes and runs only on the frames a flip-book
    // value actually steps.
    syncRenderMode()
    // Halos hold the glyph objects they outline — re-resolve a selection that
    // may now be pointing at a removed one.
    if (selection.size > 0) setSelection(selection.asSet())
  }
  refreshAnimatedPinnedTags()
}

/**
 * An animated World row reaches the screen through renderer state, not through
 * any Object3D — background clear colour, fog, and the scene-wide blend mode.
 * The desktop reads all three off the row in paintGL every frame; this applies
 * them when a frame lands. (The desktop documents the World row's color_r/g/b
 * as the way to animate the background, and its fog colour follows it.)
 */
function syncAnimatedWorld() {
  const world = worldNodeOf(currentNodes)
  if (!world || !channels.boundNodeIds.has(world.id)) return
  const r = world.color.r / 255
  const g = world.color.g / 255
  const b = world.color.b / 255
  if (scene.background instanceof THREE.Color) scene.background.setRGB(r, g, b)
  else scene.background = new THREE.Color(r, g, b)
  applySceneFog(scene, world)
  if (world.renderMode !== appliedWorldRenderMode) syncRenderMode()
}

/**
 * Re-bake Plot/Surface membership mid-playback. It is baked per scene build
 * for good reasons (topologyOverlay.ts); a channel animating `topo` into or
 * out of 16/17 — or striking `hide` on an overlay family — is the one case
 * that invalidates it between rebuilds, so just the overlay is rebuilt. The
 * desktop's fix is the same move: its scan is keyed on a revision playback
 * never bumps, so it re-derives membership for the dynamic set each frame.
 */
function rebuildAnimatedOverlays() {
  if (!currentRoot || !currentFrames) return
  currentOverlays?.dispose()
  currentOverlays = buildTopologyOverlay(currentNodes, currentFrames, currentRoot, { showHidden })
  applyLineResolution()
}

/**
 * Keep the label overlay's pinned list current while a channel drives
 * show_text. The load-time scan (`pinnedTags`) is correct for every node a
 * channel cannot touch; the bound few are re-read live — with labels off, a
 * scene that pins three of 209k nodes still costs three checks a frame.
 */
function refreshAnimatedPinnedTags() {
  if (showTextBoundNodes.length === 0) return
  const bound = channels.showTextBoundNodeIds
  animatedPinnedTags = [
    ...pinnedTags.filter((n) => !bound.has(n.id)),
    ...showTextBoundNodes.filter((n) => n.showText !== 0),
  ]
}

/** One display frame of animation. Returns true when something moved. */
function tickAnimation(dtMs: number): boolean {
  let changed = false

  if (playing && channels.frameCount > 0) {
    const audioFraction = channelAudio.loaded ? channelAudio.positionFraction() : null
    if (channelAudio.loaded) {
      // Audio-synced: the frame index follows the file's REAL position, so a
      // slow frame costs smoothness and never sync (desktop parity). A null
      // fraction means the duration isn't known yet — holding is right, since
      // advancing would snap back to frame 0.
      if (audioFraction !== null) {
        channelFrame = Math.min(
          channels.frameCount - 1,
          Math.floor(audioFraction * channels.frameCount),
        )
        if (channelAudio.ended && !channelLoop) setPlaying(false)
        changed = true
      }
    } else {
      frameCarry += (dtMs / 1000) * channelFps
      const steps = Math.floor(frameCarry)
      if (steps > 0) {
        frameCarry -= steps
        channelFrame += steps
        if (channelFrame >= channels.frameCount) {
          if (channelLoop) {
            channelFrame %= channels.frameCount
          } else {
            channelFrame = channels.frameCount - 1
            setPlaying(false)
          }
        }
        changed = true
      }
    }
    if (changed) {
      applyChannelFrame(channels, channelFrame)
      channelsPanel.setFrame(channelFrame)
    }
  }

  // Rates keep integrating whether or not a channel is playing — that is what
  // they are. Suspended mid-gizmo-drag so the integrator and the drag are not
  // both writing the same fields.
  if (rateMotion && rateNodes.length > 0 && !gizmo.dragging) {
    if (applyRateAnimation(rateNodes, dtMs).size > 0) changed = true
  }

  if (changed) pushAnimationFrame()
  return changed
}

function toggleTags() {
  selectionCommands.setShowTags(!showTags)
  selectionPanel.setShowTagsChecked(showTags)
}

/**
 * Open a node's `link`, the desktop's U key / Alt+click.
 *
 * Divergence, unavoidable: the desktop treats a non-URL link as a local file
 * path and hands it to the OS to launch. A browser cannot, so the value is
 * reported instead of being silently ignored.
 */
function openLinkOf(node: GvNode | null) {
  if (!node) return status('Select a single node to open its link.')
  const link = node.link.trim()
  if (link === '') return status(`Node ${node.id} has no link.`)
  const url = /^(https?|ftp):\/\//i.test(link)
    ? link
    : link.startsWith('www.')
      ? `https://${link}`
      : null
  if (!url) return status(`Node ${node.id} link is a local path, which a browser cannot open: ${link}`)
  window.open(url, '_blank', 'noopener')
  status(`Opened ${url}`)
}

function openSelectedLink() {
  // Desktop: exactly one node selected.
  openLinkOf(selection.size === 1 ? selectedNode() : null)
}

// --- Scene loading -----------------------------------------------------------

let currentRoot: THREE.Group | null = null
let currentLinks: SceneBuildResult['links'] | null = null
let currentOverlays: SceneBuildResult['overlays'] | null = null
let currentFrames: SceneBuildResult['frames'] | null = null
let currentNodes: GvNode[] = []
let currentDisplayName = ''
let currentFilename = 'scene_gv_node.csv'
let parseErrorLines: string[] = []
let parseWarningLines: string[] = []
/** True when labels came from a companion gv_tag.csv rather than inline columns. */
let labelsFromTagFile = false
/** Resolved media for the loaded scene — texture_id → file. */
let currentMedia: { index: MediaIndex; fileById: Map<number, File> } | null = null
let labelNote = ''
/** Decoded textures for the loaded scene, keyed by texture_id. */
let currentTextures: TextureLibrary = emptyTextureLibrary()
/** Ids this scene has tried to decode — successes and failures alike. */
let attemptedTextureIds = new Set<number>()
/** Bumped per scene load, so a slow texture decode can't land on a newer scene. */
let sceneEpoch = 0
let textureNote = ''
let channelNote = ''

interface SceneSource {
  nodeText: string
  /** Companion tag file contents, when the scene has one. */
  tagText?: string
  /** Channels companions — both or neither, as the desktop requires. */
  channelMapText?: string
  channelTracksText?: string
  /** Audio the `_gv_audio.txt` manifest points at, for synced playback. */
  audio?: { blob: Blob; name: string }
  displayName: string
  filename: string
  media?: { index: MediaIndex; fileById: Map<number, File> }
}

function loadScene(source: SceneSource) {
  const parsed = parseGvNodeCsv(source.nodeText)
  if (parsed.errors.length > 0 && parsed.nodes.length === 0) {
    showMessages(parsed.errors.map(issueText), [])
    return
  }
  currentNodes = parsed.nodes
  currentDisplayName = source.displayName
  currentFilename = source.filename
  currentMedia = source.media ?? null
  parseErrorLines = parsed.errors.map(issueText)
  // Problems opening the file SET (an unreadable zip member, say) describe
  // every scene in it, so they ride along with each load rather than being
  // cleared by the first one.
  parseWarningLines = [...parsed.warnings.map(issueText), ...openWarningLines]
  labelsFromTagFile = false
  labelNote = ''

  // Precedence is absolute: inline text/link columns mean the companion file
  // is never consulted (tags-and-labels.md).
  const labeledInline = parsed.nodes.filter((n) => n.text !== '' || n.link !== '').length
  if (parsed.hasInlineLabelColumns) {
    if (labeledInline > 0) labelNote = `${labeledInline} inline label(s)`
  } else if (source.tagText !== undefined) {
    const tags = parseGvTagCsv(source.tagText)
    const applied = applyTags(currentNodes, tags.byRecordId)
    labelsFromTagFile = true
    labelNote = `${applied} label(s) from ${deriveTagFilename(source.filename) ?? 'tag file'}`
    parseWarningLines.push(...tags.warnings.map(issueText))
    if (applied === 0 && tags.byRecordId.size > 0) {
      parseWarningLines.push(
        `Tag file has ${tags.byRecordId.size} label(s) but none matched a node id or record_id.`,
      )
    }
  }

  saveTagsButton.hidden = !hasAnyLabel(currentNodes) || deriveTagFilename(currentFilename) === null

  // A new scene shows everything (desktop set_nodes). Carrying a limit across
  // loads would hide most of the file the user just opened with no clue why.
  drawLimit = null

  loadChannels(source)

  // The old scene's textures die with it, and every cached material that
  // referenced one goes too — a material holding a disposed map renders black.
  sceneEpoch++
  disposeTextures(currentTextures)
  clearMaterialCache()
  currentTextures = emptyTextureLibrary()
  attemptedTextureIds = new Set()
  textureNote = ''
  selectionPanel.setVideoCount(0)
  // The texture row offers this scene's media, so it has to know before the
  // first selection lands in the panel.
  inspector.setMedia(currentMedia?.index ?? null)
  // A basemap window left open belongs to the previous scene's grid.
  basemapWindow.close()

  // Draw immediately, untextured; media decodes asynchronously and triggers a
  // second, camera-preserving rebuild when it lands.
  rebuildScene(true)
  void decodeSceneTextures(sceneEpoch)
}

/**
 * Bind this scene's Channels companions (and any synced audio), and work out
 * which nodes the rate integrator has to visit.
 *
 * Called from loadScene, before the first build: the flip-book texture_ids a
 * `texture_id` track can produce are only knowable from the bound tracks, and
 * the media decode below needs them (Texture_Animation_Example's CSV
 * texture_id is 0 — the channel supplies every id it ever draws).
 */
function loadChannels(source: SceneSource) {
  setPlaying(false)
  channelFrame = 0
  frameCarry = 0
  channels = emptyChannelAnimation()
  channelAudio.unload()
  channelNote = ''

  if (source.channelMapText !== undefined && source.channelTracksText !== undefined) {
    const map = parseGvChMap(source.channelMapText)
    const tracks = parseGvChTracks(source.channelTracksText)
    parseWarningLines.push(
      ...[...map.errors, ...map.warnings, ...tracks.errors, ...tracks.warnings].map(issueText),
    )
    if (map.errors.length === 0 && tracks.errors.length === 0) {
      channels = bindChannels(map, tracks, currentNodes)
      parseWarningLines.push(...channels.warnings)
      // The desktop hides its Channels group when the join produced nothing;
      // an empty binding list here is the same "there is nothing to play".
      if (channels.bindings.length === 0) channels = emptyChannelAnimation()
    }
  }

  if (source.audio && channels.frameCount > 0) {
    channelAudio.load(source.audio.blob, source.audio.name)
  }

  rateNodes = rateCandidates(currentNodes, channels.rateBoundNodeIds)
  channelsPanel.setScene({
    frames: channels.frameCount,
    rateNodes: rateNodes.length,
    audioName: channelAudio.name ?? undefined,
  })
  channelsPanel.setPlaying(false)

  const notes: string[] = []
  if (channels.frameCount > 0) {
    notes.push(
      `channels: ${channels.frameCount} frames, ${channels.boundNodeIds.size} node(s)` +
        (channelAudio.name ? `, synced to ${channelAudio.name}` : ''),
    )
  }
  if (rateNodes.length > 0) notes.push(`${rateNodes.length} rate-animated node(s)`)
  channelNote = notes.join(', ')
}

/**
 * Decode the media this scene's nodes reference, then redraw with it.
 *
 * Only referenced ids are fetched — a scene folder can carry tens of megabytes
 * of media that no node points at.
 */
async function decodeSceneTextures(epoch: number) {
  const wanted = referencedTextureIds(currentNodes)
  // A flip-book's frames are named only by its track, never by a CSV cell.
  for (const id of channels.textureIds) wanted.add(id)
  await decodeTexturesFor(wanted, epoch)
}

/**
 * Decode any of `ids` this scene hasn't tried yet, merge them into the live
 * library and redraw.
 *
 * Loading on demand is what lets the inspector's texture row name a file no
 * node referenced when the scene opened: the id is set, the glyph draws
 * untextured for the moment the decode takes, and this rebuild paints it.
 * `attemptedTextureIds` is what keeps a failed or absent id from being
 * re-fetched on every subsequent edit, and `epoch` guards against a slow
 * decode landing after the user has moved on to another scene.
 */
async function decodeTexturesFor(ids: Iterable<number>, epoch: number) {
  const media = currentMedia
  if (!media || media.index.entries.length === 0) return
  const wanted = new Set<number>()
  for (const id of ids) {
    if (id > 0 && !attemptedTextureIds.has(id)) wanted.add(id)
  }
  if (wanted.size === 0) return
  for (const id of wanted) attemptedTextureIds.add(id)

  const library = await loadTextures(media.index, wanted, async (entry) =>
    media.fileById.get(entry.textureId) ?? null,
  )
  if (epoch !== sceneEpoch) {
    disposeTextures(library) // a newer scene loaded while this decoded
    return
  }

  mergeTextureLibrary(currentTextures, library)
  const videoCount = currentTextures.videos.length
  const videoNote = videoCount > 0 ? ` (${videoCount} video)` : ''
  textureNote =
    currentTextures.byId.size > 0
      ? `${currentTextures.byId.size}/${attemptedTextureIds.size} texture(s)${videoNote}`
      : ''
  parseWarningLines.push(...library.warnings)
  selectionPanel.setVideoCount(videoCount)
  refreshAudio()
  clearMaterialCache()
  rebuildScene(false)
}

function loadBuiltIn(name: string) {
  const builtIn = BUILT_IN_SCENES[name]
  exampleSelect.value = name
  openWarningLines = [] // leaving an opened file set behind leaves its problems too
  loadScene({
    nodeText: builtIn.csv,
    tagText: builtIn.tag,
    channelMapText: builtIn.chMap,
    channelTracksText: builtIn.chTracks,
    displayName: name,
    filename: builtIn.filename,
  })
}

/**
 * Walk the built-in scenes, wrapping — the wrist panel's ◀ ▶, since a headset
 * cannot reach the example dropdown. An opened file (which is not in the list)
 * simply starts the walk at the first built-in.
 */
function stepBuiltInScene(delta: number) {
  const names = Object.keys(BUILT_IN_SCENES)
  if (names.length === 0) return
  const current = names.indexOf(exampleSelect.value)
  const next = current < 0 ? 0 : (current + delta + names.length) % names.length
  loadBuiltIn(names[next])
}

function rebuildScene(fitCamera: boolean) {
  const prevSelected = new Set(selection.ids)
  const built = buildScene(currentNodes, {
    showHidden,
    textures: currentTextures.byId,
    meshes: meshLibrary.geometries(),
    drawLimit,
    // A channel striking `hide` needs the glyph alive to blank and restore.
    channelHideBound: channels.hideBoundNodeIds,
  })
  if (currentRoot) {
    gizmo.detach()
    selection.set(built.frames, null)
    scene.remove(currentRoot)
  }
  // The animated slice belongs to one build: it holds that build's Object3Ds
  // and its own material clones.
  dynamic?.dispose()
  currentOverlays?.dispose()
  currentRoot = built.root
  currentLinks = built.links
  currentOverlays = built.overlays
  currentFrames = built.frames
  applyLineResolution()
  scene.add(currentRoot)
  // Selection halos are written in world space, so the setSelection at the end
  // of this function needs matrices that exist — a freshly built frame has
  // never been through a render pass. The renderer's own pass this frame then
  // finds everything already up to date.
  currentRoot.updateMatrixWorld()
  scene.background = built.background
  syncBackgroundInput() // the loaded scene's World row may set its own
  syncTagStyle() // ditto its tag colouring
  syncGridColorInput() // ditto the backdrop grid's colour
  // Materials are per build (and the cache is cleared with the scene), so the
  // blend state has to be written onto the new ones.
  syncRenderMode()
  syncFogInputs() // ditto the World row's fog fields (and scene.fog with them)
  // Pinned labels draw whatever the Labels settings say, so the overlay needs
  // this list even with labels off. An inspector edit to show_text lands here.
  pinnedTags = pinnedTagNodes(currentNodes)
  // The channel-driven slice of that list starts from the fresh rows; the
  // per-frame refresh (refreshAnimatedPinnedTags) takes over from here.
  showTextBoundNodes = currentNodes.filter((n) => channels.showTextBoundNodeIds.has(n.id))
  animatedPinnedTags = null
  nodesById = new Map(currentNodes.map((n) => [n.id, n]))
  // Before any setSelection below: orderedIds resolves the primary through the
  // table's display order, which has to be describing THIS node list.
  nodeTable.setNodes(currentNodes)
  // A real World Grid replaces the procedural reference grid as the plane
  // of reference (its lattice has meaningful spacing; the backdrop's not).
  backdrop.showReferenceGrid = !currentNodes.some((n) => n.type === NodeType.WorldGrid)

  // Rate candidates follow the CSV, so an inspector edit to a rate field (which
  // always ends here) has to be able to add or drop a node from the tick list —
  // and to bring the Rate Motion checkbox with it, since a scene that loaded
  // with no rates would otherwise have no way to stop the motion it just
  // acquired. Narrower than setScene, which would reset the transport.
  rateNodes = rateCandidates(currentNodes, channels.rateBoundNodeIds)
  channelsPanel.setRateNodes(rateNodes.length)
  dynamic = new DynamicNodes(
    currentNodes,
    built.frames,
    {
      // Rate-driven nodes move through the same path as channel-driven ones.
      transform: new Set([...channels.transformBoundNodeIds, ...rateNodes.map((n) => n.id)]),
      appearance: channels.appearanceBoundNodeIds,
      scaled: new Set([
        ...channels.scaleBoundNodeIds,
        ...rateNodes.filter((n) => n.scaleRate.x || n.scaleRate.y || n.scaleRate.z).map((n) => n.id),
      ]),
      shape: channels.shapeBoundNodeIds,
      placement: channels.placementBoundNodeIds,
      hidden: channels.hideBoundNodeIds,
    },
    currentTextures.byId,
    meshLibrary.geometries(),
    { showHidden },
  )

  const mediaCount = currentMedia?.index.entries.length ?? 0
  // Kept for the wrist panel, which has no HUD line to read it off.
  drawnCount = built.drawnCount
  const notes = [
    `${currentNodes.length} node(s)`,
    // Called out rather than left to be inferred from a shrunken "drawn": a
    // limit survives every edit until it is doubled back off, and this line is
    // the only place that says so once the status message has scrolled away.
    drawLimit === null ? `${built.drawnCount} drawn` : `${built.drawnCount} drawn (\\ limit)`,
    ...(currentLinks.count > 0 ? [`${currentLinks.count} link edge(s)`] : []),
    ...(built.overlays.plotCount > 0 ? [`${built.overlays.plotCount} plot line(s)`] : []),
    ...(built.overlays.quadCount > 0
      ? [`${built.overlays.surfaceCount} surface(s), ${built.overlays.quadCount} quad(s)`]
      : []),
    ...(labelNote ? [labelNote] : []),
    ...(mediaCount > 0 ? [`${mediaCount} media file(s)`] : []),
    ...(textureNote ? [textureNote] : []),
    // Imported models belong to the session, not the scene, so this says how
    // many mesh_ids there are to point a node at right now.
    ...(meshLibrary.size > 0 ? [`${meshLibrary.size} mesh(es)`] : []),
    ...(channelNote ? [channelNote] : []),
  ]
  hudScene.textContent = `${currentDisplayName} — ${notes.join(', ')}`
  showMessages(parseErrorLines, [...parseWarningLines, ...meshWarningLines, ...built.warnings])

  if (fitCamera) {
    setSelection(null)
    fitCameraTo(currentRoot)
    // A new scene is a different size and sits somewhere else entirely, so an
    // immersive session re-frames it in front of the viewer too (the desktop
    // spike auto-scales on load for the same reason) — and takes the framing
    // just written as the pose to come back to, since the headset is about to
    // overwrite the camera it was written into.
    xrRig.rememberDesktopCamera()
    xrRig.requestFit()
    resetCameraViews()
  } else {
    // Ids deleted or filtered out of the rebuilt scene simply drop.
    setSelection(prevSelected)
  }
}

function fitCameraTo(root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) {
    controls.target.set(0, 0, 0)
    camera.position.set(4, -6, 4)
    snapCameraGoal()
    return
  }
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  let distance = Math.max(1, (sphere.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.2)
  if (stereo.enabled) {
    // Each eye only gets half the width, so a scene framed for the full canvas
    // spills out the sides of both halves — the desktop's `_fit_distance`
    // halves `w` for the same reason. Pull back until the narrower axis fits.
    const halfV = (camera.fov * Math.PI) / 360
    const halfH = Math.atan(Math.tan(halfV) * (camera.aspect / 2))
    distance = Math.max(distance, (sphere.radius / Math.sin(Math.min(halfV, halfH))) * 1.2)
  }
  const dir = new THREE.Vector3(0.7, -1, 0.55).normalize()
  camera.position.copy(center).addScaledVector(dir, distance)
  camera.near = 0.001
  camera.far = Math.max(1000, distance * 100)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  snapCameraGoal() // auto-framing is a jump, not a glide
  controls.update()
}

// --- File open / drag & drop -------------------------------------------------
//
// A GlyphViz scene is a folder, not a file: the node CSV, its companion
// gv_tag.csv and its media/ folder all matter. Dropping a folder (or picking
// one) collects the lot; bundle.ts resolves which files belong to which scene.
// A dropped parent folder can hold several scenes — those go in a picker.
// A .zip is expanded into the same list first (src/io/zip.ts), so an archive
// behaves exactly like the folder it was made from.

/** Scenes found in the last opened file set, with their files by path. */
let openedScenes: SceneCandidate[] = []
/** Problems reading the models a scene shipped; shown until the next load. */
let meshWarningLines: string[] = []
let openedFiles = new Map<string, File>()
/** Problems with the opened file set itself; re-reported on every scene load. */
let openWarningLines: string[] = []

/**
 * Follow a scene's `_gv_audio.txt` manifest to the audio file it names.
 *
 * The manifest holds one line: a path relative to the node CSV's folder. On the
 * desktop that resolves against the filesystem; here it has to resolve inside
 * the dropped file set, so a manifest pointing outside the folder that was
 * opened simply finds nothing — the animation then plays on the FPS clock.
 */
async function readAudioCompanion(
  scene: SceneCandidate,
): Promise<{ blob: Blob; name: string } | undefined> {
  if (!scene.audioManifestPath) return undefined
  const manifest = openedFiles.get(scene.audioManifestPath)
  if (!manifest) return undefined
  const relative = parseAudioManifest(await manifest.text())
  if (!relative) return undefined
  const path = resolveRelative(scene.dir, relative)
  const file = openedFiles.get(path)
  if (!file) {
    // Reported on the status line rather than the warning list: loadScene
    // clears that list after this runs.
    status(
      `Audio manifest points at "${relative}", which is not in the opened folder; ` +
        'playback will use the FPS clock.',
    )
    return undefined
  }
  return { blob: file, name: file.name }
}

/**
 * Load the models a scene folder ships with, if it ships any.
 *
 * The web-only half of the mesh story: `mesh_id` names a file only through
 * import order on the desktop, so a scene saved there cannot say which model a
 * node meant. A scene folder that carries its own .obj/.stl files gets ids by
 * sorted name (bundle.ts findMeshFiles), which is reproducible — so such a
 * scene reopens looking the same.
 *
 * A scene WITHOUT models leaves the library alone, matching the desktop, where
 * imported meshes live on the viewport and outlive every scene load: import a
 * model, then open a CSV that references mesh_id 1, and it draws.
 */
async function loadSceneMeshes(scene: SceneCandidate) {
  meshWarningLines = []
  if (scene.meshPathById.size === 0) return

  // Parse everything BEFORE touching the library: clear() disposes geometries
  // the scene on screen is still drawing, and each parse is an await, so doing
  // it as we go would leave the live scene holding disposed buffers for as many
  // frames as the reads take.
  const parsed: Array<[number, string, MeshData]> = []
  for (const [meshId, path] of scene.meshPathById) {
    const file = openedFiles.get(path)
    if (!file) continue
    try {
      parsed.push([meshId, path, parseMeshFile(file.name, await file.arrayBuffer())])
    } catch (err: unknown) {
      // The id stays reserved either way, exactly as an undecodable image keeps
      // its texture_id — otherwise one broken file renumbers every model after
      // it and the scene's own mesh_ids stop meaning anything.
      meshWarningLines.push(
        `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  meshLibrary.clear()
  for (const [meshId, path, data] of parsed) meshLibrary.add(path, data, meshId)
  refreshMeshMenus()
}

async function loadSceneCandidate(scene: SceneCandidate) {
  const nodeFile = openedFiles.get(scene.nodePath)
  if (!nodeFile) return
  try {
    await loadSceneMeshes(scene)
    const nodeText = await nodeFile.text()
    const readText = async (path: string | null) => {
      const file = path ? openedFiles.get(path) : undefined
      return file ? await file.text() : undefined
    }
    const tagText = await readText(scene.tagPath)
    // Both or neither: bundle.ts only reports a companion when the folder holds
    // exactly one candidate, which is the desktop's own rule.
    const channelMapText = await readText(scene.channelMapPath)
    const channelTracksText = await readText(scene.channelTracksPath)
    const audio = await readAudioCompanion(scene)
    const fileById = new Map<number, File>()
    for (const [textureId, path] of scene.mediaPathById) {
      const file = openedFiles.get(path)
      if (file) fileById.set(textureId, file)
    }
    exampleSelect.value = OPENED_SCENE_OPTION
    loadScene({
      nodeText,
      tagText,
      channelMapText,
      channelTracksText,
      audio,
      displayName: scene.label,
      filename: scene.nodePath.split('/').pop()!,
      media: { index: scene.media, fileById },
    })
  } catch (err: unknown) {
    showMessages([`Could not read ${scene.nodePath}: ${String(err)}`], [])
  }
}

/**
 * Take a picked or dropped file set and load the first scene in it.
 *
 * Any `.zip` is expanded first, so an archive opens exactly like the folder it
 * was made from — this is the only step that has to touch bytes before a scene
 * is chosen, which is why it is async and posts a status line.
 */
async function openFileSet(dropped: PathedFile[]) {
  let files = dropped
  openWarningLines = []
  if (dropped.some((f) => f.file.name.toLowerCase().endsWith('.zip'))) {
    status('Reading archive…')
    const expanded = await expandZips(dropped)
    files = expanded.files
    openWarningLines = expanded.warnings
  }

  // A drop of nothing but model files is a mesh import, not a failed scene
  // open — dragging a .stl onto the window is the shortest path to the desktop
  // Meshes menu's job, and there is no scene here to replace.
  if (files.length > 0 && files.every((f) => isMeshFileName(f.file.name))) {
    importMeshFilesSafely(files.map((f) => ({ file: f.file, source: normalizePath(f.path) })))
    return
  }

  openedFiles = new Map(files.map((f) => [normalizePath(f.path), f.file]))
  openedScenes = findScenes(files.map((f) => f.path))

  sceneSelect.textContent = ''
  sceneSelect.hidden = openedScenes.length < 2
  for (const [i, scene] of openedScenes.entries()) {
    const option = document.createElement('option')
    option.value = String(i)
    option.textContent = scene.dir === '' ? scene.nodePath : scene.dir
    sceneSelect.appendChild(option)
  }

  if (openedScenes.length === 0) {
    // A model in a format only the desktop reads is the one "nothing here"
    // case with a specific answer, so say which file and what to do about it.
    const desktopOnly = files.filter((f) => isDesktopOnlyMeshFileName(f.file.name))
    showMessages(
      [
        files.length === 0
          ? 'Nothing to open.'
          : desktopOnly.length === files.length
            ? `${desktopOnly.map((f) => f.file.name).join(', ')}: desktop GlyphViz reads this through ` +
              `trimesh, but the web app parses only ${MESH_EXTENSIONS.join(' / ')}. Export as .obj or .stl.`
            : `No gv_node.csv found in ${files.length} file(s). Drop a scene folder, a scene .zip, or the node CSV itself.`,
      ],
      openWarningLines,
    )
    return
  }
  await loadSceneCandidate(openedScenes[0])
}

/** Report anything that goes wrong opening a set, rather than swallowing it. */
function openFileSetSafely(files: PathedFile[]): void {
  void openFileSet(files).catch((err: unknown) =>
    showMessages([`Could not open the selection: ${String(err)}`], []),
  )
}

sceneSelect.addEventListener('change', () => {
  const scene = openedScenes[Number(sceneSelect.value)]
  if (scene) void loadSceneCandidate(scene)
})

fileInput.addEventListener('change', () => {
  openFileSetSafely(filesFromInput(fileInput))
  fileInput.value = ''
})

folderInput.addEventListener('change', () => {
  openFileSetSafely(filesFromInput(folderInput))
  folderInput.value = ''
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
  if (!e.dataTransfer) return
  // A dropped .zip arrives as an ordinary file entry — no folder walk needed;
  // openFileSet's expandZips turns it into the folder it stands for.
  filesFromDataTransfer(e.dataTransfer)
    .then(openFileSet)
    .catch((err: unknown) => showMessages([`Could not read the drop: ${String(err)}`], []))
})

// --- Picking -------------------------------------------------------------------
// Plain left-click on a node selects it (replacing the selection); Ctrl+click
// toggles it in or out of the current selection; clicking empty space clears,
// unless Ctrl is held (so a stray miss can't wipe a set you're building) —
// all matching the desktop viewport. A small movement threshold separates
// clicks from orbit drags.
//
// Shift+drag sweeps a rectangle (Ctrl+Shift+drag adds the region to the
// selection). The band itself is a plain absolutely-positioned div rather
// than a GL overlay — nothing about it needs to be in the scene.

const raycaster = new THREE.Raycaster()
const CLICK_SLOP_PX = 5
const RUBBER_SLOP_PX = 2 // desktop's dx/dy > 2 test: a sweep, not a click
let downAt: { x: number; y: number } | null = null

const rubberBand = document.createElement('div')
rubberBand.id = 'rubber-band'
rubberBand.hidden = true
app.appendChild(rubberBand)

let rubberStart: { x: number; y: number } | null = null
let rubberEnd = { x: 0, y: 0 }

function drawRubberBand() {
  if (!rubberStart) return
  const left = Math.min(rubberStart.x, rubberEnd.x)
  const top = Math.min(rubberStart.y, rubberEnd.y)
  rubberBand.style.left = `${left}px`
  rubberBand.style.top = `${top}px`
  rubberBand.style.width = `${Math.abs(rubberEnd.x - rubberStart.x)}px`
  rubberBand.style.height = `${Math.abs(rubberEnd.y - rubberStart.y)}px`
  rubberBand.hidden = false
}

function finishRubberBand(additive: boolean) {
  if (!rubberStart) return
  const start = rubberStart
  rubberStart = null
  rubberBand.hidden = true
  controls.enabled = !flyRig.flyMode // a sweep can run inside Camera Mode
  if (
    Math.abs(rubberEnd.x - start.x) <= RUBBER_SLOP_PX &&
    Math.abs(rubberEnd.y - start.y) <= RUBBER_SLOP_PX
  ) {
    return // a shift-click, not a sweep
  }
  if (!currentRoot || !currentFrames) return
  const rect = renderer.domElement.getBoundingClientRect()
  // Gizmo drags mutate frames between rebuilds, so refresh before projecting.
  currentRoot.updateMatrixWorld(true)
  const ids = nodeIdsInRect(
    currentNodes,
    currentFrames,
    camera,
    {
      x1: start.x - rect.left,
      y1: start.y - rect.top,
      x2: rubberEnd.x - rect.left,
      y2: rubberEnd.y - rect.top,
    },
    { width: rect.width, height: rect.height },
    { showHidden },
  )
  if (additive) addToSelection(ids)
  else setSelection(ids)
  status(`${ids.size} node(s) in region.`)
}

/**
 * The camera a pointer at canvas-relative `x` is looking through.
 *
 * Mono: the scene camera. Stereo: the eye that drew the half the pointer is in,
 * re-projected to full-canvas coordinates so the ordinary NDC maths below still
 * applies — the same idea as the desktop re-rendering its pick pass with the
 * matching eye's matrices (`_pick_node`).
 */
function cameraForPointer(x: number): THREE.PerspectiveCamera {
  const eyes = stereoEyesNow()
  if (!eyes) return camera
  return stereo.pickCamera(
    camera,
    eyeForX(eyes, x),
    window.innerWidth,
    window.innerHeight,
    orbitDistance(),
  )
}

function pickAt(clientX: number, clientY: number): number | null {
  if (!currentRoot) return null
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, cameraForPointer(clientX - rect.left))
  return pickNodeId(raycaster, currentRoot)
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  // Region select is off in stereo, matching the desktop: one screen rectangle
  // spans two different projections of the scene, so there is no single node
  // set it names. Single-node picking still works in either half.
  if (e.shiftKey && stereo.enabled && !gizmo.dragging && gizmo.axis === null) {
    status('Region select is disabled in stereo 3D — click to select, or switch stereo off.')
    return
  }
  // Shift over a gizmo handle stays a gizmo drag — TransformControls owns
  // the pointer there.
  if (e.shiftKey && !gizmo.dragging && gizmo.axis === null) {
    rubberStart = { x: e.clientX, y: e.clientY }
    rubberEnd = { x: e.clientX, y: e.clientY }
    controls.enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
    drawRubberBand()
    return
  }
  // Draw Mode: a plain left press stamps the brush and starts a stroke. Ctrl
  // falls through so additive selection keeps working, and Shift was handled
  // above, so region select does too — the desktop's own exclusions.
  if (drawMode && !(e.ctrlKey || e.metaKey)) {
    drawStrokeLast = { x: e.clientX, y: e.clientY }
    // The stroke owns the whole left drag: no orbiting underneath it, and the
    // press keeps its pointer if it wanders off the canvas.
    controls.enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
    drawStamp(e.clientX, e.clientY)
    return
  }
  downAt = { x: e.clientX, y: e.clientY }
})
renderer.domElement.addEventListener('pointermove', (e) => {
  // Draw stroke: stamp again each time the cursor gets Stamp Spacing pixels
  // from the previous stamp.
  if (drawStrokeLast && (e.buttons & 1) !== 0) {
    const spacing = Number(drawSpacingInput.value) || 0
    if (shouldStamp(drawStrokeLast, e.clientX, e.clientY, spacing)) {
      drawStrokeLast = { x: e.clientX, y: e.clientY }
      drawStamp(e.clientX, e.clientY)
    }
    return
  }
  if (!rubberStart) return
  rubberEnd = { x: e.clientX, y: e.clientY }
  drawRubberBand()
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return
  if (rubberStart) {
    finishRubberBand(e.ctrlKey || e.metaKey)
    return
  }
  // A draw click has already stamped: it must not also select or clear the
  // selection, so the stroke returns before the click-picker below.
  if (drawStrokeLast !== null) {
    finishDrawStroke()
    return
  }
  if (!downAt) return
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
  downAt = null
  // A press that became a Left+Right camera combo is never a selection click,
  // even if it moved less than the slop. flyPressMoved is the same idea for a
  // rate flight, whose cursor ENDS at its press point (that is how you stop) —
  // release displacement alone would misread the whole flight as a click.
  if (comboUsedInPress || flyPressMoved || moved > CLICK_SLOP_PX) return
  // Clicks on (or releases over) a gizmo arrow are drag interactions, not
  // selection changes.
  if (gizmo.dragging || gizmo.axis !== null) return
  const nodeId = pickAt(e.clientX, e.clientY)
  const additive = e.ctrlKey || e.metaKey
  if (nodeId === null) {
    // A Ctrl+click that misses leaves the set you are building alone.
    if (!additive) setSelection(null)
  } else if (additive) {
    toggleInSelection(nodeId)
  } else {
    setSelection(nodeId)
    // Alt+click is the desktop's one-gesture "select it, then open its link".
    if (e.altKey) openLinkOf(nodesById.get(nodeId) ?? null)
  }
})
renderer.domElement.addEventListener('pointercancel', () => {
  // An aborted draw stroke keeps everything it already stamped — the nodes are
  // real scene rows, not a preview.
  if (drawStrokeLast !== null) {
    finishDrawStroke()
    return
  }
  // Aborted press: drop the band without changing the selection.
  if (!rubberStart) return
  rubberStart = null
  rubberBand.hidden = true
  controls.enabled = !flyRig.flyMode
})
renderer.domElement.addEventListener('dblclick', (e) => {
  // Recenter the orbit pivot on the node under the cursor (falls back to
  // the current selection). Not in Camera Mode — the eye is derived from the
  // target there, so the same snap would teleport the camera onto the node
  // (the reason the desktop skips its combo pivot snap too) — and not on a
  // locked axis view, which must stay aimed at the world origin.
  if (flyRig.flyMode || flyRig.activeCameraLocked()) return
  const nodeId = pickAt(e.clientX, e.clientY) ?? selection.id
  if (nodeId === null) return
  const pos = worldPosOf(nodeId)
  if (!pos) return
  controls.target.copy(pos)
  snapCameraGoal() // focus is a jump, not a glide (desktop focus_on_node)
  controls.update()
})
window.addEventListener('keydown', (e) => {
  const focused = document.activeElement
  const tag = focused?.tagName
  // A focused BUTTON inside a tool window counts too: browsers focus a button
  // on click, so a Space or Enter meant to re-press it would otherwise also
  // reach the viewport and toggle Channels playback. Panels do not need this —
  // their buttons act on the scene, which is where those keys belong.
  const typing =
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    (focused instanceof HTMLElement && focused.closest('.float-window') !== null)

  // Panel cycling is a window command and fires even mid-edit; the selection
  // chords stand down while a field has focus, so Ctrl+A there still means
  // "select this text". Ctrl+N — which would have suited the Node Table — is
  // reserved by the browser and cannot be intercepted, hence P/E/B and Alt+C/N.
  // Each press advances open → collapsed → closed → open.
  //
  // Ctrl+Shift+B is the selection box. The desktop puts that on a bare Ctrl+B,
  // which is already the Scene panel here — a divergence, but the panel chord
  // predates it and is muscle memory in this app.
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase()
    if (key === 'b' && e.shiftKey) {
      selectionCommands.setShowSelectionBox(!selection.boxVisible)
    } else if (key === 'p') inspector.panel.cycle()
    else if (key === 'e') selectionPanel.panel.cycle()
    else if (key === 'b') scenePanel.cycle()
    // The desktop's own chords for Tools ▸ Hyperglyph Generator… and
    // Tools ▸ Glyph Composer…. Unlike Ctrl+N both ARE interceptable, so neither
    // needs an Alt substitute; the Create panel's buttons are the way in if a
    // browser ever disagrees.
    else if (key === 'h') hyperglyphWindow.toggle()
    else if (key === 'g') composerWindow.toggle()
    else if (typing) return
    else if (key === 'a') selectAllToggle()
    else if (key === 'i') selectionCommands.invertSelection()
    // Copy/Paste are the desktop's own chords. They only preventDefault away
    // from a text field, where the native copy is what the user meant.
    else if (key === 'c') copySelection()
    else if (key === 'v') pasteClipboard()
    else return
    e.preventDefault()
    return
  }

  // Alt+C / Alt+N for the Channels and Node Table panels: Ctrl+B/E/P are
  // taken, and Ctrl+N — the obvious one for the table — is reserved by the
  // browser and cannot be intercepted.
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const key = e.key.toLowerCase()
    if (key === 'c') channelsPanel.panel.cycle()
    else if (key === 'n') nodeTable.panel.cycle()
    // The desktop's F12 (Save Scene as PNG), which a browser will not give up.
    else if (key === 'p') requestScreenshot()
    // Alt+= / Alt+− step the PALETTE, the bare keys its index (below) — the
    // desktop's pairing, and the reason the palette keys live up here.
    else if (!typing && (key === '=' || key === '+')) cyclePaletteAttribute('palette', 1)
    else if (!typing && (key === '-' || key === '_')) cyclePaletteAttribute('palette', -1)
    else return
    e.preventDefault()
    return
  }

  if (typing) return
  if (e.key === ' ') {
    // Desktop transport: Space plays/pauses, Shift+Space stops and restores.
    e.preventDefault() // Space would otherwise scroll or re-press a focused button
    if (e.shiftKey) channelCommands.stop()
    else channelCommands.togglePlay()
  } else if (e.key === 'Escape') {
    // Desktop parity: Esc leaves Draw Mode AND clears the selection.
    setDrawMode(false)
    setSelection(null)
  } else if (e.key === 'd' || e.key === 'D') setDrawMode(!drawMode)
  else if (e.key === 'g' || e.key === 'G') cycleGridSelection()
  else if (e.key === 'h') selectionCommands.hideSelected()
  else if (e.key === 'H') selectionCommands.showAll()
  else if (e.key === 'i' || e.key === 'I') selectionCommands.isolateSelected()
  else if (e.key === 't' || e.key === 'T') toggleTags()
  else if (e.key === 'u' || e.key === 'U') openSelectedLink()
  else if (e.key === 'j' || e.key === 'J') cycleAttribute('topo', e.shiftKey ? -1 : 1)
  else if (e.key === 'o' || e.key === 'O') cycleAttribute('geometry', e.shiftKey ? -1 : 1)
  else if (e.key === 'f' || e.key === 'F') setFollowSelected(!followSelected)
  // The desktop's own pairing: plain C toggles Camera Mode (free flight),
  // Shift+C steps through the saved camera views — ANTz put cycling on the
  // bare key, and Camera Mode displaced it.
  else if (e.key === 'C') selectCameraView(flyRig.activeCamera + 1)
  else if (e.key === 'c') setCameraMode(!flyRig.flyMode)
  else if (e.key === 'b' || e.key === 'B') toggleBackgroundBw()
  // = / − step color_index within each node's own palette (Alt+ steps the
  // palette itself, handled above). '+' and '_' are the same physical keys with
  // Shift, which the desktop's Key_Equal/Key_Minus match regardless.
  else if (e.key === '=' || e.key === '+') cyclePaletteAttribute('index', 1)
  else if (e.key === '-' || e.key === '_') cyclePaletteAttribute('index', -1)
  else if (e.key === '8') cycleRenderMode()
  // ANTz decimation. '|' is the same physical key with Shift, which is exactly
  // how the desktop reads it (Key_Bar is what Windows sends for Shift+\).
  else if (e.key === '\\') adjustDrawLimit(DRAW_LIMIT_HALVE)
  else if (e.key === '|') adjustDrawLimit(DRAW_LIMIT_DOUBLE)
  else if (e.key === 'w' || e.key === 'W') toggleGizmoMode('translate')
  else if (e.key === 'e' || e.key === 'E') toggleGizmoMode('rotate')
  else if (e.key === 'r' || e.key === 'R') toggleGizmoMode('scale')
  else if (e.key === 'N' && e.shiftKey) addChildOfSelection()
  else if (e.key === 'n') addNode()
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection()
  else if (e.key === 'Tab') {
    e.preventDefault() // keep focus out of the HUD; Tab is sibling cycling
    navTo(navSibling(currentNodes, selectedNode(), e.shiftKey ? -1 : 1))
  } else if (e.key === 'ArrowUp' && selectedNode()) {
    e.preventDefault()
    navTo(navParent(currentNodes, selectedNode()!))
  } else if (e.key === 'ArrowDown' && selectedNode()) {
    e.preventDefault()
    navTo(navFirstChild(currentNodes, selectedNode()!))
  }
})

// --- Combined orbit+zoom: Left+Right drag together (desktop parity) -------------
// Both mouse buttons held together always means camera nav (the ANTz-style
// gesture ported from the desktop viewport's _orbit_zoom_camera): horizontal
// drag orbits azimuth at 0.4°/px, vertical drag zooms (×(1 + dy·0.005) per
// pixel, distance clamped ≥ 1), and at combo start the orbit pivot snaps to
// the selected node so the gesture orbits the selection. Releasing one button
// falls back to a plain orbit drag with the remaining button (desktop
// behavior) — handled manually until every button is up, because
// OrbitControls' drag anchor goes stale while it is disabled and handing back
// mid-press would jump the camera. With a mouse, chorded second-button
// presses/releases arrive as pointermove events (buttons bitmask), never as
// pointerdown/pointerup, so the state update hangs off all pointer events.
// One deliberate difference from the desktop: a combo pressed mid-gizmo-drag
// does not steal the drag from the gizmo (simplest default while
// TransformControls owns the pointer).

const COMBO_ORBIT_DEG_PER_PX = 0.4 // desktop _orbit_camera / _orbit_zoom_camera
const COMBO_ZOOM_PER_PX = 0.005
const COMBO_MIN_DISTANCE = 1

let manualDrag: 'combo' | 'orbit' | null = null
let manualLast = { x: 0, y: 0 }
let comboUsedInPress = false

function updateManualDragState(e: PointerEvent) {
  // A region sweep or a draw stroke owns the pointer.
  if (rubberStart !== null || drawStrokeLast !== null) return
  const left = (e.buttons & 1) !== 0
  const right = (e.buttons & 2) !== 0
  const next: typeof manualDrag =
    left && right
      ? manualDrag === null && gizmo.dragging
        ? null // the gizmo keeps an in-progress drag
        : 'combo'
      : manualDrag !== null && (left || right)
        ? 'orbit'
        : null
  if (next !== null && manualDrag === null) {
    manualLast = { x: e.clientX, y: e.clientY }
    controls.enabled = false
  }
  if (next === 'combo' && manualDrag !== 'combo') {
    comboUsedInPress = true
    // Desktop _maybe_snap_orbit_target: re-center the pivot on the selection.
    // Never on a locked axis view, which must stay aimed at the world origin
    // (Camera Mode's own guard is upstream: fly routes around this entirely).
    const pos =
      selection.id !== null && !flyRig.activeCameraLocked() ? worldPosOf(selection.id) : null
    if (pos) {
      // The goal, not the camera: with smoothing on, re-centring the pivot on
      // the selected object GLIDES. This is precisely where ANTz put its
      // low-pass (npSetCamTarget → "targeting"), and easing the pivot together
      // with the aim is the version that doesn't throw the object out of frame
      // on the way.
      const actual = cameraActualRig()
      if (actual) camSmoothing.adopt(actual)
      camSmoothing.goal.target = [pos.x, pos.y, pos.z]
      settleCamera(true)
    }
  }
  if (next === null && manualDrag !== null) controls.enabled = !flyRig.flyMode
  manualDrag = next
}

function manualDragMove(e: PointerEvent) {
  const dx = e.clientX - manualLast.x
  const dy = e.clientY - manualLast.y
  manualLast = { x: e.clientX, y: e.clientY }
  // A move that moves nothing is not a gesture. This matters beyond saving the
  // work: releasing one button of a chord arrives as a pointermove carrying
  // the new bitmask and no motion (the reason the state machine above hangs
  // off pointermove at all), and treating that as a plain orbit drag would end
  // any camera-smoothing glide the combo had just started — at the exact
  // moment the user let go, which is when the glide is the whole point.
  if (dx === 0 && dy === 0) return
  // Locked axis views: the combo keeps its zoom half and drops the orbit
  // (desktop _orbit_zoom_camera); a plain orbit drag does nothing at all
  // (desktop _orbit_camera returns outright).
  const locked = flyRig.activeCameraLocked()
  if (locked && manualDrag !== 'combo') return
  // Z-up azimuth/elevation/distance, the desktop camera model. The drag
  // extends the smoothing GOAL, which with smoothing off is collapsed onto the
  // camera on the same line below — so this is the same arithmetic on the same
  // numbers it always was (desktop _orbit_camera / _orbit_zoom_camera).
  const actual = cameraActualRig()
  if (!actual) return
  camSmoothing.adopt(actual)
  const goal = camSmoothing.goal
  // Azimuth sign is the grab-the-object convention (matches both the desktop
  // and what OrbitControls does for a plain left drag).
  if (!locked) goal.azimuth -= dx * COMBO_ORBIT_DEG_PER_PX
  if (manualDrag === 'combo') {
    goal.distance = Math.max(COMBO_MIN_DISTANCE, goal.distance * (1 + dy * COMBO_ZOOM_PER_PX))
  } else {
    goal.elevation = THREE.MathUtils.clamp(goal.elevation + dy * COMBO_ORBIT_DEG_PER_PX, -89, 89)
  }
  // combo: the gesture ANTz's own smoothing applied to, so it glides even at
  // the narrower default scope.
  settleCamera(manualDrag === 'combo')
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  comboUsedInPress = false // pointerdown always starts a fresh button chord
  flyPressMoved = false
  if (routeFlyPointer(e)) {
    // A rate-flight hold routinely lasts seconds and wanders off the canvas;
    // capture keeps the drag (and its release) coming to this element.
    renderer.domElement.setPointerCapture(e.pointerId)
    return
  }
  updateManualDragState(e)
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (routeFlyPointer(e)) return
  updateManualDragState(e)
})
renderer.domElement.addEventListener('pointercancel', (e) => {
  if (routeFlyPointer(e)) return
  updateManualDragState(e)
})
renderer.domElement.addEventListener('pointermove', (e) => {
  if (routeFlyPointer(e)) return
  updateManualDragState(e)
  if (manualDrag !== null) manualDragMove(e)
})
// OrbitControls only suppresses the context menu while enabled; during a combo
// it is disabled, so cover the right-button release ourselves.
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())

// --- Transform gizmo (interaction 6c) ------------------------------------------
// TransformControls in LOCAL space: thanks to the outward base rotation, the
// handles align with the topology's natural directions.
//
// Translate: the gizmo drags the frame along a straight line; each tick we
// invert that position back into topology coordinates, pin the two fields
// the drag axis doesn't own (decided once per drag from the placement
// gradients), and re-apply the frame transform — so the node slides on the
// topology surface and exactly one CSV field changes per arrow.
//
// Rotate: each tick we strip the topology base rotation off the dragged
// quaternion and decompose the rest back into rotate_x/y/z per the node's
// rotation_mode (HTR Z-X-Z or Euler XYZ) with unwrap/branch/gimbal-hold
// policies (src/render/rotationInverse.ts).
//
// Scale: pure local scale — frame.scale maps 1:1 onto scale_x/y/z.
//
// In every mode children ride along rigidly, matching the engine.

const gizmo = new TransformControls(camera, renderer.domElement)
gizmo.setMode('translate')
gizmo.setSpace('local')
gizmo.setSize(0.8)
scene.add(gizmo.getHelper())
// The handles are chrome: exempt from scene fog like the selection halos
// (render/fog.ts) — a gizmo out at fog_end must stay grabbable.
gizmo.getHelper().traverse((o) => {
  const material = (o as THREE.Mesh).material
  for (const m of Array.isArray(material) ? material : material ? [material] : []) {
    ;(m as THREE.Material & { fog?: boolean }).fog = false
  }
})

// In stereo the handles are drawn twice, once per eye, and a pointer measured
// against the whole canvas would grab at neither. So before TransformControls
// sees a pointer event, hand it the camera for the half the pointer is in —
// document capture runs ahead of the canvas's own listeners, whatever order
// they were registered in.
//
// Never mid-drag: the drag plane belongs to the eye the grab started in, and
// swapping it under a moving pointer would jump the node.
for (const type of ['pointermove', 'pointerdown'] as const) {
  document.addEventListener(
    type,
    (e) => {
      if (!stereo.enabled || gizmo.dragging) return
      const eyes = stereoEyesNow()
      if (!eyes) return
      const rect = renderer.domElement.getBoundingClientRect()
      gizmo.camera = stereo.gizmoCamera(
        camera,
        eyeForX(eyes, e.clientX - rect.left),
        window.innerWidth,
        window.innerHeight,
        orbitDistance(),
      )
    },
    true,
  )
}

// Desktop parity (`MainWindow._gizmo_mode`, which starts at None): the modes
// are MUTUALLY EXCLUSIVE AND OPTIONAL. Nothing is armed until a button — or
// W/E/R — arms it, pressing the armed one again disarms it ("click again to
// return to camera-only"), and with no mode armed no handles are drawn at all.
// That is the third of the screengrab escapes, alongside the selection box and
// closable panels: a selected node can be shown with no editing furniture on
// it, without losing the selection.
//
// ONE DELIBERATE DIVERGENCE (Jeff, 2026-07-26): the armed mode is STICKY. The
// desktop clears it the moment the selection empties, but that line lives in
// `_on_table_selection` right next to the one disabling the buttons — it reads
// as a consequence of keeping a checked button from also being a disabled one,
// not as an interaction decision. A mode that turns itself off is only
// tolerable when there is no other way out, and there is one: the button and
// the key both toggle. So here the mode persists until it is turned off, the
// buttons stay ENABLED with nothing selected (which also settles W/E/R being
// able to arm ahead of a selection), and the handles just come and go with the
// selection. Jeff intends the desktop to move this way too.
type GizmoMode = 'translate' | 'rotate' | 'scale'
const MODE_LABELS: Record<GizmoMode, string> = {
  translate: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
}
let gizmoMode: GizmoMode | null = null
const modeButtons = [...hud.querySelectorAll<HTMLButtonElement>('#hud-modes button')]

/**
 * Attach the handles to the primary node, or detach when they have no business
 * being on screen: no mode armed, nothing selected, or a node whose transform
 * the gizmo must not touch. No gizmo on World Grids (their frame deliberately
 * carries no scale, so gizmo modes would fight it) or Links (their own
 * transform is inert — the edge follows its endpoints); edit those through the
 * inspector, like the desktop's panel/table.
 */
function updateGizmoAttachment() {
  const primary = selection.id !== null ? nodesById.get(selection.id) : undefined
  const frame = primary ? currentFrames?.get(primary.id) : undefined
  if (
    gizmoMode === null ||
    // Camera Mode and Draw Mode own every drag button, so manipulation is
    // suspended until they are off — the armed mode stays sticky, the handles
    // just go away (and come back with it). Immersive mode is the same rule
    // for a different reason: TransformControls drags from a screen-space
    // pointer, and a headset has no pointer to drag from.
    flyRig.flyMode ||
    drawMode ||
    xrRig.presenting ||
    !primary ||
    !frame ||
    primary.type === NodeType.WorldGrid ||
    primary.type === NodeType.Link
  ) {
    gizmo.detach()
    return
  }
  gizmo.attach(frame)
}

function setGizmoMode(mode: GizmoMode | null, announce = true) {
  const changed = gizmoMode !== mode
  gizmoMode = mode
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === mode)
  if (mode !== null) gizmo.setMode(mode)
  updateGizmoAttachment()
  if (!announce || !changed) return
  if (mode === null) return status('Gizmo off — camera only.')
  // The buttons are disabled without a selection, but W/E/R can still arm a
  // mode ahead of one, so say what is still missing.
  status(
    selection.size === 0
      ? `${MODE_LABELS[mode]} gizmo on — select a node to use it.`
      : `${MODE_LABELS[mode]} gizmo on.`,
  )
}

/** Button click and W/E/R alike: the armed mode toggles back off. */
function toggleGizmoMode(mode: GizmoMode) {
  setGizmoMode(gizmoMode === mode ? null : mode)
}

for (const b of modeButtons) {
  const mode = b.dataset.mode as GizmoMode
  b.title =
    `${MODE_LABELS[mode]} the selected node(s) by dragging the handles.\n` +
    'Stays armed while you select your way around the scene; click again\n' +
    '(or press the key again) to put the handles away and return to\n' +
    'camera-only, which leaves the selection alone.'
  b.addEventListener('click', () => toggleGizmoMode(mode))
}

let dragStartTranslate: Vec3 | null = null
let dragStartOffset = new THREE.Vector3()
let dragField: 'x' | 'y' | 'z' | null | 'undecided' = 'undecided'

// --- Dragging a multi-selection ------------------------------------------------
// The gizmo is attached to the primary node, and only the primary goes through
// the inverse topology math. Every other selected node then receives the same
// per-field change the primary just took, in its own topology coordinates —
// the desktop's _apply_axis_deltas rule, see src/gv/multiEdit.ts.

let followerStart = new Map<number, DragSnapshot>()
let primaryStart: DragSnapshot | null = null

/** Push the primary's change onto every other selected node. */
function applyDragToFollowers(primary: GvNode) {
  if (followerStart.size === 0 || !primaryStart) return
  const mode = gizmo.mode as DragMode
  for (const [id, start] of followerStart) {
    const node = nodesById.get(id)
    if (!node) continue
    applyDragDelta(mode, primary, primaryStart, node, start)
    const frame = currentFrames?.get(id)
    if (frame) applyFrameTransform(frame, node, parentOf(node))
  }
}

gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as unknown as { value: boolean }).value
  controls.enabled = !dragging
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (dragging && node && gizmo.object) {
    primaryStart = snapshotTransform(node)
    followerStart = new Map(
      selectedNodes()
        .filter((n) => n.id !== node.id)
        .map((n) => [n.id, snapshotTransform(n)]),
    )
    if (gizmo.mode === 'translate') {
      dragStartTranslate = { ...node.translate }
      dragStartOffset = gizmo.object.position.clone()
      dragField = 'undecided'
    }
  } else if (!dragging) {
    dragStartTranslate = null
    primaryStart = null
    followerStart = new Map()
    // Final commit: full rebuild refreshes glyph draw scale, HUD, halo.
    if (node) rebuildScene(false)
  }
})

// A grid child's frame position is diag(gridScale)·offset (the grid's scale
// re-spaces positions without living on its frame) — strip that re-spacing
// to work in offset space, holding a zero-scale axis at 0.
function gridOffsetSpace(v: THREE.Vector3, grid: GvNode): THREE.Vector3 {
  const d = (p: number, s: number) => (Math.abs(s) < 1e-12 ? 0 : p / s)
  return new THREE.Vector3(d(v.x, grid.scale.x), d(v.y, grid.scale.y), d(v.z, grid.scale.z))
}

gizmo.addEventListener('objectChange', () => {
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  const frame = gizmo.object
  if (!node || !frame) return
  const parentGv = parentOf(node)
  // Children of a World Grid invert through geography, regardless of the
  // grid row's own topo field: a globe is exactly the Sphere topology at
  // radius 180/π; a flat grid is Cartesian recentered on the window midpoint.
  const gridParent = parentGv?.type === NodeType.WorldGrid ? parentGv : null
  const gridGlobe = gridParent !== null && gridIsGlobe(gridParent)
  const parentTopo = gridParent
    ? gridGlobe
      ? Topo.Sphere
      : Topo.None
    : parentGv
      ? parentGv.topo
      : -1
  const parentRatio = gridParent ? 0 : (parentGv?.ratio ?? 0)
  // A globe grid's children place at the geographic radius, which the Global
  // Scale plays no part in; everything else inverts through the live value the
  // frame was placed with.
  const dragBaseScale = gridGlobe ? GRID_GLOBE_RADIUS : baseScale()
  // The parent's Topology Scale, divided back out per axis by the inversion so
  // a retuned parent's children still track the cursor 1:1 (grid parents are
  // exempt on both sides, which parentTopoScale answers with 1.0).
  const dragTopoScale = parentTopoScale(parentGv)

  // Live re-read of the primary + followers while a drag is in flight.
  const showDragged = () => {
    applyDragToFollowers(node)
    const nodes = selectedNodes()
    inspector.show(nodes, nodes.length === 1 ? worldPosOf(node.id) : null)
  }

  if (gizmo.mode === 'scale') {
    node.scale.x = frame.scale.x
    node.scale.y = frame.scale.y
    node.scale.z = frame.scale.z
    showDragged()
    return
  }

  if (gizmo.mode === 'rotate') {
    // Strip the outward base rotation (constant during a rotate drag —
    // it depends only on translate), decompose the node's own rotation.
    const own = frameBaseRotation(node, parentGv)
      .transpose() // inverse of a pure rotation
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(frame.quaternion))
    const r = invertLocalRotation(own, node.rotate, node.rotationMode)
    node.rotate.x = r.x
    node.rotate.y = r.y
    node.rotate.z = r.z
    // Snap the frame to the exact CSV-representable rotation.
    applyFrameTransform(frame, node, parentGv)
    showDragged()
    return
  }

  if (!dragStartTranslate) return
  if (dragField === 'undecided') {
    const motion = frame.position.clone().sub(dragStartOffset)
    if (motion.lengthSq() < 1e-12) return
    dragField = pickDominantField(
      parentTopo,
      dragStartTranslate,
      gridParent ? gridOffsetSpace(motion, gridParent) : motion,
      parentRatio,
      node.subspace,
      dragBaseScale,
      dragTopoScale,
    )
  }

  const inverted = invertTopoOffset({
    parentTopo,
    offset: gridParent ? gridOffsetSpace(frame.position, gridParent) : frame.position,
    prev: node.translate, // last committed tick — keeps unwrap continuous
    parentRatio,
    subspace: node.subspace,
    baseScale: dragBaseScale,
    parentTopoScale: dragTopoScale,
  })
  if (gridParent && !gridGlobe) {
    // Cartesian inversion recovered the window-relative offset; translate
    // fields are absolute lon/lat.
    const c = gridCenter(gridParent)
    inverted.x += c.lon
    inverted.y += c.lat
  }
  const t =
    dragField === null ? inverted : { ...dragStartTranslate, [dragField]: inverted[dragField] }

  node.translate.x = t.x
  node.translate.y = t.y
  node.translate.z = t.z
  // Reproject onto the topology surface and track outward orientation.
  applyFrameTransform(frame, node, parentGv)
  showDragged()
})

// --- Node creation (N / Shift+N / Create panel) --------------------------------
// Ported desktop behavior: N adds a root node (child instead when a
// child-level node is selected); Shift+N adds a child under the selection,
// keeping the parent selected so repeated presses spread siblings. The New
// Object Defaults (geometry/topology/scale/color) apply to every path.

for (const [names, select, defaultId] of [
  [GEOMETRY_NAMES, newGeoSelect, NEW_OBJECT_DEFAULTS.geometry],
  [TOPO_NAMES, newTopoSelect, NEW_OBJECT_DEFAULTS.topo],
] as const) {
  for (const id of Object.keys(names).map(Number).sort((a, b) => a - b)) {
    // Mesh (23) is never offered bare — it means nothing without a mesh_id, so
    // each imported model gets its own entry instead (refreshMeshMenus below,
    // and the desktop's own _add_mesh_combo_entry).
    if (id === Geometry.Mesh && names === GEOMETRY_NAMES) continue
    const option = document.createElement('option')
    option.value = String(id)
    option.textContent = `${names[id]} (${id})`
    select.appendChild(option)
  }
  select.value = String(defaultId)
}

/** Re-list the imported meshes in the New Object Defaults geometry menu. */
function refreshMeshMenus(): void {
  for (const option of [...newGeoSelect.options]) {
    if (option.value.includes(':')) option.remove()
  }
  for (const choice of meshChoices(meshLibrary)) {
    newGeoSelect.appendChild(
      Object.assign(document.createElement('option'), {
        value: `${Geometry.Mesh}:${choice.meshId}`,
        textContent: choice.label,
      }),
    )
  }
}

function readNewObjectDefaults(): NewObjectDefaults {
  const s = Number(newScaleInput.value)
  const scale = Number.isFinite(s) && s > 0 ? s : 1
  const hex = newColorInput.value // "#rrggbb"
  // Mesh entries carry the (geometry, mesh_id) pair, like the desktop combo's
  // item data — picking one has to set both.
  const [geometry, meshId] = newGeoSelect.value.split(':').map(Number)
  return {
    geometry,
    meshId: meshId ?? 0,
    topo: Number(newTopoSelect.value),
    scale: { x: scale, y: scale, z: scale },
    color: {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 255,
    },
  }
}

function addChildOfSelection() {
  const parent = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (!parent) return
  currentNodes.push(createChildNode(currentNodes, parent, readNewObjectDefaults()))
  rebuildScene(false) // parent stays selected so repeated presses spread children
}

function addNode() {
  // Desktop N semantics: child when a child-level node is selected.
  const selected = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (selected && selected.branchLevel >= 1) {
    addChildOfSelection()
    return
  }
  const node = createRootNode(currentNodes, readNewObjectDefaults())
  currentNodes.push(node)
  rebuildScene(false)
  setSelection(node.id)
}

newNodeButton.addEventListener('click', addNode)
newChildButton.addEventListener('click', addChildOfSelection)

function addWorldGrid(): GvNode {
  const grid = createWorldGrid(currentNodes)
  currentNodes.push(grid)
  rebuildScene(false)
  return grid
}

newGridButton.addEventListener('click', () => {
  const grid = addWorldGrid()
  setSelection(grid.id)
  status(
    `World Grid created (node ${grid.id}): lon −180…180, lat −90…90, 1:1 world units. ` +
      'G selects/cycles grids; New Child and Draw Mode add glyphs onto it.',
  )
})

// --- Draw Mode (D) -------------------------------------------------------------
// Ported from the desktop's Draw Mode (glyphviz_core/draw_mode.py + the
// viewport/main-window halves): a left click stamps a brush where the cursor
// meets a flat World Grid's drawing plane, and a left drag stamps a trail of
// them, one per Stamp Spacing pixels of cursor travel. Every stamp is a real
// child of the grid, so a drawing saves, reloads and moves with the grid like
// any other part of the scene.
//
// The brush is either a single object built from the New Object Defaults or a
// whole Glyph Composer hyperglyph (desktop Draw Mode v2), with per-stamp
// heading and scale jitter drawn once per stamp so a hyperglyph stays coherent.
//
// Draw Mode and Camera Mode displace each other: both claim the left button
// outright. The gizmo handles go away while drawing for the same reason (the
// armed mode stays sticky — the 6h rule), and plain click-select is suspended,
// while Ctrl+click add-select, Shift+drag region select, right-drag orbit,
// middle-button pan and the wheel all keep working.

let drawMode = false
/** Last stamped cursor position; null means no stroke is in progress. */
let drawStrokeLast: { x: number; y: number } | null = null
let drawStrokeStamps = 0
let drawStrokeNodes = 0
let drawRebuildFrame = 0
/** Loaded Glyph Composer brushes, indexed by the Stamp menu's option values. */
const drawBrushes: GlyphRecipe[] = []

{
  const single = document.createElement('option')
  single.value = ''
  single.textContent = 'Single Object'
  drawStampSelect.appendChild(single)
}

/**
 * Register a composer template as a brush and select it — the panel's Load…
 * button and the Glyph Composer's Use as Draw Brush button both land here.
 * Brushes ACCUMULATE (desktop `set_draw_stamp_recipe`), so two loaded
 * templates stay available for alternating strokes.
 */
function addDrawBrush(recipe: GlyphRecipe): void {
  drawBrushes.push(recipe)
  const option = document.createElement('option')
  option.value = String(drawBrushes.length - 1)
  option.textContent = recipe.name || 'Template'
  drawStampSelect.appendChild(option)
  drawStampSelect.value = option.value
}

/** The selected brush, or null for the Single Object stamp. */
function currentDrawBrush(): GlyphRecipe | null {
  const index = Number(drawStampSelect.value)
  return drawStampSelect.value === '' ? null : (drawBrushes[index] ?? null)
}

drawBrushInput.addEventListener('change', async () => {
  const file = drawBrushInput.files?.[0]
  drawBrushInput.value = '' // let the same file be picked again
  if (!file) return
  try {
    const recipe = recipeFromJson(JSON.parse(await file.text()))
    addDrawBrush(recipe)
    status(`Draw brush: "${recipe.name}" — Draw Mode stamps this hyperglyph.`)
  } catch (err: unknown) {
    // A file that is not a recipe is refused and reported rather than becoming
    // an empty brush, exactly as the Composer's own template load does.
    status(`Template load failed: ${err instanceof Error ? err.message : String(err)}`)
  }
})

function setDrawMode(on: boolean): void {
  if (on === drawMode) return
  // Camera Mode and Draw Mode both claim the left button, so each setter only
  // ever turns the other OFF — no recursion.
  if (on && flyRig.flyMode) setCameraMode(false)
  drawMode = on
  drawStrokeLast = null
  drawModeButton.classList.toggle('active', on)
  renderer.domElement.style.cursor = on ? 'crosshair' : ''
  // Manipulation is suspended while drawing; the armed mode stays sticky.
  updateGizmoAttachment()
  if (!on) return status('Draw Mode off.')
  // The mode is meaningless without a target, so a gridless scene gets one
  // (desktop `_on_draw_mode_changed`).
  if (!currentNodes.some((n) => n.type === NodeType.WorldGrid)) {
    const grid = addWorldGrid()
    status(
      `Draw Mode ON — World Grid ${grid.id} created to draw on. ` +
        'Click / drag stamps onto it at Draw Z; right-drag orbits  [D or Esc exits]',
    )
    return
  }
  status(
    'Draw Mode ON — click / drag stamps onto the grid at Draw Z; ' +
      'right-drag orbits  [D or Esc exits]',
  )
}

drawModeButton.addEventListener('click', () => setDrawMode(!drawMode))

/**
 * The grid a stamp lands on: a selected grid when there is one (row order, the
 * same precedence the desktop's World Grid panel uses), else the scene's first
 * grid in file order.
 */
function drawTargetGrid(): GvNode | null {
  for (const node of selectedNodes()) {
    if (node.type === NodeType.WorldGrid) return node
  }
  return currentNodes.find((n) => n.type === NodeType.WorldGrid) ?? null
}

/**
 * The nodes one stamp creates, at the stamp frame's ORIGIN — placeStamp then
 * lands the roots on the cursor. Either the selected hyperglyph or a single
 * object from the New Object Defaults (desktop `_draw_stamp_nodes`).
 */
function drawStampNodes(grid: GvNode, startId: number): GvNode[] {
  const recipe = currentDrawBrush()
  if (recipe) {
    return generateNodes(recipe, {
      startId,
      parentId: grid.id,
      baseBranchLevel: grid.branchLevel + 1,
    })
  }
  const node = blankNode(startId, readNewObjectDefaults())
  node.parentId = grid.id
  node.branchLevel = grid.branchLevel + 1
  return [node]
}

/**
 * One rebuild per animation frame however many stamps land in it. A drag at
 * the default 30 px spacing fires several stamps a second, and rebuildScene
 * rebuilds the whole graph — the same rAF coalescing the Global Scale slider
 * uses, for the same reason.
 */
function requestDrawRebuild(): void {
  if (drawRebuildFrame) return
  drawRebuildFrame = requestAnimationFrame(() => {
    drawRebuildFrame = 0
    rebuildScene(false)
  })
}

function drawStamp(clientX: number, clientY: number): void {
  let grid = drawTargetGrid()
  // The mode-entry grid can be deleted mid-mode; make a fresh one.
  if (!grid) grid = addWorldGrid()
  if (gridIsGlobe(grid)) {
    status(
      `Draw Mode draws on flat grids only for now — switch grid ${grid.id}'s ` +
        'geometry from Sphere to Grid in the Properties panel.',
    )
    return
  }
  const frame = currentFrames?.get(grid.id)
  if (!frame) {
    status(`Grid ${grid.id} is past the draw limit (\\) — raise it to draw on this grid.`)
    return
  }
  // A frame built since the last render pass has no world matrix yet, and a
  // stamp is often the very next thing after a rebuild (the auto-created grid,
  // the previous stamp in this stroke). Ancestors only — O(depth).
  frame.updateWorldMatrix(true, false)

  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  // cameraForPointer is what makes drawing work in stereo: the pointer is
  // measured against the half it is in, and that eye's projection is remapped
  // onto the full canvas — the same path single-node picking already takes.
  raycaster.setFromCamera(ndc, cameraForPointer(clientX - rect.left))
  const drawZ = Number(drawZInput.value) || 0
  const hit = gridHit(raycaster.ray, grid, frame, drawZ)
  if (hit === null) return // plane edge-on or behind the camera: nothing to place

  const nodes = drawStampNodes(grid, nextNodeId(currentNodes))
  if (nodes.length === 0) return
  placeStamp(
    nodes,
    grid.branchLevel + 1,
    hit.lon,
    hit.lat,
    drawZ,
    Number(drawHeadingJitterInput.value) || 0,
    Number(drawScaleJitterInput.value) || 0,
  )
  currentNodes.push(...nodes)
  drawStrokeStamps++
  drawStrokeNodes += nodes.length
  requestDrawRebuild()
}

function finishDrawStroke(): void {
  drawStrokeLast = null
  controls.enabled = !flyRig.flyMode
  if (drawStrokeStamps === 0) return
  // Flush the coalesced rebuild so the stroke is on screen with its report.
  if (drawRebuildFrame) {
    cancelAnimationFrame(drawRebuildFrame)
    drawRebuildFrame = 0
    rebuildScene(false)
  }
  const what =
    drawStrokeNodes !== drawStrokeStamps
      ? `${drawStrokeStamps} stamp(s), ${drawStrokeNodes} node(s)`
      : `${drawStrokeStamps} object(s)`
  status(`Drew ${what} — Shift+drag selects a region, Delete removes it.`)
  drawStrokeStamps = 0
  drawStrokeNodes = 0
}

// --- Delete + tree navigation --------------------------------------------------
// Desktop parity: Delete/Backspace removes the selected node AND its whole
// subtree (children are never reparented). Up/Down walk parent/first-child,
// Tab/Shift+Tab cycle visual siblings in row order (all roots at level 0),
// wrapping — Tab with nothing selected starts at the first visual node.

function selectedNode(): GvNode | null {
  return selection.id !== null ? (nodesById.get(selection.id) ?? null) : null
}

function deleteSelection() {
  // Copy: `selection.ids` is the live internal array, and the rebuild below
  // refills it — the count in the status message would read the new one.
  const ids = [...selection.ids]
  if (ids.length === 0) return
  // Each subtree in turn; an id already swept away as somebody else's
  // descendant just doesn't match anything the second time.
  for (const id of ids) currentNodes = deleteSubtree(currentNodes, id)
  // rebuildScene re-selects the previous ids, finds them gone, and cleanly
  // detaches the gizmo + empties the inspector.
  rebuildScene(false)
  status(`${ids.length} node(s) and their descendants deleted.`)
}

function navTo(node: GvNode | null) {
  if (node) setSelection(node.id)
}

deleteButton.addEventListener('click', deleteSelection)

// --- Copy / Paste (Ctrl+C / Ctrl+V) --------------------------------------------
// Desktop parity, including its defining restriction: ONE object at a time,
// always with its whole descendant subtree. The rules live in
// src/gv/clipboard.ts; what is here is the selection plumbing and the status
// wording, which is the desktop's own.
//
// The clipboard is in-memory (as it is there), so it does not reach another
// browser tab — but it does survive loading a different scene, since paste
// renumbers from the destination's own id range.

let clipboard: Clipboard | null = null

function copySelection() {
  if (selection.size !== 1) return status('Select exactly one node to copy.')
  const copied = copySubtree(currentNodes, selection.id!)
  if (!copied) return
  clipboard = copied
  refreshClipboardUi()
  status(`Copied node ${copied.rootId} and ${copied.nodes.length - 1} descendant(s).`)
}

function pasteClipboard() {
  if (!clipboard) return status('Nothing to paste — copy a node first.')
  if (selection.size > 1) {
    return status('Select exactly one node (or none) as the paste target.')
  }
  const { pasted, droppedLinks } = pasteSubtree(currentNodes, clipboard, selectedNode())
  if (pasted.length === 0) return status('Nothing to paste.')
  currentNodes.push(...pasted)
  rebuildScene(false)
  // Selecting the result is what makes a paste immediately draggable, and it is
  // what the desktop does (select_by_ids over the pasted rows). Under a draw
  // limit the tail of a big paste has no frame yet and is silently left out —
  // the same rule every other selection path already follows.
  setSelection(new Set(pasted.map((n) => n.id)))
  // The desktop drops an outward-reaching link in silence; saying so is the
  // difference between "paste lost a row" and a deliberate rule.
  const dropped = droppedLinks > 0 ? ` ${droppedLinks} link(s) reaching outside were dropped.` : ''
  status(`Pasted ${pasted.length} node(s).${dropped}`)
}

/** Copy needs exactly one node; paste needs something copied and ≤1 target. */
function refreshClipboardUi() {
  copyButton.disabled = selection.size !== 1
  pasteButton.disabled = clipboard === null || selection.size > 1
}

copyButton.addEventListener('click', copySelection)
pasteButton.addEventListener('click', pasteClipboard)

// --- Hyperglyph Generator (Ctrl+H) ---------------------------------------------
// Ported from the desktop's Tools ▸ Hyperglyph Generator… dialog. The design
// engine is src/gv/hyperglyph.ts (seed-for-seed identical to the desktop's —
// see hyperglyph.parity.test.ts); the window and its live preview are
// src/ui/hyperglyphWindow.ts. What is here is only the insertion, which is
// `_insert_into_scene`'s own rule.

const hyperglyphWindow = new HyperglyphWindow({
  insert(design) {
    // Desktop `_insert_into_scene`: the PRIMARY selected node is the parent —
    // `_selected_nodes[0]`, which is row order here as everywhere else — and
    // with nothing selected the design arrives as a new root object. Note the
    // trunk keeps the recipe's own translate (0, 0, 0) rather than being
    // offset like a pasted subtree, so inserting onto a parent lands it at
    // that parent's origin. That is the desktop's behaviour, and it is what
    // makes an inserted hyperglyph read as belonging to the node it was
    // dropped on.
    const parent = selectedNodes()[0] ?? null
    const nodes = buildHyperglyphNodes(design, {
      startId: nextNodeId(currentNodes),
      parentId: parent ? parent.id : 0,
      baseBranchLevel: parent ? parent.branchLevel + 1 : 0,
    })
    if (nodes.length === 0) return
    currentNodes.push(...nodes)
    rebuildScene(false)
    // The desktop selects the TRUNK, not the whole subtree — which is what
    // makes a second insertion nest under the first, and what leaves the gizmo
    // on the one node that moves the design as a unit.
    setSelection(nodes[0].id)
    status(
      `Hyperglyph Generator: inserted ${nodes.length} nodes ` +
        `(parent=${parent ? parent.id : 0}, ids ${nodes[0].id}-${nodes[nodes.length - 1].id})`,
    )
  },
})
app.appendChild(hyperglyphWindow.element)
hyperglyphButton.addEventListener('click', () => hyperglyphWindow.toggle())

// --- Glyph Composer (Ctrl+G) ---------------------------------------------------
// Ported from the desktop's Tools ▸ Glyph Composer… dialog, down to its own
// chord. The recipe model and node generator are src/gv/glyphRecipe.ts (shared
// with the Hyperglyph Generator, and diffed against the desktop's own
// `generate_nodes` in glyphRecipe.parity.test.ts); the window is
// src/ui/glyphComposerWindow.ts. What is here is only the insertion, which is
// `_insert_into_scene`'s rule — the SAME rule the Generator's is, since both
// dialogs share that method almost line for line.

const composerWindow = new GlyphComposerWindow({
  insert(recipe) {
    const parent = selectedNodes()[0] ?? null
    const nodes = generateNodes(recipe, {
      startId: nextNodeId(currentNodes),
      parentId: parent ? parent.id : 0,
      baseBranchLevel: parent ? parent.branchLevel + 1 : 0,
    })
    if (nodes.length === 0) return
    currentNodes.push(...nodes)
    rebuildScene(false)
    // The TRUNK, not the whole subtree — so a second insertion nests under the
    // first and the gizmo lands on the one node that moves the glyph as a unit.
    setSelection(nodes[0].id)
    status(
      `Glyph Composer: inserted ${nodes.length} nodes ` +
        `(parent=${parent ? parent.id : 0}, ids ${nodes[0].id}-${nodes[nodes.length - 1].id})`,
    )
  },
  // Desktop `_use_as_draw_brush`: register the snapshot AND turn Draw Mode on,
  // so composing a tree and painting a forest with it is one press.
  useAsDrawBrush(recipe) {
    addDrawBrush(recipe)
    setDrawMode(true)
    status(
      `Draw brush: "${recipe.name}" — Draw Mode is on, click / drag in the viewport to paint it.`,
    )
  },
  status,
})
app.appendChild(composerWindow.element)
composerButton.addEventListener('click', () => composerWindow.toggle())

// --- Imported meshes (.obj / .stl) ---------------------------------------------
// Ported from the desktop's Meshes > Import Mesh File… (_import_mesh_file),
// including its target rule, which is Paste's: exactly one node selected →
// the model is assigned to it (geometry 23 + mesh_id); nothing selected → the
// model arrives as a new root object; more than one selected → nothing, and
// the status line says why.
//
// Ids are handed out in import order and live only in this session, exactly as
// there — the CSV stores the id and nothing else. Two web-only additions:
// files can be DROPPED on the window, and a scene folder that ships its own
// models has them loaded with it (loadSceneMeshes).

const meshLibrary = new MeshLibrary()
inspector.setMeshes(meshLibrary)

/**
 * Desktop `_import_mesh_file`'s new-object row: type 5, grey, scale 5 — and
 * topo 0, which is the one place it does NOT take the New Object Defaults
 * panel's topology (that path passes `topo=0` literally).
 */
const MESH_NODE_DEFAULTS: NewObjectDefaults = {
  geometry: Geometry.Mesh,
  topo: Topo.None,
  scale: { x: 5, y: 5, z: 5 },
  color: { r: 200, g: 200, b: 200, a: 255 },
}

async function readMeshFile(file: File, source: string): Promise<MeshAsset | string> {
  try {
    return meshLibrary.add(source, parseMeshFile(file.name, await file.arrayBuffer()))
  } catch (err: unknown) {
    // The desktop reports the exception on its status bar and imports nothing.
    return `Mesh import failed (${file.name}): ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Import model files and put them into the scene.
 *
 * The desktop picks ONE file, so its target rule needs generalizing: with a
 * node selected, the first model is assigned to it and any further ones become
 * new objects — which is what a single file already did in both cases.
 */
async function importMeshFiles(files: Array<{ file: File; source: string }>) {
  if (files.length === 0) return
  if (selection.size > 1) {
    return status('Select exactly one node (or none) as the mesh import target.')
  }
  const target = selectedNode()
  const failures: string[] = []
  const imported: MeshAsset[] = []
  for (const { file, source } of files) {
    const result = await readMeshFile(file, source)
    if (typeof result === 'string') failures.push(result)
    else imported.push(result)
  }

  refreshMeshMenus()
  if (imported.length === 0) {
    showMessages(failures, [])
    return
  }

  const created: number[] = []
  for (const [i, asset] of imported.entries()) {
    if (i === 0 && target) {
      // Assign in place, like the desktop: the node keeps its position,
      // scale, colour and children, and only its shape changes.
      target.geometry = Geometry.Mesh
      target.meshId = asset.id
      continue
    }
    const node = createRootNode(currentNodes, { ...MESH_NODE_DEFAULTS, meshId: asset.id })
    currentNodes.push(node)
    created.push(node.id)
  }

  rebuildScene(false)
  if (created.length > 0) setSelection(new Set(created))
  const names = imported.map((a) => `'${a.name}' (id ${a.id})`).join(', ')
  const triangles = imported.reduce((sum, a) => sum + a.triangles, 0)
  // Files really do carry NaN facets (a VTK-written isosurface in Jeff's
  // examples folder has 6,929), and dropping them silently — which is what the
  // desktop's trimesh does — reads as the model being incomplete.
  const dropped = imported.reduce((sum, a) => sum + a.dropped, 0)
  const droppedNote =
    dropped > 0 ? ` ${dropped.toLocaleString()} triangle(s) with NaN coordinates were skipped.` : ''
  status(
    (target
      ? `Assigned mesh ${names} to node ${target.id}. ${triangles.toLocaleString()} triangle(s).` +
        (created.length > 0 ? ` ${created.length} further model(s) added as new objects.` : '')
      : `Imported mesh ${names} as ${created.length} new object(s), ` +
        `${triangles.toLocaleString()} triangle(s).`) + droppedNote,
  )
  if (failures.length > 0) showMessages(failures, [])
}

function importMeshFilesSafely(files: Array<{ file: File; source: string }>): void {
  void importMeshFiles(files).catch((err: unknown) =>
    showMessages([`Could not import the model(s): ${String(err)}`], []),
  )
}

importMeshInput.addEventListener('change', () => {
  const files = [...(importMeshInput.files ?? [])].map((file) => ({ file, source: file.name }))
  importMeshInput.value = ''
  importMeshFilesSafely(files)
})

// --- ANTz attribute cycling (J = topology, O = geometry) ------------------------
// Desktop parity — the rules live in src/gv/attrCycle.ts. The step applies PER
// NODE, so a selection holding two different topologies keeps holding two
// different topologies; Shift reverses the direction.

function cycleAttribute(kind: 'geometry' | 'topo', step: number) {
  const targets = cycleTargets(selectedNodes())
  if (targets.length === 0) return status('No selection to cycle.')
  const isGeometry = kind === 'geometry'
  if (isGeometry) cycleGeometry(targets, step)
  else cycleTopology(targets, step)
  // The desktop's _after_attr_cycle tail — refresh the table rows, the
  // Select-By value combo and the inspector's now-stale combos — is one
  // rebuild here, which does all three and redraws the changed glyphs.
  rebuildScene(false)
  const label = isGeometry ? 'Geometry' : 'Topology'
  if (targets.length === 1) {
    const node = targets[0]
    const id = isGeometry ? node.geometry : node.topo
    status(`${label} → ${id}: ${(isGeometry ? GEOMETRY_NAMES : TOPO_NAMES)[id] ?? id}`)
  } else {
    const sign = step > 0 ? '+1' : '−1'
    status(`Cycled ${label.toLowerCase()} ${sign} on ${targets.length} node(s).`)
  }
  // Overrides the message above when it applies — a subtree that just vanished
  // off screen is more urgent news than which id we landed on (which the
  // inspector shows anyway).
  if (!isGeometry) hintScatteredChildren(targets)
}

/**
 * After a topology change, say something if the change just flung the children
 * off into the distance — and name the field that reels them back in (desktop
 * `_hint_scattered_children`).
 *
 * Only fires on a parent still at the neutral topo_scale: a deliberately tuned
 * value is not a mistake.
 */
function hintScatteredChildren(nodes: readonly GvNode[]): void {
  const candidates = nodes.filter((n) => n.topoScale === DEFAULT_TOPO_SCALE)
  if (candidates.length === 0 || !currentFrames) return
  const { ratio, parentId } = worstChildPlacementRatio(
    currentNodes,
    currentFrames,
    candidates.map((n) => n.id),
  )
  if (ratio < TOPO_SCALE_HINT_RATIO) return
  status(
    `Node ${parentId}: children are now ${ratio.toFixed(0)}x its own radius away — ` +
      `lower its Topo Scale (try the ANTz preset, ${TOPO_SCALE_ANTZ.toFixed(4)}) to bring ` +
      'them back in.',
  )
}

// --- Palette cycling (= / − step the index, Alt+= / Alt+− the palette) ----------
// Desktop _cycle_selected_color_index / _cycle_selected_palette, on the same
// `cycleTargets` subset as J/O. Both resolve the palette entry straight into
// color_r/g/b — the palette is metadata that never renders on its own, so a
// keypress is the only thing that ever repaints from it.

function cyclePaletteAttribute(kind: 'index' | 'palette', step: number) {
  const targets = cycleTargets(selectedNodes())
  if (targets.length === 0) return status('No selection to cycle.')
  if (kind === 'index') cycleColorIndex(targets, step)
  else cyclePalette(targets, step)
  rebuildScene(false) // repaints the glyphs, the table rows and the inspector
  if (targets.length === 1) {
    const node = targets[0]
    status(
      kind === 'index'
        ? `Color index → ${node.colorIndex}`
        : `Palette → ${PALETTE_NAMES[node.paletteId] ?? node.paletteId}`,
    )
  } else {
    const sign = step > 0 ? '+1' : '−1'
    const label = kind === 'index' ? 'color index' : 'palette'
    status(`Cycled ${label} ${sign} on ${targets.length} node(s).`)
  }
}

// --- Draw limit (\ halves, Shift+\ doubles) -------------------------------------
// Desktop _adjust_draw_limit. The arithmetic and the status wording are its own,
// so a readout here compares directly with one read on the desktop; what differs
// is that the cut is applied by rebuilding the scene graph rather than by
// breaking out of a draw loop — see src/render/drawLimit.ts for why a
// render-time `visible = false` would not have paid off.

function adjustDrawLimit(factor: number) {
  const total = drawLimitTotal(currentNodes, { showHidden })
  if (total === 0) return status('Nothing to decimate.')
  const next = nextDrawLimit(drawLimit, total, factor)
  if (next === drawLimit) {
    // Already at 1, or already showing everything.
    return status(
      drawLimit === null
        ? `All ${total} nodes visible  (\\ to halve)`
        : `Draw limit: ${drawLimit} / ${total} nodes  (Shift+\\ to double)`,
    )
  }
  drawLimit = next
  rebuildScene(false)
  status(
    drawLimit === null
      ? `All ${total} nodes visible  (\\ halve · Shift+\\ double)`
      : `Draw limit: ${drawLimit} / ${total} nodes  (\\ halve · Shift+\\ double)`,
  )
}

// --- Scene background (B / the Background row) ----------------------------------
// The background IS the World row's color (node.py), so changing it edits a
// real CSV field that saves and round-trips — and a scene with no World row
// gets one synthesized, the desktop's _ensure_world_node rule.

function hexOfRgb(rgb: { r: number; g: number; b: number }): string {
  const channel = (c: number) =>
    Math.round(Math.min(255, Math.max(0, c)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

/** Point the colour input at the scene's current background. */
function syncBackgroundInput() {
  bgColorInput.value = hexOfRgb(backgroundRgb(currentNodes))
}

function setBackground(r: number, g: number, b: number) {
  const hadWorldRow = worldNodeOf(currentNodes) !== null
  const world = ensureWorldNode(currentNodes)
  world.color.r = r
  world.color.g = g
  world.color.b = b
  syncBackgroundInput()
  if (!hadWorldRow) {
    // A row that did not exist a moment ago has to reach nodesById and the
    // Node Table, which only a rebuild does.
    rebuildScene(false)
    return
  }
  // Otherwise this is one uniform: repaint without rebuilding the graph, so
  // dragging the colour picker stays smooth on a 200k-node scene.
  scene.background = new THREE.Color(r / 255, g / 255, b / 255)
  applySceneFog(scene, world) // fog fades to the background, so it follows
  nodeTable.refreshVisible() // the World row's colour cell
}

// --- Tag text styling (the Labels group) ---------------------------------------
// Like the background above, these ARE World-row fields (tag_color_mode /
// tag_color_r/g/b), so they save and round-trip rather than living as a viewer
// preference — and a scene with no World row gets one synthesized here too.

/** Mirror the scene's tag styling into the panel and the per-frame cache. */
function syncTagStyle() {
  tagStyle = tagTextStyle(currentNodes)
  selectionPanel.setTagStyle(tagStyle.mode, tagStyle.rgb)
}

function writeTagStyle(mutate: (world: GvNode) => void) {
  const hadWorldRow = worldNodeOf(currentNodes) !== null
  mutate(ensureWorldNode(currentNodes))
  syncTagStyle()
  // Only labels read these, and the overlay repaints every frame from the
  // cache above — so unlike a geometry edit, nothing needs rebuilding. A row
  // that did not exist a moment ago does, to reach nodesById and the table.
  if (!hadWorldRow) rebuildScene(false)
}

function toggleBackgroundBw() {
  const value = toggledBwBackground(backgroundRgb(currentNodes))
  setBackground(value, value, value)
  status(value === 0 ? 'Background black.' : 'Background white.')
}

bgColorInput.addEventListener('input', () => {
  const hex = bgColorInput.value
  setBackground(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  )
})
bgBwButton.addEventListener('click', toggleBackgroundBw)

// --- Backdrop: Show Grid / Show Axes / Grid Color -------------------------------
// The two checkboxes are the desktop Display group's (Viewport.show_grid /
// show_axes) — viewer preferences, nothing written to the CSV. The colour is
// scene data like the background: it IS the World row's ref_grid_color, so it
// saves and round-trips, and a scene without a World row gets one synthesized.

function syncGridColorInput() {
  const rgb = refGridRgb(currentNodes)
  gridColorInput.value = hexOfRgb(rgb)
  backdrop.setGridColor(rgb)
}

showGridCheckbox.addEventListener('change', () => {
  backdrop.showGrid = showGridCheckbox.checked
  status(showGridCheckbox.checked ? 'Reference grid on.' : 'Reference grid off.')
})

showAxesCheckbox.addEventListener('change', () => {
  backdrop.showAxes = showAxesCheckbox.checked
  status(showAxesCheckbox.checked ? 'Origin axes on.' : 'Origin axes off.')
})

gridColorInput.addEventListener('input', () => {
  const hadWorldRow = worldNodeOf(currentNodes) !== null
  const hex = gridColorInput.value
  const world = ensureWorldNode(currentNodes)
  world.refGridColor = {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
  // Only the backdrop reads this, so a change is one material colour — no
  // rebuild, which keeps dragging the picker smooth. A row that did not exist a
  // moment ago still needs one, to reach nodesById and the Node Table. (No
  // table cell shows this field, so nothing else to repaint.)
  syncGridColorInput()
  if (!hadWorldRow) rebuildScene(false)
})

// --- Render modes (8 / the Render Mode row) -------------------------------------
// The World row's render_mode: a scene-wide blend state, real CSV data that
// saves and round-trips. The blend-state port lives in src/render/renderMode.ts;
// 8 steps to the next mode, the desktop's _on_scene_render_mode_cycle.

for (const mode of Object.keys(RENDER_MODE_NAMES).map(Number).sort((a, b) => a - b)) {
  renderModeSelect.appendChild(
    Object.assign(document.createElement('option'), {
      value: String(mode),
      textContent: RENDER_MODE_NAMES[mode],
    }),
  )
}

/** Point the combo at the scene's mode and push it onto the live materials. */
function syncRenderMode() {
  const mode = worldNodeOf(currentNodes)?.renderMode ?? RenderMode.Normal
  appliedWorldRenderMode = mode // the animated path skips frames that keep it
  renderModeSelect.value = String(mode)
  if (currentRoot) applyRenderMode(currentRoot, mode)
  applyRenderMode(backdrop.group, mode)
}

function setRenderMode(mode: number) {
  const hadWorldRow = worldNodeOf(currentNodes) !== null
  ensureWorldNode(currentNodes).renderMode = mode
  // Blend state is per material, so switching modes is a walk over the ones
  // already built — never a rebuild. Only a synthesized World row needs one.
  syncRenderMode()
  if (!hadWorldRow) rebuildScene(false)
  status(`Render mode → ${mode}: ${RENDER_MODE_NAMES[mode] ?? mode}`)
}

function cycleRenderMode() {
  const mode = worldNodeOf(currentNodes)?.renderMode ?? RenderMode.Normal
  setRenderMode((mode + 1) % RENDER_MODE_COUNT)
}

renderModeSelect.addEventListener('change', () => setRenderMode(Number(renderModeSelect.value)))

// --- Fog (Enable Fog / Fog Start/End) -------------------------------------------
// The World row's fog_enabled / fog_start / fog_end — scene data like the
// background, which is also the fog's colour (the desktop passes the World
// row's own color_r/g/b to GL_FOG_COLOR, so the far distance dissolves into
// the backdrop). Rendering lives in src/render/fog.ts; a scene with no World
// row gets one synthesized on first change, the ensureWorldNode rule.

/** Mirror the scene's fog state into the panel row and onto scene.fog. */
function syncFogInputs() {
  const world = worldNodeOf(currentNodes)
  const on = (world?.fogEnabled ?? 0) !== 0
  fogCheckbox.checked = on
  // A zero distance displays as the UI default (desktop _refresh_scene_settings:
  // `world.fog_start if world.fog_start else 20.0`) — 0-to-0 fog is a scene
  // dissolved entirely into its background, never what a fresh toggle wants.
  fogStartInput.value = String(world?.fogStart || 20)
  fogEndInput.value = String(world?.fogEnd || 200)
  fogStartInput.disabled = !on
  fogEndInput.disabled = !on
  applySceneFog(scene, world)
}

fogCheckbox.addEventListener('change', () => {
  const hadWorldRow = worldNodeOf(currentNodes) !== null
  const world = ensureWorldNode(currentNodes)
  world.fogEnabled = fogCheckbox.checked ? 1 : 0
  // Divergence, deliberate: the desktop's toggle leaves fog_start/fog_end
  // alone, so enabling fog on a fresh scene runs it at the row's 0/0 while the
  // spinboxes display 20/200 — the whole scene dissolves into the background.
  // Here the displayed values are written with the flag, so what the row says
  // is what the toggle showed. A loaded scene's own distances round-trip
  // unchanged, because the inputs were synced from them.
  world.fogStart = Number(fogStartInput.value) || 0
  world.fogEnd = Number(fogEndInput.value) || 0
  syncFogInputs()
  if (!hadWorldRow) rebuildScene(false)
  status(fogCheckbox.checked ? 'Fog on.' : 'Fog off.')
})

for (const input of [fogStartInput, fogEndInput]) {
  input.addEventListener('change', () => {
    const hadWorldRow = worldNodeOf(currentNodes) !== null
    const world = ensureWorldNode(currentNodes)
    world.fogStart = Number(fogStartInput.value) || 0
    world.fogEnd = Number(fogEndInput.value) || 0
    // Fog is three uniforms, never a rebuild — only a synthesized row needs
    // one, to reach nodesById and the Node Table.
    applySceneFog(scene, world)
    if (!hadWorldRow) rebuildScene(false)
  })
}

// --- Follow Selected (F) --------------------------------------------------------
// Desktop View ▸ Follow Selected Node: the orbit pivot re-centres on the
// followed node every frame, so the camera jumps as the selection moves from
// node to node AND tracks one that is animating under Channels or a rate field.

let followSelected = false
const followDelta = new THREE.Vector3()

/** The node the camera follows: the first selected VISUAL node in row order
 *  (desktop follow_node — World/Camera rows are settings, not places). */
function followNode(): GvNode | null {
  for (const node of selectedNodes()) {
    if (node.type !== NodeType.World && node.type !== NodeType.Camera) return node
  }
  return null
}

function applyFollowTarget() {
  if (!followSelected) return
  // Suspended mid-gizmo-drag, the same reason the rate integrator is: both
  // would be moving the node at once. TransformControls projects the pointer
  // onto a world-space plane, so a camera chasing the node it is dragging
  // feeds back into the drag and runs away. The desktop drags from screen-space
  // deltas and doesn't have that coupling, so it can follow throughout.
  if (gizmo.dragging) return
  const node = followNode()
  if (!node) return
  const pos = worldPosOf(node.id)
  if (!pos) return
  // Move the pivot AND the camera by the same delta, leaving distance, azimuth
  // and elevation alone — the desktop only re-centres _cam_target and keeps its
  // spherical camera parameters, so orbit and zoom stay live while following.
  // Panning is overridden as a consequence: the pivot snaps back next frame.
  followDelta.copy(pos).sub(controls.target)
  if (followDelta.lengthSq() === 0) return
  controls.target.add(followDelta)
  camera.position.add(followDelta)
  // Following re-centres every frame from the node's own animation, so
  // smoothing it would fight the source rather than a hand tremor — and would
  // leave the camera permanently trailing a moving node (desktop
  // _apply_follow_target). A glide in progress is landed by the same rule.
  snapCameraGoal()
}

function setFollowSelected(value: boolean) {
  // Follow pins the pivot to a node every frame; flight translates it every
  // frame. Entering Camera Mode clears Follow (desktop set_fly_mode), so
  // turning Follow on mid-flight takes the same interlock in reverse —
  // rather than the desktop's accident of letting the two fight per frame.
  if (value && flyRig.flyMode) setCameraMode(false)
  followSelected = value
  followCheckbox.checked = value
  if (!value) return status('Follow off.')
  const node = followNode()
  applyFollowTarget() // jump now rather than on the next animation frame
  status(node ? `Following node ${node.id}.` : 'Follow on — select a node to follow.')
}

followCheckbox.addEventListener('change', () => setFollowSelected(followCheckbox.checked))

// --- Boot ---------------------------------------------------------------------

{
  // ?csv=<url> fetches a gv_node.csv (same-origin or CORS-permitting);
  // ?scene=<substring> deep-links a built-in scene (case-insensitive).
  const params = new URLSearchParams(location.search)
  const csvUrl = params.get('csv')
  const wanted = params.get('scene')?.toLowerCase()
  const match = wanted
    ? Object.keys(BUILT_IN_SCENES).find((name) => name.toLowerCase().includes(wanted))
    : undefined
  if (match) exampleSelect.value = match
  loadBuiltIn(exampleSelect.value)
  if (csvUrl) {
    const filename = csvUrl.split('/').pop() || 'scene_gv_node.csv'
    // The companion tag file lives next to the node CSV on disk, so try the
    // derived sibling URL too — one speculative GET, and a 404 just means the
    // scene has no labels (or keeps them inline).
    const base = csvUrl.slice(0, csvUrl.length - filename.length)
    const tagName = deriveTagFilename(filename)
    const tagUrl = tagName ? base + tagName : null
    const fetchText = (url: string) =>
      fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    const optional = (url: string | null) =>
      url ? fetchText(url).catch(() => undefined) : Promise.resolve(undefined)

    // Channels companions are discovered by scanning the scene FOLDER, which a
    // URL load has no way to do — so guess the conventional sibling names
    // (`…_gv_ch-map.csv` / `…_gv_ch-tracks.csv`) the same way the tag file is
    // guessed. A 404 just means this scene has no Channels.
    const channelNames = deriveChannelFilenames(filename)

    Promise.all([
      fetchText(csvUrl),
      optional(tagUrl),
      optional(channelNames ? base + channelNames.map : null),
      optional(channelNames ? base + channelNames.tracks : null),
    ])
      .then(([nodeText, tagText, channelMapText, channelTracksText]) => {
        exampleSelect.value = OPENED_SCENE_OPTION
        loadScene({
          nodeText,
          tagText,
          channelMapText,
          channelTracksText,
          displayName: filename,
          filename,
        })
      })
      .catch((err: unknown) => showMessages([`Could not fetch ${csvUrl}: ${String(err)}`], []))
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  labels.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio)
  applyLineResolution()
})

renderer.setAnimationLoop(() => {
  // Elapsed real time drives both clocks. Capped so a backgrounded tab (whose
  // animation loop stops) does not resume by integrating a minute of rates in
  // one step; the desktop's timer has the same effect by simply not firing.
  const now = performance.now()
  const dtMs = lastTickMs === 0 ? 0 : Math.min(now - lastTickMs, 250)
  lastTickMs = now
  // A channel frame or a gizmo drag rewrites node fields without a rebuild, so
  // the table's visible rows have to be repainted from them. Only the ~30 rows
  // on screen are touched, and nothing at all while the panel is collapsed.
  const nodesMoved = tickAnimation(dtMs) || gizmo.dragging
  if (nodesMoved) nodeTable.refreshVisible()

  // Immersive mode drives the camera from the headset, so every desktop camera
  // path stands aside for it — following would fight the rig for the same
  // position, and OrbitControls has no pointer to read.
  const presenting = xrRig.presenting
  if (presenting) {
    xrRig.update(dtMs)
  } else {
    // After the animation tick, like the desktop's paintGL: the followed node
    // has already moved this frame, so the pivot lands on where it actually is.
    applyFollowTarget()
    // Camera Mode: integrate the held-offset rate flight on the same dt the
    // rate fields use — that is what keeps flying while the mouse sits still —
    // and push the rig into the camera OrbitControls is standing aside from.
    if (flyRig.flyMode) {
      flyRig.applyFlyDrag(dtMs)
      applyRigToCamera()
    }
    controls.update()
    // After every source that could have moved the goal (OrbitControls' own
    // gestures land inside the update above, the manual combo drag as it
    // happens, follow and flight just before), and before anything below reads
    // the camera — the desktop calls this at the same point in paintGL.
    applyCameraSmoothing(dtMs)
  }
  // The key light lives in eye space on the desktop, so it follows the camera
  // the controls just moved. Both stereo eyes share that camera's orientation,
  // so one aim serves both — the light is directional and a lateral shift of
  // the eye does not turn it.
  // In a session the app camera's own transform is the head pose in XR space,
  // so anything that aims off the camera reads the rig's world-space proxy
  // instead — the key light lives in eye space (lighting.ts) and would
  // otherwise be aimed by a pose measured in the wrong coordinate system.
  const distance = presenting ? xrRig.viewDistance : orbitDistance()
  lighting.update(presenting ? xrRig.headProxy : camera)
  backdrop.update(distance)
  // Edges, plot lines and surface meshes chase the nodes they connect (gizmo
  // drags mutate frames between rebuilds), so refresh them every frame like
  // the desktop's redraw.
  currentLinks?.update()
  currentOverlays?.update()
  // Selection halos are world-space geometry for the same batching reason, so
  // they follow the same rule: rewritten only while something is moving, from
  // the last pass's matrices. Every other way a node moves (an inspector edit,
  // a drag release) ends in a rebuildScene, whose setSelection rewrites them.
  if (nodesMoved) selection.refreshHalos()

  const labelState = {
    showTags,
    selectedOnly: tagsSelectedOnly,
    showHidden,
    isSelected: (id: number) => selection.has(id),
    pinned: animatedPinnedTags ?? pinnedTags,
    tagColorMode: tagStyle.mode,
    tagColor: tagStyle.rgb,
  }
  // Labels are painted after each render pass, so the world matrices they
  // project are the ones just drawn (gizmo drags move frames between rebuilds).
  const eyes = presenting ? null : stereo.eyes(window.innerWidth, distance)
  renderer.info.reset()
  if (presenting) {
    // One render call draws both eyes — three walks the session's views itself.
    // The tag overlay is skipped (a DOM canvas the headset never sees) and the
    // selected node's label goes into the scene as a billboard instead.
    updateXrLabel()
    updateXrPanel()
    renderer.render(scene, camera)
  } else if (eyes) {
    const height = window.innerHeight
    // Scissor per half so each pass clears only its own side of the canvas —
    // WebGL's clear obeys the scissor box, which is what lets the two eyes
    // share one buffer without a full-frame clear wiping the first.
    renderer.setScissorTest(true)
    if (currentFrames) labels.clear()
    for (const index of [0, 1] as const) {
      const eye = eyes[index]
      const eyeCamera = stereo.camera(camera, eye, height, distance, index)
      renderer.setViewport(eye.x, 0, eye.width, height)
      renderer.setScissor(eye.x, 0, eye.width, height)
      renderer.render(scene, eyeCamera)
      if (currentFrames) {
        labels.paint(currentNodes, currentFrames, eyeCamera, labelState, {
          x: eye.x,
          y: 0,
          width: eye.width,
          height,
        })
      }
    }
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, window.innerWidth, height)
  } else {
    renderer.render(scene, camera)
    if (currentFrames) labels.render(currentNodes, currentFrames, camera, labelState)
  }
  // Still inside the frame that drew them, which is the only place the WebGL
  // drawing buffer can be read back — and after the label pass, so the image
  // holds the labels that are on screen. In stereo both halves are already in
  // the one buffer, so the pair saves as it appears.
  if (pngRequested) captureScreenshot()

  // Bracket the whole loop, and read the counters after the render call so
  // they describe the frame just drawn.
  fpsMeter.frame(now, performance.now(), renderer.info.render)

  // Each tool window's preview is a second renderer on its own canvas, driven
  // from this same clock rather than a second animation loop — a closed window
  // costs one boolean test, and a preview's rate motion runs off the same dt
  // the scene's rates do. Deliberately outside the fps bracket above: that
  // readout is about the scene, and the desktop's counter measures its main
  // viewport only.
  hyperglyphWindow.renderFrame(dtMs)
  composerWindow.renderFrame(dtMs)
})
