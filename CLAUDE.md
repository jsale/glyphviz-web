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
7. Still-unimplemented format features, scheduled opportunistically: World
   Grid placement, Link edges, Plot/Surface overlays, textures, tags/labels,
   Channels animation.
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
