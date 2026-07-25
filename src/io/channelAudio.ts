// Audio-synced Channels playback.
//
// A scene folder may hold a one-line manifest named `<anything>_gv_audio.txt`
// naming an audio file relative to the node CSV's folder. When one is present
// the frame index is driven by that file's REAL playback position instead of an
// FPS timer, so a slow frame costs smoothness and never sync — the desktop's
// _ch_tick_audio_synced, ported.
//
// Browsers refuse to start audible playback without a user gesture; here the
// gesture is pressing Play, which is exactly when playback starts, so nothing
// special is needed beyond reporting a refusal rather than silently desyncing.

export class ChannelAudio {
  private element: HTMLAudioElement | null = null
  private objectUrl: string | null = null

  /** File name shown in the panel, or null when no audio is loaded. */
  name: string | null = null

  get loaded(): boolean {
    return this.element !== null
  }

  /** Point at an audio blob (from a dropped folder) or a URL. */
  load(source: Blob | string, name: string): void {
    this.unload()
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    if (typeof source !== 'string') this.objectUrl = url
    const element = new Audio(url)
    element.preload = 'auto'
    element.load()
    this.element = element
    this.name = name
  }

  unload(): void {
    if (this.element) {
      this.element.pause()
      this.element.removeAttribute('src')
      this.element.load()
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.element = null
    this.objectUrl = null
    this.name = null
  }

  /** Start (or resume) playback. Rejection means the browser blocked it. */
  play(loop: boolean): Promise<void> {
    if (!this.element) return Promise.resolve()
    this.element.loop = loop
    return this.element.play()
  }

  pause(): void {
    this.element?.pause()
  }

  stop(): void {
    if (!this.element) return
    this.element.pause()
    this.element.currentTime = 0
  }

  /**
   * Position through the file, 0–1. Returns null while the duration is still
   * unknown (metadata not yet parsed) — the caller must not advance then, or
   * the animation snaps to frame 0 on the first tick after Play.
   */
  positionFraction(): number | null {
    const element = this.element
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return null
    return Math.min(1, element.currentTime / element.duration)
  }

  seekFraction(fraction: number): void {
    const element = this.element
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return
    element.currentTime = Math.max(0, Math.min(1, fraction)) * element.duration
  }

  get ended(): boolean {
    return this.element?.ended ?? false
  }
}

/**
 * Read a `_gv_audio.txt` manifest: one line holding a path relative to the node
 * CSV's folder. Blank content means "no audio", as on the desktop.
 */
export function parseAudioManifest(text: string): string | null {
  const line = text.trim()
  return line === '' ? null : line
}
