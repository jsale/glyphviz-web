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
        bar by click or Ctrl+B / Ctrl+E / Ctrl+P; Channels is Alt+C and
        the Node Table Alt+N. Ctrl+N is reserved by browsers and cannot
        be intercepted, which is why the last two are Alt chords. Each
        panel also CLOSES outright — see the screengrab-chrome item (h).
      - Select by tag text (shipped 2026-07-25), desktop
        `_on_select_by_tag`: a "Tag" keyword box + Select Matching Tags
        button in the Selection panel, sharing the Add-to-Selection
        checkbox and reporting through the same highlight-in-place
        selection as every other Select By criterion (no results list).
        `selectByTagText` in `src/gv/selectionOps.ts` is a
        case-insensitive substring match over `text` ONLY — never
        `link`, matching the desktop and keeping a URL's host name from
        pulling in nodes whose visible label says nothing of the kind.
        `text` is the field both authoring styles land in, so a
        gv_tag.csv scene searches the same way an inline one does. Small
        divergence: the row greys out for a scene with zero labels
        (where the desktop would answer "No nodes tagged with …"),
        consistent with the label checkboxes below it.
      - Node Table panel (shipped 2026-07-25), a port of desktop
        `node_table.py`: `src/ui/nodeTableModel.ts` (its `_COLUMNS`
        verbatim — 20 columns, raw ids, 3-decimal floats, packed-RGB
        colour key that excludes alpha) + `src/ui/nodeTable.ts` (the
        view), docked along the bottom, collapsed by default because it
        is an inspection tool and 20 columns unrolled over the viewport
        on every load is in the way of the thing being inspected.
        - Rows are VIRTUALIZED, which is the point of the port rather
          than a nicety: QTableView draws only its viewport, and a DOM
          table with Event_Cloud's 209k rows is not a slower version of
          that but an unusable one. Only the visible window plus a small
          overscan exists as elements, pooled and rewritten in place.
          Sorting is key-based over a COPY (the desktop's own reason:
          one key extraction per node, not a comparator re-reading whole
          nodes) — the scene array is the CSV's file order and is never
          reordered. Ties keep file order in both directions, since
          `Array.prototype.sort` and Python's `sorted(reverse=True)` are
          both stable.
        - Display order IS selection order, so sorting the table changes
          which node is PRIMARY — the desktop's `_selected_nodes` is
          literally `self._table.selected_nodes()`, in table row order.
          `orderedIds` in main.ts now reads `nodeTable.displayOrder()`,
          which is the scene array itself while no column is sorted.
        - Row clicks are Qt ExtendedSelection: click replaces, Ctrl+click
          toggles, Shift+click takes the run from the anchor (which Qt
          leaves put, so the run can be re-dragged), Ctrl+Shift+click
          adds it. Selection is two-way — every other way of selecting
          scrolls the table to the primary row. Non-bulk-selectable rows
          (World/Camera/World Grid) are listed and directly clickable,
          which is the documented way to select them.
        - Channels frames and gizmo drags rewrite fields without a
          rebuild, so the ~30 on-screen rows repaint from the animation
          loop; collapsed, the panel does no work at all.
   g. Viewport commands (shipped 2026-07-25), desktop parity:
      - J / Shift+J cycle the selected nodes' TOPOLOGY, O / Shift+O their
        GEOMETRY. `src/gv/attrCycle.ts` ports `_cycle_selected_topology` /
        `_cycle_selected_geometry` / `_cycle_targets`: the step applies PER
        NODE, so a selection holding two different topologies keeps holding
        two different ones. Geometry skips Mesh (23, meaningless without a
        mesh_id) and the link-only ids 27/28, while a Link node cycles
        between exactly those two. World/Camera rows and World Grids are
        never targets — a grid's geometry encodes flat-vs-globe. The
        desktop's `_after_attr_cycle` tail (table rows, Select-By combo,
        stale inspector combos, redraw) is one `rebuildScene(false)` here.
      - F toggles Follow Selected: the orbit pivot re-centres on the first
        selected VISUAL node in row order every frame, so the camera jumps
        from selection to selection AND tracks a node animating under
        Channels or a rate field. Pivot and camera move by the SAME delta,
        so distance/azimuth/elevation are untouched and orbit + zoom stay
        live (the desktop keeps its spherical params and only moves
        `_cam_target`); panning is overridden as a consequence. Divergence:
        following is suspended mid-gizmo-drag. TransformControls projects
        the pointer onto a world-space plane, so a camera chasing the node
        it is dragging feeds back into the drag and runs away — the desktop
        drags from screen-space deltas and has no such coupling.
      - B (and a Background row in the Scene panel) sets the scene
        background, which IS the World row's color_r/g/b — so it is a real
        CSV edit that saves and round-trips, not a viewer preference. A
        scene with no World row gets one synthesized on first change
        (`ensureWorldNode`, id = max + 1 and NEVER 0, since parent_id 0 is
        the root sentinel); that case rebuilds so the new row reaches
        nodesById and the Node Table, while every later change writes one
        uniform and skips the rebuild, keeping a colour-picker drag smooth
        at 200k nodes. B alone flips black↔white on the desktop's red ≥ 128
        threshold. `src/gv/worldNode.ts` also gave buildScene the desktop's
        lowest-id-wins rule for picking the World row (it took the first in
        file order before).
   h. Screengrab chrome (shipped 2026-07-26, Jeff's users' request): every
      editing affordance that draws over the scene can now be put away
      WITHOUT giving up the state it belongs to — users were deselecting,
      grabbing the shot, then reselecting from scratch.
      - Show Selection Box: the yellow halos hide while the selection stays
        completely live (`Selection.boxVisible` in `src/render/picking.ts`
        is render-only — primary node, gizmo target, every command, all
        untouched). Ported from desktop `Viewport.show_selection_box`,
        including its checkbox living in the Select By group rather than
        with Visibility: it is what you reach for while working WITH a
        selection, and unlike Hide/Show it changes no node data.
        Divergence: the desktop's Ctrl+B is this app's Scene panel (that
        chord predates the feature and is muscle memory here), so the web
        key is Ctrl+Shift+B.
      - Panels gained a third state: open → collapsed → CLOSED, cycled by
        the same hotkeys, with a × in every header. A collapsed panel still
        lays a bar over the scene, which is exactly what the screengrab
        complaint was about. Collapse is kept because it is the only state
        a MOUSE can return from — a closed panel's hotkey is its only way
        back — so the bar is what keeps a parked panel discoverable; the
        status line names the hotkey at the moment a panel closes, for the
        same reason. One rule on top of the plain 3-cycle
        (`nextPanelMode`): the hotkey only shrinks a panel further when the
        hotkey is what shrank it, so a press on a parked panel always
        OPENS it — otherwise the Node Table, which boots collapsed so its
        bar can advertise Alt+N, would answer that first Alt+N by
        vanishing.
      - Gizmo modes are now optional and toggleable, which is desktop
        parity that had been missed: `MainWindow._gizmo_mode` starts at
        None and the Move/Rotate/Size buttons are checkable ("Click again
        to return to camera-only"). So nothing is armed at boot, no
        handles draw until a button or W/E/R arms one, and pressing the
        armed one again puts them away.
        - Divergence, agreed with Jeff 2026-07-26: the armed mode is
          STICKY and the buttons are never disabled. The desktop clears
          the mode and greys the buttons the moment the selection empties
          — but both live in the same three lines of
          `_on_table_selection`, so the clear reads as a consequence of
          not wanting a checked button that is also a disabled one, not
          as an interaction decision. It is a mode you are in until you
          turn it off; a mode that turns itself off is only tolerable
          when there is no other way out, and the button and key both
          toggle. The handles simply come and go with the selection. This
          also settles W/E/R being able to arm ahead of a selection while
          the buttons refused to. Jeff intends the desktop to move this
          way too — like region select, the web app is the reference
          here, so do NOT "fix" it back toward the desktop.
   i. Tag text round 2 (shipped 2026-07-26, Jeff's request): three
      desktop features the labels work had left out.
      - Per-node PINNING, desktop `Node.show_text` + its "Always Show
        Text" inspector checkbox: a pinned label draws whatever the
        scene-wide Labels settings say and is exempt from the
        500/frame cap (the desktop caps `selected[~is_pinned][:cap]`,
        so the cap counts unpinned labels only). The node's own hide
        flag still hides it. New tracked CSV column `show_text`,
        written only when a scene pins something. The checkbox sits
        under the `text` row with the desktop's own wording and its
        tristate behaviour: a mixed selection shows indeterminate and
        one click pushes ONE value onto every selected node (the
        desktop connects `clicked`, not `toggled`, for this reason).
        Pinning a node with no text draws nothing, which reads as a
        broken checkbox — the desktop says so in its status bar, this
        says it in the panel next to the control.
        - `placeLabels` takes a PRECOMPUTED pinned list
          (`pinnedTagNodes`, refreshed per scene build) instead of
          rescanning: with labels off, a scene that pins three of
          209k nodes must cost three checks a frame. The desktop
          rescans behind a cached has-any-pinned flag.
      - Tag text COLOURING, desktop `tag_color_mode` + `tag_color_r/g/b`
        on the World row: a colour picker and a "Tag Text Matches Node
        Color" checkbox. Both are World-row CSV fields like the
        background, so they save and round-trip and a scene with no
        World row gets one synthesized (`ensureWorldNode`); neither
        needs a scene rebuild, since only the overlay reads them. The
        fixed pieces stay fixed on both sides: the face alpha (230) and
        the dark drop shadow, which is what keeps a label legible
        against both bright glyphs and bright backgrounds.
        - Placement: the desktop keeps these in its Display group,
          which in this app is the Selection panel's Labels section
          (that is where Show Tag Labels already lives) — NOT the
          per-node Properties panel, which here is purely the
          inspector.
      - LINKS are now selectable and labelled. A link's label anchors
        to the MIDDLE of the edge it draws (desktop
        `_link_label_anchor`), falling back to the link row's own
        position when an endpoint is missing; links sweep after
        ordinary nodes so node labels win the frame cap first.
        - Picking is a ray-to-segment pass over the batched edges
          (`LinkPicker` in `linkOverlay.ts`) at the desktop's pick
          width `max(ratio·20, 5)` PIXELS, re-derived to world units at
          each candidate's depth. It pushes into the same sorted
          intersection list as the glyph proxies, so nearest still wins
          and a solid World Grid still occludes. Prisms pick along
          their axis, like every other link — the desktop's pick pass
          draws a line for a link whatever its geometry.
        - Divergence: the desktop ALSO draws a fallback pick sphere at
          every link's own position. A link usually sits on its A-end
          node, so always drawing it lets links swallow clicks meant
          for the glyph underneath; here it exists only for a link
          whose edge never drew, which is the case the desktop's own
          comment gives as its reason.
        - Region select now sweeps links in at that same edge midpoint
          (it excluded them before, because a link's own frame says
          nothing about where its edge is). The desktop catches them by
          pixel; a midpoint is this app's centre-projection equivalent.
        - Selecting a link still draws no halo, matching the desktop's
          outline pass, which skips type 7 — the Properties panel, the
          Node Table row and the status line are the feedback.
   j. Colour round 2 (shipped 2026-07-26, Jeff's request): the backdrop's
      own switches, the palette system, and the scene render modes.
      - Show Grid / Show Axes / Grid Color, the desktop's Display-group
        checkboxes (`Viewport.show_grid` / `show_axes`) plus its Grid
        Color button. The two checkboxes are pure viewer preferences —
        nothing reaches the CSV, and they survive a scene load because
        they live on the Backdrop, not the scene. The COLOUR is scene
        data like the background: new tracked column
        `ref_grid_color_r/g/b` on the World row, written only when it
        leaves the default (56, 56, 71), with `ensureWorldNode` for a
        scene that has none. Show Grid ANDs with the existing
        scene-content switch (a real World Grid node still replaces the
        procedural one), and neither the colour nor either checkbox
        rebuilds the scene — one material colour, one `visible` flag.
        - Placement: the Scene panel's world group, next to Background,
          NOT the Selection panel where the desktop's other Display-group
          items landed. These are backdrop settings and Background is
          already a backdrop setting; grouping them beats matching a Qt
          group box whose membership this app has already split once.
      - Colour PALETTES, a port of `glyphviz_core/color_palette.py`
        (`src/gv/colorPalette.ts`): 26 palettes (13 pairs, odd = the even
        below it inverted), 20 literal colours for palette 0/1 and a
        128-step gradient for 2–25. The model is ANTz's and is not what
        you would guess — a node's rendered colour is ALWAYS the literal
        `color_r/g/b`, and `palette_id`/`color_index` are dormant
        metadata that resolve INTO it only when the user asks. Loading
        never resolves; rendering never reads them; the colour picker
        leaves them alone to go stale.
        - `=` / `−` step `color_index` within each node's OWN palette
          range, `Alt+=` / `Alt+−` step `palette_id` and re-wrap the
          index — per node, on the same `cycleTargets` subset as J/O,
          exactly like the desktop. Indices WRAP (modulo), never clamp.
        - Properties panel gains `palette` + `color index` rows directly
          above the colour picker, the desktop's own order, because that
          IS the relationship: both write what the picker then shows.
          Both apply ABSOLUTELY to every selected node (the desktop's
          `_on_insp_palette_changed` / `_on_insp_color_index_changed`),
          unlike the per-node cycle keys.
        - Rounding is Python's half-to-EVEN, the same trap the Channels
          colour tracks hit — `roundHalfToEven`, not `Math.round`.
        - Parity: `tools/dump_palette_colors.py` runs the REAL
          `resolve_palette_color` over all 26 palettes × every valid
          index (plus out-of-range wraps);
          `src/gv/colorPalette.parity.test.ts` diffs it EXACTLY, since
          colours are integers.
      - RENDER MODES (`src/render/renderMode.ts`), the World row's
        `render_mode`: the desktop's seven scene-wide blend states
        (Normal / Additive / Subtractive / Dark (Multiply) / Off /
        Screen / Premultiplied Alpha), cycled by `8` and pickable from a
        Scene-panel row. Already a parsed+written column; this makes it
        do something.
        - The desktop sets ONE global GL blend state per frame; WebGL has
          none, so the same `glBlendEquation`/`glBlendFunc` arguments are
          written as CustomBlending factors onto every material in the
          scene content. Two consequences: three disables blending
          outright for a material with `transparent: false`, so every
          non-Normal mode forces transparency ON (the material's own
          value is remembered and restored by Normal, so an ordinary
          scene renders exactly as before); and materials are walked
          UNIQUE, not per object — they are shared by the thousand, so
          Event_Cloud costs a few hundred writes, not 209k.
        - Divergence: the mode covers scene content only (glyphs, links,
          plot/surface overlays, backdrop grid and axes) and leaves the
          editing chrome — transform gizmo, selection halos — Normal,
          where the desktop's global state catches those too. Under Dark
          (Multiply) a yellow halo would vanish into the glyph it is
          meant to outline; chrome you cannot see is chrome you cannot
          use. Same line as Show Selection Box and the closable panels.
      - Bug fixed in the same session (Jeff spotted it): `zSphereGeometry`
        wound every triangle INWARD, so with FrontSide culling a sphere
        drew the inside of its far hemisphere — a flat dark disc that
        plot lines and links passed straight through. It looked
        plausible in isolation because the vertex normals were right, so
        it lit correctly; only something drawing behind a sphere gave it
        away. Spheres and the pin head were the only glyphs affected
        (the tube builder was already correct, and the World Grid globe
        draws DoubleSide). `uvGeometry.test.ts` now checks the winding
        of every round primitive against its own normals, with Three's
        SphereGeometry/BoxGeometry as a control on the check itself —
        the old code scores 0/1 on it.
   k. Lighting + colour pipeline parity (shipped 2026-07-27, several of
      Jeff's users reported web colours reading duller and washed out
      next to the desktop's). `src/render/lighting.ts` replaces the
      approximated rig with the desktop's own `initializeGL` numbers.
      Three things were wrong, and they compounded:
      - Brightness. The desktop shades
        `C · (0.2 + 0.3 + 1.0·max(N·L, 0))` clamped at 1 — GL's default
        GL_LIGHT_MODEL_AMBIENT (never overridden) plus GL_LIGHT0's own
        ambient and diffuse, with `glColorMaterial(AMBIENT_AND_DIFFUSE)`
        putting the node colour in both terms and no `glMaterialfv` call
        anywhere, so the specular light lands on a default-black
        material and contributes nothing. Half the albedo is there
        before any light arrives and anything facing the light
        saturates, which is why desktop glyphs read as flat vivid
        colour. Three (since r155) takes intensity in physical units and
        divides by π in `BRDF_Lambert`, so the coefficients are π-scaled
        on the way in: ambient 0.5π, key π. The old 0.6/1.6 pair peaked
        at 0.70 of albedo where the desktop peaks at 1.5-clamped-to-1.
      - Direction. `glLightfv(GL_LIGHT0, GL_POSITION, [1,2,1,0])` is
        specified in `initializeGL` while the modelview is still
        identity, so the direction is captured in EYE space and the key
        light is bolted to the camera — shading does not change as the
        scene is orbited. The web's was world-fixed at (3,−4,5). The
        light and its target stay OUT of the scene graph and are aimed
        per frame from the camera, rather than parenting them to the
        camera, which would mean putting the camera into the scene where
        every existing traversal would have to start ignoring it.
      - Colour space. Fixed-function GL has none: a CSV byte lands in the
        framebuffer as-is and the shading multiply happens on
        sRGB-encoded numbers. Three's managed pipeline treated the same
        values as linear and encoded the result on output, lifting every
        midtone and desaturating — crimson (220,20,60) left as
        (204,66,113). `applyDesktopColorPipeline` sets
        `outputColorSpace = LinearSRGBColorSpace` (identity OETF, sRGB
        drawing buffer) and pins NoToneMapping for GL's clamp; scene
        textures move to `NoColorSpace` to match, since a
        decoded-to-linear map under a raw output is the same mismatch
        reversed. Every colour in the app is built with the numeric
        `THREE.Color(r, g, b)` triplet, which is already raw working
        space, so nothing else needed changing — and the unlit chrome
        (grid, links, halos, background clear) now matches the desktop
        exactly too, where before it was uniformly brightened.
      - Divergence: the desktop's Gouraud (per-vertex, `GL_SMOOTH`)
        shading is per-FRAGMENT here, which is what MeshLambertMaterial
        does. Visible only as smoother terminators on the low-poly
        primitives.
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
     - Assigning a texture (shipped 2026-07-25): a `texture` row in the
       Properties panel, where the desktop has a bare `Texture ID`
       spinbox. Because the web app already knows the folder's contents
       (`buildMediaIndex`), the row is a MENU of the actual files —
       `1 · earth.png`, videos and undecodable formats marked — plus
       ‹ › buttons that step it with wraparound. `textureChoices` /
       `stepTextureId` in `src/gv/media.ts`; the value applies
       absolutely to every selected node, matching the desktop's
       `_on_insp_texture_id_changed`. With no media folder (a bare CSV,
       `?csv=`) the row degrades to the desktop's plain id field, so an
       id can still be authored ahead of the media it names.
     - Consequence: textures now load in more than one batch. Load-time
       decoding fetched only the ids nodes referenced, so naming a new
       one has to fetch it on demand — `decodeTexturesFor` in main.ts
       tracks which ids were attempted (a missing or undecodable id is
       never re-fetched) and `mergeTextureLibrary` folds each batch into
       the live library. The glyph draws untextured for the moment a
       decode takes, then the rebuild paints it.
     - The panel rebuilds itself after every edit, which would throw
       away the button being clicked, so controls carrying a
       `data-ins-key` come back focused — that is what makes a run of
       steps possible. Those buttons also swallow Space/Enter, which
       would otherwise reach the viewport's single-key commands and
       toggle Channels playback on every press.
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
