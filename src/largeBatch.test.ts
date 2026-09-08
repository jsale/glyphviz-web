// A guard for one measured crash: spreading a large array into a call.
//
// `currentNodes.push(...nodes)` reads perfectly well and is what every one of
// this app's seven scene-append sites used to say. It passes one ARGUMENT per
// element, and V8 overflows its stack somewhere between 101,000 and 150,000 of
// them — so it worked for every generator this app had until the point-cloud
// importer arrived, and then Jeff's 150,000-point import died with "Maximum
// call stack size exceeded". Measured on the desktop's aerial survey: 101,000
// imported fine, 150,000 did not.
//
// Nothing about the shape of that line says it has a limit, which is why this
// is a source-text test rather than a behavioural one. There is no unit to call
// — the fault lives at the call sites in main.ts, which has no exports — and a
// test that appends 150,000 nodes would prove the loader is fine (it always
// was) rather than the caller. `appendNodes` is the one way in; this asserts it
// stayed that way.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MAIN = new URL('./main.ts', import.meta.url)

describe('appending a large batch of nodes', () => {
  const source = readFileSync(MAIN, 'utf8')

  it('never spreads a node batch into push', () => {
    // Any `push(...x)` onto the scene array, however it is spelled.
    const spreads = source.match(/currentNodes\s*\.\s*push\s*\(\s*\.\.\./g) ?? []
    expect(
      spreads,
      'Use appendNodes(nodes) — a spread passes one argument per node and ' +
        'overflows the stack past ~101,000 of them.',
    ).toEqual([])
  })

  it('routes every scene append through the one helper', () => {
    // If this count drops to zero the helper has been inlined away and the
    // guard above is watching nothing.
    const calls = source.match(/\bappendNodes\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(7)
  })

  it('appends with a loop, which has no argument limit', () => {
    expect(source).toMatch(/function appendNodes\([^)]*\)[^{]*\{\s*\n\s*for \(const node of nodes\) currentNodes\.push\(node\)/)
  })
})
