import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { parseGvNodeCsv } from './gv/nodeCsv'
import type { GvNode, GvParseIssue } from './gv/types'
import { writeGvNodeCsv } from './gv/writeNodeCsv'
import { buildScene } from './render/buildScene'
import { pickNodeId, Selection } from './render/picking'
import { Inspector } from './ui/inspector'
import cartesianCsv from './examples/cartesian_example_gv_node.csv?raw'
import topologyCsv from './gv/fixtures/topology_example_gv_node.csv?raw'

// Parse a gv_node.csv, render it with the full topology placement math
// (verified against the desktop engine by src/render/parity.test.ts), orbit
// camera, click-to-select with an editable inspector, save back to CSV.
// Still to come: World Grid, Link edges, Plot/Surface overlays, textures,
// tags, gizmo dragging.

const BUILT_IN_SCENES: Record<string, { csv: string; filename: string }> = {
  'Topology example (all 18 topologies)': {
    csv: topologyCsv,
    filename: 'topology_example_gv_node.csv',
  },
  'Cartesian example': { csv: cartesianCsv, filename: 'cartesian_example_gv_node.csv' },
}

// GlyphViz worlds are Z-up (ANTz convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

const app = document.querySelector<HTMLDivElement>('#app')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.up.set(0, 0, 1)

// Fixed-function-GL-flavored lighting: soft ambient plus one key light.
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(3, -4, 5)
scene.add(key)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

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
  <div id="hud-hint">or drop a CSV anywhere</div>
`
app.appendChild(hud)
const hudScene = hud.querySelector<HTMLDivElement>('#hud-scene')!
const hudWarnings = hud.querySelector<HTMLDivElement>('#hud-warnings')!
const fileInput = hud.querySelector<HTMLInputElement>('input[type=file]')!
const exampleSelect = hud.querySelector<HTMLSelectElement>('#hud-examples')!
const saveButton = hud.querySelector<HTMLButtonElement>('#hud-save')!

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
  if (!currentRoot) return null
  currentRoot.updateMatrixWorld(true)
  const frame = currentRoot.getObjectByName(`gv:${nodeId}`)
  return frame ? frame.getWorldPosition(new THREE.Vector3()) : null
}

function setSelected(nodeId: number | null) {
  if (!currentRoot) return
  selection.set(currentRoot, nodeId)
  const node = selection.id !== null ? nodesById.get(selection.id) : undefined
  if (!node) {
    inspector.hide()
    return
  }
  inspector.show(node, worldPosOf(node.id))
}

// --- Scene loading -----------------------------------------------------------

let currentRoot: THREE.Group | null = null
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
    selection.set(currentRoot, null)
    scene.remove(currentRoot)
  }
  currentRoot = built.root
  scene.add(currentRoot)
  scene.background = built.background
  nodesById = new Map(currentNodes.map((n) => [n.id, n]))

  hudScene.textContent = `${currentDisplayName} — ${currentNodes.length} node(s), ${built.drawnCount} drawn`
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
  camera.near = Math.max(0.01, distance / 100)
  camera.far = distance * 100
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
  if (moved > CLICK_SLOP_PX) return
  setSelected(pickAt(e.clientX, e.clientY))
})
renderer.domElement.addEventListener('dblclick', (e) => {
  // Recenter the orbit pivot on the node under the cursor (falls back to
  // the current selection).
  const nodeId = pickAt(e.clientX, e.clientY) ?? selection.id
  if (nodeId === null || !currentRoot) return
  const frame = currentRoot.getObjectByName(`gv:${nodeId}`)
  if (!frame) return
  currentRoot.updateMatrixWorld(true)
  controls.target.copy(frame.getWorldPosition(new THREE.Vector3()))
  controls.update()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') setSelected(null)
})

// --- Boot ---------------------------------------------------------------------

{
  const builtIn = BUILT_IN_SCENES[exampleSelect.value]
  loadCsv(builtIn.csv, exampleSelect.value, builtIn.filename)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
