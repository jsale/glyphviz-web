// Procedural viewport backdrop, ported (behavior, not code) from the desktop
// viewport's _draw_grid/_draw_axes (verified 2026-07-24):
//
// - Reference grid: 41×41 unlit lines on z = 0, spacing max(10,
//   camDistance·0.04) — rescaling with the camera makes it feel infinite.
//   Drawn only while the scene has NO real World Grid node; once one exists,
//   its own lattice is the reference plane and the decoration's unrelated
//   spacing would just fight it. Its colour is the World row's
//   ref_grid_color_r/g/b (scene data, not a viewer preference).
// - Origin axes: +X/+Y/+Z half-lines from the world origin in red/green/blue,
//   span camDistance·0.15.
//
// Both are switchable from the Scene panel's Show Grid / Show Axes checkboxes,
// the desktop's Display group (Viewport.show_grid / show_axes). Those two ARE
// viewer preferences — nothing about them is written to the CSV — so unlike
// the grid colour they don't survive a reload.

import * as THREE from 'three'
import type { Rgb } from '../gv/types'
import { REF_GRID_DEFAULT_RGB } from '../gv/types'

const GRID_COUNT = 20 // lines from −count..count each way
const GRID_MIN_STEP = 10.0
const GRID_STEP_PER_DISTANCE = 0.04
const AXES_SPAN_PER_DISTANCE = 0.15

export class Backdrop {
  readonly group = new THREE.Group()
  private grid: THREE.LineSegments
  private axes: THREE.LineSegments
  /** Scene-content switch: false once a World Grid node exists. */
  showReferenceGrid = true
  /** Show Grid checkbox — independent of the switch above; both must allow it. */
  showGrid = true
  /** Show Axes checkbox. */
  showAxes = true

  constructor() {
    this.group.name = 'backdrop'

    // Unit-step lattice; per-frame scale applies the camera-driven spacing.
    const positions: number[] = []
    for (let i = -GRID_COUNT; i <= GRID_COUNT; i++) {
      positions.push(i, -GRID_COUNT, 0, i, GRID_COUNT, 0)
      positions.push(-GRID_COUNT, i, 0, GRID_COUNT, i, 0)
    }
    const gridGeo = new THREE.BufferGeometry()
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(
          REF_GRID_DEFAULT_RGB.r / 255,
          REF_GRID_DEFAULT_RGB.g / 255,
          REF_GRID_DEFAULT_RGB.b / 255,
        ),
      }),
    )
    this.grid.name = 'reference-grid'
    this.group.add(this.grid)

    // Unit axes with per-vertex color; per-frame scale applies the span.
    const axisGeo = new THREE.BufferGeometry()
    axisGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], 3),
    )
    axisGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        [1, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1, 0.2, 0.2, 1, 0.2, 0.2, 0.4, 1, 0.2, 0.4, 1],
        3,
      ),
    )
    this.axes = new THREE.LineSegments(
      axisGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }),
    )
    this.axes.name = 'origin-axes'
    this.group.add(this.axes)
  }

  /** Paint the reference grid the scene's ref_grid_color (0–255 channels). */
  setGridColor(rgb: Rgb): void {
    const material = this.grid.material as THREE.LineBasicMaterial
    material.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255)
  }

  /** Call once per frame with the camera→orbit-target distance. */
  update(camDistance: number): void {
    this.grid.visible = this.showGrid && this.showReferenceGrid
    this.axes.visible = this.showAxes
    const step = Math.max(GRID_MIN_STEP, camDistance * GRID_STEP_PER_DISTANCE)
    this.grid.scale.set(step, step, 1)
    const span = camDistance * AXES_SPAN_PER_DISTANCE
    this.axes.scale.set(span, span, span)
  }
}
