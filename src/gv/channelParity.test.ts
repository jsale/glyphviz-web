// Cross-implementation parity for Channels: the web engine must write the same
// attribute values, frame for frame, as the desktop's ChannelEngine.
//
// The reference JSONs come from tools/dump_channel_frames.py running the REAL
// desktop engine over the same CSV triples — regenerate them whenever either
// side's channel math changes. Each fixture lives in its own folder because
// companion discovery requires exactly one ch-map and one ch-tracks per folder.
//
// Fixtures cover the three value kinds the engine treats differently:
//   rotation convention — a float attribute, every one of its 120 frames;
//   ybco                — colour (rounded and clamped) alongside scale/translate;
//   texture animation   — texture_id (rounded, floored at 0), a flip-book;
//   sine wave           — 224 bindings at once, the built-in demo scene.

import { describe, expect, it } from 'vitest'
import { applyChannelFrame, bindChannels, parseGvChMap, parseGvChTracks, resetChannels } from './channels'
import { parseGvNodeCsv } from './nodeCsv'
import type { GvNode } from './types'

import rotationNodeCsv from './fixtures/channels/rotation_convention/Rotation_Convention_Example_gv_node.csv?raw'
import rotationMapCsv from './fixtures/channels/rotation_convention/Rotation_Convention_Example_gv_ch-map.csv?raw'
import rotationTracksCsv from './fixtures/channels/rotation_convention/Rotation_Convention_Example_gv_ch-tracks.csv?raw'
import rotationReferenceRaw from './fixtures/channels/rotation_convention/channel_frames.json?raw'

import ybcoNodeCsv from './fixtures/channels/ybco/ybco_gv_node.csv?raw'
import ybcoMapCsv from './fixtures/channels/ybco/ybco_gv_ch-map.csv?raw'
import ybcoTracksCsv from './fixtures/channels/ybco/ybco_gv_ch-tracks.csv?raw'
import ybcoReferenceRaw from './fixtures/channels/ybco/channel_frames.json?raw'

import textureNodeCsv from './fixtures/channels/texture_animation/texture_animation_gv_node.csv?raw'
import textureMapCsv from './fixtures/channels/texture_animation/texture_animation_gv_ch-map.csv?raw'
import textureTracksCsv from './fixtures/channels/texture_animation/texture_animation_gv_ch-tracks.csv?raw'
import textureReferenceRaw from './fixtures/channels/texture_animation/channel_frames.json?raw'

import sineNodeCsv from '../examples/sine_wave_example_gv_node.csv?raw'
import sineMapCsv from '../examples/sine_wave_example_gv_ch-map.csv?raw'
import sineTracksCsv from '../examples/sine_wave_example_gv_ch-tracks.csv?raw'
import sineReferenceRaw from './fixtures/channels/sine_wave_channel_frames.json?raw'

interface Reference {
  source_csv: string
  frame_count: number
  bindings: Array<{ id: number; attribute: string }>
  originals: Array<{ id: number; attribute: string; value: number }>
  frames: Array<{ frame: number; values: number[] }>
}

const TOLERANCE = 1e-9

const FIXTURES = [
  {
    name: 'rotation convention (rotate_y, all 120 frames)',
    node: rotationNodeCsv,
    map: rotationMapCsv,
    tracks: rotationTracksCsv,
    reference: JSON.parse(rotationReferenceRaw) as Reference,
  },
  {
    name: 'YBCO superconductor (color_a + scale + translate)',
    node: ybcoNodeCsv,
    map: ybcoMapCsv,
    tracks: ybcoTracksCsv,
    reference: JSON.parse(ybcoReferenceRaw) as Reference,
  },
  {
    name: 'texture animation (texture_id flip-book)',
    node: textureNodeCsv,
    map: textureMapCsv,
    tracks: textureTracksCsv,
    reference: JSON.parse(textureReferenceRaw) as Reference,
  },
  {
    name: 'sine wave (224 translate_z bindings)',
    node: sineNodeCsv,
    map: sineMapCsv,
    tracks: sineTracksCsv,
    reference: JSON.parse(sineReferenceRaw) as Reference,
  },
]

/** Read one desktop field name off a parsed web node. */
function readAttribute(node: GvNode, attribute: string): number {
  switch (attribute) {
    case 'texture_id':
      return node.textureId
    case 'color_r':
      return node.color.r
    case 'color_g':
      return node.color.g
    case 'color_b':
      return node.color.b
    case 'color_a':
      return node.color.a
    default: {
      const axis = attribute.slice(-1) as 'x' | 'y' | 'z'
      const group = attribute.slice(0, -2)
      const vec =
        group === 'translate' ? node.translate
        : group === 'rotate' ? node.rotate
        : group === 'scale' ? node.scale
        : group === 'translate_rate' ? node.translateRate
        : group === 'rotate_rate' ? node.rotateRate
        : group === 'scale_rate' ? node.scaleRate
        : null
      if (!vec) throw new Error(`unhandled attribute ${attribute}`)
      return vec[axis]
    }
  }
}

for (const fixture of FIXTURES) {
  describe(`Channels parity with the desktop engine: ${fixture.name}`, () => {
    const parsed = parseGvNodeCsv(fixture.node)
    const byId = new Map(parsed.nodes.map((n) => [n.id, n]))
    const animation = bindChannels(
      parseGvChMap(fixture.map),
      parseGvChTracks(fixture.tracks),
      parsed.nodes,
    )
    const reference = fixture.reference

    it('resolves the same bindings and frame count', () => {
      expect(parsed.errors).toEqual([])
      expect(animation.frameCount).toBe(reference.frame_count)
      // The desktop list is deduplicated by (node, field); ours keeps one entry
      // per map row, so compare the observable set rather than the raw counts.
      const ours = new Set(animation.bindings.map((b) => `${b.node.id}:${b.attribute}`))
      const theirs = new Set(reference.bindings.map((b) => `${b.id}:${b.attribute}`))
      expect([...ours].sort()).toEqual([...theirs].sort())
    })

    it('captures the same pre-animation originals', () => {
      for (const { id, attribute, value } of reference.originals) {
        expect(animation.originals.get(id)?.get(attribute), `${id}.${attribute}`).toBeCloseTo(
          value,
          9,
        )
      }
    })

    for (const frame of reference.frames) {
      it(`frame ${frame.frame} matches every bound attribute`, () => {
        applyChannelFrame(animation, frame.frame)
        for (let i = 0; i < reference.bindings.length; i++) {
          const { id, attribute } = reference.bindings[i]
          const actual = readAttribute(byId.get(id)!, attribute)
          expect(
            Math.abs(actual - frame.values[i]),
            `node ${id} ${attribute}: web ${actual} vs desktop ${frame.values[i]}`,
          ).toBeLessThan(TOLERANCE)
        }
      })
    }

    it('restores the originals on reset', () => {
      applyChannelFrame(animation, Math.floor(reference.frame_count / 2))
      resetChannels(animation)
      for (const { id, attribute, value } of reference.originals) {
        expect(readAttribute(byId.get(id)!, attribute), `${id}.${attribute}`).toBeCloseTo(value, 9)
      }
    })
  })
}
