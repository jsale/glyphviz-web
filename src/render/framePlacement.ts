// Where a node sits in its parent's frame — the one statement of that rule.
//
// Lifted out of buildScene.ts when the point-cloud overlay needed it: a cloud's
// points get no Object3D of their own (render/pointCloudOverlay.ts), so they
// have to be positioned from data, and they must land exactly where the builder
// would have put their frames — grid parents, topo_scale and the live Global
// Scale included. Restating the rule in the overlay would have been a second
// opinion about placement, which is the thing selectionPlacement.ts exists to
// avoid; importing it back out of buildScene would have been an ESM cycle,
// which this app has already been broken by once (roadmap 6s).
//
// So it lives here, and both import it. The same call gv/placementAxes.ts made
// when the Glyph Composer became a second reader of LINEAR_PLACEMENT_AXES.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'
import { NodeType, Topo } from '../gv/types'
import { GRID_GLOBE_RADIUS, gridCenter, gridIsGlobe } from '../gv/worldGrid'
import { baseScale } from './baseScale'
import { parentTopoScale, topoOffset } from './topology'

/**
 * The node's local-frame position. Children of a World Grid place by
 * geography, regardless of the grid row's own topo field: flat → Cartesian
 * recentered on the extents window's midpoint; globe → KML lon/lat/elevation
 * on the 180/π sphere. The grid's per-axis scale re-spaces these offsets
 * here (its frame carries no scale — see applyFrameTransform).
 */
export function framePosition(node: GvNode, parentGv: GvNode | null): THREE.Vector3 {
  if (parentGv && parentGv.type === NodeType.WorldGrid) {
    let offset: THREE.Vector3
    if (gridIsGlobe(parentGv)) {
      offset = topoOffset({
        parentTopo: Topo.Sphere,
        tx: node.translate.x,
        ty: node.translate.y,
        tz: node.translate.z,
        parentRatio: 0,
        subspace: node.subspace,
        baseScale: GRID_GLOBE_RADIUS,
      })
    } else {
      const c = gridCenter(parentGv)
      offset = new THREE.Vector3(
        node.translate.x - c.lon,
        node.translate.y - c.lat,
        node.translate.z,
      )
    }
    return offset.multiply(
      new THREE.Vector3(parentGv.scale.x, parentGv.scale.y, parentGv.scale.z),
    )
  }
  return topoOffset({
    parentTopo: parentGv ? parentGv.topo : -1,
    tx: node.translate.x,
    ty: node.translate.y,
    tz: node.translate.z,
    parentRatio: parentGv?.ratio ?? 0,
    subspace: node.subspace,
    // The live Global Scale: a topology's base radius is the size of the glyph
    // its children sit on, so raising it moves them outward with it.
    baseScale: baseScale(),
    // How far one unit of this child's translate reaches on the axes the
    // parent's topology reads as distances. A root has no parent to ask, so
    // parentTopoScale answers 1.0 — its translate IS its world position.
    parentTopoScale: parentTopoScale(parentGv),
  })
}
