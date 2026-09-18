// Scene bundles: turning a pile of dropped/selected files into scenes.
//
// A GlyphViz scene on disk is a folder, not a file: a gv_node.csv plus, in the
// same folder, an optional companion gv_tag.csv, an optional media/ folder
// whose sorted contents define texture_ids, and (later) Channels ch-map /
// ch-tracks files and a _gv_audio.txt manifest. Browsers have no folders, so
// every input path — a directory drop, a multi-file selection, a zip, or a
// hosted manifest — is reduced to a flat list of relative paths and resolved
// here. Pure path logic, no DOM: the DOM side lives in src/io/browserFiles.ts,
// which also expands a dropped .zip into that same flat list (src/io/zip.ts) so
// an archive resolves identically to the folder it was made from.

import { buildMediaIndex } from './media'
import type { MediaIndex } from './media'
import { isSceneMeshFileName } from './meshFile'
import { deriveTagFilename } from './tagCsv'

export interface SceneCandidate {
  /** Path of the node CSV within the dropped file set. */
  nodePath: string
  /** Its folder, '' at the top of the set. */
  dir: string
  /** Display label: the folder name, else the file name. */
  label: string
  /** Companion tag file, when the derived name is present in the set. */
  tagPath: string | null
  /** Sibling `media/` folder, when present. */
  mediaDir: string | null
  /** texture_id assignment over that folder's contents. */
  media: MediaIndex
  /** texture_id → full path within the file set. */
  mediaPathById: Map<number, string>
  /** Channels companions — loaded only when exactly one of each is in the folder. */
  channelMapPath: string | null
  channelTracksPath: string | null
  /** `<anything>_gv_audio.txt` manifest, for audio-synced Channels playback. */
  audioManifestPath: string | null
  /**
   * Imported models the scene ships, mesh_id → path. See `findMeshFiles` for
   * where they are looked for and why this convention is the web app's own.
   */
  meshPathById: Map<number, string>
}

/** Normalize a path to forward slashes with no leading './' or '/'. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '')
}

/**
 * Resolve a path relative to a folder within the dropped set, collapsing `.`
 * and `..` segments — the `_gv_audio.txt` manifest names its audio file this
 * way, and the desktop resolves it with plain filesystem semantics.
 *
 * A `..` that would climb above the set's top is dropped rather than escaping:
 * the set has no parent to reach, so a file above it is simply not available.
 */
export function resolveRelative(dir: string, relative: string): string {
  const out = dir === '' ? [] : dir.split('/')
  for (const part of normalizePath(relative).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function baseOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

function isCsv(name: string): boolean {
  return name.toLowerCase().endsWith('.csv')
}

/** Channels companions are recognized by substring, per the spec's discovery rule. */
function channelRole(name: string): 'map' | 'tracks' | null {
  if (!isCsv(name)) return null
  const lower = name.toLowerCase()
  if (lower.includes('ch-map')) return 'map'
  if (lower.includes('ch-track')) return 'tracks'
  return null
}

/**
 * A node CSV, by the naming convention: stem ends in `node`. Matched
 * case-insensitively — more lenient than the desktop's tag-name derivation,
 * because this only decides which file to *offer* as a scene.
 */
function looksLikeNodeCsv(name: string): boolean {
  return isCsv(name) && stemOf(name).toLowerCase().endsWith('node') && channelRole(name) === null
}

function looksLikeTagCsv(name: string): boolean {
  return isCsv(name) && stemOf(name).toLowerCase().endsWith('tag')
}

/**
 * The sub-folder a scene's imported models live in.
 *
 * Exactly one name, and exactly this name: the desktop looks for `meshes/`
 * beside the node CSV and nothing else. This app used to also accept `mesh/`
 * and `models/`, plus loose mesh files sitting next to the CSV — a scene built
 * that way opened here and silently lost its models on the desktop, so the
 * wider set has been dropped in favour of one rule both apps share.
 */
const MESH_DIR = 'meshes'

/**
 * Imported models shipped with a scene: the model files in the scene's
 * `meshes/` sub-folder, given mesh_ids 1..N in sorted-name order.
 *
 * This convention began here, because the desktop used to hand out mesh_ids in
 * import order within a session and persist nothing but the id — so a scene
 * saved there with mesh_id 2 had no way to say which file that was. The
 * desktop adopted the same rule on 2026-09-16
 * (`Viewport.load_mesh_folder`), and this is now shared behaviour rather than
 * a local invention.
 *
 * Sorting is CASE-SENSITIVE, by file name, deliberately: it has to match
 * Python's `sorted()` on the desktop so a folder yields the same ids in both
 * apps and on every OS. Note this differs from `media/` → texture_id, which
 * still uses the case-insensitive `compareMediaNames`; that rule is older and
 * changing it would renumber textures in scenes that already ship.
 *
 * What COUNTS as a model here is the desktop's supported set, not this app's
 * readable one (isSceneMeshFileName) — a `.glb` among the files takes an id
 * there, so it has to take one here, or every model after it wears the shape
 * of its neighbour. Reading it is a separate question, answered per file when
 * the scene loads.
 */
export function findMeshFiles(paths: readonly string[], dir: string): Map<number, string> {
  const prefix = dir === '' ? '' : dir + '/'
  const found: Array<{ name: string; path: string }> = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    if (!lower.startsWith(prefix.toLowerCase())) continue
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    // Exactly one level down, into `meshes/` — a loose .obj beside the CSV is
    // not a scene asset, and a sub-SCENE's models belong to that scene.
    if (slash === -1) continue
    const sub = rest.slice(0, slash).toLowerCase()
    const leaf = rest.slice(slash + 1)
    if (sub !== MESH_DIR || leaf.includes('/')) continue
    if (isSceneMeshFileName(leaf)) found.push({ name: leaf, path })
  }
  // Plain code-unit comparison, matching Python's sorted() on the desktop.
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return new Map(found.map((f, i) => [i + 1, f.path]))
}

/**
 * Find every loadable scene in a flat set of relative paths.
 *
 * Node CSVs are recognized by the `…node.csv` convention; if a set contains
 * none, any CSV that isn't a tag or Channels companion is offered instead, so
 * a lone `scene.csv` still opens. Results are ordered shallowest folder first,
 * then by path, which puts a dropped parent folder's own scene ahead of its
 * sub-scenes (Global_Terrorism_Example holds five).
 */
export function findScenes(rawPaths: readonly string[]): SceneCandidate[] {
  const paths = rawPaths.map(normalizePath)

  let nodePaths = paths.filter((p) => looksLikeNodeCsv(baseOf(p)))
  if (nodePaths.length === 0) {
    nodePaths = paths.filter(
      (p) => isCsv(baseOf(p)) && !looksLikeTagCsv(baseOf(p)) && channelRole(baseOf(p)) === null,
    )
  }

  // Index the set once: per-folder file names, and a case-insensitive lookup
  // back to the original path (Windows file pickers preserve case, but callers
  // shouldn't have to guarantee it).
  const byDir = new Map<string, string[]>()
  const byLowerPath = new Map<string, string>()
  for (const p of paths) {
    const dir = dirOf(p)
    const list = byDir.get(dir)
    if (list) list.push(baseOf(p))
    else byDir.set(dir, [baseOf(p)])
    byLowerPath.set(p.toLowerCase(), p)
  }
  const resolve = (path: string): string | null => byLowerPath.get(path.toLowerCase()) ?? null

  const scenes = nodePaths.map((nodePath): SceneCandidate => {
    const dir = dirOf(nodePath)
    const name = baseOf(nodePath)
    const prefix = dir === '' ? '' : dir + '/'
    const siblings = byDir.get(dir) ?? []

    // deriveTagFilename matches the desktop's case-sensitive `endswith('node')`.
    // Within a dropped set we hold the whole listing, so a `…_GV_Node.CSV`
    // still pairs: retry on the lowercased name and let the case-insensitive
    // lookup find the sibling. Strictly more permissive than the desktop, and
    // it cannot mis-pair — the stem still has to match.
    const tagName = deriveTagFilename(name) ?? deriveTagFilename(name.toLowerCase())
    const tagPath = tagName ? resolve(prefix + tagName) : null

    // media/ next to the node CSV, direct children only (the desktop's
    // iterdir() does not recurse). Nothing is inherited from an ancestor
    // folder: on disk the desktop's other media source is next to the *app*,
    // which has no web equivalent.
    const mediaPrefixLower = (prefix + 'media/').toLowerCase()
    const mediaFiles: Array<{ name: string; path: string }> = []
    for (const p of paths) {
      const lower = p.toLowerCase()
      if (!lower.startsWith(mediaPrefixLower)) continue
      const rest = p.slice(mediaPrefixLower.length)
      if (rest === '' || rest.includes('/')) continue
      mediaFiles.push({ name: rest, path: p })
    }
    const media = buildMediaIndex(mediaFiles.map((f) => f.name))
    const pathByName = new Map(mediaFiles.map((f) => [f.name, f.path]))
    const mediaPathById = new Map(
      media.entries.map((e) => [e.textureId, pathByName.get(e.name)!] as const),
    )

    // Exactly one of each, else Channels stays off — the spec's rule.
    const maps = siblings.filter((n) => channelRole(n) === 'map')
    const tracks = siblings.filter((n) => channelRole(n) === 'tracks')
    const audio = siblings.filter((n) => n.toLowerCase().endsWith('_gv_audio.txt'))

    return {
      nodePath,
      dir,
      label: dir === '' ? name : baseOf(dir),
      tagPath,
      mediaDir: mediaFiles.length > 0 ? prefix + 'media' : null,
      media,
      mediaPathById,
      channelMapPath: maps.length === 1 ? prefix + maps[0] : null,
      channelTracksPath: tracks.length === 1 ? prefix + tracks[0] : null,
      audioManifestPath: audio.length === 1 ? prefix + audio[0] : null,
      meshPathById: findMeshFiles(paths, dir),
    }
  })

  scenes.sort((a, b) => {
    const depth = a.dir.split('/').length - b.dir.split('/').length
    if (a.dir === '') return b.dir === '' ? (a.nodePath < b.nodePath ? -1 : 1) : -1
    if (b.dir === '') return 1
    if (depth !== 0) return depth
    return a.nodePath < b.nodePath ? -1 : a.nodePath > b.nodePath ? 1 : 0
  })
  return scenes
}
