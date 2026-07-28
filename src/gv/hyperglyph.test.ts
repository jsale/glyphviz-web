// Behaviour of the Hyperglyph Generator that is NOT covered by the parity
// fixture: the budget contract, the desktop bug this port has to route around,
// and the two rules that make "what you previewed is what gets inserted" true.
//
// Parity (hyperglyph.parity.test.ts) proves only that a seed reproduces the
// desktop's design. It says nothing about the cases the desktop cannot reach.

import { describe, expect, it } from 'vitest'
import {
  ANGULAR_SAFE_TOPOS,
  buildHyperglyphNodes,
  generateHyperglyph,
  GEO_FAMILIES,
  makePalette,
  pickLevelCounts,
  randomRecipe,
  totalNodes,
} from './hyperglyph'
import { PythonRandom } from './pythonRandom'
import { Geometry, NodeType, RotationMode, Topo } from './types'

function design(seed: number, branchLevels = 5, maxNodes = 500, idleMotion = true) {
  return generateHyperglyph({ branchLevels, maxNodes, seed, idleMotion })
}

describe('node budgeting', () => {
  it('counts a full tree the way the trimmer does', () => {
    expect(totalNodes([])).toBe(1)
    expect(totalNodes([3])).toBe(4)
    expect(totalNodes([3, 2])).toBe(1 + 3 + 6)
  })

  it('never exceeds the budget, across depths and budgets', () => {
    for (const levels of [1, 2, 3, 4, 5, 6, 8, 10]) {
      for (const maxNodes of [2, 10, 60, 500, 5000, 20000]) {
        for (const seed of [0, 1, 42, 9999]) {
          const nodes = buildHyperglyphNodes(design(seed, levels, maxNodes))
          // The trimmer stops at one child per level, so the requested depth
          // itself is a floor the budget cannot cut below — a 3-level design
          // is 3 nodes even at a budget of 2. Desktop behaviour: its trim loop
          // has the same `any(c > 1)` guard, so it overruns identically.
          const floor = Math.max(maxNodes, levels)
          expect(nodes.length, `levels=${levels} max=${maxNodes} seed=${seed}`).toBeLessThanOrEqual(
            floor,
          )
          expect(nodes.length).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('produces a bare trunk for one branch level', () => {
    const nodes = buildHyperglyphNodes(design(3, 1))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].branchLevel).toBe(0)
    expect(nodes[0].parentId).toBe(0)
  })

  it('survives the shallow-tree range the desktop raises ValueError on', () => {
    // `round(max_nodes ** (1/depth)) - 2` exceeds MAX_BRANCH here, so the
    // desktop's own randint(498, 12) is an empty range and its dialog throws.
    // See pickLevelCounts: the low end clamps to the high one instead.
    const rng = new PythonRandom(1)
    expect(() => pickLevelCounts(1, 500, rng)).not.toThrow()
    const nodes = buildHyperglyphNodes(design(1, 2, 500))
    expect(nodes.length).toBeGreaterThan(1)
    expect(nodes.length).toBeLessThanOrEqual(500)
  })
})

describe('design vocabulary', () => {
  it('only ever branches through topologies whose translate_x is an angle', () => {
    // A Cube/Plane/Plot parent reads translate_x as something else entirely,
    // so a ring of children distributed 0…360 would land in nonsense positions.
    const safe = new Set(ANGULAR_SAFE_TOPOS)
    for (const seed of [0, 42, 777, 31337, 2 ** 31 - 1]) {
      for (const node of buildHyperglyphNodes(design(seed))) {
        expect(safe.has(node.topo), `seed ${seed} topo ${node.topo}`).toBe(true)
      }
    }
    expect(safe.has(Topo.Cube)).toBe(false)
    expect(safe.has(Topo.Zsphere)).toBe(false)
    expect(safe.has(Topo.Plot)).toBe(false)
  })

  it('keeps a design inside ONE geometry family', () => {
    for (const seed of [0, 42, 777, 12345]) {
      const geometries = new Set(buildHyperglyphNodes(design(seed)).map((n) => n.geometry))
      const families = Object.values(GEO_FAMILIES).filter((pool) =>
        [...geometries].every((g) => pool.includes(g)),
      )
      expect(families.length, `seed ${seed}`).toBeGreaterThan(0)
    }
  })

  it('never picks Mesh geometry, which would need an imported model', () => {
    for (const pool of Object.values(GEO_FAMILIES)) {
      expect(pool).not.toContain(Geometry.Mesh)
    }
  })

  it('relates hues per scheme rather than rolling them independently', () => {
    const hues = (scheme: string) => makePalette(scheme, 4, new PythonRandom(5))
    expect(new Set(hues('monochrome')).size).toBe(1)
    const triadic = hues('triadic')
    expect(triadic[3]).toBeCloseTo(triadic[0], 12) // offsets cycle every 3
    const rainbow = hues('rainbow')
    expect(rainbow).toEqual([0, 0.25, 0.5, 0.75])
    for (const scheme of ['monochrome', 'analogous', 'complementary', 'rainbow']) {
      for (const h of hues(scheme)) {
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(1)
      }
    }
  })

  it('emits ordinary glyph rows — nothing a scene has to treat specially', () => {
    for (const node of buildHyperglyphNodes(design(42))) {
      expect(node.type).toBe(NodeType.Glyph)
      expect(node.hide).toBe(0)
      // Fresh nodes are Euler, like the desktop's Node dataclass default.
      expect(node.rotationMode).toBe(RotationMode.EulerXYZ)
      // Wired for the =/− palette keys: index 0 resolves to no colour at all.
      expect(node.colorIndex).toBe(node.branchLevel + 1)
    }
  })
})

describe('reproducibility', () => {
  it('gives the same design for the same seed', () => {
    const a = buildHyperglyphNodes(design(4242))
    const b = buildHyperglyphNodes(design(4242))
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a))
  })

  it('gives different designs for different seeds', () => {
    const a = buildHyperglyphNodes(design(1))
    const b = buildHyperglyphNodes(design(2))
    expect(JSON.stringify(b)).not.toEqual(JSON.stringify(a))
  })

  it('rebuilds an identical structure at a different anchor', () => {
    // What Insert into Scene relies on: the preview and the insertion are two
    // separate generate calls, and only ids/parent/level may differ between
    // them. Placement draws no randomness, so the SHAPE cannot drift.
    const d = design(2026)
    const preview = buildHyperglyphNodes(d)
    const inserted = buildHyperglyphNodes(d, { startId: 5000, parentId: 88, baseBranchLevel: 2 })

    expect(inserted).toHaveLength(preview.length)
    expect(inserted[0].parentId).toBe(88)
    expect(inserted[0].branchLevel).toBe(2)
    for (const [i, node] of inserted.entries()) {
      expect(node.id).toBe(preview[i].id + 4999)
      expect(node.branchLevel).toBe(preview[i].branchLevel + 2)
      expect(node.translate).toEqual(preview[i].translate)
      expect(node.scale).toEqual(preview[i].scale)
      expect(node.color).toEqual(preview[i].color)
      expect(node.geometry).toBe(preview[i].geometry)
      expect(node.topo).toBe(preview[i].topo)
    }
    // Every non-trunk node re-parents onto a node from the same batch.
    const ids = new Set(inserted.map((n) => n.id))
    for (const node of inserted.slice(1)) expect(ids.has(node.parentId)).toBe(true)
  })

  it('re-levels the idle-motion spin when inserted below the root', () => {
    // Desktop behaviour, and the one thing the preview does NOT predict: the
    // orrery alternates on ABSOLUTE branch level and skips level 0 only, so a
    // design grafted at level 2 gives its trunk a spin (level 2 is even, hence
    // positive) and every node after it draws one call further along the
    // stream. That is arguably right — the alternation is meant to be against
    // the ring the node actually hangs from, which is now a real scene node —
    // but it does mean insert-under-a-node and insert-as-a-root spin
    // differently from the same seed.
    const d = design(2026)
    const asRoot = buildHyperglyphNodes(d)
    const asChild = buildHyperglyphNodes(d, { parentId: 88, baseBranchLevel: 2 })
    expect(asRoot[0].rotateRate).toEqual({ x: 0, y: 0, z: 0 })
    expect(Object.values(asChild[0].rotateRate).some((v) => v !== 0)).toBe(true)
  })
})

describe('idle motion', () => {
  it('spins every node but the trunk, and only about one axis each', () => {
    const nodes = buildHyperglyphNodes(design(11))
    expect(nodes[0].rotateRate).toEqual({ x: 0, y: 0, z: 0 })
    for (const node of nodes.slice(1)) {
      const axes = [node.rotateRate.x, node.rotateRate.y, node.rotateRate.z]
      expect(axes.filter((v) => v !== 0)).toHaveLength(1)
      // translate_rate/scale_rate integrate forever with no wraparound, so a
      // hyperglyph left running would drift away or grow without bound.
      expect(node.translateRate).toEqual({ x: 0, y: 0, z: 0 })
      expect(node.scaleRate).toEqual({ x: 0, y: 0, z: 0 })
    }
  })

  it('counter-rotates each level against the one above it', () => {
    for (const node of buildHyperglyphNodes(design(11)).slice(1)) {
      const speed = node.rotateRate.x || node.rotateRate.y || node.rotateRate.z
      expect(Math.sign(speed)).toBe(node.branchLevel % 2 === 0 ? 1 : -1)
    }
  })

  it('leaves every rate at zero when it is switched off', () => {
    for (const node of buildHyperglyphNodes(design(11, 5, 500, false))) {
      expect(node.rotateRate).toEqual({ x: 0, y: 0, z: 0 })
    }
  })

  it('is captured on the design, not read again at insert time', () => {
    // The checkbox can be flipped after a Regenerate without regenerating, and
    // what gets inserted must still be what was previewed (desktop
    // `_idle_motion_applied`). The flag lives on the design object for that.
    const d = design(11, 5, 500, true)
    expect(d.idleMotion).toBe(true)
    const spun = buildHyperglyphNodes(d)
    const spunAgain = buildHyperglyphNodes(d, { startId: 900 })
    expect(spunAgain.map((n) => n.rotateRate)).toEqual(spun.map((n) => n.rotateRate))
  })
})

describe('randomRecipe meta', () => {
  it('reports the choices the info line shows', () => {
    const { recipe, meta } = randomRecipe(5, 500, new PythonRandom(42))
    expect(Object.keys(GEO_FAMILIES)).toContain(meta.geometryFamily)
    expect(meta.levelCounts).toHaveLength(4)
    // One LevelSpec per branch level, trunk included.
    expect(recipe.levels).toHaveLength(5)
    expect(recipe.levels[0].count).toBe(1)
  })
})
