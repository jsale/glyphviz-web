// Vectors dumped from the real CPython 3.12 `random` module, so this is a
// parity test in everything but name — the file it checks exists purely so a
// hyperglyph seed means the same design in both apps, and nothing about that
// claim is provable from within JavaScript.
//
// Regenerate with the desktop repo's env python:
//
//   python -c "import random, json; ..."   (see the shape of VECTORS below)
//
// The `randbelow` row is the important one: it is the call every choice/randint
// goes through, it RETRIES on out-of-range draws, and its per-call draw count
// is what keeps the rest of a design's stream in step.

import { describe, expect, it } from 'vitest'
import { bitLength, hsvToRgb, pyMod, PythonRandom } from './pythonRandom'

interface Vector {
  random: number[]
  getrandbits: number[]
  randbelow: number[]
  randint: number[]
  uniform: number[]
  choice: string[]
}

const BITS = [1, 4, 8, 16, 31, 32]
const BELOW = [1, 2, 3, 6, 20, 26, 61, 128, 2 ** 31]
const LETTERS = [...'abcdefg']

const VECTORS: Record<string, Vector> = {
  '0': {
    random: [
      0.8444218515250481, 0.7579544029403025, 0.420571580830845, 0.25891675029296335,
      0.5112747213686085,
    ],
    getrandbits: [0, 14, 200, 54385, 651359108, 4156669319],
    randbelow: [0, 1, 2, 1, 16, 4, 18, 35, 407295012],
    randint: [199, 211, 176, 218],
    uniform: [1.9538180453116283, 12.310335253276186, 6.114124462976733],
    choice: ['b', 'c', 'a', 'f', 'a'],
  },
  '1': {
    random: [
      0.13436424411240122, 0.8474337369372327, 0.763774618976614, 0.2550690257394217,
      0.49543508709194095,
    ],
    getrandbits: [0, 7, 166, 24878, 1693770507, 901749037],
    randbelow: [0, 1, 0, 3, 13, 19, 48, 0, 1912923437],
    randint: [177, 206, 211, 174],
    uniform: [5.469206100078232, -23.866370513397108, -10.954222069416947],
    choice: ['a', 'a', 'f', 'e', 'a'],
  },
  '42': {
    random: [
      0.6394267984578837, 0.025010755222666936, 0.27502931836911926, 0.22321073814882275,
      0.7364712141640124,
    ],
    getrandbits: [1, 11, 228, 35741, 186699713, 2536146025],
    randbelow: [0, 0, 0, 0, 6, 7, 32, 6, 854001193],
    randint: [205, 201, 204, 194],
    uniform: [-4.828810742300476, -3.0474572229687844, -13.308557506160238],
    choice: ['g', 'a', 'g', 'g', 'b'],
  },
  '12345': {
    random: [
      0.41661987254534116, 0.010169169457068361, 0.8252065092537432, 0.2986398551995928,
      0.3684116894884757,
    ],
    getrandbits: [0, 4, 144, 28588, 347221957, 1602297017],
    randbelow: [0, 1, 1, 4, 5, 19, 35, 47, 1524289825],
    randint: [207, 206, 165, 193],
    uniform: [28.718399734224604, -5.272836423641941, 0.2361220866022471],
    choice: ['b', 'b', 'f', 'a', 'b'],
  },
  '2147483646': {
    random: [
      0.4348601517445272, 0.5394133237006469, 0.5875445478551462, 0.042569583408098355,
      0.8252457945475479,
    ],
    getrandbits: [1, 1, 245, 32358, 1476704313, 1546431416],
    randbelow: [0, 1, 2, 3, 2, 11, 29, 96, 1942826497],
    randint: [165, 177, 191, 209],
    uniform: [-2.5023199137082166, -13.106234902440896, -15.759750038974452],
    choice: ['c', 'e', 'b', 'b', 'b'],
  },
}

describe('PythonRandom', () => {
  for (const [seed, vector] of Object.entries(VECTORS)) {
    it(`reproduces CPython's stream for seed ${seed}`, () => {
      // One generator per seed, drained in the same order the vector was: the
      // whole point is that the calls share a stream, not that each starts fresh.
      const rng = new PythonRandom(Number(seed))
      expect(vector.random.map(() => rng.random())).toEqual(vector.random)
      expect(BITS.map((k) => rng.getrandbits(k))).toEqual(vector.getrandbits)
      expect(BELOW.map((n) => rng.randbelow(n))).toEqual(vector.randbelow)
      expect(vector.randint.map(() => rng.randint(160, 220))).toEqual(vector.randint)
      expect(vector.uniform.map(() => rng.uniform(-30, 30))).toEqual(vector.uniform)
      expect(vector.choice.map(() => rng.choice(LETTERS))).toEqual(vector.choice)
    })
  }

  it('is reproducible from the same seed', () => {
    const a = new PythonRandom(7)
    const b = new PythonRandom(7)
    expect([a.random(), a.randbelow(10), a.uniform(0, 1)]).toEqual([
      b.random(),
      b.randbelow(10),
      b.uniform(0, 1),
    ])
  })

  it('rejects an empty range rather than returning a silent 0', () => {
    const rng = new PythonRandom(1)
    expect(() => rng.randrange(5, 5)).toThrow()
    expect(() => rng.choice([])).toThrow()
  })
})

describe('bitLength', () => {
  it('matches int.bit_length()', () => {
    expect([0, 1, 2, 3, 255, 256, 2 ** 31, 2 ** 32 - 1].map(bitLength)).toEqual([
      0, 1, 2, 2, 8, 9, 32, 32,
    ])
  })
})

describe('hsvToRgb', () => {
  // Dumped from colorsys.hsv_to_rgb for the same inputs.
  it('matches colorsys across every sector', () => {
    const cases: Array<[[number, number, number], [number, number, number]]> = [
      [[0, 1, 1], [1, 0, 0]],
      [[1 / 6, 1, 1], [1, 1, 0]],
      [[1 / 3, 1, 1], [0, 1, 0]],
      [[0.5, 1, 1], [0, 1, 1]],
      [[2 / 3, 1, 1], [0, 0, 1]],
      [[5 / 6, 1, 1], [1, 0, 1]],
      [[0.125, 0, 0.4], [0.4, 0.4, 0.4]],
    ]
    for (const [input, expected] of cases) {
      const got = hsvToRgb(...input)
      for (const i of [0, 1, 2]) expect(got[i]).toBeCloseTo(expected[i], 12)
    }
  })
})

describe('pyMod', () => {
  it('takes the divisor sign, unlike JS %', () => {
    expect(pyMod(-0.1, 1)).toBeCloseTo(0.9, 12)
    expect(pyMod(1.2, 1)).toBeCloseTo(0.2, 12)
    expect(-0.1 % 1).toBeCloseTo(-0.1, 12) // the trap this exists for
  })
})
