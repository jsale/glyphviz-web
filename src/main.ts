import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
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
import { filesFromDataTransfer, filesFromInput } from './io/browserFiles'
import type { PathedFile } from './io/browserFiles'
import { ChannelAudio, parseAudioManifest } from './io/channelAudio'
import {
  invertSelection,
  isolateSelection,
  selectAllIds,
  selectByCriterion,
  setHidden,
  showAll,
} from './gv/selectionOps'
import type { SelectCriterion } from './gv/selectionOps'
import { deleteSubtree, navFirstChild, navParent, navSibling } from './gv/treeOps'
import type { GvNode, GvParseIssue, Vec3 } from './gv/types'
import { GEOMETRY_NAMES, Geometry, NodeType, TOPO_NAMES, Topo } from './gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridIsGlobe } from './gv/worldGrid'
import { writeGvNodeCsv } from './gv/writeNodeCsv'
import { Backdrop } from './render/backdrop'
import { applyFrameTransform, BASE_SCALE, buildScene, frameBaseRotation } from './render/buildScene'
import type { SceneBuildResult } from './render/buildScene'
import { DynamicNodes } from './render/dynamicNodes'
import { clearMaterialCache } from './render/glyphGeometry'
import { LabelOverlay } from './render/labelOverlay'
import {
  applyAudioMode,
  disposeTextures,
  emptyTextureLibrary,
  loadTextures,
  referencedTextureIds,
} from './render/textureLibrary'
import type { AudioMode, TextureLibrary } from './render/textureLibrary'
import { MAX_HALOS, pickNodeId, Selection } from './render/picking'
import { nodeIdsInRect } from './render/rectSelect'
import { invertLocalRotation } from './render/rotationInverse'
import { invertTopoOffset, pickDominantField } from './render/topologyInverse'
import { ChannelsPanel, DEFAULT_CHANNEL_FPS } from './ui/channelsPanel'
import { Inspector } from './ui/inspector'
import { Panel } from './ui/panel'
import { SelectionPanel } from './ui/selectionPanel'
import cartesianCsv from './examples/cartesian_example_gv_node.csv?raw'
import linkCsv from './examples/link_example_gv_node.csv?raw'
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
// Still to come: select by tag text, a Node Table panel, Plot/Surface overlays.

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

// Fixed-function-GL-flavored lighting: soft ambient plus one key light.
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(3, -4, 5)
scene.add(key)

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
    <label title="Pick a gv_node.csv, or select it together with its companion gv_tag.csv and media files.">Open Files<input type="file" accept=".csv,text/csv" multiple></label>
    <label title="Pick a whole scene folder: the node CSV, its companion tag file and media/ folder are found inside.">Open Folder<input type="file" id="hud-open-folder" webkitdirectory></label>
  </div>
  <select id="hud-scenes" title="Scenes found in the opened folder" hidden></select>
  <div id="hud-save-row">
    <button id="hud-save">Save gv_node.csv</button>
    <button id="hud-save-tags" hidden title="Write the companion label file alongside the node CSV.">Save gv_tag.csv</button>
  </div>
  <div id="hud-modes">
    <button data-mode="translate" class="active">Move (W)</button>
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
  <div id="hud-hint">or drop a scene folder (or CSV) anywhere</div>
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
let nodesById = new Map<number, GvNode>()

const inspector = new Inspector({
  onNodesEdited() {
    // The mutated nodes live in currentNodes; rebuild in place, keeping the
    // camera and reattaching the selection + inspector.
    rebuildScene(false)
  },
})
app.appendChild(inspector.element)

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
 * Scene row order for a set of ids. The desktop's inspector reads
 * `_selected_nodes[0]` from a row-ordered table selection, so ordering here
 * is what makes "primary" mean the same thing in both apps.
 */
function orderedIds(ids: ReadonlySet<number>): number[] {
  const out: number[] = []
  for (const node of currentNodes) {
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
  // "Solo to Selection" mixes by what is selected right now.
  if (audioMode === 'selected') refreshAudio()
  if (!primary) {
    gizmo.detach()
    inspector.clear()
    return
  }
  // No gizmo on World Grids (their frame deliberately carries no scale, so
  // gizmo modes would fight it) or Links (their own transform is inert —
  // the edge follows its endpoints) — edit those through the inspector,
  // like the desktop's panel/table. Simplest defaults.
  const frame = currentFrames?.get(primary.id)
  if (primary.type === NodeType.WorldGrid || primary.type === NodeType.Link || !frame) {
    gizmo.detach()
  } else {
    gizmo.attach(frame)
  }
  inspector.show(nodes, nodes.length === 1 ? worldPosOf(primary.id) : null)
  if (selection.haloOverflow > 0) {
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
  setTagsSelectedOnly(value: boolean) {
    tagsSelectedOnly = value
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
  parseWarningLines = parsed.warnings.map(issueText)
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
  textureNote = ''
  selectionPanel.setVideoCount(0)

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
 * of media that no node points at. `epoch` guards against a slow decode
 * landing after the user has moved on to another scene.
 */
async function decodeSceneTextures(epoch: number) {
  const media = currentMedia
  if (!media || media.index.entries.length === 0) return
  const wanted = referencedTextureIds(currentNodes)
  // A flip-book's frames are named only by its track, never by a CSV cell.
  for (const id of channels.textureIds) wanted.add(id)
  if (wanted.size === 0) return

  const library = await loadTextures(media.index, wanted, async (entry) =>
    media.fileById.get(entry.textureId) ?? null,
  )
  if (epoch !== sceneEpoch) {
    disposeTextures(library) // a newer scene loaded while this decoded
    return
  }

  currentTextures = library
  const videoNote = library.videos.length > 0 ? ` (${library.videos.length} video)` : ''
  textureNote =
    library.byId.size > 0 ? `${library.byId.size}/${wanted.size} texture(s)${videoNote}` : ''
  parseWarningLines.push(...library.warnings)
  selectionPanel.setVideoCount(library.videos.length)
  refreshAudio()
  clearMaterialCache()
  rebuildScene(false)
}

function loadBuiltIn(name: string) {
  const builtIn = BUILT_IN_SCENES[name]
  exampleSelect.value = name
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
  currentRoot = built.root
  currentLinks = built.links
  currentFrames = built.frames
  currentLinks.setResolution(
    window.innerWidth * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  )
  scene.add(currentRoot)
  scene.background = built.background
  nodesById = new Map(currentNodes.map((n) => [n.id, n]))
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

/** Scenes found in the last opened file set, with their files by path. */
let openedScenes: SceneCandidate[] = []
let openedFiles = new Map<string, File>()

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

function openFileSet(files: PathedFile[]) {
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
          : `No gv_node.csv found in ${files.length} file(s). Drop a scene folder, or the node CSV itself.`,
      ],
      [],
    )
    return
  }
  void loadSceneCandidate(openedScenes[0])
}

sceneSelect.addEventListener('change', () => {
  const scene = openedScenes[Number(sceneSelect.value)]
  if (scene) void loadSceneCandidate(scene)
})

fileInput.addEventListener('change', () => {
  openFileSet(filesFromInput(fileInput))
  fileInput.value = ''
})

folderInput.addEventListener('change', () => {
  openFileSet(filesFromInput(folderInput))
  folderInput.value = ''
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
  if (!e.dataTransfer) return
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

  // Panel toggles are window commands and fire even mid-edit; the selection
  // chords stand down while a field has focus, so Ctrl+A there still means
  // "select this text". Ctrl+N — which would have suited a future Node Table
  // — is reserved by the browser and cannot be intercepted, hence P/E/B;
  // Alt+N stays free for when that panel arrives.
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase()
    if (key === 'p') inspector.panel.toggle()
    else if (key === 'e') selectionPanel.panel.toggle()
    else if (key === 'b') scenePanel.toggle()
    else if (typing) return
    else if (key === 'a') selectAllToggle()
    else if (key === 'i') selectionCommands.invertSelection()
    else return
    e.preventDefault()
    return
  }

  // Alt+C for the Channels panel: Ctrl+B/E/P are taken, and Ctrl+N — the
  // obvious fourth — is reserved by the browser.
  if (e.altKey && (e.key === 'c' || e.key === 'C')) {
    channelsPanel.panel.toggle()
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
  else if (e.key === 'w' || e.key === 'W') setGizmoMode('translate')
  else if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate')
  else if (e.key === 'r' || e.key === 'R') setGizmoMode('scale')
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

type GizmoMode = 'translate' | 'rotate' | 'scale'
const modeButtons = [...hud.querySelectorAll<HTMLButtonElement>('#hud-modes button')]
function setGizmoMode(mode: GizmoMode) {
  gizmo.setMode(mode)
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === mode)
}
for (const b of modeButtons) {
  b.addEventListener('click', () => setGizmoMode(b.dataset.mode as GizmoMode))
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
})

renderer.setAnimationLoop(() => {
  // Elapsed real time drives both clocks. Capped so a backgrounded tab (whose
  // animation loop stops) does not resume by integrating a minute of rates in
  // one step; the desktop's timer has the same effect by simply not firing.
  const now = performance.now()
  const dtMs = lastTickMs === 0 ? 0 : Math.min(now - lastTickMs, 250)
  lastTickMs = now
  tickAnimation(dtMs)

  controls.update()
  backdrop.update(camera.position.distanceTo(controls.target))
  // Edges chase their endpoint nodes (gizmo drags mutate frames between
  // rebuilds), so refresh them every frame like the desktop's redraw.
  currentLinks?.update()
  renderer.render(scene, camera)
  // After render: world matrices are the ones just drawn, so labels track
  // gizmo drags without a scene rebuild.
  if (currentFrames) {
    labels.render(currentNodes, currentFrames, camera, {
      showTags,
      selectedOnly: tagsSelectedOnly,
      showHidden,
      isSelected: (id) => selection.has(id),
    })
  }
})
