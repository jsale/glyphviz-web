// Scene-wide render (blend) modes — the World row's `render_mode`, cycled with
// the 8 key. A port of the desktop viewport's `_apply_render_mode`, which sets
// ONE global GL blend state for the whole frame before drawing anything.
//
// WebGL has no fixed-function global blend state to set: three.js carries
// blending per MATERIAL and re-applies it per draw. So the same seven modes are
// expressed as CustomBlending factors written onto every material in the scene
// content, which produces the same pixels for the same reason — the factors ARE
// the desktop's glBlendEquation/glBlendFunc arguments.
//
// Two consequences of that difference, both deliberate:
//
//  - three disables blending outright for a material with `transparent: false`
//    (WebGLState.setMaterial), so every non-Normal mode forces transparency on.
//    The material's own value is remembered and restored by Normal, which keeps
//    an ordinary scene rendering exactly as it did before this existed.
//  - the mode is applied to scene CONTENT only — glyphs, links, plot/surface
//    overlays, the backdrop grid and axes. The editing chrome (transform gizmo,
//    selection halos) stays Normal, where the desktop's global state catches it
//    too. Chrome you cannot see is chrome you cannot use: under Dark (Multiply)
//    a yellow halo would vanish into the glyph it is meant to outline. This
//    follows the same line as Show Selection Box and the closable panels —
//    chrome is the app, not the scene.

import * as THREE from 'three'

export const RenderMode = {
  Normal: 0,
  Additive: 1,
  Subtractive: 2,
  /** Multiply. */
  Dark: 3,
  /** Blending disabled — alpha is ignored entirely. */
  Off: 4,
  Screen: 5,
  PremultipliedAlpha: 6,
} as const

export const RENDER_MODE_COUNT = 7

export const RENDER_MODE_NAMES: Record<number, string> = {
  [RenderMode.Normal]: 'Normal',
  [RenderMode.Additive]: 'Additive',
  [RenderMode.Subtractive]: 'Subtractive',
  [RenderMode.Dark]: 'Dark (Multiply)',
  [RenderMode.Off]: 'Off',
  [RenderMode.Screen]: 'Screen',
  [RenderMode.PremultipliedAlpha]: 'Premultiplied Alpha',
}

/** The blend state a mode puts a material into. `transparent: null` means
 *  "whatever the material was built with" — see the header. */
export interface BlendState {
  blending: THREE.Blending
  blendEquation: THREE.BlendingEquation
  blendSrc: THREE.BlendingSrcFactor
  blendDst: THREE.BlendingDstFactor
  transparent: boolean | null
}

const NORMAL_STATE: BlendState = {
  blending: THREE.NormalBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  transparent: null,
}

/**
 * Mode → blend state, one line per branch of `_apply_render_mode`. Unknown ids
 * fall through to Normal, matching the desktop's `else` arm (a file may carry
 * any integer in that column).
 */
export function blendStateFor(mode: number): BlendState {
  switch (mode) {
    case RenderMode.Additive: // glBlendFunc(GL_SRC_ALPHA, GL_ONE)
      return {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
        transparent: true,
      }
    case RenderMode.Subtractive: // GL_FUNC_REVERSE_SUBTRACT, (GL_SRC_ALPHA, GL_ONE)
      return {
        blending: THREE.CustomBlending,
        blendEquation: THREE.ReverseSubtractEquation,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
        transparent: true,
      }
    case RenderMode.Dark: // glBlendFunc(GL_ZERO, GL_SRC_COLOR)
      return {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        transparent: true,
      }
    case RenderMode.Off: // glDisable(GL_BLEND) — alpha ignored
      return {
        blending: THREE.NoBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        transparent: false,
      }
    case RenderMode.Screen: // glBlendFunc(GL_ONE_MINUS_DST_COLOR, GL_ONE)
      return {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneMinusDstColorFactor,
        blendDst: THREE.OneFactor,
        transparent: true,
      }
    case RenderMode.PremultipliedAlpha: // glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
      return {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        transparent: true,
      }
    default:
      return NORMAL_STATE
  }
}

/** Objects the mode deliberately skips — see the header. */
function isChrome(object: THREE.Object3D): boolean {
  return object.userData.isSelectionBox === true || object.userData.isPickProxy === true
}

/**
 * Write `mode`'s blend state onto every material under `root`.
 *
 * Materials are SHARED across look-alike glyphs (glyphGeometry's cache), so
 * this walks unique materials, not objects — at Event_Cloud's 209k nodes the
 * difference is a few hundred writes instead of a few hundred thousand. Call it
 * after a scene rebuild and whenever the mode changes; nothing here runs per
 * frame.
 */
export function applyRenderMode(root: THREE.Object3D, mode: number): number {
  const state = blendStateFor(mode)
  const seen = new Set<THREE.Material>()
  root.traverse((object) => {
    if (isChrome(object)) return
    const material = (object as THREE.Mesh).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      if (seen.has(m)) continue
      seen.add(m)
      applyToMaterial(m, state)
    }
  })
  return seen.size
}

function applyToMaterial(material: THREE.Material, state: BlendState): void {
  // The material's own transparency is what Normal restores. Captured on first
  // touch, before any mode has overwritten it.
  if (material.userData.baseTransparent === undefined) {
    material.userData.baseTransparent = material.transparent
  }
  material.blending = state.blending
  material.blendEquation = state.blendEquation
  material.blendSrc = state.blendSrc
  material.blendDst = state.blendDst
  // Remembered so a later per-frame opacity write (dynamicNodes) cannot undo a
  // mode's forced transparency — or force it where Off ignores alpha outright.
  material.userData.forcedTransparent = state.transparent
  setTransparent(material, state.transparent ?? (material.userData.baseTransparent as boolean))
}

/**
 * Set the transparency a material would have on its OWN account — what an
 * animated `color_a` asks for — leaving the active render mode's override in
 * charge where it has one.
 *
 * Anything that changes `material.opacity` at run time has to come through
 * here: three compiles transparency into the program (`#define OPAQUE` forces
 * `diffuseColor.a = 1.0` in the fragment shader), so a material built opaque
 * IGNORES a later opacity of 0 until the flag flip is followed by a recompile.
 * The flag is only touched when it actually changes, so a steady scene pays
 * nothing and a node crossing the boundary pays one program-cache lookup.
 */
export function setNaturalTransparency(material: THREE.Material, transparent: boolean): void {
  material.userData.baseTransparent = transparent
  const forced = (material.userData.forcedTransparent ?? null) as boolean | null
  setTransparent(material, forced ?? transparent)
}

function setTransparent(material: THREE.Material, transparent: boolean): void {
  if (material.transparent === transparent) return
  material.transparent = transparent
  // Transparency is compiled into the program's defines, unlike the blend
  // factors, which are plain GL state.
  material.needsUpdate = true
}
