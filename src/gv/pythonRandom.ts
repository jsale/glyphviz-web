// CPython's `random.Random`, faithfully enough that the same integer seed
// produces the same stream of numbers here as it does on the desktop.
//
// Why this exists: the Hyperglyph Generator's whole model is "Seed + Max Nodes
// + Branch Levels determine the design, always" — the desktop's dialog says so
// in as many words, and unchecking Randomize to lock a seed in for further
// tweaking is the feature. A seed that names one design in GlyphViz and a
// different one in GlyphViz Web would make that number meaningless to write
// down or pass to someone, so the generator is ported down to its RNG rather
// than to `Math.random`.
//
// That means Mersenne Twister (MT19937) plus the exact CPython wrappers around
// it, which are not the obvious ones:
//
//   random()        two 32-bit draws combined into a 53-bit double
//                   (genrand_res53), NOT one draw scaled
//   getrandbits(k)  the TOP k bits of one draw, for the k ≤ 32 the generator
//                   needs (every call here is a small range or a list index)
//   _randbelow(n)   rejection sampling on n.bit_length() bits — it RETRIES,
//                   so the number of draws a call consumes is itself random,
//                   and any shortcut (`floor(random() * n)`) desynchronises
//                   the whole rest of the design
//   randint(a, b)   a + _randbelow(b + 1 - a)
//   choice(seq)     seq[_randbelow(len(seq))]
//
// Verified against the real thing by pythonRandom.test.ts (vectors dumped from
// CPython) and, end to end, by hyperglyph.parity.test.ts.

const N = 624
const M = 397
const MATRIX_A = 0x9908b0df
const UPPER_MASK = 0x80000000
const LOWER_MASK = 0x7fffffff

/** Number of bits in `n`, Python's `int.bit_length()`, for n < 2^32. */
export function bitLength(n: number): number {
  return n <= 0 ? 0 : 32 - Math.clz32(n)
}

export class PythonRandom {
  private readonly mt = new Uint32Array(N)
  private index = N + 1

  /**
   * `random.Random(seed)` for a non-negative integer seed below 2^32 — which
   * is every seed this app produces (the Seed field is CPython's own 0 …
   * 2^31 − 1). Python splits a larger int into 32-bit words and seeds from all
   * of them; one word is that same path with a single-element key.
   */
  constructor(seed: number) {
    this.initByArray([seed >>> 0])
  }

  private initGenrand(s: number): void {
    const mt = this.mt
    mt[0] = s >>> 0
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30)
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0
    }
    this.index = N
  }

  private initByArray(key: readonly number[]): void {
    const mt = this.mt
    this.initGenrand(19650218)
    let i = 1
    let j = 0
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30)
      mt[i] = (((mt[i] ^ Math.imul(prev, 1664525)) >>> 0) + key[j] + j) >>> 0
      i++
      j++
      if (i >= N) {
        mt[0] = mt[N - 1]
        i = 1
      }
      if (j >= key.length) j = 0
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30)
      mt[i] = (((mt[i] ^ Math.imul(prev, 1566083941)) >>> 0) - i) >>> 0
      i++
      if (i >= N) {
        mt[0] = mt[N - 1]
        i = 1
      }
    }
    mt[0] = UPPER_MASK
  }

  /** One raw 32-bit draw (genrand_uint32), tempering included. */
  private genrand(): number {
    const mt = this.mt
    if (this.index >= N) {
      for (let k = 0; k < N; k++) {
        const y = ((mt[k] & UPPER_MASK) | (mt[(k + 1) % N] & LOWER_MASK)) >>> 0
        mt[k] = (mt[(k + M) % N] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      }
      this.index = 0
    }
    let y = mt[this.index++]
    y ^= y >>> 11
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0
    y ^= y >>> 18
    return y >>> 0
  }

  /**
   * `random.random()` — genrand_res53: 27 high bits and 26 high bits from two
   * consecutive draws, giving a full 53-bit mantissa. Scaling a single draw
   * would both lose precision and halve the number of draws consumed.
   */
  random(): number {
    const a = this.genrand() >>> 5
    const b = this.genrand() >>> 6
    return (a * 67108864 + b) / 9007199254740992
  }

  /**
   * `getrandbits(k)` for 1 ≤ k ≤ 32: the TOP k bits of one draw. (JS shifts by
   * `count & 31`, so k = 32 falls out correctly as a plain `>>> 0`.)
   */
  getrandbits(k: number): number {
    if (k < 1 || k > 32) throw new RangeError(`getrandbits: k must be 1..32, got ${k}`)
    return this.genrand() >>> (32 - k)
  }

  /**
   * `Random._randbelow` — a uniform int in [0, n) by REJECTION, not modulo:
   * draw `n.bit_length()` bits and try again while the result is out of range.
   * Note n = 1 still draws (and retries until it sees a 0), which is why
   * `randint(a, a)` is not free.
   */
  randbelow(n: number): number {
    if (n <= 0) return 0
    const k = bitLength(n)
    let r = this.getrandbits(k)
    while (r >= n) r = this.getrandbits(k)
    return r
  }

  /** `randrange(stop)` / `randrange(start, stop)`. */
  randrange(startOrStop: number, stop?: number): number {
    const start = stop === undefined ? 0 : startOrStop
    const end = stop === undefined ? startOrStop : stop
    const width = end - start
    if (width <= 0) throw new RangeError(`randrange: empty range (${start}, ${end})`)
    return start + this.randbelow(width)
  }

  /** `randint(a, b)` — inclusive at both ends, i.e. `randrange(a, b + 1)`. */
  randint(a: number, b: number): number {
    return this.randrange(a, b + 1)
  }

  /** `uniform(a, b)` = `a + (b - a) * random()`, one draw pair. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random()
  }

  /** `choice(seq)` = `seq[_randbelow(len(seq))]`. */
  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new RangeError('choice: empty sequence')
    return seq[this.randbelow(seq.length)]
  }
}

/**
 * `colorsys.hsv_to_rgb`, transcribed. Ported rather than replaced with any
 * equivalent formula because the generator's colours run through it on every
 * level and the `int(h * 6.0)` sector split is where two implementations
 * disagree at the boundaries.
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0) return [v, v, v]
  const i = Math.trunc(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (((i % 6) + 6) % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

/** Python's `%` on floats: the result takes the divisor's sign. */
export function pyMod(a: number, b: number): number {
  const r = a % b
  return r !== 0 && r < 0 !== b < 0 ? r + b : r
}
