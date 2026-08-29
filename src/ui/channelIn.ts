// Wording for the Properties panel's "channel in" row — the control that points
// a node at one of the scene's Channels channels (ch_input_id).
//
// Ported from the desktop's `_channel_ids_hint` / `_refresh_channel_in_row` /
// `_on_insp_ch_in_changed` (main_window.py). Pure text, no DOM in it, so it
// tests in plain node the way nextPanelMode and FrameSampler do; the row itself
// is ui/inspector.ts and the rebinding is main.ts.
//
// The hint carries the DISCOVERY half of the feature: a channel id is a bare
// number with nothing on screen to check it against, so the row says how many
// channels the file has, which ids they use, and what the chosen one drives.

export interface ChannelInState {
  /** Channel ids the loaded ch-map offers, ascending. Empty = no channel file. */
  channelIds: number[]
  /** The value the control shows — the primary node's, by the panel's rule. */
  value: number
  /** The selection does not agree on one value. */
  mixed: boolean
  /** What `value` drives, when the map has it (channelAttributes' answer). */
  attributes: string[]
}

/**
 * The available channel ids as short display text — `1–64` when they run
 * contiguously (the usual generated case), else a few listed with a count of
 * the rest. The desktop's own thresholds.
 */
export function channelIdsHint(ids: readonly number[]): string {
  if (ids.length === 0) return ''
  if (ids.length > 1 && ids[ids.length - 1] - ids[0] === ids.length - 1) {
    return `${ids[0]}–${ids[ids.length - 1]}`
  }
  const shown = ids.slice(0, 6).join(', ')
  return ids.length <= 6 ? shown : `${shown}, +${ids.length - 6} more`
}

/** The line under the row: what this binding is, against what the file offers. */
export function channelInHint(state: ChannelInState): string {
  const mixed = state.mixed ? ' (selection differs)' : ''
  if (state.channelIds.length === 0) return `no channel file loaded${mixed}`
  if (state.value === 0) {
    return (
      `not animated — ${state.channelIds.length} channels available ` +
      `(${channelIdsHint(state.channelIds)})${mixed}`
    )
  }
  if (state.channelIds.includes(state.value)) {
    const drives =
      state.attributes.length > 0 ? state.attributes.join(', ') : 'nothing GlyphViz can bind'
    return `drives ${drives}${mixed}`
  }
  return `no channel ${state.value} in this file (${channelIdsHint(state.channelIds)})${mixed}`
}

/**
 * One entry in the channel menu: the id, and what it drives.
 *
 * Divergence from the desktop's bare spin box, and the same one the texture row
 * already makes: this app knows the loaded ch-map, so it can offer the channels
 * that exist by name instead of asking for a number typed blind. An id the map
 * does not have is still authorable — it comes through as an "Unknown" entry,
 * because a scene may legitimately be wired up before its channel file exists.
 */
export function channelOptionLabel(id: number, attributes: readonly string[]): string {
  if (id === 0) return 'none (0)'
  return attributes.length > 0 ? `${id} · ${attributes.join(', ')}` : `${id} · (no bindable attribute)`
}

/** What the status line says after the row is used. The desktop's wording. */
export function channelBindingMessage(subject: string, state: ChannelInState): string {
  if (state.value === 0) return `${subject}: channel binding cleared — back to saved values.`
  if (state.channelIds.length === 0) {
    return (
      `${subject}: channel ${state.value} recorded. No channel file is loaded, so nothing ` +
      'animates yet; the id saves with the scene.'
    )
  }
  if (state.channelIds.includes(state.value)) {
    return (
      `${subject}: bound to channel ${state.value}` +
      (state.attributes.length > 0
        ? ` — driving ${state.attributes.join(', ')}.`
        : ' — but it maps no attribute GlyphViz can bind.')
    )
  }
  return (
    `${subject}: channel ${state.value} is not in this scene's ch-map ` +
    `(it has ${channelIdsHint(state.channelIds)}).`
  )
}
