// Write part of a scene out as a standalone node CSV (Save Selection As…).
//
// Ported (behaviour, not code) from the desktop's
// glyphviz_core/selection_export.py, whose module docstring is the argument
// this one restates.
//
// A selection is not a scene. Handing writeGvNodeCsv a bare list of selected
// rows produces a file that loads without complaint and is quietly wrong,
// because a node whose parent_id names a row the file does not contain is
// treated as a ROOT (buildScene's effectiveParent, the desktop's
// _resolve_hierarchy) — and a root's translate_x/y/z IS its world position,
// with no topology offset at all. So a child of a Sphere parent authored at
// (30, 45, 5) meaning "longitude 30, latitude 45, 5 units out" reloads as
// literal world (30, 45, 5); a World Grid child's lon/lat becomes raw world
// units and lands off the map. Saving a selection naively relocates and
// reorients everything in it.
//
// buildSelection() is the fix. It decides membership, repairs every
// cross-reference that would otherwise dangle, and detaches the nodes whose
// parents did not come along, under one of three policies:
//
//     Detach.Bake       fold the missing ancestor chain into the node itself
//     Detach.Ancestors  bring the ancestor rows along instead
//     Detach.Raw        leave the fields exactly as authored
//
// The bake is exact, and the reason is worth stating because the whole feature
// rests on it. Every node's world transform is
//
//     world_basis = parent_basis · child_local · diag(scale)
//     world_pos   = parent_pos + parent_basis · topoOffset(child)
//
// (compute_world_transforms there, an Object3D frame chain here — the two are
// diffed node for node by src/render/parity.test.ts). Every descendant composes
// off its parent's world_basis, both for its own basis and, through the offset,
// for its position, and the node's own draw matrix is that same product times
// base_scale. So a detached node that keeps its world_basis and its world
// position keeps its ENTIRE SUBTREE pinned in place, pixel for pixel.
// Re-expressing that basis as a root's own rotation + scale is decomposeBasis()
// below: a root has no topology base rotation, so world_basis = own_rotation ·
// diag(scale), and Euler XYZ can express any rotation.
//
// Two limits, both reported rather than hidden:
//
// * A non-uniform ancestor scale combined with rotation produces SHEAR — the
//   columns of world_basis stop being mutually perpendicular, and no
//   rotate + scale pair can express that. decomposeBasis returns the closest
//   non-sheared match and a shear magnitude; buildSelection counts the nodes it
//   had to approximate.
// * translate_rate/rotate_rate on a detached node changes meaning: rates on a
//   Sphere child orbit it in longitude/latitude, while the same numbers on a
//   root drift it through world XYZ. Counted as animatedDetached.
//
// And one limit that is neither, because it cannot be reported per node: a
// WORLD GRID detached from a SCALED ancestor. A grid's own scale re-spaces its
// children without stretching them (the ANTz Grid rule), and a root grid's
// frame carries scale (1, 1, 1) by construction — so the ancestor's scale, with
// nowhere else to go, lands in the grid's own scale field. Its plate and its
// direct children's positions come out identical; their SHAPES, and everything
// below them, divide by that factor. The desktop does exactly the same thing,
// value for value (selectionExport.parity.test.ts), and "Save its parent nodes
// too" is the way out.
//
// A third property is worth knowing rather than reporting: the bake is exact at
// the Global Scale (src/render/baseScale.ts) in force when it runs. A topology
// offset is proportional to base_scale while a root's translate is a literal
// world position, so a detached fragment reopened at a different Global Scale
// sits where it was rather than where its old parent would now put it. That is
// inherent to the file format, not to this module.
//
// Ids are preserved as-is (unlike a scene merge, which rebases them onto a
// fresh block): extras['record_id'] — the tag file's join key — and any channel
// binding stay coherent for free, and the fragment stays diffable against the
// scene it came from.
//
// Split, as this app splits basemap.ts from basemapFetch.ts and drawMode.ts
// from drawPlane.ts: everything here is pure data and linear algebra, testable
// in plain node with hand-written matrices. The one thing it cannot know —
// where the renderer actually put each node — is INJECTED as a
// `Map<id, WorldPlacement>`, which src/render/selectionPlacement.ts derives from
// the app's own frame rules. That is the desktop's `scene` argument, read the
// other way round.

import { cloneNode } from './clipboard'
import { linkChildId } from './links'
import { recomputeBranchLevels } from './sceneMerge'
import { NON_VISUAL_TYPES } from './selectionOps'
import type { GvNode } from './types'
import { NodeType, RotationMode } from './types'
import { worldNodeOf } from './worldNode'

/** How a node whose parent stays behind is handled (ExportOptions.detach). */
export const Detach = {
  Bake: 'bake',
  Ancestors: 'ancestors',
  Raw: 'raw',
} as const
export type DetachPolicy = (typeof Detach)[keyof typeof Detach]

/**
 * How far world_basis' normalized columns may stray from mutually perpendicular
 * before the bake counts as approximate. Well above float noise in a deep
 * composition (measured ~1e-15 on a 4-level chain) and well below anything
 * visible: 1e-6 is a millionth of a unit axis.
 */
export const SHEAR_TOLERANCE = 1e-6

/**
 * Column norm below which an axis counts as collapsed. Such an axis is NOT an
 * approximation — scale 0 annihilates whatever rotation column pairs with it,
 * so R · diag(s) still reproduces the basis exactly.
 */
const DEGENERATE = 1e-12

/** A 3×3 matrix, row-major — the shape the parity dumps carry. */
export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

/** Where the renderer actually put a node: its world position and world basis. */
export interface WorldPlacement {
  pos: readonly [number, number, number]
  basis: Mat3
}

/** What the Save Selection window collects. */
export interface ExportOptions {
  /**
   * Selected nodes bring their full descendant subtree (the rule deleteSubtree
   * and copySubtree already enforce). Free for a leaf selection — a leaf's
   * closure is itself.
   */
  includeDescendants: boolean
  /** How to handle a node whose parent is not in the export (see the header). */
  detach: DetachPolicy
  /**
   * Carry the type-0 World row: background colour, fog, render mode, tag and
   * reference-grid styling. It is never selectable in bulk (isBulkSelectable),
   * so without this the fragment reopens on the wrong background.
   */
  includeWorldRow: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeDescendants: true,
  detach: Detach.Bake,
  includeWorldRow: true,
}

/**
 * Which rows an export will contain, resolved without copying or modifying
 * anything.
 *
 * Split out from the export itself so the window can preview the outcome on
 * every checkbox toggle: the membership rules are a few set walks over the node
 * list, while materialising deep-copies every node.
 */
export interface SelectionPlan {
  /**
   * Ids to write, in scene order, links already vetted. Excludes the World row,
   * which is prepended separately (worldId).
   */
  ids: number[]
  /** Ids that will be re-rooted because their parent is not in the export. */
  detachedIds: number[]
  descendantsAdded: number
  ancestorsAdded: number
  /** Links pulled in because both ends are present. */
  linksAdded: number
  /** Links whose other end is outside the export. */
  droppedLinks: number
  worldId: number | null
  /** Total rows the file will hold, World row included. */
  count: number
  worldRow: boolean
}

/** What buildSelection() produced, for the caller's status reporting. */
export interface SelectionExport {
  nodes: GvNode[]
  plan: SelectionPlan
  /** Detached nodes whose bake could not be exact (sheared ancestor scale). */
  approximatedIds: number[]
  /**
   * …and those carrying translate/rotate rates, whose animation now runs in
   * world space instead of their old parent's coordinate system.
   */
  animatedDetached: number[]
}

function emptyPlan(): SelectionPlan {
  return {
    ids: [],
    detachedIds: [],
    descendantsAdded: 0,
    ancestorsAdded: 0,
    linksAdded: 0,
    droppedLinks: 0,
    worldId: null,
    count: 0,
    worldRow: false,
  }
}

// --- the decomposition the bake rests on ------------------------------------

function col(A: Mat3, j: number): [number, number, number] {
  return [A[0][j], A[1][j], A[2][j]]
}

function det3(A: Mat3): number {
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  )
}

function fromColumns(
  c0: readonly number[],
  c1: readonly number[],
  c2: readonly number[],
): Mat3 {
  return [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ]
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function norm(v: readonly number[]): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalized(v: readonly number[]): [number, number, number] {
  const n = norm(v)
  return n === 0 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n]
}

function transpose(A: Mat3): Mat3 {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ]
}

function inverse3(A: Mat3): Mat3 | null {
  const d = det3(A)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-18) return null
  const c = (r: number, s: number): number => {
    const [r0, r1] = [0, 1, 2].filter((i) => i !== r)
    const [s0, s1] = [0, 1, 2].filter((i) => i !== s)
    const minor = A[r0][s0] * A[r1][s1] - A[r0][s1] * A[r1][s0]
    return ((r + s) % 2 === 0 ? minor : -minor) / d
  }
  // adjugate / det, i.e. transpose of the cofactor matrix.
  return [
    [c(0, 0), c(1, 0), c(2, 0)],
    [c(0, 1), c(1, 1), c(2, 1)],
    [c(0, 2), c(1, 2), c(2, 2)],
  ]
}

/**
 * Closest rotation matrix to Q (orthogonal Procrustes, det +1) — the desktop's
 * `_nearest_rotation`, reached by Higham's polar iteration rather than by an
 * SVD, since JavaScript ships neither.
 *
 * `R ← (R + R⁻ᵀ)/2` converges quadratically to the orthogonal polar factor,
 * which for a det-positive matrix IS the SVD's `U @ Vᵀ` — the same least-squares
 * best fit — and returns an already-orthonormal Q unchanged on the first
 * comparison, which is the case every unsheared export takes. A singular Q
 * (something the caller's column completion should already have ruled out)
 * falls back to Gram-Schmidt rather than dividing by zero.
 */
function nearestRotation(Q: Mat3): Mat3 {
  let R = Q
  for (let i = 0; i < 64; i++) {
    const inv = inverse3(R)
    if (inv === null) return gramSchmidt(Q)
    const invT = transpose(inv)
    const next: Mat3 = [
      [(R[0][0] + invT[0][0]) / 2, (R[0][1] + invT[0][1]) / 2, (R[0][2] + invT[0][2]) / 2],
      [(R[1][0] + invT[1][0]) / 2, (R[1][1] + invT[1][1]) / 2, (R[1][2] + invT[1][2]) / 2],
      [(R[2][0] + invT[2][0]) / 2, (R[2][1] + invT[2][1]) / 2, (R[2][2] + invT[2][2]) / 2],
    ]
    let delta = 0
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(next[r][c] - R[r][c]))
    }
    R = next
    if (delta <= 1e-15) break
  }
  return R
}

/** Last-resort orthonormalisation for a singular Q. */
function gramSchmidt(Q: Mat3): Mat3 {
  let c0 = normalized(col(Q, 0))
  if (norm(c0) === 0) c0 = [1, 0, 0]
  let c1 = col(Q, 1)
  const d = c1[0] * c0[0] + c1[1] * c0[1] + c1[2] * c0[2]
  c1 = [c1[0] - d * c0[0], c1[1] - d * c0[1], c1[2] - d * c0[2]]
  if (norm(c1) < DEGENERATE) {
    // Any vector perpendicular to c0 will do; pick the least-aligned axis.
    const axis = Math.abs(c0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    c1 = cross(axis, c0)
  }
  const n1 = normalized(c1)
  return fromColumns(c0, n1, cross(c0, n1))
}

/**
 * Split a raw world basis into (rotation, per-axis scale, shear).
 *
 * `shear` is the largest deviation of the normalized columns' Gram matrix from
 * the identity, i.e. 0 when the columns are mutually perpendicular.
 * `rotation · diag(scale)` reproduces A exactly whenever shear is 0.
 *
 * A reflection (an odd number of negative scale fields upstream) is folded into
 * a negative Z scale rather than into the rotation, keeping it a true rotation
 * and the product exact.
 */
export function decomposeBasis(A: Mat3): {
  rotation: Mat3
  scale: [number, number, number]
  shear: number
} {
  const columns = [col(A, 0), col(A, 1), col(A, 2)]
  const norms = columns.map(norm) as [number, number, number]
  const live = norms.map((n) => n > DEGENERATE) as [boolean, boolean, boolean]
  const scale: [number, number, number] = [
    live[0] ? norms[0] : 0,
    live[1] ? norms[1] : 0,
    live[2] ? norms[2] : 0,
  ]
  const unit = columns.map((c, j) => (live[j] ? normalized(c) : [0, 0, 0]))

  // Handedness: flipping a column of Q and the matching entry of s leaves
  // Q · diag(s) untouched, so this costs nothing in fidelity.
  if (live.every(Boolean) && det3(fromColumns(unit[0], unit[1], unit[2])) < 0) {
    unit[2] = [-unit[2][0], -unit[2][1], -unit[2][2]]
    scale[2] = -scale[2]
  }

  const liveCount = live.filter(Boolean).length
  let shear = 0
  if (liveCount > 1) {
    // |Gram − I| over the live columns only: one axis or fewer cannot be
    // non-perpendicular to anything.
    for (let i = 0; i < 3; i++) {
      if (!live[i]) continue
      for (let j = 0; j < 3; j++) {
        if (!live[j]) continue
        const g = unit[i][0] * unit[j][0] + unit[i][1] * unit[j][1] + unit[i][2] * unit[j][2]
        shear = Math.max(shear, Math.abs(g - (i === j ? 1 : 0)))
      }
    }
  }

  // A collapsed axis has no direction of its own. The desktop hands numpy's SVD
  // a zero column and takes whatever direction it invents; here the frame is
  // completed to a right-handed orthonormal one, which is the same bargain —
  // the axis is multiplied by a zero scale either way — and keeps the polar
  // iteration below out of a singular matrix.
  const Q = liveCount === 3 ? fromColumns(unit[0], unit[1], unit[2]) : completeFrame(unit, live)
  return { rotation: nearestRotation(Q), scale, shear }
}

/** Fill in the dead columns of a partly-collapsed frame, right-handed. */
function completeFrame(unit: number[][], live: boolean[]): Mat3 {
  const out = unit.map((c) => [...c])
  const liveIdx = [0, 1, 2].filter((i) => live[i])
  if (liveIdx.length === 0) return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  if (liveIdx.length === 1) {
    const a = out[liveIdx[0]]
    const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const b = normalized(cross(axis, a))
    const dead = [0, 1, 2].filter((i) => !live[i])
    out[dead[0]] = b
    out[dead[1]] = cross(a, b)
  } else {
    const [i, j] = liveIdx
    const dead = [0, 1, 2].find((k) => !live[k])!
    // The right-handed completion of columns (i, j) in index order, so the
    // filled axis points the way a full frame's would.
    const c = normalized(cross(out[i], out[j]))
    // cross(0,1)=+2, cross(1,2)=+0, cross(0,2)=−1 — the sign that keeps det +1.
    const positive = (j - i + 3) % 3 === 1
    out[dead] = positive ? c : [-c[0], -c[1], -c[2]]
  }
  const M = fromColumns(out[0], out[1], out[2])
  if (det3(M) < 0) {
    const dead = [0, 1, 2].filter((i) => !live[i])[0]
    out[dead] = [-out[dead][0], -out[dead][1], -out[dead][2]]
    return fromColumns(out[0], out[1], out[2])
  }
  return M
}

/**
 * (rotate_x, rotate_y, rotate_z) in degrees reproducing R under
 * RotationMode.EulerXYZ — the exact inverse of localRotationMatrix's Euler
 * branch, whose product is
 *
 *     Rx(rx) · Ry(ry) · Rz(rz)
 *   = [[ cy·cz,            −cy·sz,             sy    ],
 *      [ cx·sz + sx·sy·cz,  cx·cz − sx·sy·sz, −sx·cy ],
 *      [ sx·sz − cx·sy·cz,  sx·cz + cx·sy·sz,  cx·cy ]]
 *
 * At gimbal lock (ry = ±90°, where the X and Z rotations act on the same axis)
 * the split between rx and rz is arbitrary; rz is set to 0 and the whole
 * rotation goes to rx, which is the conventional choice and still reproduces R
 * exactly.
 */
export function eulerXyzFromMatrix(R: Mat3): [number, number, number] {
  const DEG = 180 / Math.PI
  const sy = Math.min(1, Math.max(-1, R[0][2]))
  const ry = Math.asin(sy)
  let rx: number
  let rz: number
  if (Math.abs(sy) < 1 - 1e-9) {
    rx = Math.atan2(-R[1][2], R[2][2])
    rz = Math.atan2(-R[0][1], R[0][0])
  } else {
    rx = Math.atan2(R[2][1], R[1][1])
    rz = 0
  }
  return [rx * DEG, ry * DEG, rz * DEG]
}

/**
 * Rewrite `node`'s transform fields so that, as a ROOT, it keeps the world
 * placement it had as a child. Returns the shear magnitude (0 when the rewrite
 * is exact).
 *
 * The node's own topo/ratio/topoScale/subspace are deliberately untouched:
 * those describe the coordinate system it offers its CHILDREN, which this must
 * not disturb. Only the fields describing where the node itself sits are
 * restated, plus rotationMode — Euler XYZ is the mode that can express an
 * arbitrary rotation matrix.
 */
export function bakeWorldPlacement(node: GvNode, placement: WorldPlacement | undefined): number {
  // Not part of this scene's transform state (past the draw limit, or inside a
  // truncated parent cycle); leave the fields as authored.
  if (!placement) return 0
  const { rotation, scale, shear } = decomposeBasis(placement.basis)
  const [rx, ry, rz] = eulerXyzFromMatrix(rotation)
  node.translate = { x: placement.pos[0], y: placement.pos[1], z: placement.pos[2] }
  node.rotate = { x: rx, y: ry, z: rz }
  node.scale = { x: scale[0], y: scale[1], z: scale[2] }
  node.rotationMode = RotationMode.EulerXYZ
  return shear
}

// --- membership --------------------------------------------------------------

/**
 * True when the node carries per-cycle translate/rotate rates, whose frame of
 * reference a detach changes (see the header).
 */
function hasMotion(node: GvNode): boolean {
  const t = node.translateRate
  const r = node.rotateRate
  return t.x !== 0 || t.y !== 0 || t.z !== 0 || r.x !== 0 || r.y !== 0 || r.z !== 0
}

// recomputeBranchLevels is the desktop's scene_merge.recompute_branch_levels,
// which Save Selection needs verbatim. It lives with the merge it belongs to
// (sceneMerge.ts), as it does on the desktop, and is re-exported here so this
// module's callers keep their import.
export { recomputeBranchLevels }

/**
 * Work out which rows a Save Selection write would contain.
 *
 * Reads the scene without copying or modifying it, so the window can call this
 * on every option change. buildSelection() below runs exactly this and then
 * materialises the result.
 *
 * Membership:
 *   - the selected ids, minus World/Camera rows (they are scene-wide settings,
 *     not members; the World row comes back below on its own terms),
 *   - plus every descendant, when includeDescendants is set,
 *   - plus, under Detach.Ancestors, the ancestor chain of everything above,
 *   - plus any link (type 7) whose A-end and B-end are BOTH present, even when
 *     the link node itself was not selected — otherwise saving two connected
 *     nodes silently loses the edge between them,
 *   - plus the World row, when includeWorldRow is set.
 *
 * A link with only one end present is dropped rather than left dangling (the
 * same rule Copy/Paste already uses).
 */
export function planSelection(
  nodes: readonly GvNode[],
  selectedIds: Iterable<number>,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): SelectionPlan {
  const result = emptyPlan()

  const byId = new Map<number, GvNode>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)

  const ids = new Set<number>()
  for (const i of selectedIds) {
    const node = byId.get(i)
    if (node && !NON_VISUAL_TYPES.has(node.type)) ids.add(i)
  }
  if (ids.size === 0) return result

  if (options.includeDescendants) {
    const childrenOf = new Map<number, number[]>()
    for (const n of nodes) {
      const list = childrenOf.get(n.parentId)
      if (list) list.push(n.id)
      else childrenOf.set(n.parentId, [n.id])
    }
    const before = ids.size
    let frontier = [...ids]
    while (frontier.length > 0) {
      const next: number[] = []
      for (const p of frontier) {
        for (const c of childrenOf.get(p) ?? []) {
          if (!ids.has(c)) {
            ids.add(c)
            next.push(c)
          }
        }
      }
      frontier = next
    }
    result.descendantsAdded = ids.size - before
  }

  if (options.detach === Detach.Ancestors) {
    const before = ids.size
    for (const start of [...ids]) {
      let p = byId.get(start)!.parentId
      // Bounded by the node count: a parent cycle cannot outrun it.
      for (let step = 0; step < byId.size; step++) {
        const parent = byId.get(p)
        if (!parent || ids.has(p) || NON_VISUAL_TYPES.has(parent.type)) break
        ids.add(p)
        p = parent.parentId
      }
    }
    result.ancestorsAdded = ids.size - before
  }

  // Links joining two members, whether or not the link row was selected.
  const extraLinks: number[] = []
  for (const n of nodes) {
    if (n.type !== NodeType.Link) continue
    if (ids.has(n.id)) continue
    if (ids.has(n.parentId) && ids.has(linkChildId(n))) extraLinks.push(n.id)
  }
  for (const id of extraLinks) ids.add(id)
  result.linksAdded = extraLinks.length

  // Scene order is kept: it puts parents before children in every file the app
  // writes, and keeps the export diffable against its source.
  const kept: number[] = []
  const seen = new Set<number>()
  for (const n of nodes) {
    if (!ids.has(n.id) || seen.has(n.id)) continue
    if (n.type === NodeType.Link && !ids.has(linkChildId(n))) {
      result.droppedLinks++
      continue
    }
    seen.add(n.id)
    kept.push(n.id)
  }

  const keptIds = new Set(kept)
  result.ids = kept
  result.detachedIds = kept.filter((i) => {
    const n = byId.get(i)!
    return n.parentId !== 0 && !keptIds.has(n.parentId)
  })

  const world = options.includeWorldRow ? worldNodeOf(nodes) : null
  if (world && !keptIds.has(world.id)) result.worldId = world.id

  result.worldRow = result.worldId !== null
  result.count = result.ids.length + (result.worldRow ? 1 : 0)
  return result
}

/**
 * Materialise a Save Selection write: planSelection() plus the repairs that need
 * actual nodes to work on.
 *
 * Returns fresh deep copies — the scene is never mutated, so the same selection
 * can be exported repeatedly under different options. Every node whose parent
 * did not make it is re-rooted and detached per the chosen policy, and
 * branchLevel is restated from the resulting hierarchy.
 *
 * `placements` is where the renderer put each node
 * (src/render/selectionPlacement.ts). Only Detach.Bake reads it.
 */
export function buildSelection(
  nodes: readonly GvNode[],
  selectedIds: Iterable<number>,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  placements: ReadonlyMap<number, WorldPlacement> = new Map(),
): SelectionExport {
  const plan = planSelection(nodes, selectedIds, options)
  const result: SelectionExport = { nodes: [], plan, approximatedIds: [], animatedDetached: [] }
  if (plan.ids.length === 0) return result

  const byId = new Map<number, GvNode>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)
  const out = plan.ids.map((i) => cloneNode(byId.get(i)!))

  const detached = new Set(plan.detachedIds)
  for (const node of out) {
    if (!detached.has(node.id)) continue
    if (options.detach !== Detach.Raw) {
      // Applies under Detach.Ancestors too: a top node still missing its parent
      // there means the chain was broken by something the walk refused to
      // include, and baking is the faithful answer.
      if (bakeWorldPlacement(node, placements.get(node.id)) > SHEAR_TOLERANCE) {
        result.approximatedIds.push(node.id)
      }
    }
    if (hasMotion(node)) result.animatedDetached.push(node.id)
    node.parentId = 0
  }

  // World row leads the file, as in a saved scene.
  if (plan.worldId !== null) out.unshift(cloneNode(byId.get(plan.worldId)!))

  recomputeBranchLevels(out, new Set(out.map((n) => n.id)))
  result.nodes = out
  return result
}

/** The desktop saver's stamp: YYYYMMDDHHMMSS, no delimiters (tagCsv.ts's own). */
const TIMESTAMP_RE = /\d{14}$/

/**
 * The filenames a Save Selection write produces, derived from the open scene's
 * node CSV name — the desktop's `_selection_default_name` plus the companion
 * naming its `_write_selection_channels` and `companion_tag_path` use.
 *
 *   Cyclone_gv_node.csv           → Cyclone_gv_selection_node.csv
 *                                   Cyclone_gv_selection_tag.csv
 *                                   Cyclone_gv_selection_ch-map.csv / _ch-tracks.csv
 *
 * A trailing save stamp is dropped first, so a name derived from an
 * already-saved file does not carry the old stamp into the middle of the new
 * one. A stem not ending in `node` gets `_selection_node` appended instead, so
 * the result still pairs with a tag file — the desktop's own fallback.
 */
export function selectionExportNames(nodeFilename: string): {
  node: string
  tag: string
  chMap: string
  chTracks: string
} {
  const dot = nodeFilename.lastIndexOf('.')
  const rawStem = dot === -1 ? nodeFilename : nodeFilename.slice(0, dot)
  const ext = dot === -1 ? '.csv' : nodeFilename.slice(dot)
  const stem = rawStem.replace(TIMESTAMP_RE, '')
  const base = stem.endsWith('node') ? stem.slice(0, -4) : `${stem}_`
  return {
    node: `${base}selection_node${ext}`,
    tag: `${base}selection_tag${ext}`,
    chMap: `${base}selection_ch-map${ext}`,
    chTracks: `${base}selection_ch-tracks${ext}`,
  }
}

/**
 * One-paragraph summary of what a plan will write. Shared between the window's
 * live preview and the post-save status line, so the promise and the result are
 * phrased the same way (the desktop's `describe_plan`).
 */
export function describePlan(plan: SelectionPlan, selectedCount: number): string {
  if (plan.count === 0) return 'Nothing to save — select one or more glyphs first.'
  const parts = [`${plan.count} row(s) from ${selectedCount} selected`]
  if (plan.descendantsAdded) parts.push(`+${plan.descendantsAdded} descendant(s)`)
  if (plan.ancestorsAdded) parts.push(`+${plan.ancestorsAdded} parent(s)`)
  if (plan.linksAdded) parts.push(`+${plan.linksAdded} link(s)`)
  if (plan.worldRow) parts.push('+ scene settings')
  let text = parts.join(', ') + '.'
  if (plan.detachedIds.length > 0) {
    text += `  ${plan.detachedIds.length} node(s) will be re-rooted.`
  }
  if (plan.droppedLinks > 0) {
    text +=
      `  ${plan.droppedLinks} link(s) dropped — the node at the other end is` +
      ' not in the selection.'
  }
  return text
}
