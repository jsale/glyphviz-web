import './style.css'
import * as THREE from 'three'

// Scaffold smoke test only — proves the Vite + Three.js pipeline renders.
// The real gv_node.csv loader and topology placement math land in a later step.

const app = document.querySelector<HTMLDivElement>('#app')!

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(2, 2, 4)
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xf2793d }),
)
scene.add(cube)
scene.add(new THREE.AmbientLight(0xffffff, 0.5))
const key = new THREE.DirectionalLight(0xffffff, 1.5)
key.position.set(3, 4, 5)
scene.add(key)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function animate() {
  requestAnimationFrame(animate)
  cube.rotation.x += 0.01
  cube.rotation.y += 0.015
  renderer.render(scene, camera)
}
animate()
