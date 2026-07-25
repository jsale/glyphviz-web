// Cross-implementation parity harness for the Plot (16) / Surface (17)
// overlays: the web app's drawn vertex stream must reproduce the desktop
// viewport's.
//
// The reference JSONs come from tools/dump_topology_overlays.py, which runs
// the REAL desktop `Viewport._draw_topology_overlays` headlessly with the
// fixed-function GL calls swapped for recorders — so this diffs against the
// desktop's actual code, not a restatement of it. Regenerate them whenever
// either side's overlay code or a fixture CSV changes.
//
// Two deliberate exclusions, both documented in topologyOverlay.ts:
//   - GL_POINTS primitives (the desktop's round cap/join dots) have no web
//     counterpart — three's fat lines round their own caps.
//   - A polyline's per-vertex ALPHA collapses to the mean of its children,
//     because three's LineSegmentsGeometry carries RGB only. Every fixture
//     plot uses one alpha throughout, so the comparison is still exact here.

import { describe, expect, it } from 'vitest'
import { buildScene } from './buildScene'
import type { OverlayPrimitive } from './topologyOverlay'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import topologyExampleCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'
import topologyOverlaysRaw from '../gv/fixtures/topology_example_overlays.json?raw'
import plotSurfaceCsv from '../gv/fixtures/plot_surface_example_gv_node.csv?raw'
import plotSurfaceOverlaysRaw from '../gv/fixtures/plot_surface_example_overlays.json?raw'
import plotSurfaceHiddenRaw from '../gv/fixtures/plot_surface_example_overlays_hidden.json?raw'
import showcaseCsv from '../examples/plot_surface_example_gv_node.csv?raw'
import showcaseOverlaysRaw from '../gv/fixtures/plot_surface_showcase_overlays.json?raw'

interface DumpVertex {
  pos: [number, number, number]
  color: [number, number, number, number]
  normal: [number, number, number]
}

interface DumpPrimitive {
  mode: string
  lineWidth: number
  pointSize: number
  vertices: DumpVertex[]
}

interface Dump {
  source: string
  baseScale: number
  showHidden: boolean
  primitives: DumpPrimitive[]
}

// The web writes its vertices into float32 GPU buffers; the desktop dumps
// float64. Compare with a relative tolerance sized for float32's ~7 digits.
const REL_TOLERANCE = 1e-5
const COLOR_TOLERANCE = 1e-6

function expectClose(actual: number, expected: number, tolerance: number, what: string): void {
  const limit = tolerance * Math.max(1, Math.abs(expected))
  expect(Math.abs(actual - expected), `${what}: got ${actual}, expected ${expected}`).toBeLessThan(
    limit,
  )
}

/** The desktop stream reduced to the primitives the web app draws: line
 *  strips as polylines, each GL_QUADS block split into its four-vertex
 *  quads. GL_POINTS (cap dots) and GL_LINES (Link edges, covered by
 *  linkOverlay.test.ts) drop out. */
function expectedPrimitives(dump: Dump): Array<{
  kind: 'polyline' | 'quad'
  widthPx?: number
  vertices: DumpVertex[]
}> {
  const out: Array<{ kind: 'polyline' | 'quad'; widthPx?: number; vertices: DumpVertex[] }> = []
  for (const prim of dump.primitives) {
    if (prim.mode === 'GL_LINE_STRIP') {
      out.push({ kind: 'polyline', widthPx: prim.lineWidth, vertices: prim.vertices })
    } else if (prim.mode === 'GL_QUADS') {
      for (let i = 0; i < prim.vertices.length; i += 4) {
        out.push({ kind: 'quad', vertices: prim.vertices.slice(i, i + 4) })
      }
    }
  }
  return out
}

type Expected = ReturnType<typeof expectedPrimitives>[number]

function comparePrimitive(got: OverlayPrimitive | undefined, want: Expected, label: string): void {
  expect(got, label).toBeDefined()
  if (want.kind === 'polyline') {
    expectClose(got!.widthPx!, want.widthPx!, 1e-9, `${label} width`)
  }
  expect(got!.vertices, `${label} vertex count`).toHaveLength(want.vertices.length)
  want.vertices.forEach((wv, v) => {
    const gv = got!.vertices[v]
    for (let axis = 0; axis < 3; axis++) {
      expectClose(gv.pos[axis], wv.pos[axis], REL_TOLERANCE, `${label}/${v} pos[${axis}]`)
    }
    for (let c = 0; c < 4; c++) {
      expectClose(gv.color[c], wv.color[c], COLOR_TOLERANCE, `${label}/${v} color[${c}]`)
    }
    if (want.kind === 'quad') {
      for (let axis = 0; axis < 3; axis++) {
        expectClose(gv.normal![axis], wv.normal[axis], REL_TOLERANCE, `${label}/${v} n[${axis}]`)
      }
    }
  })
}

const FIXTURES: Array<{ name: string; csv: string; dump: Dump }> = [
  {
    name: 'topology example (one plot, one 3x2 surface)',
    csv: topologyExampleCsv,
    dump: JSON.parse(topologyOverlaysRaw) as Dump,
  },
  {
    name: 'plot/surface example (hidden rows, link child, lattice hole, duplicate cell)',
    csv: plotSurfaceCsv,
    dump: JSON.parse(plotSurfaceOverlaysRaw) as Dump,
  },
  {
    name: 'plot/surface example with Show Hidden Nodes',
    csv: plotSurfaceCsv,
    dump: JSON.parse(plotSurfaceHiddenRaw) as Dump,
  },
]

for (const fixture of FIXTURES) {
  describe(`topology-overlay parity with the desktop viewport: ${fixture.name}`, () => {
    const parsed = parseGvNodeCsv(fixture.csv)
    const { root, overlays } = buildScene(parsed.nodes, { showHidden: fixture.dump.showHidden })
    root.updateMatrixWorld(true)
    overlays.update()
    const actual: OverlayPrimitive[] = overlays.primitives()
    const expected = expectedPrimitives(fixture.dump)

    it('parses cleanly and draws the same primitives the desktop does', () => {
      expect(parsed.errors).toEqual([])
      expect(fixture.dump.baseScale).toBe(1)
      expect(actual.map((p) => p.kind)).toEqual(expected.map((p) => p.kind))
    })

    expected.forEach((want, index) => {
      it(`${want.kind} #${index} matches the desktop vertex stream`, () => {
        comparePrimitive(actual[index], want, `primitive ${index}`)
      })
    })
  })
}

// The showcase scene is the built-in example, 794 nodes deep: 529 quads and
// two long polylines. Too many to name one test each, so it diffs in one go —
// this is the volume check that the small fixtures cannot be.
describe('topology-overlay parity: Plot & Surface showcase example', () => {
  const dump = JSON.parse(showcaseOverlaysRaw) as Dump
  const parsed = parseGvNodeCsv(showcaseCsv)
  const { root, overlays } = buildScene(parsed.nodes)
  root.updateMatrixWorld(true)
  overlays.update()
  const actual = overlays.primitives()
  const expected = expectedPrimitives(dump)

  it('draws the same primitives the desktop does', () => {
    expect(parsed.errors).toEqual([])
    expect(overlays.plotCount).toBe(2)
    expect(overlays.quadCount).toBe(23 * 23)
    expect(actual.map((p) => p.kind)).toEqual(expected.map((p) => p.kind))
  })

  it('matches the desktop vertex stream on every primitive', () => {
    expected.forEach((want, index) => {
      comparePrimitive(actual[index], want, `${want.kind} ${index}`)
    })
  })
})
