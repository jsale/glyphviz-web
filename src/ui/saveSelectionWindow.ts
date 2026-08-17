// Save Selection — the options window in front of the export, ported from the
// desktop's glyphviz_gl/save_selection_dialog.py.
//
// Collects the three choices src/gv/selectionExport.ts offers (plus the channel
// companions, which are a file decision rather than a node-list one) and shows,
// live, exactly which rows each combination would write. The preview runs
// planSelection — set walks over the node list, no copying — rather than the
// full build, so toggling an option stays instant on a large scene.
//
// The window decides nothing else: main.ts owns the filenames and the actual
// write, the same division basemapWindow already uses.
//
// A FloatWindow rather than a docked panel, and modeless where the desktop is
// exec()-modal: the same call the Hyperglyph Generator and the Glyph Composer
// made. Nothing here touches the scene, so nothing is lost by letting the user
// look at what they selected while the options are open.

import type { ExportOptions, SelectionPlan } from '../gv/selectionExport'
import { DEFAULT_EXPORT_OPTIONS, Detach, describePlan, planSelection } from '../gv/selectionExport'
import type { GvNode } from '../gv/types'
import { FloatWindow } from './floatWindow'

export interface SaveSelectionHost {
  /** Write the export. `includeChannels` is the ch-map/ch-tracks checkbox. */
  onSave(options: ExportOptions, includeChannels: boolean): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

function checkbox(
  label: string,
  title: string,
  checked: boolean,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = el('label', { className: 'sel-check', title })
  const input = el('input', { type: 'checkbox' })
  input.checked = checked
  row.append(input, document.createTextNode(label))
  return { row, input }
}

function radio(
  name: string,
  label: string,
  title: string,
  value: string,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = el('label', { className: 'sel-check', title })
  const input = el('input', { type: 'radio' })
  input.name = name
  input.value = value
  row.append(input, document.createTextNode(label))
  return { row, input }
}

export class SaveSelectionWindow {
  private readonly window: FloatWindow
  private readonly host: SaveSelectionHost

  private nodes: readonly GvNode[] = []
  private selected: ReadonlySet<number> = new Set()
  private hasChannels = false

  private readonly descendants: HTMLInputElement
  private readonly bake: HTMLInputElement
  private readonly ancestors: HTMLInputElement
  private readonly raw: HTMLInputElement
  private readonly world: HTMLInputElement
  private readonly channels: HTMLInputElement
  private readonly channelsRow: HTMLLabelElement
  private readonly preview: HTMLDivElement
  private readonly saveButton: HTMLButtonElement

  constructor(host: SaveSelectionHost) {
    this.host = host
    this.window = new FloatWindow({
      id: 'save-selection-window',
      title: 'Save Selection',
      hotkey: 'Ctrl+Alt+S',
    })

    const descend = checkbox(
      "Include each selected node's descendants",
      'Selecting a node brings its whole subtree, the way Copy and Delete\n' +
        'already do. Turn this off to write only the highlighted rows.',
      DEFAULT_EXPORT_OPTIONS.includeDescendants,
    )
    this.descendants = descend.input

    const group = el('div', { className: 'save-sel-group' })
    group.append(
      el('div', {
        className: 'sel-section',
        textContent: "When a selected node's parent is not included",
      }),
    )
    const bake = radio(
      'save-selection-detach',
      'Keep it where it is (bake world placement)',
      "Fold the missing parents' placement into the node itself, so the saved\n" +
        'fragment reopens exactly where, and at the size and angle, it appeared\n' +
        'here. Its own children are unaffected.',
      Detach.Bake,
    )
    const ancestors = radio(
      'save-selection-detach',
      'Save its parent nodes too',
      'Write the ancestor chain as well, so the hierarchy is intact.\n' +
        'Perfectly faithful, but the file then holds glyphs you did not select.',
      Detach.Ancestors,
    )
    const raw = radio(
      'save-selection-detach',
      'Keep its authored values (template export)',
      'Leave translate/rotate/scale exactly as authored. The fragment lands near\n' +
        "the origin in its old parent's local coordinates — what you want when\n" +
        'reusing a glyph as a template, not when saving a region of a scene.',
      Detach.Raw,
    )
    this.bake = bake.input
    this.ancestors = ancestors.input
    this.raw = raw.input
    this.bake.checked = true
    group.append(bake.row, ancestors.row, raw.row)

    const world = checkbox(
      'Include scene settings (background, fog, tag colors)',
      'Carries the World row, which holds the scene-wide look. Without it the\n' +
        'fragment reopens on the default background.',
      DEFAULT_EXPORT_OPTIONS.includeWorldRow,
    )
    this.world = world.input

    const channels = checkbox(
      'Include channel animation for these nodes',
      'Write ch-map/ch-tracks companions holding only the channels the exported\n' +
        'nodes are bound to.',
      false,
    )
    this.channels = channels.input
    this.channelsRow = channels.row

    for (const input of [
      this.descendants,
      this.bake,
      this.ancestors,
      this.raw,
      this.world,
    ]) {
      input.addEventListener('change', () => this.refreshPreview())
    }

    this.preview = el('div', { className: 'save-sel-preview' })

    // Plain buttons inside `.hud-create-buttons`, which is what styles them —
    // a bare <button> renders as an unstyled default-white browser one (the
    // Draw Mode lesson).
    this.saveButton = el('button', {
      type: 'button',
      textContent: 'Save…',
      title: 'Write the node CSV (and its tag/channel companions) as downloads.',
    })
    this.saveButton.addEventListener('click', () => {
      this.window.setOpen(false)
      this.host.onSave(this.currentOptions(), this.includeChannels)
    })
    const cancel = el('button', { type: 'button', textContent: 'Cancel' })
    cancel.addEventListener('click', () => this.window.setOpen(false))
    const actions = el('div', { className: 'hud-create-buttons' })
    actions.append(this.saveButton, cancel)

    this.window.body.append(descend.row, group, world.row, this.channelsRow, this.preview, actions)
  }

  get element(): HTMLElement {
    return this.window.element
  }

  get isOpen(): boolean {
    return this.window.isOpen
  }

  close(): void {
    this.window.setOpen(false)
  }

  /**
   * Whether to write ch-map/ch-tracks companions alongside the node CSV.
   * Handled by main.ts, not by the export itself: it is a file operation on the
   * open scene's companions, not a node-list decision.
   */
  get includeChannels(): boolean {
    return this.hasChannels && this.channels.checked
  }

  currentOptions(): ExportOptions {
    return {
      includeDescendants: this.descendants.checked,
      detach: this.ancestors.checked
        ? Detach.Ancestors
        : this.raw.checked
          ? Detach.Raw
          : Detach.Bake,
      includeWorldRow: this.world.checked,
    }
  }

  /** The plan the preview is currently showing — what Save would write. */
  plan(): SelectionPlan {
    return planSelection(this.nodes, this.selected, this.currentOptions())
  }

  /** Point the window at the live scene and selection, and show it. */
  open(nodes: readonly GvNode[], selected: ReadonlySet<number>, hasChannels: boolean): void {
    this.nodes = nodes
    this.selected = new Set(selected)
    this.hasChannels = hasChannels
    this.channels.checked = hasChannels
    this.channels.disabled = !hasChannels
    this.channelsRow.title = hasChannels
      ? 'Write ch-map/ch-tracks companions holding only the channels the exported\n' +
        'nodes are bound to.'
      : 'This scene has no channel animation loaded.'
    this.refreshPreview()
    this.window.setOpen(true)
  }

  private refreshPreview(): void {
    const plan = this.plan()
    this.preview.textContent = describePlan(plan, this.selected.size)
    this.saveButton.disabled = plan.count === 0
  }
}
