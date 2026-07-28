// Unit tests for the recipe pieces the Glyph Composer adds on top of the
// generator's: the dialog's opening state, its "+ Add Level" defaults, the
// root/non-root placement rules, and template JSON.
//
// What a recipe GENERATES is checked against the desktop engine itself in
// glyphRecipe.parity.test.ts — these are the cases that have no desktop
// counterpart to diff (a corrupt template, a file from a future build) plus the
// constants the dialog is built out of.

import { describe, expect, it } from 'vitest'
import {
  addedLevelSpec,
  defaultRecipe,
  Dist,
  DIST_LABELS,
  generateNodes,
  levelSpec,
  NONROOT_DIST_MODES,
  projectedNodeCount,
  recipeFromJson,
  recipeToJson,
  ROOT_DIST_MODES,
} from './glyphRecipe'
import { Geometry, Topo } from './types'

describe('defaultRecipe', () => {
  it('is the desktop dialog\'s two-level opening glyph', () => {
    const recipe = defaultRecipe()
    expect(recipe.name).toBe('My Glyph')
    expect(recipe.levels).toHaveLength(2)

    const [root, ring] = recipe.levels
    // The trunk is ONE node whose own topology is Sphere — that topology is
    // what places the level below it, which is the whole model in miniature.
    expect(root.count).toBe(1)
    expect(root.topo).toBe(Topo.Sphere)
    expect(root.distMode).toBe(Dist.Linear)
    expect(root.colorEnd).toBeNull()

    expect(ring.count).toBe(6)
    expect(ring.distMode).toBe(Dist.Angular)
    expect(ring.topo).toBe(Topo.None)
    expect(ring.colorEnd).not.toBeNull()
  })

  it('generates a trunk plus its ring, depth-first', () => {
    const nodes = generateNodes(defaultRecipe(), { startId: 1 })
    expect(nodes).toHaveLength(7)
    expect(nodes[0].parentId).toBe(0)
    expect(nodes.slice(1).every((n) => n.parentId === nodes[0].id)).toBe(true)
    expect(nodes.slice(1).every((n) => n.branchLevel === 1)).toBe(true)
    // The ring runs the full 0…360 in the parent topology's angular coordinate.
    expect(nodes.slice(1).map((n) => n.translate.x)).toEqual([0, 60, 120, 180, 240, 300])
  })

  it('hands out fresh recipes, not a shared one', () => {
    const a = defaultRecipe()
    a.levels[0].count = 99
    expect(defaultRecipe().levels[0].count).toBe(1)
  })
})

describe('addedLevelSpec', () => {
  it('is Linear at the root and Angular below it', () => {
    // A level added as the FIRST one has no parent to be angular around.
    expect(addedLevelSpec(0).distMode).toBe(Dist.Linear)
    expect(addedLevelSpec(1).distMode).toBe(Dist.Angular)
    expect(addedLevelSpec(4).distMode).toBe(Dist.Angular)
  })

  it('is small and topologically inert, unlike the bare dataclass defaults', () => {
    const spec = addedLevelSpec(2)
    expect(spec.count).toBe(6)
    expect(spec.geometry).toBe(Geometry.SphereSolid)
    // Topo.None, so appending a level does not silently reshape one that does
    // not exist yet — where levelSpec()'s own default is Sphere.
    expect(spec.topo).toBe(Topo.None)
    expect(levelSpec().topo).toBe(Topo.Sphere)
    expect([spec.scaleX, spec.scaleY, spec.scaleZ]).toEqual([0.4, 0.4, 0.4])
    expect(spec.colorEnd).not.toBeNull()
  })
})

describe('placement mode tables', () => {
  it('offers the world modes at the root and the parent-relative ones below', () => {
    expect(ROOT_DIST_MODES).toEqual([Dist.Linear, Dist.Circular, Dist.Grid, Dist.Random])
    expect(NONROOT_DIST_MODES).toEqual([Dist.Angular, Dist.Linear])
    // Linear is the one mode both share, so it is always a safe fallback.
    expect(ROOT_DIST_MODES).toContain(Dist.Linear)
    expect(NONROOT_DIST_MODES).toContain(Dist.Linear)
  })

  it('labels every mode', () => {
    for (const mode of Object.values(Dist)) {
      expect(DIST_LABELS[mode]).toBeTruthy()
    }
  })
})

describe('projectedNodeCount', () => {
  it('agrees with what generateNodes actually emits', () => {
    const recipe = defaultRecipe()
    expect(projectedNodeCount(recipe)).toBe(generateNodes(recipe).length)

    recipe.levels.push(levelSpec({ count: 4 }), levelSpec({ count: 3 }))
    expect(projectedNodeCount(recipe)).toBe(generateNodes(recipe).length)
  })

  it('counts the running product, not the sum of the counts', () => {
    // 2 + 2*3 + 2*3*4 = 32. A recipe grows multiplicatively with depth, which
    // is the whole reason this exists.
    const recipe = { name: 'x', levels: [2, 3, 4].map((count) => levelSpec({ count })) }
    expect(projectedNodeCount(recipe)).toBe(32)
  })

  it('treats a count below 1 as 1, as distribute() does', () => {
    expect(projectedNodeCount({ name: 'x', levels: [levelSpec({ count: 0 })] })).toBe(1)
  })

  it('stops early at the limit instead of computing an absurd total', () => {
    // Ten levels of 200 is 200^10 — the point is that asking costs nothing.
    const recipe = { name: 'x', levels: Array.from({ length: 10 }, () => levelSpec({ count: 200 })) }
    expect(projectedNodeCount(recipe, 200_000)).toBe(200_000)
  })
})

describe('template JSON', () => {
  it('round-trips a recipe unchanged', () => {
    const recipe = defaultRecipe()
    recipe.name = 'Round Trip'
    recipe.levels.push(addedLevelSpec(2))
    expect(recipeFromJson(recipeToJson(recipe))).toEqual(recipe)
  })

  it('writes the desktop\'s snake_case keys', () => {
    const json = recipeToJson({ name: 'X', levels: [levelSpec({ distMode: Dist.Grid })] }) as {
      levels: Record<string, unknown>[]
    }
    expect(Object.keys(json.levels[0])).toContain('dist_grid_cols')
    expect(json.levels[0].dist_mode).toBe('grid')
    // A solid level's end colour is null, not absent — `asdict` emits the key.
    expect(json.levels[0].color_end).toBeNull()
    expect(json.levels[0].color_start).toEqual([180, 100, 200, 255])
  })

  it('fills missing fields with the dataclass defaults', () => {
    // `recipe_from_dict` reads every field with a `.get(..., default)`, so a
    // template from an older build still opens.
    const recipe = recipeFromJson({ levels: [{ count: 3 }] })
    expect(recipe.name).toBe('My Glyph')
    expect(recipe.levels[0].count).toBe(3)
    expect(recipe.levels[0]).toEqual(levelSpec({ count: 3 }))
  })

  it('ignores keys it does not know', () => {
    const recipe = recipeFromJson({
      name: 'Future',
      levels: [{ count: 2, some_field_from_a_later_build: 7 }],
      extra: true,
    })
    expect(recipe.levels[0].count).toBe(2)
  })

  it('falls back to Angular for an unrecognised placement mode', () => {
    expect(recipeFromJson({ levels: [{ dist_mode: 'spiral-of-doom' }] }).levels[0].distMode).toBe(
      Dist.Angular,
    )
  })

  it('pads a 3-element colour to opaque RGBA', () => {
    const spec = recipeFromJson({ levels: [{ color_start: [10, 20, 30] }] }).levels[0]
    expect(spec.colorStart).toEqual([10, 20, 30, 255])
  })

  it('rejects a file that is not a recipe', () => {
    // The Composer reports these rather than replacing the design in progress
    // with an empty one, which is what silently accepting {} would do.
    expect(() => recipeFromJson(null)).toThrow()
    expect(() => recipeFromJson('a string')).toThrow()
    expect(() => recipeFromJson({})).toThrow()
    expect(() => recipeFromJson({ name: 'Empty', levels: [] })).toThrow()
  })
})
