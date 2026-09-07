// Import Point Cloud window — the GUI around gv/pointCloudLoader, ported from
// desktop glyphviz_gl/point_cloud_dialog.py.
//
// The window's real job is not collecting options; it is showing what is
// actually IN the file before the user commits. A LIDAR tile arrives with ten
// million points, coordinates in the hundreds of thousands, and colour that may
// or may not exist — and every one of those facts changes what a sensible import
// looks like. So the flow is: scan, report, then offer the choices that report
// makes meaningful.
//
// A FloatWindow rather than a docked panel, like the Basemap window: form-shaped
// and modeless, where the desktop is `exec()`-modal. All the actual work is in
// gv/pointCloudLoader.ts, which is DOM-free; wiring the result into the scene
// (id rebasing, the rebuild, the selection, the camera) stays in main.ts, which
// owns those structures — the same split as the desktop's dialog vs MainWindow.
//
// WEB-SIDE DIFFERENCE, and it is the one the platform actually earns. The
// desktop reads SYNCHRONOUSLY under a wait cursor, and says why: a QThread
// destroyed with its dialog aborts the process, and every arrangement of
// parenting and joining traded that crash for a hang somewhere else. A browser
// has none of that hazard — this is async throughout, the window stays live, and
// a scan that takes a second does not freeze the app behind it.
//
// It also DECOMPRESSES ONCE. A LAZ scan has to decode the file to count classes,
// and the desktop then re-reads it to import; here the decoded records are held
// for the life of the window, so changing an option and importing again costs
// nothing. On the desktop's own 442,767-point example that is 218 ms saved per
// press, and seconds on a real tile.

import {
  COLOR_MODES,
  DEFAULT_MAX_POINTS,
  DEFAULT_WORLD_SPAN,
  buildFromData,
  classCounts,
  className,
  extensionOf,
  loadPointCloud,
  pointsFromLasFile,
  spanOf,
} from '../gv/pointCloudLoader'
import type {
  ColorMode,
  DecimateMethod,
  ImportReport,
  PointCloudData,
} from '../gv/pointCloudLoader'
import { LAS_EXTENSIONS, lasAllClassifications, lasHasAnyColor, openLasFile } from '../io/lasFile'
import type { LasFile } from '../io/lasFile'
import type { GvNode } from '../gv/types'
import { FloatWindow, windowRow } from './floatWindow'

/**
 * Point counts the target box steps through. The top of the range is
 * deliberately reachable but signposted: 100k is comfortable, 250k works and is
 * slow to save, past that the node model (not the renderer) gives out.
 */
const POINT_TARGET_MIN = 1_000
const POINT_TARGET_MAX = 500_000
/**
 * One click of the arrows. 10,000 was the desktop's first choice and is too fine
 * for a range that runs to half a million — Jeff's own report there: climbing
 * from the 100,000 default toward a 442,767-point file meant ~34 clicks. 50,000
 * crosses the whole range in ten, and an exact count is typed rather than
 * clicked.
 */
const POINT_TARGET_STEP = 50_000

export interface PointCloudApplyPayload {
  nodes: GvNode[]
  report: ImportReport
  fileName: string
}

export interface PointCloudWindowHost {
  onApply(payload: PointCloudApplyPayload): void
  /** The id the imported parent should take — `max(existing) + 1` at import time. */
  nextNodeId(): number
}

interface ScanSummary {
  points: number
  span: [number, number, number]
  hasRgb: boolean
  hasClassification: boolean
  hasIntensity: boolean
  version: string
  crs: string
  /** code → (name, count). Empty when the file carries no classification. */
  classes: Map<number, [string, number]>
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

const COLOR_LABELS: Record<ColorMode, string> = {
  auto: 'Automatic',
  rgb: 'File RGB colour',
  classification: 'Classification (ground/vegetation/building…)',
  elevation: 'Elevation ramp',
  intensity: 'Return intensity',
}

const METHOD_LABELS: Record<DecimateMethod, string> = {
  random: 'Random sample (even, unbiased)',
  voxel: 'Voxel grid (even spatial density)',
  stride: 'Every Nth point (fastest)',
}
/** The desktop's combo order, which is not the order the tuple declares. */
const METHOD_ORDER: DecimateMethod[] = ['random', 'voxel', 'stride']

export class PointCloudWindow {
  private readonly window: FloatWindow
  private readonly host: PointCloudWindowHost

  private file: File | null = null
  private summary: ScanSummary | null = null
  /** The decompressed LAS/LAZ records, held so a re-import never decodes twice. */
  private las: LasFile | null = null
  private bytes: Uint8Array | null = null
  private busy = false
  private epoch = 0

  private readonly title: HTMLSpanElement
  private readonly info: HTMLDivElement
  private readonly target: HTMLInputElement
  private readonly method: HTMLSelectElement
  private readonly color: HTMLSelectElement
  private readonly pointSize: HTMLInputElement
  private readonly span: HTMLInputElement
  private readonly exaggeration: HTMLInputElement
  private readonly classGroup: HTMLDivElement
  private readonly classEnable: HTMLInputElement
  private readonly classList: HTMLDivElement
  private readonly status: HTMLDivElement
  private readonly importButton: HTMLButtonElement

  constructor(host: PointCloudWindowHost) {
    this.host = host
    this.window = new FloatWindow({
      id: 'point-cloud-window',
      title: 'Import Point Cloud',
      hotkey: '',
      className: 'point-cloud-window',
    })
    this.title = this.window.element.querySelector('.float-window-title')!

    this.info = el('div', { className: 'basemap-preview' })

    this.target = el('input', { type: 'number' })
    this.target.min = String(POINT_TARGET_MIN)
    this.target.max = String(POINT_TARGET_MAX)
    this.target.step = String(POINT_TARGET_STEP)
    this.target.value = String(DEFAULT_MAX_POINTS)
    this.target.title =
      'How many points to keep.\n\n' +
      'Every point becomes a real node — clickable, taggable, animatable. The ' +
      'renderer is not the limit: it draws a 57,600-point cloud at 93 fps for ' +
      '1.1 ms of CPU a frame, in ONE draw call. The cost is memory and disk — ' +
      'roughly 2 KB and 90 bytes per point.'
    // 'change', not 'input': typing "442767" would otherwise recompute the
    // sampling ratio six times, once per keystroke, on nonsense intermediates.
    // The desktop reaches the same place with setKeyboardTracking(False).
    this.target.addEventListener('change', () => this.refreshInfo())

    this.method = el('select')
    for (const key of METHOD_ORDER) {
      this.method.appendChild(el('option', { value: key, textContent: METHOD_LABELS[key] }))
    }
    this.method.title =
      'How to choose which points to keep.\n\n' +
      'Random is reproducible and unbiased — the safe default.\n' +
      'Voxel evens out density in 3-D, so it reaches more of the cloud’s ' +
      'occupied volume than a random sample of the same size. Because the grid ' +
      'is volumetric it shifts points off flat ground and onto structure — ' +
      'trees, buildings — which is usually what you want to look at. Takes ' +
      'about twice as long.\n' +
      'Every Nth is fastest, but a file written in acquisition order can alias ' +
      'against the scan pattern and sample stripes.'
    this.method.addEventListener('change', () => this.refreshInfo())

    this.color = el('select')
    for (const key of COLOR_MODES) {
      this.color.appendChild(el('option', { value: key, textContent: COLOR_LABELS[key] }))
    }
    this.color.title =
      'Automatic picks the file’s own RGB when it has any, then classification ' +
      'when the file is genuinely classified, then an elevation ramp. Most ' +
      'public LIDAR has no RGB at all.'

    this.pointSize = numberInput(1, 64, 0.5, 2)
    this.pointSize.title =
      'Rendered size of every point in the cloud, in pixels.\n\n' +
      'Stored on the cloud’s parent node as ratio = size / 20, and editable ' +
      'there afterwards. One size per cloud: the whole cloud is one draw call.'

    this.span = numberInput(1, 100_000, 10, DEFAULT_WORLD_SPAN)
    this.span.title =
      'World-space width the scan is scaled to, measured across its larger ' +
      'horizontal axis.\n\n' +
      '360 is GlyphViz’s own 1:1 frame — the width of a default World Grid — so ' +
      'the scan lands at the same scale as everything else. The scale is ' +
      'uniform across all three axes; the scan is never stretched.'

    this.exaggeration = numberInput(0.1, 50, 0.5, 1)
    this.exaggeration.title =
      'Vertical exaggeration, applied to Z only.\n\n' +
      '1.0 is truthful. Terrain work routinely uses 2–3× because a 200 m relief ' +
      'spread over 4 km reads as flat otherwise — but it IS a distortion, so it ' +
      'is off by default.'

    this.classEnable = el('input', { type: 'checkbox' })
    this.classEnable.addEventListener('change', () => {
      this.syncClassEnabled()
      this.refreshInfo()
    })
    const classHead = el('label', { className: 'sel-check' })
    classHead.append(this.classEnable, el('span', { textContent: 'Keep only these classes' }))
    classHead.title =
      'Import only the ticked classes.\n\n' +
      'Dropping ground (class 2) is the usual first move on an aerial tile: it ' +
      'is most of the points, and removing it reveals the buildings and canopy ' +
      'underneath. The filter runs BEFORE the sample, so the point budget is ' +
      'spent on the classes you chose.'

    this.classList = el('div', { className: 'pc-class-list' })
    const classButtons = el('div', { className: 'basemap-buttons' })
    for (const [label, state] of [
      ['All', true],
      ['None', false],
    ] as const) {
      const button = el('button', {
        type: 'button',
        className: 'float-window-action pc-class-button',
        textContent: label,
      })
      button.addEventListener('click', () => {
        for (const box of this.classBoxes()) box.checked = state
        this.refreshInfo()
      })
      classButtons.appendChild(button)
    }
    this.classGroup = el('div', { className: 'save-sel-group pc-class-group' })
    this.classGroup.append(classHead, this.classList, classButtons)
    this.classGroup.hidden = true

    this.status = el('div', { className: 'basemap-status' })

    this.importButton = el('button', {
      // An id, not just a class: the All / None buttons in the class group are
      // `.float-window-action` too, so the one button that COMMITS the import
      // has to be addressable on its own — by a drive script, and by anyone
      // reading the DOM to work out which control is which.
      id: 'pc-import',
      type: 'button',
      className: 'float-window-action',
      textContent: 'Import',
    })
    this.importButton.addEventListener('click', () => void this.startImport())

    this.window.body.append(
      this.info,
      el('div', { className: 'sel-section', textContent: 'Points' }),
      windowRow('Keep at most', this.target),
      windowRow('Method', this.method),
      el('div', { className: 'sel-section', textContent: 'Appearance' }),
      windowRow('Colour by', this.color),
      windowRow('Point size', this.pointSize),
      windowRow('Fit to width', this.span),
      windowRow('Vertical exag.', this.exaggeration),
      this.classGroup,
      this.status,
      this.importButton,
    )
    document.body.appendChild(this.window.element)
  }

  get isOpen(): boolean {
    return this.window.isOpen
  }

  close(): void {
    this.epoch++ // orphan any scan or import still running
    this.releaseFile()
    this.window.setOpen(false)
  }

  /** Open the window for one file and start scanning it. */
  open(file: File): void {
    this.epoch++
    this.releaseFile()
    this.resetOptions()
    this.file = file
    this.summary = null
    this.title.textContent = `Import Point Cloud — ${file.name}`
    this.info.textContent = 'Reading file…'
    this.status.textContent = ''
    this.classGroup.hidden = true
    this.classList.textContent = ''
    this.setBusy(true)
    this.window.setOpen(true)
    void this.scan(this.epoch)
  }

  /**
   * Back to the defaults for a new file.
   *
   * The desktop constructs a fresh dialog per file, so this is what it does
   * too — and the reason to match rather than carry the settings over is that
   * every other number in this window describes THIS file. A target of 4,000
   * chosen for a 5,000-point fixture, silently applied to a 442,767-point tile,
   * is the one value in the window that would be about a different file. Found
   * by driving it: the window said "Will keep 4,000 — about 1 in 111" and was
   * telling the truth about a decision nobody had made.
   */
  private resetOptions(): void {
    this.target.value = String(DEFAULT_MAX_POINTS)
    this.method.value = METHOD_ORDER[0]
    this.color.value = 'auto'
    this.pointSize.value = '2'
    this.span.value = String(DEFAULT_WORLD_SPAN)
    this.exaggeration.value = '1'
    this.classEnable.checked = false
  }

  /**
   * Drop the decompressed records. A ten-million-point tile is ~400 MB of them,
   * and a window nobody has closed would otherwise hold that for the session.
   */
  private releaseFile(): void {
    this.las = null
    this.bytes = null
    this.file = null
  }

  private classBoxes(): HTMLInputElement[] {
    return [...this.classList.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
  }

  private syncClassEnabled(): void {
    const on = this.classEnable.checked
    this.classList.classList.toggle('is-disabled', !on)
    for (const box of this.classBoxes()) box.disabled = !on
  }

  /**
   * Describe the file without committing to an import.
   *
   * LAS/LAZ carry point count and extents in the header, so the geometry half is
   * free however large the file. Classification is read from the records —
   * where the desktop takes a 200,000-point random SAMPLE for the proportions,
   * this counts every point, because it is one byte read per record over
   * memory the browser is holding anyway and an exact count is a better thing to
   * choose a filter from than an estimate.
   */
  private async scan(epoch: number): Promise<void> {
    const file = this.file!
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (epoch !== this.epoch) return
      const ext = extensionOf(file.name)

      let summary: ScanSummary
      if ((LAS_EXTENSIONS as readonly string[]).includes(ext)) {
        const las = await openLasFile(bytes)
        if (epoch !== this.epoch) return
        this.las = las
        const codes = lasAllClassifications(las)
        const counts = new Map<number, number>()
        for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
        summary = {
          points: las.header.pointCount,
          span: [
            las.header.max[0] - las.header.min[0],
            las.header.max[1] - las.header.min[1],
            las.header.max[2] - las.header.min[2],
          ],
          // A colour column that is entirely zero is not colour, and reporting
          // it as such would send Automatic down the RGB branch to a black
          // cloud. The desktop reaches the same conclusion from its sample.
          hasRgb: las.header.hasRgb && lasHasAnyColor(las),
          hasClassification: las.header.hasClassification,
          hasIntensity: las.header.hasIntensity,
          version: `LAS ${las.header.version}`,
          crs: las.header.crs,
          classes: new Map(
            [...counts.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([code, n]) => [code, [className(code), n] as [string, number]]),
          ),
        }
      } else {
        // No header worth the name, so the file is read in full; those formats
        // are small enough for that to be fine.
        this.bytes = bytes
        const data = await loadPointCloud(file.name, bytes, { maxPoints: null })
        if (epoch !== this.epoch) return
        summary = {
          points: data.totalPoints,
          span: spanOf(data),
          hasRgb: data.colors !== null,
          hasClassification: data.classification !== null,
          hasIntensity: data.intensity !== null,
          version: ext.slice(1).toUpperCase(),
          crs: '',
          classes: new Map(
            [...classCounts(data).entries()].map(([code, n]) => [
              code,
              [className(code), n] as [string, number],
            ]),
          ),
        }
      }

      if (epoch !== this.epoch) return
      this.summary = summary
      this.buildClassList(summary)
      this.refreshInfo()
      this.status.textContent =
        'The cloud arrives as a Point Cloud parent with one node per point, ' +
        'appended to the open scene rather than replacing it.'
      this.setBusy(false)
    } catch (err: unknown) {
      if (epoch !== this.epoch) return
      this.info.textContent = `⚠ Could not read this file:\n${messageOf(err)}`
      this.status.textContent = ''
      // Everything stays disabled: with no file to import, nothing typed in
      // these rows can matter, and a live form under a refusal reads as though
      // adjusting it might help.
      this.summary = null
      this.setBusy(true)
    }
  }

  private buildClassList(summary: ScanSummary): void {
    this.classList.textContent = ''
    // Only when the file is GENUINELY classified — the `isReallyClassified`
    // rule both apps already share (a file where every point is 0 "created,
    // never classified" or 1 "unclassified" is not classified; it just has the
    // column, which nearly every LAS file does).
    //
    // Divergence from the desktop, found by LOOKING at the window rather than
    // measuring it: it shows the group for any non-empty class map, so its own
    // aerial_survey example offers a filter with one entry — "0 Created, never
    // classified (442,767)" — that cannot narrow anything, since unticking the
    // only class is the "no filter" case. A control that cannot do anything is
    // worse than none, and what it had to say is better said in the report
    // line, which `refreshInfo` now does.
    if (!isFilterable(summary)) {
      this.classGroup.hidden = true
      return
    }
    for (const [code, [name, count]] of summary.classes) {
      const row = el('label', { className: 'sel-check' })
      const box = el('input', { type: 'checkbox' })
      box.checked = true
      box.value = String(code)
      box.addEventListener('change', () => this.refreshInfo())
      row.append(
        box,
        el('span', { textContent: `${code}  ${name}  (${count.toLocaleString('en-US')})` }),
      )
      this.classList.appendChild(row)
    }
    this.classGroup.hidden = false
    // Off by default, like the desktop's checkable group: a file's classes are
    // shown so they can be READ, and filtering is a decision the user makes.
    this.classEnable.checked = false
    this.syncClassEnabled()
  }

  /**
   * The keptClasses the options currently name, or null for "no filter".
   *
   * An empty tick list would import nothing at all, which is never what anyone
   * means — it is treated as no filter, exactly as the desktop does.
   */
  private keepClasses(): number[] | null {
    if (!this.classEnable.checked || this.classList.childElementCount === 0) return null
    const kept = this.classBoxes()
      .filter((b) => b.checked)
      .map((b) => Number(b.value))
    return kept.length > 0 ? kept : null
  }

  /**
   * Redraw the one-line file summary. Cheap by construction: it reads the cached
   * scan result and sets text. It runs on every tick of the point-target box, so
   * anything that re-reads the file does NOT belong here.
   */
  private refreshInfo(): void {
    const summary = this.summary
    if (summary === null) return
    const keep = this.keepClasses()
    const available =
      keep === null
        ? summary.points
        : [...summary.classes.entries()]
            .filter(([code]) => keep.includes(code))
            .reduce((sum, [, [, n]]) => sum + n, 0)
    const target = Number(this.target.value)
    const carries = [
      summary.hasRgb ? 'RGB' : '',
      // Name the unclassified case rather than claiming a classification the
      // file does not really carry: it is what decides whether Automatic
      // colours by class or falls back to elevation, and it is why there is no
      // class filter to reach for.
      summary.hasClassification
        ? isFilterable(summary)
          ? 'classification'
          : 'an empty classification column'
        : '',
      summary.hasIntensity ? 'intensity' : '',
    ].filter((s) => s !== '')

    const [sx, sy, sz] = summary.span.map((v) => Math.round(v).toLocaleString('en-US'))
    const lines = [
      `${summary.version} · ${summary.points.toLocaleString('en-US')} points · ` +
        `extent ${sx} × ${sy} × ${sz} source units`,
      `Carries: ${carries.length > 0 ? carries.join(', ') : 'positions only'}` +
        (summary.crs ? ` · ${summary.crs}` : ''),
    ]
    if (keep !== null) {
      lines.push(`${available.toLocaleString('en-US')} points match the ticked classes`)
    }
    lines.push(
      available > target
        ? `Will keep ${target.toLocaleString('en-US')} — about 1 in ` +
            `${Math.max(1, Math.round(available / Math.max(1, target))).toLocaleString('en-US')}`
        : 'Will keep every point that matches',
    )
    this.info.textContent = lines.join('\n')
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    for (const control of [
      this.target,
      this.method,
      this.color,
      this.pointSize,
      this.span,
      this.exaggeration,
      this.classEnable,
    ]) {
      control.disabled = busy
    }
    for (const box of this.classBoxes()) box.disabled = busy || !this.classEnable.checked
    this.importButton.disabled = busy || this.summary === null
  }

  private async startImport(): Promise<void> {
    if (this.busy || this.summary === null || this.file === null) return
    const epoch = this.epoch
    const file = this.file
    this.setBusy(true)
    this.status.textContent = 'Importing…'

    const maxPoints = Number(this.target.value)
    const method = this.method.value as DecimateMethod
    const keepClasses = this.keepClasses()
    try {
      // Yield a frame so "Importing…" actually paints before the work starts —
      // the read is fast but not free, and a button that looks stuck is worse
      // than one that says what it is doing.
      await new Promise((resolve) => requestAnimationFrame(resolve))
      let data: PointCloudData
      if (this.las !== null) {
        data = pointsFromLasFile(this.las, file.name, maxPoints, method, 0, keepClasses)
      } else {
        data = await loadPointCloud(file.name, this.bytes!, { maxPoints, method, keepClasses })
      }
      if (epoch !== this.epoch || !this.window.isOpen) return

      const { nodes, report } = buildFromData(data, {
        method,
        colorMode: this.color.value as ColorMode,
        span: Number(this.span.value),
        exaggeration: Number(this.exaggeration.value),
        pointSize: Number(this.pointSize.value),
        keepClasses,
        startId: this.host.nextNodeId(),
      })
      this.host.onApply({ nodes, report, fileName: file.name })
      this.close()
    } catch (err: unknown) {
      if (epoch !== this.epoch) return
      this.status.textContent = `⚠ Import failed: ${messageOf(err)}\nNothing was changed.`
      this.setBusy(false)
    }
  }
}

/**
 * True when the file's classification column carries codes worth filtering by.
 *
 * The desktop's `_is_really_classified`, applied to a SCAN rather than to a
 * loaded cloud: 0 ("created, never classified") and 1 ("unclassified") are what
 * a file has when nobody has classified it.
 */
function isFilterable(summary: ScanSummary): boolean {
  for (const code of summary.classes.keys()) {
    if (code !== 0 && code !== 1) return true
  }
  return false
}

function numberInput(min: number, max: number, step: number, value: number): HTMLInputElement {
  const input = Object.assign(document.createElement('input'), { type: 'number' })
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('change', () => {
    const v = Number(input.value)
    if (Number.isFinite(v)) input.value = String(Math.min(Math.max(v, min), max))
  })
  return input
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
