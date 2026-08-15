// The Hyperglyph Generator's Save Recipe… logic — a port of the desktop's
// tests/test_hyperglyph_recipe_export.py, case for case.
//
// Saving a randomized design as a Glyph Template is mostly `recipeToJson`,
// which the parity harness already covers. The part with a decision in it is
// the LIVE POSE capture: with Idle Motion running the preview is spinning when
// Save is clicked, a recipe stores one rotation per LEVEL while idle motion
// gives every NODE its own axis and speed, and rate integration has no
// wraparound — so an idling glyph reaches tens of thousands of degrees.

import { describe, expect, it } from 'vitest'
import {
  composerSafeAngle,
  COMPOSER_EDIT_NODE_WARN,
  Dist,
  generateNodes,
  levelSpec,
  projectedNodeCount,
  recipeFromJson,
  recipeToJson,
  snapshotLevelRotations,
} from './glyphRecipe'
import type { GlyphRecipe } from './glyphRecipe'
import { generateHyperglyph, buildHyperglyphNodes } from './hyperglyph'
import { applyRateAnimation, rateCandidates } from './rates'
import type { GvNode } from './types'
import { NodeType } from './types'

/** A three-level design with idle motion on — what the preview actually spins. */
function design() {
  return generateHyperglyph({ branchLevels: 3, maxNodes: 60, seed: 7, idleMotion: true })
}

/** Run the preview's own rate integrator for `seconds` of wall clock. */
function spun(nodes: GvNode[], seconds = 6): GvNode[] {
  const candidates = rateCandidates(nodes, new Set())
  applyRateAnimation(candidates, seconds * 1000)
  return nodes
}

describe('composerSafeAngle', () => {
  it('leaves an in-range value exactly alone', () => {
    // A static recipe has to round-trip byte-identically rather than have
    // every authored −20 rewritten as 340.
    for (const value of [0, -20, 359.5, -360, 360, 12.345]) {
      expect(composerSafeAngle(value)).toBe(value)
    }
  })

  it('folds an out-of-range one into 0…360', () => {
    expect(composerSafeAngle(400)).toBeCloseTo(40, 9)
    expect(composerSafeAngle(72000 + 45)).toBeCloseTo(45, 9)
    // Python's modulo, which takes the divisor's sign — a JS `%` would give
    // −40 here, an angle the Composer's own range still accepts but which is
    // not the number the desktop writes.
    expect(composerSafeAngle(-400)).toBeCloseTo(320, 9)
  })
})

describe('snapshotLevelRotations', () => {
  it('captures the trunk exactly — one node, so no approximation at all', () => {
    const d = design()
    const nodes = spun(buildHyperglyphNodes(d))
    const snapped = snapshotLevelRotations(d.recipe, nodes)
    for (const axis of ['x', 'y', 'z'] as const) {
      const live = nodes[0].rotate[axis]
      const saved = [snapped.levels[0].rotateX, snapped.levels[0].rotateY, snapped.levels[0].rotateZ][
        { x: 0, y: 1, z: 2 }[axis]
      ]
      const delta = (((live - saved) % 360) + 360) % 360
      expect(Math.min(delta, 360 - delta)).toBeLessThan(1e-9)
    }
  })

  it('takes each deeper level’s FIRST node as its representative', () => {
    // Not an average: a circular mean of siblings scattered right around the
    // circle is meaningless and flips on tiny changes, where the first node is
    // an orientation that genuinely occurred on screen.
    const d = design()
    const nodes = spun(buildHyperglyphNodes(d))
    const snapped = snapshotLevelRotations(d.recipe, nodes)
    const seen = new Set<number>()
    for (const node of nodes) {
      if (seen.has(node.branchLevel)) continue
      seen.add(node.branchLevel)
      const level = snapped.levels[node.branchLevel]
      const delta = (((node.rotate.y - level.rotateY) % 360) + 360) % 360
      expect(Math.min(delta, 360 - delta)).toBeLessThan(1e-9)
    }
    expect(seen.size).toBe(d.recipe.levels.length)
  })

  it('actually changes the pose — a capture that quietly did nothing is the bug', () => {
    const d = design()
    const snapped = snapshotLevelRotations(d.recipe, spun(buildHyperglyphNodes(d)))
    const changed = d.recipe.levels.filter(
      (before, i) =>
        before.rotateX !== snapped.levels[i].rotateX ||
        before.rotateY !== snapped.levels[i].rotateY ||
        before.rotateZ !== snapped.levels[i].rotateZ,
    ).length
    expect(changed).toBeGreaterThanOrEqual(d.recipe.levels.length - 1) // the trunk has no rate
  })

  it('folds a wildly spun pose into the range a rotation field accepts', () => {
    const d = design()
    const nodes = spun(buildHyperglyphNodes(d), 60_000)
    expect(Math.max(...nodes.map((n) => Math.abs(n.rotate.y)))).toBeGreaterThan(360)
    for (const level of snapshotLevelRotations(d.recipe, nodes).levels) {
      for (const value of [level.rotateX, level.rotateY, level.rotateZ]) {
        expect(value).toBeGreaterThanOrEqual(-360)
        expect(value).toBeLessThanOrEqual(360)
      }
    }
  })

  it('leaves everything but rotation alone, and never mutates the live recipe', () => {
    const d = design()
    const before = recipeToJson(d.recipe)
    const snapped = snapshotLevelRotations(d.recipe, spun(buildHyperglyphNodes(d)))
    expect(recipeToJson(d.recipe)).toEqual(before)
    snapped.levels.forEach((level, i) => {
      const source = d.recipe.levels[i]
      expect({ ...level, rotateX: 0, rotateY: 0, rotateZ: 0 }).toEqual({
        ...source,
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
      })
    })
  })

  it('maps levels by branch level RELATIVE to the first node', () => {
    // A design generated under a selected parent carries a base branch level,
    // and its levels have to land on the same recipe levels rather than
    // falling off the end.
    const d = design()
    const nodes = buildHyperglyphNodes(d, { startId: 50, parentId: 9, baseBranchLevel: 3 })
    for (const node of nodes) node.rotate.y += 1000
    const snapped = snapshotLevelRotations(d.recipe, nodes)
    snapped.levels.forEach((level, i) => {
      expect(level.rotateY).not.toBe(d.recipe.levels[i].rotateY)
    })
  })

  it('skips LINK rows, whose rotate is inert and always zero', () => {
    // A linked level's edges sit between its nodes in emission order; letting
    // one stand in for its level would erase the authored rotation.
    const recipe: GlyphRecipe = {
      name: 'Limbs',
      levels: [
        levelSpec({ count: 1, distMode: Dist.Linear, rotateX: 11 }),
        levelSpec({ count: 2, distMode: Dist.Angular, rotateX: 22, linkGeo: 19 }),
      ],
    }
    const nodes = generateNodes(recipe)
    expect(nodes.some((n) => n.type === NodeType.Link)).toBe(true)
    expect(snapshotLevelRotations(recipe, nodes).levels[1].rotateX).toBe(22)
  })

  it('tolerates an empty node list', () => {
    const d = design()
    expect(recipeToJson(snapshotLevelRotations(d.recipe, []))).toEqual(recipeToJson(d.recipe))
  })

  it('survives the JSON round trip the Composer opens', () => {
    const d = design()
    const snapped = snapshotLevelRotations(d.recipe, spun(buildHyperglyphNodes(d)))
    expect(recipeToJson(recipeFromJson(recipeToJson(snapped)))).toEqual(recipeToJson(snapped))
    expect(snapped.name).toBe(d.recipe.name)
  })
})

describe('the Composer-edit size warning', () => {
  it('is not tripped by the Generator’s default budget', () => {
    // Otherwise the prompt becomes something to click through.
    const d = generateHyperglyph({ branchLevels: 5, maxNodes: 500, seed: 42, idleMotion: false })
    expect(projectedNodeCount(d.recipe)).toBeLessThanOrEqual(COMPOSER_EDIT_NODE_WARN)
  })
})
