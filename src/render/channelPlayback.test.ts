// End-to-end wiring for Channels playback, over the built-in demo scene: parse
// the node CSV and its companions, build the scene, register the dynamic slice,
// and check that applying a frame actually moves the Object3Ds.
//
// The value here is the joins main.ts makes, which the per-module tests can't
// see: that the vendored scene's ch_input_id column really does line up with
// its map and tracks, and that a frame change reaches the scene graph without a
// rebuild.

import { describe, expect, it } from 'vitest'
import { applyChannelFrame, bindChannels, parseGvChMap, parseGvChTracks, resetChannels } from '../gv/channels'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { buildScene } from './buildScene'
import { DynamicNodes } from './dynamicNodes'
import sineNodeCsv from '../examples/sine_wave_example_gv_node.csv?raw'
import sineMapCsv from '../examples/sine_wave_example_gv_ch-map.csv?raw'
import sineTracksCsv from '../examples/sine_wave_example_gv_ch-tracks.csv?raw'

describe('Channels playback over the built-in sine wave scene', () => {
  const parsed = parseGvNodeCsv(sineNodeCsv)
  const channels = bindChannels(
    parseGvChMap(sineMapCsv),
    parseGvChTracks(sineTracksCsv),
    parsed.nodes,
  )

  it('binds the vendored scene without any unmatched join', () => {
    expect(parsed.errors).toEqual([])
    expect(channels.warnings).toEqual([])
    expect(channels.frameCount).toBe(512)
    expect(channels.boundNodeIds.size).toBeGreaterThan(200)
    // translate_z only: no colour, texture or scale work for this scene.
    expect(channels.appearanceBoundNodeIds.size).toBe(0)
    expect(channels.scaleBoundNodeIds.size).toBe(0)
  })

  it('moves the frames of bound nodes when the frame index changes', () => {
    const built = buildScene(parsed.nodes)
    const dynamic = new DynamicNodes(
      parsed.nodes,
      built.frames,
      {
        transform: channels.transformBoundNodeIds,
        appearance: channels.appearanceBoundNodeIds,
        scaled: channels.scaleBoundNodeIds,
      },
      new Map(),
    )

    const sampleId = [...channels.boundNodeIds][0]
    const frame = built.frames.get(sampleId)!
    const fromCsv = frame.position.clone()

    applyChannelFrame(channels, 0)
    dynamic.update()
    const atZero = frame.position.clone()

    applyChannelFrame(channels, 128)
    dynamic.update()
    expect(frame.position.distanceTo(atZero)).toBeGreaterThan(1e-6)

    // Stop restores the CSV values, and the scene follows them back.
    resetChannels(channels)
    dynamic.update()
    expect(frame.position.distanceTo(fromCsv)).toBeLessThan(1e-12)
    dynamic.dispose()
  })
})
