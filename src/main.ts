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
import { columnsPerRow, DEFAULT_PLACEMENT, PLACEMENT_WRAP } from './gv/placement'
import type { PlacementSettings } from './gv/placement'
import { generateNodes, recipeFromJson } from './gv/glyphRecipe'
import type { GlyphRecipe } from './gv/glyphRecipe'
import { buildHyperglyphNodes } from './gv/hyperglyph'
import {
  buildChannels,
  buildEpicycleNodes,
  frameCount as epicycleFrameCount,
  slug as epicycleSlug,
  writeChMapCsv,
  writeChTracksCsv,
} from './gv/epicycles'
import type { EpicycleDesign } from './gv/epicycles'
import { applyDragDelta, MIN_DRAG_SCALE, snapshotTransform, uniformScaleFactor } from './gv/multiEdit'
import type { DragMode, DragSnapshot } from './gv/multiEdit'
import { findScenes, normalizePath, resolveRelative } from './gv/bundle'
import type { SceneCandidate } from './gv/bundle'
import {
  applyChannelFrame,
  bindChannels,
  channelAttributes,
  deriveChannelFilenames,
  emptyChannelAnimation,
  parseGvChMap,
  parseGvChTracks,
  resetChannels,
} from './gv/channels'
import type { ChannelAnimation, ChMapParseResult, ChTracksParseResult } from './gv/channels'
import { channelBindingMessage } from './ui/channelIn'
import { applyRateAnimation, rateCandidates, restoreRates, snapshotAndZeroRates } from './gv/rates'
import type { RateSnapshot } from './gv/rates'
import { buildMediaIndex } from './gv/media'
import type { MediaIndex } from './gv/media'
import {
  isDesktopOnlyMeshFileName,
  isMeshFileName,
  MESH_EXTENSIONS,
  parseMeshFile,
} from './gv/meshFile'
import type { MeshData } from './gv/meshFile'
import { parseGvNodeCsv, REQUIRED_COLUMNS } from './gv/nodeCsv'
import { channelIdsForNodes, exportChannelSubset } from './gv/channelExport'
import { buildSelection, selectionExportNames } from './gv/selectionExport'
import type { ExportOptions, SelectionExport } from './gv/selectionExport'
import { applyTags, deriveTagFilename, parseGvTagCsv } from './gv/tagCsv'
import { hasAnyLabel, writeGvTagCsv } from './gv/writeTagCsv'
import { expandZips, filesFromDataTransfer, filesFromInput } from './io/browserFiles'
import type { PathedFile } from './io/browserFiles'
import { ChannelAudio, parseAudioManifest } from './io/channelAudio'
import {
  bulkSelectableNodes,
  CRITERION_LABELS,
  criterionValues,
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
  clampTagFontSize,
  ensureWorldNode,
  refGridRgb,
  tagTextStyle,
  tagTextStyleOf,
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
  applyGlyphDrawScale,
  buildScene,
  effectiveParent,
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
import {
  LabelOverlay,
  pinnedTagNodes,
  taggableNodes as labelTaggableNodes,
} from './render/labelOverlay'
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
import { setPointSpriteScale } from './render/pointSprite'
import { TOPO_SCALE_HINT_RATIO, renderedRadius, worstChildPlacementRatio } from './render/scatterHint'
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
import {
  SNAP_ANGLES,
  TURN_MODES,
  TURN_MODE_LABELS,
  VIGNETTE_LABELS,
  VIGNETTE_LEVELS,
  cycleSnapDegrees,
  cycleTurnMode,
  cycleVignette,
  defaultComfort,
} from './render/xrComfort'
import type { ComfortSettings, TurnMode, VignetteLevel } from './render/xrComfort'
import { XrLabel } from './render/xrLabel'
import { XrPanel } from './render/xrPanel'
import {
  PINNED_DISTANCE_M,
  PINNED_DROP_M,
  PINNED_SCALE,
  XrProperties,
} from './render/xrProperties'
import { DRAW_SPACING_DEFAULT, GRAB_MODES } from './ui/xrPropertiesModel'
import type { XrDrawData, XrGrabMode, XrPropSelectData } from './ui/xrPropertiesModel'
import type { XrPointerHit } from './render/xrPointer'
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
import { worldPlacements } from './render/selectionPlacement'
import { parentTopoScale } from './render/topology'
import { invertTopoOffset, pickDominantField } from './render/topologyInverse'
import {
  isPointCloudFileName,
  SUPPORTED_EXTENSIONS as POINT_CLOUD_EXTENSIONS,
} from './gv/pointCloudLoader'
import { BasemapWindow } from './ui/basemapWindow'
import type { BasemapApplyPayload } from './ui/basemapWindow'
import { ChannelsPanel, DEFAULT_CHANNEL_FPS } from './ui/channelsPanel'
import { EpicycleWindow } from './ui/epicycleWindow'
import { FpsMeter } from './ui/fpsMeter'
import { GlyphComposerWindow } from './ui/glyphComposerWindow'
import { HyperglyphWindow } from './ui/hyperglyphWindow'
import { PointCloudWindow } from './ui/pointCloudWindow'
import type { PointCloudApplyPayload } from './ui/pointCloudWindow'
import { Inspector } from './ui/inspector'
import { NodeTable } from './ui/nodeTable'
import { PANEL_MODE_EVENT, Panel } from './ui/panel'
import type { PanelModeChangeDetail } from './ui/panel'
import { SaveSelectionWindow } from './ui/saveSelectionWindow'
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

// What the app boots into: a world with nothing in it, so the first thing on
// screen is the user's own scene rather than an example they have to clear.
// It is an ordinary CSV load — a header row and no data rows, which parses
// cleanly to zero nodes — so every one of loadScene's resets (draw limit,
// textures, channels, the tool windows) happens exactly as it does for a file,
// and N or Import lands the first node in a scene that is already consistent.
const EMPTY_SCENE_OPTION = 'Empty world'
const EMPTY_SCENE_CSV = `${REQUIRED_COLUMNS.join(',')}\n`

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
// GL point sizes are in DEVICE pixels, so the ratio the renderer draws at is
// what turns `ratio × 20` into the number of pixels the desktop means by it
// (render/pointSprite.ts). Both the single-Point glyph and every point cloud
// read it.
setPointSpriteScale(window.devicePixelRatio)
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
  onPick(raycaster, _hand, pose, additive) {
    if (!currentRoot) return false
    // Draw Mode claims the trigger, exactly as it claims the left button with a
    // mouse: plain click-select is what a stroke replaces. The add-select
    // modifier still selects, which is the documented way to grab a bad stroke
    // and delete it — the desktop's "Ctrl+click still works" rule, in the one
    // chord this app has for Ctrl.
    if (drawMode && !additive) {
      if (beginXrStroke(raycaster)) return true
      // Nothing under the ray to draw on: fall through to an ordinary pick, so
      // aiming past the grid still selects rather than doing nothing at all.
    }
    const nodeId = pickNodeId(raycaster, currentRoot)
    // The right thumbstick click held is this app's Ctrl: the press TOGGLES
    // membership and never grabs, because the gesture is about the selection
    // rather than about moving what is in it. A miss is ignored rather than
    // clearing, exactly as Ctrl+click on empty space does with the mouse.
    if (additive) {
      if (nodeId === null) {
        status('Nothing under the ray — add-select left the selection alone.')
        return false
      }
      toggleXrSelection(nodeId)
      return false
    }
    // Trigger on an ALREADY-selected glyph claims the press as a grab; the
    // selection is left alone, so a multi-selection can be dragged as a group.
    // If the hand never travels far enough the release falls back to an
    // ordinary click (beginXrGrab's own threshold), so nothing is lost.
    if (nodeId !== null && selection.ids.includes(nodeId) && beginXrGrab(raycaster, nodeId, pose))
      return true
    // A ray that hits nothing clears the selection, exactly as a click on
    // empty space does with the mouse.
    setSelection(nodeId)
    status(nodeId === null ? 'Nothing under the ray.' : `Selected node ${nodeId}.`)
    return false
  },
  onDragRay(raycaster, _hand, pose) {
    if (xrStroke) return xrStrokeMove(raycaster)
    xrGrabMove(raycaster, pose)
  },
  onDragEnd(_hand, cancelled) {
    if (xrStroke) return endXrStroke()
    endXrGrab(cancelled)
  },
  /**
   * What the ray is aiming AT in the scene, for the pointer's cursor. Only
   * Draw Mode answers: a continuous raycast per hand per frame is affordable
   * against one grid plane (it is a matrix inverse, not a scene traversal) and
   * would not be against Event_Cloud's 209k glyphs.
   */
  aimHit(raycaster) {
    return drawMode ? xrDrawCursorHit(raycaster) : null
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
  onGoTo() {
    goToSelection()
  },
  onSecondary() {
    setPlaying(!playing)
  },
  onTogglePanel() {
    xrPanel.visible = !xrPanel.visible
    status(
      xrPanel.visible ? 'Control panel shown.' : 'Control panel hidden — press X to bring it back.',
    )
  },
  onToggleProperties() {
    xrProperties.visible = !xrProperties.visible
    status(
      xrProperties.visible
        ? 'Properties panel shown.'
        : 'Properties panel hidden — press A to bring it back.',
    )
  },
  grabModeLabel() {
    // The Properties panel owns the armed mode; the controller just wears it,
    // so a grab's meaning is readable without raising the panel to check.
    return GRAB_MODES.find((m) => m.mode === xrProperties.grabMode)?.label ?? 'Move'
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
        '(both hands to resize), trigger: select, X: control panel, A: properties ' +
        'panel, B/Y: play Channels.',
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
    // A slab parked in the last session's rig space would be waiting in mid-air
    // at the start of the next one; the wrist is where the panel belongs by
    // default.
    xrProperties.unpin()
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
  fitSelection() {
    const target = selectionFocusTarget()
    if (!target) return status('Nothing selected to frame.')
    xrRig.requestFit(XR_FIT_SELECTION_METRES, target)
    status(`Framed ${selection.size} selected node${selection.size === 1 ? '' : 's'}.`)
  },
})
xrRig.panelAnchor.add(xrPanel.group)

// The right wrist's PROPERTIES panel — the DOM inspector re-expressed for a
// headset (ui/xrPropertiesModel.ts says what survived the trip and why).
//
// Every action routes through the SAME functions the DOM panels use, so the two
// inspectors cannot drift: the shape steppers are `cycleAttribute`'s own rules,
// the palette pair is `cyclePaletteAttribute`'s, and a commit is the inspector
// host's `rebuildScene(false)`.
const xrProperties = new XrProperties({
  stepTopo: (step) => xrCycle('topo', step),
  stepGeometry: (step) => xrCycle('geometry', step),
  stepPalette: (step) => xrCyclePalette('palette', step),
  stepColorIndex: (step) => xrCyclePalette('index', step),
  stepFacet: (step) =>
    xrEditSelection((n) => {
      // 0-based in the data, 1..6 everywhere a person reads it — and it wraps,
      // like every other cycle in this app rather than clamping at the ends.
      n.subspace = (((n.subspace + step) % 6) + 6) % 6
    }),
  stepTexture: (step) =>
    xrEditSelection((n) => {
      n.textureId = Math.max(0, n.textureId + step)
    }),
  nudgeRatio: (delta) => xrEditSelection((n) => (n.ratio = round6(n.ratio + delta))),
  nudgeAlpha: (delta) =>
    xrEditSelection((n) => (n.color.a = Math.max(0, Math.min(255, Math.round(n.color.a + delta))))),
  nudgeVector: (field, axis, delta) =>
    // In place, not through a rebuild: a scrub rewrites this 90 times a second
    // and `rebuildScene` at Event_Cloud's scale is not a per-frame cost. This
    // is the gizmo drag's own path (applyFrameTransform + refreshHalos), and
    // the rebuild that re-cells overlays and repaints the table lands once, on
    // release, exactly as a mouse drag's does.
    xrNudgeVector(field, axis, delta),
  toggleHide: () => {
    const on = xrPrimaryNode()?.hide === 0
    xrEditSelection((n) => (n.hide = on ? 1 : 0))
  },
  toggleShowText: () => {
    const on = xrPrimaryNode()?.showText === 0
    xrEditSelection((n) => (n.showText = on ? 1 : 0))
  },
  commit: () => xrCommitEdit(),
  setPinned: (pinned) => setXrPropertiesPinned(pinned),

  // Select page — the desktop's Select By and Visibility groups, reached from
  // a wrist. Every rule is `gv/selectionOps.ts`'s, unchanged: these call the
  // same functions the DOM Selection panel's buttons do.
  selectMatching: (criterion, value, add) => {
    const matched = selectByCriterion(currentNodes, criterion, value)
    const ids = add ? new Set([...selection.ids, ...matched]) : matched
    setSelection(ids)
    const label = CRITERION_LABELS[criterion]
    status(
      matched.size === 0
        ? `No nodes with ${label} ${value}.`
        : `${add ? 'Added' : 'Selected'} ${matched.size} node(s) with ${label} ${value}.`,
    )
  },
  selectAll: () => {
    setSelection(selectAllIds(currentNodes))
    status(`Selected ${selection.size} node(s).`)
  },
  selectNone: () => {
    setSelection(null)
    status('Selection cleared.')
  },
  invertSelection: () => {
    setSelection(invertSelection(currentNodes, new Set(selection.ids)))
    status(`Inverted — ${selection.size} node(s) selected.`)
  },
  hideSelected: () => xrApplyVisibility(setHidden(currentNodes, new Set(selection.ids), true), 'Hid'),
  showAll: () => xrApplyVisibility(showAll(currentNodes), 'Showed'),
  isolateSelected: () =>
    xrApplyVisibility(isolateSelection(currentNodes, new Set(selection.ids)), 'Isolated,'),
  goToSelection: () => {
    goToSelection()
  },
  // The desk's own Follow Selected, reached from a wrist — same flag, same
  // status wording, so F, the HUD checkbox and this button are one control.
  setFollow: (follow) => setFollowSelected(follow),

  // Comfort page. The cycle rules are xrComfort's, so the wrist steppers and
  // the Scene panel's selects offer the same values and wrap the same way.
  stepTurnMode: (step) => setComfort({ ...comfort, turn: cycleTurnMode(comfort.turn, step) }),
  stepSnapAngle: (step) =>
    setComfort({ ...comfort, snapDegrees: cycleSnapDegrees(comfort.snapDegrees, step) }),
  stepVignette: (step) =>
    setComfort({ ...comfort, vignette: cycleVignette(comfort.vignette, step) }),

  // Draw page. `setDrawMode` is the SAME function the D key and the HUD button
  // call, so the mode is one mode however it was armed.
  toggleDraw: () => setDrawMode(!drawMode),
  stepBrush: (step) => {
    // The select's options are "Single Object" (value '') then one per loaded
    // brush, which is exactly the list the page steps through — so the DOM
    // control stays the single source of truth and no second index can drift.
    const options = drawStampSelect.options
    if (options.length < 2) return
    const n = options.length
    const next = (((drawStampSelect.selectedIndex + step) % n) + n) % n
    drawStampSelect.selectedIndex = next
    status(`Draw brush: ${options[next].textContent ?? 'Single Object'}.`)
  },
  nudgeDraw: (field, delta) => {
    if (field === 'spacing') {
      // VR-only, and in the grid's own units rather than the mouse panel's
      // pixels — the two measure different things and must not share an input.
      xrDrawSpacing = Math.max(0, round6(xrDrawSpacing + delta))
      return
    }
    const input =
      field === 'drawZ'
        ? drawZInput
        : field === 'headingJitter'
          ? drawHeadingJitterInput
          : drawScaleJitterInput
    const min = Number(input.min)
    const max = Number(input.max)
    const next = round6((Number(input.value) || 0) + delta)
    input.value = String(Math.min(max, Math.max(min, next)))
  },
})

/** A visibility command's tail: `hide` is CSV data, so it needs a rebuild, and
 *  the desktop reports the count it actually changed. */
function xrApplyVisibility(changed: number[], verb: string) {
  if (changed.length === 0) {
    status('Nothing to change.')
    return
  }
  rebuildScene(false)
  status(`${verb} ${changed.length} node(s).`)
}
xrRig.panelAnchorRight.add(xrProperties.group)
xrRig.setPointerTargets([xrPanel, xrProperties])

/**
 * Unclip the properties panel onto the floating slab, or clip it back.
 *
 * The slab is parked ONCE, at the moment it is pinned — in rig space, so it
 * stays where you left it as you look around and travels with you as you fly.
 * Re-pinning re-parks it, which is how you move it: dock, turn to face where
 * you want it, pin again.
 */
function setXrPropertiesPinned(pinned: boolean) {
  if (pinned) {
    xrRig.placeFloatAnchor(PINNED_DISTANCE_M, PINNED_DROP_M)
    xrRig.floatAnchor.add(xrProperties.group)
    xrProperties.setOffset(0, 0, 0)
    xrProperties.setScale(PINNED_SCALE)
    status('Properties panel unclipped — pin again to re-park it, dock to return it.')
  } else {
    xrRig.panelAnchorRight.add(xrProperties.group)
    xrProperties.setOffset(0, 0.09, -0.02)
    xrProperties.setScale(1)
    status('Properties panel docked to the right wrist.')
  }
}

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
    <button id="hud-save-selection" disabled title="Write the selected nodes (and, by default, their descendants) to a node CSV of their own  [Ctrl+Alt+S]&#10;A node whose parent is left behind keeps its world placement, so the saved fragment reopens looking exactly as it does here.&#10;The open scene is not changed.">Save Selection…</button>
  </div>
  <div id="hud-modes">
    <button data-mode="translate">Move (W)</button>
    <button data-mode="rotate">Rotate (E)</button>
    <button data-mode="scale">Scale (R)</button>
  </div>
  <div id="hud-create">
    <div class="hud-create-buttons">
      <button id="hud-new-node" title="New object using the defaults below, at the world origin.&#10;Each press steps X by the Placement Step, wrapping to a new Y row at 360, at the Placement Z (root) height.&#10;If a child-level node is selected, adds a child instead.">New Node (N)</button>
      <button id="hud-new-child" title="New child under the selected node.&#10;Siblings step along X by the Placement Step and wrap to a new Y row at 360, so a full lap around a Sphere/Torus parent starts a new ring instead of overlapping; Placement Z (child) sets how far each one stands off its parent." disabled>New Child (Shift+N)</button>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-new-grid" title="New World Grid at the world origin: the whole-earth window (lon −180…180, lat −90…90) at 1:1 world units.&#10;G selects and cycles grids; New Child, paste and Draw Mode add glyphs onto it.">New World Grid</button>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-copy" title="Copy the selected node and its whole descendant subtree.&#10;Exactly one node — a partial subtree is never copied." disabled>Copy (Ctrl+C)</button>
      <button id="hud-paste" title="Paste the copied subtree with fresh ids: as a child of the selected node, or as a new root object with nothing selected." disabled>Paste (Ctrl+V)</button>
    </div>
    <div class="hud-create-buttons">
      <label id="hud-import-mesh" class="hud-file-button" title="Import a 3D model (.obj / .stl / .ply) as a Mesh glyph.&#10;With one node selected the model is assigned to it; with nothing selected it becomes a new object.&#10;Models can also just be dropped on the window.">Import Mesh…<input type="file" accept=".obj,.stl,.ply" multiple></label>
      <label id="hud-import-cloud" class="hud-file-button" title="Import a LIDAR or scan file (.las / .laz / .ply / .xyz / .pts) as a Point Cloud.&#10;Opens a window reporting what is in the file — point count, extent, colour, classification — before anything is imported.&#10;The cloud is appended to the open scene; .las/.laz/.xyz/.pts can also just be dropped on the window.">Import Cloud…<input type="file" accept=".las,.laz,.ply,.xyz,.pts,.txt,.csv"></label>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-hyperglyph" title="Procedurally generate a randomized multi-level hyperglyph from a branch-level count and a node budget, preview it, and drop it into the scene.&#10;The same seed produces the same design in desktop GlyphViz.">Hyperglyph… (Ctrl+H)</button>
      <button id="hud-composer" title="Build a hierarchical glyph by hand, one branch level at a time — count, geometry, topology, placement, transform and colour — with a live preview.&#10;Templates are the same .json desktop GlyphViz reads and writes.">Composer… (Ctrl+G)</button>
    </div>
    <div class="hud-create-buttons">
      <button id="hud-epicycles" title="Design an epicycle chain — a Fourier series built from nested Torus-topology parents — and let the pen at the end draw its own path.&#10;One row per arm: Rate X is the harmonic, Length the amplitude, Phase X the starting angle, and Tilt or Tube take the figure out of the plane.&#10;Writes a complete scene (node + tag CSVs, plus the Channels pair for a self-drawing trail).">Epitrochoid… (Ctrl+Shift+E)</button>
    </div>
    <div class="hud-create-row"><span>Geometry</span><select id="hud-new-geo"></select></div>
    <div class="hud-create-row"><span>Topology</span><select id="hud-new-topo"></select></div>
    <div class="hud-create-row"><span>Scale</span><input id="hud-new-scale" type="number" min="0.001" step="0.1" value="1"></div>
    <div class="hud-create-row"><span>Color</span><input id="hud-new-color" type="color" value="#c8c8c8"></div>
    <div class="hud-create-row" id="hud-placement-step-row">
      <span>Placement Step</span>
      <input id="hud-placement-step" type="number" min="0" max="10000" step="1" value="5">
    </div>
    <div class="hud-create-row" title="translate_z given to a new object.&#10;Root: its height above the world plane — 0 sits on the plane.&#10;Child: what it means is the parent topology's business — on Sphere/Torus/Cylinder it lifts the child off the surface radially, on Cartesian parents it is a plain Z offset. The default 5 is what keeps the first child from sitting inside a topology-None parent; 0 places it exactly on the surface.">
      <span>Placement Z</span>
      <span class="hud-sublabel">root</span>
      <input id="hud-placement-root-z" type="number" min="-100000" max="100000" step="1" value="0" title="translate_z for a new ROOT-level object (N with nothing or a root selected, New Node, paste with no selection, an imported mesh).">
      <span class="hud-sublabel">child</span>
      <input id="hud-placement-child-z" type="number" min="-100000" max="100000" step="1" value="5" title="translate_z for a new CHILD (Shift+N, New Child, paste onto a selection).">
    </div>
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
    <label id="hud-follow" class="sel-check" title="Keep the camera centred on the selected node as it moves  [F]&#10;The pivot is re-pinned instantly (never smoothed); orbit and zoom stay live, panning is overridden.">
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
    <div class="hud-create-row" id="hud-xr-turn-row" hidden title="How the right thumbstick turns you in the headset.&#10;Smooth sweeps continuously — the single largest cause of VR sickness for most people.&#10;Snap jumps in fixed steps instead: an instantaneous turn gives the eyes no motion for the inner ear to disagree with.&#10;Also on the headset's own Comfort page, and never written to the CSV.">
      <span>VR turn</span>
      <select id="hud-xr-turn"></select>
      <select id="hud-xr-snap"></select>
    </div>
    <div class="hud-create-row" id="hud-xr-vignette-row" hidden title="Tunnel vision while moving in the headset: the view narrows to a soft circle whenever you fly, turn or drag the world, and opens again when you stop.&#10;Peripheral vision is what drives the false sense of self-motion, so hiding it during travel is what settles most people's stomachs.&#10;Light only bites at the far edge of the field; Strong closes to about half of it.">
      <span>VR tunnel</span>
      <select id="hud-xr-vignette"></select>
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
const saveSelectionButton = hud.querySelector<HTMLButtonElement>('#hud-save-selection')!
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
const placementStepRow = hud.querySelector<HTMLDivElement>('#hud-placement-step-row')!
const placementStepInput = hud.querySelector<HTMLInputElement>('#hud-placement-step')!
const placementRootZInput = hud.querySelector<HTMLInputElement>('#hud-placement-root-z')!
const placementChildZInput = hud.querySelector<HTMLInputElement>('#hud-placement-child-z')!
const importMeshInput = hud.querySelector<HTMLInputElement>('#hud-import-mesh input')!
const importCloudInput = hud.querySelector<HTMLInputElement>('#hud-import-cloud input')!
const hyperglyphButton = hud.querySelector<HTMLButtonElement>('#hud-hyperglyph')!
const composerButton = hud.querySelector<HTMLButtonElement>('#hud-composer')!
const epicycleButton = hud.querySelector<HTMLButtonElement>('#hud-epicycles')!
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
const xrTurnRow = hud.querySelector<HTMLDivElement>('#hud-xr-turn-row')!
const xrTurnSelect = hud.querySelector<HTMLSelectElement>('#hud-xr-turn')!
const xrSnapSelect = hud.querySelector<HTMLSelectElement>('#hud-xr-snap')!
const xrVignetteRow = hud.querySelector<HTMLDivElement>('#hud-xr-vignette-row')!
const xrVignetteSelect = hud.querySelector<HTMLSelectElement>('#hud-xr-vignette')!

// --- Comfort options (render/xrComfort.ts) ------------------------------------
// Snap turn and the tunnelling vignette, reachable from the monitor AND from
// inside the headset. Two surfaces, ONE object: the person setting them up for
// somebody else is at the desk, and the person who discovers they need them is
// wearing the thing — asking them to take it off to stop feeling ill would be
// the wrong answer to feeling ill.
//
// A viewer setting like Show Grid and the Global Scale: it survives a scene
// load and no writer knows about it.
let comfort: ComfortSettings = defaultComfort()

for (const mode of TURN_MODES) {
  xrTurnSelect.appendChild(
    Object.assign(document.createElement('option'), {
      value: mode,
      textContent: TURN_MODE_LABELS[mode],
    }),
  )
}
for (const degrees of SNAP_ANGLES) {
  xrSnapSelect.appendChild(
    Object.assign(document.createElement('option'), {
      value: String(degrees),
      textContent: `${degrees}°`,
    }),
  )
}
for (const level of VIGNETTE_LEVELS) {
  xrVignetteSelect.appendChild(
    Object.assign(document.createElement('option'), {
      value: level,
      textContent: VIGNETTE_LABELS[level],
    }),
  )
}

/**
 * Adopt a comfort setting, from either surface, and push it at the rig.
 *
 * `report` is off for the load-time sync, so merely opening the app does not
 * announce a setting nobody touched. The DOM controls are written every time —
 * a change made on the wrist panel has to show on the monitor, which is where
 * whoever handed over the headset is watching from.
 */
function setComfort(next: ComfortSettings, report = true) {
  comfort = next
  xrTurnSelect.value = next.turn
  xrSnapSelect.value = String(next.snapDegrees)
  // The angle means nothing under smooth turning, and a live control that does
  // nothing is worse than a greyed one.
  xrSnapSelect.disabled = next.turn !== 'snap'
  xrVignetteSelect.value = next.vignette
  xrRig.setComfort(next)
  if (!report) return
  const turn =
    next.turn === 'snap' ? `Snap turn, ${next.snapDegrees}° a flick` : 'Smooth turn'
  status(`VR comfort: ${turn}. Tunnel ${VIGNETTE_LABELS[next.vignette].toLowerCase()}.`)
}

xrTurnSelect.addEventListener('change', () => {
  setComfort({ ...comfort, turn: xrTurnSelect.value as TurnMode })
})
xrSnapSelect.addEventListener('change', () => {
  setComfort({ ...comfort, snapDegrees: Number(xrSnapSelect.value) })
})
xrVignetteSelect.addEventListener('change', () => {
  setComfort({ ...comfort, vignette: xrVignetteSelect.value as VignetteLevel })
})
setComfort(comfort, false)

// The rows appear only where an immersive session can actually start, which is
// a headset browser (or a desktop one with a runtime/emulator attached) over
// HTTPS — never on a plain http:// page, where navigator.xr does not exist.
// The comfort rows travel with the button: they are settings FOR the thing that
// button starts, and they are meaningless without it.
void XrRig.isSupported().then((supported) => {
  xrRow.hidden = !supported
  xrTurnRow.hidden = !supported
  xrVignetteRow.hidden = !supported
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
// The boot scene, and a real entry rather than a hidden placeholder so it is
// also the way BACK to a blank world once an example has been opened.
exampleSelect.appendChild(
  Object.assign(document.createElement('option'), {
    value: EMPTY_SCENE_OPTION,
    textContent: EMPTY_SCENE_OPTION,
  }),
)
for (const name of Object.keys(BUILT_IN_SCENES)) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = name
  exampleSelect.appendChild(option)
}
exampleSelect.addEventListener('change', () => {
  if (exampleSelect.value === EMPTY_SCENE_OPTION) loadEmptyScene()
  else loadBuiltIn(exampleSelect.value)
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
  // Reachable at boot now that the app opens on an empty world, so it says why
  // nothing was written rather than looking like a dead button.
  if (currentNodes.length === 0) return status('Nothing to save — the world is empty.')
  // A tag-file scene keeps its authoring style: labels go to the companion
  // file, not into inline columns that would shadow it on reload.
  download(writeGvNodeCsv(currentNodes, { inlineLabels: !labelsFromTagFile }), currentFilename)
})

saveTagsButton.addEventListener('click', () => {
  const tagFilename = deriveTagFilename(currentFilename)
  if (!tagFilename || !hasAnyLabel(currentNodes)) return
  download(writeGvTagCsv(currentNodes), tagFilename)
})

// --- Save Selection As… (Ctrl+Alt+S) -----------------------------------------
// Ported from the desktop's File ▸ Save Selection As…. The rules — membership,
// re-rooting and the world-placement bake that makes the fragment reopen where
// it sits — are src/gv/selectionExport.ts, which explains why a naive subset
// save is wrong; the options window is src/ui/saveSelectionWindow.ts. What is
// here is only the wiring the desktop's MainWindow owns too: which nodes, which
// filenames, and the write itself.

const saveSelectionWindow = new SaveSelectionWindow({ onSave: writeSelectionFiles })
app.appendChild(saveSelectionWindow.element)

function openSaveSelection() {
  if (selection.size === 0) return status('Select one or more nodes first.')
  saveSelectionWindow.open(currentNodes, selection.asSet(), currentChannelFiles !== null)
}

/**
 * Write the export as downloads — a browser's answer to the desktop's save
 * dialog, and the same one Save gv_node.csv and Save PNG already give.
 *
 * Divergence, and the reason it is not data loss: the desktop always inlines
 * text/link into its node CSV and writes the tag companion as well, so the
 * fragment carries its labels twice (inline wins on reload). This app preserves
 * the scene's own authoring style instead — the rule the Save button already
 * follows — so exactly one of the two files carries the labels and neither
 * style can lose them.
 */
function writeSelectionFiles(options: ExportOptions, includeChannels: boolean) {
  if (selection.size === 0) return status('Select one or more nodes first.')
  // Where the renderer put each node: the one input the bake cannot read off
  // the CSV. Computed from the rows rather than the live graph, so a node past
  // the \ draw limit still exports where it would have been drawn.
  const exported = buildSelection(
    currentNodes,
    selection.asSet(),
    options,
    worldPlacements(currentNodes),
  )
  if (exported.nodes.length === 0) {
    return status('Nothing to save — the selection holds no exportable nodes.')
  }

  const names = selectionExportNames(currentFilename)
  const inlineLabels = !labelsFromTagFile
  download(writeGvNodeCsv(exported.nodes, { inlineLabels }), names.node)
  let message = `Saved ${exported.nodes.length} node(s) to ${names.node}`
  if (!inlineLabels && hasAnyLabel(exported.nodes)) {
    download(writeGvTagCsv(exported.nodes), names.tag)
    message += ` (+ tags to ${names.tag})`
  }
  if (includeChannels && currentChannelFiles) {
    const subset = exportChannelSubset(
      currentChannelFiles.mapText,
      currentChannelFiles.tracksText,
      channelIdsForNodes(exported.nodes),
    )
    if (subset) {
      download(subset.mapText, names.chMap)
      download(subset.tracksText, names.chTracks)
      message += ` (+ ${subset.channels} channel(s), ${subset.tracks} track(s))`
    }
  }
  status(message + selectionSaveNotes(exported))
}

/**
 * Everything the export had to decide on the user's behalf, in one trailing
 * clause — re-rooting, dropped links, and the two cases the bake cannot carry
 * across faithfully (see selectionExport.ts). The desktop's own wording.
 */
function selectionSaveNotes(exported: SelectionExport): string {
  const notes: string[] = []
  if (exported.plan.detachedIds.length > 0) {
    notes.push(`${exported.plan.detachedIds.length} re-rooted`)
  }
  if (exported.plan.droppedLinks > 0) notes.push(`${exported.plan.droppedLinks} link(s) dropped`)
  if (exported.approximatedIds.length > 0) {
    notes.push(
      `${exported.approximatedIds.length} approximated ` +
        "(stretched parent — shape can't be carried exactly)",
    )
  }
  if (exported.animatedDetached.length > 0) {
    notes.push(`${exported.animatedDetached.length} with motion rates now moving in world space`)
  }
  return notes.length > 0 ? ` — ${notes.join(', ')}.` : '.'
}

saveSelectionButton.addEventListener('click', openSaveSelection)

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
    // A ch_input_id edit re-resolves the bindings BEFORE the rebuild: the build
    // reads the bound-node sets to register the animated slice, so a node bound
    // mid-playback starts moving on the very next frame.
    if (notes?.channelBinding !== undefined) rebindChannels()
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
    if (notes?.channelBinding !== undefined) reportChannelBinding(nodes, notes.channelBinding)
  },
  onFetchBasemap(grid) {
    basemapWindow.open(grid, currentNodes)
  },
  onScaleLockChanged(locked) {
    // Desktop `_on_scale_lock_toggled`: the panel's checkbox IS the Size-drag
    // setting, and says so the moment it changes while that mode is armed.
    if (gizmoMode !== 'scale') return
    status(
      locked
        ? 'Scale drags scale X/Y/Z together.'
        : 'Scale drags scale each axis on its own.',
    )
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
    currentClouds?.setResolution(layer.framebufferWidth / 2, layer.framebufferHeight)
    return
  }
  const width = stereoEyesNow()?.[0].width ?? window.innerWidth
  const pixelWidth = width * window.devicePixelRatio
  const pixelHeight = window.innerHeight * window.devicePixelRatio
  currentLinks?.setResolution(pixelWidth, pixelHeight)
  currentOverlays?.setResolution(pixelWidth, pixelHeight)
  currentClouds?.setResolution(pixelWidth, pixelHeight)
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
 *  framing, double-click focus, flight, the exit from an immersive session —
 *  is a jump, not a glide, and would otherwise be dragged straight back toward
 *  the pre-jump goal.
 *
 *  Follow Selected is the one exception, and must NOT call this: it runs every
 *  frame from the animation loop, so snapping the whole goal onto the lagging
 *  actual erased an in-progress drag's aim before the filter could chase it.
 *  It pins the goal's pivot alone — see `applyFollowTarget`. */
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
  // A Point Cloud draws no Object3D per point and puts nothing about itself in
  // the DOM beyond one count on the scene line, so how many points a batch
  // holds, where any one of them IS, and what the per-frame pass actually costs
  // are all readable only from here.
  get clouds() {
    return currentClouds
  },
  // Draw calls and triangles, and the scene-graph size the whole point-cloud
  // design turns on — a scene of 200k points must not be 600k Object3Ds.
  renderer,
  scene,
  // Immersive mode: nothing about the rig — where the viewer is, how big the
  // world is, where the headset thinks the head is — reaches the DOM.
  xrRig,
  xrPanel,
  xrProperties,
  get xrState() {
    return xrRig.state
  },
  // Which page/axis/step the properties panel is on, and whether it is pinned
  // — panel-local state that reaches neither the DOM nor the scene graph.
  get xrPropertiesUi() {
    return xrProperties.uiState
  },
  get selectionId() {
    return selection.id
  },
  // The Select page's whole output is the selection SET, and in a session no
  // DOM panel is on screen to show it.
  get selectionCount() {
    return selection.size
  },
  get selectionIds() {
    return [...selection.ids]
  },
  // A grab in flight leaves no trace anywhere else — no DOM, and the scene
  // graph only shows the result.
  get xrGrabState() {
    return xrGrab === null
      ? null
      : { nodeId: xrGrab.nodeId, mode: xrGrab.mode, moved: xrGrab.moved }
  },
  // A focus move: which style it picked, how black the view is, and what it was
  // aimed at. None of it reaches the DOM, and the blink's whole point is that
  // the travel is invisible — so a drive has no other way to tell a dash from a
  // blink, or to know one ran at all.
  get xrFocusState() {
    return { ...xrRig.focusState, following: followSelected, target: selectionFocusTarget() }
  },
  // Comfort: the settings, and how closed the tunnel actually is this frame.
  // The vignette is a shader on a shell in front of the eye, so nothing about
  // it reaches the DOM or shows up as a measurable change to the scene graph.
  get xrComfortState() {
    return { ...comfort, ...xrRig.vignetteState }
  },
  // The wrist panel's own readouts, which exist nowhere else while a session
  // is running: what is drawn, and where the transport stands.
  get drawState() {
    return { limit: drawLimit, drawn: drawnCount, total: currentNodes.length }
  },
  get channelState() {
    // `bound` is what the "channel in" row changes, and after the load-time
    // scene line it appears nowhere in the DOM.
    return {
      playing,
      frame: channelFrame,
      frames: channels.frameCount,
      bound: channels.boundNodeIds.size,
    }
  },
  // Rate pause (P): the checkbox shows the flag, but how many nodes the pause
  // is actually holding at zero exists only in the snapshot.
  get rateState() {
    return { paused: ratesPaused, frozen: pausedRates.size, ticking: rateNodes.length }
  },
  // Draw Mode. The VR spacing lives in neither the DOM nor the scene graph (it
  // is in the grid's own units, so it cannot share the mouse panel's pixel
  // input), and where a grid coordinate lands in the world is derivable only
  // from the scene's live matrices — which is what a drive has to aim at.
  xrDraw: {
    get on() {
      return drawMode
    },
    get state() {
      return xrDrawData()
    },
    setSpacing(value: number) {
      xrDrawSpacing = value
    },
    gridPoint(lon: number, lat: number, z = 0) {
      const target = xrDrawTarget()
      return target ? gridChildWorld(target.grid, target.frame, lon, lat, z) : null
    },
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
  if (frame) return frame.getWorldPosition(new THREE.Vector3())
  // A Point Cloud point has no frame; its position is a slot in the batch, as
  // current as the last `clouds.update()` — which is exactly the staleness rule
  // every other world-space overlay here already runs on.
  return currentClouds?.pointPosition(nodeId) ?? null
}

/**
 * Where the selection is and how big it draws — the target a focus move aims
 * at (render/xrFocus.ts) and the subject of the control panel's Fit ▸ Selection.
 *
 * Node POSITIONS, not `Box3.setFromObject`, which would fold in every
 * descendant: selecting a hyperglyph's trunk would then aim at the whole
 * hyperglyph, and selecting a root at the whole scene, so the further up a tree
 * you picked the further away you would arrive. What a person means by "go to
 * this node" is the node.
 *
 * The extent is the span those positions cover, floored by the primary's own
 * rendered radius (`renderedRadius`, the measurement the Topology Scale hint
 * already makes) — so one node still has a size, and it is the size it actually
 * draws at, draw-scale floor, Global Scale and a rod's proportions included.
 */
function selectionFocusTarget(): { center: THREE.Vector3; extent: number } | null {
  const frames = currentFrames
  if (!frames) return null
  const box = new THREE.Box3()
  const pos = new THREE.Vector3()
  let radius = 0
  // `selection.ids` is already scene row order, so the first frame found is the
  // PRIMARY's — which is the one whose rendered radius floors the extent.
  for (const id of selection.ids) {
    const frame = frames.get(id)
    if (!frame) {
      // A cloud point has no frame but is emphatically somewhere — going to one
      // is how you inspect a scan. Its radius stays 0, so the extent falls back
      // to the span of the selection (and, for a single point, to the floor the
      // caller applies): a point is a pixel-sized sprite with no world size to
      // frame against.
      if (currentClouds?.pointPosition(id, pos)) box.expandByPoint(pos)
      // Otherwise no frame means no place: a node past the draw limit, or one
      // that never drew. The rule every other selection path follows (6m).
      continue
    }
    box.expandByPoint(pos.setFromMatrixPosition(frame.matrixWorld))
    if (radius === 0) radius = renderedRadius(frame)
  }
  if (box.isEmpty()) return null
  const size = box.getSize(new THREE.Vector3())
  return {
    center: box.getCenter(new THREE.Vector3()),
    extent: Math.max(size.x, size.y, size.z, radius * 2),
  }
}

/** How wide the selection reads after Fit ▸ Selection: an object held in front
 *  of you, the Tabletop framing applied to what is selected rather than to the
 *  whole scene. */
const XR_FIT_SELECTION_METRES = 1.2

/**
 * Travel to the selection — the LEFT thumbstick click, the Select page's Go to
 * button, and what Follow does on every selection change.
 *
 * Only in a session: at the desk this is the double-click focus and the F key,
 * which move the orbit pivot instead (there is no rig to translate).
 */
function goToSelection(report = true): boolean {
  if (!xrRig.presenting) return false
  const target = selectionFocusTarget()
  if (!target) {
    if (report) status('Nothing selected — point at a glyph and pull the trigger first.')
    return false
  }
  xrRig.requestGoTo(target.center, target.extent)
  if (report) {
    const n = selection.size
    status(n > 1 ? `Going to ${n} selected nodes.` : `Going to node ${selection.id}.`)
  }
  return true
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

/**
 * This frame's readings for the properties panel. Same cost rule as the control
 * panel above: called every frame, repaints only when its signature moves.
 *
 * The PRIMARY node is the first selected in scene row order, exactly as the DOM
 * inspector's is — so the two panels name the same node as the one whose values
 * are on show, and an edit made in the headset lands where an edit made at the
 * desk would.
 */
function updateXrProperties() {
  const nodes = selectedNodes()
  const primary = nodes[0] ?? null
  xrProperties.update({
    node: primary,
    count: nodes.length,
    labels: {
      textureLabel: primary ? xrTextureLabel(primary.textureId) : '',
    },
    select: xrSelectData(xrProperties.criterion),
    draw: xrDrawData(),
    followSelected,
    comfort,
  })
}

/**
 * The Select page's value list for ONE criterion, memoised.
 *
 * `criterionValues` and `bulkSelectableNodes` are both O(nodes), and this runs
 * on the animation loop — at Event_Cloud's 209k rows an unmemoised call would
 * be a full scan every frame for a page that is usually not even open. The
 * cache is invalidated by the criterion changing and by `xrSelectEpoch`, which
 * rebuildScene bumps: geometry and topology are exactly the fields the shape
 * steppers edit, so the distinct set really can move under it.
 */
let xrSelectEpoch = 0
let xrSelectCache: { key: string; data: XrPropSelectData } | null = null

function xrSelectData(criterion: SelectCriterion): XrPropSelectData {
  const key = `${criterion}|${xrSelectEpoch}`
  if (xrSelectCache?.key === key) return xrSelectCache.data
  const data: XrPropSelectData = {
    criterion,
    values: criterionValues(currentNodes, criterion),
    selectable: bulkSelectableNodes(currentNodes).length,
  }
  xrSelectCache = { key, data }
  return data
}

/** The media file a texture_id names, or the bare id when the scene came in as
 *  a lone CSV and there is no folder to look in (the DOM row degrades the same
 *  way). */
function xrTextureLabel(id: number): string {
  if (id === 0) return 'none'
  const entry = currentMedia?.index.entries.find((e) => e.textureId === id)
  return entry ? `${id} · ${entry.name}` : String(id)
}

// --- Properties panel edits ----------------------------------------------------
//
// Every one of these mutates the selection and stops there; the panel calls
// `xrCommitEdit` once when the gesture ends. That split is what lets a scrub
// rewrite a value at headset frame rate — a `rebuildScene` per frame is not
// affordable at any real scene's size — and it is the same one a mouse gizmo
// drag already makes.

function xrPrimaryNode(): GvNode | null {
  return selectedNodes()[0] ?? null
}

/**
 * Ctrl+click's behaviour, reached from a headset: flip one node's membership
 * and leave the rest alone (`selectionOps`' own rule, and `toggleSelection`'s
 * on the mouse side).
 */
function toggleXrSelection(nodeId: number) {
  const ids = new Set(selection.ids)
  const had = ids.delete(nodeId)
  if (!had) ids.add(nodeId)
  setSelection(ids)
  status(
    `${had ? 'Removed' : 'Added'} node ${nodeId} — ${selection.size} node(s) selected.`,
  )
}

/** Apply an edit to every selected node, in place. */
function xrEditSelection(mutate: (node: GvNode) => void) {
  for (const node of selectedNodes()) mutate(node)
}

/** The shape steppers ARE J and O, on the same subset those keys operate on. */
function xrCycle(kind: 'geometry' | 'topo', step: number) {
  const targets = cycleTargets(selectedNodes())
  if (kind === 'geometry') cycleGeometry(targets, step)
  else cycleTopology(targets, step)
}

/** And the palette pair IS = / − and Alt+= / Alt+−. */
function xrCyclePalette(kind: 'index' | 'palette', step: number) {
  const targets = cycleTargets(selectedNodes())
  if (kind === 'index') cycleColorIndex(targets, step)
  else cyclePalette(targets, step)
}

/**
 * Nudge one axis of translate/rotate/scale on every selected node, and show it
 * immediately without a rebuild.
 *
 * Targeted rather than `refreshDrawScales`, which is the whole-scene version of
 * this and costs O(N) — right for the Global Scale slider, which changes every
 * node, and wrong here, where a scrub touches one. Children ride along for
 * free: they are nested UNDER their parent's Object3D, so moving a frame moves
 * its subtree.
 *
 * Values are rounded at each step so a scrub walks a lattice of clean numbers
 * instead of accumulating float drift over a hundred frames of `+= 0.1`.
 */
function xrNudgeVector(field: 'translate' | 'rotate' | 'scale', axis: 'x' | 'y' | 'z', delta: number) {
  const nodes = selectedNodes()
  if (nodes.length === 0 || !currentRoot) return
  for (const node of nodes) {
    node[field][axis] = round6(node[field][axis] + delta)
    xrRefreshNodeFrame(node)
  }
  // Halos are world-space geometry written off these matrices, so both have to
  // be brought forward before the frame is drawn.
  currentRoot.updateMatrixWorld(true)
  selection.refreshHalos()
}

function xrRefreshNodeFrame(node: GvNode) {
  const frame = currentFrames?.get(node.id)
  if (!frame) return // past the draw limit — nothing drawn to move
  applyFrameTransform(frame, node, effectiveParent(node, nodesById))
  if (node.type === NodeType.WorldGrid) return
  const glyph = frame.children.find((c) => c.userData.isGlyph)
  if (glyph) applyGlyphDrawScale(glyph, node)
}

/** End of a gesture: the rebuild the DOM inspector's own commit runs, so the
 *  overlays re-cell, the Node Table repaints and the DOM panels catch up. */
function xrCommitEdit() {
  rebuildScene(false)
  const nodes = selectedNodes()
  void decodeTexturesFor(
    nodes.map((n) => n.textureId),
    sceneEpoch,
  )
}

/** Six decimals is what the CSV writer keeps, so this is the precision an edit
 *  can actually survive a save at. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

// --- Direct grab-to-move (immersive) --------------------------------------------
//
// The VR answer to the transform gizmo, which a headset cannot use at all —
// TransformControls drags from a screen-space pointer and there is no screen.
// Hold the trigger on an ALREADY-selected glyph and it rides the ray; the whole
// selection comes with it.
//
// The ray is a fishing rod, not a hand: the grabbed point keeps its DISTANCE
// along the ray, so the same gesture works on a glyph at arm's length and on
// one across a 20 m scene, and turning the wrist swings it. Only translation —
// the hand's rotation is deliberately not applied, since a free 6-DoF grab
// makes an accidental tumble far too easy and rotate is one page away on the
// Properties panel.
//
// What it does NOT do is invent a second way to write CSV: the frame is moved,
// and then the very same `invertFrameTranslate` the mouse gizmo uses reads that
// motion back as the node's own translate in its own topology coordinates.

/** Hand travel, in METRES, before a held trigger counts as a drag rather than a
 *  click. Without it every press on a selected glyph would nudge it. */
const XR_GRAB_THRESHOLD_M = 0.02
/** …and the same for a turn, which can happen with the hand almost still. */
const XR_GRAB_TWIST_THRESHOLD_RAD = 0.05

/**
 * Hand travel along the ray, in METRES, that doubles (or halves) a size grab.
 * Exponential so the gesture is symmetric — push 25 cm to double, pull 25 cm
 * back to halve — and along the RAY because that is the one axis the fishing
 * rod leaves unused: in move mode the handle distance is locked, so pushing
 * and pulling does nothing there and is free to mean something here.
 */
const XR_GRAB_SIZE_DOUBLE_M = 0.25

interface XrGrabState {
  nodeId: number
  mode: XrGrabMode
  /** Distance from the ray origin to the handle point, world units. */
  distance: number
  /** The handle point when the trigger came down, WORLD space. */
  startHandle: THREE.Vector3
  /** Where the hand was, and which way it pointed, at grab start (WORLD). */
  startOrigin: THREE.Vector3
  startForward: THREE.Vector3
  startPose: THREE.Quaternion
  /** The primary frame's transform at grab start, PARENT-local. */
  startFramePos: THREE.Vector3
  startFrameQuat: THREE.Quaternion
  startFrameScale: THREE.Vector3
  ctx: TranslateDragContext
  /** False until the hand has travelled past the threshold. */
  moved: boolean
}

let xrGrab: XrGrabState | null = null

function beginXrGrab(
  raycaster: THREE.Raycaster,
  nodeId: number,
  pose: THREE.Quaternion,
): boolean {
  const node = nodesById.get(nodeId)
  const frame = currentFrames?.get(nodeId)
  if (!node || !frame?.parent) return false
  const world = frame.getWorldPosition(new THREE.Vector3())
  // Project the glyph onto the ray: that point is the handle, and holding its
  // distance constant is what makes the grab work at any range.
  const distance = world.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction)
  if (!(distance > 0)) return false
  primaryStart = snapshotTransform(node)
  followerStart = new Map(
    selectedNodes()
      .filter((n) => n.id !== nodeId)
      .map((n) => [n.id, snapshotTransform(n)]),
  )
  xrGrab = {
    nodeId,
    // Read ONCE, here: a mode change mid-grab would rewrite a different field
    // from the same hand motion.
    mode: xrProperties.grabMode,
    distance,
    startHandle: raycaster.ray.at(distance, new THREE.Vector3()),
    startOrigin: raycaster.ray.origin.clone(),
    startForward: raycaster.ray.direction.clone(),
    startPose: pose.clone(),
    startFramePos: frame.position.clone(),
    startFrameQuat: frame.quaternion.clone(),
    startFrameScale: frame.scale.clone(),
    ctx: translateDragContext(node),
    moved: false,
  }
  return true
}

/**
 * One frame of a held grab. Which of the three fields it writes is the chip on
 * the Properties panel's Move page — the grab IS the transform gizmo here, and
 * carries the gizmo's own three modes.
 */
function xrGrabMove(raycaster: THREE.Raycaster, pose: THREE.Quaternion) {
  const grab = xrGrab
  if (!grab || !currentRoot) return
  const node = nodesById.get(grab.nodeId)
  const frame = currentFrames?.get(grab.nodeId)
  const parent = frame?.parent
  if (!node || !frame || !parent) return

  const handle = raycaster.ray.at(grab.distance, new THREE.Vector3())
  if (!grab.moved) {
    // The threshold is in metres of real hand travel, so it means the same
    // thing whether the world is a diorama or a room around you. Turning is
    // measured as an ANGLE, since a twist in place moves the hand barely at all.
    const travelM = handle.distanceTo(grab.startHandle) / Math.max(1e-9, xrRig.state.scale)
    const twist = grab.startPose.angleTo(pose)
    if (travelM < XR_GRAB_THRESHOLD_M && twist < XR_GRAB_TWIST_THRESHOLD_RAD) return
    grab.moved = true
  }

  if (grab.mode === 'move') xrGrabApplyMove(node, frame, parent, grab, handle)
  else if (grab.mode === 'turn') xrGrabApplyTurn(node, frame, parent, grab, pose)
  else xrGrabApplySize(node, frame, grab, raycaster)

  // Every other selected node takes the same per-field change in ITS OWN
  // coordinates — the desktop's `_apply_axis_deltas`: additive for translate
  // and rotate, a RATIO for scale, which is what keeps a group's relative
  // proportions while it grows.
  applyDragToFollowers(node, grab.mode === 'move' ? 'translate' : grab.mode === 'turn' ? 'rotate' : 'scale')
  currentRoot.updateMatrixWorld(true)
  selection.refreshHalos()
  const nodes = selectedNodes()
  inspector.show(nodes, nodes.length === 1 ? worldPosOf(node.id) : null)
}

function xrGrabApplyMove(
  node: GvNode,
  frame: THREE.Object3D,
  parent: THREE.Object3D,
  grab: XrGrabState,
  handle: THREE.Vector3,
) {
  // World delta into the frame's PARENT space. Differencing two transformed
  // points rather than rotating a vector, so the parent's own scale is carried
  // exactly as buildScene applied it.
  const localNow = parent.worldToLocal(handle.clone())
  const localStart = parent.worldToLocal(grab.startHandle.clone())
  frame.position.copy(grab.startFramePos).add(localNow.sub(localStart))

  // The gizmo's own read-back. Full three-axis inversion, with no dominant-field
  // pinning: a gizmo handle constrains motion to one axis and the pinning is
  // what keeps the other two from drifting, but a grabbed hand moves freely in
  // all three and every axis it moves is meant.
  const t = invertFrameTranslate(node, frame, grab.ctx)
  node.translate.x = t.x
  node.translate.y = t.y
  node.translate.z = t.z
  // Reproject onto the topology surface and track outward orientation.
  applyFrameTransform(frame, node, grab.ctx.parentGv)
}

/**
 * Grab-to-turn: the node takes the hand's own rotation since the grab began.
 *
 * The hand's delta is a WORLD rotation and the frame's is parent-local, so it
 * is conjugated into the parent's space — P⁻¹·R·P — before being composed onto
 * the orientation the frame started with. The read-back is then the gizmo's
 * rotate branch exactly: strip the outward base rotation (constant through a
 * turn, since it depends only on translate) and decompose what is left through
 * whichever rotation convention the node declares.
 */
function xrGrabApplyTurn(
  node: GvNode,
  frame: THREE.Object3D,
  parent: THREE.Object3D,
  grab: XrGrabState,
  pose: THREE.Quaternion,
) {
  const worldDelta = pose.clone().multiply(grab.startPose.clone().invert())
  const parentQ = parent.getWorldQuaternion(new THREE.Quaternion())
  const localDelta = parentQ.clone().invert().multiply(worldDelta).multiply(parentQ)
  frame.quaternion.copy(localDelta).multiply(grab.startFrameQuat)

  const own = frameBaseRotation(node, grab.ctx.parentGv)
    .transpose() // inverse of a pure rotation
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(frame.quaternion))
  const r = invertLocalRotation(own, node.rotate, node.rotationMode)
  node.rotate.x = r.x
  node.rotate.y = r.y
  node.rotate.z = r.z
  // Snap the frame to the exact CSV-representable rotation.
  applyFrameTransform(frame, node, grab.ctx.parentGv)
}

/**
 * Grab-to-size: push the hand along the ray to grow, pull back to shrink.
 *
 * Uniform on all three axes — a single hand has no way to say "taller but not
 * wider", and the Move page's per-axis rows are how you say that. The factor is
 * exponential, so pushing and pulling the same distance are exact inverses and
 * a size can always be walked back by retracing the gesture.
 */
function xrGrabApplySize(
  node: GvNode,
  frame: THREE.Object3D,
  grab: XrGrabState,
  raycaster: THREE.Raycaster,
) {
  const travel = raycaster.ray.origin.clone().sub(grab.startOrigin).dot(grab.startForward)
  const metres = travel / Math.max(1e-9, xrRig.state.scale)
  const factor = Math.pow(2, metres / XR_GRAB_SIZE_DOUBLE_M)
  frame.scale.copy(grab.startFrameScale).multiplyScalar(factor)
  node.scale.x = frame.scale.x
  node.scale.y = frame.scale.y
  node.scale.z = frame.scale.z
  // Draw scale is derived from node.scale (the floor and the Global Scale live
  // there), so the glyph has to be re-derived or the shape lags the frame.
  const glyph = frame.children.find((c) => c.userData.isGlyph)
  if (glyph) applyGlyphDrawScale(glyph, node)
}

function endXrGrab(cancelled: boolean) {
  const grab = xrGrab
  xrGrab = null
  primaryStart = null
  followerStart = new Map()
  if (!grab) return
  if (!grab.moved) {
    // Never left the threshold, so it was a click after all: fall back to the
    // ordinary select, which is what makes clicking a node inside a
    // multi-selection still reduce the selection to it.
    if (!cancelled) {
      setSelection(grab.nodeId)
      status(`Selected node ${grab.nodeId}.`)
    }
    return
  }
  // Final commit, exactly as the mouse gizmo's `dragging-changed` does: the
  // full rebuild refreshes glyph draw scale, the overlays, the table and the
  // HUD. Once, at the end — the drag itself ran in place.
  rebuildScene(false)
  const count = selection.size
  status(
    cancelled
      ? 'Grab cancelled.'
      : `Moved ${count} node${count === 1 ? '' : 's'} to ${fmtVec(nodesById.get(grab.nodeId))}.`,
  )
}

function fmtVec(node: GvNode | undefined): string {
  if (!node) return '—'
  const f = (v: number) => Number(v.toFixed(3)).toString()
  return `${f(node.translate.x)}, ${f(node.translate.y)}, ${f(node.translate.z)}`
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
  // A selected cloud point is re-derived from its row every frame, so a gizmo
  // drag on it is visible while it happens rather than only at the release —
  // the point has no Object3D of its own to carry the drag (the proxy frame in
  // `cloudGizmoFrame` carries it, and the row is what they share).
  if (cloudParents.size > 0) currentClouds?.setLive(selection.asSet())
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
// Tags on, scoped to the selection, is the default PAIR (desktop 2026-08-28,
// `Viewport.show_tags` / `show_tags_selected_only`, both flipped to True).
// Either one alone is a poor first impression: all-tags-off hides the labels a
// scene's author wrote, and all-tags-on buries a large scene in text. Together
// they mean "click a glyph, read what it is" — the labels are discoverable
// without ever cluttering the view. T still toggles the first of them;
// unchecking the second shows every tag.
let showTags = true
let tagsSelectedOnly = true
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
  setTagFontSize(pointSize: number) {
    writeTagStyle((world) => {
      world.tagFontSize = clampTagFontSize(pointSize)
    })
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
/**
 * The loaded scene's PARSED channel companions, kept alongside the resolved
 * animation (not handed to `bindChannels` and forgotten) so a node's channel
 * binding can be changed from the Properties panel and re-resolved in place —
 * see `rebindChannels`. Desktop `_ch_map` / `_ch_tracks`.
 */
let channelData: { map: ChMapParseResult; tracks: ChTracksParseResult } | null = null
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
/**
 * The nodes the label pass walks: every row except the points inside a cloud
 * that are not individually pinned. Recomputed on scene rebuild — see
 * labelOverlay.taggableNodes for why filtering here rather than in the loop is
 * load-bearing rather than a nicety.
 */
let taggableNodes: readonly GvNode[] = []
/** World render_mode as last pushed onto the materials, so the animated path
 *  only pays the material walk on frames that actually change the mode. */
let appliedWorldRenderMode: number | null = null
const channelAudio = new ChannelAudio()

let playing = false
let channelFrame = 0
let channelFps = DEFAULT_CHANNEL_FPS
let channelLoop = true

// --- Rate-animation pause (desktop View ▸ Pause Rate Animation [P]) ------------
//
// The desktop does not merely stop integrating: `_toggle_rates_paused` ZEROES
// the nine rate fields and keeps the originals, so a Save made while paused
// writes a genuinely static file rather than one that only looked still. That
// is the feature — freezing a Hyperglyph mid-evolution and saving the pose.
//
// This app already had a Rate Motion checkbox that stopped the integration in
// place, which is the same idea done half way (and was recorded as such when
// Channels shipped). Rather than grow a second control meaning nearly the same
// thing — the trap the desktop's own scale-lock comment warns about — the
// checkbox and the P key are ONE state, and it is now the desktop's.
let ratesPaused = false
let pausedRates = new Map<number, RateSnapshot>()
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
    syncTagStyle() // ditto an animated tag_font_size and the slider showing it
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
    setRatesPaused(!value)
  },
}

/**
 * Freeze (or unfreeze) every rate in the scene — the P key and the Channels
 * panel's Rate Motion checkbox, which are the same state.
 *
 * `announce` is off for the reset a scene load performs, which has nothing to
 * report; every user-driven path says what happened, in the desktop's wording.
 */
function setRatesPaused(paused: boolean, announce = true) {
  if (paused === ratesPaused) return
  ratesPaused = paused
  if (paused) {
    pausedRates = snapshotAndZeroRates(currentNodes)
    if (announce) {
      status(
        pausedRates.size === 0
          ? 'Rate animation paused — no node in this scene carries a rate.  [P]'
          : `Rate animation paused (${pausedRates.size} node(s) frozen) — ` +
              'Save now to write a static snapshot.  [P]',
      )
    }
  } else {
    // Restore by id: a paused node can be deleted before the resume, and its
    // rates go with it rather than being an error.
    const restored = restoreRates(pausedRates, nodesById)
    pausedRates = new Map()
    if (announce) status(`Rate animation resumed (${restored} node(s)).  [P]`)
  }
  channelsPanel.setMotionChecked(!paused)
  // The rate fields just changed for real, so everything derived from them has
  // to follow: the tick list, the dynamic registration, the Node Table's nine
  // rate columns and the inspector's three rate rows. That is a rebuild.
  rebuildScene(false)
}

/**
 * How many nodes carry a rate, counting the ones the pause is holding at zero
 * — otherwise the Rate Motion checkbox (and, in a channel-less scene, the whole
 * Channels panel) would vanish on the very press that paused them, leaving the
 * P key as the only way back.
 */
function rateNodeCount(): number {
  return pausedRates.size + rateNodes.filter((n) => !pausedRates.has(n.id)).length
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
 * any Object3D — background clear colour, fog, the scene-wide blend mode, and
 * the tag-label point size. The desktop reads all of them off the row in
 * paintGL every frame; this applies them when a frame lands. (The desktop
 * documents the World row's color_r/g/b as the way to animate the background,
 * and its fog colour follows it.)
 */
function syncAnimatedWorld() {
  const world = worldNodeOf(currentNodes)
  if (!world || !channels.boundNodeIds.has(world.id)) return
  // The label overlay paints from this cache, so an animated tag_font_size
  // needs it refreshed. Deliberately not pushed at the panel slider: a
  // playing scene would drag the control out from under the user, and the
  // desktop's slider likewise only syncs on load.
  tagStyle = tagTextStyleOf(world)
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
  currentOverlays = buildTopologyOverlay(currentNodes, currentFrames, currentRoot, {
    showHidden,
    textures: currentTextures.byId,
  })
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
  //
  // The paused check is belt and braces where the fields are concerned (they
  // are zero) but not where CHANNELS are: a track bound to a rate field writes
  // it back every frame, and a pause that a channel could undo is not one.
  if (!ratesPaused && rateNodes.length > 0 && !gizmo.dragging) {
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
/**
 * The scene's Point Cloud batches. It is also the position source for every
 * node inside a cloud — those have no frame at all, so `currentFrames` cannot
 * answer for them (render/pointCloudOverlay.ts).
 */
let currentClouds: SceneBuildResult['clouds'] | null = null
/** Ids of the Point Cloud PARENTS, for the "is this node a point?" tests. */
let cloudParents: ReadonlySet<number> = new Set()
let currentFrames: SceneBuildResult['frames'] | null = null
let currentNodes: GvNode[] = []

/**
 * Append a batch of rows to the scene.
 *
 * A loop rather than a spread into `push`, and the reason is a real crash Jeff
 * hit on a point-cloud import: spreading an array into a call passes one
 * ARGUMENT per element, and V8 overflows its stack somewhere between 101,000
 * and 150,000 of them. Measured on the aerial survey — 101,000 points imported
 * fine and 150,000 died with "Maximum call stack size exceeded", which the
 * import window reported honestly and which left the scene untouched.
 *
 * Every caller that adds a generated batch goes through here, not only the
 * importer: pasting a copied cloud brings its whole descendant subtree, so that
 * path had exactly the same ceiling the moment clouds could be pasted. The
 * others (draw stamps, the Hyperglyph Generator, the Composer, the Epitrochoid
 * Generator) are bounded well below it by their own budgets and use this for
 * one reason — so no future caller has to know the limit exists.
 */
function appendNodes(nodes: readonly GvNode[]): void {
  for (const node of nodes) currentNodes.push(node)
}
let currentDisplayName = ''
let currentFilename = 'scene_gv_node.csv'
let parseErrorLines: string[] = []
let parseWarningLines: string[] = []
/** True when labels came from a companion gv_tag.csv rather than inline columns. */
let labelsFromTagFile = false
/** Resolved media for the loaded scene — texture_id → file. */
let currentMedia: { index: MediaIndex; fileById: Map<number, File> } | null = null
/**
 * The loaded scene's Channels companions, verbatim. Kept as TEXT because Save
 * Selection filters them at the file level (src/gv/channelExport.ts), the way
 * the desktop does — so a column neither parser reads still round-trips into
 * the fragment.
 */
let currentChannelFiles: { mapText: string; tracksText: string } | null = null
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
  // A basemap window left open belongs to the previous scene's grid, and a Save
  // Selection window to the previous scene's selection — both are pointed at
  // their data when opened, so neither can be left showing another file's.
  basemapWindow.close()
  saveSelectionWindow.close()

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
  channelData = null
  channelAudio.unload()
  channelNote = ''
  currentChannelFiles = null

  if (source.channelMapText !== undefined && source.channelTracksText !== undefined) {
    currentChannelFiles = {
      mapText: source.channelMapText,
      tracksText: source.channelTracksText,
    }
    const map = parseGvChMap(source.channelMapText)
    const tracks = parseGvChTracks(source.channelTracksText)
    parseWarningLines.push(
      ...[...map.errors, ...map.warnings, ...tracks.errors, ...tracks.warnings].map(issueText),
    )
    if (map.errors.length === 0 && tracks.errors.length === 0 && tracks.frameCount > 0) {
      channelData = { map, tracks }
      channels = bindChannels(map, tracks, currentNodes)
      parseWarningLines.push(...channels.warnings)
      // Deliberately NOT also requiring a non-empty binding list (desktop
      // `_ch_load_from_csv`, 2026-08-28): a channel file no node points at yet
      // is precisely the scene the Properties panel's "channel in" row exists
      // to wire up, and dropping the animation would leave the transport
      // hidden and nothing to bind against.
    }
  }
  // The row names the channels this file offers, so it has to know before the
  // first selection lands in the panel.
  inspector.setChannels(channelMenu())

  if (source.audio && channels.frameCount > 0) {
    channelAudio.load(source.audio.blob, source.audio.name)
  }

  // A new scene resets the pause. Its snapshot is a set of node ids that mean
  // nothing here, so there is nothing left to resume — the state is dropped
  // rather than carried (a small divergence: the desktop leaves its menu item
  // checked over a load, pointing at a snapshot from the previous file).
  ratesPaused = false
  pausedRates = new Map()
  channelsPanel.setMotionChecked(true)

  rateNodes = rateCandidates(currentNodes, channels.rateBoundNodeIds)
  channelsPanel.setScene({
    frames: channels.frameCount,
    rateNodes: rateNodes.length,
    audioName: channelAudio.name ?? undefined,
  })
  channelsPanel.setPlaying(false)

}

/**
 * The scene line's channels clause. Recomputed after a rebind as well as on
 * load: the bound-node count is exactly what the "channel in" row changes, and
 * this line is the only place that says it once the status message has gone.
 */
function channelNoteText(): string {
  const notes: string[] = []
  if (channels.frameCount > 0) {
    notes.push(
      `channels: ${channels.frameCount} frames, ${channels.boundNodeIds.size} node(s)` +
        (channelAudio.name ? `, synced to ${channelAudio.name}` : ''),
    )
  }
  if (rateNodes.length > 0) notes.push(`${rateNodes.length} rate-animated node(s)`)
  return notes.join(', ')
}

/**
 * The loaded ch-map as channel id → the attributes it drives — what the
 * Properties panel's "channel in" row offers. Empty when no channel file
 * loaded, which that row reads as "degrade to a plain id field".
 */
function channelMenu(): Map<number, string[]> {
  const menu = new Map<number, string[]>()
  if (!channelData) return menu
  for (const id of [...channelData.map.byChannel.keys()].sort((a, b) => a - b)) {
    menu.set(id, channelAttributes(channelData.map, id))
  }
  return menu
}

/**
 * Re-resolve every node↔channel binding against the loaded ch-map, after the
 * Properties panel changed some node's ch_input_id (desktop `_ch_rebind`).
 *
 * RESET FIRST, then re-bind: binding snapshots each newly-bound node's CURRENT
 * field values as the ones Stop will later restore, so rebinding mid-playback
 * without resetting would bake whatever frame happened to be on screen into the
 * scene permanently — and a node taken OFF a channel would keep that frame's
 * values instead of returning to its own.
 *
 * Cheap enough to run per edit (one pass over the node list), and the
 * alternative — patching the binding list in place — would have to reproduce
 * bindChannels' originals and palette bookkeeping. The caller rebuilds: the
 * build is what registers the animated slice with DynamicNodes.
 */
function rebindChannels() {
  if (!channelData) return
  resetChannels(channels)
  channels = bindChannels(channelData.map, channelData.tracks, currentNodes)
  // A node bound while the scene is playing (or parked on a scrubbed frame)
  // should be showing that frame, not its CSV values, before the next tick.
  applyChannelFrame(channels, channelFrame)
}

/** The status line after a "channel in" edit, in the desktop's own wording. */
function reportChannelBinding(nodes: GvNode[], chId: number) {
  const subject = nodes.length === 1 ? `Node ${nodes[0].id}` : `${nodes.length} nodes`
  const ids = [...channelMenu().keys()]
  status(
    channelBindingMessage(subject, {
      channelIds: ids,
      value: chId,
      mixed: false,
      attributes: channelData ? channelAttributes(channelData.map, chId) : [],
    }),
  )
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

/** Start over with nothing in the world — the boot state, and the dropdown's first entry. */
function loadEmptyScene() {
  exampleSelect.value = EMPTY_SCENE_OPTION
  openWarningLines = []
  loadScene({
    nodeText: EMPTY_SCENE_CSV,
    displayName: EMPTY_SCENE_OPTION,
    // The name a Save would offer, matching the fallback currentFilename has
    // always carried for a scene that came from nowhere in particular.
    filename: 'scene_gv_node.csv',
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

/**
 * Nodes whose position or colour an animation can change each frame: every
 * channel-bound node, plus every node carrying a nonzero rate field.
 *
 * Only the point-cloud overlay asks — for everything else DynamicNodes and the
 * rate integrator work on the Object3Ds a cloud point does not have. Computed
 * from the CSV rather than from `rateNodes`, which is itself recomputed further
 * down this same rebuild and so is a build behind at this point.
 */
function liveCloudPointIds(): ReadonlySet<number> {
  const ids = new Set<number>(channels.boundNodeIds)
  for (const node of rateCandidates(currentNodes, channels.rateBoundNodeIds)) ids.add(node.id)
  return ids
}

function rebuildScene(fitCamera: boolean) {
  // Geometry and topology are exactly what the VR shape steppers edit, so the
  // Select page's distinct-value lists can move under any rebuild.
  xrSelectEpoch++
  const prevSelected = new Set(selection.ids)
  const built = buildScene(currentNodes, {
    showHidden,
    textures: currentTextures.byId,
    meshes: meshLibrary.geometries(),
    drawLimit,
    // A channel striking `hide` needs the glyph alive to blank and restore.
    channelHideBound: channels.hideBoundNodeIds,
    // A cloud's points are baked into one array rather than given frames, so
    // the ones an animation can move have to be re-derived per frame; every
    // other node animates through DynamicNodes, on Object3Ds a point has none
    // of. Both sources of motion count — a channel binding and a rate field.
    liveNodeIds: liveCloudPointIds(),
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
  currentClouds?.dispose()
  currentRoot = built.root
  currentLinks = built.links
  // A link drawn as a stretched glyph gets a halo like any other glyph, but
  // its object hangs off the link overlay rather than off its own frame — so
  // the selection is told where to find them, once per build.
  selection.setLinkGlyphs(built.links.glyphObjects)
  currentOverlays = built.overlays
  currentClouds = built.clouds
  // A cloud point has no frame, so the selection asks the clouds instead —
  // both whether the id exists at all and where to draw its halo.
  selection.setPointSource(built.clouds)
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
  // Cloud points are filtered out of the label pass BEFORE the loop, not inside
  // it: the desktop measured that walking them one at a time cost 109 ms of a
  // 111 ms frame on a 442k-point scene (labelOverlay.taggableNodes). Membership
  // only changes when the scene does, so this is the right place for it.
  cloudParents = built.clouds.parentIds
  taggableNodes = labelTaggableNodes(currentNodes, cloudParents)
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
  // Both counts this line reports can move under an edit — a rate typed into
  // the panel, or a node pointed at a channel — so it is written here rather
  // than at load.
  channelNote = channelNoteText()
  channelsPanel.setRateNodes(rateNodeCount(), ratesPaused)
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
    // Reported separately from `drawn` because a cloud's points are deliberately
    // NOT in that count — they draw no glyph — and a scene that is mostly one
    // scan would otherwise read as almost empty.
    ...(built.clouds.cloudCount > 0
      ? [
          `${built.clouds.cloudCount} point cloud(s), ` +
            `${built.clouds.pointCount.toLocaleString()} point(s)`,
        ]
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

  // A single dropped scan opens the import window, for the same reason. .ply is
  // deliberately NOT routed here even though the importer reads it: a dropped
  // PLY has gone to the mesh importer since mesh import shipped and is far more
  // often a model than a scan (the desktop's drop_router says exactly this), so
  // the mesh test above claims it and Import Cloud… takes the other case. .txt
  // and .csv are absent for a sharper reason — a dropped CSV is a SCENE.
  const droppedClouds = files.filter((f) => isDroppedPointCloud(f.file.name))
  if (droppedClouds.length > 0 && droppedClouds.length === files.length) {
    if (files.length > 1) {
      status(`Drop one scan at a time — ${files.length} were dropped; opening the first.`)
    }
    importPointCloudFile(droppedClouds[0].file)
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
    // A cloud point has no frame to project, so the sweep reads its position out
    // of the batch — without this, dragging a box over a scan would select
    // nothing, and a rubber band is the documented way to grab part of one.
    { showHidden, points: currentClouds },
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
  const inToolWindow = focused instanceof HTMLElement && focused.closest('.float-window') !== null
  // A focused HUD CHECKBOX is not a text field — there is nothing to type into
  // it, so the viewport's single-key commands still belong to the viewport.
  // Without this, clicking a panel checkbox silently kills every one of them
  // until something else takes focus, which is at its most confusing for Rate
  // Motion, where the checkbox and the P key are one control: click it, press P,
  // nothing happens. Space and Enter are the exceptions on purpose — those
  // activate the control itself, and preventDefault here would take that away.
  const onCheckbox =
    !inToolWindow &&
    focused instanceof HTMLInputElement &&
    (focused.type === 'checkbox' || focused.type === 'radio')
  const typing = onCheckbox
    ? e.key === ' ' || e.key === 'Enter'
    : tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || inToolWindow

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
    // The desktop puts the Epitrochoid Generator on a bare Ctrl+E, which is
    // already the Selection panel here — the same divergence Show Selection
    // Box makes for its Ctrl+B, and for the same reason: the panel chord
    // predates the feature and is muscle memory in this app.
    else if (key === 'e' && e.shiftKey) epicycleWindow.toggle()
    else if (key === 'e') selectionPanel.panel.cycle()
    else if (key === 'b') scenePanel.cycle()
    // The desktop's own chords for Tools ▸ Hyperglyph Generator… and
    // Tools ▸ Glyph Composer…. Unlike Ctrl+N both ARE interceptable, so neither
    // needs an Alt substitute; the Create panel's buttons are the way in if a
    // browser ever disagrees.
    else if (key === 'h') hyperglyphWindow.toggle()
    else if (key === 'g') composerWindow.toggle()
    else if (typing) return
    // The desktop's own File ▸ Save Selection As… chord. Ctrl+S (plain Save) is
    // the browser's Save Page and is not worth fighting for; Ctrl+Alt+S is free
    // and is what the other app teaches.
    else if (key === 's' && e.altKey) openSaveSelection()
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
  // Desktop View ▸ Pause Rate Animation [P]. Alt+P is Save PNG (the desktop's
  // F12, which a browser keeps) — the two are unrelated and the bare key is the
  // one the other app teaches.
  else if (e.key === 'p' || e.key === 'P') setRatesPaused(!ratesPaused)
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
/**
 * The frame the gizmo attaches to for a selected Point Cloud POINT, which has
 * none of its own.
 *
 * One Object3D, parented to the cloud's own frame and placed by the builder's
 * rule, so every existing drag path works on it unchanged: the gizmo writes
 * `frame.position`, `invertFrameTranslate` reads it back into the row, and
 * `applyFrameTransform` re-places it — none of which knows or cares that this
 * frame is not in `currentFrames`. The point then FOLLOWS the drag because the
 * selection is handed to `clouds.setLive`, which re-derives it from its row
 * every frame.
 *
 * Reused rather than recreated, so a run of drags does not litter the graph; it
 * is detached whenever the primary stops being a point.
 */
const cloudPointFrame = new THREE.Object3D()
cloudPointFrame.name = 'gv-cloud-point-frame'

function cloudGizmoFrame(node: GvNode): THREE.Object3D | undefined {
  const parent = currentFrames?.get(node.parentId)
  if (!parent || !currentClouds?.hasPoint(node.id)) return undefined
  if (cloudPointFrame.parent !== parent) parent.add(cloudPointFrame)
  cloudPointFrame.userData.nodeId = node.id
  applyFrameTransform(cloudPointFrame, node, nodesById.get(node.parentId) ?? null)
  cloudPointFrame.updateWorldMatrix(true, false)
  return cloudPointFrame
}

function updateGizmoAttachment() {
  const primary = selection.id !== null ? nodesById.get(selection.id) : undefined
  const frame = primary
    ? (currentFrames?.get(primary.id) ?? cloudGizmoFrame(primary))
    : undefined
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
  // Scale mode is the one the Properties panel's Lock X/Y/Z checkbox also
  // governs, so arming it says which way that is set (desktop `_set_gizmo_mode`
  // appends "; X/Y/Z locked together" for the same reason).
  const locked = mode === 'scale' && inspector.isScaleLocked ? ' — X/Y/Z locked together' : ''
  // The buttons are disabled without a selection, but W/E/R can still arm a
  // mode ahead of one, so say what is still missing.
  status(
    selection.size === 0
      ? `${MODE_LABELS[mode]} gizmo on${locked} — select a node to use it.`
      : `${MODE_LABELS[mode]} gizmo on${locked}.`,
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

/**
 * Push the primary's change onto every other selected node.
 *
 * `mode` is passed rather than read off the gizmo because the immersive grab
 * drives this too, and it is always a translate whatever mode the (detached)
 * gizmo happens to be armed in.
 */
function applyDragToFollowers(primary: GvNode, mode: DragMode) {
  if (followerStart.size === 0 || !primaryStart) return
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

/**
 * Everything the inverse topology math needs about the node's PARENT, resolved
 * once per drag tick.
 *
 * Shared by the mouse gizmo's translate drag and the immersive grab (see
 * `xrGrabMove`): both move a frame and then have to say what that motion means
 * in the node's own CSV coordinates, and there must be exactly one statement of
 * how that is read.
 */
interface TranslateDragContext {
  parentGv: GvNode | null
  gridParent: GvNode | null
  gridGlobe: boolean
  parentTopo: number
  parentRatio: number
  baseScale: number
  topoScale: number
}

function translateDragContext(node: GvNode): TranslateDragContext {
  const parentGv = parentOf(node)
  // Children of a World Grid invert through geography, regardless of the
  // grid row's own topo field: a globe is exactly the Sphere topology at
  // radius 180/π; a flat grid is Cartesian recentered on the window midpoint.
  const gridParent = parentGv?.type === NodeType.WorldGrid ? parentGv : null
  const gridGlobe = gridParent !== null && gridIsGlobe(gridParent)
  return {
    parentGv,
    gridParent,
    gridGlobe,
    parentTopo: gridParent
      ? gridGlobe
        ? Topo.Sphere
        : Topo.None
      : parentGv
        ? parentGv.topo
        : -1,
    parentRatio: gridParent ? 0 : (parentGv?.ratio ?? 0),
    // A globe grid's children place at the geographic radius, which the Global
    // Scale plays no part in; everything else inverts through the live value
    // the frame was placed with.
    baseScale: gridGlobe ? GRID_GLOBE_RADIUS : baseScale(),
    // The parent's Topology Scale, divided back out per axis by the inversion
    // so a retuned parent's children still track the pointer 1:1 (grid parents
    // are exempt on both sides, which parentTopoScale answers with 1.0).
    topoScale: parentTopoScale(parentGv),
  }
}

/** The frame's current position, read back as the node's own translate. */
function invertFrameTranslate(node: GvNode, frame: THREE.Object3D, ctx: TranslateDragContext): Vec3 {
  const inverted = invertTopoOffset({
    parentTopo: ctx.parentTopo,
    offset: ctx.gridParent ? gridOffsetSpace(frame.position, ctx.gridParent) : frame.position,
    prev: node.translate, // last committed tick — keeps unwrap continuous
    parentRatio: ctx.parentRatio,
    subspace: node.subspace,
    baseScale: ctx.baseScale,
    parentTopoScale: ctx.topoScale,
  })
  if (ctx.gridParent && !ctx.gridGlobe) {
    // Cartesian inversion recovered the window-relative offset; translate
    // fields are absolute lon/lat.
    const c = gridCenter(ctx.gridParent)
    inverted.x += c.lon
    inverted.y += c.lat
  }
  return inverted
}

gizmo.addEventListener('objectChange', () => {
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  const frame = gizmo.object
  if (!node || !frame) return
  const ctx = translateDragContext(node)
  const parentGv = ctx.parentGv

  // Live re-read of the primary + followers while a drag is in flight.
  const showDragged = () => {
    applyDragToFollowers(node, gizmo.mode as DragMode)
    const nodes = selectedNodes()
    inspector.show(nodes, nodes.length === 1 ? worldPosOf(node.id) : null)
  }

  if (gizmo.mode === 'scale') {
    if (inspector.isScaleLocked && primaryStart) {
      // Locked: whichever bar was grabbed, its factor goes on all three, so a
      // non-uniform glyph keeps its proportions (desktop `_apply_axis_deltas`,
      // whose size branch spreads the first delta over x/y/z, clamping each
      // result at 0.001). Re-derived from the drag-start scale every tick, like
      // the followers, so a long drag cannot drift.
      const factor = uniformScaleFactor(primaryStart.scale, frame.scale)
      for (const axis of ['x', 'y', 'z'] as const) {
        node.scale[axis] = Math.max(MIN_DRAG_SCALE, primaryStart.scale[axis] * factor)
      }
      // Snap the handles to what was actually written — TransformControls
      // recomputes from its own drag-start copy each move, so overwriting the
      // frame here is safe and is what makes the lock visible while dragging.
      frame.scale.set(node.scale.x, node.scale.y, node.scale.z)
    } else {
      node.scale.x = frame.scale.x
      node.scale.y = frame.scale.y
      node.scale.z = frame.scale.z
    }
    // The glyph's own draw scale is DERIVED from node.scale — the opt-in
    // minimum size, the Global Scale and a Rod's proportions all live there —
    // so re-derive it rather than let it ride the frame we just wrote. The
    // immersive grab (`xrGrabApplySize`) has always done this; without it a
    // glyph dragged past the minimum keeps shrinking until the release commits.
    const glyph = frame.children.find((c) => c.userData.isGlyph)
    if (glyph) applyGlyphDrawScale(glyph, node)
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
      ctx.parentTopo,
      dragStartTranslate,
      ctx.gridParent ? gridOffsetSpace(motion, ctx.gridParent) : motion,
      ctx.parentRatio,
      node.subspace,
      ctx.baseScale,
      ctx.topoScale,
    )
  }

  const inverted = invertFrameTranslate(node, frame, ctx)
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

/**
 * The Create panel's placement settings — how far apart auto-placed new objects
 * sit and what translate_z they take. Desktop `_placement_step` /
 * `_placement_z`; the lattice they feed is `gv/placement.ts`.
 */
function readPlacement(): PlacementSettings {
  const num = (input: HTMLInputElement, fallback: number) => {
    const v = Number(input.value)
    return Number.isFinite(v) ? v : fallback
  }
  return {
    step: Math.abs(num(placementStepInput, DEFAULT_PLACEMENT.step)),
    rootZ: num(placementRootZInput, DEFAULT_PLACEMENT.rootZ),
    childZ: num(placementChildZInput, DEFAULT_PLACEMENT.childZ),
  }
}

/** The desktop's `%g` on a step: no trailing zeros, no exponent in this range. */
const fmtStep = (v: number) => String(Number(v.toFixed(6)))

/**
 * Keep the Placement Step tooltip showing what the CURRENT step actually buys —
 * the row width is a consequence of the number typed, and "wraps at 360" means
 * nothing until you know it is 72 objects (desktop `_update_step_tip`).
 */
function updatePlacementStepTip(): void {
  const step = readPlacement().step
  const row =
    step > 0
      ? `At ${fmtStep(step)}, a row holds ${columnsPerRow(step)} object(s) before wrapping.`
      : '0 stacks every new object at the same spot.'
  placementStepRow.title =
    'How far apart consecutive auto-placed objects sit (N / Shift+N / New Node / New Child / paste).\n' +
    `translate_x steps by this much; when it would reach ${PLACEMENT_WRAP}, it restarts at 0 and ` +
    'translate_y takes the step instead — so objects array into a grid on a Cartesian parent, and ' +
    'start a new ring instead of overlapping on a Sphere/Torus/Cylinder parent.\n' +
    `${row}\nANTz used a fixed 15.`
}

placementStepInput.addEventListener('input', () => {
  updatePlacementStepTip()
  const step = readPlacement().step
  status(
    step > 0
      ? `Placement Step ${fmtStep(step)} — ${columnsPerRow(step)} object(s) per row, then translate_y ` +
          'steps to the next row.'
      : 'Placement Step 0 — new objects will stack at the parent’s origin.',
  )
})
updatePlacementStepTip()

function addChildOfSelection() {
  const parent = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (!parent) return
  currentNodes.push(
    createChildNode(currentNodes, parent, readNewObjectDefaults(), readPlacement()),
  )
  rebuildScene(false) // parent stays selected so repeated presses spread children
}

function addNode() {
  // Desktop N semantics: child when a child-level node is selected.
  const selected = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (selected && selected.branchLevel >= 1) {
    addChildOfSelection()
    return
  }
  const node = createRootNode(currentNodes, readNewObjectDefaults(), readPlacement())
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
/** Totals since Draw Mode was switched on. The per-stroke counters above are
 *  reset by each report; the VR Draw page shows a running total instead, since
 *  a headset never sees the status line that report goes to. */
let drawStrokeTotalStamps = 0
let drawStrokeTotalNodes = 0
/** A stamp landed and the scene has not been rebuilt for it yet. */
let drawRebuildPending = false
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
  xrStroke = null
  // The VR Draw page's report counts what THIS spell of drawing produced, so
  // arming the mode starts it over.
  drawStrokeTotalStamps = 0
  drawStrokeTotalNodes = 0
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
 * One rebuild per animation frame however many stamps land in it. A drag at the
 * default spacing fires several stamps a second and rebuildScene rebuilds the
 * whole graph, so the work is coalesced — the trade the Global Scale slider
 * makes, for the same reason.
 *
 * Coalesced onto THIS APP'S animation loop rather than onto
 * `requestAnimationFrame`, which is the fix for a bug Jeff found in a headset
 * (2026-08-27): the page's own rAF stops firing while an immersive session is
 * presenting — frame callbacks come from `XRSession.requestAnimationFrame`
 * instead — so the queued rebuild never ran and a stroke's objects all appeared
 * at once when the trigger was RELEASED and `finishDrawStroke` flushed it
 * synchronously. The animation loop runs in both modes (three drives it from
 * the session while presenting and from window rAF otherwise), so one flag
 * checked there is correct on a desk and in a headset with no branch.
 *
 * The emulator does not reproduce the fault, since iwer runs the session in the
 * page and leaves window rAF firing. That is why this needed a device.
 */
function requestDrawRebuild(): void {
  drawRebuildPending = true
}

/** Called once per animation frame, before anything reads the scene. */
function flushDrawRebuild(): void {
  if (!drawRebuildPending) return
  drawRebuildPending = false
  rebuildScene(false)
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
  appendNodes(nodes)
  drawStrokeStamps++
  drawStrokeTotalStamps++
  drawStrokeNodes += nodes.length
  drawStrokeTotalNodes += nodes.length
  requestDrawRebuild()
}

// --- Draw Mode in a headset ----------------------------------------------------
// The same mode, the same rules and the same functions as the mouse version
// above: `gridHit` already took a RAY and `placeStamp`/`shouldStamp` were
// already pure, which is why this is a gesture and a cursor rather than a
// second Draw Mode.
//
// Three things had to be decided rather than ported, since the desktop has no
// controller:
//
//  - SPACING is measured in the grid's own child coordinates, not in pixels of
//    travel. See DRAW_SPACING_STEP in ui/xrPropertiesModel.ts — the short of it
//    is that a person drawing in a headset cannot judge their own distance to
//    the plane, so an angular spacing would make the same stroke come out
//    differently for an invisible reason.
//  - The stroke rides the trigger's EXISTING claim mechanism (onPick returns
//    true, then onDragRay/onDragEnd), so xrSession's button logic needed no
//    change at all.
//  - The CURSOR is the P6 reticle, fed a synthetic hit at the grid plane. That
//    is what makes "where will this land" visible before the trigger, which is
//    the whole reason the pointer work came first.

/** Spacing between stamps in the grid's own units — VR only, see above. */
let xrDrawSpacing = DRAW_SPACING_DEFAULT
/** The stroke in progress: the last stamped grid coordinate, or null. */
let xrStroke: { lon: number; lat: number } | null = null

/** The grid this stamp lands on, and its frame, or a reason it cannot. */
function xrDrawTarget(): { grid: GvNode; frame: THREE.Object3D } | null {
  const grid = drawTargetGrid()
  if (!grid || gridIsGlobe(grid)) return null
  const frame = currentFrames?.get(grid.id)
  if (!frame) return null
  // A frame built since the last render pass has no world matrix yet, and a
  // stamp is routinely the very next thing after a rebuild. Ancestors only.
  frame.updateWorldMatrix(true, false)
  return { grid, frame }
}

/** Where the ray meets the grid's drawing plane, in the grid's child
 *  coordinates, or null. */
function xrGridHit(raycaster: THREE.Raycaster): { lon: number; lat: number } | null {
  const target = xrDrawTarget()
  if (!target) return null
  return gridHit(raycaster.ray, target.grid, target.frame, xrDrawZ())
}

function xrDrawZ(): number {
  return Number(drawZInput.value) || 0
}

/**
 * The pointer cursor while Draw Mode is on: a reticle lying on the grid's
 * drawing plane exactly where a stamp would land. Built as an ordinary
 * `XrPointerHit`, so the beam shortens to the plane and the ring lies flat on
 * it with no new drawing code — the pointer already does all of that for a
 * panel.
 */
function xrDrawCursorHit(raycaster: THREE.Raycaster): XrPointerHit | null {
  const target = xrDrawTarget()
  if (!target) return null
  const drawZ = xrDrawZ()
  const hit = gridHit(raycaster.ray, target.grid, target.frame, drawZ)
  if (!hit) return null
  const point = gridChildWorld(target.grid, target.frame, hit.lon, hit.lat, drawZ)
  return {
    distance: raycaster.ray.origin.distanceTo(point),
    point,
    // The plane's own normal — its grid-local +Z carried into the world by the
    // frame, so the ring lies ON the surface however the grid is tilted.
    normal: new THREE.Vector3(0, 0, 1).transformDirection(target.frame.matrixWorld).normalize(),
    // Always 'widget': the cursor is over a place a press will DO something,
    // which is exactly what that state means on a panel.
    target: 'widget',
  }
}

/**
 * World position of a point in a flat grid's child coordinates — the forward
 * direction of `gridHit`'s inversion, and buildScene's `framePosition` rule for
 * a flat grid child: the grid's own scale re-spaces its children rather than
 * living on its frame (the ANTz Grid rule), so it is multiplied back in.
 */
function gridChildWorld(
  grid: GvNode,
  frame: THREE.Object3D,
  lon: number,
  lat: number,
  z: number,
): THREE.Vector3 {
  const center = gridCenter(grid)
  return new THREE.Vector3(
    (lon - center.lon) * grid.scale.x,
    (lat - center.lat) * grid.scale.y,
    z * grid.scale.z,
  ).applyMatrix4(frame.matrixWorld)
}

/** Trigger down with Draw Mode on: plant the first stamp and claim the drag. */
function beginXrStroke(raycaster: THREE.Raycaster): boolean {
  const grid = drawTargetGrid()
  // The mode is meaningless without a target, so a gridless scene gets one —
  // the same rule entering the mode follows.
  // addWorldGrid rebuilds for itself, which is what gives the new grid a frame
  // for xrGridHit to read a world matrix off.
  if (!grid) {
    addWorldGrid()
  } else if (gridIsGlobe(grid)) {
    status(`Grid ${grid.id} is a globe — Draw Mode draws on flat grids only.`)
    return false
  }
  const hit = xrGridHit(raycaster)
  if (!hit) return false
  xrStroke = hit
  xrDrawStampAt(hit)
  return true
}

/** Trigger held: stamp again once the ray has swept a spacing's worth of grid. */
function xrStrokeMove(raycaster: THREE.Raycaster): void {
  const hit = xrGridHit(raycaster)
  if (!hit) return
  if (!shouldStamp(xrStroke && { x: xrStroke.lon, y: xrStroke.lat }, hit.lon, hit.lat, xrDrawSpacing))
    return
  xrStroke = hit
  xrDrawStampAt(hit)
}

function endXrStroke(): void {
  xrStroke = null
  finishDrawStroke()
}

/** One stamp, at a grid coordinate the caller has already resolved. */
function xrDrawStampAt(hit: { lon: number; lat: number }): void {
  const grid = drawTargetGrid()
  if (!grid) return
  const nodes = drawStampNodes(grid, nextNodeId(currentNodes))
  if (nodes.length === 0) return
  placeStamp(
    nodes,
    grid.branchLevel + 1,
    hit.lon,
    hit.lat,
    xrDrawZ(),
    Number(drawHeadingJitterInput.value) || 0,
    Number(drawScaleJitterInput.value) || 0,
  )
  appendNodes(nodes)
  drawStrokeStamps++
  drawStrokeTotalStamps++
  drawStrokeNodes += nodes.length
  drawStrokeTotalNodes += nodes.length
  requestDrawRebuild()
}

/** What the Draw page shows, and the four settings it edits. */
function xrDrawData(): XrDrawData {
  const grid = drawTargetGrid()
  return {
    drawing: drawMode,
    gridId: grid?.id ?? null,
    gridIsGlobe: grid ? gridIsGlobe(grid) : false,
    brushes: ['Single Object', ...drawBrushes.map((r) => r.name || 'Template')],
    brushIndex: drawStampSelect.value === '' ? 0 : Number(drawStampSelect.value) + 1,
    drawZ: xrDrawZ(),
    spacing: xrDrawSpacing,
    headingJitter: Number(drawHeadingJitterInput.value) || 0,
    scaleJitter: Number(drawScaleJitterInput.value) || 0,
    stamps: drawStrokeTotalStamps,
    nodes: drawStrokeTotalNodes,
  }
}

function finishDrawStroke(): void {
  drawStrokeLast = null
  controls.enabled = !flyRig.flyMode
  if (drawStrokeStamps === 0) return
  // Flush the coalesced rebuild so the stroke is on screen with its report,
  // rather than a frame later.
  flushDrawRebuild()
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
  const { pasted, droppedLinks } = pasteSubtree(
    currentNodes,
    clipboard,
    selectedNode(),
    readPlacement(),
  )
  if (pasted.length === 0) return status('Nothing to paste.')
  appendNodes(pasted)
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
  // The desktop greys its File ▸ Save Selection As… action the same way, off
  // the same signal (_on_table_selection). Unlike the gizmo modes there is no
  // sticky state to preserve here — the command needs a selection to have a
  // meaning at all.
  saveSelectionButton.disabled = selection.size === 0
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
    appendNodes(nodes)
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
  status,
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
    appendNodes(nodes)
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

// --- Epitrochoid Generator (Ctrl+Shift+E) --------------------------------------
// Ported from the desktop's Tools ▸ Epitrochoid Generator… dialog. The engine is
// src/gv/epicycles.ts (diffed against the desktop's own `epicycles.py` in
// epicycles.parity.test.ts) and the traced curve src/render/epicyclePath.ts; the
// window is src/ui/epicycleWindow.ts. What is here is the insertion and the
// files, which are the two things the host owns on both sides.

const epicycleWindow = new EpicycleWindow({
  // Desktop `_insert_into_scene`: ROOTS, deliberately, and unlike the other two
  // tool windows — the hub and the trail parent are two independent roots, and
  // the trail's beads are Cartesian world positions that only mean anything at
  // the top level. Dropping the chain under a selected node would put the pen
  // in one coordinate system and its own traced path in another.
  insert(design, path) {
    const nodes = buildEpicycleNodes(design, {
      startId: nextNodeId(currentNodes),
      parentId: 0,
      includeWorld: false,
      path,
    })
    if (nodes.length === 0) return
    appendNodes(nodes)
    rebuildScene(false)
    setSelection(nodes[0].id)
    status(
      `Epitrochoid Generator: inserted ${nodes.length} nodes ` +
        `(ids ${nodes[0].id}-${nodes[nodes.length - 1].id})`,
    )
  },
  saveScene(design, path) {
    writeEpicycleScene(design, path)
  },
  status,
})
app.appendChild(epicycleWindow.element)
epicycleButton.addEventListener('click', () => epicycleWindow.toggle())

/**
 * The desktop writes a scene FOLDER; a browser writes downloads, so the files
 * arrive one by one under a shared stem and putting them in a folder of their
 * own is the user's step — the same trade Save Selection and Save PNG already
 * make. The status line says so rather than leaving it to be discovered,
 * because GlyphViz auto-loads Channels only when it finds exactly ONE ch-map
 * and one ch-tracks file beside the node CSV: two candidates in a directory
 * disable Channels entirely, and silently.
 *
 * Labels go to the companion tag file rather than into inline `text` columns —
 * the desktop's epicycle writer has no text column at all, and it is the same
 * rule the Save button follows for a scene that was authored that way.
 */
function writeEpicycleScene(design: EpicycleDesign, path: readonly Vec3[]) {
  const stem = epicycleSlug(design.name || 'epitrochoid')
  const frames = epicycleFrameCount(design)
  const nodes = buildEpicycleNodes(design, { startId: 1, includeWorld: true, path })

  const written = [`${stem}_gv_node.csv`, `${stem}_gv_tag.csv`]
  download(writeGvNodeCsv(nodes, { inlineLabels: false }), written[0])
  download(writeGvTagCsv(nodes), written[1])

  if (design.selfDrawing) {
    const channels = buildChannels(design, frames)
    written.push(`${stem}_gv_ch-map.csv`, `${stem}_gv_ch-tracks.csv`)
    download(writeChMapCsv(channels), written[2])
    download(writeChTracksCsv(channels, frames), written[3])
  }

  status(
    `Epitrochoid Generator: saved ${written.length} files (${written.join(', ')}) — ` +
      'put them in one folder of their own, then drop that folder on the window' +
      (design.selfDrawing ? '; press Space to watch the curve draw itself.' : '.'),
  )
}

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
    const node = createRootNode(
      currentNodes,
      { ...MESH_NODE_DEFAULTS, meshId: asset.id },
      readPlacement(),
    )
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

/**
 * Extensions a DROP routes to the point-cloud importer.
 *
 * The desktop's own `drop_router.POINT_CLOUD_EXTS` exactly, and deliberately
 * narrower than the importer's SUPPORTED_EXTENSIONS: .ply stays a mesh on drop,
 * and .txt/.csv stay scene files. Derived from that list rather than restated,
 * so a format added to the importer cannot silently fail to be droppable.
 */
const DROPPED_CLOUD_EXTENSIONS = POINT_CLOUD_EXTENSIONS.filter(
  (ext) => ext !== '.ply' && ext !== '.txt',
)

function isDroppedPointCloud(name: string): boolean {
  return (
    isPointCloudFileName(name) &&
    (DROPPED_CLOUD_EXTENSIONS as readonly string[]).some((ext) => name.toLowerCase().endsWith(ext))
  )
}

// --- Import Point Cloud ---------------------------------------------------------
//
// Desktop Meshes > Import Point Cloud… (_load_point_cloud_path), replumbed for a
// browser: the window (ui/pointCloudWindow.ts) scans the file, collects the
// options and builds the nodes; this side puts them into the scene.
//
// The cloud is APPENDED, never a replacement — a scan is nearly always context
// for something else (sensors placed in a building, per-tree glyphs over a
// canopy), so replacing the scene would be the wrong default and, with no undo
// anywhere in this app, an unrecoverable one. The desktop routes that through
// its Ctrl+M merge; here the loader mints its own ids from nextNodeId() and the
// nodes reference nothing but each other, so there is nothing to renumber.

const pointCloudWindow = new PointCloudWindow({
  onApply: applyPointCloudImport,
  nextNodeId: () => nextNodeId(currentNodes),
})

function applyPointCloudImport(payload: PointCloudApplyPayload) {
  const { nodes, report } = payload
  const parent = nodes[0]
  appendNodes(nodes)
  rebuildScene(false)
  setSelection(parent.id)

  // Frame the cloud, the desktop's focus_on_node — an imported scan lands in
  // world units near the origin, which may be nowhere near where the camera is
  // pointing at a scene it was already looking at.
  const pos = worldPosOf(parent.id)
  if (pos) {
    controls.target.copy(pos)
    snapCameraGoal()
    controls.update()
  }

  const dropped = report.totalPoints - report.points
  const sampled =
    dropped > 0
      ? ` (${report.decimation} sample of ${report.totalPoints.toLocaleString('en-US')})`
      : ''
  status(
    `Imported ${report.points.toLocaleString('en-US')} points from ${payload.fileName}, ` +
      `coloured by ${report.colorMode}${sampled} — node ${parent.id}.`,
  )
}

/**
 * Open the import window for one file.
 *
 * Named rather than called inline because the drop router reaches it from
 * ~1,900 lines up, where `pointCloudWindow.open(...)` would say nothing about
 * what a dropped scan is about to do. Errors need no handling here: the window
 * scans asynchronously and reports a file it cannot read in its own body, which
 * is where someone looking at that file is already looking.
 */
function importPointCloudFile(file: File): void {
  pointCloudWindow.open(file)
}

importCloudInput.addEventListener('change', () => {
  const file = importCloudInput.files?.[0]
  importCloudInput.value = ''
  if (file) importPointCloudFile(file)
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
  selectionPanel.setTagStyle(tagStyle.mode, tagStyle.rgb, tagStyle.fontSize)
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
/** Which node the immersive follow is riding, and where it was last frame —
 *  the XR branch tracks by DELTA, so it needs the previous position and has to
 *  notice when the selection has moved to a different node entirely. */
let xrFollowId: number | null = null
const xrFollowLast = new THREE.Vector3()

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
  if (!node) {
    xrFollowId = null
    return
  }
  const pos = worldPosOf(node.id)
  if (!pos) return
  if (xrRig.presenting) return applyXrFollow(node.id, pos)
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
  // _apply_follow_target). So the pivot still JUMPS: actual and goal are put on
  // the same point, leaving the filter nothing to chase.
  //
  // But follow owns the PIVOT ONLY. A snapCameraGoal() here would re-point the
  // azimuth/elevation/distance goals at the LAGGING actual — and since this runs
  // every frame from the animation loop, before applyCameraSmoothing, it erased
  // an in-progress drag's aim on the very next frame and the camera did not move
  // at all (desktop bug, fixed b156103). The delta above moved eye and pivot
  // together, so those three quantities are untouched here by construction.
  camSmoothing.goal.target = [pos.x, pos.y, pos.z] // fresh array: goal must never alias
}

/**
 * Follow Selected in a headset. Two behaviours, which are the two halves of
 * what the desktop's pivot re-centring does when you read it as a viewer rather
 * than as a camera:
 *
 *   the selection CHANGED  travel to the new node (a dash, or a blink for a
 *                          long hop). This is the "point at a node and you are
 *                          there" that immersive follow exists for.
 *   the node MOVED         translate the rig by the node's own delta. Zero
 *                          relative motion, so a node animating under Channels
 *                          holds its place in the view with none of the vection
 *                          that chasing it would produce.
 *
 * What it deliberately does NOT do is re-fit every frame. That would fight the
 * viewer for the same offset and undo any flight, grab or turn the moment it
 * began — which is the desk bug of roadmap 6cc in this platform's dialect, and
 * the reason the tracking half is a delta and nothing else.
 */
function applyXrFollow(nodeId: number, pos: THREE.Vector3) {
  // A grab is an EDIT: the viewer is moving the node, and travelling to it at
  // the same time would chase their own hand (the gizmo rule above, in VR).
  if (xrGrab !== null) return
  if (nodeId !== xrFollowId) {
    xrFollowId = nodeId
    xrFollowLast.copy(pos)
    goToSelection(false)
    return
  }
  followDelta.copy(pos).sub(xrFollowLast)
  if (followDelta.lengthSq() === 0) return
  xrFollowLast.copy(pos)
  xrRig.nudgeNav(followDelta)
}

function setFollowSelected(value: boolean) {
  // Follow pins the pivot to a node every frame; flight translates it every
  // frame. Entering Camera Mode clears Follow (desktop set_fly_mode), so
  // turning Follow on mid-flight takes the same interlock in reverse —
  // rather than the desktop's accident of letting the two fight per frame.
  if (value && flyRig.flyMode) setCameraMode(false)
  followSelected = value
  followCheckbox.checked = value
  // Forget which node was being ridden either way: turning follow ON should
  // travel to the selection even if it is the same node the last session of
  // following left off at, and turning it off must not leave a stale anchor for
  // the next one to measure a delta against.
  xrFollowId = null
  if (!value) return status('Follow off.')
  const node = followNode()
  applyFollowTarget() // jump now rather than on the next animation frame
  if (xrRig.presenting) {
    return status(
      node ? `Following node ${node.id} — travelling on every selection.` : 'Follow on — select a node to follow.',
    )
  }
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
  // Nothing asked for means an EMPTY world, not an example: the app opens on
  // the user's own scene-to-be. A built-in is one click of the dropdown away,
  // and ?scene= still deep-links one directly.
  if (match) loadBuiltIn(match)
  else loadEmptyScene()
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
  // Stamps that landed since the last frame, before anything below reads the
  // scene: a stroke has to appear AS it is drawn, on a desk and in a headset
  // alike. (This is the loop that runs in both — see requestDrawRebuild.)
  flushDrawRebuild()
  // A channel frame or a gizmo drag rewrites node fields without a rebuild, so
  // the table's visible rows have to be repainted from them. Only the ~30 rows
  // on screen are touched, and nothing at all while the panel is collapsed.
  const nodesMoved = tickAnimation(dtMs) || gizmo.dragging || xrGrab !== null
  if (nodesMoved) nodeTable.refreshVisible()

  // Immersive mode drives the camera from the headset, so every desktop camera
  // path stands aside for it — following would fight the rig for the same
  // position, and OrbitControls has no pointer to read.
  const presenting = xrRig.presenting
  if (presenting) {
    // BEFORE the rig's own update, not after: follow writes the rig's nav (a
    // delta, or a travel request), and update is what reads that, folds this
    // frame's locomotion in and pushes the result onto the scene graph. The
    // other way round the group's matrices would be a frame behind everything
    // that reads them — the head proxy the light and the backdrop aim off, and
    // the ray the pointer casts.
    applyFollowTarget()
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
  currentClouds?.update()
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
    tagFontSize: tagStyle.fontSize,
    points: currentClouds,
    cloudParents,
  }
  // A SELECTED cloud point labels, but selection does not rebuild the scene, so
  // those cannot be in the cached list above and are gathered per frame — the
  // desktop's own arrangement. Normally a handful; a rubber band over 50k points
  // makes it 50k, which is exactly what the user asked to see. Skipped entirely
  // when labels are off, when the scene has no cloud, or when nothing is
  // selected, which is every existing scene.
  const labelNodes =
    showTags && cloudParents.size > 0 && selection.size > 0
      ? taggableNodes.concat(
          selection.ids
            .map((id) => nodesById.get(id))
            .filter(
              (n): n is GvNode =>
                n !== undefined && n.showText === 0 && cloudParents.has(n.parentId),
            ),
        )
      : taggableNodes
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
    updateXrProperties()
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
        labels.paint(labelNodes, currentFrames, eyeCamera, labelState, {
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
    if (currentFrames) labels.render(labelNodes, currentFrames, camera, labelState)
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
  epicycleWindow.renderFrame(dtMs)
})
