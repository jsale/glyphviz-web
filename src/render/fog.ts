// Scene fog — the World row's `fog_enabled` / `fog_start` / `fog_end`, a port
// of the desktop viewport's paintGL fog block (glyphviz_gl/viewport.py):
//
//     glEnable(GL_FOG); glFogi(GL_FOG_MODE, GL_LINEAR)
//     glFogfv(GL_FOG_COLOR, [bg_r, bg_g, bg_b, 1.0])
//     glFogf(GL_FOG_START, world.fog_start); glFogf(GL_FOG_END, world.fog_end)
//
// Two things are reproduced rather than inherited:
//
//  - The RAMP. GL_LINEAR's fog factor is (end − c) / (end − start), a straight
//    line in eye depth. Three's built-in linear fog runs the same two inputs
//    through smoothstep, which eases both ends: geometry near fog_start would
//    hold clearer, geometry near fog_end fade sooner, than on the desktop.
//    installLinearFog() patches the shared fog_fragment chunk once, so every
//    material in the app fogs on the desktop's line. (The depth itself already
//    matches: fixed-function GL's fog coordinate "may be computed as |z_e|",
//    which is exactly three's vFogDepth = −mvPosition.z.)
//
//  - The COLOR. Fog fades to the scene BACKGROUND — the desktop passes the
//    World row's own color_r/g/b — and under the raw-sRGB pipeline
//    (lighting.ts) the numeric triplet reaches the uniform untouched, so the
//    far distance dissolves into the clear color exactly.
//
// Chrome (selection halos, the transform gizmo) is exempt via
// `material.fog = false`, the same line the render modes drew (renderMode.ts):
// the desktop's global GL state fogs its chrome too, but chrome you cannot see
// is chrome you cannot use — a halo out at fog_end would vanish into the murk
// with the glyph it is meant to outline. Scene content — glyphs, links,
// plot/surface overlays, the backdrop grid and axes — all fogs. Tag labels are
// a 2D canvas here and QPainter text there; neither pipeline fogs them.
//
// The desktop's pick pass disables fog because fog would corrupt its color-ID
// reads; picking here is a raycast, so there is nothing to disable.

import * as THREE from 'three'
import type { GvNode } from '../gv/types'

/**
 * Swap three's smoothstep linear fog for GL_LINEAR's straight ramp, in the
 * one shared chunk every fogging shader includes. Call once at boot, before
 * the first render; programs compile their chunks lazily, so materials that
 * already exist pick the patched ramp up the first time fog turns on.
 *
 * The denominator guard is for fog_end == fog_start (GL leaves that case
 * undefined; this pins it to a hard cut at the shared distance) — max() keeps
 * it well-defined without moving any ordinary scene's ramp.
 */
export function installLinearFog(): void {
  const linear =
    'float fogFactor = clamp( ( vFogDepth - fogNear ) / max( fogFar - fogNear, 1e-6 ), 0.0, 1.0 );'
  const patched = THREE.ShaderChunk.fog_fragment.replace(
    /float fogFactor = smoothstep\( fogNear, fogFar, vFogDepth \);/,
    linear,
  )
  if (!patched.includes('max( fogFar - fogNear')) {
    // A three upgrade rewrote the chunk: fall back to the stock smoothstep
    // ramp (fog still works, eased) rather than shipping a broken shader.
    console.warn('installLinearFog: fog_fragment chunk not recognised; keeping smoothstep fog.')
    return
  }
  THREE.ShaderChunk.fog_fragment = patched
}

/**
 * Point `scene.fog` at the World row's fog state — or clear it. The fog color
 * IS the row's own color_r/g/b (the background), per the desktop block above;
 * a scene with no World row has no fog, exactly as `world is None` disables it
 * there.
 *
 * Cheap enough to call per animated frame: three only recompiles programs when
 * fog flips between null and set, and updating the existing Fog instance in
 * place is three uniform writes.
 */
export function applySceneFog(scene: THREE.Scene, world: GvNode | null): void {
  if (!world || world.fogEnabled === 0) {
    scene.fog = null
    return
  }
  const r = world.color.r / 255
  const g = world.color.g / 255
  const b = world.color.b / 255
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.setRGB(r, g, b)
    scene.fog.near = world.fogStart
    scene.fog.far = world.fogEnd
  } else {
    scene.fog = new THREE.Fog(new THREE.Color(r, g, b), world.fogStart, world.fogEnd)
  }
}
