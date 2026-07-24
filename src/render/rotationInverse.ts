// Inverse rotation decomposition for the rotate gizmo (interaction 6c.3):
// convert a node's dragged local rotation matrix (base rotation already
// removed) back into rotate_x/y/z — the exact inverse of localRotationMatrix.
//
// Policies (same spirit as topologyInverse, agreed 2026-07-24):
// - Angle unwrap: every recovered angle snaps to the nearest 360°-equivalent
//   of its previous value, so winding counts survive a drag.
// - Two-branch continuity: both algebraic solutions of the decomposition are
//   computed and the one nearest the previous angles wins, so e.g. a negative
//   tilt stays negative instead of flipping to its (+tilt, +180°) twin.
// - Gimbal hold: where the decomposition is singular (HTR tilt ≈ 0/180,
//   Euler pitch ≈ ±90) only the sum/difference of the outer angles is
//   defined — roll (rotate_z) holds its previous value and the remaining
//   angle absorbs the drag.

import * as THREE from 'three'
import type { Vec3 } from '../gv/types'
import { RotationMode } from '../gv/types'
import { unwrapDeg } from './topologyInverse'

const DEG = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** Sine threshold below which the middle angle counts as gimbal-locked. */
const GIMBAL_SIN_EPS = 1e-4

/** Sum of angular distances after unwrapping each component toward prev. */
function unwrapAll(candidate: Vec3, prev: Vec3): { value: Vec3; score: number } {
  const value = {
    x: unwrapDeg(candidate.x, prev.x),
    y: unwrapDeg(candidate.y, prev.y),
    z: unwrapDeg(candidate.z, prev.z),
  }
  const score =
    Math.abs(value.x - prev.x) + Math.abs(value.y - prev.y) + Math.abs(value.z - prev.z)
  return { value, score }
}

function nearest(a: Vec3, b: Vec3, prev: Vec3): Vec3 {
  const ua = unwrapAll(a, prev)
  const ub = unwrapAll(b, prev)
  return ua.score <= ub.score ? ua.value : ub.value
}

/**
 * Invert the ANTz Z-X-Z Heading/Tilt/Roll composition
 * M = Rz(−ry)·Rx(−rx)·Rz(−rz) (see headingTiltRollMatrix).
 * With α = −ry, β = −rx, γ = −rz this is a textbook ZXZ Euler extraction.
 */
function invertHtr(m: THREE.Matrix4, prev: Vec3): Vec3 {
  const e = m.elements // column-major: m[row][col] = e[col * 4 + row]
  const m13 = e[8]
  const m23 = e[9]
  const m33 = e[10]
  const m31 = e[2]
  const m32 = e[6]

  const sinBeta = Math.hypot(m13, m23) // = |sin β|
  if (sinBeta < GIMBAL_SIN_EPS) {
    // Tilt ≈ 0 or 180: only α+γ (resp. α−γ) is defined. Hold roll, give
    // the whole drag to heading by solving Rz(α) = M · Rz(−γ) · Rx(−β).
    const betaDeg = m33 > 0 ? 0 : 180
    const gamma = -prev.z * DEG
    const a = m
      .clone()
      .multiply(new THREE.Matrix4().makeRotationZ(-gamma))
      .multiply(new THREE.Matrix4().makeRotationX(-betaDeg * DEG))
    const alpha = Math.atan2(a.elements[1], a.elements[0])
    return {
      x: unwrapDeg(-betaDeg, prev.x),
      y: unwrapDeg(-alpha * RAD2DEG, prev.y),
      z: prev.z,
    }
  }

  const beta = Math.atan2(sinBeta, m33) // ∈ (0, π)
  const alpha = Math.atan2(m13, -m23)
  const gamma = Math.atan2(m31, m32)
  // Second solution: conjugating Rx by Rz(π) flips the tilt sign.
  const a: Vec3 = { x: -beta * RAD2DEG, y: -alpha * RAD2DEG, z: -gamma * RAD2DEG }
  const b: Vec3 = { x: beta * RAD2DEG, y: -alpha * RAD2DEG - 180, z: -gamma * RAD2DEG - 180 }
  return nearest(a, b, prev)
}

/**
 * Invert the GlyphViz-only Euler composition M = Rx(rx)·Ry(ry)·Rz(rz)
 * (see eulerXyzMatrix).
 */
function invertEulerXyz(m: THREE.Matrix4, prev: Vec3): Vec3 {
  const e = m.elements
  const m11 = e[0]
  const m12 = e[4]
  const m13 = e[8] // = sin ry
  const m23 = e[9]
  const m33 = e[10]

  const cosY = Math.hypot(m11, m12) // = |cos ry|
  if (cosY < GIMBAL_SIN_EPS) {
    // Pitch ≈ ±90: only rx∓rz is defined. Hold roll, solve
    // Rx(rx) = M · Rz(−rz) · Ry(−ry).
    const ry = m13 > 0 ? 90 : -90
    const a = m
      .clone()
      .multiply(new THREE.Matrix4().makeRotationZ(-prev.z * DEG))
      .multiply(new THREE.Matrix4().makeRotationY(-ry * DEG))
    const rx = Math.atan2(a.elements[6], a.elements[5])
    return {
      x: unwrapDeg(rx * RAD2DEG, prev.x),
      y: unwrapDeg(ry, prev.y),
      z: prev.z,
    }
  }

  const ry = Math.atan2(m13, cosY) // ∈ (−90°, 90°) branch
  const rx = Math.atan2(-m23, m33)
  const rz = Math.atan2(-m12, m11)
  const a: Vec3 = { x: rx * RAD2DEG, y: ry * RAD2DEG, z: rz * RAD2DEG }
  const b: Vec3 = { x: rx * RAD2DEG + 180, y: 180 - ry * RAD2DEG, z: rz * RAD2DEG + 180 }
  return nearest(a, b, prev)
}

/**
 * Exact inverse of localRotationMatrix under the unwrap/branch/gimbal
 * policies. `m` must be the node's own rotation only — callers strip the
 * topology base rotation first. `prev` is the last committed rotate value
 * (unwrap reference and gimbal hold).
 */
export function invertLocalRotation(m: THREE.Matrix4, prev: Vec3, rotationMode: number): Vec3 {
  return rotationMode === RotationMode.EulerXYZ ? invertEulerXyz(m, prev) : invertHtr(m, prev)
}
