// Save Selection As… — the guarantee the whole feature exists for: an exported
// fragment reopens exactly where, and at the size and angle, it appeared here.
//
// The check is the desktop's own (test_bake_keeps_every_world_matrix) in this
// app's terms: export a middle slice of a deep, rotated, scaled hierarchy,
// write it through the REAL CSV writer, read it back through the REAL parser,
// build it, and require every frame's matrixWorld to agree with the source
// scene's. That covers the placement walk, the basis decomposition, the Euler
// recovery AND the writer's 6-decimal column formatting in one measurement —
// the last of which is why the tolerance here is 1e-5 rather than 1e-9.
//
// Membership and the pure rules are src/gv/selectionExport.test.ts; the
// desktop-for-desktop diff is selectionExport.parity.test.ts.

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import type { ExportOptions } from '../gv/selectionExport'
import { buildSelection, DEFAULT_EXPORT_OPTIONS, Detach } from '../gv/selectionExport'
import type { GvNode } from '../gv/types'
import { writeGvNodeCsv } from '../gv/writeNodeCsv'
import { buildScene } from './buildScene'
import { worldPlacements } from './selectionPlacement'
import fixtureCsv from '../gv/fixtures/selection_export_gv_node.csv?raw'

const scene = () => parseGvNodeCsv(fixtureCsv).nodes

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS, ...overrides }
}

/** id → frame matrixWorld, from a real build. */
function worldMatrices(nodes: GvNode[]): Map<number, THREE.Matrix4> {
  const built = buildScene(nodes, { showHidden: true })
  built.root.updateMatrixWorld(true)
  const out = new Map<number, THREE.Matrix4>()
  for (const [id, frame] of built.frames) out.set(id, frame.matrixWorld.clone())
  return out
}

function expectMatricesClose(
  before: Map<number, THREE.Matrix4>,
  after: Map<number, THREE.Matrix4>,
  ids: number[],
  places: number,
) {
  expect(ids.length).toBeGreaterThan(0)
  for (const id of ids) {
    const a = before.get(id)
    const b = after.get(id)
    expect(a, `node ${id} missing before`).toBeTruthy()
    expect(b, `node ${id} missing after`).toBeTruthy()
    for (let i = 0; i < 16; i++) {
      expect(b!.elements[i], `node ${id} element ${i}`).toBeCloseTo(a!.elements[i], places)
    }
  }
}

/** Export `selected`, and give back the source and reloaded world matrices. */
function roundTrip(selected: number[], opts = DEFAULT_EXPORT_OPTIONS) {
  const nodes = scene()
  const before = worldMatrices(nodes)
  const exported = buildSelection(nodes, selected, opts, worldPlacements(nodes))
  const reloaded = parseGvNodeCsv(writeGvNodeCsv(exported.nodes)).nodes
  return { exported, before, after: worldMatrices(reloaded), ids: exported.plan.ids }
}

describe('the bake keeps every world matrix', () => {
  it('holds through a real CSV round trip for a mid-hierarchy subtree', () => {
    // Node 3 hangs off a rotated, scaled Sphere parent, so its translate means
    // longitude/latitude/altitude — the case a naive save relocates.
    const { exported, before, after, ids } = roundTrip([3])
    expect(ids).toEqual([3, 4, 5, 6, 7, 8])
    expect(exported.plan.detachedIds).toEqual([3])
    expect(exported.approximatedIds).toEqual([])
    expectMatricesClose(before, after, ids, 5)
  })

  it('holds at every depth of the chain, the rod included', () => {
    // Node 8 is a Rod-topology node, whose glyph carries the ANTz cap offset —
    // the frame is what this compares, and the glyph rides on it.
    for (const rootId of [2, 3, 4, 5, 8]) {
      const { before, after, ids } = roundTrip([rootId])
      expectMatricesClose(before, after, ids, 5)
    }
  })

  it('holds for two leaves detached independently from different branches', () => {
    const { exported, before, after, ids } = roundTrip([5, 6])
    expect(exported.plan.detachedIds).toEqual([5, 6])
    expectMatricesClose(before, after, ids, 5)
  })

  it('holds for a World Grid child, whose translate is longitude and latitude', () => {
    // The most obviously wrong case for a naive save: node 31 sits at
    // (-117.2, 32.7) in its grid's extents window, which as world units is off
    // the map entirely.
    const { before, after, ids } = roundTrip([31])
    expect(ids).toEqual([31, 32])
    expectMatricesClose(before, after, ids, 5)
  })

  it('holds for a globe grid child', () => {
    const { before, after, ids } = roundTrip([41])
    expect(ids).toEqual([41, 42])
    expectMatricesClose(before, after, ids, 5)
  })

  it('holds for a World Grid detached whole, footprint and children included', () => {
    // A grid can be selected on its own (the G key). Its rendered rectangle is
    // extents x raw scale and its children are re-spaced by that same scale —
    // the ANTz Grid rule — so neither lives on its frame, which carries scale
    // (1, 1, 1). Its frame is therefore the ONE thing a detach may legitimately
    // change: an ancestor's scale (node 20's 1.25 here) cannot stay on a root's
    // frame and moves into the grid's own scale field instead, where it drives
    // exactly the same plate and the same child positions.
    //
    // So this compares what the grid actually puts on screen — the desktop's
    // world_basis and world_pos, which is what worldPlacements reports — plus
    // its children's frames, which have to be untouched.
    const nodes = scene()
    const beforePlacements = worldPlacements(nodes)
    const { exported, before, after } = roundTrip([30])
    expect(exported.plan.ids).toEqual([30, 31, 32])

    const afterPlacements = worldPlacements(
      parseGvNodeCsv(writeGvNodeCsv(exported.nodes)).nodes,
    )
    const was = beforePlacements.get(30)!
    const now = afterPlacements.get(30)!
    for (let i = 0; i < 3; i++) {
      expect(now.pos[i], `grid position ${i}`).toBeCloseTo(was.pos[i], 5)
      for (let j = 0; j < 3; j++) {
        expect(now.basis[i][j], `grid basis ${i},${j}`).toBeCloseTo(was.basis[i][j], 5)
      }
    }
    // …and the ancestor scale is where it went.
    const grid = nodes.find((n) => n.id === 30)!
    const saved = exported.nodes.find((n) => n.id === 30)!
    expect(saved.scale.x).toBeCloseTo(grid.scale.x * 1.25, 6)
    expect(saved.scale.y).toBeCloseTo(grid.scale.y * 1.25, 6)
    expect(saved.scale.z).toBeCloseTo(grid.scale.z * 1.25, 6)

    // Its direct children keep their POSITIONS exactly, since a grid's scale
    // re-spaces them — that is what the absorbed 1.25 goes on doing.
    const wasPos = new THREE.Vector3().setFromMatrixPosition(before.get(31)!)
    const nowPos = new THREE.Vector3().setFromMatrixPosition(after.get(31)!)
    expect(nowPos.distanceTo(wasPos), 'child 31 moved').toBeCloseTo(0, 4)
  })

  it('is the one case where a detach changes a rendered size, and says why', () => {
    // The single limit of the grid bake, shared with the desktop (the parity
    // dump agrees value for value): a grid's own scale re-spaces its children
    // WITHOUT stretching them — the ANTz Grid rule — while a root grid's frame
    // carries scale (1, 1, 1) by construction. So an ancestor scale absorbed
    // into a detached grid re-spaces its direct children exactly as before, but
    // stops reaching their SHAPES, and with them everything further down: the
    // subtree under a detached grid draws 1/1.25 the size here, and a
    // grandchild placed off a shrunken parent moves with it.
    //
    // There is nowhere else for that factor to go, which is why this is stated
    // rather than fixed. It arises only for a World Grid under a scaled
    // ancestor, and "Save its parent nodes too" is the way out.
    const { before, after } = roundTrip([30])
    const axisLength = (m: THREE.Matrix4) =>
      new THREE.Vector3().setFromMatrixColumn(m, 0).length()
    for (const id of [31, 32]) {
      expect(axisLength(after.get(id)!) * 1.25, `node ${id} scale`).toBeCloseTo(
        axisLength(before.get(id)!),
        5,
      )
    }
  })

  it('holds for a child of a retuned Topology Scale parent', () => {
    // Node 50 carries the ANTz topo_scale, so its child's translate reaches
    // 1/180 as far. The bake must not have to know that — it reads the frame.
    const { before, after, ids } = roundTrip([51])
    expect(ids).toEqual([51])
    expectMatricesClose(before, after, ids, 5)
  })

  it('holds without the CSV round trip to full float precision', () => {
    // Same guarantee with the writer's 6 decimal places taken out of it: the
    // maths itself is exact, and the 1e-5 above is the file format's rounding.
    const nodes = scene()
    const before = worldMatrices(nodes)
    const exported = buildSelection(nodes, [3], DEFAULT_EXPORT_OPTIONS, worldPlacements(nodes))
    expectMatricesClose(before, worldMatrices(exported.nodes), exported.plan.ids, 9)
  })

  it('is what the Raw policy does NOT do', () => {
    // The control case. Saved raw, node 3's (30, 45, 5) reloads as literal
    // world coordinates, hundreds of units from where it was drawn.
    const nodes = scene()
    const before = worldMatrices(nodes)
    const raw = buildSelection(
      nodes,
      [3],
      options({ detach: Detach.Raw }),
      worldPlacements(nodes),
    )
    const after = worldMatrices(raw.nodes)
    const was = new THREE.Vector3().setFromMatrixPosition(before.get(3)!)
    const now = new THREE.Vector3().setFromMatrixPosition(after.get(3)!)
    expect(was.distanceTo(now)).toBeGreaterThan(50)
  })

  it('needs no bake at all under the Ancestors policy', () => {
    const nodes = scene()
    const before = worldMatrices(nodes)
    const exported = buildSelection(
      nodes,
      [5],
      options({ detach: Detach.Ancestors }),
      worldPlacements(nodes),
    )
    expect(exported.plan.detachedIds).toEqual([])
    expectMatricesClose(before, worldMatrices(exported.nodes), exported.plan.ids, 9)
  })
})

describe('shear is reported from a real scene', () => {
  it('flags a child of a rotated, non-uniformly scaled parent', () => {
    // Node 21 is scaled (3, 1, 0.5) AND rotated, so its child's basis columns
    // stop being perpendicular — a shape no rotate + scale pair can express.
    const nodes = scene()
    const exported = buildSelection(nodes, [22], DEFAULT_EXPORT_OPTIONS, worldPlacements(nodes))
    expect(exported.approximatedIds).toEqual([22])
  })

  it('leaves a uniformly scaled ancestor unflagged', () => {
    const nodes = scene()
    const exported = buildSelection(nodes, [3], DEFAULT_EXPORT_OPTIONS, worldPlacements(nodes))
    expect(exported.approximatedIds).toEqual([])
  })
})

describe('worldPlacements', () => {
  it('agrees with the built scene graph, node for node', () => {
    // The placement walk is a second traversal of the same rule buildScene
    // uses; if the two ever drift, every bake is silently wrong.
    const nodes = scene()
    const built = buildScene(nodes, { showHidden: true })
    built.root.updateMatrixWorld(true)
    const placements = worldPlacements(nodes)
    expect(placements.size).toBe(nodes.length)
    for (const node of nodes) {
      const frame = built.frames.get(node.id)!
      const p = new THREE.Vector3().setFromMatrixPosition(frame.matrixWorld)
      const placement = placements.get(node.id)!
      expect(placement.pos[0], `node ${node.id} x`).toBeCloseTo(p.x, 9)
      expect(placement.pos[1], `node ${node.id} y`).toBeCloseTo(p.y, 9)
      expect(placement.pos[2], `node ${node.id} z`).toBeCloseTo(p.z, 9)
    }
  })
})
