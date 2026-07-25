import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { createChildNode, createRootNode, NEW_OBJECT_DEFAULTS } from './gv/createNode'
import type { NewObjectDefaults } from './gv/createNode'
import { parseGvNodeCsv } from './gv/nodeCsv'
import { deleteSubtree, navFirstChild, navParent, navSibling } from './gv/treeOps'
import type { GvNode, GvParseIssue, Vec3 } from './gv/types'
import { GEOMETRY_NAMES, Geometry, NodeType, TOPO_NAMES, Topo } from './gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridIsGlobe } from './gv/worldGrid'
import { writeGvNodeCsv } from './gv/writeNodeCsv'
import { Backdrop } from './render/backdrop'
import { applyFrameTransform, BASE_SCALE, buildScene, frameBaseRotation } from './render/buildScene'
import type { SceneBuildResult } from './render/buildScene'
import { pickNodeId, Selection } from './render/picking'
import { invertLocalRotation } from './render/rotationInverse'
import { invertTopoOffset, pickDominantField } from './render/topologyInverse'
import { Inspector } from './ui/inspector'
import cartesianCsv from './examples/cartesian_example_gv_node.csv?raw'
import linkCsv from './examples/link_example_gv_node.csv?raw'
import topologyCsv from './gv/fixtures/topology_example_gv_node.csv?raw'
import worldGridCsv from './gv/fixtures/world_grid_example_gv_node.csv?raw'

// Parse a gv_node.csv, render it with the full topology placement math and
// World Grid geographic placement (verified against the desktop engine by
// src/render/parity.test.ts), orbit camera, click-to-select with an editable
// inspector, gizmo dragging (move/rotate/scale), save back to CSV. Grids are
// selected with the G key, never by click. Still to come: Link edges,
// Plot/Surface overlays, textures, tags.

const BUILT_IN_SCENES: Record<string, { csv: string; filename: string }> = {
  'Topology example (all 18 topologies)': {
    csv: topologyCsv,
    filename: 'topology_example_gv_node.csv',
  },
  'Cartesian example': { csv: cartesianCsv, filename: 'cartesian_example_gv_node.csv' },
  'World Grid example (flat, region, globe)': {
    csv: worldGridCsv,
    filename: 'world_grid_example_gv_node.csv',
  },
  'Link example (lines + prisms)': { csv: linkCsv, filename: 'link_example_gv_node.csv' },
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

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 1000)
camera.up.set(0, 0, 1)

// Fixed-function-GL-flavored lighting: soft ambient plus one key light.
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(3, -4, 5)
scene.add(key)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// Desktop-style procedural backdrop: the "infinite" reference grid (hidden
// once the scene contains a real World Grid) and the RGB origin axes.
const backdrop = new Backdrop()
scene.add(backdrop.group)

// --- HUD -------------------------------------------------------------------

const hud = document.createElement('div')
hud.id = 'hud'
hud.innerHTML = `
  <div id="hud-title">GlyphViz Web</div>
  <select id="hud-examples"></select>
  <div id="hud-scene"></div>
  <div id="hud-warnings"></div>
  <label id="hud-open">Open gv_node.csv<input type="file" accept=".csv,text/csv"></label>
  <button id="hud-save">Save gv_node.csv</button>
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
  <div id="hud-hint">or drop a CSV anywhere</div>
`
app.appendChild(hud)
const hudScene = hud.querySelector<HTMLDivElement>('#hud-scene')!
const hudWarnings = hud.querySelector<HTMLDivElement>('#hud-warnings')!
const fileInput = hud.querySelector<HTMLInputElement>('input[type=file]')!
const exampleSelect = hud.querySelector<HTMLSelectElement>('#hud-examples')!
const saveButton = hud.querySelector<HTMLButtonElement>('#hud-save')!
const newNodeButton = hud.querySelector<HTMLButtonElement>('#hud-new-node')!
const newChildButton = hud.querySelector<HTMLButtonElement>('#hud-new-child')!
const newGeoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-geo')!
const newTopoSelect = hud.querySelector<HTMLSelectElement>('#hud-new-topo')!
const newScaleInput = hud.querySelector<HTMLInputElement>('#hud-new-scale')!
const newColorInput = hud.querySelector<HTMLInputElement>('#hud-new-color')!
const deleteButton = hud.querySelector<HTMLButtonElement>('#hud-delete')!

for (const name of Object.keys(BUILT_IN_SCENES)) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = name
  exampleSelect.appendChild(option)
}
exampleSelect.addEventListener('change', () => {
  const builtIn = BUILT_IN_SCENES[exampleSelect.value]
  loadCsv(builtIn.csv, exampleSelect.value, builtIn.filename)
})

saveButton.addEventListener('click', () => {
  if (currentNodes.length === 0) return
  const blob = new Blob([writeGvNodeCsv(currentNodes)], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = currentFilename
  a.click()
  URL.revokeObjectURL(a.href)
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
  onNodeEdited() {
    // The mutated node lives in currentNodes; rebuild in place, keeping the
    // camera and reattaching the selection + inspector.
    rebuildScene(false)
  },
})
app.appendChild(inspector.element)

function worldPosOf(nodeId: number): THREE.Vector3 | null {
  // Called per gizmo tick — must stay O(depth): frames map lookup, and
  // getWorldPosition refreshes only the ancestor chain (no full-tree pass).
  const frame = currentFrames?.get(nodeId)
  return frame ? frame.getWorldPosition(new THREE.Vector3()) : null
}

function parentOf(node: GvNode): GvNode | null {
  return node.parentId !== 0 ? (nodesById.get(node.parentId) ?? null) : null
}

function setSelected(nodeId: number | null) {
  if (!currentRoot) return
  selection.set(currentRoot, nodeId)
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  newChildButton.disabled = !node
  deleteButton.disabled = !node
  if (!node) {
    gizmo.detach()
    inspector.hide()
    return
  }
  // No gizmo on World Grids (their frame deliberately carries no scale, so
  // gizmo modes would fight it) or Links (their own transform is inert —
  // the edge follows its endpoints) — edit those through the inspector,
  // like the desktop's panel/table. Simplest defaults.
  if (node.type === NodeType.WorldGrid || node.type === NodeType.Link) {
    gizmo.detach()
  } else {
    const frame = currentFrames?.get(node.id)
    if (frame) gizmo.attach(frame)
  }
  inspector.show(node, worldPosOf(node.id))
}

/** G key, desktop-style: select the first World Grid, or cycle to the next. */
function cycleGridSelection() {
  const grids = currentNodes.filter((n) => n.type === NodeType.WorldGrid)
  if (grids.length === 0) return
  const at = grids.findIndex((n) => n.id === selection.id)
  setSelected(grids[(at + 1) % grids.length].id)
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

function loadCsv(text: string, displayName: string, filename: string) {
  const parsed = parseGvNodeCsv(text)
  if (parsed.errors.length > 0 && parsed.nodes.length === 0) {
    showMessages(parsed.errors.map(issueText), [])
    return
  }
  currentNodes = parsed.nodes
  currentDisplayName = displayName
  currentFilename = filename
  parseErrorLines = parsed.errors.map(issueText)
  parseWarningLines = parsed.warnings.map(issueText)
  rebuildScene(true)
}

function rebuildScene(fitCamera: boolean) {
  const prevSelected = selection.id
  const built = buildScene(currentNodes)
  if (currentRoot) {
    gizmo.detach()
    selection.set(currentRoot, null)
    scene.remove(currentRoot)
  }
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

  const linkNote = currentLinks.count > 0 ? `, ${currentLinks.count} link edge(s)` : ''
  hudScene.textContent = `${currentDisplayName} — ${currentNodes.length} node(s), ${built.drawnCount} drawn${linkNote}`
  showMessages(parseErrorLines, [...parseWarningLines, ...built.warnings])

  if (fitCamera) {
    inspector.hide()
    fitCameraTo(currentRoot)
  } else {
    setSelected(prevSelected)
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

function loadFile(file: File) {
  file
    .text()
    .then((text) => loadCsv(text, file.name, file.name))
    .catch((err: unknown) => showMessages([`Could not read ${file.name}: ${String(err)}`], []))
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) loadFile(file)
  fileInput.value = ''
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) loadFile(file)
})

// --- Picking -------------------------------------------------------------------
// Plain left-click on a node selects it (replacing the selection); clicking
// empty space clears — matching the desktop viewport. A small movement
// threshold separates clicks from orbit drags.

const raycaster = new THREE.Raycaster()
const CLICK_SLOP_PX = 5
let downAt: { x: number; y: number } | null = null

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
  if (e.button === 0) downAt = { x: e.clientX, y: e.clientY }
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downAt) return
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
  downAt = null
  // A press that became a Left+Right camera combo is never a selection click,
  // even if it moved less than the slop.
  if (comboUsedInPress || moved > CLICK_SLOP_PX) return
  // Clicks on (or releases over) a gizmo arrow are drag interactions, not
  // selection changes.
  if (gizmo.dragging || gizmo.axis !== null) return
  setSelected(pickAt(e.clientX, e.clientY))
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
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === 'Escape') setSelected(null)
  else if (e.key === 'g' || e.key === 'G') cycleGridSelection()
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

gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as unknown as { value: boolean }).value
  controls.enabled = !dragging
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (dragging && node && gizmo.object) {
    if (gizmo.mode === 'translate') {
      dragStartTranslate = { ...node.translate }
      dragStartOffset = gizmo.object.position.clone()
      dragField = 'undecided'
    }
  } else if (!dragging) {
    dragStartTranslate = null
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

  if (gizmo.mode === 'scale') {
    node.scale.x = frame.scale.x
    node.scale.y = frame.scale.y
    node.scale.z = frame.scale.z
    inspector.show(node, worldPosOf(node.id))
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
    inspector.show(node, worldPosOf(node.id))
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
  inspector.show(node, worldPosOf(node.id))
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
  setSelected(node.id)
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
  const node = selectedNode()
  if (!node) return
  currentNodes = deleteSubtree(currentNodes, node.id)
  // rebuildScene re-selects the previous id, finds it gone, and cleanly
  // detaches the gizmo + hides the inspector.
  rebuildScene(false)
}

function navTo(node: GvNode | null) {
  if (node) setSelected(node.id)
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
  const builtIn = BUILT_IN_SCENES[exampleSelect.value]
  loadCsv(builtIn.csv, exampleSelect.value, builtIn.filename)
  if (csvUrl) {
    const filename = csvUrl.split('/').pop() || 'scene_gv_node.csv'
    fetch(csvUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => loadCsv(text, filename, filename))
      .catch((err: unknown) => showMessages([`Could not fetch ${csvUrl}: ${String(err)}`], []))
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  currentLinks?.setResolution(
    window.innerWidth * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  )
})

renderer.setAnimationLoop(() => {
  controls.update()
  backdrop.update(camera.position.distanceTo(controls.target))
  // Edges chase their endpoint nodes (gizmo drags mutate frames between
  // rebuilds), so refresh them every frame like the desktop's redraw.
  currentLinks?.update()
  renderer.render(scene, camera)
})
