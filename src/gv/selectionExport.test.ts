// Save Selection As… — the rules that need no renderer.
//
// The fidelity guarantee (a detached node reopening exactly where it sat) is
// src/render/selectionExport.test.ts, which needs real world transforms; the
// desktop-for-desktop diff is selectionExport.parity.test.ts. What is pinned
// here is everything else: membership, re-rooting, branch levels, the
// decomposition's own properties, and the filenames.

import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from './nodeCsv'
import type { ExportOptions, Mat3, WorldPlacement } from './selectionExport'
import {
  buildSelection,
  decomposeBasis,
  DEFAULT_EXPORT_OPTIONS,
  describePlan,
  Detach,
  eulerXyzFromMatrix,
  planSelection,
  recomputeBranchLevels,
  selectionExportNames,
  SHEAR_TOLERANCE,
} from './selectionExport'
import { NodeType, RotationMode } from './types'
import fixtureCsv from './fixtures/selection_export_gv_node.csv?raw'

const scene = () => parseGvNodeCsv(fixtureCsv).nodes

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS, ...overrides }
}

/** Glyph ids in the export — the World row arrives on its own terms. */
function glyphIds(nodes: { id: number; type: number }[]): number[] {
  return nodes.filter((n) => n.type !== NodeType.World).map((n) => n.id)
}

describe('membership', () => {
  it('brings every descendant by default', () => {
    // The closure under node 4 is {5, 7, 8} — but link 7's B-end is node 6, on
    // the other branch, so the link is dropped on the way out. Descendant
    // membership and link validity are separate rules.
    const exported = buildSelection(scene(), [4])
    expect(exported.plan.descendantsAdded).toBe(3)
    expect(glyphIds(exported.nodes).sort((a, b) => a - b)).toEqual([4, 5, 8])
    expect(exported.plan.droppedLinks).toBe(1)
  })

  it('can be told to write only the highlighted rows', () => {
    const exported = buildSelection(scene(), [4], options({ includeDescendants: false }))
    expect(glyphIds(exported.nodes)).toEqual([4])
    expect(exported.plan.descendantsAdded).toBe(0)
  })

  it('pulls in a link whose two ends are both present, unselected', () => {
    // Link 7 joins 4 and 6 and was never selected; without it, saving both ends
    // would silently lose the edge.
    const exported = buildSelection(
      scene(),
      [4, 6],
      options({ includeDescendants: false }),
    )
    expect(glyphIds(exported.nodes)).toContain(7)
    expect(exported.plan.linksAdded).toBe(1)
  })

  it('drops a link reaching outside the export', () => {
    // Link 9 joins 6 to root 2. Exporting the subtree under 3 takes 6 but not
    // 2, so the link goes rather than dangle.
    const exported = buildSelection(scene(), [3])
    expect(glyphIds(exported.nodes)).not.toContain(9)
    expect(exported.plan.droppedLinks).toBe(1)
  })

  it('keeps scene order, so the file stays diffable against its source', () => {
    const exported = buildSelection(scene(), [3])
    expect(glyphIds(exported.nodes)).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('brings the ancestor chain instead, when asked', () => {
    const exported = buildSelection(scene(), [5], options({ detach: Detach.Ancestors }))
    expect(glyphIds(exported.nodes)).toEqual([2, 3, 4, 5])
    expect(exported.plan.ancestorsAdded).toBe(3)
    expect(exported.plan.detachedIds).toEqual([])
    // Untouched, not baked: an ancestor's own authored fields are intact.
    const three = exported.nodes.find((n) => n.id === 3)!
    expect(three.rotationMode).toBe(RotationMode.HeadingTiltRoll)
  })

  it('adds no ancestors for a root selection', () => {
    const exported = buildSelection(scene(), [2], options({ detach: Detach.Ancestors }))
    expect(exported.plan.ancestorsAdded).toBe(0)
    expect(exported.plan.detachedIds).toEqual([])
  })

  it('carries the World row at the head of the file', () => {
    const exported = buildSelection(scene(), [5])
    expect(exported.nodes[0].type).toBe(NodeType.World)
    expect(exported.plan.worldRow).toBe(true)
    expect(exported.nodes[0].color).toMatchObject({ r: 10, g: 20, b: 30 })
  })

  it('can be told to leave the World row behind', () => {
    const exported = buildSelection(scene(), [5], options({ includeWorldRow: false }))
    expect(exported.plan.worldRow).toBe(false)
    expect(exported.nodes.every((n) => n.type !== NodeType.World)).toBe(true)
  })

  it('never exports a selected World row as a glyph', () => {
    // The World row is reachable by clicking its Node Table row. It must arrive
    // through the includeWorldRow path (once, at the head), not as a member.
    const exported = buildSelection(scene(), [1, 5])
    expect(exported.nodes.filter((n) => n.id === 1)).toHaveLength(1)
    expect(exported.nodes[0].id).toBe(1)
  })

  it('produces nothing from an empty or World-only selection', () => {
    expect(buildSelection(scene(), []).nodes).toEqual([])
    expect(buildSelection(scene(), [1]).nodes).toEqual([])
  })

  it('restates branch levels for the new hierarchy', () => {
    const exported = buildSelection(scene(), [4])
    const levels = new Map(exported.nodes.map((n) => [n.id, n.branchLevel]))
    expect(levels.get(4)).toBe(0) // was 2, now a root
    expect(levels.get(5)).toBe(1) // was 3
    expect(levels.get(8)).toBe(1)
  })

  it('preserves ids, so record_id and channel bindings stay valid', () => {
    const exported = buildSelection(scene(), [3])
    for (const n of exported.nodes) expect(n.extras['record_id']).toBe(String(n.id))
    // Node 5 binds channel 7 in the fixture; the binding means what it did.
    expect(exported.nodes.find((n) => n.id === 5)!.extras['ch_input_id']).toBe('7')
  })

  it('never mutates the scene it exports from', () => {
    const nodes = scene()
    const before = JSON.stringify(nodes)
    buildSelection(nodes, [3])
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

describe('detaching', () => {
  const placements = (): Map<number, WorldPlacement> =>
    new Map([
      [
        3,
        {
          pos: [10, 20, 30],
          basis: [
            [0, -2, 0],
            [2, 0, 0],
            [0, 0, 2],
          ],
        },
      ],
    ])

  it('re-roots a node whose parent stayed behind', () => {
    const exported = buildSelection(scene(), [3], DEFAULT_EXPORT_OPTIONS, placements())
    const three = exported.nodes.find((n) => n.id === 3)!
    expect(exported.plan.detachedIds).toEqual([3])
    expect(three.parentId).toBe(0)
    expect(three.translate).toEqual({ x: 10, y: 20, z: 30 })
    expect(three.scale.x).toBeCloseTo(2, 12)
    expect(three.rotationMode).toBe(RotationMode.EulerXYZ)
  })

  it('leaves the authored values alone under the Raw policy', () => {
    // The control case, and the bug the bake exists to fix: node 3's translate
    // (30, 45, 5) is longitude/latitude/altitude on its Sphere parent. Saved
    // raw it reloads as literal world (30, 45, 5).
    const exported = buildSelection(
      scene(),
      [3],
      options({ detach: Detach.Raw }),
      placements(),
    )
    const three = exported.nodes.find((n) => n.id === 3)!
    expect(three.translate).toEqual({ x: 30, y: 45, z: 5 })
    expect(three.rotationMode).toBe(RotationMode.HeadingTiltRoll)
    expect(three.parentId).toBe(0) // still re-rooted; only the fields are kept
  })

  it("leaves the children's coordinate system alone", () => {
    // topo/ratio/topoScale/subspace describe the frame a node offers its
    // CHILDREN, so a detach must not touch them.
    const source = scene().find((n) => n.id === 3)!
    const exported = buildSelection(scene(), [3], DEFAULT_EXPORT_OPTIONS, placements())
    const three = exported.nodes.find((n) => n.id === 3)!
    expect(three.topo).toBe(source.topo)
    expect(three.ratio).toBe(source.ratio)
    expect(three.topoScale).toBe(source.topoScale)
    expect(three.subspace).toBe(source.subspace)
  })

  it('leaves the fields as authored when the node has no known placement', () => {
    // A node past the \ draw limit, or inside a truncated parent cycle: better
    // the authored values than a silent zero.
    const exported = buildSelection(scene(), [3], DEFAULT_EXPORT_OPTIONS, new Map())
    const three = exported.nodes.find((n) => n.id === 3)!
    expect(three.translate).toEqual({ x: 30, y: 45, z: 5 })
  })

  it('reports a node whose motion rates changed frame of reference', () => {
    // Rates on a Sphere child orbit it in longitude; on a root the same numbers
    // drift it through world XYZ. The export cannot fix that, so it says so.
    const exported = buildSelection(scene(), [22])
    expect(exported.animatedDetached).toEqual([22])
  })

  it('does not report rates on a node that stayed attached', () => {
    const exported = buildSelection(scene(), [21])
    expect(exported.plan.detachedIds).toEqual([])
    expect(exported.animatedDetached).toEqual([])
  })
})

describe('decomposeBasis', () => {
  const rotation = (rx: number, ry: number, rz: number): Mat3 => {
    const DEG = Math.PI / 180
    const [x, y, z] = [rx * DEG, ry * DEG, rz * DEG]
    const [cx, sx, cy, sy, cz, sz] = [
      Math.cos(x),
      Math.sin(x),
      Math.cos(y),
      Math.sin(y),
      Math.cos(z),
      Math.sin(z),
    ]
    return [
      [cy * cz, -cy * sz, sy],
      [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
      [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ]
  }
  const scaled = (R: Mat3, s: readonly number[]): Mat3 => [
    [R[0][0] * s[0], R[0][1] * s[1], R[0][2] * s[2]],
    [R[1][0] * s[0], R[1][1] * s[1], R[1][2] * s[2]],
    [R[2][0] * s[0], R[2][1] * s[1], R[2][2] * s[2]],
  ]
  const expectRebuilds = (A: Mat3) => {
    const { rotation: R, scale } = decomposeBasis(A)
    const back = scaled(R, scale)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) expect(back[r][c]).toBeCloseTo(A[r][c], 12)
    }
  }

  it('is exact for a rotation and a per-axis scale', () => {
    const A = scaled(rotation(20, -35, 80), [2, 0.5, 3.25])
    const { scale, shear } = decomposeBasis(A)
    expect(shear).toBeCloseTo(0, 12)
    expect(scale[0]).toBeCloseTo(2, 12)
    expect(scale[1]).toBeCloseTo(0.5, 12)
    expect(scale[2]).toBeCloseTo(3.25, 12)
    expectRebuilds(A)
  })

  it('folds a reflection into the Z scale, keeping the rotation a rotation', () => {
    // A negative scale field upstream leaves a left-handed basis. R must stay a
    // true rotation (det +1) and the sign ride on the Z scale, so the product is
    // still exact — a rotation field cannot express a mirror.
    const A = scaled(rotation(10, 20, 30), [1, -2, 1])
    const { rotation: R, shear } = decomposeBasis(A)
    const det =
      R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
      R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
      R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])
    expect(det).toBeCloseTo(1, 12)
    expect(shear).toBeCloseTo(0, 12)
    expectRebuilds(A)
  })

  it('treats a collapsed axis as exact, not approximate', () => {
    // Scale 0 annihilates whatever rotation column pairs with it, so R · diag(s)
    // still reproduces the basis however the dead direction was chosen.
    const A = scaled(rotation(45, 0, 0), [1, 0, 2])
    const { shear } = decomposeBasis(A)
    expect(shear).toBeCloseTo(0, 12)
    expectRebuilds(A)
  })

  it('reports shear, which no rotate+scale pair can express', () => {
    const { shear } = decomposeBasis([
      [1, 0.4, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    expect(shear).toBeGreaterThan(0.3)
    expect(shear).toBeGreaterThan(SHEAR_TOLERANCE)
  })

  it('counts a sheared basis as approximated in the export', () => {
    // Which scenes actually shear — a rotated, non-uniformly scaled ancestor —
    // is pinned in src/render/selectionExport.test.ts, where real placements
    // exist; this is the reporting rule alone.
    const sheared: Mat3 = [
      [1, 0.4, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const exported = buildSelection(
      scene(),
      [3],
      DEFAULT_EXPORT_OPTIONS,
      new Map([[3, { pos: [0, 0, 0], basis: sheared }]]),
    )
    expect(exported.approximatedIds).toEqual([3])
  })

  it('does not flag a rotation with a uniform scale', () => {
    const clean = scaled(rotation(15, 35, -25), [1.5, 1.5, 1.5])
    const exported = buildSelection(
      scene(),
      [3],
      DEFAULT_EXPORT_OPTIONS,
      new Map([[3, { pos: [0, 0, 0], basis: clean }]]),
    )
    expect(exported.approximatedIds).toEqual([])
  })
})

function rotate(rx: number, ry: number, rz: number): Mat3 {
  const DEG = Math.PI / 180
  const [x, y, z] = [rx * DEG, ry * DEG, rz * DEG]
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(x),
    Math.sin(x),
    Math.cos(y),
    Math.sin(y),
    Math.cos(z),
    Math.sin(z),
  ]
  return [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ]
}

describe('eulerXyzFromMatrix', () => {
  for (const angles of [
    [0, 0, 0],
    [30, 45, 60],
    [-120, 15, 175],
    [10, -80, -95],
    [0, 90, 0], // gimbal lock
    [33, -90, 21], // gimbal lock, rotation split between rx and rz
  ]) {
    it(`round-trips ${angles.join(', ')}`, () => {
      const R = rotate(angles[0], angles[1], angles[2])
      const back = rotate(...(eulerXyzFromMatrix(R) as [number, number, number]))
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) expect(back[r][c]).toBeCloseTo(R[r][c], 12)
      }
    })
  }

  it('sends the whole rotation to rx at gimbal lock', () => {
    const [, , rz] = eulerXyzFromMatrix(rotate(33, 90, 21))
    expect(rz).toBe(0)
  })
})

describe('recomputeBranchLevels', () => {
  it('treats a parent outside the set as absent', () => {
    const nodes = parseGvNodeCsv(fixtureCsv).nodes.filter((n) => [4, 5, 8].includes(n.id))
    recomputeBranchLevels(nodes, new Set([4, 5, 8]))
    expect(nodes.map((n) => [n.id, n.branchLevel])).toEqual([
      [4, 0],
      [5, 1],
      [8, 1],
    ])
  })
})

describe('planSelection previews what a write would contain', () => {
  it('counts the World row in, and moves with the options', () => {
    const nodes = scene()
    expect(planSelection(nodes, [3]).count).toBe(7) // 6 glyphs + the World row
    expect(planSelection(nodes, [3], options({ includeWorldRow: false })).count).toBe(6)
    expect(planSelection(nodes, [3], options({ includeDescendants: false })).count).toBe(2)
    // Bringing parent 2 along also rescues link 9 (6 → 2), whose far end was
    // outside before: 7 glyphs + the link + the World row.
    expect(planSelection(nodes, [3], options({ detach: Detach.Ancestors })).count).toBe(9)
  })

  it('copies and modifies nothing', () => {
    const nodes = scene()
    const before = JSON.stringify(nodes)
    planSelection(nodes, [3], options({ detach: Detach.Ancestors }))
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

describe('describePlan', () => {
  it('names everything the export decided', () => {
    const text = describePlan(planSelection(scene(), [3]), 1)
    expect(text).toContain('7 row(s)')
    expect(text).toContain('descendant')
    expect(text).toContain('re-rooted')
    expect(text).toContain('dropped')
  })

  it('says so when there is nothing to save', () => {
    expect(describePlan(planSelection(scene(), []), 0)).toContain('select one or more')
  })
})

describe('selectionExportNames', () => {
  it('keeps the node/tag convention intact', () => {
    const names = selectionExportNames('Cyclone_gv_node.csv')
    expect(names.node).toBe('Cyclone_gv_selection_node.csv')
    expect(names.tag).toBe('Cyclone_gv_selection_tag.csv')
    expect(names.chMap).toBe('Cyclone_gv_selection_ch-map.csv')
    expect(names.chTracks).toBe('Cyclone_gv_selection_ch-tracks.csv')
  })

  it('drops a save stamp rather than burying it mid-name', () => {
    expect(selectionExportNames('Cyclone_gv_node20260814101010.csv').node).toBe(
      'Cyclone_gv_selection_node.csv',
    )
  })

  it('still pairs when the stem does not end in node', () => {
    const names = selectionExportNames('scene.csv')
    expect(names.node).toBe('scene_selection_node.csv')
    expect(names.tag).toBe('scene_selection_tag.csv')
  })
})
