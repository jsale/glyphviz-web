# GlyphViz Web — Project Context for Claude

## What this is

A from-scratch WebGL rewrite of GlyphViz (the sibling `glyphviz` repo), not a
port. GlyphViz's desktop renderer uses immediate-mode OpenGL (`glBegin`) —
confirmed via grep across `viewport.py`, `geometry.py`, and `glyphviz_xr/` —
which has no WebGL/GLES equivalent. There is no incremental porting path;
everything here is a reimplementation from first principles.

**Working name only**: "GlyphViz Web" / `glyphviz-web` is a placeholder, not
the permanent name. A name like "GlyphWiz" is under consideration but not
decided — don't treat the current name as final in code, docs, or package
metadata beyond what's needed to function.

## Relationship to GlyphViz (the desktop repo)

Shares the **data contract only** — never the code or rendering pipeline:

- The `gv_` CSV format (required/optional columns, node types, topology
  placement math, tags, Channels animation) is specified in
  `../glyphviz/glyphviz-skill/references/`. Treat those docs as authoritative
  when implementing the CSV parser and topology math here — read
  `node-csv-format.md` and `topologies.md` first.
- `../glyphviz/gaiaviz-skill/` is **not relevant to this project**. It
  documents the legacy GaiaViz/ANTz format (`np_` prefix, 94 columns) for
  reading third-party files on the desktop app — out of scope here unless a
  future decision explicitly brings GaiaViz-file interop to the web.
- Do not copy code from the Python desktop app. Do port *behavior* faithfully
  (topology placement formulas, rotation conventions, World Grid extents
  math) — verify against the spec docs and, once both apps can load the same
  example CSV, against the desktop app's actual rendered output.

Desktop GlyphViz continues active feature development in parallel (see its own
`CLAUDE.md` and backlog) — this project does not block on or wait for it.

## Stack

Three.js + TypeScript + Vite. Chosen for fast time-to-first-render, the
largest ecosystem for troubleshooting, and native WebXR support (Quest 3 is a
long-standing GlyphViz goal, currently explored on desktop via OpenXR — see
that repo's XR strategy notes; whether WebXR here replaces or complements
that effort is an open question to revisit once basic parity exists, not
something to decide now).

## Roadmap (in order — do not skip ahead)

1. ~~Scaffold: Vite + TypeScript + Three.js, CI (typecheck + build), this
   file.~~ Done — smoke-test cube in `src/main.ts` proves the pipeline
   renders. No CSV loading yet.
2. ~~`gv_node.csv` parser, validated against the 20-required-column rule in
   `node-csv-format.md`.~~ Done — `src/gv/`, minimal dialect only, unknown
   columns preserved in `extras`.
3. ~~Minimal vertical slice: load a parsed scene, render one topology
   (plain Cartesian/None), orbit camera.~~ Done — `src/render/`, verified
   live on iluvdata.org.
4. ~~Cross-implementation verification harness + topology placement math.~~
   Done — all 18 topologies in `src/render/topology.ts`;
   `tools/dump_world_transforms.py` dumps the desktop engine's transforms,
   `src/render/parity.test.ts` diffs all 109 Topology_Example nodes at 1e-6.
   Regenerate the vendored JSON when either side's placement math changes.
5. ~~Pick one example as the first parity target.~~ Satisfied by step 4:
   Topology_Example is the parity target and the default built-in scene.
6. Interaction phase (agreed 2026-07-24, in order):
   a. Picking + inspection (read-only): raycast selection, highlight,
      node-properties panel. Debugging tool first.
   b. Property-panel editing + CSV **writer** (round-trip: desktop must load
      a web-saved file; gives the parity harness a second direction).
   c. Direct mouse manipulation (TransformControls gizmos) — all three
      modes shipped 2026-07-24, W/E/R keys + HUD buttons switch modes.
      Translate: local-space gizmo + full inverse topology mapping
      (`src/render/topologyInverse.ts`) with agreed policies — angle
      unwrap to nearest 360°-equivalent, hold-at-singularities, facet
      never changes on drag, gradient-picked dominant field pins the
      other coordinates per drag. Rotate: exact inverse decomposition
      (`src/render/rotationInverse.ts`) of both rotation modes (HTR
      Z-X-Z, Euler XYZ) with unwrap, nearest-branch continuity, and
      gimbal hold (roll keeps its previous value at singular tilt/pitch;
      heading absorbs the drag). Scale: pure local scale, 1:1 onto
      scale_x/y/z.
   d. Node creation (shipped 2026-07-24), desktop-parity behavior from
      `_create_root_node`/`_create_child_node`: N adds a root node (+10 X
      per press; child instead when a child-level node is selected),
      Shift+N adds a child at (siblings·5, 0, 5) keeping the parent
      selected, HUD Create panel with New Object Defaults (geometry/
      topology/scale/color). Factory in `src/gv/createNode.ts` — fresh
      nodes are Euler rotation_mode 0 (desktop dataclass default), id =
      max + 1, never 0.
   e. Delete + tree navigation (shipped 2026-07-24), desktop parity:
      Delete/Backspace + HUD button cascade-delete the selected subtree
      (children never reparented); Up/Down walk parent/first-child,
      Tab/Shift+Tab cycle visual siblings in row order (all roots at
      level 0), wrapping. `src/gv/treeOps.ts`.
   f. Advanced selection (shipped 2026-07-25), desktop parity: the
      selection is now a SET. Ctrl+click toggles one node, Shift+drag
      sweeps a rectangle (Ctrl+Shift+drag adds it), Ctrl+A selects
      all/none, Ctrl+I inverts. A Selection panel ports the desktop's
      Select By group (Branch Level / Geometry / Topology + "Add to
      Selection") and Visibility group (Hide/Show Selected, Show Only
      Selected [I], Show All [Shift+H], Hide Selected [H], plus a Show
      Hidden Nodes display toggle). Rules live in `src/gv/selectionOps.ts`.
      - Multi-edit is full desktop parity (`src/gv/multiEdit.ts`): the
        PRIMARY node is the first selected in scene row order (matching
        the desktop reading `_selected_nodes[0]` off a row-ordered
        table); inspector translate/rotate fields apply the DELTA from
        the shown value to every selected node, all other fields apply
        absolutely, and a gizmo drag pushes the primary's per-field
        change onto the rest (additive for translate/rotate, a ratio for
        scale, per `_apply_axis_deltas`) — each in its OWN topology
        coordinates, never world space, so it round-trips to CSV.
      - Region select projects node CENTERS instead of porting the
        desktop's color-ID pick pass (`_pick_nodes_in_rect`): a glyph
        straddling the box is missed unless its center is inside, and
        nothing occludes. A pure math pass, no second render path. This
        is NOT a divergence to reconcile in this direction — Jeff intends
        to change desktop GlyphViz to match this behavior when he gets to
        it (2026-07-25), so the web app is the reference here.
      - Halos are one draw call each, so past `MAX_HALOS` (1000) the
        selection stays complete and only the highlight stops drawing.
      - Panels (Scene / Selection / Properties) collapse to their header
        bar by click or Ctrl+B / Ctrl+E / Ctrl+P. Ctrl+N is reserved by
        browsers and cannot be intercepted — Alt+N is free for the Node
        Table panel when it lands.
      - TO DO from this round: select by tag text (now unblocked —
        companion tag files load as of 2026-07-25), and a Node Table
        panel (desktop `node_table.py`).
7. Still-unimplemented format features, scheduled opportunistically:
   - ~~World Grid placement~~ (shipped 2026-07-24): flat plate + globe,
     extents windows, the scale-respacing rule, geographic gizmo drags,
     G-key selection cycling (grids are never click-pickable; solid
     surfaces occlude picking), desktop-parity fixture
     (`world_grid_example_gv_node.csv` + engine dump) in the parity test.
     Grid frames carry scale (1,1,1) — the grid's scale is baked into
     child positions and the plate's draw scale; the parity test
     re-applies it when comparing bases. No World Grid panel yet
     (extents/segments edit via CSV or inspector extras only); globe
     equirect texture UVs deferred to the textures step.
   - Also shipped 2026-07-24 (desktop viewport parity, Jeff's request):
     the procedural "infinite" reference grid (hidden once a real World
     Grid exists) and RGB origin axes — `src/render/backdrop.ts`.
   - Camera feel, also 2026-07-24 (Jeff's request): near plane fixed at
     0.001 (logarithmic depth buffer keeps far-distance precision) so the
     camera can enter glyphs — z-topologies place children inside the
     parent; and the desktop's Left+Right combo drag (horizontal = orbit
     azimuth 0.4°/px, vertical = zoom, pivot snaps to the selection at
     combo start, one-button release resumes plain orbit — handled
     manually to the end of the press because OrbitControls' drag anchor
     goes stale while disabled). Deliberate difference: a combo mid-gizmo
     drag does not steal the drag from the gizmo.
   - ~~Link edges~~ (shipped 2026-07-24): type-7 edges drawn between the
     A-end (parent_id) and B-end (extras child_id — same storage the
     desktop reads) world positions, refreshed per frame so gizmo drags
     track live. Lines use the three fat-line addon (desktop pixel-width
     rule max(ratio·20, 1); WebGL core lines cap at 1 px), geometry 28 is
     the square tube at half-width max(ratio, 0.01). Edges are never
     pickable; link nodes are reachable by Tab-nav and edited via the
     inspector (Selection now supports glyph-less nodes, halo-less — same
     as desktop's outline pass skipping links). Built for scale after the
     Org_Event_Network example (6,400 links / 65k nodes) exposed a
     90-second hang: endpoints resolve through buildScene's id→frame map
     (getObjectByName is a full scene scan — keep it out of per-link and
     per-tick paths), edges batch into one draw object per (width, alpha)
     group with per-vertex colors, and the per-frame update writes
     preallocated buffers reading the renderer's own matrix pass (~1 ms).
     `?csv=<url>` fetches a scene at boot (added for headless testing of
     big files; also handy for sharing). Deferred to later steps:
     prism texture + rotate_rate_z flow scroll (textures step), desktop's
     round line end caps (cosmetic), link authoring UI.
   - ~~Tags/labels~~ (shipped 2026-07-25): companion `gv_tag.csv` files
     now load — 29 of the desktop repo's 36 example scenes keep their
     labels there rather than in inline `text`/`link` columns, so they
     all rendered unlabeled before. `src/gv/tagCsv.ts` parses and applies
     them (inline columns always win; `table_id` must be 0; match on
     `record_id` falling back to node id), `src/gv/writeTagCsv.ts` writes
     them back, and `writeGvNodeCsv`'s `inlineLabels: false` keeps a
     tag-file scene saving as a PAIR instead of converting to inline
     labels that would shadow the tag file on reload.
     `src/render/labelOverlay.ts` paints them on a 2D canvas over the
     WebGL one — a port of `_project_tagged_nodes`/`_paint_tags`, not 3D
     text: 12px (Qt 9pt), +5px x, pale yellow over a black shadow, the
     500-per-frame cap in show-all mode and NO cap in selected-only mode.
     T toggles; U and Alt+click open a node's `link`. Divergences: a
     non-URL link is a local path the desktop hands to the OS, which a
     browser cannot do (reported in the status bar instead); an empty tag
     title stays empty rather than becoming the literal "nan" that
     pandas' NA parsing yields on the desktop.
   - Scene bundles, same date — a scene is a FOLDER, not a file. Browsers
     have no folders, so `src/io/browserFiles.ts` collects a dropped
     directory (`webkitGetAsEntry`) or a picked one (`webkitdirectory`)
     into relative paths, and `src/gv/bundle.ts` resolves those into
     scenes: node CSV + companion tag file + sibling `media/` + the
     Channels `ch-map`/`ch-tracks` and `_gv_audio.txt` companions a later
     step will consume. A dropped parent folder may hold several scenes
     (Global_Terrorism_Example holds five) — those go in a picker.
     `src/gv/media.ts` assigns `texture_id`s the desktop's way (images
     sorted 1..N, videos continuing after them), case-INsensitively:
     Python's `sorted(Path…)` is case-insensitive on Windows and
     case-sensitive on Linux, and Jeff chose to match Windows, where the
     examples were authored. Agreed plan for the rest: zip bundles and a
     curated set of hosted example folders (with textures downscaled to
     ~2048px) come with the textures step; the full examples tree is
     315 MB and is never shipped wholesale.
   - ~~Textures~~ (shipped 2026-07-25): `src/render/textureLibrary.ts`
     decodes a scene's `media/` into GPU textures with the desktop's
     sampling (REPEAT wrap, linear mag, mipmapped min; flipY matches its
     mirrored QImage upload), fetching only the ids nodes reference. A
     failure never fails the load — the node draws untextured and the
     reason is reported. Colour × map is Three's default modulate, which
     is what fixed-function GL does. Materials are now CACHED by
     (colour, opacity, side, map): buildScene minted one per node, which
     is pathological at Event_Cloud's 209k and worse once each rebinds
     the same map.
     UV mapping is deliberate on every geometry
     (`src/render/uvGeometry.ts`), per Jeff 2026-07-25 ("I need all
     geometries to have optimal UV mapping"):
     - Round surfaces (sphere, cone, cylinder, pin, globe) share ONE
       equirect convention — u = (lon+180)/360 eastward from −X,
       v = (lat+90)/180 northward. Three's primitives are Y-up, and GLU's
       quadric mapping (which the desktop inherits from
       `gluQuadricTexture`) puts s=0 at +Y running BACKWARDS, so a map on
       a gluSphere is mirrored and quarter-turned. The desktop already
       rejected that where it mattered — `_draw_world_grid` hand-builds
       its globe with exactly this convention — so this applies the
       desktop's own better answer everywhere. That also closed the
       KML-alignment TODO the World Grid left behind.
     - Flat-faced solids get per-face 0–1, like the cube's `_CUBE_UVS`,
       NOT the desktop's spherical `_vert_uv` (which wastes ~60% of the
       image on a tetrahedron). Triangles group by plane, so a
       dodecahedron's pentagons take one image each, not three.
     - Cross/Star get their bounding box refit (Three emits raw ±1
       coordinates, tiling the image 4×). The desktop emits no texture
       coordinates at all for Circle/Star/Cross, so there was nothing to
       match.
     - Kept from Three where already right: BoxGeometry per-face,
       TorusGeometry's major/minor parameterisation, PlaneGeometry and
       CircleGeometry (which match `_draw_grid_solid` and `gluDisk`).
     A textured World Grid surface draws untinted and unlit — the desktop
     forces `glColor4f(1,1,1,a)` so the map reads as authored.
     Video textures play muted and looping; a Video Audio control
     (Muted / All Tracks / Solo to Selection) ports the desktop's audio
     dropdown and "Solo Audio to Selection" checkbox. Divergence:
     browsers refuse audible autoplay, so muted is the default and
     picking a mode supplies the gesture. Deferred: the desktop pauses
     videos no node drew this frame; animated-GIF per-frame delays
     (no example uses one — `ImageDecoder` is the eventual path).
   - ~~Channels animation~~ (shipped 2026-07-25): companion
     `gv_ch-map.csv` / `gv_ch-tracks.csv` files play a node attribute
     time series. `src/gv/channels.ts` parses both and resolves the
     three-way join (node `ch_input_id` → map `channel_id` → `ch<n>`
     track column) into a flat binding list holding each node's own
     Vec3/Rgba object, so applying a frame is a direct store; the
     desktop drops every unmatched piece in silence, this counts and
     reports them (a scene whose Channels quietly do nothing is the
     authoring mistake the spec warns about). Values are ABSOLUTE per
     frame with no interpolation, colours round-half-to-EVEN (Python's
     `round`, not JS's half-up) and clamp 0–255, `texture_id` rounds with
     a floor of 0. Stop restores the load-time CSV values; integrated
     rate motion deliberately stays where it left off.
     - `src/gv/rates.ts` integrates `translate_rate`/`rotate_rate`/
       `scale_rate` at the ANTz 60-cycles/s convention, scaled by real
       dt so it is frame-rate independent. It runs with or without
       Channels (RSS_News authors `rotate_rate_z` directly) and visits
       only a precomputed candidate set — the desktop rescans all nodes
       per tick, which is 12M property reads a second at Event_Cloud's
       209k. `freeze` must be read as a NUMBER: extras are strings and
       `'0'` is truthy in JS.
     - `src/render/dynamicNodes.ts` is what makes 60 Hz possible:
       buildScene is far too expensive to re-run per frame, so a scene
       registers its animated slice once per rebuild and only those
       Object3Ds are touched. Children nest under their parent's
       Object3D here, so a moved node carries its subtree for free
       (the desktop has to mark descendants dynamic too). Appearance-
       bound nodes get PRIVATE material clones — the shared material
       cache is what keeps 209k glyphs affordable, but a colour track
       through it would either repaint every look-alike or leak a new
       entry per frame. A map swap skips `needsUpdate` unless the
       null-ness changes (only that flips USE_MAP), which is what makes
       a flip-book affordable. An animated scale re-derives the 0.2
       draw floor on the node's glyph AND every descendant's.
     - Playback (`src/ui/channelsPanel.ts` + main.ts): frame slider,
       Play/Pause (Space), Stop (Shift+Space), FPS 1–30 default 30,
       Loop default on, Alt+C collapses the panel. A `_gv_audio.txt`
       manifest switches the clock to the audio's real playback position
       (`src/io/channelAudio.ts`); pressing Play supplies the gesture
       browsers require. Flip-book `texture_id`s are unioned into the
       media preload set — `Texture_Animation_Example`'s CSV
       `texture_id` is 0 and the channel names every id it draws.
     - Parity: `tools/dump_channel_frames.py` runs the REAL desktop
       `ChannelEngine` and dumps per-frame bound-attribute values;
       `src/gv/channelParity.test.ts` diffs four fixtures at 1e-9
       (rotation convention floats over all 120 frames, YBCO colour +
       scale + translate, texture-animation `texture_id`, sine wave's
       224 bindings). Each fixture needs its OWN folder under
       `src/gv/fixtures/channels/` — companion discovery requires
       exactly one ch-map and one ch-tracks per folder.
     - Divergences: a blank/unreadable track cell HOLDS the previous
       frame's value instead of becoming pandas' NaN (which the desktop
       writes straight into the attribute — a NaN translate deletes the
       glyph permanently, and holding is what the spec's authoring rule
       asks for). World Grid nodes are excluded from appearance sync:
       their surface draws untinted and their lattice at half alpha, so
       one uniform colour write would misdraw both. `?csv=<url>` loads
       guess the conventional companion names (no folder to scan).
       Not done: the desktop's rate-pause snapshot restore (the panel's
       Rate Motion checkbox just freezes in place).
   - ~~Plot/Surface overlays~~ (shipped 2026-07-25): the last two
     topologies whose children already placed correctly but whose
     connecting geometry never drew. `src/render/topologyOverlay.ts`
     ports the desktop `_draw_topology_overlays`' remaining two passes:
     a Plot (16) parent strings a polyline through its children in FILE
     (row) order at pixel width max(ratio·20, 1) from the PARENT, each
     vertex taking its own child's color; a Surface (17) parent buckets
     its children on their exact (translate_x, translate_y) rounded to
     6 decimals, sorts the unique x's and y's, and draws a quad per cell
     whose four corners all exist — holes are legal — with per-vertex
     child colors and a per-face normal, LIT (the only lit overlay) and
     one-sided, because paintGL runs with GL_CULL_FACE on. A Link (type
     7) child is never folded into either (the rule the YBCO example is
     built around), a hidden parent draws nothing, and neither overlay
     is pickable or occludes picking — the desktop's pick pass renders
     glyphs only.
     - Structure follows `linkOverlay.ts` for the same scale reasons:
       endpoints resolve through buildScene's id→frame map, plots batch
       into one fat-line object per (width, alpha), each surface is one
       mesh with 4 unshared verts per quad (so each keeps its own flat
       normal), and update() rewrites preallocated buffers per frame off
       the renderer's own matrix pass.
     - Parity: `tools/dump_topology_overlays.py` runs the REAL desktop
       `Viewport._draw_topology_overlays` HEADLESSLY — the module does
       `from OpenGL.GL import *`, so swapping those names for recorders
       captures its exact vertex stream with no GL context and no
       restatement of the logic under test.
       `src/render/topologyOverlay.parity.test.ts` diffs four fixtures
       (topology example, an edge-case CSV covering hidden rows / a link
       child / a lattice hole / a duplicate cell / a scaled parent, that
       same CSV under Show Hidden Nodes, and the 794-node showcase
       example at 529 quads).
     - Divergences, all from the fat-line addon: three's
       LineSegmentsGeometry carries RGB only, so a polyline draws at the
       MEAN alpha of its children (every stock example uses one alpha
       throughout); and the desktop's antialiased GL_POINTS cap/join
       dots are not reproduced — three's fat lines round their own caps.
       Structurally, membership (which children are on a polyline, which
       cells a lattice has) is baked per scene build rather than
       re-derived every redraw, so a translate_x/y change re-cells a
       surface at the next rebuild (drag release, inspector commit)
       rather than mid-drag. Lattice coordinates are meant to be fixed
       generated values, so this only shows in authoring the spec warns
       against.
   - ~~Zip bundles~~ (shipped 2026-07-25): a `.zip` dropped or picked
     opens exactly like the folder it was made from. `src/io/zip.ts` is
     an in-house reader — no dependency, the same call the project made
     for its CSV tokenizer, because the platform ships the hard part:
     `DecompressionStream('deflate-raw')` is the inflate and `Blob.slice`
     gives random access, so only the central directory is read to list
     an archive. Stored + deflated members, Zip64 sizes/offsets, and
     data-descriptor entries (the central directory always holds the
     real sizes) all work; encrypted members and other compression
     methods are skipped with a message rather than silently losing a
     scene's media. `expandZips` in `src/io/browserFiles.ts` turns the
     entries into the same `PathedFile` list a folder walk produces, so
     `bundle.ts` resolves scenes unchanged.
     - Archivers disagree about whether the folder itself is included
       ("zip this folder" vs "zip these files"), so when the members
       share no top-level folder the archive's own name becomes one —
       the scene is then labelled after the zip rather than after a bare
       CSV name, and a multi-scene archive keeps its shape either way.
     - macOS `__MACOSX/` shadow trees, `._name` AppleDouble files and
       `.DS_Store` are dropped: `__MACOSX/…/._Scene_gv_node.csv` matches
       the node-CSV convention and would otherwise appear in the scene
       picker as a second, broken scene.
     - Entries get a MIME type back from their extension. A Blob URL is
       what feeds `<video>`/`<audio>`, and those honour `blob.type`
       rather than sniffing — an extracted video with an empty type
       simply refuses to play.
     - Deliberate tradeoff: expansion is EAGER, so a zip holds its
       scene in memory while a dropped folder stays lazy (disk-backed
       `File` handles). Capped at 1 GB expanded / 20k entries, which
       also defuses a zip bomb. Corpus scene folders top out near 48 MB;
       the 93 MB five-scene Global_Terrorism_Example zip opens fine.
   - Remaining: a curated set of hosted example folders (agreed
     2026-07-25, textures downscaled to ~2048px — the full examples tree
     is 315 MB and is never shipped wholesale). Lower priority per Jeff
     (2026-07-25): folder drop and zip already let users draw from their
     own copy of the GlyphViz examples.
8. WebXR/stereo: deliberately deferred until basic parity exists.

## Collaboration notes

- Address the developer as **Jeff**, not "the user."
- Steve (a longtime friend/mentor, competent computer scientist) is helping
  "as time permits" — no fixed deadline on this project. Don't let it compete
  for urgency against Jeff's stated current priorities on the desktop repo
  (feature backlog + documentation). Treat this as a slow-simmer side track.
- When resolving an open design question with a "simplest default," say so
  explicitly rather than silently picking one and moving on.
- Verification of topology/rendering correctness can't rely on tests alone —
  use the cross-implementation diff approach in the Roadmap above, the same
  spirit as the desktop app's temp-CSV-through-real-app-objects pattern.

## Tech notes

Node 22, npm. `npm run dev` for the Vite dev server, `npm run build` runs
`tsc` (typecheck) then `vite build`. No conda/Python involvement in this repo.
