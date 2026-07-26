import { describe, expect, it } from 'vitest'
import { nextPanelMode } from './panel'
import type { PanelMode } from './panel'

// The Panel class itself needs a DOM (this suite runs in plain node), so what
// is tested here is the state machine the hotkey drives.
describe('nextPanelMode', () => {
  /** Modes a run of hotkey presses walks through, starting from `mode`. */
  function presses(mode: PanelMode, shrinking: boolean, n: number): PanelMode[] {
    const walk: PanelMode[] = []
    for (let i = 0; i < n; i++) {
      const next = nextPanelMode(mode, shrinking)
      mode = next.mode
      shrinking = next.shrinking
      walk.push(mode)
    }
    return walk
  }

  it('cycles open → collapsed → closed → open', () => {
    expect(presses('open', false, 4)).toEqual(['collapsed', 'closed', 'open', 'collapsed'])
  })

  it('opens a panel that was already parked when the key is first pressed', () => {
    // The Node Table's case: it boots collapsed so its bar can advertise
    // Alt+N, and that first press must not answer by closing it.
    expect(presses('collapsed', false, 4)).toEqual(['open', 'collapsed', 'closed', 'open'])
    expect(presses('closed', false, 2)).toEqual(['open', 'collapsed'])
  })

  it('reaches every mode from every starting point', () => {
    for (const start of ['open', 'collapsed', 'closed'] as PanelMode[]) {
      expect(new Set(presses(start, false, 4))).toEqual(
        new Set(['open', 'collapsed', 'closed']),
      )
    }
  })
})
