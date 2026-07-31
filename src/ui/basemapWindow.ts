// Fetch Basemap window — the GUI wrapper around gv/basemap +
// render/basemapFetch, ported from desktop glyphviz_gl/basemap_dialog.py.
// Prefills the lon/lat window from the selected World Grid's children
// (falling back to the grid's current extents), previews exactly what a fetch
// will do (provider, zoom, tile count, output size) live as the window is
// edited, and runs the fetch without blocking the UI. The window only
// downloads tiles and produces the PNG; wiring the image into the scene (grid
// extents, texture_id bookkeeping, media reload) stays in main.ts, which owns
// those structures — the same split as the desktop's dialog vs MainWindow.
//
// The map that comes back covers *exactly* the previewed window — the host
// sets the grid extents to the payload's bbox, never to what the user typed,
// so texture and child placement can't drift apart.
//
// A FloatWindow rather than a docked panel, like the Hyperglyph Generator:
// you drag it aside, tune the window against the scene behind it, and fetch.
// Modeless where the desktop is exec()-modal — closing it mid-fetch cancels,
// as the desktop's Cancel does.

import {
  BasemapError,
  DEFAULT_PROVIDER,
  MERCATOR_LAT_LIMIT,
  PROVIDERS,
  bboxFromNodes,
  clampedBBox,
  planBasemap,
  planTileCount,
} from '../gv/basemap'
import type { BBox, BasemapPlan } from '../gv/basemap'
import { gridExtents } from '../gv/worldGrid'
import type { GvNode } from '../gv/types'
import { buildBasemapPng } from '../render/basemapFetch'
import { FloatWindow, windowRow } from './floatWindow'

export interface BasemapApplyPayload {
  gridId: number
  /** The exact lon/lat window the PNG covers — pair the grid extents with this. */
  bbox: BBox
  png: Blob
  attribution: string
}

export interface BasemapWindowHost {
  onApply(payload: BasemapApplyPayload): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export class BasemapWindow {
  private readonly window: FloatWindow
  private readonly host: BasemapWindowHost

  private gridId = 0
  private nodes: readonly GvNode[] = []
  private plan: BasemapPlan | null = null
  private fetching = false
  private fetchEpoch = 0

  private readonly title: HTMLSpanElement
  private readonly provider: HTMLSelectElement
  private readonly lonMin: HTMLInputElement
  private readonly lonMax: HTMLInputElement
  private readonly latMin: HTMLInputElement
  private readonly latMax: HTMLInputElement
  private readonly fitButton: HTMLButtonElement
  private readonly preview: HTMLDivElement
  private readonly status: HTMLDivElement
  private readonly fetchButton: HTMLButtonElement

  constructor(host: BasemapWindowHost) {
    this.host = host
    this.window = new FloatWindow({
      id: 'basemap-window',
      title: 'Fetch Basemap',
      hotkey: '',
    })
    this.title = this.window.element.querySelector('.float-window-title')!

    this.provider = el('select')
    for (const p of Object.values(PROVIDERS)) {
      this.provider.appendChild(el('option', { value: p.key, textContent: p.label }))
    }
    this.provider.value = DEFAULT_PROVIDER
    this.provider.title =
      'All providers are free and key-less. The required attribution is\n' +
      'baked into the image corner, so it travels with the saved scene.'
    this.provider.addEventListener('change', () => this.refreshPlan())

    const coord = (min: number, max: number): HTMLInputElement => {
      const input = el('input', { type: 'number' })
      input.step = 'any'
      input.min = String(min)
      input.max = String(max)
      input.addEventListener('change', () => {
        const v = Number(input.value)
        if (Number.isFinite(v)) input.value = String(Math.min(Math.max(v, min), max))
        this.refreshPlan()
      })
      return input
    }
    this.lonMin = coord(-180, 180)
    this.lonMax = coord(-180, 180)
    this.latMin = coord(-MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT)
    this.latMax = coord(-MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT)

    const pair = (a: HTMLInputElement, b: HTMLInputElement): HTMLDivElement => {
      const div = el('div', { className: 'basemap-pair' })
      div.append(a, b)
      return div
    }

    this.fitButton = el('button', {
      type: 'button',
      className: 'float-window-action',
      textContent: 'Fit to Children',
    })
    this.fitButton.title =
      'Recompute the window from the lon/lat of the grid’s children,\n' +
      'with a little padding around the data.'
    this.fitButton.addEventListener('click', () => this.fitToChildren())

    this.preview = el('div', { className: 'basemap-preview' })
    this.status = el('div', { className: 'basemap-status' })

    this.fetchButton = el('button', {
      type: 'button',
      className: 'float-window-action',
      textContent: 'Fetch',
    })
    this.fetchButton.addEventListener('click', () => void this.startFetch())

    const buttons = el('div', { className: 'basemap-buttons' })
    buttons.append(this.fitButton, this.fetchButton)

    this.window.body.append(
      windowRow('Map style', this.provider),
      windowRow('Lon Min/Max', pair(this.lonMin, this.lonMax)),
      windowRow('Lat Min/Max', pair(this.latMin, this.latMax)),
      this.preview,
      this.status,
      buttons,
    )
    document.body.appendChild(this.window.element)
  }

  get isOpen(): boolean {
    return this.window.isOpen
  }

  /** Open (or re-target) the window for one World Grid. */
  open(grid: GvNode, nodes: readonly GvNode[]): void {
    this.gridId = grid.id
    this.nodes = nodes
    this.fetchEpoch++ // orphan any fetch still running for the previous grid
    this.fetching = false
    this.title.textContent = `Fetch Basemap — World Grid ${grid.id}`

    const fromKids = bboxFromNodes(nodes, grid.id)
    const hasKids = fromKids !== null
    this.fitButton.disabled = !hasKids
    this.fitButton.title = hasKids
      ? 'Recompute the window from the lon/lat of the grid’s children,\n' +
        'with a little padding around the data.'
      : 'This grid has no children yet.'
    if (fromKids) {
      this.setBBox(fromKids)
    } else {
      const e = gridExtents(grid)
      this.setBBox(clampedBBox({ lonMin: e.lonLo, lonMax: e.lonHi, latMin: e.latLo, latMax: e.latHi }))
    }
    this.status.textContent =
      'The grid’s extents will be set to this window so the map and child ' +
      'placement line up exactly. Tiles are cached — refetching the same ' +
      'region is free.'
    this.setBusy(false)
    this.window.setOpen(true)
  }

  close(): void {
    this.window.setOpen(false) // a fetch in flight sees isOpen false and aborts
  }

  private setBBox(bbox: BBox): void {
    this.lonMin.value = String(bbox.lonMin)
    this.lonMax.value = String(bbox.lonMax)
    this.latMin.value = String(bbox.latMin)
    this.latMax.value = String(bbox.latMax)
    this.refreshPlan()
  }

  private fitToChildren(): void {
    const bbox = bboxFromNodes(this.nodes, this.gridId)
    if (bbox) this.setBBox(bbox)
  }

  private currentBBox(): BBox {
    return {
      lonMin: Number(this.lonMin.value),
      lonMax: Number(this.lonMax.value),
      latMin: Number(this.latMin.value),
      latMax: Number(this.latMax.value),
    }
  }

  private refreshPlan(): void {
    try {
      this.plan = planBasemap(this.currentBBox(), this.provider.value)
    } catch (err) {
      this.plan = null
      this.preview.textContent = `⚠ ${err instanceof BasemapError ? err.message : String(err)}`
    }
    if (this.plan) {
      const p = this.plan
      this.preview.textContent =
        `Will fetch ${planTileCount(p)} tile(s) at zoom ${p.zoom} → ` +
        `${p.outW}×${p.outH} px map.  ${p.provider.attribution}`
    }
    this.fetchButton.disabled = this.plan === null || this.fetching
  }

  private setBusy(busy: boolean): void {
    this.fetching = busy
    for (const c of [this.provider, this.lonMin, this.lonMax, this.latMin, this.latMax]) {
      c.disabled = busy
    }
    this.fitButton.disabled = busy || bboxFromNodes(this.nodes, this.gridId) === null
    this.fetchButton.disabled = busy || this.plan === null
  }

  private async startFetch(): Promise<void> {
    if (this.plan === null || this.fetching) return
    const plan = this.plan
    const epoch = ++this.fetchEpoch
    this.setBusy(true)
    this.status.textContent = 'Contacting tile server…'
    try {
      const png = await buildBasemapPng(plan, {
        progress: (done, total) => {
          if (epoch === this.fetchEpoch) {
            this.status.textContent = `Fetching tile ${done} / ${total}…`
          }
        },
        // Closing the window (or re-opening it for another grid) cancels.
        cancelled: () => epoch !== this.fetchEpoch || !this.window.isOpen,
      })
      if (epoch !== this.fetchEpoch || !this.window.isOpen) return
      this.host.onApply({
        gridId: this.gridId,
        bbox: plan.bbox,
        png,
        attribution: plan.provider.attribution,
      })
      this.close()
    } catch (err) {
      if (epoch !== this.fetchEpoch) return
      const message = err instanceof BasemapError ? err.message : String(err)
      this.status.textContent =
        `⚠ Fetch failed: ${message}\nNothing was changed — adjust the window or try again.`
    } finally {
      if (epoch === this.fetchEpoch) {
        this.setBusy(false)
        this.refreshPlan()
      }
    }
  }
}
