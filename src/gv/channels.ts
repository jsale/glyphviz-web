// Channels animation: the `gv_ch-map.csv` patch bay and `gv_ch-tracks.csv`
// time series that drive node attributes frame by frame.
//
// Authoritative spec: glyphviz repo, glyphviz-skill/references/
// channels-animation.md. Behavior ported (not code) from the desktop's
// glyphviz_core/channel_loader.py + channel_engine.py, verified 2026-07-25.
//
// Three files cooperate: a node opts in with `ch_input_id` (an extras column
// here, exactly as on the desktop, which reads it off `node.extras`); the map
// binds that channel to (track, attribute) pairs; the tracks file supplies one
// row per frame. Values are absolute — each frame REPLACES the bound
// attribute, with no interpolation between rows.
//
// This module is pure data: it mutates GvNode rows and nothing else. Pushing
// the mutated rows onto the live scene graph without a rebuild is
// src/render/dynamicNodes.ts.

import { PALETTE_COUNT, resolvePaletteColor } from './colorPalette'
import { tokenizeCsv } from './csv'
import { roundHalfToEven } from './pythonRound'
// Re-exported from its own module (see pythonRound.ts for why); most callers
// still reach it through here.
export { roundHalfToEven }
import type { GvNode, GvParseIssue, Rgba } from './types'
import {
  GEOMETRY_MAX,
  RENDER_MODE_COUNT,
  TAG_FONT_SIZE_MAX,
  TAG_FONT_SIZE_MIN,
  TOPO_MAX,
} from './types'

/**
 * Column names carrying a node's channel number.
 *
 * The desktop also checks the literal `'ch_input_id '` (trailing space) because
 * pandas hands it back untrimmed; our header parse trims, so two keys cover the
 * same files.
 */
const CH_INPUT_KEYS = ['ch_input_id', 'np_ch_in_id'] as const

export interface ChMapRow {
  trackId: number
  attribute: string
}

export interface ChMapParseResult {
  /** channel_id → its (track, attribute) bindings, in file order. */
  byChannel: Map<number, ChMapRow[]>
  rowCount: number
  errors: GvParseIssue[]
  warnings: GvParseIssue[]
}

export interface ChTracksParseResult {
  /** One row per frame; every track column has this length. */
  frameCount: number
  /** track_id → its column, frame-indexed. */
  columns: Map<number, Float64Array>
  errors: GvParseIssue[]
  warnings: GvParseIssue[]
}

/**
 * Parse a `gv_ch-map.csv`.
 *
 * Exactly three columns matter — `channel_id`, `track_id`, `attribute`. Every
 * other column (`id`, `track_table_id`, `record_id`, …) exists only for
 * GaiaViz-tool compatibility and is ignored, as on the desktop.
 */
export function parseGvChMap(text: string): ChMapParseResult {
  const errors: GvParseIssue[] = []
  const warnings: GvParseIssue[] = []
  const byChannel = new Map<number, ChMapRow[]>()

  const rows = tokenizeCsv(text)
  if (rows.length === 0) {
    errors.push({ message: 'Channel map file is empty.' })
    return { byChannel, rowCount: 0, errors, warnings }
  }

  const header = rows[0].map((h) => h.trim())
  const col = new Map(header.map((name, i) => [name, i] as const))
  const missing = ['channel_id', 'track_id', 'attribute'].filter((n) => !col.has(n))
  if (missing.length > 0) {
    errors.push({ line: 1, message: `Channel map is missing column(s): ${missing.join(', ')}.` })
    return { byChannel, rowCount: 0, errors, warnings }
  }

  let rowCount = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === '') continue
    const cell = (name: string) => (row[col.get(name)!] ?? '').trim()
    // The desktop wraps each row in try/except and simply drops the bad ones.
    const channelId = Number(cell('channel_id'))
    const trackId = Number(cell('track_id'))
    const attribute = cell('attribute')
    if (!Number.isFinite(channelId) || !Number.isFinite(trackId) || attribute === '') {
      warnings.push({ line: r + 1, message: 'Unreadable channel map row; skipped.' })
      continue
    }
    const list = byChannel.get(Math.trunc(channelId))
    const entry = { trackId: Math.trunc(trackId), attribute }
    if (list) list.push(entry)
    else byChannel.set(Math.trunc(channelId), [entry])
    rowCount++
  }

  return { byChannel, rowCount, errors, warnings }
}

/**
 * Parse a `gv_ch-tracks.csv`.
 *
 * Every column named `ch<digits>` is that track; every other column is ignored,
 * `cyclecount` included (it is a readability aid, not the clock). Each row is
 * one frame, so the row count IS the frame count. Columns need not be
 * contiguous — the number in the name is the track_id.
 *
 * Divergence, deliberate: a blank or unreadable cell HOLDS the previous frame's
 * value rather than becoming NaN. Pandas yields NaN there, which the desktop
 * writes straight into the attribute — a NaN translate removes the glyph from
 * the scene permanently. Holding is what the spec's authoring rule asks for
 * ("carry a value forward through gaps in the source data") and cannot make a
 * well-formed file behave differently.
 */
export function parseGvChTracks(text: string): ChTracksParseResult {
  const errors: GvParseIssue[] = []
  const warnings: GvParseIssue[] = []
  const columns = new Map<number, Float64Array>()

  const rows = tokenizeCsv(text)
  if (rows.length === 0) {
    errors.push({ message: 'Channel tracks file is empty.' })
    return { frameCount: 0, columns, errors, warnings }
  }

  const header = rows[0].map((h) => h.trim())
  const trackCols: Array<{ trackId: number; index: number }> = []
  for (let i = 0; i < header.length; i++) {
    const match = /^ch(\d+)$/.exec(header[i])
    if (match) trackCols.push({ trackId: Number(match[1]), index: i })
  }
  if (trackCols.length === 0) {
    errors.push({ line: 1, message: 'Channel tracks file has no ch<n> track columns.' })
    return { frameCount: 0, columns, errors, warnings }
  }

  // Data rows only; a trailing blank line is not a frame.
  const dataRows: string[][] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === '') continue
    dataRows.push(row)
  }
  const frameCount = dataRows.length

  let held = 0
  for (const { trackId, index } of trackCols) {
    if (columns.has(trackId)) {
      warnings.push({ line: 1, column: `ch${trackId}`, message: `Duplicate track column; first wins.` })
      continue
    }
    const column = new Float64Array(frameCount)
    let previous = 0
    for (let f = 0; f < frameCount; f++) {
      const raw = (dataRows[f][index] ?? '').trim()
      const value = raw === '' ? NaN : Number(raw)
      if (Number.isFinite(value)) {
        previous = value
      } else {
        held++
      }
      column[f] = previous
    }
    columns.set(trackId, column)
  }
  if (held > 0) {
    warnings.push({
      message: `${held} blank or unreadable track cell(s); each held the previous frame's value.`,
    })
  }

  return { frameCount, columns, errors, warnings }
}

/**
 * `<stem>node.csv` → its conventional Channels companions.
 *
 * Only a naming convention (the desktop discovers companions by scanning the
 * folder for `ch-map` / `ch-track` in any filename), so this is for the one
 * case with no folder to scan: a `?csv=<url>` load, where the sibling names can
 * only be guessed. Returns null when the name does not follow the convention.
 */
export function deriveChannelFilenames(
  nodeFilename: string,
): { map: string; tracks: string } | null {
  const dot = nodeFilename.lastIndexOf('.')
  const stem = dot === -1 ? nodeFilename : nodeFilename.slice(0, dot)
  const ext = dot === -1 ? '.csv' : nodeFilename.slice(dot)
  if (!stem.endsWith('node')) return null
  const base = stem.slice(0, stem.length - 'node'.length)
  return { map: `${base}ch-map${ext}`, tracks: `${base}ch-tracks${ext}` }
}

// --- Binding + playback --------------------------------------------------------

type Axis = 'x' | 'y' | 'z'

/**
 * How one bindable attribute is read and written on a node — the web spelling
 * of the desktop's `_ATTR_TO_FIELD` + `_INT_FIELDS` + `_FIELD_RANGE` tables
 * (channel_engine.py). `int` fields are rounded half-to-EVEN (Python's round,
 * which the desktop applies to every integer field) and then clamped to their
 * own valid range, so an out-of-range track value can never index off the end
 * of a palette or geometry table at draw time. Float fields are applied
 * exactly as written, negatives included — a track feeding translate_x or
 * fog_end means exactly what it says.
 */
interface AttributeSpec {
  read: (node: GvNode) => number
  write: (node: GvNode, value: number) => void
  int?: { min: number; max: number }
}

const vecSpec = (
  group: keyof Pick<
    GvNode,
    'translate' | 'rotate' | 'scale' | 'translateRate' | 'rotateRate' | 'scaleRate'
  >,
  axis: Axis,
): AttributeSpec => ({
  read: (n) => n[group][axis],
  write: (n, v) => {
    n[group][axis] = v
  },
})

const colorSpec = (channel: keyof Rgba): AttributeSpec => ({
  read: (n) => n.color[channel],
  write: (n, v) => {
    n.color[channel] = v
  },
  int: { min: 0, max: 255 },
})

/** An id that only has a floor — the desktop's `_NONNEGATIVE`. */
const NONNEGATIVE = { min: 0, max: Infinity }
/** Flags: any positive track value reads as "on". */
const FLAG = { min: 0, max: 1 }

/**
 * The complete bindable set — 36 attributes, matching desktop `77d6361` plus
 * `topo_scale` (desktop `55928c0`) and `tag_font_size` (desktop `aadae11`).
 * Anything else in a ch-map is silently skipped (and counted, below).
 *
 * render_mode / fog_* / tag_font_size are scene-wide settings read only off
 * the World row
 * (type 0) — binding them means giving that row a ch_input_id like any other
 * node; on any other node they are inert stores. The World row's own
 * color_r/g/b is the scene background, so it animates through the ordinary
 * color binding.
 */
const ATTRIBUTES: Record<string, AttributeSpec> = {
  translate_x: vecSpec('translate', 'x'),
  translate_y: vecSpec('translate', 'y'),
  translate_z: vecSpec('translate', 'z'),
  rotate_x: vecSpec('rotate', 'x'),
  rotate_y: vecSpec('rotate', 'y'),
  rotate_z: vecSpec('rotate', 'z'),
  scale_x: vecSpec('scale', 'x'),
  scale_y: vecSpec('scale', 'y'),
  scale_z: vecSpec('scale', 'z'),
  translate_rate_x: vecSpec('translateRate', 'x'),
  translate_rate_y: vecSpec('translateRate', 'y'),
  translate_rate_z: vecSpec('translateRate', 'z'),
  rotate_rate_x: vecSpec('rotateRate', 'x'),
  rotate_rate_y: vecSpec('rotateRate', 'y'),
  rotate_rate_z: vecSpec('rotateRate', 'z'),
  scale_rate_x: vecSpec('scaleRate', 'x'),
  scale_rate_y: vecSpec('scaleRate', 'y'),
  scale_rate_z: vecSpec('scaleRate', 'z'),
  color_r: colorSpec('r'),
  color_g: colorSpec('g'),
  color_b: colorSpec('b'),
  color_a: colorSpec('a'),
  texture_id: {
    read: (n) => n.textureId,
    write: (n, v) => {
      n.textureId = v
    },
    int: NONNEGATIVE,
  },
  // --- shape ---
  ratio: {
    read: (n) => n.ratio,
    write: (n, v) => {
      n.ratio = v
    },
  },
  topo: {
    read: (n) => n.topo,
    write: (n, v) => {
      n.topo = v
    },
    int: { min: 0, max: TOPO_MAX },
  },
  // A parent's topo_scale sets how far its children's distance-valued
  // translate axes reach. Animating it alongside `topo` is what lets a scene
  // hold its children in frame across a switch between an angular and a linear
  // topology, instead of flinging them ~180x further out on the frame the
  // topology changes.
  topo_scale: {
    read: (n) => n.topoScale,
    write: (n, v) => {
      n.topoScale = v
    },
  },
  geometry: {
    read: (n) => n.geometry,
    write: (n, v) => {
      n.geometry = v
    },
    int: { min: 0, max: GEOMETRY_MAX },
  },
  mesh_id: {
    read: (n) => n.meshId,
    write: (n, v) => {
      n.meshId = v
    },
    int: NONNEGATIVE,
  },
  // --- palette color (resolved to color_r/g/b each frame, see applyChannelFrame) ---
  palette_id: {
    read: (n) => n.paletteId,
    write: (n, v) => {
      n.paletteId = v
    },
    int: { min: 0, max: PALETTE_COUNT - 1 },
  },
  color_index: {
    read: (n) => n.colorIndex,
    write: (n, v) => {
      n.colorIndex = v
    },
    int: NONNEGATIVE,
  },
  // --- visibility ---
  hide: {
    read: (n) => n.hide,
    write: (n, v) => {
      n.hide = v
    },
    int: FLAG,
  },
  show_text: {
    read: (n) => n.showText,
    write: (n, v) => {
      n.showText = v
    },
    int: FLAG,
  },
  // --- World row (type 0) scene settings ---
  render_mode: {
    read: (n) => n.renderMode,
    write: (n, v) => {
      n.renderMode = v
    },
    int: { min: 0, max: RENDER_MODE_COUNT - 1 },
  },
  fog_enabled: {
    read: (n) => n.fogEnabled,
    write: (n, v) => {
      n.fogEnabled = v
    },
    int: FLAG,
  },
  fog_start: {
    read: (n) => n.fogStart,
    write: (n, v) => {
      n.fogStart = v
    },
  },
  fog_end: {
    read: (n) => n.fogEnd,
    write: (n, v) => {
      n.fogEnd = v
    },
  },
  tag_font_size: {
    read: (n) => n.tagFontSize,
    write: (n, v) => {
      n.tagFontSize = v
    },
    // Point sizes are whole numbers, and the clamp is the same range the
    // slider offers — the overlay clamps again on the way to the paint, so a
    // hand-edited CSV cannot draw at a size no slider position reproduces.
    int: { min: TAG_FONT_SIZE_MIN, max: TAG_FONT_SIZE_MAX },
  },
}

/**
 * Attributes that can move or reshape geometry — the desktop's
 * `_TRANSFORM_FIELDS`. The four shape/coordinate fields are here because they
 * re-place a node's CHILDREN: `ratio` is the child placement radius on
 * Torus/Ztorus, `topo` IS the child-placement rule, `topo_scale` sizes that
 * rule's distance-valued axes, and on a World Grid `geometry` is what switches
 * children between globe and flat-window placement. Everything else changes
 * what is drawn but never where anything sits.
 */
const TRANSFORM_ATTRIBUTES = new Set([
  'translate_x', 'translate_y', 'translate_z',
  'rotate_x', 'rotate_y', 'rotate_z',
  'scale_x', 'scale_y', 'scale_z',
  'translate_rate_x', 'translate_rate_y', 'translate_rate_z',
  'rotate_rate_x', 'rotate_rate_y', 'rotate_rate_z',
  'scale_rate_x', 'scale_rate_y', 'scale_rate_z',
  'ratio', 'topo', 'topo_scale', 'geometry',
])

/** Attributes whose change means the node's GLYPH must be rebuilt (its shape,
 *  not just its material): the geometry id itself, the mesh it names, the
 *  torus/point aspect, and the node's own topo (Rod draw factors). */
const SHAPE_ATTRIBUTES = new Set(['ratio', 'topo', 'geometry', 'mesh_id'])
/** Attributes that re-place the node's children. Every shape field here does
 *  it as a side effect of changing the node itself; `topo_scale` does nothing
 *  BUT this, which is why it is absent from the shape set above. */
const PLACEMENT_ATTRIBUTES = new Set(['ratio', 'topo', 'topo_scale', 'geometry'])
/** Attributes the material fast path serves (colour, texture, palette). */
const APPEARANCE_ATTRIBUTES = new Set([
  'color_r', 'color_g', 'color_b', 'color_a',
  'texture_id', 'palette_id', 'color_index',
])
/** Binding either of these resolves the palette into color_r/g/b each frame. */
const PALETTE_ATTRIBUTES = new Set(['palette_id', 'color_index'])

/**
 * One (node, attribute) ← track binding. The spec is one shared object per
 * attribute name, so applying a frame is one call and a property store — this
 * loop runs over every binding at up to 60 Hz.
 *
 * The invariant that buys: node.translate/rotate/scale/color are MUTATED in
 * place, never reassigned. Everything that edits a node (the inspector, multi-
 * edit, gizmo drags, selectionOps) already works that way; only createNode
 * replaces one, and a brand-new node has no ch_input_id to bind. Reassigning
 * one on a bound node would leave its channel writing to a detached object.
 */
interface Binding {
  node: GvNode
  attribute: string
  column: Float64Array
  spec: AttributeSpec
}

export interface ChannelAnimation {
  frameCount: number
  bindings: Binding[]
  /** Every node with at least one binding. */
  boundNodeIds: Set<number>
  /** Bindings that can move or reshape geometry — translate/rotate/scale and
   *  their rates (a rate binding makes the integrator move the node each
   *  tick), plus the shape fields ratio/topo/geometry, which re-place the
   *  node's children (desktop `_TRANSFORM_FIELDS`). */
  transformBoundNodeIds: Set<number>
  /** Bindings that change draw content but never the transform. */
  appearanceBoundNodeIds: Set<number>
  /** Nodes whose scale can change, so their glyph's draw-scale floor must be
   *  re-derived (and their descendants' with it). */
  scaleBoundNodeIds: Set<number>
  /** Nodes whose rates a channel drives — rate integration candidates. */
  rateBoundNodeIds: Set<number>
  /** Nodes whose glyph SHAPE can change (geometry / mesh_id / ratio / topo) —
   *  the render fast path rebuilds their glyph object when the value does. */
  shapeBoundNodeIds: Set<number>
  /** Nodes whose ratio/topo/geometry can change — their CHILDREN's placement
   *  reads those fields, so the fast path re-places each child every tick. */
  placementBoundNodeIds: Set<number>
  /** Nodes whose `hide` flag a channel drives. Their glyph is built even when
   *  the CSV hides them, and visibility is toggled per frame. */
  hideBoundNodeIds: Set<number>
  /** Nodes whose `show_text` pin a channel drives — the label overlay's
   *  pinned list must follow the live value, not the load-time scan. */
  showTextBoundNodeIds: Set<number>
  /** Nodes whose colour resolves through (palette_id, color_index) each frame
   *  — the desktop's `_palette_nodes`. Deduplicated, in binding order. */
  paletteNodes: GvNode[]
  /** Every texture_id a `texture_id` track can produce, for media preloading:
   *  a flip-book scene's CSV texture_id is often 0, so nothing else names them. */
  textureIds: Set<number>
  /** node id → field → value at bind time, for Stop. */
  originals: Map<number, Map<string, number>>
  warnings: string[]
}

export function emptyChannelAnimation(): ChannelAnimation {
  return {
    frameCount: 0,
    bindings: [],
    boundNodeIds: new Set(),
    transformBoundNodeIds: new Set(),
    appearanceBoundNodeIds: new Set(),
    scaleBoundNodeIds: new Set(),
    rateBoundNodeIds: new Set(),
    shapeBoundNodeIds: new Set(),
    placementBoundNodeIds: new Set(),
    hideBoundNodeIds: new Set(),
    showTextBoundNodeIds: new Set(),
    paletteNodes: [],
    textureIds: new Set(),
    originals: new Map(),
    warnings: [],
  }
}

/** A node's channel number, 0 when it does not opt in. */
export function channelInputId(node: GvNode): number {
  for (const key of CH_INPUT_KEYS) {
    const raw = node.extras[key]
    if (raw === undefined) continue
    // Desktop: int(float(raw)) — "1.0" is channel 1; an unparseable cell is 0.
    const value = Number(raw.trim())
    return Number.isFinite(value) ? Math.trunc(value) : 0
  }
  return 0
}

/**
 * Point `node` at ch-map channel `chId` (0 = not animated) — the write half of
 * `channelInputId`, and the whole of what the Properties panel's "channel in"
 * row does to the data (desktop `set_channel_id`).
 *
 * Writes back through whichever of CH_INPUT_KEYS the node already carries
 * rather than always adding `ch_input_id`: the read above takes the FIRST key
 * present, so a GaiaViz-dialect row spelling it `np_ch_in_id` would otherwise
 * end up with two columns that disagree — and its file would grow a column it
 * never had.
 *
 * 0 is written, never deleted: an explicit 0 is what the format carries for an
 * unbound node, and the reader already treats a missing key as 0 anyway.
 */
export function setChannelInputId(node: GvNode, chId: number): void {
  // extras are the file's own text, preserved verbatim by the writer.
  const value = String(Math.trunc(chId))
  for (const key of CH_INPUT_KEYS) {
    if (node.extras[key] !== undefined) {
      node.extras[key] = value
      return
    }
  }
  node.extras['ch_input_id'] = value
}

/**
 * The attribute names channel `chId` actually drives, in ch-map order with
 * duplicates collapsed (desktop `channel_attrs`).
 *
 * Filtered to attributes this app can bind — the same filter `bindChannels`
 * applies — so this answers "what will happen if I point a node at this
 * channel", not merely "what does the file say".
 */
export function channelAttributes(map: ChMapParseResult, chId: number): string[] {
  const seen: string[] = []
  for (const { attribute } of map.byChannel.get(chId) ?? []) {
    if (ATTRIBUTES[attribute] && !seen.includes(attribute)) seen.push(attribute)
  }
  return seen
}

/**
 * Resolve the three-way join (node.ch_input_id → map channel_id → track column)
 * into a flat binding list.
 *
 * The desktop drops every unmatched piece in silence. Here each kind is counted
 * and reported once: a scene whose Channels quietly do nothing is the most
 * common authoring mistake the spec warns about, and it is invisible otherwise.
 */
export function bindChannels(
  map: ChMapParseResult,
  tracks: ChTracksParseResult,
  nodes: readonly GvNode[],
): ChannelAnimation {
  const anim = emptyChannelAnimation()
  anim.frameCount = tracks.frameCount

  const nodesByChannel = new Map<number, GvNode[]>()
  for (const node of nodes) {
    const channel = channelInputId(node)
    if (channel === 0) continue
    const list = nodesByChannel.get(channel)
    if (list) list.push(node)
    else nodesByChannel.set(channel, [node])
  }

  const unknownAttributes = new Set<string>()
  const missingTracks = new Set<number>()
  const paletteIds = new Set<number>()
  let channelsWithoutNodes = 0

  for (const [channelId, rows] of map.byChannel) {
    const channelNodes = nodesByChannel.get(channelId)
    if (!channelNodes) {
      channelsWithoutNodes++
      continue
    }
    for (const node of channelNodes) {
      for (const { trackId, attribute } of rows) {
        const column = tracks.columns.get(trackId)
        if (!column) {
          missingTracks.add(trackId)
          continue
        }
        const spec = ATTRIBUTES[attribute]
        if (!spec) {
          unknownAttributes.add(attribute)
          continue
        }
        // First binding of a field wins the original, matching the desktop's
        // `originals.setdefault(field, getattr(node, field))`.
        let fields = anim.originals.get(node.id)
        if (!fields) {
          fields = new Map()
          anim.originals.set(node.id, fields)
        }
        if (!fields.has(attribute)) fields.set(attribute, spec.read(node))

        anim.bindings.push({ node, attribute, column, spec })
        anim.boundNodeIds.add(node.id)
        classify(anim, node.id, attribute)
        if (attribute === 'texture_id') collectTextureIds(anim.textureIds, column)
        if (PALETTE_ATTRIBUTES.has(attribute) && !paletteIds.has(node.id)) {
          paletteIds.add(node.id)
          anim.paletteNodes.push(node)
          // Palette resolution overwrites color_r/g/b even though nothing
          // bound them directly — snapshot them too so Stop can put the node
          // back (the desktop's own load-time rule).
          for (const out of ['color_r', 'color_g', 'color_b']) {
            if (!fields.has(out)) fields.set(out, ATTRIBUTES[out].read(node))
          }
        }
      }
    }
  }

  const channelsWithoutMap = [...nodesByChannel.keys()].filter(
    (id) => !map.byChannel.has(id),
  ).length
  if (unknownAttributes.size > 0) {
    anim.warnings.push(
      `Channel map binds ${unknownAttributes.size} unsupported attribute(s), ignored: ` +
        `${[...unknownAttributes].sort().join(', ')}.`,
    )
  }
  if (missingTracks.size > 0) {
    anim.warnings.push(
      `Channel map references track(s) with no ch<n> column: ` +
        `${[...missingTracks].sort((a, b) => a - b).join(', ')}.`,
    )
  }
  if (channelsWithoutNodes > 0) {
    anim.warnings.push(`${channelsWithoutNodes} mapped channel(s) drive no node's ch_input_id.`)
  }
  if (channelsWithoutMap > 0) {
    anim.warnings.push(`${channelsWithoutMap} node ch_input_id value(s) have no channel map row.`)
  }
  return anim
}

function classify(anim: ChannelAnimation, nodeId: number, attribute: string): void {
  if (TRANSFORM_ATTRIBUTES.has(attribute)) anim.transformBoundNodeIds.add(nodeId)
  if (APPEARANCE_ATTRIBUTES.has(attribute)) anim.appearanceBoundNodeIds.add(nodeId)
  if (SHAPE_ATTRIBUTES.has(attribute)) anim.shapeBoundNodeIds.add(nodeId)
  if (PLACEMENT_ATTRIBUTES.has(attribute)) anim.placementBoundNodeIds.add(nodeId)
  if (attribute === 'hide') anim.hideBoundNodeIds.add(nodeId)
  if (attribute === 'show_text') anim.showTextBoundNodeIds.add(nodeId)
  if (attribute.startsWith('scale')) anim.scaleBoundNodeIds.add(nodeId)
  if (attribute.includes('_rate_')) anim.rateBoundNodeIds.add(nodeId)
}

function collectTextureIds(into: Set<number>, column: Float64Array): void {
  for (let f = 0; f < column.length; f++) {
    const id = Math.max(0, roundHalfToEven(column[f]))
    if (id > 0) into.add(id)
  }
}


/**
 * Write frame `frame`'s value into every bound attribute.
 *
 * Absolute, not additive; no interpolation between frames (the spec is explicit
 * — author enough frames for smooth motion). Integer attributes round
 * half-to-even and clamp to their own valid range; floats apply exactly as
 * written.
 *
 * Palette resolution runs LAST, after every binding for the frame — so a
 * channel driving both palette fields sees a consistent pair, and a node that
 * binds BOTH color_index and color_r/g/b resolves from the palette (the direct
 * RGB binding is overwritten). color_a is never touched, matching ANTz palette
 * semantics. This is the one place palette resolution happens automatically
 * rather than on a =/−/Alt+= keypress.
 */
export function applyChannelFrame(anim: ChannelAnimation, frame: number): void {
  if (anim.frameCount === 0 || anim.bindings.length === 0) return
  const f = Math.max(0, Math.min(frame, anim.frameCount - 1))
  for (const binding of anim.bindings) {
    let value = binding.column[f]
    const int = binding.spec.int
    if (int) {
      value = roundHalfToEven(value)
      if (value < int.min) value = int.min
      else if (value > int.max) value = int.max
    }
    binding.spec.write(binding.node, value)
  }
  for (const node of anim.paletteNodes) {
    const rgb = resolvePaletteColor(node.paletteId, node.colorIndex)
    node.color.r = rgb.r
    node.color.g = rgb.g
    node.color.b = rgb.b
  }
}

/**
 * Stop: restore every bound attribute to what it held when the scene loaded —
 * including the color_r/g/b a palette binding resolved into, which nothing
 * bound directly (they were snapshotted at bind time for exactly this).
 *
 * Rates are restored (normally to 0, stopping the motion) but the position,
 * rotation and scale their integration accumulated deliberately are NOT — they
 * stay where the animation left them, matching the desktop and how hand-
 * authored ANTz rate fields behave on load.
 */
export function resetChannels(anim: ChannelAnimation): void {
  const seen = new Set<number>()
  for (const binding of anim.bindings) {
    const node = binding.node
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const fields = anim.originals.get(node.id)
    if (!fields) continue
    for (const [attribute, value] of fields) {
      ATTRIBUTES[attribute]?.write(node, value)
    }
  }
}
