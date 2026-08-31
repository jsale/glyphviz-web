// Where the pen actually goes — the one input the Epitrochoid Generator's node
// builder (src/gv/epicycles.ts) cannot derive from the design alone.
//
// This is the web's answer to the desktop's `epicycles.trace_path`, which builds
// a live `Scene` out of the chain and reads `world_pos` rather than
// reimplementing the topology math. The same rule holds here and for the same
// reason: the trail's whole claim is that its beads sit ON the curve the chain
// draws, so the placement it samples has to be the one this app composes —
// `applyFrameTransform`, the scene builder's own — and not a restatement that
// could drift from it. It is the split `selectionExport.ts` /
// `selectionPlacement.ts` already makes, one level up.
//
// An epicycle chain is strictly LINEAR — hub → arm 1 → … → pen — so this walks
// it with reused objects instead of going through `worldPlacements`, which
// rebuilds a child index and a Map of every node on every call and would do that
// once per frame for up to 3600 frames. `epicyclePath.test.ts` pins the two
// against each other, so the shortcut cannot quietly become a third opinion.
//
// ON GLOBAL SCALE. A Torus topology's base radius is the live Global Scale
// (`baseScale()` in framePosition), so the whole chain — every offset in it is
// proportional to that radius — is drawn B times larger at Global Scale B, while
// the trail's beads are root-level Cartesian rows whose translate IS their world
// position and do not move at all. Tracing therefore uses whatever the app is
// currently drawing at, so the preview, an Insert into Scene and a Save all
// agree with what is on screen. The consequence, which the desktop shares (its
// `trace_path` hardcodes 1.0 while its preview renders at the app's own scale):
// a scene saved at a Global Scale other than 1 is only true at that scale. The
// window says so rather than leaving it to be discovered.

import * as THREE from 'three'
import { chainNodes } from '../gv/epicycles'
import type { EpicycleDesign } from '../gv/epicycles'
import { normalizedDesign } from '../gv/epicycles'
import type { GvNode, Vec3 } from '../gv/types'
import { NodeType } from '../gv/types'
import { applyFrameTransform } from './buildScene'

/**
 * The pen's world position at each of `frames` frames, with every arm's angle
 * advanced by its own rate — `translate_x = phase_x + rate_x · f`, which is what
 * both `translate_rate` integration and the Channels tracks produce.
 */
export function traceEpicyclePath(input: EpicycleDesign, frames: number): Vec3[] {
  const design = normalizedDesign(input)
  const all = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
  // Links carry no placement of their own (they draw between two endpoints), so
  // the chain to walk is the glyph rows alone: hub, then one per arm.
  const chain = all.filter((n) => n.type === NodeType.Glyph)

  const frame = new THREE.Object3D()
  const world = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const points: Vec3[] = []

  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < design.arms.length; k++) {
      const arm = design.arms[k]
      const node = chain[k + 1]
      node.translate.x = arm.phaseX + arm.rateX * f
      node.translate.y = arm.phaseY + arm.rateY * f
    }
    world.identity()
    let parent: GvNode | null = null
    for (const node of chain) {
      applyFrameTransform(frame, node, parent)
      frame.updateMatrix()
      world.multiply(frame.matrix)
      parent = node
    }
    position.setFromMatrixPosition(world)
    points.push({ x: position.x, y: position.y, z: position.z })
  }
  return points
}
