// Frame-rate readout, ported from the desktop's status-bar FPS label
// (viewport.py counts frames and emits `fpsUpdated` once elapsed ≥ 1 s;
// main_window.py shows it as `f"{fps:.1f} fps"` in a permanent status-bar
// widget). Same window, same rounding, so a number read here is comparable to
// one read there on the same scene.
//
// Two things are added, because the point of having it in the web app is to
// explain a slow frame rather than just report it:
//
//  - CPU milliseconds per frame — the animation loop's own work (channels and
//    rate integration, overlay buffer rewrites, the draw submission). Compared
//    against the frame budget it separates "our JavaScript is the bottleneck"
//    from "the GPU is", which 1000/fps alone cannot;
//  - draw calls and triangles for the last frame, straight off
//    `renderer.info.render`. Scene size in the HUD says how many nodes exist;
//    this says how much of that reached the GPU, and draw calls in particular
//    are what batching (links, plot/surface overlays, selection halos) exists
//    to hold down.
//
// It draws over the viewport like every other panel, so it can be switched off
// for a screengrab — see the roadmap's screengrab-chrome item.

/** The subset of `THREE.WebGLRenderer.info.render` this reads. */
export interface RenderInfo {
  calls: number
  triangles: number
}

export interface FrameStats {
  /** Frames drawn per second over the last window. */
  fps: number
  /** Mean animation-loop CPU time per frame, ms. */
  avgMs: number
  /** Worst single frame's CPU time in the window, ms. */
  peakMs: number
  calls: number
  triangles: number
}

/** The desktop emits its FPS once elapsed reaches one second. */
export const WINDOW_MS = 1000

/** Thousands separators without depending on the runtime's locale. */
function group(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The two readout lines. Pure, so the formatting is testable on its own. */
export function formatFrameStats(stats: FrameStats): [string, string] {
  return [
    `${stats.fps.toFixed(1)} fps · ${stats.avgMs.toFixed(1)} ms cpu (${stats.peakMs.toFixed(1)} peak)`,
    `${group(stats.calls)} draw calls · ${group(stats.triangles)} tris`,
  ]
}

/**
 * Accumulates frame timings and closes a window once a second — the counting,
 * with no DOM in it, the way `nextPanelMode` holds the panel state machine.
 */
export class FrameSampler {
  private frames = 0
  private windowStart = 0
  private started = false
  private cpuTotal = 0
  private cpuPeak = 0

  /**
   * Record one frame; returns the window's stats on the frame that closes it,
   * and null on every other. `startMs`/`endMs` bracket the animation loop, so
   * the measured span is one whole iteration of our own work — the GPU
   * finishes asynchronously and is not (and cannot be) included.
   */
  frame(startMs: number, endMs: number, info: RenderInfo): FrameStats | null {
    // The first window opens at the first FRAME, not at construction: the loop
    // hands over absolute performance.now() timestamps and may start long
    // after the page did.
    if (!this.started) {
      this.windowStart = startMs
      this.started = true
    }
    this.frames++
    const cpu = endMs - startMs
    this.cpuTotal += cpu
    if (cpu > this.cpuPeak) this.cpuPeak = cpu

    const elapsed = endMs - this.windowStart
    if (elapsed < WINDOW_MS) return null
    const stats: FrameStats = {
      fps: (this.frames * 1000) / elapsed,
      avgMs: this.cpuTotal / this.frames,
      peakMs: this.cpuPeak,
      calls: info.calls,
      triangles: info.triangles,
    }
    this.frames = 0
    this.cpuTotal = 0
    this.cpuPeak = 0
    this.windowStart = endMs
    return stats
  }
}

/** The on-screen readout: a `FrameSampler` and the two lines it paints. */
export class FpsMeter {
  readonly element: HTMLDivElement
  private readonly sampler = new FrameSampler()
  private readonly lines: [HTMLDivElement, HTMLDivElement]
  private shown = true
  /** Latest published stats, or null before the first window closes. */
  private latest: FrameStats | null = null

  constructor() {
    this.element = document.createElement('div')
    this.element.id = 'fps-meter'
    this.element.title =
      'Frames per second over the last second, this app’s own CPU time per frame, ' +
      'and what the last frame sent to the GPU.'
    const line = () => this.element.appendChild(document.createElement('div'))
    this.lines = [line(), line()]
    this.lines[0].textContent = '— fps'
    this.lines[1].textContent = ''
  }

  get visible(): boolean {
    return this.shown
  }

  set visible(value: boolean) {
    this.shown = value
    this.element.hidden = !value
  }

  get stats(): FrameStats | null {
    return this.latest
  }

  /** Record one frame; see `FrameSampler.frame`. */
  frame(startMs: number, endMs: number, info: RenderInfo): void {
    const stats = this.sampler.frame(startMs, endMs, info)
    if (!stats) return
    this.latest = stats
    // Only while on screen: a hidden meter keeps counting (so it is current
    // the moment it comes back) but touches no DOM.
    if (!this.shown) return
    const text = formatFrameStats(stats)
    this.lines[0].textContent = text[0]
    this.lines[1].textContent = text[1]
  }
}
