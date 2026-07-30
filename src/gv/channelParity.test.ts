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

import paramsNodeCsv from './fixtures/channels/channel_parameters/channel_parameters_gv_node.csv?raw'
import paramsMapCsv from './fixtures/channels/channel_parameters/channel_parameters_gv_ch-map.csv?raw'
import paramsTracksCsv from './fixtures/channels/channel_parameters/channel_parameters_gv_ch-tracks.csv?raw'
import paramsReferenceRaw from './fixtures/channels/channel_parameters/channel_frames.json?raw'

import moodNodeCsv from './fixtures/channels/mood_background/mood_background_gv_node.csv?raw'
import moodMapCsv from './fixtures/channels/mood_background/mood_background_gv_ch-map.csv?raw'
import moodTracksCsv from './fixtures/channels/mood_background/mood_background_gv_ch-tracks.csv?raw'
import moodReferenceRaw from './fixtures/channels/mood_background/channel_frames.json?raw'

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
  // The desktop's own examples for the expanded attribute set (77d6361). The
  // parameters scene covers the shape fields (ratio/topo/geometry), palette
  // resolution — its reference records the color_r/g/b the desktop resolves
  // from (palette_id, color_index) each frame, not just the clamped inputs —
  // and the hide/show_text flags. The mood scene is the World row: background
  // colour through the ordinary color binding, render_mode, and the three fog
  // fields (fog_start/fog_end being the floats a track feeds sign-exactly).
  {
    name: 'channel parameters (shape + palette + visibility)',
    node: paramsNodeCsv,
    map: paramsMapCsv,
    tracks: paramsTracksCsv,
    reference: JSON.parse(paramsReferenceRaw) as Reference,
  },
  {
    name: 'mood background (World row: background, fog, render_mode)',
    node: moodNodeCsv,
    map: moodMapCsv,
    tracks: moodTracksCsv,
    reference: JSON.parse(moodReferenceRaw) as Reference,
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
    case 'ratio':
      return node.ratio
    case 'topo':
      return node.topo
    case 'geometry':
      return node.geometry
    case 'mesh_id':
      return node.meshId
    case 'palette_id':
      return node.paletteId
    case 'color_index':
      return node.colorIndex
    case 'hide':
      return node.hide
    case 'show_text':
      return node.showText
    case 'render_mode':
      return node.renderMode
    case 'fog_enabled':
      return node.fogEnabled
    case 'fog_start':
      return node.fogStart
    case 'fog_end':
      return node.fogEnd
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
      // The dump also records the color_r/g/b a palette binding RESOLVES into
      // (they are observable writes without being bindings) — mirror that.
      for (const node of animation.paletteNodes) {
        for (const attribute of ['color_r', 'color_g', 'color_b']) {
          ours.add(`${node.id}:${attribute}`)
        }
      }
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
