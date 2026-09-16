// Cross-implementation parity for the ZERO-SCALE CULL.
//
// The desktop side is `glyphviz_gl.viewport._draws_nothing` read against
// `Scene.node_draw_data`'s radius — the same two calls its draw and pick loops
// make. tools/dump_zero_scale_cull.py runs the real pair over
// zero_scale_gv_node.csv and records a verdict per row; this diffs the built
// scene graph against it, since "the desktop would have skipped this draw call"
// means "this app builds no glyph for that row".
//
// The fixture is built for the RULES rather than for a picture: the plain
// zero-scale case, all three exemptions (Point, wire, textured), a single zeroed
// axis and a merely tiny scale (both KEPT), a Mesh id nothing supplies, a Rod
// whose factors multiply a zero, the Surface and Plot vertex cases the cull
// exists for, a zero-scale ancestor culling scale-1 descendants two levels down,
// a Point and a textured node under that same dead ancestor (exemptions beat
// collapse), a zero-scale World Grid in both its solid and wire forms, a
// scale-1 CHILD of that grid (kept — a grid's scale never reaches its children's
// frames), a hidden row, and the Flat Ring pair, which is the newest id on both
// sides.
//
// Regenerate both JSONs with tools/dump_zero_scale_cull.py when the fixture or
// the desktop rule changes.

import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { NodeType } from '../gv/types'
import type { GvNode } from '../gv/types'
import { DEFAULT_SCALE_FLOOR, setEnforceScaleFloor } from './baseScale'
import { buildScene } from './buildScene'
import zeroScaleCsv from '../gv/fixtures/zero_scale_gv_node.csv?raw'
import cullReferenceRaw from '../gv/fixtures/zero_scale_cull.json?raw'
import cullFloorReferenceRaw from '../gv/fixtures/zero_scale_cull_floor.json?raw'

interface CullEntry {
  id: number
  geometry: number
  texture_id: number
  radius: number
  draws_nothing: boolean
}

interface CullReference {
  source_csv: string
  base_scale: number
  scale_floor: number
  wire_ids: number[]
  point_id: number
  nodes: CullEntry[]
}

const reference = JSON.parse(cullReferenceRaw) as CullReference
const floorReference = JSON.parse(cullFloorReferenceRaw) as CullReference
const parsed = parseGvNodeCsv(zeroScaleCsv)

const rowOf = (id: number): GvNode => parsed.nodes.find((n) => n.id === id)!

/**
 * Rows the desktop's draw loop reaches at all, so its verdict is what decides
 * whether a glyph exists. Everything else — World/Camera rows, links — it skips
 * before the check, and so does buildScene.
 */
function reachesTheCheck(node: GvNode, showHidden: boolean): boolean {
  if (node.type === NodeType.World || node.type === NodeType.Camera) return false
  if (node.type === NodeType.Link) return false
  return node.hide === 0 || showHidden
}

function glyphOf(root: THREE.Object3D, id: number): THREE.Object3D | undefined {
  const frame = root.getObjectByName(`gv:${id}`)
  expect(frame, `frame for node ${id}`).toBeDefined()
  return frame!.children.find((c) => c.userData.isGlyph)
}

/** Ids this app builds no glyph for, among the rows that reach the check. */
function webCulledIds(showHidden = false): number[] {
  const built = buildScene(parsed.nodes, { showHidden })
  return parsed.nodes
    .filter((n) => reachesTheCheck(n, showHidden) && glyphOf(built.root, n.id) === undefined)
    .map((n) => n.id)
}

/** The same, off the desktop dump. */
function desktopCulledIds(ref: CullReference, showHidden = false): number[] {
  return ref.nodes
    .filter((e) => e.draws_nothing && reachesTheCheck(rowOf(e.id), showHidden))
    .map((e) => e.id)
}

afterEach(() => setEnforceScaleFloor(false))

describe('zero-scale cull parity', () => {
  it('the fixture and the dump are the same file, at the shipped defaults', () => {
    expect(reference.source_csv).toBe('zero_scale_gv_node.csv')
    expect(parsed.warnings).toEqual([])
    expect(reference.nodes.map((n) => n.id)).toEqual(parsed.nodes.map((n) => n.id))
    // The state both apps boot in (web 6v, desktop 6d82d68).
    expect(reference.base_scale).toBe(1)
    expect(reference.scale_floor).toBe(0)
  })

  it('every row keeps its frame, culled or not', () => {
    // The whole reason the cull can be applied at build time: the Surface mesh,
    // the Plot polyline, link endpoints, labels and children all resolve
    // through `frames`, never through a glyph.
    const built = buildScene(parsed.nodes)
    for (const node of parsed.nodes) {
      expect(built.frames.has(node.id), `frame for node ${node.id}`).toBe(true)
    }
  })

  it('draws a glyph exactly where the desktop would', () => {
    const built = buildScene(parsed.nodes)
    for (const entry of reference.nodes) {
      if (!reachesTheCheck(rowOf(entry.id), false)) continue
      expect(
        glyphOf(built.root, entry.id) !== undefined,
        `node ${entry.id} (geometry ${entry.geometry}, radius ${entry.radius})`,
      ).toBe(!entry.draws_nothing)
    }
  })

  it('leaves the culled rows unpickable, and their frames otherwise bare', () => {
    // A pick proxy is a child of the GLYPH, so no glyph is already no proxy —
    // this says it out loud, because it is the half of the saving that the
    // desktop's pick loop gets from the same test (viewport.py line 3499) and
    // the reason a culled node stops answering clicks on both sides.
    const built = buildScene(parsed.nodes)
    for (const id of desktopCulledIds(reference)) {
      const frame = built.frames.get(id)!
      const own = frame.children.filter((c) => c.userData.nodeId === undefined)
      expect(own, `non-frame children of culled node ${id}`).toEqual([])
    }
  })

  it('counts the culled rows', () => {
    const built = buildScene(parsed.nodes)
    expect(built.culledCount).toBe(desktopCulledIds(reference).length)
    // Not a vacuous run: half the fixture exists to be culled.
    expect(built.culledCount).toBeGreaterThan(10)
  })

  it('agrees under Show Hidden Nodes, where the hidden zero-scale row joins in', () => {
    const hidden = parsed.nodes.find((n) => n.hide === 1)!
    expect(reference.nodes.find((e) => e.id === hidden.id)!.draws_nothing).toBe(true)
    expect(webCulledIds(true)).toEqual(desktopCulledIds(reference, true))
    expect(webCulledIds(true)).toContain(hidden.id)
  })

  it('pins the three exemptions against the desktop id sets they come from', () => {
    // A wire or Point id this app classified differently would already show up
    // as a verdict mismatch above; this says WHICH ids the desktop means, so a
    // failure names the cause rather than the symptom.
    expect(reference.point_id).toBe(22)
    expect(reference.wire_ids).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 17, 18, 20, 34])
    const exempt = reference.nodes.filter((e) => e.radius === 0 && !e.draws_nothing)
    for (const e of exempt) {
      const isPoint = e.geometry === reference.point_id
      const isWire = reference.wire_ids.includes(e.geometry)
      expect(isPoint || isWire || e.texture_id > 0, `node ${e.id} is exempt for a reason`).toBe(true)
    }
    // Point, wire, textured — each of them twice over, once under a live
    // ancestor and once under a dead one.
    expect(exempt.length).toBeGreaterThanOrEqual(6)
  })

  // The one place the two apps disagree, measured rather than described.
  //
  // With the minimum-size clamp ON the desktop lifts an own-scale-0 node to the
  // floor (S_child = max(own * base_scale, floor)) and therefore stops culling
  // it. This app cannot: a frame carries the node's RAW scale, because that is
  // what places its children, and the glyph under it carries a RATIO
  // (drawScaleCorrection) — and no finite ratio lifts zero. So a zero-scale
  // glyph renders flat here whatever the clamp says, which drawScaleCorrection
  // has documented since 6v and which the cull only inherits: those rows drew
  // nothing before it and draw nothing after it.
  //
  // So the PICTURE is identical with the cull on and off in both clamp states,
  // which is the property the desktop commit claims for its own version.
  it('diverges under the minimum-size clamp, and only in the documented way', () => {
    setEnforceScaleFloor(true)
    // The web's verdict does not move when the clamp is switched on...
    expect(webCulledIds()).toEqual(desktopCulledIds(reference))

    // ...while the desktop's does, for exactly the rows whose OWN scale is zero
    // and whose ancestors are alive — the ones its clamp can lift.
    expect(floorReference.scale_floor).toBe(DEFAULT_SCALE_FLOOR)
    const clamped = new Set(desktopCulledIds(floorReference))
    const divergence = webCulledIds().filter((id) => !clamped.has(id))
    expect(divergence).toEqual([2, 9, 10, 16, 17, 18, 19, 21, 22, 23, 28, 31])
    // Nothing goes the other way: this app never drops a glyph the desktop keeps
    // for a reason other than that clamp, and never keeps one it drops.
    expect([...clamped].filter((id) => !webCulledIds().includes(id))).toEqual([])
  })
})
