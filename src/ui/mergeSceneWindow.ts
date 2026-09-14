// The chooser a merge opens when the picked folder or zip holds more than one
// scene (Global_Terrorism_Example holds five). Merging every one of them on top
// of each other is almost never what someone meant, so the set is listed and
// ONE is merged; a set with a single scene never shows this window at all.
//
// The desktop has no counterpart: File ▸ Merge there takes one path, and a
// multi-CSV drop opens the first and merges the rest. A browser hands over a
// whole folder at once, which is the question this window exists to ask.

import { FloatWindow } from './floatWindow'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export interface MergeSceneChoice {
  /** The scene's folder name, else its file name. */
  label: string
  /** The node CSV's path inside the set, so two same-named folders differ. */
  path: string
}

export class MergeSceneWindow {
  readonly element: HTMLDivElement
  private readonly window: FloatWindow
  private readonly intro: HTMLDivElement
  private readonly list: HTMLDivElement
  private readonly onChoose: (index: number) => void

  constructor(onChoose: (index: number) => void) {
    this.onChoose = onChoose
    this.window = new FloatWindow({ id: 'merge-scene-window', title: 'Merge Which Scene?', hotkey: 'Ctrl+M' })
    this.element = this.window.element
    this.intro = el('div', { className: 'merge-scene-intro' })
    this.list = el('div', { className: 'merge-scene-list' })
    const cancel = el('button', {
      className: 'float-window-action',
      id: 'merge-scene-cancel',
      textContent: 'Cancel',
    })
    cancel.addEventListener('click', () => this.close())
    this.window.body.append(this.intro, this.list, cancel)
  }

  get isOpen(): boolean {
    return this.window.isOpen
  }

  open(setName: string, scenes: readonly MergeSceneChoice[]): void {
    this.intro.textContent =
      `${setName} holds ${scenes.length} scenes. Pick the one to merge into the open scene; ` +
      'the others are left alone.'
    this.list.textContent = ''
    scenes.forEach((scene, i) => {
      const button = el('button', {
        className: 'float-window-action merge-scene-choice',
        id: `merge-scene-${i}`,
        title: scene.path,
      })
      button.append(
        el('span', { className: 'merge-scene-label', textContent: scene.label }),
        el('span', { className: 'merge-scene-path', textContent: scene.path }),
      )
      button.addEventListener('click', () => {
        this.close()
        this.onChoose(i)
      })
      this.list.appendChild(button)
    })
    this.window.setOpen(true)
  }

  close(): void {
    this.window.setOpen(false)
  }
}
