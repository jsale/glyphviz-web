// rotate_x/y/z interpretation, ported (behavior, not code) from the desktop
// engine: glyphviz_core/topology.py local_rotation_matrix() and friends,
// verified against source 2026-07-24.

import * as THREE from 'three'
import { RotationMode } from '../gv/types'

const DEG = Math.PI / 180

/**
 * ANTz Z-X-Z Heading/Tilt/Roll (rotation_mode 1, the load default):
 * Rz(−ry) · Rx(−rx) · Rz(−rz). rotate_y is "heading" and rotate_z is
 * "tilt" — both drive Z-axis rotations; no Y-axis rotation exists in this
 * convention, and every angle is sign-inverted relative to the right-hand
 * rule (ANTz's glRotatef axes are (0,0,−1) / (−1,0,0) / (0,0,−1)).
 */
export function headingTiltRollMatrix(rx: number, ry: number, rz: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeRotationZ(-ry * DEG)
    .multiply(new THREE.Matrix4().makeRotationX(-rx * DEG))
    .multiply(new THREE.Matrix4().makeRotationZ(-rz * DEG))
}

/**
 * GlyphViz-only Euler XYZ (rotation_mode 0): Rx(rx) · Ry(ry) · Rz(rz),
 * each field a standard right-hand-rule rotation about its own axis.
 */
export function eulerXyzMatrix(rx: number, ry: number, rz: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeRotationX(rx * DEG)
    .multiply(new THREE.Matrix4().makeRotationY(ry * DEG))
    .multiply(new THREE.Matrix4().makeRotationZ(rz * DEG))
}

/** Dispatch on the node's rotation_mode (degrees in, matrix out). */
export function localRotationMatrix(
  rx: number,
  ry: number,
  rz: number,
  rotationMode: number,
): THREE.Matrix4 {
  return rotationMode === RotationMode.EulerXYZ
    ? eulerXyzMatrix(rx, ry, rz)
    : headingTiltRollMatrix(rx, ry, rz)
}
