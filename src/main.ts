import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { cycleGeometry, cycleTargets, cycleTopology } from './gv/attrCycle'
import { cycleColorIndex, cyclePalette, PALETTE_NAMES } from './gv/colorPalette'
import { createChildNode, createRootNode, NEW_OBJECT_DEFAULTS } from './gv/createNode'
import type { NewObjectDefaults } from './gv/createNode'
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
import type { MediaIndex } from './gv/media'
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
import { GEOMETRY_NAMES, Geometry, NodeType, TagColorMode, TOPO_NAMES, Topo } from './gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridIsGlobe } from './gv/worldGrid'
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
import { applyFrameTransform, BASE_SCALE, buildScene, frameBaseRotation } from './render/buildScene'
import type { SceneBuildResult } from './render/buildScene'
import { DynamicNodes } from './render/dynamicNodes'
import { clearMaterialCache } from './render/glyphGeometry'
import { LabelOverlay, pinnedTagNodes } from './render/labelOverlay'
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
import { nodeIdsInRect } from './render/rectSelect'
import {
  applyRenderMode,
  RENDER_MODE_COUNT,
  RENDER_MODE_NAMES,
  RenderMode,
} from './render/renderMode'
import { invertLocalRotation } from './render/rotationInverse'
import { invertTopoOffset, pickDominantField } from './render/topologyInverse'
import { ChannelsPanel, DEFAULT_CHANNEL_FPS } from './ui/channelsPanel'
import { FpsMeter } from './ui/fpsMeter'
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
}

// GlyphViz worlds are Z-up (ANTz convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

const app = document.querySelector<HTMLDivElement>('#app')!

// Logarithmic depth lets the near plane sit at ~0 (so the camera can enter
// glyphs — z-topologies place children inside the parent) without z-fighting
// at the far end of large scenes.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
applyDesktopColorPipeline(renderer)
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

const controls = new OrbitControls(camera, renderer.domElement)
// No damping: the camera stops dead when the mouse button comes up. Inertial
// glide reads as lag on big scenes, where a low frame rate stretches the
// spin-down out over many seconds.
controls.enableDamping = false

// Desktop-style procedural backdrop: the "infinite" reference grid (hidden
// once the scene contains a real World Grid) and the RGB origin axes.
const backdrop = new Backdrop()
scene.add(backdrop.group)

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
    <div id="hud-create-buttons">
      <button id="hud-new-node" title="New object at the world origin, stepping +10 in X per press. If a child-level node is selected, adds a child instead.">New Node (N)</button>
      <button id="hud-new-child" title="New child under the selected node; repeated presses spread children along X." disabled>New Child (Shift+N)</button>
    </div>
    <div class="hud-create-row"><span>Geometry</span><select id="hud-new-geo"></select></div>
    <div class="hud-create-row"><span>Topology</span><select id="hud-new-topo"></select></div>
    <div class="hud-create-row"><span>Scale</span><input id="hud-new-scale" type="number" min="0.001" step="0.1" value="1"></div>
    <div class="hud-create-row"><span>Color</span><input id="hud-new-color" type="color" value="#c8c8c8"></div>
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
    <label id="hud-follow" class="sel-check" title="Keep the camera centred on the selected node as it moves  [F]&#10;Orbit and zoom stay live while following; panning is overridden.">
      <input type="checkbox">Follow Selected (F)
    </label>
    <label id="hud-show-fps" class="sel-check" title="Frame rate, this app's CPU time per frame, and the draw calls and triangles the last frame sent to the GPU.&#10;Shown bottom-left; switch it off for a clean screengrab.">
      <input type="checkbox" checked>Show FPS
    </label>
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
const newGeoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-geo')!
const newTopoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-topo')!
const newScaleInput = hud.querySelector<HTMLInputElement>('#hud-new-scale')!
const newColorInput = hud.querySelector<HTMLInputElement>('#hud-new-color')!
const deleteButton = hud.querySelector<HTMLButtonElement>('#hud-delete')!
const bgColorInput = hud.querySelector<HTMLInputElement>('#hud-bg-color')!
const bgBwButton = hud.querySelector<HTMLButtonElement>('#hud-bg-bw')!
const showGridCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-grid input')!
const showAxesCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-axes input')!
const gridColorInput = hud.querySelector<HTMLInputElement>('#hud-grid-color')!
const renderModeSelect = hud.querySelector<HTMLSelectElement>('#hud-render-mode')!
const followCheckbox = hud.querySelector<HTMLInputElement>('#hud-follow input')!
const showFpsCheckbox = hud.querySelector<HTMLInputElement>('#hud-show-fps input')!

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
  const blob = new Blob([text], { type })
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
  onNodesEdited(nodes) {
    // The mutated nodes live in currentNodes; rebuild in place, keeping the
    // camera and reattaching the selection + inspector.
    rebuildScene(false)
    // A texture_id edit can name a file the scene never referenced, so nothing
    // decoded it at load. Fetch it now; that lands with a second rebuild.
    void decodeTexturesFor(
      nodes.map((n) => n.textureId),
      sceneEpoch,
    )
  },
})
app.appendChild(inspector.element)

// Bottom-left, directly above the status line — the desktop keeps its FPS
// label in the status bar too. On permanently by default, like the desktop's.
const fpsMeter = new FpsMeter()
app.appendChild(fpsMeter.element)
showFpsCheckbox.addEventListener('change', () => {
  fpsMeter.visible = showFpsCheckbox.checked
})

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
    dynamic?.update()
  },
  seek(frame: number) {
    channelFrame = frame
    frameCarry = 0
    applyChannelFrame(channels, frame)
    channelsPanel.setFrame(frame)
    if (channelAudio.loaded && channels.frameCount > 1) {
      channelAudio.seekFraction(frame / (channels.frameCount - 1))
    }
    dynamic?.update()
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

  if (changed) dynamic?.update()
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

function rebuildScene(fitCamera: boolean) {
  const prevSelected = new Set(selection.ids)
  const built = buildScene(currentNodes, { showHidden, textures: currentTextures.byId })
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
  const pixelWidth = window.innerWidth * window.devicePixelRatio
  const pixelHeight = window.innerHeight * window.devicePixelRatio
  currentLinks.setResolution(pixelWidth, pixelHeight)
  currentOverlays.setResolution(pixelWidth, pixelHeight)
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
  // Pinned labels draw whatever the Labels settings say, so the overlay needs
  // this list even with labels off. An inspector edit to show_text lands here.
  pinnedTags = pinnedTagNodes(currentNodes)
  nodesById = new Map(currentNodes.map((n) => [n.id, n]))
  // Before any setSelection below: orderedIds resolves the primary through the
  // table's display order, which has to be describing THIS node list.
  nodeTable.setNodes(currentNodes)
  // A real World Grid replaces the procedural reference grid as the plane
  // of reference (its lattice has meaningful spacing; the backdrop's not).
  backdrop.showReferenceGrid = !currentNodes.some((n) => n.type === NodeType.WorldGrid)

  // Rate candidates follow the CSV, so an inspector edit to a rate field (which
  // always ends here) has to be able to add or drop a node from the tick list.
  rateNodes = rateCandidates(currentNodes, channels.rateBoundNodeIds)
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
    },
    currentTextures.byId,
  )

  const mediaCount = currentMedia?.index.entries.length ?? 0
  const notes = [
    `${currentNodes.length} node(s)`,
    `${built.drawnCount} drawn`,
    ...(currentLinks.count > 0 ? [`${currentLinks.count} link edge(s)`] : []),
    ...(built.overlays.plotCount > 0 ? [`${built.overlays.plotCount} plot line(s)`] : []),
    ...(built.overlays.quadCount > 0
      ? [`${built.overlays.surfaceCount} surface(s), ${built.overlays.quadCount} quad(s)`]
      : []),
    ...(labelNote ? [labelNote] : []),
    ...(mediaCount > 0 ? [`${mediaCount} media file(s)`] : []),
    ...(textureNote ? [textureNote] : []),
    ...(channelNote ? [channelNote] : []),
  ]
  hudScene.textContent = `${currentDisplayName} — ${notes.join(', ')}`
  showMessages(parseErrorLines, [...parseWarningLines, ...built.warnings])

  if (fitCamera) {
    setSelection(null)
    fitCameraTo(currentRoot)
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
    return
  }
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const distance = Math.max(1, (sphere.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.2)
  const dir = new THREE.Vector3(0.7, -1, 0.55).normalize()
  camera.position.copy(center).addScaledVector(dir, distance)
  camera.near = 0.001
  camera.far = Math.max(1000, distance * 100)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
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

async function loadSceneCandidate(scene: SceneCandidate) {
  const nodeFile = openedFiles.get(scene.nodePath)
  if (!nodeFile) return
  try {
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
    showMessages(
      [
        files.length === 0
          ? 'Nothing to open.'
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
  controls.enabled = true
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

function pickAt(clientX: number, clientY: number): number | null {
  if (!currentRoot) return null
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  return pickNodeId(raycaster, currentRoot)
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
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
  downAt = { x: e.clientX, y: e.clientY }
})
renderer.domElement.addEventListener('pointermove', (e) => {
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
  if (!downAt) return
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
  downAt = null
  // A press that became a Left+Right camera combo is never a selection click,
  // even if it moved less than the slop.
  if (comboUsedInPress || moved > CLICK_SLOP_PX) return
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
  // Aborted press: drop the band without changing the selection.
  if (!rubberStart) return
  rubberStart = null
  rubberBand.hidden = true
  controls.enabled = true
})
renderer.domElement.addEventListener('dblclick', (e) => {
  // Recenter the orbit pivot on the node under the cursor (falls back to
  // the current selection).
  const nodeId = pickAt(e.clientX, e.clientY) ?? selection.id
  if (nodeId === null) return
  const pos = worldPosOf(nodeId)
  if (!pos) return
  controls.target.copy(pos)
  controls.update()
})
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'

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
    else if (typing) return
    else if (key === 'a') selectAllToggle()
    else if (key === 'i') selectionCommands.invertSelection()
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
  } else if (e.key === 'Escape') setSelection(null)
  else if (e.key === 'g' || e.key === 'G') cycleGridSelection()
  else if (e.key === 'h') selectionCommands.hideSelected()
  else if (e.key === 'H') selectionCommands.showAll()
  else if (e.key === 'i' || e.key === 'I') selectionCommands.isolateSelected()
  else if (e.key === 't' || e.key === 'T') toggleTags()
  else if (e.key === 'u' || e.key === 'U') openSelectedLink()
  else if (e.key === 'j' || e.key === 'J') cycleAttribute('topo', e.shiftKey ? -1 : 1)
  else if (e.key === 'o' || e.key === 'O') cycleAttribute('geometry', e.shiftKey ? -1 : 1)
  else if (e.key === 'f' || e.key === 'F') setFollowSelected(!followSelected)
  else if (e.key === 'b' || e.key === 'B') toggleBackgroundBw()
  // = / − step color_index within each node's own palette (Alt+ steps the
  // palette itself, handled above). '+' and '_' are the same physical keys with
  // Shift, which the desktop's Key_Equal/Key_Minus match regardless.
  else if (e.key === '=' || e.key === '+') cyclePaletteAttribute('index', 1)
  else if (e.key === '-' || e.key === '_') cyclePaletteAttribute('index', -1)
  else if (e.key === '8') cycleRenderMode()
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

const DEG = Math.PI / 180
const COMBO_ORBIT_DEG_PER_PX = 0.4 // desktop _orbit_camera / _orbit_zoom_camera
const COMBO_ZOOM_PER_PX = 0.005
const COMBO_MIN_DISTANCE = 1

let manualDrag: 'combo' | 'orbit' | null = null
let manualLast = { x: 0, y: 0 }
let comboUsedInPress = false

function updateManualDragState(e: PointerEvent) {
  if (rubberStart !== null) return // a region sweep owns the pointer
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
    const pos = selection.id !== null ? worldPosOf(selection.id) : null
    if (pos) controls.target.copy(pos)
  }
  if (next === null && manualDrag !== null) controls.enabled = true
  manualDrag = next
}

function manualDragMove(e: PointerEvent) {
  const dx = e.clientX - manualLast.x
  const dy = e.clientY - manualLast.y
  manualLast = { x: e.clientX, y: e.clientY }
  const offset = camera.position.clone().sub(controls.target)
  const r0 = offset.length()
  if (r0 < 1e-9) return
  // Z-up azimuth/elevation/distance, the desktop camera model. Azimuth sign is
  // the grab-the-object convention (matches both the desktop and what
  // OrbitControls does for a plain left drag).
  const az = Math.atan2(offset.y, offset.x) - dx * COMBO_ORBIT_DEG_PER_PX * DEG
  let el = Math.asin(THREE.MathUtils.clamp(offset.z / r0, -1, 1))
  let r = r0
  if (manualDrag === 'combo') {
    r = Math.max(COMBO_MIN_DISTANCE, r * (1 + dy * COMBO_ZOOM_PER_PX))
  } else {
    el = THREE.MathUtils.clamp(el + dy * COMBO_ORBIT_DEG_PER_PX * DEG, -89 * DEG, 89 * DEG)
  }
  camera.position
    .set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el))
    .multiplyScalar(r)
    .add(controls.target)
  camera.lookAt(controls.target)
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  comboUsedInPress = false // pointerdown always starts a fresh button chord
  updateManualDragState(e)
})
renderer.domElement.addEventListener('pointerup', updateManualDragState)
renderer.domElement.addEventListener('pointercancel', updateManualDragState)
renderer.domElement.addEventListener('pointermove', (e) => {
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
  const baseScale = gridGlobe ? GRID_GLOBE_RADIUS : BASE_SCALE

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
      baseScale,
    )
  }

  const inverted = invertTopoOffset({
    parentTopo,
    offset: gridParent ? gridOffsetSpace(frame.position, gridParent) : frame.position,
    prev: node.translate, // last committed tick — keeps unwrap continuous
    parentRatio,
    subspace: node.subspace,
    baseScale,
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
    if (id === Geometry.Mesh && names === GEOMETRY_NAMES) continue // needs an imported mesh
    const option = document.createElement('option')
    option.value = String(id)
    option.textContent = `${names[id]} (${id})`
    select.appendChild(option)
  }
  select.value = String(defaultId)
}

function readNewObjectDefaults(): NewObjectDefaults {
  const s = Number(newScaleInput.value)
  const scale = Number.isFinite(s) && s > 0 ? s : 1
  const hex = newColorInput.value // "#rrggbb"
  return {
    geometry: Number(newGeoSelect.value),
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
}

function setFollowSelected(value: boolean) {
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
  currentLinks?.setResolution(
    window.innerWidth * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  )
  currentOverlays?.setResolution(
    window.innerWidth * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  )
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

  // After the animation tick, like the desktop's paintGL: the followed node has
  // already moved this frame, so the pivot lands on where it actually is.
  applyFollowTarget()
  controls.update()
  // The key light lives in eye space on the desktop, so it follows the camera
  // the controls just moved.
  lighting.update(camera)
  backdrop.update(camera.position.distanceTo(controls.target))
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
  renderer.render(scene, camera)
  // After render: world matrices are the ones just drawn, so labels track
  // gizmo drags without a scene rebuild.
  if (currentFrames) {
    labels.render(currentNodes, currentFrames, camera, {
      showTags,
      selectedOnly: tagsSelectedOnly,
      showHidden,
      isSelected: (id) => selection.has(id),
      pinned: pinnedTags,
      tagColorMode: tagStyle.mode,
      tagColor: tagStyle.rgb,
    })
  }
  // Bracket the whole loop, and read the counters after the render call so
  // they describe the frame just drawn.
  fpsMeter.frame(now, performance.now(), renderer.info.render)
})
