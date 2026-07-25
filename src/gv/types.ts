// Data model for the GlyphViz gv_node.csv format.
//
// Authoritative spec: glyphviz repo, glyphviz-skill/references/node-csv-format.md.
// This models the minimal (authoring) dialect plus the optional tracked
// columns — not the full 94-column ANTz/GaiaViz layout. Unknown columns are
// preserved verbatim in `extras` so files round-trip without loss.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Node type ids (`type` column). Unlisted values render as plain glyphs. */
export const NodeType = {
  World: 0,
  Camera: 1,
  Glyph: 5,
  WorldGrid: 6,
  Link: 7,
} as const

/**
 * Viewport background used when a scene has no World (type 0) row — the
 * desktop's WORLD_DEFAULT_BG_RGB. A scene WITH one takes its color_r/g/b.
 */
export const WORLD_DEFAULT_BG: Readonly<Rgba> = { r: 20, g: 20, b: 31, a: 255 }

/** Topology ids (`topo` column) — how *children* of this node are placed. */
export const Topo = {
  None: 0,
  Cube: 1,
  Sphere: 2,
  Torus: 3,
  Cylinder: 4,
  Pin: 5,
  Rod: 6,
  Point: 7,
  Plane: 8,
  Zcube: 9,
  Zsphere: 10,
  Ztorus: 11,
  Zcylinder: 12,
  Zrod: 13,
  Spiral: 14,
  Video: 15,
  Plot: 16,
  Surface: 17,
} as const

export const TOPO_MAX = 17

/** Geometry ids (`geometry` column) — this node's own shape. */
export const Geometry = {
  CubeWire: 0,
  CubeSolid: 1,
  SphereWire: 2,
  SphereSolid: 3,
  ConeWire: 4,
  ConeSolid: 5,
  TorusWire: 6,
  TorusSolid: 7,
  DodecahedronWire: 8,
  DodecahedronSolid: 9,
  OctahedronWire: 10,
  OctahedronSolid: 11,
  TetrahedronWire: 12,
  TetrahedronSolid: 13,
  IcosahedronWire: 14,
  IcosahedronSolid: 15,
  // Note: Pin is solid-first, unlike the other wire/solid pairs.
  PinSolid: 16,
  PinWire: 17,
  CylinderWire: 18,
  CylinderSolid: 19,
  GridWire: 20,
  GridSolid: 21,
  Point: 22,
  Mesh: 23,
  Circle: 24,
  Cross: 25,
  Star: 26,
  Line: 27,
  TexturedPrism: 28,
} as const

export const GEOMETRY_MAX = 28

// Display names matching the desktop app's NODE_TYPE/TOPO/GEO name tables.
export const NODE_TYPE_NAMES: Record<number, string> = {
  [NodeType.World]: 'World',
  [NodeType.Camera]: 'Camera',
  [NodeType.Glyph]: 'Glyph',
  [NodeType.WorldGrid]: 'World Grid',
  [NodeType.Link]: 'Link',
}

export const TOPO_NAMES: Record<number, string> = {
  [Topo.None]: 'None',
  [Topo.Cube]: 'Cube',
  [Topo.Sphere]: 'Sphere (KML)',
  [Topo.Torus]: 'Torus',
  [Topo.Cylinder]: 'Cylinder',
  [Topo.Pin]: 'Pin',
  [Topo.Rod]: 'Rod',
  [Topo.Point]: 'Point',
  [Topo.Plane]: 'Plane (Grid)',
  [Topo.Zcube]: 'Zcube',
  [Topo.Zsphere]: 'Zsphere',
  [Topo.Ztorus]: 'Ztorus',
  [Topo.Zcylinder]: 'Zcylinder',
  [Topo.Zrod]: 'Zrod',
  [Topo.Spiral]: 'Spiral',
  [Topo.Video]: 'Video',
  [Topo.Plot]: 'Plot',
  [Topo.Surface]: 'Surface',
}

export const GEOMETRY_NAMES: Record<number, string> = {
  [Geometry.CubeWire]: 'Cube Wire',
  [Geometry.CubeSolid]: 'Cube',
  [Geometry.SphereWire]: 'Sphere Wire',
  [Geometry.SphereSolid]: 'Sphere',
  [Geometry.ConeWire]: 'Cone Wire',
  [Geometry.ConeSolid]: 'Cone',
  [Geometry.TorusWire]: 'Torus Wire',
  [Geometry.TorusSolid]: 'Torus',
  [Geometry.DodecahedronWire]: 'Dodecahedron Wire',
  [Geometry.DodecahedronSolid]: 'Dodecahedron',
  [Geometry.OctahedronWire]: 'Octahedron Wire',
  [Geometry.OctahedronSolid]: 'Octahedron',
  [Geometry.TetrahedronWire]: 'Tetrahedron Wire',
  [Geometry.TetrahedronSolid]: 'Tetrahedron',
  [Geometry.IcosahedronWire]: 'Icosahedron Wire',
  [Geometry.IcosahedronSolid]: 'Icosahedron',
  [Geometry.PinSolid]: 'Pin',
  [Geometry.PinWire]: 'Pin Wire',
  [Geometry.CylinderWire]: 'Cylinder Wire',
  [Geometry.CylinderSolid]: 'Cylinder',
  [Geometry.GridWire]: 'Grid Wire',
  [Geometry.GridSolid]: 'Grid',
  [Geometry.Point]: 'Point',
  [Geometry.Mesh]: 'Mesh (Imported)',
  [Geometry.Circle]: 'Circle',
  [Geometry.Cross]: 'Cross',
  [Geometry.Star]: 'Star',
  [Geometry.Line]: 'Line',
  [Geometry.TexturedPrism]: 'Textured Prism',
}

/** Rotation interpretation for `rotate_x/y/z` (`rotation_mode` column). */
export const RotationMode = {
  /** Euler XYZ — each field rotates about its own axis. */
  EulerXYZ: 0,
  /** ANTz Z-X-Z Heading/Tilt/Roll. Load default when the column is absent. */
  HeadingTiltRoll: 1,
} as const

/** One parsed node row. Field defaults follow the spec's load-time defaults. */
export interface GvNode {
  id: number
  type: number
  parentId: number
  branchLevel: number
  /** Position in the parent's topology coordinate system. */
  translate: Vec3
  /** Degrees, interpreted per `rotationMode`. */
  rotate: Vec3
  scale: Vec3
  /** Channels 0–255. */
  color: Rgba
  geometry: number
  /** 1 = do not render. */
  hide: number
  topo: number

  /** Geometry/topology aspect parameter (torus tube radius, point size). */
  ratio: number
  /** Cube-topology face selector, 0-indexed (facet − 1 on disk). */
  subspace: number
  /** 0 = untextured; else 1-based index into the scene media folder. */
  textureId: number
  /** GlyphViz-only: imported mesh for geometry 23. */
  meshId: number
  rotationMode: number
  colorIndex: number
  paletteId: number
  translateRate: Vec3
  rotateRate: Vec3
  scaleRate: Vec3
  /** Inline label (GlyphViz-only column). */
  text: string
  /** Inline URL/file link (GlyphViz-only column). */
  link: string
  /** World-node-only scene blend mode. */
  renderMode: number
  fogEnabled: number
  fogStart: number
  fogEnd: number

  /** Unknown columns, preserved verbatim for round-tripping. */
  extras: Record<string, string>
}

export interface GvParseIssue {
  /** 1-based line number in the CSV (line 1 is the header), if row-scoped. */
  line?: number
  /** Column name, if column-scoped. */
  column?: string
  message: string
}

export interface GvNodeParseResult {
  nodes: GvNode[]
  /** Fatal or row-skipping problems. Header errors leave `nodes` empty. */
  errors: GvParseIssue[]
  /** Recoverable oddities (clamped values, dangling parents, …). */
  warnings: GvParseIssue[]
  /**
   * True when the file has inline `text`/`link` columns. When false, the
   * caller should look for the companion gv_tag.csv file (spec: Tag
   * companion file).
   */
  hasInlineLabelColumns: boolean
}
