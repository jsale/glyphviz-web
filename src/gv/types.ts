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
 * Point size of tag label text, read off the World row like the colours above.
 * Labels were painted at a hardcoded 9 pt until 2026-08-18, which read a
 * little small at a normal working camera distance; 11 pt is that same look
 * two points up, and a file with no `tag_font_size` column loads as this
 * value, so every existing scene simply gets the larger default.
 *
 * The range is what the slider offers and what a Channels track bound to this
 * attribute clamps to: below ~6 pt antialiased text stops resolving, and past
 * ~36 pt a handful of labels cover the scene they annotate.
 */
export const TAG_DEFAULT_FONT_SIZE = 11
export const TAG_FONT_SIZE_MIN = 6
export const TAG_FONT_SIZE_MAX = 36

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
  PointCloud: 18,
} as const

export const TOPO_MAX = 18

/**
 * `topo_scale` landmarks (the field's own doc is on GvNode.topoScale below).
 * A translate axis a topology reads as a DISTANCE is multiplied by the
 * PARENT's value; an axis it reads as an ANGLE never is.
 *
 * 1.0 — a translate unit is a world unit. GlyphViz's behaviour since its first
 *   commit, so it is also what a CSV missing the column loads as: every file
 *   written before the field existed places exactly as it always has.
 * 1/180 — ANTz's convention, in which a topology's linear axes span the
 *   parent's own extent: translate ±180 reaches the edge of a cube facet, the
 *   same way ±180 of longitude wraps a sphere. This is the value at which
 *   switching a parent between an angular and a linear topology leaves its
 *   children roughly where they were, which is the whole point of the field.
 *   Rod already hardcodes this convention for its length parameter (see
 *   topoOffset), and a globe World Grid's GRID_GLOBE_RADIUS is the same
 *   180/π correspondence seen from the other side.
 */
export const DEFAULT_TOPO_SCALE = 1.0
export const TOPO_SCALE_ANTZ = 1.0 / 180.0

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
  /**
   * GlyphViz extensions (no ANTz/GaiaViz equivalent), desktop 2ba3c4c: the
   * three shapes that enclose a volume, drawn INSIDE-OUT so a texture or video
   * can be viewed from within — a 360° video sphere, a cylindrical panorama, a
   * video room. See src/gv/interiorGeometry.ts for why the mode rides in
   * `geometry` rather than in a flag of its own.
   */
  CubeInterior: 29,
  SphereInterior: 30,
  CylinderInterior: 31,
  CylinderInteriorOpen: 32,
  /**
   * GlyphViz extension (no ANTz/GaiaViz equivalent), desktop 721b827: a torus
   * whose cross-section is a RECTANGLE rather than a circle — a flat machined
   * band, the kind of ring an armillary sphere, an astrolabe or a graduated
   * dial is built from. Four real faces with crisp edges, where a torus reads
   * as soft tubing with its highlight sliding round the tube; and only a flat
   * face holds a legible texture (degree markings, a zodiac strip, a scale).
   *
   * Its two proportions come from fields that already exist, so there is no new
   * column and every existing control works on it unchanged: `ratio` is the
   * band's RADIAL width and `scale_z` its height. See `ringDims` in
   * src/render/glyphGeometry.ts for why that is the torus's own meaning of
   * `ratio` rather than a second one.
   */
  Ring: 33,
  RingWire: 34,
} as const

/**
 * Highest valid geometry id. NOTE the desktop counts the other way — its
 * `GEO_COUNT` is the COUNT (35), this is the MAX (34) — so the two numbers
 * never match and neither is wrong.
 */
export const GEOMETRY_MAX = 34

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
  [Topo.PointCloud]: 'Point Cloud',
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
  [Geometry.CubeInterior]: 'Cube (Interior)',
  [Geometry.SphereInterior]: 'Sphere (Interior)',
  [Geometry.CylinderInterior]: 'Cylinder (Interior)',
  [Geometry.CylinderInteriorOpen]: 'Cylinder (Interior, Open)',
  [Geometry.Ring]: 'Flat Ring',
  [Geometry.RingWire]: 'Flat Ring Wire',
}

/**
 * Number of scene blend modes the World row's `render_mode` can name (ids
 * 0–6; the state table lives in src/render/renderMode.ts). A data-model fact
 * — the desktop keeps its RENDER_MODE_COUNT on the Node dataclass — so the
 * channel engine can clamp an animated render_mode without importing the
 * renderer.
 */
export const RENDER_MODE_COUNT = 7

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
  /**
   * How far one unit of a CHILD's translate reaches, for the axes this node's
   * topology reads as a DISTANCE rather than an angle (a Cube facet's two
   * axes, Pin/Cylinder height, altitude above a Sphere, all three axes of a
   * plain Cartesian topology — see LINEAR_PLACEMENT_AXES in
   * src/render/topology.ts). Angular axes (longitude/latitude, orbital and
   * tube angles) and terms already proportional to the parent's base radius
   * (Rod's length parameter, Spiral's helical rise) are never scaled, so no
   * value here can distort a circular layout.
   *
   * Lives on the PARENT because it is the parent's coordinate system being
   * described — the same reason `topo` and `ratio` do. DEFAULT_TOPO_SCALE
   * (1.0) is both the code default and what a CSV without the column loads as.
   */
  topoScale: number
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
  /** World-node-only: point size of every tag label in the scene. */
  tagFontSize: number
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
