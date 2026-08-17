// Cross-implementation parity for Save Selection As… — the export's OUTPUT
// rows, diffed against the desktop's own `build_selection`.
//
// The feature is one long chain: membership rules → world placement → basis
// decomposition → Euler recovery → the rewritten row. A diff of the finished
// rows covers all of it at once, which is what this file's `cases` suite does;
// the two suites before it pin the lower layers separately, so a failure can
// say WHICH half disagreed rather than only that something did.
//
// The web computes its OWN placements (worldPlacements, off this app's frame
// rules) rather than reading the desktop's dumped ones. That is deliberate: the
// promise of the feature is that a detached node reopens where THIS app drew
// it, so a harness fed the other app's transforms would prove nothing about the
// only step that could go wrong here.
//
// One layer had to be reached by a different route and is the reason this
// harness exists at all: `_nearest_rotation` is an SVD on the desktop, and
// JavaScript ships none — the web runs Higham's polar iteration instead, which
// converges to the same orthogonal factor. The `decompositions` suite is what
// holds those two together, sheared and rank-deficient cases included.
//
// Regenerate src/gv/fixtures/selection_exports.json with
// tools/dump_selection_exports.py when a fixture or the desktop's export math
// changes.

import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import type { DetachPolicy, ExportOptions, Mat3 } from '../gv/selectionExport'
import { buildSelection, decomposeBasis, eulerXyzFromMatrix } from '../gv/selectionExport'
import { worldPlacements } from './selectionPlacement'
import selectionCsv from '../gv/fixtures/selection_export_gv_node.csv?raw'
import topologyCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'
import worldGridCsv from '../gv/fixtures/world_grid_example_gv_node.csv?raw'
import topoScaleCsv from '../gv/fixtures/topo_scale_gv_node.csv?raw'
import referenceRaw from '../gv/fixtures/selection_exports.json?raw'

interface DumpNode {
  id: number
  type: number
  parent_id: number
  branch_level: number
  translate: [number, number, number]
  rotate: [number, number, number]
  scale: [number, number, number]
  rotation_mode: number
  topo: number
  ratio: number
  topo_scale: number
  subspace: number
}

interface DumpCase {
  name: string
  fixture: string
  selected: number[]
  options: {
    include_descendants: boolean
    detach: string
    include_world_row: boolean
  }
  plan: {
    ids: number[]
    detached_ids: number[]
    descendants_added: number
    ancestors_added: number
    links_added: number
    dropped_links: number
    world_id: number | null
    count: number
  }
  approximated_ids: number[]
  animated_detached: number[]
  nodes: DumpNode[]
}

interface Dump {
  base_scale: number
  cases: DumpCase[]
  decompositions: {
    name: string
    basis: number[][]
    rotation: number[][]
    scale: [number, number, number]
    shear: number
    euler: [number, number, number]
  }[]
  eulers: { angles: number[]; matrix: number[][]; recovered: [number, number, number] }[]
}

const reference: Dump = JSON.parse(referenceRaw)

const FIXTURES: Record<string, string> = {
  selection_export: selectionCsv,
  topology_example: topologyCsv,
  world_grid_example: worldGridCsv,
  topo_scale: topoScaleCsv,
}

function asMat3(rows: number[][]): Mat3 {
  return [
    [rows[0][0], rows[0][1], rows[0][2]],
    [rows[1][0], rows[1][1], rows[1][2]],
    [rows[2][0], rows[2][1], rows[2][2]],
  ]
}

function multiply(R: Mat3, s: readonly number[]): number[][] {
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => R[r][c] * s[c]))
}

// Angles are compared through the MATRIX they build, never value for value: at
// gimbal lock the split between rx and rz is arbitrary and both apps say so, so
// two different triples can be the same rotation. Everywhere else the two agree
// to float noise anyway, which this still catches.
function rotationFromEuler(angles: readonly number[]): number[][] {
  const DEG = Math.PI / 180
  const [x, y, z] = angles.map((a) => a * DEG)
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)
  // Rx · Ry · Rz, the desktop's own product (see eulerXyzFromMatrix's docstring).
  return [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ]
}

function expectMatrixClose(actual: number[][], expected: number[][], tol: number, why: string) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      expect(actual[r][c], `${why} [${r}][${c}]`).toBeCloseTo(expected[r][c], tol)
    }
  }
}

describe('decompose_basis parity', () => {
  it('covers every kind of basis the dump carries', () => {
    expect(reference.decompositions.length).toBeGreaterThan(10)
  })

  for (const entry of reference.decompositions) {
    it(`matches the desktop for ${entry.name}`, () => {
      const A = asMat3(entry.basis)
      const { rotation, scale, shear } = decomposeBasis(A)

      expect(scale[0], 'scale x').toBeCloseTo(entry.scale[0], 12)
      expect(scale[1], 'scale y').toBeCloseTo(entry.scale[1], 12)
      expect(scale[2], 'scale z').toBeCloseTo(entry.scale[2], 12)
      expect(shear, 'shear').toBeCloseTo(entry.shear, 12)

      // R · diag(s) has to reproduce the input wherever the desktop's does —
      // which is the property the whole bake rests on, and is true even for a
      // collapsed axis (the zero annihilates whatever direction was invented
      // for it, which is exactly why the two apps may pick different ones).
      const rebuilt = multiply(rotation, scale)
      const desktopRebuilt = multiply(asMat3(entry.rotation), entry.scale)
      expectMatrixClose(rebuilt, desktopRebuilt, 10, `${entry.name} R·diag(s)`)

      // The rotation itself agrees column for column on every live axis; a dead
      // one is compared through the product above instead.
      const live = [0, 1, 2].filter((j) => Math.abs(entry.scale[j]) > 1e-12)
      for (const j of live) {
        for (let r = 0; r < 3; r++) {
          expect(rotation[r][j], `${entry.name} R col ${j} row ${r}`).toBeCloseTo(
            entry.rotation[r][j],
            10,
          )
        }
      }
    })
  }
})

describe('euler_xyz_from_matrix parity', () => {
  for (const entry of reference.eulers) {
    it(`recovers ${entry.angles.join(', ')} as the desktop does`, () => {
      // Angle for angle, not through the matrix: both apps resolve gimbal lock
      // the same deterministic way (rz = 0, the whole rotation to rx), so there
      // is no case where two different triples are the right answer. Comparing
      // the rebuilt matrix instead would also hide a disagreement in the branch
      // AND go soft near lock, where cos(ry) comes back through a square root.
      const recovered = eulerXyzFromMatrix(asMat3(entry.matrix))
      for (let i = 0; i < 3; i++) {
        expect(recovered[i], `axis ${i} of ${entry.angles.join(', ')}`).toBeCloseTo(
          entry.recovered[i],
          9,
        )
      }
    })
  }
})

describe('build_selection parity', () => {
  it('has a case for every rule the desktop tests', () => {
    expect(reference.cases.length).toBeGreaterThan(25)
  })

  for (const entry of reference.cases) {
    it(`matches the desktop export for ${entry.name}`, () => {
      const csv = FIXTURES[entry.fixture]
      expect(csv, `fixture ${entry.fixture}`).toBeTruthy()
      const nodes = parseGvNodeCsv(csv).nodes
      const options: ExportOptions = {
        includeDescendants: entry.options.include_descendants,
        detach: entry.options.detach as DetachPolicy,
        includeWorldRow: entry.options.include_world_row,
      }
      const exported = buildSelection(
        nodes,
        new Set(entry.selected),
        options,
        worldPlacements(nodes),
      )

      // Membership, in the desktop's own order.
      expect(exported.plan.ids, 'plan ids').toEqual(entry.plan.ids)
      expect(exported.plan.detachedIds, 'detached').toEqual(entry.plan.detached_ids)
      expect(exported.plan.descendantsAdded).toBe(entry.plan.descendants_added)
      expect(exported.plan.ancestorsAdded).toBe(entry.plan.ancestors_added)
      expect(exported.plan.linksAdded).toBe(entry.plan.links_added)
      expect(exported.plan.droppedLinks).toBe(entry.plan.dropped_links)
      expect(exported.plan.worldId).toBe(entry.plan.world_id)
      expect(exported.plan.count).toBe(entry.plan.count)
      expect(exported.approximatedIds, 'approximated').toEqual(entry.approximated_ids)
      expect(exported.animatedDetached, 'animated detached').toEqual(entry.animated_detached)

      // …and every written row, field for field.
      expect(exported.nodes.map((n) => n.id)).toEqual(entry.nodes.map((n) => n.id))
      for (let i = 0; i < entry.nodes.length; i++) {
        const want = entry.nodes[i]
        const got = exported.nodes[i]
        const at = `${entry.name} node ${want.id}`
        expect(got.type, `${at} type`).toBe(want.type)
        expect(got.parentId, `${at} parent`).toBe(want.parent_id)
        expect(got.branchLevel, `${at} branch level`).toBe(want.branch_level)
        expect(got.topo, `${at} topo`).toBe(want.topo)
        expect(got.subspace, `${at} subspace`).toBe(want.subspace)
        expect(got.ratio, `${at} ratio`).toBeCloseTo(want.ratio, 9)
        expect(got.topoScale, `${at} topo scale`).toBeCloseTo(want.topo_scale, 12)
        expect(got.rotationMode, `${at} rotation mode`).toBe(want.rotation_mode)
        for (const [axis, k] of [
          ['x', 0],
          ['y', 1],
          ['z', 2],
        ] as const) {
          expect(got.translate[axis], `${at} translate ${axis}`).toBeCloseTo(want.translate[k], 7)
          expect(got.scale[axis], `${at} scale ${axis}`).toBeCloseTo(want.scale[k], 9)
        }
        // Rotation through the matrix again, for the gimbal-lock reason above.
        expectMatrixClose(
          rotationFromEuler([got.rotate.x, got.rotate.y, got.rotate.z]),
          rotationFromEuler(want.rotate),
          9,
          `${at} rotation`,
        )
      }
    })
  }
})
