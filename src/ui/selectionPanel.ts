// The Select By / Visibility panel, ported from the desktop's side-dock groups
// of the same names (main_window.py). Everything here is presentation: the
// matching and hide-flag rules live in src/gv/selectionOps.ts.

import type { GvNode } from '../gv/types'
import type { CriterionValue, SelectCriterion } from '../gv/selectionOps'
import { CRITERION_LABELS, criterionValues } from '../gv/selectionOps'
import { MAX_TAGS_PER_FRAME } from '../render/labelOverlay'
import type { AudioMode } from '../render/textureLibrary'
import { Panel } from './panel'

export interface SelectionPanelHost {
  selectAll(): void
  deselectAll(): void
  invertSelection(): void
  /** Select the criterion match, honouring the Add-to-Selection checkbox. */
  selectMatching(criterion: SelectCriterion, value: number, additive: boolean): void
  /** Select every node whose tag text contains `keyword` (same checkbox). */
  selectMatchingTags(keyword: string, additive: boolean): void
  hideSelected(): void
  showSelected(): void
  isolateSelected(): void
  showAll(): void
  setShowHidden(showHidden: boolean): void
  setShowTags(showTags: boolean): void
  setTagsSelectedOnly(selectedOnly: boolean): void
  setAudioMode(mode: AudioMode): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, title })
  b.addEventListener('click', onClick)
  return b
}

function checkbox(label: string, title: string): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = el('label', { className: 'sel-check', title })
  const input = el('input', { type: 'checkbox' })
  row.append(input, document.createTextNode(label))
  return { row, input }
}

export class SelectionPanel {
  readonly panel: Panel

  private count = el('div', { className: 'sel-count' })
  private criterion = el('select')
  private value = el('select')
  private additive: HTMLInputElement
  private showHidden: HTMLInputElement
  private showTags: HTMLInputElement
  private tagsSelectedOnly: HTMLInputElement
  private tagCount = el('div', { className: 'sel-hint' })
  private tagKeyword = el('input', { type: 'text', placeholder: 'keyword…' })
  private tagSearchButton: HTMLButtonElement
  private audio = el('select')
  private audioRow: HTMLDivElement
  private selectionButtons: HTMLButtonElement[] = []
  private values: CriterionValue[] = []
  private nodes: GvNode[] = []

  constructor(host: SelectionPanelHost) {
    this.panel = new Panel({ id: 'selection-panel', title: 'Selection', hotkey: 'Ctrl+E' })

    for (const key of Object.keys(CRITERION_LABELS) as SelectCriterion[]) {
      this.criterion.appendChild(el('option', { value: key, textContent: CRITERION_LABELS[key] }))
    }
    this.criterion.addEventListener('change', () => this.refreshValues())

    const addCheck = checkbox(
      'Add to Selection',
      'When checked, Select All Matching ADDS to the current selection instead of\n' +
        'replacing it — e.g. select all spheres, then all cylinders, and keep both.\n' +
        '(Ctrl+click and Ctrl+Shift+drag in the 3D view are always additive.)',
    )
    this.additive = addCheck.input

    const hiddenCheck = checkbox(
      'Show Hidden Nodes',
      'Draw nodes whose hide flag is set, so they can be seen and picked again.',
    )
    this.showHidden = hiddenCheck.input
    this.showHidden.addEventListener('change', () => host.setShowHidden(this.showHidden.checked))

    // Labels are off by default, as on the desktop ("press T to see labels").
    const tagCheck = checkbox(
      'Show Tag Labels',
      'Draw each node’s label text in the viewport  [T]\n' +
        'Labels come from inline text/link columns, or from the companion\n' +
        'gv_tag.csv when the node CSV has neither.',
    )
    this.showTags = tagCheck.input
    this.showTags.addEventListener('change', () => host.setShowTags(this.showTags.checked))

    const tagSelectedCheck = checkbox(
      'Labels of Selected Only',
      'Restrict labels to the current selection.\n' +
        `In show-all mode at most ${MAX_TAGS_PER_FRAME} labels draw per frame (a frame-rate\n` +
        'safety valve); scoping to a selection lifts that cap entirely.',
    )
    this.tagsSelectedOnly = tagSelectedCheck.input
    this.tagsSelectedOnly.addEventListener('change', () =>
      host.setTagsSelectedOnly(this.tagsSelectedOnly.checked),
    )

    // Video soundtracks. The desktop plays every loaded video's audio by
    // default; browsers refuse audible autoplay, so this starts muted and
    // choosing an option supplies the gesture that unmutes.
    for (const [value, label] of [
      ['muted', 'Muted'],
      ['all', 'All Tracks'],
      ['selected', 'Solo to Selection'],
    ] as Array<[AudioMode, string]>) {
      this.audio.appendChild(el('option', { value, textContent: label }))
    }
    this.audio.addEventListener('change', () => host.setAudioMode(this.audio.value as AudioMode))
    this.audioRow = this.labelled('Video Audio', this.audio)
    this.audioRow.title =
      'Soundtracks of video textures in this scene.\n' +
      'Starts muted because browsers block audible autoplay; "Solo to Selection"\n' +
      'plays only videos textured on selected nodes.'
    this.audioRow.hidden = true

    const selectAll = button('Select All', 'Select every node  (Ctrl+A)', () => host.selectAll())
    const deselect = button('Deselect All', 'Clear the selection  (Ctrl+A again, or Esc)', () =>
      host.deselectAll(),
    )
    const invert = button(
      'Invert Selection',
      'Select every node that is not currently selected  (Ctrl+I)\n' +
        'Selected spheres → everything except those spheres, etc.',
      () => host.invertSelection(),
    )
    const matching = button(
      'Select All Matching',
      'Select every node whose chosen field equals the value above.',
      () => {
        const value = Number(this.value.value)
        if (this.value.value === '' || !Number.isFinite(value)) return
        host.selectMatching(this.criterion.value as SelectCriterion, value, this.additive.checked)
      },
    )

    // Tag keyword search — the desktop's "Tag contains:" row, sharing the same
    // Add-to-Selection checkbox as Select All Matching and reporting through
    // the same highlight-in-place mechanism (no separate results list).
    const searchTags = () =>
      host.selectMatchingTags(this.tagKeyword.value, this.additive.checked)
    this.tagKeyword.title = "Case-insensitive substring match against each node's tag text."
    this.tagKeyword.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      searchTags()
    })
    this.tagSearchButton = button(
      'Select Matching Tags',
      'Select every node whose tag text contains the keyword above.\n' +
        'Uses the same "Add to Selection" checkbox as Select All Matching.\n' +
        'Labels come from inline text columns or the companion gv_tag.csv.',
      searchTags,
    )

    const hide = button(
      'Hide Selected',
      'Hide the selected node(s)  [H]\n' +
        "Sets each node's own hide flag — children of a hidden node stay visible\n" +
        'unless hidden themselves. The selection is kept, so Show Selected undoes it.',
      () => host.hideSelected(),
    )
    const show = button('Show Selected', 'Clear the hide flag on the selected node(s).', () =>
      host.showSelected(),
    )
    const isolate = button(
      'Show Only Selected',
      'Isolate the selection: hide every other node in one step  [I]\n' +
        '(Invert Selection + Hide Selected, without disturbing the selection.)',
      () => host.isolateSelected(),
    )
    const showAll = button('Show All', 'Clear the hide flag on every node  [Shift+H]', () =>
      host.showAll(),
    )
    // Invert stays live with nothing selected — that case is Select All, and
    // the desktop leaves its button enabled for exactly that reason.
    this.selectionButtons = [hide, show, isolate]

    const pair = (a: HTMLElement, b: HTMLElement) => {
      const row = el('div', { className: 'sel-pair' })
      row.append(a, b)
      return row
    }

    this.panel.body.append(
      this.count,
      pair(selectAll, deselect),
      invert,
      this.labelled('By', this.criterion),
      this.labelled('Value', this.value),
      matching,
      addCheck.row,
      this.labelled('Tag', this.tagKeyword),
      this.tagSearchButton,
      el('div', { className: 'sel-section', textContent: 'Visibility' }),
      pair(hide, show),
      isolate,
      showAll,
      hiddenCheck.row,
      el('div', { className: 'sel-section', textContent: 'Labels' }),
      tagCheck.row,
      tagSelectedCheck.row,
      this.tagCount,
      this.audioRow,
      el('div', {
        className: 'sel-hint',
        textContent:
          'Ctrl+click toggles one · Shift+drag selects a region · Ctrl+Shift+drag adds a region',
      }),
    )
  }

  private labelled(label: string, control: HTMLElement): HTMLDivElement {
    const row = el('div', { className: 'sel-row' })
    row.append(el('span', { textContent: label }), control)
    return row
  }

  /** Repopulate the value combo, keeping the current choice when it survives. */
  private refreshValues(): void {
    const previous = this.value.value
    this.values = criterionValues(this.nodes, this.criterion.value as SelectCriterion)
    this.value.replaceChildren(
      ...this.values.map((v) => el('option', { value: String(v.value), textContent: v.label })),
    )
    if (this.values.some((v) => String(v.value) === previous)) this.value.value = previous
  }

  /**
   * Re-read the scene: the value combo must follow edits that add or remove
   * geometry/topology/branch-level values, or it keeps offering values nothing
   * matches (and hides new ones).
   */
  update(nodes: GvNode[], selectedCount: number): void {
    this.nodes = nodes
    this.refreshValues()
    this.count.textContent =
      selectedCount === 0 ? 'No selection' : `${selectedCount} node(s) selected`
    for (const b of this.selectionButtons) b.disabled = selectedCount === 0

    const labelled = nodes.filter((n) => n.text !== '').length
    this.tagCount.textContent =
      labelled === 0
        ? 'No labels in this scene'
        : `${labelled} labelled node(s)` +
          (labelled > MAX_TAGS_PER_FRAME ? ` — over the ${MAX_TAGS_PER_FRAME}/frame cap` : '')
    this.showTags.disabled = labelled === 0
    this.tagsSelectedOnly.disabled = labelled === 0
    // Small divergence: the desktop leaves the tag search live and answers
    // "No nodes tagged with …". A scene with no labels at all can never
    // answer anything else, so the row greys out instead — consistent with
    // the label checkboxes right below it, which already do this.
    this.tagKeyword.disabled = labelled === 0
    this.tagSearchButton.disabled = labelled === 0
    this.tagKeyword.placeholder = labelled === 0 ? 'no labels in scene' : 'keyword…'
  }

  /** Keep the checkbox in step when the T key toggles labels. */
  setShowTagsChecked(showTags: boolean): void {
    this.showTags.checked = showTags
  }

  /** The audio control only exists for scenes that actually loaded a video. */
  setVideoCount(count: number): void {
    this.audioRow.hidden = count === 0
  }
}
