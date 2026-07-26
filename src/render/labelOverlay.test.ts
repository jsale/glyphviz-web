import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { LABEL_OFFSET_X, MAX_TAGS_PER_FRAME, pinnedTagNodes, placeLabels } from './labelOverlay'
import type { LabelOverlayState } from './labelOverlay'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { applyTags, parseGvTagCsv } from '../gv/tagCsv'
import { NodeType, TAG_DEFAULT_TEXT_RGB, TagColorMode } from '../gv/types'
import type { GvNode } from '../gv/types'
import topologyNodeCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'
import topologyTagCsv from '../gv/fixtures/topology_example_gv_tag.csv?raw'

const WIDTH = 800
const HEIGHT = 600

function node(id: number, text: string, overrides: Partial<GvNode> = {}): GvNode {
  const base = parseGvNodeCsv(
    [
      'id,type,parent_id,branch_level,translate_x,translate_y,translate_z,rotate_x,rotate_y,rotate_z,scale_x,scale_y,scale_z,color_r,color_g,color_b,color_a,geometry,hide,topo',
      `${id},5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,1,0,0`,
    ].join('\r\n'),
  ).nodes[0]
  return { ...base, text, ...overrides }
}

/** A camera at z=10 looking at the origin, so world (0,0,0) lands centre-screen. */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 100)
  cam.position.set(0, 0, 10)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

function frameAt(x: number, y: number, z: number): THREE.Object3D {
  const object = new THREE.Object3D()
  object.position.set(x, y, z)
  object.updateMatrixWorld(true)
  return object
}

const SHOW_ALL: LabelOverlayState = {
  showTags: true,
  selectedOnly: false,
  showHidden: false,
  isSelected: () => false,
  pinned: [],
  tagColorMode: TagColorMode.Uniform,
  tagColor: TAG_DEFAULT_TEXT_RGB,
}

function place(
  nodes: GvNode[],
  frames: Map<number, THREE.Object3D>,
  state: Partial<LabelOverlayState> = {},
) {
  // The pinned list is precomputed per scene build in the app; derive it here
  // so a test only has to set show_text on the node it cares about.
  const pinned = state.pinned ?? pinnedTagNodes(nodes)
  return placeLabels(nodes, frames, camera(), { ...SHOW_ALL, ...state, pinned }, WIDTH, HEIGHT)
}

describe('placeLabels', () => {
  it('places nothing while labels are off', () => {
    expect(place([node(1, 'Sphere')], new Map([[1, frameAt(0, 0, 0)]]), { showTags: false })).toEqual(
      [],
    )
  })

  it('projects a node at the origin to the viewport centre', () => {
    const placed = place([node(1, 'Sphere')], new Map([[1, frameAt(0, 0, 0)]]))
    expect(placed).toEqual([{ text: 'Sphere', x: WIDTH / 2, y: HEIGHT / 2 }])
    // The desktop paints 5px to the right of that point.
    expect(placed[0].x + LABEL_OFFSET_X).toBe(405)
  })

  it('skips unlabelled nodes', () => {
    expect(place([node(1, '')], new Map([[1, frameAt(0, 0, 0)]]))).toEqual([])
  })

  it('never labels World or Camera rows', () => {
    const nodes = [
      node(1, 'World', { type: NodeType.World }),
      node(2, 'Camera', { type: NodeType.Camera }),
      node(3, 'Glyph'),
    ]
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    expect(place(nodes, frames).map((p) => p.text)).toEqual(['Glyph'])
  })

  it('anchors a link label to the middle of the edge it draws', () => {
    const nodes = [
      node(1, 'A'),
      node(2, 'B'),
      node(3, 'Edge', { type: NodeType.Link, parentId: 1, extras: { child_id: '2' } }),
    ]
    const frames = new Map([
      [1, frameAt(-2, 0, 0)],
      [2, frameAt(2, 0, 0)],
      [3, frameAt(-2, 0, 0)], // a link's own frame sits on its A-end
    ])
    const placed = place(nodes, frames)
    const centre = placed.find((p) => p.text === 'A')!.x
    const midpoint = placed.find((p) => p.text === 'Edge')!.x
    // Midway between A (left of centre) and B (right of it) is the middle.
    expect(midpoint).toBe(WIDTH / 2)
    expect(centre).toBeLessThan(midpoint)
  })

  it('falls back to a link’s own position when an endpoint is missing', () => {
    const nodes = [node(9, 'Dangling', { type: NodeType.Link, parentId: 1, extras: {} })]
    const placed = place(nodes, new Map([[9, frameAt(0, 0, 0)]]))
    expect(placed).toEqual([{ text: 'Dangling', x: WIDTH / 2, y: HEIGHT / 2 }])
  })

  it('labels links after ordinary nodes, so node labels win the frame cap', () => {
    const nodes = [
      node(1, 'link', { type: NodeType.Link, parentId: 2, extras: { child_id: '2' } }),
      node(2, 'glyph'),
    ]
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    expect(place(nodes, frames).map((p) => p.text)).toEqual(['glyph', 'link'])
  })

  it('draws a pinned label with labels off, and with the selection scoped elsewhere', () => {
    const nodes = [node(1, 'Pinned', { showText: 1 }), node(2, 'Plain')]
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    expect(place(nodes, frames, { showTags: false }).map((p) => p.text)).toEqual(['Pinned'])
    expect(
      place(nodes, frames, { selectedOnly: true, isSelected: () => false }).map((p) => p.text),
    ).toEqual(['Pinned'])
    // Still exactly once when the scene-wide pass would have drawn it too.
    expect(place(nodes, frames).map((p) => p.text)).toEqual(['Plain', 'Pinned'])
  })

  it('hides a pinned label when its node is hidden', () => {
    const nodes = [node(1, 'Pinned', { showText: 1, hide: 1 })]
    const frames = new Map([[1, frameAt(0, 0, 0)]])
    expect(place(nodes, frames, { showTags: false })).toEqual([])
    expect(place(nodes, frames, { showTags: false, showHidden: true })).toHaveLength(1)
  })

  it('exempts pinned labels from the frame cap', () => {
    const nodes = Array.from({ length: MAX_TAGS_PER_FRAME + 25 }, (_, i) => node(i + 1, `n${i}`))
    nodes.at(-1)!.showText = 1
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    const placed = place(nodes, frames)
    // The cap counts unpinned labels only, so the pinned straggler is extra.
    expect(placed).toHaveLength(MAX_TAGS_PER_FRAME + 1)
    expect(placed.at(-1)!.text).toBe(`n${nodes.length - 1}`)
  })

  it('carries each node’s own colour only under the match-node-colour mode', () => {
    const nodes = [node(1, 'Red')]
    const frames = new Map([[1, frameAt(0, 0, 0)]])
    expect(place(nodes, frames)[0].rgb).toBeUndefined()
    expect(place(nodes, frames, { tagColorMode: TagColorMode.Node })[0].rgb).toEqual({
      r: 255,
      g: 0,
      b: 0,
    })
  })

  it('skips hidden nodes unless Show Hidden is on', () => {
    const nodes = [node(1, 'Hidden', { hide: 1 })]
    const frames = new Map([[1, frameAt(0, 0, 0)]])
    expect(place(nodes, frames)).toEqual([])
    expect(place(nodes, frames, { showHidden: true })).toHaveLength(1)
  })

  it('skips nodes behind the camera or outside the frustum', () => {
    const nodes = [node(1, 'Behind'), node(2, 'Off'), node(3, 'On')]
    const frames = new Map([
      [1, frameAt(0, 0, 50)], // behind a camera at z=10 looking down -Z
      [2, frameAt(200, 0, 0)], // far outside sideways
      [3, frameAt(0, 0, 0)],
    ])
    expect(place(nodes, frames).map((p) => p.text)).toEqual(['On'])
  })

  it('reads the live world position, so a dragged node keeps its label', () => {
    const frame = frameAt(0, 0, 0)
    const nodes = [node(1, 'Moving')]
    const frames = new Map([[1, frame]])
    const before = place(nodes, frames)[0].x
    frame.position.set(2, 0, 0)
    frame.updateMatrixWorld(true)
    expect(place(nodes, frames)[0].x).toBeGreaterThan(before)
  })

  it('falls back to the node translate when it has no frame', () => {
    const nodes = [node(1, 'Orphan', { translate: { x: 0, y: 0, z: 0 } })]
    expect(place(nodes, new Map())).toHaveLength(1)
  })

  it('caps show-all mode at 500 labels per frame, in file order', () => {
    const nodes = Array.from({ length: MAX_TAGS_PER_FRAME + 25 }, (_, i) => node(i + 1, `n${i}`))
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    const placed = place(nodes, frames)
    expect(placed).toHaveLength(MAX_TAGS_PER_FRAME)
    expect(placed[0].text).toBe('n0')
    expect(placed.at(-1)!.text).toBe(`n${MAX_TAGS_PER_FRAME - 1}`)
  })

  it('lifts the cap in selected-only mode, where the user scoped the set', () => {
    const count = MAX_TAGS_PER_FRAME + 25
    const nodes = Array.from({ length: count }, (_, i) => node(i + 1, `n${i}`))
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    expect(place(nodes, frames, { selectedOnly: true, isSelected: () => true })).toHaveLength(count)
  })

  it('restricts selected-only mode to the selection', () => {
    const nodes = [node(1, 'One'), node(2, 'Two')]
    const frames = new Map(nodes.map((n) => [n.id, frameAt(0, 0, 0)]))
    const placed = place(nodes, frames, { selectedOnly: true, isSelected: (id) => id === 2 })
    expect(placed.map((p) => p.text)).toEqual(['Two'])
  })

  it('labels the real Topology_Example scene from its companion tag file', () => {
    const parsed = parseGvNodeCsv(topologyNodeCsv)
    applyTags(parsed.nodes, parseGvTagCsv(topologyTagCsv).byRecordId)
    // A camera far enough out to hold the whole example in frame.
    const cam = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 10000)
    cam.position.set(0, 0, 2000)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    const frames = new Map(
      parsed.nodes.map((n) => [
        n.id,
        frameAt(n.translate.x, n.translate.y, n.translate.z),
      ]),
    )
    const placed = placeLabels(parsed.nodes, frames, cam, SHOW_ALL, WIDTH, HEIGHT)
    expect(placed.map((p) => p.text)).toContain('No Topology')
    expect(placed.length).toBeGreaterThan(10)
  })
})
