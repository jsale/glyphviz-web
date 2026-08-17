// The Channels companions a Save Selection write carries along — a port of the
// desktop's channel_loader.export_channel_subset.
//
// A fragment of an animated scene keeps its animation only if the channel files
// travel with it, and copying them whole would drag along tracks for thousands
// of nodes that did not come.
//
// Filtering happens at the FILE level rather than through parseGvChMap /
// parseGvChTracks, so any column those parsers ignore (`id`, `track_table_id`,
// `record_id`, `cyclecount`, timestamps…) still round-trips. Channel and track
// ids keep their original values, matching the node export's preserved node ids
// — nothing is renumbered, so a `chN` column still means track N.
//
// Returns null when nothing matches, which writes no files at all: an empty
// ch-map would still be discovered as this scene's companion and would shadow
// the real one if both sat in a folder together.

import { tokenizeCsv } from './csv'
import { channelInputId } from './channels'
import type { GvNode } from './types'

export interface ChannelSubset {
  mapText: string
  tracksText: string
  /** Distinct channel_ids written. */
  channels: number
  /** Distinct track columns kept. */
  tracks: number
}

/**
 * Every channel id referenced by `nodes` — what a partial scene export has to
 * carry along to keep its animation (the desktop's `channel_ids_for_nodes`).
 */
export function channelIdsForNodes(nodes: readonly GvNode[]): Set<number> {
  const out = new Set<number>()
  for (const n of nodes) {
    const id = channelInputId(n)
    if (id) out.add(id)
  }
  return out
}

const CRLF = '\r\n'

/** RFC 4180 quoting: only when the field needs it, as writeGvNodeCsv does. */
function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function emit(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(escapeField).join(',')).join(CRLF) + CRLF
}

/** True for a track column name — `ch` followed by digits and nothing else. */
function trackColumnId(name: string): number | null {
  const m = /^ch(\d+)$/.exec(name.trim())
  return m ? Number(m[1]) : null
}

/**
 * The ch-map / ch-tracks pair covering `channelIds` only, or null when the
 * selection is bound to none of the scene's channels.
 */
export function exportChannelSubset(
  mapText: string,
  tracksText: string,
  channelIds: ReadonlySet<number>,
): ChannelSubset | null {
  const mapRows = tokenizeCsv(mapText)
  if (mapRows.length < 2) return null
  const mapHeader = mapRows[0].map((h) => h.trim())
  const channelCol = mapHeader.indexOf('channel_id')
  const trackCol = mapHeader.indexOf('track_id')
  if (channelCol < 0 || trackCol < 0) return null

  const keptMap: string[][] = [mapRows[0]]
  const keptChannels = new Set<number>()
  const trackIds = new Set<number>()
  for (let r = 1; r < mapRows.length; r++) {
    const row = mapRows[r]
    if (row.length === 1 && row[0].trim() === '') continue
    const channelId = Number((row[channelCol] ?? '').trim())
    const trackId = Number((row[trackCol] ?? '').trim())
    if (!Number.isFinite(channelId) || !channelIds.has(Math.trunc(channelId))) continue
    keptMap.push(row)
    keptChannels.add(Math.trunc(channelId))
    if (Number.isFinite(trackId)) trackIds.add(Math.trunc(trackId))
  }
  if (keptMap.length < 2 || trackIds.size === 0) return null

  const trackRows = tokenizeCsv(tracksText)
  if (trackRows.length === 0) return null
  const trackHeader = trackRows[0]
  // Everything that is not a chN track column (cyclecount, timestamps, …) is
  // scene-level and stays.
  const keepCols: number[] = []
  for (let i = 0; i < trackHeader.length; i++) {
    const id = trackColumnId(trackHeader[i])
    if (id === null || trackIds.has(id)) keepCols.push(i)
  }
  const keptTracks = trackRows
    .filter((row, i) => i === 0 || !(row.length === 1 && row[0].trim() === ''))
    .map((row) => keepCols.map((i) => row[i] ?? ''))

  return {
    mapText: emit(keptMap),
    tracksText: emit(keptTracks),
    channels: keptChannels.size,
    tracks: trackIds.size,
  }
}
