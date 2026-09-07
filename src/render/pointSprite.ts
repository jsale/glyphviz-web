// How a GL point is drawn: round, antialiased, and sized in the pixels the
// user is actually looking at.
//
// Two things separate a WebGL point from the desktop's, and both are visible
// rather than theoretical:
//
// ROUND. `initializeGL` enables GL_POINT_SMOOTH, so every point GlyphViz draws
// — a geometry-22 glyph, and now a whole Point Cloud — is a round antialiased
// dot. A WebGL point is a hard SQUARE: `gl_PointCoord` covers a unit quad and
// nothing rounds it off. At the 2 px default the difference is nothing, and by
// 8 px (ratio 0.4, well inside the range the Properties panel offers) a square
// point reads as a completely different mark.
//
// PIXELS. `gl_PointSize` is in DEVICE pixels, and this app renders at the
// display's own pixel ratio — so `size = ratio × 20` draws at half the intended
// size on a dpr-2 screen, which is most laptops. The desktop's number is a
// number of pixels on the screen in front of you, so ours has to be multiplied
// by the ratio to mean the same thing.
//
// Both are fixed here, in one place, for both callers: the cloud overlay and
// the single-Point glyph in glyphGeometry.ts. Before this the glyph was square
// and dpr-blind; it now matches the desktop, which is a visible change to
// existing scenes that use geometry 22 — toward the other app, not away from
// it.
//
// The patch is `onBeforeCompile`, the same tool render/fog.ts uses to put GL's
// straight fog ramp back over THREE's smoothstep one, and for the same reason:
// the built-in material is right about everything else.

import * as THREE from 'three'

/**
 * The device-pixel ratio every patched material multiplies its size by, held as
 * ONE uniform object shared by reference — so `setPointSpriteScale` updates
 * every point in the app, in every renderer, with a single write.
 *
 * Module-level mutable state, deliberately, on the same terms as
 * render/baseScale.ts: there is exactly one display ratio at a time, and
 * threading it would put a parameter on the glyph factory and on every caller
 * of it to say something none of them decide.
 */
const pixelRatio = { value: 1 }

/**
 * Set the device-pixel ratio point sizes are measured in. Call it wherever
 * `renderer.setPixelRatio` is called — boot and resize — exactly as the fat
 * lines' `setResolution` is called.
 *
 * The preview renderers (Glyph Composer, Hyperglyph Generator, Epitrochoid)
 * share the value rather than each holding their own: they draw the same
 * scene at the same ratio on the same screen, and a preview whose points
 * differed in size from the scene's would be lying about what it previews.
 */
export function setPointSpriteScale(ratio: number): void {
  pixelRatio.value = ratio > 0 ? ratio : 1
}

/** The ratio in force, for tests and for anything sizing a pick tolerance. */
export function pointSpriteScale(): number {
  return pixelRatio.value
}

/**
 * Softness of the disc's edge, as a fraction of its radius. Enough to take the
 * staircase off a circle without visibly shrinking a 2 px point — at that size
 * it is a third of a pixel.
 */
const EDGE = 0.25

/**
 * Make `material` draw round points at device-pixel sizes.
 *
 * Safe to call on a cached material more than once (the flag guards it), and it
 * must be called BEFORE the material first compiles — the same rule fog.ts's
 * chunk patch follows.
 *
 * `alphaToCoverage` is what makes the soft edge work on an OPAQUE cloud: THREE
 * only emits `#define OPAQUE` (which forces `diffuseColor.a = 1.0` and would
 * flatten the edge straight back to a square) when the material is neither
 * transparent NOR alpha-to-coverage, and coverage-based alpha needs no depth
 * sorting — so an opaque cloud keeps writing depth and still gets a smooth
 * outline. A translucent cloud sets `transparent` instead and blends properly,
 * which is what honours `color_a` the way the desktop's global GL_BLEND does.
 */
export function patchPointSprite(material: THREE.PointsMaterial): void {
  if (material.userData.pointSpritePatched) return
  material.userData.pointSpritePatched = true
  if (!material.transparent) material.alphaToCoverage = true

  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    shader.uniforms.uPointPixelRatio = pixelRatio
    shader.vertexShader = shader.vertexShader
      .replace('uniform float size;', 'uniform float size;\nuniform float uPointPixelRatio;')
      // After THREE's own line, so size attenuation (which this app never
      // turns on for points, but a caller could) still multiplies correctly.
      .replace('gl_PointSize = size;', 'gl_PointSize = size * uPointPixelRatio;')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      [
        '#include <clipping_planes_fragment>',
        // gl_PointCoord runs 0..1 across the point; d is 0 at the centre and
        // 1 at the inscribed circle.
        'float gvPointD = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;',
        `float gvPointA = 1.0 - smoothstep( ${(1 - EDGE).toFixed(3)}, 1.0, gvPointD );`,
        // Discarding the outside as well as fading it keeps the corners from
        // writing depth on an opaque cloud, where a coverage of zero still
        // would.
        'if ( gvPointA <= 0.0 ) discard;',
      ].join('\n'),
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a *= gvPointA;\n#include <opaque_fragment>',
    )
  }
  // A patched material compiles to a different program than an unpatched one of
  // the same parameters, so THREE has to be told not to reuse a cached one.
  material.customProgramCacheKey = () => 'gv-point-sprite'
  material.needsUpdate = true
}
