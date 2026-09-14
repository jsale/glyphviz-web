// Parity: this app's mergeNodes against desktop GlyphViz's merge_nodes.
//
// tools/dump_scene_merges.py loads each case's files with the desktop's REAL
// load_node_csv (companion tag file included) and runs its REAL merge_nodes.
// Here the same files go through this app's parser + applyTags and mergeNodes,
// and every counter, the id map and each merged row's id-bearing and
// positional fields are diffed.
//
// The one deliberate divergence — a link whose A-end did not survive is
// dropped here and re-rooted there — is applied to the DESKTOP side by the
// exact list the dump records, so it cannot quietly widen into anything else.

import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from './nodeCsv'
import { mergeNodes } from './sceneMerge'
import type { MergeResult } from './sceneMerge'
import { applyTags, parseGvTagCsv } from './tagCsv'
import type { GvNode } from './types'
import dump from './fixtures/merge/scene_merges.json'
import guestCsv from './fixtures/merge/merge_guest_gv_node.csv?raw'
import plotSurfaceCsv from './fixtures/plot_surface_example_gv_node.csv?raw'
import pointCloudCsv from './fixtures/point_cloud_gv_node.csv?raw'
import selectionCsv from './fixtures/selection_export_gv_node.csv?raw'
import topoScaleCsv from './fixtures/topo_scale_gv_node.csv?raw'
import topologyCsv from './fixtures/topology_example_gv_node.csv?raw'
import topologyTagCsv from './fixtures/topology_example_gv_tag.csv?raw'
import worldGridCsv from './fixtures/world_grid_example_gv_node.csv?raw'

const SOURCES: Record<string, { node: string; tag?: string }> = {
  topology: { node: topologyCsv, tag: topologyTagCsv },
  world_grid: { node: worldGridCsv },
  selection: { node: selectionCsv },
  topo_scale: { node: topoScaleCsv },
  point_cloud: { node: pointCloudCsv },
  plot_surface: { node: plotSurfaceCsv },
  guest: { node: guestCsv },
}

/** Load a fixture the way the app does: inline labels win, else the tag file. */
function load(key: string): GvNode[] {
  const source = SOURCES[key]
  const parsed = parseGvNodeCsv(source.node)
  expect(parsed.errors).toEqual([])
  if (!parsed.hasInlineLabelColumns && source.tag !== undefined) {
    applyTags(parsed.nodes, parseGvTagCsv(source.tag).byRecordId)
  }
  return parsed.nodes
}

function extraInt(node: GvNode, key: string): number | null {
  const raw = node.extras[key]
  if (raw === undefined || raw.trim() === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? Math.trunc(v) : null
}

function row(n: GvNode) {
  return {
    id: n.id,
    type: n.type,
    parent_id: n.parentId,
    branch_level: n.branchLevel,
    translate: [n.translate.x, n.translate.y, n.translate.z],
    texture_id: n.textureId,
    text: n.text,
    link: n.link,
    child_id: extraInt(n, 'child_id'),
    record_id: extraInt(n, 'record_id'),
    ch_input_id: extraInt(n, 'ch_input_id'),
    ch_output_id: extraInt(n, 'ch_output_id'),
  }
}

type Case = (typeof dump.cases)[number]

/** The desktop's result with the agreed A-end divergence applied to it. */
function desktopExpectation(c: Case) {
  const lostIds = new Set<number>()
  let rerooted = c.rerooted
  let dropped = c.dropped_links
  for (const lost of c.a_end_lost) {
    // The desktop only re-roots (and keeps) such a link when its B-end made it
    // in; one with an outside B-end it counted as both re-rooted and dropped.
    rerooted--
    if (lost.b_end_inside) {
      dropped++
      lostIds.add(c.id_map.find(([old]) => old === lost.old_id)![1])
    }
  }
  return {
    counts: {
      skippedGlobal: c.skipped_global,
      droppedLinks: dropped,
      rerooted,
      clearedChannels: c.cleared_channels,
    },
    nodes: c.nodes.filter((n) => !lostIds.has(n.id)),
  }
}

function counts(r: MergeResult) {
  return {
    skippedGlobal: r.skippedGlobal,
    droppedLinks: r.droppedLinks,
    rerooted: r.rerooted,
    clearedChannels: r.clearedChannels,
  }
}

describe('scene merge parity with desktop merge_nodes', () => {
  it('covers every case the dump wrote, including the divergence', () => {
    expect(dump.cases.length).toBeGreaterThanOrEqual(9)
    expect(dump.cases.some((c) => c.a_end_lost.length > 0)).toBe(true)
    expect(dump.cases.some((c) => c.host_count === 0)).toBe(true)
  })

  for (const c of dump.cases) {
    it(c.name, () => {
      let host: GvNode[] = []
      for (const key of c.host) {
        const loaded = load(key)
        host = host.length === 0 ? loaded : [...host, ...mergeNodes(host, loaded).nodes]
      }
      expect(host.length).toBe(c.host_count)

      const result = mergeNodes(host, load(c.incoming))
      const expected = desktopExpectation(c)
      expect(counts(result)).toEqual(expected.counts)
      expect([...result.idMap.entries()]).toEqual(c.id_map)
      expect(result.nodes.map(row)).toEqual(expected.nodes)
    })
  }
})
