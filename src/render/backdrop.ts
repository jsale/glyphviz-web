// Procedural viewport backdrop, ported (behavior, not code) from the desktop
// viewport's _draw_grid/_draw_axes (verified 2026-07-24):
//
// - Reference grid: 41×41 unlit lines on z = 0, color (0.22, 0.22, 0.28),
//   spacing max(10, camDistance·0.04) — rescaling with the camera makes it
//   feel infinite. Drawn only while the scene has NO real World Grid node;
//   once one exists, its own lattice is the reference plane and the
//   decoration's unrelated spacing would just fight it.
// - Origin axes: +X/+Y/+Z half-lines from the world origin in red/green/blue,
//   span camDistance·0.15, always shown.

import * as THREE from 'three'

const GRID_COLOR = new THREE.Color(0.22, 0.22, 0.28)
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
      new THREE.LineBasicMaterial({ color: GRID_COLOR }),
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

  /** Call once per frame with the camera→orbit-target distance. */
  update(camDistance: number): void {
    this.grid.visible = this.showReferenceGrid
    const step = Math.max(GRID_MIN_STEP, camDistance * GRID_STEP_PER_DISTANCE)
    this.grid.scale.set(step, step, 1)
    const span = camDistance * AXES_SPAN_PER_DISTANCE
    this.axes.scale.set(span, span, span)
  }
}
