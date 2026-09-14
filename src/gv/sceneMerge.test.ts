// Scene merge unit tests — desktop tests/test_scene_merge.py, case for case,
// plus the cases this port adds (the A-end link divergence and scale).
//
// The contract: loading a second node file INTO a loaded scene rebases it onto
// a fresh id block above everything already present, and rewrites every
// id-bearing field that goes with it — parent_id, a link's child_id, and
// record_id. World/Camera rows are dropped rather than duplicated, channel
// bindings are cleared, and coordinates are left alone so the two scenes
// overlay in one world space.

import { describe, expect, it } from 'vitest'
import { worldPlacements } from '../render/selectionPlacement'
import { blankNode } from './createNode'
import { parseGvNodeCsv } from './nodeCsv'
import { mergeNodes, recomputeBranchLevels } from './sceneMerge'
import { applyTags, parseGvTagCsv } from './tagCsv'
import type { GvNode } from './types'
import { NodeType } from './types'
import { writeGvNodeCsv } from './writeNodeCsv'
import { writeGvTagCsv } from './writeTagCsv'

const DEFAULTS = {
  geometry: 3,
  topo: 0,
  scale: { x: 1, y: 1, z: 1 },
  color: { r: 255, g: 0, b: 0, a: 255 },
}

function node(id: number, overrides: Partial<GvNode> = {}): GvNode {
  return { ...blankNode(id, DEFAULTS), ...overrides }
}

/** Two-node host scene: root 1 with child 2. */
function sceneA(): GvNode[] {
  return [
    node(1, { translate: { x: 10, y: 0, z: 0 } }),
    node(2, { parentId: 1, branchLevel: 1, translate: { x: 3, y: 0, z: 0 } }),
  ]
}

/**
 * Guest scene whose ids collide with sceneA()'s, exercising every rewrite
 * rule: a World row, a Camera row, a glyph with a channel binding, a child, an
 * orphan (parented onto the dropped camera), an internal link and a link with
 * a dangling B-end.
 */
function sceneB(): GvNode[] {
  const b = [
    node(1, { type: NodeType.World }),
    node(2, { type: NodeType.Camera }),
    node(3, { translate: { x: 100, y: 0, z: 0 } }),
    node(4, { parentId: 3, branchLevel: 1, translate: { x: 5, y: 0, z: 0 } }),
    node(5, { parentId: 2, translate: { x: 7, y: 0, z: 0 } }), // child of the camera
    node(6, { type: NodeType.Link, parentId: 3, branchLevel: 1 }), // B-end inside
    node(7, { type: NodeType.Link, parentId: 3, branchLevel: 1 }), // B-end outside
  ]
  for (const n of b) n.extras = { record_id: String(n.id), ch_input_id: '0' }
  b[2].extras['ch_input_id'] = '7'
  b[5].extras['child_id'] = '4'
  b[6].extras['child_id'] = '99'
  return b
}

const byNewId = (nodes: GvNode[], id: number) => nodes.find((n) => n.id === id)!

describe('id rebasing', () => {
  it('starts new ids above the host and never collides', () => {
    const a = sceneA()
    const r = mergeNodes(a, sceneB())
    expect(Math.min(...r.nodes.map((n) => n.id))).toBe(Math.max(...a.map((n) => n.id)) + 1)
    const merged = [...a, ...r.nodes]
    expect(new Set(merged.map((n) => n.id)).size).toBe(merged.length)
  })

  it('remaps parent ids into the new block', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(byNewId(r.nodes, r.idMap.get(4)!).parentId).toBe(r.idMap.get(3))
  })

  it('keeps roots as roots', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(byNewId(r.nodes, r.idMap.get(3)!).parentId).toBe(0)
  })

  it('never mutates the incoming list', () => {
    const b = sceneB()
    const before = JSON.stringify(b)
    mergeNodes(sceneA(), b)
    expect(JSON.stringify(b)).toBe(before)
  })

  it('keeps stacking when the same list is merged twice', () => {
    let a = sceneA()
    a = [...a, ...mergeNodes(a, sceneB()).nodes]
    const merged = [...a, ...mergeNodes(a, sceneB()).nodes]
    expect(new Set(merged.map((n) => n.id)).size).toBe(merged.length)
  })

  it('treats an empty incoming list as a no-op', () => {
    const r = mergeNodes(sceneA(), [])
    expect(r.nodes).toEqual([])
    expect(r.idMap.size).toBe(0)
  })

  it('lets a dropped link consume its id, as the desktop does', () => {
    const r = mergeNodes(sceneA(), sceneB())
    // Kept rows are World 1 (the host has none), 3, 4, 5, 6 and 7 → ids 3..8;
    // link 7 is dropped but still holds id 8.
    expect([...r.idMap.values()]).toEqual([3, 4, 5, 6, 7, 8])
    expect(r.nodes.map((n) => n.id)).toEqual([3, 4, 5, 6, 7])
  })
})

describe('infrastructure rows', () => {
  it('drops World and Camera rows when the host has a World', () => {
    const a = [...sceneA(), node(9, { type: NodeType.World })]
    const r = mergeNodes(a, sceneB())
    expect(r.skippedGlobal).toBe(2)
    expect(r.nodes.some((n) => n.type === NodeType.World || n.type === NodeType.Camera)).toBe(false)
  })

  it('keeps the World row when the host has none', () => {
    const r = mergeNodes([], sceneB())
    expect(r.nodes.filter((n) => n.type === NodeType.World)).toHaveLength(1)
    expect(r.skippedGlobal).toBe(1) // the Camera row only
  })

  it('keeps only the first World row merging into an empty scene', () => {
    const b = [node(1, { type: NodeType.World }), node(2, { type: NodeType.World }), node(3)]
    const r = mergeNodes([], b)
    expect(r.nodes.filter((n) => n.type === NodeType.World)).toHaveLength(1)
    expect(r.skippedGlobal).toBe(1)
  })

  it('re-roots a node parented onto a dropped row', () => {
    const r = mergeNodes(sceneA(), sceneB())
    const orphan = byNewId(r.nodes, r.idMap.get(5)!)
    expect([orphan.parentId, orphan.branchLevel]).toEqual([0, 0])
    expect(r.rerooted).toBe(1)
  })

  it('re-roots a parent that was already dangling in the source file', () => {
    const r = mergeNodes(sceneA(), [node(1, { parentId: 42 })])
    expect(r.nodes[0].parentId).toBe(0)
    expect(r.rerooted).toBe(1)
  })
})

describe('links', () => {
  it('remaps an internal link B-end', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(byNewId(r.nodes, r.idMap.get(6)!).extras['child_id']).toBe(String(r.idMap.get(4)))
  })

  it('drops a link with an outside B-end rather than leaving it dangling', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(r.droppedLinks).toBe(1)
    expect(r.nodes.some((n) => n.id === r.idMap.get(7))).toBe(false)
  })

  // Divergence from the desktop (agreed 2026-09-13): its check is B-end only.
  it('drops a link whose A-end did not survive, instead of re-rooting it', () => {
    const b = [
      node(1, { type: NodeType.Camera }),
      node(2),
      node(3, { type: NodeType.Link, parentId: 1, extras: { child_id: '2' } }),
    ]
    const r = mergeNodes(sceneA(), b)
    expect(r.nodes.map((n) => n.type)).toEqual([NodeType.Glyph])
    expect(r.droppedLinks).toBe(1)
    expect(r.rerooted).toBe(0)
  })

  it('keeps a link whose source file already had parent 0', () => {
    const b = [node(1), node(2, { type: NodeType.Link, parentId: 0, extras: { child_id: '1' } })]
    const r = mergeNodes(sceneA(), b)
    expect(r.nodes).toHaveLength(2)
    expect(r.droppedLinks).toBe(0)
  })
})

describe('tag join key', () => {
  it('points record_id at the new id, so tag rows stay unique', () => {
    const a = sceneA()
    a[0].text = 'host one'
    a[0].extras = { record_id: '1' }
    const b = sceneB()
    b[2].text = 'guest three'
    b[3].text = 'guest four'
    const merged = [...a, ...mergeNodes(a, b).nodes]
    const rows = writeGvTagCsv(merged).trim().split('\n').slice(1)
    const recordIds = rows.map((r) => r.split(',')[2])
    expect(recordIds).toHaveLength(3)
    expect(new Set(recordIds).size).toBe(3)
  })

  it('leaves a node without a record_id column alone', () => {
    const r = mergeNodes(sceneA(), [node(1)])
    expect(r.nodes[0].extras['record_id']).toBeUndefined()
  })
})

describe('channel bindings', () => {
  it('clears them', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(r.clearedChannels).toBe(1)
    expect(r.nodes.every((n) => (n.extras['ch_input_id'] ?? '0') === '0')).toBe(true)
  })

  for (const key of ['ch_input_id', 'np_ch_in_id', 'ch_output_id', 'np_ch_out_id']) {
    it(`clears the ${key} spelling`, () => {
      const r = mergeNodes(sceneA(), [node(1, { extras: { [key]: '12' } })])
      expect(r.nodes[0].extras[key]).toBe('0')
      expect(r.clearedChannels).toBe(1)
    })
  }
})

describe('geometry', () => {
  it('preserves coordinates so the scenes overlay', () => {
    const r = mergeNodes(sceneA(), sceneB())
    expect(byNewId(r.nodes, r.idMap.get(3)!).translate.x).toBe(100)
    expect(byNewId(r.nodes, r.idMap.get(4)!).translate.x).toBe(5)
  })

  it('leaves host world positions untouched', () => {
    const a = sceneA()
    const before = worldPlacements(a)
    const after = worldPlacements([...a, ...mergeNodes(a, sceneB()).nodes])
    for (const n of a) expect(after.get(n.id)!.pos).toEqual(before.get(n.id)!.pos)
  })

  it('lands a scene merged into itself exactly on top', () => {
    const a = sceneA()
    const r = mergeNodes(a, a)
    const placed = worldPlacements([...a, ...r.nodes])
    const pos = placed.get(2)!.pos
    expect(pos[0]).toBe(13) // guards against comparing two undefineds
    expect(placed.get(r.idMap.get(2)!)!.pos).toEqual(pos)
  })

  it('recomputes branch levels as true depth', () => {
    const b = [node(1), node(2, { parentId: 1, branchLevel: 7 }), node(3, { parentId: 2, branchLevel: 7 })]
    expect(mergeNodes(sceneA(), b).nodes.map((n) => n.branchLevel)).toEqual([0, 1, 2])
  })
})

describe('round trip', () => {
  it('survives the node CSV writer and parser', () => {
    const a = sceneA()
    const merged = [...a, ...mergeNodes(a, sceneB()).nodes]
    const back = parseGvNodeCsv(writeGvNodeCsv(merged)).nodes
    expect(back.map((n) => n.id)).toEqual(merged.map((n) => n.id))
    expect(back.map((n) => n.parentId)).toEqual(merged.map((n) => n.parentId))
    expect(back.map((n) => n.translate.x)).toEqual(merged.map((n) => n.translate.x))
    expect(back.map((n) => Number(n.extras['child_id'] ?? 0))).toEqual(
      merged.map((n) => Number(n.extras['child_id'] ?? 0)),
    )
  })

  it('carries a companion tag file applied before the merge', () => {
    const header =
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,' +
      'scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo'
    const guest = parseGvNodeCsv(
      `${header}\n1,5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,3,0,0\n2,5,1,1,0,0,0,0,0,0,1,1,1,255,0,0,255,3,0,0\n`,
    ).nodes
    const tags = parseGvTagCsv(
      'id,table_id,record_id,title\n0,0,2,"<a href=""https://example.com"">guest two</a>"\n',
    )
    applyTags(guest, tags.byRecordId)
    const r = mergeNodes(sceneA(), guest)
    const tagged = byNewId(r.nodes, r.idMap.get(2)!)
    expect([tagged.text, tagged.link]).toEqual(['guest two', 'https://example.com'])
  })
})

describe('scale', () => {
  it('merges a point-cloud-sized file without overflowing the stack', () => {
    const count = 300_000
    const incoming: GvNode[] = [node(1)]
    for (let i = 2; i <= count; i++) incoming.push(node(i, { parentId: 1, branchLevel: 1 }))
    const r = mergeNodes(sceneA(), incoming)
    expect(r.nodes).toHaveLength(count)
    expect(r.nodes[count - 1].branchLevel).toBe(1)
    expect(r.nodes[count - 1].parentId).toBe(3)
  })
})

describe('recomputeBranchLevels', () => {
  it('treats a parent outside the set as a root', () => {
    const nodes = [node(4, { parentId: 99 }), node(5, { parentId: 4 })]
    recomputeBranchLevels(nodes, new Set([4, 5]))
    expect(nodes.map((n) => n.branchLevel)).toEqual([0, 1])
  })
})
