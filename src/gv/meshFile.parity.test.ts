// Imported meshes, diffed against the REAL desktop loader.
//
// `tools/dump_mesh_corners.py` runs `glyphviz_core.mesh_loader.load_mesh_file`
// over the vendored models beside this file and records, per face CORNER, the
// three things that can go wrong independently: where the vertex ended up
// (trimesh's welding and NaN/degenerate pruning, then GlyphViz's own
// re-centre-and-normalize), what texture coordinate it carries, and which way
// its normal points (the 40° crease pass).
//
// Corner-wise because that is the one representation the two apps share. The
// desktop emits a normal and a texcoord per corner into a display list, so its
// geometry is effectively un-indexed; a BufferGeometry needs one normal per
// vertex, so `splitByCornerNormal` splits vertices at hard edges instead.
// Corner i of the dump lines up with `indices[i]` here whatever each side did
// to its vertex table.
//
// This harness is what found the divergence it now guards: the web used to keep
// the zero-area triangles trimesh's `validate=True` removes — 8 of
// tower_plant's 156, and 6,408 of the lab oak canopy's 21,360.
//
// Tolerances are float32 noise, not slack. The desktop stores vertices and
// normals as float32 and the dump rounds to 9 places; a real disagreement in
// any of the three quantities is orders of magnitude larger than these (the
// pre-fix seam bug on the desktop side was 14 DEGREES).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CREASE_ANGLE_DEG, parseMeshFile } from './meshFile'

interface Corner {
  p: number[]
  uv: number[] | null
  n: number[]
}

interface Dump {
  crease_angle: number
  models: Record<string, { name: string; triangles: number; has_uvs: boolean; corners: Corner[] }>
}

const here = new URL('./fixtures/mesh/', import.meta.url)
const dump = JSON.parse(readFileSync(new URL('mesh_corners.json', here), 'utf8')) as Dump

function parse(file: string) {
  const buf = readFileSync(new URL(file, here))
  return parseMeshFile(
    file,
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  )
}

describe('mesh import parity with the desktop loader', () => {
  it('uses the desktop crease angle', () => {
    // The one constant that decides which edges stay hard. A different value
    // here would shade every imported model differently, in a way no other
    // assertion in this file would localise.
    expect(CREASE_ANGLE_DEG).toBe(dump.crease_angle)
  })

  for (const [file, ref] of Object.entries(dump.models)) {
    describe(file, () => {
      const mesh = parse(file)

      it('keeps exactly the triangles the desktop keeps', () => {
        // tower_plant is here for this line: 156 faces in the file, 148 with
        // any area. Getting it wrong desynchronises every corner below, which
        // is how the difference was found in the first place.
        expect(mesh.triangleCount).toBe(ref.triangles)
        expect(mesh.indices.length).toBe(ref.corners.length)
      })

      it('normalizes every vertex to the same place', () => {
        let worst = 0
        for (let i = 0; i < ref.corners.length; i++) {
          const v = mesh.indices[i]
          for (let a = 0; a < 3; a++) {
            worst = Math.max(worst, Math.abs(mesh.positions[v * 3 + a] - ref.corners[i].p[a]))
          }
        }
        expect(worst).toBeLessThan(2e-6)
      })

      it('carries the same texture coordinates', () => {
        expect(mesh.uvs !== null).toBe(ref.has_uvs)
        if (!ref.has_uvs || !mesh.uvs) return
        let worst = 0
        for (let i = 0; i < ref.corners.length; i++) {
          const v = mesh.indices[i]
          const uv = ref.corners[i].uv!
          for (let a = 0; a < 2; a++) {
            worst = Math.max(worst, Math.abs(mesh.uvs[v * 2 + a] - uv[a]))
          }
        }
        expect(worst).toBeLessThan(2e-6)
      })

      it('points every corner normal the same way', () => {
        // Angles, not components: a normal is a direction, and the failure
        // this guards against (a seam read as a crease, an averaged corner
        // where a hard one belongs) is an ANGLE being wrong.
        let sum = 0
        let worst = 0
        for (let i = 0; i < ref.corners.length; i++) {
          const v = mesh.indices[i]
          const n = ref.corners[i].n
          const dot =
            mesh.normals[v * 3] * n[0] +
            mesh.normals[v * 3 + 1] * n[1] +
            mesh.normals[v * 3 + 2] * n[2]
          const deg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
          sum += deg
          worst = Math.max(worst, deg)
        }
        expect(sum / ref.corners.length).toBeLessThan(0.05)
        expect(worst).toBeLessThan(0.5)
      })
    })
  }
})
