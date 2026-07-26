import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyRenderMode,
  blendStateFor,
  RENDER_MODE_COUNT,
  RENDER_MODE_NAMES,
  RenderMode,
} from './renderMode'

describe('blendStateFor', () => {
  // The desktop's _apply_render_mode, arm by arm.
  it('maps every mode to the desktop’s GL blend state', () => {
    expect(blendStateFor(RenderMode.Normal)).toMatchObject({
      blending: THREE.NormalBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: null, // leaves the material's own value alone
    })
    expect(blendStateFor(RenderMode.Additive)).toMatchObject({
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    })
    expect(blendStateFor(RenderMode.Subtractive)).toMatchObject({
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    })
    expect(blendStateFor(RenderMode.Dark)).toMatchObject({
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
    })
    expect(blendStateFor(RenderMode.Off)).toMatchObject({
      blending: THREE.NoBlending,
      transparent: false, // alpha ignored entirely
    })
    expect(blendStateFor(RenderMode.Screen)).toMatchObject({
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.OneFactor,
    })
    expect(blendStateFor(RenderMode.PremultipliedAlpha)).toMatchObject({
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
  })

  it('names all seven modes and falls back to Normal for anything else', () => {
    for (let mode = 0; mode < RENDER_MODE_COUNT; mode++) {
      expect(RENDER_MODE_NAMES[mode]).toBeTypeOf('string')
    }
    expect(blendStateFor(99)).toEqual(blendStateFor(RenderMode.Normal))
    expect(blendStateFor(-1)).toEqual(blendStateFor(RenderMode.Normal))
  })
})

function sceneWith(...materials: THREE.Material[]): THREE.Object3D {
  const root = new THREE.Group()
  for (const material of materials) {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  }
  return root
}

describe('applyRenderMode', () => {
  it('forces transparency on, so three actually blends an opaque glyph', () => {
    const opaque = new THREE.MeshLambertMaterial({ transparent: false })
    applyRenderMode(sceneWith(opaque), RenderMode.Additive)
    expect(opaque.transparent).toBe(true)
    expect(opaque.blending).toBe(THREE.CustomBlending)
    expect(opaque.blendDst).toBe(THREE.OneFactor)
  })

  it('restores the material’s own transparency when Normal comes back', () => {
    const opaque = new THREE.MeshLambertMaterial({ transparent: false })
    const translucent = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4 })
    const root = sceneWith(opaque, translucent)
    applyRenderMode(root, RenderMode.Screen)
    applyRenderMode(root, RenderMode.Normal)
    expect(opaque.transparent).toBe(false)
    expect(translucent.transparent).toBe(true) // its alpha still means something
    expect(opaque.blending).toBe(THREE.NormalBlending)
  })

  it('turns blending off for the Off mode, ignoring a node’s alpha', () => {
    const translucent = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4 })
    applyRenderMode(sceneWith(translucent), RenderMode.Off)
    expect(translucent.blending).toBe(THREE.NoBlending)
    expect(translucent.transparent).toBe(false)
  })

  it('visits each shared material once — glyphs share them by the thousand', () => {
    const shared = new THREE.MeshLambertMaterial()
    const other = new THREE.MeshLambertMaterial()
    const touched = applyRenderMode(sceneWith(shared, shared, shared, other), RenderMode.Dark)
    expect(touched).toBe(2)
  })

  it('leaves the editing chrome alone', () => {
    const haloMaterial = new THREE.LineBasicMaterial()
    const halo = new THREE.LineSegments(new THREE.BufferGeometry(), haloMaterial)
    halo.userData.isSelectionBox = true
    const glyphMaterial = new THREE.MeshLambertMaterial()
    const root = sceneWith(glyphMaterial)
    root.children[0].add(halo)
    applyRenderMode(root, RenderMode.Dark)
    expect(glyphMaterial.blending).toBe(THREE.CustomBlending)
    expect(haloMaterial.blending).toBe(THREE.NormalBlending) // untouched default
  })
})
