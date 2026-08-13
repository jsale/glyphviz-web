import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildScene } from './buildScene'
import { gridHit } from './drawPlane'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import { Geometry, NodeType, Topo } from '../gv/types'
import type { GvNode } from '../gv/types'

const WIDTH = 1200
const HEIGHT = 800

function grid(overrides: Partial<GvNode> = {}, extras: Record<string, string> = {}): GvNode {
  const node = blankNode(1, {
    geometry: Geometry.GridWire,
    topo: Topo.Plane,
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 64, g: 80, b: 96, a: 255 },
  })
  node.type = NodeType.WorldGrid
  Object.assign(node, overrides)
  node.extras = { ...node.extras, ...extras }
  return node
}

function makeCamera(
  position: [number, number, number],
  target: [number, number, number],
  // The app's convention is Z-up; a camera looking straight DOWN needs another
  // up vector, since lookAt is degenerate when up is parallel to the view.
  up: [number, number, number] = [0, 0, 1],
) {
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.001, 10_000)
  camera.up.set(...up)
  camera.position.set(...position)
  camera.lookAt(new THREE.Vector3(...target))
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

/** The pointer ray under pixel (px, py) of a WIDTH×HEIGHT canvas. */
function rayAt(camera: THREE.Camera, px: number, py: number): THREE.Ray {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(
    new THREE.Vector2((px / WIDTH) * 2 - 1, -(py / HEIGHT) * 2 + 1),
    camera,
  )
  return raycaster.ray
}

/** Where a node's frame projects to, in the same pixel coordinates. */
function pixelOf(root: THREE.Object3D, camera: THREE.Camera, id: number): [number, number] {
  root.updateMatrixWorld(true)
  const frame = root.getObjectByName(`gv:${id}`)
  expect(frame, `frame for node ${id}`).toBeDefined()
  const v = new THREE.Vector3()
  frame!.getWorldPosition(v)
  v.project(camera)
  return [((v.x + 1) / 2) * WIDTH, ((1 - v.y) / 2) * HEIGHT]
}

/**
 * The round trip that is the whole proof: click a pixel, invert it onto the
 * grid's drawing plane, stamp a child at the (lon, lat, drawZ) it returns, and
 * project that child back — it must land on the pixel that was clicked.
 */
function roundTrip(
  scene: GvNode[],
  gridId: number,
  camera: THREE.Camera,
  px: number,
  py: number,
  drawZ = 0,
) {
  const built = buildScene(scene)
  built.root.updateMatrixWorld(true)
  const gridNode = scene.find((n) => n.id === gridId)!
  const frame = built.root.getObjectByName(`gv:${gridId}`)!
  const hit = gridHit(rayAt(camera, px, py), gridNode, frame, drawZ)
  expect(hit, 'grid hit').not.toBeNull()

  const stamp = blankNode(999, NEW_OBJECT_DEFAULTS)
  stamp.parentId = gridId
  stamp.branchLevel = gridNode.branchLevel + 1
  stamp.translate = { x: hit!.lon, y: hit!.lat, z: drawZ }
  const after = buildScene([...scene, stamp])
  return { hit: hit!, pixel: pixelOf(after.root, camera, 999) }
}

describe('gridHit', () => {
  const camera = makeCamera([0, -200, 160], [0, 0, 0])

  it('inverts the flat-grid placement exactly on a default whole-earth grid', () => {
    const { pixel } = roundTrip([grid()], 1, camera, 742, 371)
    expect(pixel[0]).toBeCloseTo(742, 6)
    expect(pixel[1]).toBeCloseTo(371, 6)
  })

  it('returns 1:1 lon/lat for the whole-earth window (the grid is its own map)', () => {
    // Looking straight down the +Z axis at the origin, the canvas centre is
    // lon/lat (0, 0) — the whole-earth window's own centre.
    const top = makeCamera([0, 0, 400], [0, 0, 0], [0, 1, 0])
    const built = buildScene([grid()])
    built.root.updateMatrixWorld(true)
    const hit = gridHit(
      rayAt(top, WIDTH / 2, HEIGHT / 2),
      grid(),
      built.root.getObjectByName('gv:1')!,
      0,
    )
    expect(hit!.lon).toBeCloseTo(0, 9)
    expect(hit!.lat).toBeCloseTo(0, 9)
  })

  it('lands the stamp under the cursor AT the requested elevation', () => {
    const { hit, pixel } = roundTrip([grid()], 1, camera, 300, 500, 25)
    expect(pixel[0]).toBeCloseTo(300, 6)
    expect(pixel[1]).toBeCloseTo(500, 6)
    // The elevation is the child's own translate_z; only lon/lat come back.
    expect(Number.isFinite(hit.lon) && Number.isFinite(hit.lat)).toBe(true)
  })

  it('is exact under grid translate, rotate and non-uniform scale', () => {
    const moved = grid({
      translate: { x: 40, y: -15, z: 12 },
      rotate: { x: 20, y: 0, z: 35 },
      scale: { x: 0.4, y: 0.9, z: 2 },
    })
    const { pixel } = roundTrip([moved], 1, camera, 505, 622, 3)
    expect(pixel[0]).toBeCloseTo(505, 6)
    expect(pixel[1]).toBeCloseTo(622, 6)
  })

  it('is exact for a windowed grid, whose centre is not (0, 0)', () => {
    // A San-Diego-sized window: the grid's own position is lon −117, lat 32.7,
    // so the returned coordinates are absolute lon/lat, not window-relative.
    const windowed = grid({ scale: { x: 30, y: 30, z: 1 } }, {
      trigger_lo_x: '-117.4',
      trigger_hi_x: '-116.8',
      trigger_lo_y: '32.5',
      trigger_hi_y: '33.0',
    })
    const near = makeCamera([0, -30, 30], [0, 0, 0])
    const { hit, pixel } = roundTrip([windowed], 1, near, 640, 410)
    expect(pixel[0]).toBeCloseTo(640, 6)
    expect(pixel[1]).toBeCloseTo(410, 6)
    expect(hit.lon).toBeGreaterThan(-118)
    expect(hit.lon).toBeLessThan(-116)
    expect(hit.lat).toBeGreaterThan(32)
    expect(hit.lat).toBeLessThan(34)
  })

  it('is exact for a grid nested under a rotated, scaled parent', () => {
    const parent = blankNode(7, NEW_OBJECT_DEFAULTS)
    parent.id = 7
    parent.translate = { x: -20, y: 10, z: 5 }
    parent.rotate = { x: 0, y: 15, z: -40 }
    parent.scale = { x: 1.5, y: 1.5, z: 1.5 }
    const child = grid({ parentId: 7, branchLevel: 1, translate: { x: 5, y: 0, z: 0 } })
    const { pixel } = roundTrip([parent, child], 1, camera, 820, 240, -4)
    expect(pixel[0]).toBeCloseTo(820, 6)
    expect(pixel[1]).toBeCloseTo(240, 6)
  })

  it('returns null for a ray parallel to the plane', () => {
    const edgeOn = makeCamera([0, -200, 0], [0, 0, 0])
    const built = buildScene([grid()])
    built.root.updateMatrixWorld(true)
    const hit = gridHit(
      rayAt(edgeOn, WIDTH / 2, HEIGHT / 2),
      grid(),
      built.root.getObjectByName('gv:1')!,
      0,
    )
    expect(hit).toBeNull()
  })

  it('returns null when the plane lies behind the camera', () => {
    const facingAway = makeCamera([0, -200, 160], [0, -400, 400])
    const built = buildScene([grid()])
    built.root.updateMatrixWorld(true)
    const hit = gridHit(
      rayAt(facingAway, WIDTH / 2, HEIGHT / 2),
      grid(),
      built.root.getObjectByName('gv:1')!,
      0,
    )
    expect(hit).toBeNull()
  })

  it('returns null for a singular basis (a zero-scale axis)', () => {
    const flat = grid({ scale: { x: 1, y: 1, z: 0 } })
    const built = buildScene([flat])
    built.root.updateMatrixWorld(true)
    const hit = gridHit(
      rayAt(camera, WIDTH / 2, HEIGHT / 2),
      flat,
      built.root.getObjectByName('gv:1')!,
      0,
    )
    expect(hit).toBeNull()
  })
})
