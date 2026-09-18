import { describe, expect, it } from 'vitest'
import {
  isDesktopOnlyMeshFileName,
  isMeshFileName,
  isSceneMeshFileName,
  type MeshData,
  looksLikeBinaryStl,
  parseMeshFile,
  parseObj,
} from './meshFile'

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

/** A unit cube's 8 corners, as an OBJ with quad faces. */
const CUBE_OBJ = `
# a cube, 2 units on a side, centred at (10, 0, 0)
v  9 -1 -1
v 11 -1 -1
v 11  1 -1
v  9  1 -1
v  9 -1  1
v 11 -1  1
v 11  1  1
v  9  1  1
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`

/** One triangle in the z = 0 plane, as ASCII STL. */
const TRIANGLE_STL = `solid tri
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 2 0 0
      vertex 0 2 0
    endloop
  endfacet
endsolid tri
`

function binaryStl(triangles: number[][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  let offset = 84
  for (const tri of triangles) {
    offset += 12 // facet normal, deliberately left zero
    for (const value of tri) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
    offset += 2
  }
  return buffer
}

describe('mesh file names', () => {
  it('accepts the two formats this app parses', () => {
    expect(isMeshFileName('teapot.OBJ')).toBe(true)
    expect(isMeshFileName('part.stl')).toBe(true)
    expect(isMeshFileName('scene_gv_node.csv')).toBe(false)
    // The desktop reads these through trimesh; parseMeshFile says so by name.
    expect(isMeshFileName('model.glb')).toBe(false)
  })

  it('reports a desktop-only format by name instead of "unsupported"', () => {
    expect(() => parseMeshFile('model.glb', encode('x'))).toThrow(/desktop GlyphViz/)
  })
})

describe('parseObj', () => {
  it('fans a quad face into two triangles', () => {
    const raw = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n')
    expect(raw.indices).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('resolves negative (relative) indices', () => {
    const raw = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nf -3 -2 -1\n')
    expect(raw.indices).toEqual([0, 1, 2])
  })

  it('keeps v/vt/vn triples apart but shares repeats', () => {
    const obj = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'vt 0 0',
      'vt 1 0',
      'vt 1 1',
      'f 1/1 2/2 3/3',
      'f 1/1 2/2 3/3',
    ].join('\n')
    const raw = parseObj(obj)
    expect(raw.positions.length / 3).toBe(3) // the second face reuses all three
    expect(raw.uvs).toEqual([0, 0, 1, 0, 1, 1])
  })

  it('reports no uvs when the file has none', () => {
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 3\n').uvs).toBeNull()
  })

  it('takes the file’s own vn normals when every corner has one', () => {
    const obj = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'vn 0 0 1',
      'f 1//1 2//1 3//1',
    ].join('\n')
    expect(parseObj(obj).normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
  })

  it('ignores material and grouping records', () => {
    const raw = parseObj('mtllib cube.mtl\no cube\ng side\nusemtl red\ns 1\nv 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 3\n')
    expect(raw.indices).toEqual([0, 1, 2])
  })
})

/**
 * A finely tessellated UV sphere as OBJ, for the "still smooth" tests.
 *
 * NOT an icosahedron, which was the obvious choice and is wrong: its faces
 * meet at 138.2 degrees, so their NORMALS differ by 41.8 — just outside
 * CREASE_ANGLE_DEG, and the crease pass correctly facets it. At 32x16 the
 * facets here differ by about 11 degrees, comfortably smooth.
 */
function uvSphereObj(seg = 32, rings = 16): string {
  const lines: string[] = []
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * 2 * Math.PI
      lines.push(
        `v ${Math.sin(phi) * Math.cos(th)} ${Math.sin(phi) * Math.sin(th)} ${Math.cos(phi)}`,
      )
    }
  }
  const at = (r: number, i: number) => r * seg + (i % seg) + 1
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      lines.push(`f ${at(r, i)} ${at(r + 1, i)} ${at(r + 1, i + 1)}`)
      lines.push(`f ${at(r, i)} ${at(r + 1, i + 1)} ${at(r, i + 1)}`)
    }
  }
  return lines.join('\n') + '\n'
}

describe('parseMeshFile normalization (desktop mesh_loader)', () => {
  it('centres on the bounding box and scales to radius ~1', () => {
    const mesh = parseMeshFile('cube.obj', encode(CUBE_OBJ))
    expect(mesh.name).toBe('cube')
    // 24, not 8: the crease pass splits each corner once per face it touches,
    // which is what makes the cube's edges hard. Positions still merge to 8
    // first — the split is downstream of the merge, not instead of it.
    expect(mesh.vertexCount).toBe(24)
    expect(mesh.triangleCount).toBe(12) // six quads, fanned

    let maxRadius = 0
    let cx = 0
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 3]
      cx += x
      maxRadius = Math.max(
        maxRadius,
        Math.hypot(x, mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]),
      )
    }
    // The +10 X offset is gone (the AABB centre moved to the origin) and the
    // farthest corner sits exactly on the unit sphere.
    expect(cx / mesh.vertexCount).toBeCloseTo(0, 12)
    expect(maxRadius).toBeCloseTo(1, 6)
  })

  it('gives a cube six flat face normals, not eight smooth diagonals', () => {
    // The load-bearing one. Before the crease pass (2026-09-16, ported from
    // the desktop) every corner took the angle-weighted mean of its three
    // mutually perpendicular faces and pointed along the body diagonal, so a
    // cube shaded like a beach ball. Faces meeting at 90 degrees are well past
    // CREASE_ANGLE_DEG, so each corner now keeps its own face's normal.
    const mesh = parseMeshFile('cube.obj', encode(CUBE_OBJ))
    const seen = new Set<string>()
    for (let i = 0; i < mesh.vertexCount; i++) {
      const n = [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]]
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6)
      // `+ 0` folds -0 into 0, so the six axis normals compare as six strings
      // rather than as twelve signed-zero spellings of them.
      seen.add(n.map((v) => (Math.abs(v) < 5e-4 ? 0 : v) + 0).map((v) => v.toFixed(3)).join(','))
    }
    expect([...seen].sort()).toEqual([
      '-1.000,0.000,0.000',
      '0.000,-1.000,0.000',
      '0.000,0.000,-1.000',
      '0.000,0.000,1.000',
      '0.000,1.000,0.000',
      '1.000,0.000,0.000',
    ])
  })

  it('leaves a smooth surface smooth', () => {
    // A crease angle that squared off a sphere would be no better than the bug
    // it fixes, so the normals here must still point radially outward.
    const mesh = parseMeshFile('sphere.obj', encode(uvSphereObj()))
    for (let i = 0; i < mesh.vertexCount; i++) {
      const n = [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]]
      const p = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
      const plen = Math.hypot(p[0], p[1], p[2])
      if (plen < 1e-9) continue
      expect((n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / plen).toBeGreaterThan(0.97)
    }
  })

  it('barely splits a smooth surface', () => {
    // The cost check: splitting happens only at creases, so an organic model
    // keeps roughly its merged vertex count instead of the 3-per-triangle a
    // blanket un-index would cost. A closed smooth surface has V about T/2;
    // a fully split one would have V = 3T.
    const mesh = parseMeshFile('sphere.obj', encode(uvSphereObj()))
    expect(mesh.vertexCount).toBeLessThan(mesh.triangleCount)
  })

})

describe('STL', () => {
  it('parses ASCII facets', () => {
    const mesh = parseMeshFile('tri.stl', encode(TRIANGLE_STL))
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.vertexCount).toBe(3)
    // Winding is CCW seen from +Z, so the recomputed normal points that way —
    // the file's own facet normal never gets read.
    expect(mesh.normals[2]).toBeCloseTo(1, 6)
    expect(mesh.uvs).toBeNull()
  })

  it('detects a binary file by its exact length, not its header', () => {
    const buffer = binaryStl([[0, 0, 0, 1, 0, 0, 0, 1, 0]])
    expect(looksLikeBinaryStl(buffer)).toBe(true)
    expect(looksLikeBinaryStl(encode(TRIANGLE_STL))).toBe(false)
    const mesh = parseMeshFile('tri.stl', buffer)
    expect(mesh.triangleCount).toBe(1)
  })

  it('merges the loose corners two facets share (trimesh process=True)', () => {
    // Two triangles meeting along an edge: 6 loose corners, 4 distinct points.
    const mesh = parseMeshFile(
      'quad.stl',
      binaryStl([
        [0, 0, 0, 1, 0, 0, 1, 1, 0],
        [0, 0, 0, 1, 1, 0, 0, 1, 0],
      ]),
    )
    expect(mesh.triangleCount).toBe(2)
    // The shared corners keep their own vertex slots (STL has no index list),
    // but they shade as ONE vertex — which is the whole point of the merge.
    const at = (i: number) => [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]]
    expect(at(0)).toEqual(at(3)) // (0,0,0) appears in both facets
    expect(at(2)).toEqual(at(4)) // and so does (1,1,0)
  })

  it('drops NaN facets and measures the rest, like trimesh’s process()', () => {
    // The shape of the VTK-written isosurface2.stl in Jeff's examples folder:
    // 6,929 of its 32,828 facets carry NaN coordinates. One left in would make
    // the bounding box NaN and the whole model would disappear.
    const mesh = parseMeshFile(
      'iso.stl',
      binaryStl([
        [0, 0, 0, 2, 0, 0, 0, 2, 0],
        [0, 0, 0, NaN, 0, 0, 0, 2, 0],
        [0, 0, 0, 2, 0, 0, 0, 0, Infinity],
      ]),
    )
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.droppedTriangles).toBe(2)
    // The orphaned NaN vertices are gone too — bounds are over the referenced
    // ones only, so the surviving triangle normalizes exactly as if alone.
    expect(mesh.vertexCount).toBe(3)
    for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true)
  })

  it('rejects a file with no triangles in it', () => {
    expect(() => parseMeshFile('empty.stl', encode('solid empty\nendsolid empty\n'))).toThrow(
      /No usable triangle mesh/,
    )
  })
})

describe('PLY', () => {
  // PLY became a mesh format when the point-cloud importer arrived: its vertex
  // table is a cloud and its face table is a mesh, and one reader in
  // src/io/plyFile.ts serves both. Before that it was refused by name.
  const PYRAMID =
    'ply\nformat ascii 1.0\nelement vertex 5\n' +
    'property float x\nproperty float y\nproperty float z\n' +
    'element face 5\nproperty list uchar int vertex_indices\nend_header\n' +
    '-1 -1 0\n1 -1 0\n1 1 0\n-1 1 0\n0 0 2\n' +
    '4 0 1 2 3\n3 0 1 4\n3 1 2 4\n3 2 3 4\n3 3 0 4\n'

  it('parses an ASCII mesh and normalizes it like every other model', () => {
    const mesh = parseMeshFile('pyramid.ply', encode(PYRAMID))
    // The quad base fans into two triangles, so 4 + 2 rather than 5 faces.
    expect(mesh.triangleCount).toBe(6)
    // The desktop's convention: centred on the AABB centre, scaled so the
    // farthest vertex sits at radius 1.
    let far = 0
    for (let i = 0; i < mesh.positions.length; i += 3) {
      far = Math.max(far, Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]))
    }
    expect(far).toBeCloseTo(1, 6)
  })

  it('reads a binary little-endian mesh identically', () => {
    // Same pyramid, written the way real exporters write it.
    const header =
      'ply\nformat binary_little_endian 1.0\nelement vertex 5\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'element face 5\nproperty list uchar int vertex_indices\nend_header\n'
    const verts = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 2]]
    const faces = [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
    const body = new ArrayBuffer(5 * 12 + faces.reduce((n, f) => n + 1 + f.length * 4, 0))
    const view = new DataView(body)
    let at = 0
    for (const v of verts) for (const c of v) { view.setFloat32(at, c, true); at += 4 }
    for (const f of faces) {
      view.setUint8(at, f.length); at += 1
      for (const i of f) { view.setInt32(at, i, true); at += 4 }
    }
    const head = encode(header)
    const bytes = new Uint8Array(head.byteLength + body.byteLength)
    bytes.set(new Uint8Array(head), 0)
    bytes.set(new Uint8Array(body), head.byteLength)

    const mesh = parseMeshFile('pyramid.ply', bytes.buffer)
    expect(mesh.triangleCount).toBe(6)
    expect(mesh.vertexCount).toBe(parseMeshFile('pyramid.ply', encode(PYRAMID)).vertexCount)
  })

  it('refuses a point-only PLY as a MESH, which is what it is', () => {
    // The same file imports perfectly well through Import Cloud…; asked to be a
    // mesh glyph, "there are no triangles here" is the honest answer.
    const cloud =
      'ply\nformat ascii 1.0\nelement vertex 2\n' +
      'property float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 1 1\n'
    expect(() => parseMeshFile('scan.ply', encode(cloud))).toThrow(/No usable triangle mesh/)
  })

  it('no longer names .ply as desktop-only', () => {
    expect(isMeshFileName('model.ply')).toBe(true)
    expect(isDesktopOnlyMeshFileName('model.ply')).toBe(false)
    expect(isDesktopOnlyMeshFileName('model.glb')).toBe(true)
  })

  it('counts .glb as a scene model even though it cannot read one', () => {
    // SCENE_MESH_EXTENSIONS is the DESKTOP's supported set, because mesh_id is
    // a file's position in meshes/ — see bundle.test.ts for what that buys.
    expect(isSceneMeshFileName('model.glb')).toBe(true)
    expect(isSceneMeshFileName('model.obj')).toBe(true)
    expect(isSceneMeshFileName('notes.md')).toBe(false)
  })
})

describe('degenerate faces', () => {
  // trimesh's nondegenerate_faces, which load_mesh_file asks for with
  // validate=True. Not a nicety: 6,408 of the lab oak canopy's 21,360 faces
  // have no area, and the desktop draws the other 14,952.
  const OBJ = (faces: string) =>
    'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 2 0 0\nv 0 0.0001 0\n' + faces

  it('drops three collinear points, keeps a real triangle', () => {
    // 1-2-4 are all on the x axis: an edge, not a face.
    const mesh = parseMeshFile('t.obj', encode(OBJ('f 1 2 3\nf 1 2 4\n')))
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.degenerateTriangles).toBe(1)
  })

  it('drops a triangle naming one vertex twice', () => {
    const mesh = parseMeshFile('t.obj', encode(OBJ('f 1 2 3\nf 1 2 2\n')))
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.degenerateTriangles).toBe(1)
  })

  it('keeps a thin sliver, which still has a width', () => {
    // 0.0001 units tall is a sliver, not a degeneracy — the test is the
    // triangle's own bounding-box heights against 1e-8, not its area.
    const mesh = parseMeshFile('t.obj', encode(OBJ('f 1 4 5\n')))
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.degenerateTriangles).toBe(0)
  })

  it('says so rather than returning an empty mesh', () => {
    expect(() => parseMeshFile('t.obj', encode(OBJ('f 1 2 4\n')))).toThrow(/no area/)
  })

  it('counts NaN facets separately, because they mean something else', () => {
    // One is a broken file and worth a warning; the other is ordinary
    // generator output, so folding them into one number would report 6,408
    // 'NaN facets' for a lab tree that has none.
    const mesh = parseMeshFile(
      'iso.stl',
      binaryStl([
        [0, 0, 0, 2, 0, 0, 0, 2, 0],
        [0, 0, 0, NaN, 0, 0, 0, 2, 0],
        [0, 0, 0, 1, 0, 0, 2, 0, 0],
      ]),
    )
    expect(mesh.droppedTriangles).toBe(1)
    expect(mesh.degenerateTriangles).toBe(1)
    expect(mesh.triangleCount).toBe(1)
  })
})

describe('PLY texture coordinates', () => {
  // PLY never standardised where UVs live, so trimesh tries a face list and
  // three vertex spellings, and the desktop draws whichever it finds. These pin
  // the same set and the same precedence.
  const uvOf = (mesh: MeshData, i: number) =>
    mesh.uvs ? [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]] : null

  const allUvs = (mesh: MeshData) => {
    const seen = new Set<string>()
    for (let i = 0; i < mesh.vertexCount; i++) seen.add(String(uvOf(mesh, i)))
    return seen
  }

  it('reads vertex-level s/t', () => {
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float s\nproperty float t\n' +
      'element face 2\nproperty list uchar int vertex_indices\nend_header\n' +
      '0 0 0 0 0\n1 0 0 1 0\n1 1 0 1 1\n0 1 0 0 1\n' +
      '3 0 1 2\n3 0 2 3\n'
    const mesh = parseMeshFile('tile.ply', encode(ply))
    expect(mesh.uvs).not.toBeNull()
    expect(mesh.vertexCount).toBe(4)
    expect(uvOf(mesh, 0)).toEqual([0, 0])
    expect(uvOf(mesh, 2)).toEqual([1, 1])
  })

  it('prefers texture_u/texture_v over s/t, as trimesh does', () => {
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float s\nproperty float t\n' +
      'property float texture_u\nproperty float texture_v\n' +
      'element face 2\nproperty list uchar int vertex_indices\nend_header\n' +
      '0 0 0 9 9 0 0\n1 0 0 9 9 1 0\n1 1 0 9 9 1 1\n0 1 0 9 9 0 1\n' +
      '3 0 1 2\n3 0 2 3\n'
    // The 9s are the s/t pair; texture_u/v is the one that has to win.
    expect(uvOf(parseMeshFile('tile.ply', encode(ply)), 2)).toEqual([1, 1])
  })

  it('reads vertex UVs out of a binary file too', () => {
    const header =
      'ply\nformat binary_little_endian 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float u\nproperty float v\n' +
      'element face 2\nproperty list uchar int vertex_indices\nend_header\n'
    const verts = [
      [0, 0, 0, 0, 0],
      [1, 0, 0, 1, 0],
      [1, 1, 0, 1, 1],
      [0, 1, 0, 0, 1],
    ]
    const faces = [
      [0, 1, 2],
      [0, 2, 3],
    ]
    const body = new ArrayBuffer(4 * 20 + faces.length * 13)
    const view = new DataView(body)
    let at = 0
    for (const rowValues of verts) {
      for (const c of rowValues) {
        view.setFloat32(at, c, true)
        at += 4
      }
    }
    for (const f of faces) {
      view.setUint8(at, 3)
      at += 1
      for (const i of f) {
        view.setInt32(at, i, true)
        at += 4
      }
    }
    const head = encode(header)
    const bytes = new Uint8Array(head.byteLength + body.byteLength)
    bytes.set(new Uint8Array(head), 0)
    bytes.set(new Uint8Array(body), head.byteLength)

    expect(uvOf(parseMeshFile('tile.ply', bytes.buffer), 2)).toEqual([1, 1])
  })

  it('reads per-corner face texcoord, keeping a UV seam as two vertices', () => {
    // The form MeshLab and most photogrammetry tools write. v0 and v2 are each
    // named twice with different coordinates — which is what a seam IS — so the
    // square comes back as six vertices rather than four.
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'element face 2\nproperty list uchar int vertex_indices\n' +
      'property list uchar float texcoord\nend_header\n' +
      '0 0 0\n1 0 0\n1 1 0\n0 1 0\n' +
      '3 0 1 2 6 0 0 1 0 1 1\n' +
      '3 0 2 3 6 2 0 3 1 2 1\n'
    const mesh = parseMeshFile('tile.ply', encode(ply))
    expect(mesh.triangleCount).toBe(2)
    expect(mesh.vertexCount).toBe(6)
    expect(allUvs(mesh).has('0,0')).toBe(true)
    expect(allUvs(mesh).has('2,0')).toBe(true)

    // And the seam is NOT a crease: the square is flat, so every normal is the
    // same one. Creases are decided on POSITION, which is the whole reason a
    // lofted tube does not wear a shading stripe down its seam.
    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(Math.abs(mesh.normals[i * 3 + 2])).toBeCloseTo(1, 6)
    }
  })

  it('lets face texcoord win over vertex properties', () => {
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float s\nproperty float t\n' +
      'element face 2\nproperty list uchar int vertex_indices\n' +
      'property list uchar float texcoord\nend_header\n' +
      '0 0 0 9 9\n1 0 0 9 9\n1 1 0 9 9\n0 1 0 9 9\n' +
      '3 0 1 2 6 0 0 1 0 1 1\n' +
      '3 0 2 3 6 0 0 1 1 0 1\n'
    const mesh = parseMeshFile('tile.ply', encode(ply))
    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(uvOf(mesh, i)![0]).not.toBe(9)
    }
  })

  it('fans a textured quad without leaving its UVs behind', () => {
    // A quad's four corner UVs have to follow the two triangles the fan makes
    // of it, or part of the image lands rotated.
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'element face 1\nproperty list uchar int vertex_indices\n' +
      'property list uchar float texcoord\nend_header\n' +
      '0 0 0\n1 0 0\n1 1 0\n0 1 0\n' +
      '4 0 1 2 3 8 0 0 1 0 1 1 0 1\n'
    const mesh = parseMeshFile('tile.ply', encode(ply))
    expect(mesh.triangleCount).toBe(2)
    expect([...allUvs(mesh)].sort()).toEqual(['0,0', '0,1', '1,0', '1,1'])
  })

  it('leaves a PLY with no coordinates untextured', () => {
    const ply =
      'ply\nformat ascii 1.0\nelement vertex 4\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'element face 2\nproperty list uchar int vertex_indices\nend_header\n' +
      '0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2\n3 0 2 3\n'
    expect(parseMeshFile('tile.ply', encode(ply)).uvs).toBeNull()
  })
})
