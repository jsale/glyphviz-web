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
      - TO DO from this round: select by tag text (deferred until this
        app has a story for scenes whose labels live in a companion
        gv_tag.csv rather than inline text columns), and a Node Table
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
   - Remaining: Plot/Surface overlays, textures, tags/labels, Channels
     animation.
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
