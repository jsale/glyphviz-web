import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applySceneFog, installLinearFog } from './fog'
import { parseGvNodeCsv } from '../gv/nodeCsv'

const HEADER =
  'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,' +
  'rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo,' +
  'fog_enabled,fog_start,fog_end'

function worldRow(fogEnabled: number, start: number, end: number) {
  const parsed = parseGvNodeCsv(
    [HEADER, `1,0,0,0,0,0,0,0,0,0,1,1,1,40,80,120,255,0,0,0,${fogEnabled},${start},${end}`].join(
      '\n',
    ),
  )
  expect(parsed.errors).toEqual([])
  return parsed.nodes[0]
}

describe('installLinearFog', () => {
  it('replaces the smoothstep ramp with GL_LINEAR in the shared chunk', () => {
    installLinearFog()
    expect(THREE.ShaderChunk.fog_fragment).not.toContain('smoothstep( fogNear')
    expect(THREE.ShaderChunk.fog_fragment).toContain(
      'clamp( ( vFogDepth - fogNear ) / max( fogFar - fogNear, 1e-6 ), 0.0, 1.0 )',
    )
    // The exp2 branch is untouched — only the linear ramp differs from GL.
    expect(THREE.ShaderChunk.fog_fragment).toContain('FOG_EXP2')
    // Idempotent: a second install (or a hot reload) must not corrupt the chunk.
    installLinearFog()
    expect(THREE.ShaderChunk.fog_fragment).toContain('max( fogFar - fogNear, 1e-6 )')
  })
})

describe('applySceneFog', () => {
  it('sets linear fog from the World row, coloured as the background', () => {
    const scene = new THREE.Scene()
    applySceneFog(scene, worldRow(1, 20, 200))
    const fog = scene.fog as THREE.Fog
    expect(fog).toBeInstanceOf(THREE.Fog)
    expect(fog.near).toBe(20)
    expect(fog.far).toBe(200)
    expect(fog.color.r).toBeCloseTo(40 / 255, 6)
    expect(fog.color.g).toBeCloseTo(80 / 255, 6)
    expect(fog.color.b).toBeCloseTo(120 / 255, 6)
  })

  it('updates the existing Fog in place, and clears it when disabled or worldless', () => {
    const scene = new THREE.Scene()
    applySceneFog(scene, worldRow(1, 20, 200))
    const first = scene.fog
    applySceneFog(scene, worldRow(1, 50, 900))
    expect(scene.fog).toBe(first) // three uniform writes, no recompile churn
    expect((scene.fog as THREE.Fog).near).toBe(50)

    applySceneFog(scene, worldRow(0, 50, 900))
    expect(scene.fog).toBeNull()
    applySceneFog(scene, worldRow(1, 20, 200))
    applySceneFog(scene, null)
    expect(scene.fog).toBeNull()
  })
})
