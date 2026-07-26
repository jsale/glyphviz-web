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

/** An opaque colour: the tag-text styling and the viewport background. */
export interface Rgb {
  r: number
  g: number
  b: number
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

/**
 * Tag-text styling, read from the World (type 0) row only — like the
 * background, these are scene data rather than viewer preferences, so they
 * save and round-trip. UNIFORM paints every label the World row's
 * `tag_color_r/g/b`; NODE paints each label its own node's colour, so a label
 * reads as belonging to the thing it names.
 */
export const TagColorMode = {
  Uniform: 0,
  Node: 1,
} as const

/**
 * Pale yellow — the colour tag text was hardcoded to before it became
 * settable, so a scene with no World row (or an older file) looks unchanged.
 */
export const TAG_DEFAULT_TEXT_RGB: Readonly<Rgb> = { r: 255, g: 255, b: 200 }
/** Face-pass alpha, fixed on both sides (QColor(..., 230)). */
export const TAG_TEXT_ALPHA = 230
/**
 * The dark drop shadow behind tag text is deliberately NOT settable: it is
 * what keeps a label legible against both bright glyphs and bright
 * backgrounds, whatever colour the text itself takes.
 */
export const TAG_SHADOW_RGBA: Readonly<Rgba> = { r: 0, g: 0, b: 0, a: 200 }

/**
 * Colour of the procedural reference grid drawn under a scene that has no
 * World Grid node — the desktop's REF_GRID_DEFAULT_RGB. Like the background it
 * is read from the World (type 0) row (`ref_grid_color_r/g/b`), so it is scene
 * data that saves and round-trips rather than a viewer preference. A real
 * World Grid node paints its own lattice from its own colour and ignores this.
 */
export const REF_GRID_DEFAULT_RGB: Readonly<Rgb> = { r: 56, g: 56, b: 71 }

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
  /**
   * 1 = pin this node's label on screen whatever the scene-wide tag settings
   * say (the inspector's "Always Show Text"), and exempt it from the all-tags
   * frame cap. The node's own hide flag still hides it.
   */
  showText: number
  /** World-node-only scene blend mode. */
  renderMode: number
  fogEnabled: number
  fogStart: number
  fogEnd: number
  /** World-node-only: TagColorMode — one colour for every label, or each node's own. */
  tagColorMode: number
  /** World-node-only: the label colour used under TagColorMode.Uniform. */
  tagColor: Rgb
  /** World-node-only: the procedural backdrop grid's colour. */
  refGridColor: Rgb

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
