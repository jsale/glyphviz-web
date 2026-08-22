// The Channels playback panel, ported from the desktop's side-dock "Channels"
// group (main_window.py): frame readout + slider, Play/Pause, Stop, an FPS
// slider (1–30, default 30) and a Loop checkbox (default on).
//
// The panel only exists for scenes that have something to play — channel
// bindings, or nodes carrying a nonzero *_rate that the integrator moves. The
// desktop hides its group the same way.
//
// Everything here is presentation; the clock, the frame index and the binding
// application live with the host (src/main.ts and src/gv/channels.ts).

import { Panel } from './panel'

export interface ChannelsPanelHost {
  togglePlay(): void
  stop(): void
  seek(frame: number): void
  setFps(fps: number): void
  setLoop(loop: boolean): void
  setMotion(enabled: boolean): void
}

export const DEFAULT_CHANNEL_FPS = 30

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export class ChannelsPanel {
  readonly panel: Panel

  private frameLabel = el('div', { className: 'ch-frame', textContent: 'Frame: 0 / 0' })
  private slider = el('input', { type: 'range', min: '0', max: '0', value: '0' })
  private playButton: HTMLButtonElement
  private stopButton: HTMLButtonElement
  private fps = el('input', { type: 'range', min: '1', max: '30', value: String(DEFAULT_CHANNEL_FPS) })
  private fpsReadout = el('span', { className: 'ch-fps-value', textContent: '30 fps' })
  private fpsRow: HTMLDivElement
  private loop: HTMLInputElement
  private loopRow: HTMLLabelElement
  private motionRow: HTMLLabelElement
  private motion: HTMLInputElement
  private note = el('div', { className: 'sel-hint' })
  private frameCount = 0

  constructor(host: ChannelsPanelHost) {
    this.panel = new Panel({ id: 'channels-panel', title: 'Channels', hotkey: 'Alt+C' })
    this.panel.element.hidden = true

    this.slider.className = 'ch-slider'
    this.slider.title = 'Scrub to a frame. Frame indices clamp to [0, frames − 1].'
    this.slider.addEventListener('input', () => host.seek(Number(this.slider.value)))

    this.playButton = el('button', {
      type: 'button',
      className: 'ch-transport',
      textContent: '▶',
      title: 'Play / Pause channel animation  [Space]',
    })
    this.playButton.addEventListener('click', () => host.togglePlay())

    this.stopButton = el('button', {
      type: 'button',
      className: 'ch-transport',
      textContent: '■',
      title: 'Stop: reset to frame 0 and restore the CSV values  [Shift+Space]',
    })
    this.stopButton.addEventListener('click', () => host.stop())

    const transport = el('div', { className: 'ch-transport-row' })
    transport.append(this.playButton, this.stopButton)

    this.fps.title = 'Desired playback speed in frames per second'
    this.fps.addEventListener('input', () => {
      const value = Number(this.fps.value)
      this.fpsReadout.textContent = `${value} fps`
      host.setFps(value)
    })
    this.fpsRow = el('div', { className: 'ch-row' })
    this.fpsRow.append(el('span', { textContent: 'FPS' }), this.fps, this.fpsReadout)

    this.loopRow = el('label', {
      className: 'sel-check',
      title: 'Restart at frame 0 after the last frame. Off: playback pauses on the last frame.',
    })
    this.loop = el('input', { type: 'checkbox', checked: true })
    this.loop.addEventListener('change', () => host.setLoop(this.loop.checked))
    this.loopRow.append(this.loop, document.createTextNode('Loop'))

    this.motionRow = el('label', {
      className: 'sel-check',
      title:
        'Integrate translate_rate / rotate_rate / scale_rate.  [P]\n' +
        'These are velocities, not values: the scene keeps moving while this is on,\n' +
        'with or without Channels.\n\n' +
        'Turning it off freezes every rate-animated node where it stands, by setting\n' +
        'the rate fields themselves to zero — so a Save made while paused writes a\n' +
        'genuinely static file (e.g. to keep a Hyperglyph mid-evolution), not one\n' +
        'that merely looked still. Turning it back on restores the original rates.',
    })
    this.motion = el('input', { type: 'checkbox', checked: true })
    this.motion.addEventListener('change', () => host.setMotion(this.motion.checked))
    this.motionRow.append(this.motion, document.createTextNode('Rate Motion  [P]'))

    this.panel.body.append(
      this.frameLabel,
      this.slider,
      transport,
      this.fpsRow,
      this.loopRow,
      this.motionRow,
      this.note,
    )
  }

  /**
   * Point the panel at a newly loaded scene. `frames` of 0 means no channel
   * bindings — the transport disables but the panel can still appear for a
   * scene whose only animation is rate integration.
   */
  setScene(options: { frames: number; rateNodes: number; audioName?: string }): void {
    this.frameCount = options.frames
    const hasChannels = options.frames > 0

    this.slider.max = String(Math.max(0, options.frames - 1))
    this.slider.value = '0'
    this.slider.disabled = !hasChannels
    this.playButton.disabled = !hasChannels
    this.stopButton.disabled = !hasChannels
    // With no channel bindings the panel is here only for rate motion, so
    // every transport control stands down and only that checkbox remains.
    this.frameLabel.hidden = !hasChannels
    this.slider.hidden = !hasChannels
    this.playButton.parentElement!.hidden = !hasChannels
    this.loopRow.hidden = !hasChannels
    this.setFrame(0)
    this.setPlaying(false)

    // Audio-synced playback drives the frame index from the audio's real
    // position, so the FPS setting has nothing left to control.
    const synced = options.audioName !== undefined
    this.fpsRow.hidden = !hasChannels || synced
    if (hasChannels) {
      this.note.textContent = synced
        ? `Synced to ${options.audioName}. Playback follows the audio's real position, not the FPS setting.`
        : `${options.frames} frames. Values are absolute per frame — no interpolation between them.`
    }
    this.setRateNodes(options.rateNodes)
  }

  /**
   * How many nodes currently carry a nonzero rate, without disturbing playback.
   *
   * Rates became authorable from the Properties panel, so a scene that loaded
   * with none can acquire one — and lose its last one — at any time. The Rate
   * Motion checkbox is the only way to stop that motion once it starts, so it
   * (and, for a channel-less scene, the whole panel) has to follow the count
   * rather than the load. Everything else `setScene` does resets the transport
   * to frame 0, which a scene playing at the time must not lose; hence the
   * narrow entry point, with setScene delegating to it.
   */
  setRateNodes(count: number, paused = false): void {
    const hasChannels = this.frameCount > 0
    this.panel.element.hidden = !hasChannels && count === 0
    this.motionRow.hidden = count === 0
    if (!hasChannels) {
      this.note.textContent = paused
        ? `${count} node(s) with a rate, frozen at zero — press P to resume.`
        : `${count} node(s) with a nonzero rate.`
    }
  }

  /**
   * Show the pause state the P key just set, without re-running the change
   * handler that would bounce it straight back to the host.
   */
  setMotionChecked(enabled: boolean): void {
    this.motion.checked = enabled
  }

  setFrame(frame: number): void {
    const last = Math.max(0, this.frameCount - 1)
    this.frameLabel.textContent = `Frame: ${frame} / ${last}`
    if (this.slider.value !== String(frame)) this.slider.value = String(frame)
  }

  setPlaying(playing: boolean): void {
    this.playButton.textContent = playing ? '⏸' : '▶'
  }

  get fpsValue(): number {
    return Number(this.fps.value)
  }

  get loopValue(): boolean {
    return this.loop.checked
  }
}
