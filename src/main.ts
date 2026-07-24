import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { parseGvNodeCsv } from './gv/nodeCsv'
import { buildScene } from './render/buildScene'
import cartesianCsv from './examples/cartesian_example_gv_node.csv?raw'
import topologyCsv from './gv/fixtures/topology_example_gv_node.csv?raw'

// Parse a gv_node.csv, render it with the full topology placement math
// (verified against the desktop engine by src/render/parity.test.ts), orbit
// camera. Still to come: World Grid, Link edges, Plot/Surface overlays,
// textures, tags.

const BUILT_IN_SCENES: Record<string, string> = {
  'Topology example (all 18 topologies)': topologyCsv,
  'Cartesian example': cartesianCsv,
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
  <div id="hud-hint">or drop a CSV anywhere</div>
`
app.appendChild(hud)
const hudScene = hud.querySelector<HTMLDivElement>('#hud-scene')!
const hudWarnings = hud.querySelector<HTMLDivElement>('#hud-warnings')!
const fileInput = hud.querySelector<HTMLInputElement>('input[type=file]')!
const exampleSelect = hud.querySelector<HTMLSelectElement>('#hud-examples')!

for (const name of Object.keys(BUILT_IN_SCENES)) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = name
  exampleSelect.appendChild(option)
}
exampleSelect.addEventListener('change', () => {
  loadCsv(BUILT_IN_SCENES[exampleSelect.value], exampleSelect.value)
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

// --- Scene loading -----------------------------------------------------------

let currentRoot: THREE.Group | null = null

function loadCsv(text: string, name: string) {
  const parsed = parseGvNodeCsv(text)
  const parseIssue = (i: { line?: number; column?: string; message: string }) =>
    [i.line !== undefined ? `line ${i.line}` : '', i.column ?? '', i.message]
      .filter(Boolean)
      .join(': ')
  if (parsed.errors.length > 0 && parsed.nodes.length === 0) {
    showMessages(parsed.errors.map(parseIssue), [])
    return
  }

  const built = buildScene(parsed.nodes)
  if (currentRoot) {
    scene.remove(currentRoot)
  }
  currentRoot = built.root
  scene.add(currentRoot)
  scene.background = built.background

  hudScene.textContent = `${name} — ${parsed.nodes.length} node(s), ${built.drawnCount} drawn`
  showMessages(parsed.errors.map(parseIssue), [
    ...parsed.warnings.map(parseIssue),
    ...built.warnings,
  ])
  fitCameraTo(currentRoot)
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
    .then((text) => loadCsv(text, file.name))
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

// --- Boot ---------------------------------------------------------------------

loadCsv(BUILT_IN_SCENES[exampleSelect.value], exampleSelect.value)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
