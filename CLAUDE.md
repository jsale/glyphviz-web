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
      - Halos are ONE batched draw for the whole selection (see item l),
        so `MAX_HALOS` (250,000) is a memory guard rather than a budget;
        past it the selection stays complete and only the highlight
        stops drawing.
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
        leaves them alone to go stale. (Since 6s there is ONE automatic
        path: a channel binding either field resolves it every frame.)
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
   l. Frame-rate readout + halo batching (shipped 2026-07-27, Jeff's
      request — he wanted numbers to chase a performance problem with,
      and had found that a Ctrl+A highlighted well under half of what it
      selected).
      - `src/ui/fpsMeter.ts`, ported from desktop `Viewport.paintGL`'s
        counter (frames ÷ elapsed, emitted once elapsed ≥ 1 s) and
        `MainWindow._on_fps_updated`'s permanent `f"{fps:.1f} fps"`
        status-bar label — same window and rounding, so a number read
        here compares with one read there on the same scene. It adds two
        things the desktop has no need of: the animation loop's own CPU
        ms per frame (mean and the window's WORST frame), which is what
        separates "our JavaScript is the bottleneck" from "the GPU is",
        and the last frame's `renderer.info.render` draw calls and
        triangles, which is what the batching work all over this app
        exists to hold down. Bottom-left above the status line; a Show
        FPS checkbox in the Scene panel's world group puts it away for a
        screengrab (item h's rule), and there is deliberately no hotkey
        — the desktop has none and the free single keys are worth more
        to future parity work. `FrameSampler` holds the counting with no
        DOM in it, the way `nextPanelMode` holds the panel state machine,
        because this suite runs in plain node.
      - Selection halos are now ONE draw call for the entire selection
        (`Selection` in `src/render/picking.ts`), which is what raised
        `MAX_HALOS` from 1,000 to 250,000 — past Event_Cloud's 209k, so
        a Select All is complete on every example in the corpus. The old
        halo was a LineSegments parented to the glyph: tracking was free
        (the glyph's own draw matrix, 0.2 floor included, placed the box)
        but each cost a draw call, and the cap that bought silently left
        most of a big selection un-outlined while the selection itself
        stayed complete — the nodes still took edits, which is exactly
        how Jeff noticed.
        - The trade it makes is the one `linkOverlay`/`topologyOverlay`
          already made: vertices are WORLD space, written from each
          glyph's `matrixWorld` (8 corners = a centre plus three scaled
          axis vectors, no `applyMatrix4`), so they have to be rewritten
          when a node moves — `refreshHalos()`, called from the animation
          loop under the same `tickAnimation() || gizmo.dragging`
          condition the Node Table repaint uses, and one frame stale for
          the same documented reason. A still scene costs nothing at all.
          Every other way a node moves ends in a `rebuildScene`, whose
          `setSelection` rewrites them anyway — which is why that
          function now calls `updateMatrixWorld()` on the freshly added
          root: a frame that has never been through a render pass has no
          world matrix to read.
        - The object hangs off the SCENE, not the built root: it is
          chrome, so it outlives every rebuild, stays out of
          `fitCameraTo`'s bounds and out of `applyRenderMode`'s walk
          (which skipped it by `isSelectionBox` before). It also no
          longer sits in the raycaster's path — 12 line segments per
          selected node were being tested on every click.
        - Buffers grow geometrically and never shrink, `setDrawRange`
          picks out the live slots, and growth builds a NEW geometry and
          disposes the old one, because under the WebGL renderer
          `BufferAttribute.dispose()` only fires an event nobody listens
          to — the GL buffers are freed by the GEOMETRY's dispose.
   m. Draw-limit decimation (shipped 2026-07-27, Jeff's request — the
      ANTz `\` / `Shift+\` keys, and a direct check of whether this app
      had the desktop's own bug): `\` halves the drawn node count,
      `Shift+\` (`|`) doubles it back, null = show all. The model is the
      desktop's `_draw_limit` exactly — a PREFIX of the eligible rows in
      file order, not a stride, so visibility never depends on the
      camera and the frame rate a limit buys holds still as the scene is
      orbited. `src/render/drawLimit.ts`; the arithmetic, the denominator
      and the status wording are `_adjust_draw_limit`'s own, so a readout
      here compares directly with one read on the desktop.
      - It DID have the same bug, in the platform's own dialect. The
        desktop's first attempt bought almost nothing (700k nodes:
        0.4 → 1.6 fps) because ~900 ms of fixed O(N) Python scans ran per
        frame regardless of the limit; its revisit (`6f042f7`, the
        `_SceneScan` cache) is what made it 0.4 → 229 fps. Three.js is
        retained-mode, so the analogous trap is `glyph.visible = false`:
        the Object3D stays in the graph and `Scene.updateMatrixWorld`
        recomposes and re-multiplies its matrix every frame BEFORE the
        renderer ever reads `visible`. Measured at Event_Cloud's 209k
        (three Object3Ds per drawn node — frame, glyph, pick proxy):
        629k objects = 93.8 ms/frame of pure CPU matrix work, and the
        `visible = false` version floors at ~23 ms no matter how far you
        keep halving. `matrixAutoUpdate = false` barely helps (22 ms) —
        the recursion itself is the cost, not the compose.
      - So the cut is applied when the graph is BUILT: nodes past it
        contribute no Object3D at all, and every downstream per-frame
        cost (matrix traversal, the renderer's project pass, draw calls,
        raycasting, halo rewrites) falls with it. Measured, same scene:
        93.8 → 50.6 → 22.2 → 12.4 → 5.8 → 2.6 → 1.4 → 0.5 → 0.2 ms over
        eight presses, linear in the drawn count the whole way. The price
        is a `rebuildScene` per keypress, which each press makes cheaper
        than the last.
      - Frames survive the cut for the nodes the overlays resolve
        through — link endpoints, Plot/Surface parents and their children
        — plus their ancestors, since the desktop draws those
        irrespective of the limit (`_draw_topology_overlays` never
        consults it). `keep` is upward-closed, so buildScene skips a
        whole subtree on one test. Consequence: Org_Event_Network's 6,400
        links floor it at ~2 ms / 13.7k objects instead of reaching zero,
        and a scene whose overlays reach every node prunes nothing. That
        is honest rather than a defect — the desktop cannot decimate
        those either.
      - Divergence: the desktop keeps a node selected AND pickable past
        the cutoff ("selecting then hiding keeps the selection live").
        A node with no frame here has nothing to hold a halo or a
        selection membership, so the part of a selection past the cut
        drops on the press. Changing it would mean letting
        `Selection.set` retain frameless ids, which would also make
        DELETED ids linger — not worth it for this.
      - A new scene resets the limit (desktop `set_nodes`); it otherwise
        survives every edit, which is why the scene HUD line says
        `N drawn (\ limit)` rather than leaving it to be inferred.
   n. Cross-eye stereo 3D (shipped 2026-07-27, Jeff's request — the last
      desktop feature this app was missing): a Stereo 3D (Cross-Eye)
      checkbox and an Eye Separation slider in the Scene panel's world
      group draw the scene TWICE, side by side in the one canvas, so
      crossing your eyes fuses the pair into 3D with no glasses and no
      headset. `src/render/stereo.ts`; the camera maths is
      `Viewport._setup_stereo_eye_matrices` argument for argument.
      - The screen-LEFT half gets the RIGHT eye's camera. That is what
        makes it cross-eye rather than parallel/wall-eyed viewing, and it
        is the whole reason the halves are not interchangeable.
      - Both eyes SHARE one orientation — the eye is displaced along the
        camera's own right axis and nothing is re-aimed. This is the
        desktop's second attempt: a per-eye look-at gives each eye a
        slightly different forward vector, and since that basis comes
        from cross(forward, up) it destabilises differently in each eye
        as the camera orbits toward the pole, twisting the halves against
        each other. Convergence instead comes from an OFF-AXIS frustum
        shifted by `-offset · near / distance`, which puts zero parallax
        exactly at the orbit pivot and adds no vertical parallax — the
        thing that makes a toe-in pair tiring to free-view. The shift is
        proportional to `near`, so it is the same ANGULAR shift at this
        app's 0.001 near plane as at the desktop's 0.1.
      - Separation is a PERCENTAGE of the orbit distance (desktop
        `stereo_separation_pct`), so the depth effect holds as the camera
        zooms. The slider is the desktop's own: 0.5–15.0% in tenths,
        default 3.0%, and live in both states so a value can be set
        before switching the pair on — a number set here reads straight
        across to the other app.
      - Screen-space gestures that had to learn about the split:
        - Picking re-projects the eye that drew the half the pointer is
          in back onto FULL-canvas coordinates (`remapProjectionToCanvas`
          — a plain affine squeeze folded into the projection matrix), so
          every existing pointer-to-NDC path works unchanged. It is this
          app's equivalent of the desktop re-rendering its colour-ID pick
          pass with that eye's matrices (`_pick_node`).
        - The transform gizmo is handed that same remapped camera from a
          document-CAPTURE pointer listener, which runs ahead of
          TransformControls' own — and never mid-drag, since the drag
          plane belongs to the eye the grab started in. The desktop had
          nothing to port here: its manipulation is a screen-delta drag
          with no drawn handles, so stereo never affected it.
        - Region select is DISABLED in stereo, desktop parity: one screen
          rectangle spans two projections of the scene and names no
          single node set. A Shift+drag says so in the status line rather
          than silently doing nothing.
      - Labels paint per eye into that eye's half (desktop
        `_draw_tags_qpainter_stereo`), each pass carrying its own
        500-label frame cap, as on the desktop. `placeLabels` grew a
        viewport offset for it and `LabelOverlay` split into
        `clear()` + `paint()`.
      - Two things that are pixels-per-viewport, not pixels-per-canvas,
        and would otherwise be wrong by 2×: fat-line resolution (links,
        plot lines) follows the half; and `fitCameraTo` pulls back for
        the halved aspect, the desktop's `_fit_distance` halving `w`.
      - `renderer.info.autoReset` is off and the counters are reset once
        per frame, so the FPS panel reports BOTH eyes. Stereo costs
        exactly double the draw calls and triangles — measured on the
        Topology example, 114 → 228 calls and 87k → 175k triangles — and
        the readout should say so.
      - No hotkey: the desktop's is a menu item and a checkbox with no
        shortcut, and the free single keys are worth more to later parity
        work. The HUD chrome (panels, FPS, status line) still spans the
        whole canvas, exactly as the desktop's panels and status bar do.
   o. Copy / Paste (shipped 2026-07-27, Jeff's request), a port of desktop
      `_copy_selected` / `_paste_clipboard`, which document themselves as
      "V1: single node + full descendant closure only" — Ctrl+C, Ctrl+V,
      and a pair of buttons in the Create panel.
      `src/gv/clipboard.ts` is the whole rule set; main.ts holds only the
      selection plumbing and the desktop's own status wording.
      - The one-object restriction is the feature's defining constraint on
        both sides, and Jeff named it as this port's constraint too. It is
        the same rule `deleteSubtree` already works under: a node always
        brings every descendant, because a partial subtree has no
        well-defined shape once re-parented. Copy therefore wants EXACTLY
        one selected node (the set-selection era makes that a real check,
        not an assumption) and paste wants one target or none.
      - Paste target: one selected node → the subtree becomes its CHILD at
        `(siblingCount·5, 0, 5)`, positioned exactly like New Child, which
        is why re-selecting the original's parent is how you get a plain
        sibling. Nothing selected → a new root object at `nextRootX`
        (extracted out of `createRootNode`, shared the way the desktop
        shares `_next_root_x`). Branch levels shift by the root's delta
        throughout, so a level-3 subtree pasted at level 0 renumbers.
      - Ids come from `max(existing) + 1` in clipboard order — the same
        allocator new nodes use — so a paste renumbers against whatever
        scene it lands in. The clipboard survives loading a DIFFERENT
        scene for that reason (it does on the desktop too), which makes it
        a way to move a hyperglyph between files.
      - Links ARE handled, because the desktop handles them: an edge with
        both ends inside the copied subtree is remapped to the new ids,
        one reaching outside is dropped rather than left dangling. The
        dropped link still consumes its id, exactly as on the desktop, so
        pasted ids can have gaps. Divergence: the drop is reported in the
        status line, where the desktop is silent — the difference between
        "paste lost a row" and a deliberate rule.
      - Web-only consequence: under a draw limit the tail of a big paste
        has no frame yet, so it is left out of the post-paste selection —
        the same rule every other selection path follows (item m).
      - The clipboard is IN-MEMORY, like the desktop's, so it does not
        cross browser tabs. Writing the subtree to the system clipboard as
        CSV would, and is the obvious later step; it is not what the
        desktop does and was not part of this ask.
   p. Draw-scale floor fix + draw-matrix parity (2026-07-27, Jeff's bug
      report against 6o): a hyperglyph pasted onto a small child rendered
      far too big, and each further paste made it worse — the desktop's
      copies shrink with every nesting level, the web's did not.
      - Cause: the 0.2 render floor was applied to the ACCUMULATED world
        scale. The desktop applies it to each node's OWN scale, exactly
        once — `node_world_matrix`'s
        `S_child = diag(own scale · base_scale, floored at 0.2)`, with
        `parent_basis` carrying the ancestors' raw scales under no floor
        at all. So an ancestor chain shrinks a descendant without limit,
        while the web's version stopped shrinking at 0.2 and inflated
        every deeply nested glyph. Four levels of scale 0.3 should draw
        at 0.3⁴ = 0.0081; it drew at 0.2, 24× too large.
      - `drawScaleCorrection` now takes the node's own axis scale. Two
        consequences fell out: buildScene no longer threads a cumulative
        scale down the recursion, and DynamicNodes registers only the
        animated node itself rather than walking its whole subtree —
        a descendant's correction cannot depend on an ancestor any more.
      - Why the existing parity harness missed it: `parity.test.ts` diffs
        `compute_world_transforms`' world position and RAW world basis,
        and neither base_scale nor the floor exists at that layer. They
        appear only in the draw matrix. `tools/dump_draw_matrices.py` now
        dumps `Scene.node_draw_data`'s 4×4 per node and
        `src/render/drawMatrix.parity.test.ts` diffs the whole matrix at
        1e-9 over a fixture built to the bug report's shape (a 0.3-scaled
        chain four deep, a node whose own scale is under the floor,
        non-uniform scales, rotations at several levels). Verified to FAIL
        against the old formula before being kept.
      - The other divergence this harness exposed, noted then and
        **shipped 2026-07-28**: a node whose own `topo` is Rod (6) is
        drawn by the desktop (`scene.py` `_bake_draw_data`) with
        `_ROD_SCALE_FACTORS` (0.25, 0.25, 5.0 — `ROD_RADIUS_FACTOR` twice
        then `ROD_HEIGHT_FACTOR`, from `geometry_data.py`) and a cap
        offset `pos += M3[:, :, 2]` putting the cylinder's bottom at its
        world origin (ANTz kNPoffsetRod). The web did neither, so a Rod
        node drew at the wrong proportions and ~5 units out of place —
        one node in the topology example (id 37), one in the sine wave
        example, both built-in scenes, so it was visible immediately.
        - Both live on the GLYPH, joining the floor in one
          `applyGlyphDrawScale` (buildScene.ts) that buildScene and the
          animation path share. The factors multiply the FLOORED scale,
          in that order, and apply whatever geometry the row names —
          `topo` here is the node's own, the field that otherwise only
          places its children. The offset is `(0, 0, glyph.scale.z)` in
          frame coordinates: the frame's third basis column is the
          rendered Z axis before the glyph's own scale, so the shift
          picks up every ancestor's rotation and scale exactly as
          `M3[:, 2]` does, at any depth. A World Grid is excluded on both
          sides (`rod & ~grids`) — its scale means extents.
        - Nothing about a rod's CHILDREN changes: the desktop's
          `parent_basis` carries raw rotation·scale only, and here the
          frame children hang from is untouched. Rod child placement was
          already right (`topology.ts`, parity-tested since 2026-07-24).
        - Follow Selected and tag labels deliberately stay on the frame:
          the desktop anchors both to `world_pos`, so a rod's label sits
          at its bottom cap there too. Click picking follows the glyph on
          both sides (its pick proxy is the glyph's child; the desktop's
          colour-ID pass draws with the draw matrix). Region select had
          to move to the glyph centre — the desktop sweeps by pixel and
          catches the rod where it draws, and this app's centre
          projection would otherwise have been testing a point 5 units
          below the shape.
        - The fixture gained rod rows (a rod under scaled+rotated
          ancestors, one whose own scale is under the floor, a child off a
          rod, a grid carrying topo 6) AND a second fixture: the real
          Topology_Example, all 109 rows diffed glyph for glyph. The
          hand-written fixture is what let this survive step 6p — it
          contained no rod — so a real scene now backs it up. Both
          verified to FAIL with the rod branch removed.
   q. Rate fields in the inspector (shipped 2026-07-28, Jeff's request —
      he noticed the GUI could not set them). `translate_rate_*`,
      `rotate_rate_*` and `scale_rate_*` were parsed, integrated
      (`gv/rates.ts`), written and Channels-bindable, but reachable only
      by hand-editing a CSV. Three rows in the Properties panel now edit
      them, ported from the desktop's three rate spinbox groups: the
      desktop's ranges (±1e6 / ±3600 / ±1e4), its tooltip wording, and
      its form order — each rate sits directly under the vector it
      accumulates into (translate, translate rate, rotate, rotate rate,
      rot. mode, scale, scale rate), which is the only order in which a
      velocity reads.
      - Values apply ABSOLUTELY to every selected node, per axis.
        Divergence: the desktop's one handler serves all three spinboxes
        and writes all three axes from whatever they show, so editing X
        on a mixed selection also flattens Y and Z onto the primary's.
        This app's absolute vector rows have always been per axis —
        `absoluteVec3Row`, the same path scale uses — and these follow it.
      - The rows are deliberately NOT `data-ins-key` keyed. A keyed
        control comes back focused after the rebuild an edit triggers,
        which is right for the texture steppers (buttons, clicked in a
        run) and wrong for a text field: single-key commands and the
        Ctrl chords stand down while a field has focus, so parking focus
        there would silently swallow the next J/T/Space/Ctrl+A. Found by
        driving it, not by reading it.
      - The feature this exposed: `ChannelsPanel.setScene` decided the
        Rate Motion checkbox's visibility (and, for a channel-less
        scene, the whole panel's) at LOAD. A scene that loaded with no
        rates could now acquire one with no way to stop it. Split out as
        `setRateNodes(count)` — the narrow update, called from
        rebuildScene right where `rateCandidates` is recomputed, since
        everything else setScene does resets the transport to frame 0,
        which a playing scene must not lose.
      - Rate columns are written only when some node's group is nonzero
        (`writeNodeCsv`'s `when:`), which was untested until now: a value
        typed here has to reach a file the desktop opens, or the field
        does nothing after a save.
      - Note for later: the desktop's rotate_rate_z tooltip also
        promises texture scroll on a Prism (Textured) Link. This build
        stores and saves the value but does not flow link textures yet
        (deferred at the link step, still open) — the tooltip says so
        rather than promising it.
   r. Global Scale + Save PNG (shipped 2026-07-30, Jeff's request — the
      first two of four desktop features this app was missing; the other
      two, the expanded Channels attribute set and Camera Mode free
      flight, are each their own session, see the Pending list below).
      - GLOBAL SCALE (`src/render/baseScale.ts`), the desktop's
        Display-panel slider (`_update_scale` → `Viewport.base_scale`):
        0.1–10.0 in tenths, default 1.0, in the Scene panel's world
        group. Quantized through the same integer lattice the desktop
        divides by ten, so a stored value is bit for bit the one that app
        holds (`Math.round(v * 10) / 10`, never `× 0.1`).
        - It is NOT a multiplier on rendered size, which is why it could
          not be a render-time flourish. Two separate things read it:
          the DRAW scale (`S_child = diag(own · base, floored at 0.2)`,
          floored AFTER the multiply, so raising it lifts small nodes off
          the floor) and every topology's BASE RADIUS through
          `compute_world_transforms` — a Sphere parent's surface, a
          Torus's major radius, a Rod's length, a Spiral's pitch — so
          children ride outward with the parent they sit on instead of
          sinking into it. Both were already threaded through one
          constant here; the port is making that constant live.
        - A viewer setting, never CSV: it survives a scene load, like
          Show Grid/Axes, and no writer knows about it. World Grids are
          exempt on both sides (`gridDrawScale` is raw scale × extents
          half-spans), and a globe grid's children keep the geographic
          GRID_GLOBE_RADIUS.
        - The slider does NOT rebuild the scene. `rescaleSceneFrames`
          rewrites the existing Object3Ds — the graph's shape does not
          change, only its numbers — which is the DynamicNodes trade in
          the small. Measured at 100,400 nodes in Chrome: ~129 ms per
          step in place against ~783 ms for the equivalent full rebuild,
          6× cheaper, and rAF-coalesced so a drag applies once per frame.
          The parent-resolution rule buildScene's recursion carries is
          now one shared `effectiveParent`, because the in-place path has
          to resolve exactly the parent a node was built under.
        - Module-level mutable state, deliberately: the desktop has one
          such value for the whole viewport, and threading it would put a
          parameter on eight signatures — two parity-tested — to say the
          same thing. Tests must restore it.
        - Divergence: the Hyperglyph/Composer previews follow the slider,
          where the desktop's dialogs each hold their own Viewport at
          1.0. A preview that draws the design the way the scene will is
          the better default, and it is free.
        - Parity: `tools/dump_draw_matrices.py` takes the base scale as an
          argument now, and `drawMatrix.parity.test.ts` diffs BOTH
          fixtures at 2.5 — the synthetic one and the real
          Topology_Example, all 109 rows, which is the placement half
          (every topology family at once). Verified to FAIL both when
          placement ignores the value and when the floor is applied
          before the multiply. Until this, that harness asserted
          `base_scale === 1` and was blind to the one input to a draw
          matrix that no CSV can carry.
      - SAVE PNG (`src/render/screenshot.ts`), desktop File ▸ Save Scene
        as PNG (F12 → `Viewport.save_screenshot`'s `grabFramebuffer`): a
        Scene-panel button and **Alt+P**. F12 is unusable — browsers
        reserve it for developer tools and deliver the keydown too late
        to stop it — so this takes the Alt lane the Node Table's Alt+N
        already uses for a reserved Ctrl+N (Ctrl+P is the Properties
        panel).
        - Two things had to be reproduced rather than inherited. A WebGL
          drawing buffer is only readable inside the task that drew it,
          so the click sets a flag and the capture runs at the TAIL of the
          animation loop; `preserveDrawingBuffer: true` is the
          alternative and taxes every frame for the sake of a rare one.
          And tag labels are a second canvas over the WebGL one, so the
          image is COMPOSITED or every label goes missing from it.
        - Everything else falls out: the HUD is DOM, so panels, status
          line and FPS readout stay out of the image exactly as the
          desktop's Qt widgets do (the point of the screengrab-chrome
          work this belongs to); stereo saves the pair as it appears,
          both eyes already being in the one buffer; and the file is at
          full device resolution (verified 2000×1400 at dpr 2).
        - Filename is `with_suffix('.png')`, so
          `topology_example_gv_node.csv` → `topology_example_gv_node.png`
          and no scene open → `scene.png`. One divergence: an extension
          must start with a letter, so `scene_v1.2` keeps its tail —
          Python would eat it, which is tolerable in a save DIALOG the
          user can correct and not here, where this IS the name.
      - Found by driving it, not by reading it: the inspector's world-pos
        line is a snapshot taken when the selection last changed, and the
        Global Scale is the only edit that moves a node without touching
        a CSV field, so the readout sat at the old position while the
        glyph moved under it. `applyBaseScale` refreshes it.
   s. Channels round 2: the expanded bindable set (shipped 2026-07-30,
      roadmap 8a — desktop `77d6361`, 22 → 34 attributes): shape
      (`ratio`/`topo`/`geometry`/`mesh_id`), palette (`palette_id` +
      `color_index`, resolved to literal color_r/g/b EVERY frame — the first
      automatic palette resolution), visibility (`hide`/`show_text`), and the
      World row's `render_mode` + fog fields. Engine in `src/gv/channels.ts`:
      one accessor table for all 34 (the desktop's `_ATTR_TO_FIELD` +
      `_INT_FIELDS` + `_FIELD_RANGE` in one), integer fields rounding
      half-to-EVEN then clamping to their own valid range, floats sign-exact;
      palette resolution runs LAST, so a node binding both color_index and
      color_r resolves from the palette and color_a is never touched; Stop
      restores the resolved color_r/g/b nothing bound (snapshotted at bind
      time, the desktop's own load rule).
      - FOG shipped first, as the prerequisite scene feature it was:
        `src/render/fog.ts` renders the World row's fog_enabled/fog_start/
        fog_end as GL_LINEAR fog in the BACKGROUND colour (the desktop passes
        the row's own color_r/g/b to GL_FOG_COLOR). Three's linear fog is
        smoothstep, so `installLinearFog()` patches the shared fog_fragment
        chunk to GL's straight ramp before anything compiles; LineMaterial
        needs `fog: true` said explicitly (ShaderMaterial defaults it off),
        so link/plot edges fade with the glyphs they connect. Chrome — halos,
        gizmo — is exempt via `material.fog = false`, the 6j render-mode line
        again. Scene panel: Enable Fog + Fog Start/End directly under Render
        Mode, the desktop's own rows and ranges. Divergence, deliberate: the
        toggle WRITES the displayed 20/200 onto the row, where the desktop's
        checkbox leaves the data at 0/0 (sync blocks signals, toggle writes
        only the flag) and the scene dissolves entirely into background.
      - Fast path (`dynamicNodes.ts`, whose update() now returns a report):
        shape fields swap the GLYPH OBJECT when the value changes (flip-book
        cadence by the authoring rule), re-privatising appearance clones and
        re-arming the pick proxy — a World Grid's geometry swap is its
        globe↔flat flip; `hide` toggles glyph.visible on a glyph buildScene
        keeps alive for hide-bound nodes (`channelHideBound`), with the pick
        pass skipping an invisible glyph so an animated-hidden node is as
        unpickable as a CSV-hidden one; a placement-bound parent's DIRECT
        children re-place per tick — `applyFrameTransform` already re-reads
        parent topo/ratio/grid-form fresh, this app's analogue of the
        desktop's `update_world_transform_rows` contract fix — and
        grandchildren ride the frame chain. The World row reaches the screen
        through renderer state, not an Object3D, so main.ts syncs
        background + fog per animated frame and re-walks materials only on a
        frame that actually changes render_mode.
      - The desktop commit's three fast-path bugs, in this platform's
        dialect, all handled: Plot/Surface membership re-baked on a topo/hide
        flip (`overlayDirty` → rebuildAnimatedOverlays;
        TopologyOverlay.dispose now DETACHES its objects, since here the
        root survives the rebake); the pinned-label list re-derived per frame
        for the bound few (`refreshAnimatedPinnedTags` — three checks a
        frame, not 209k); and the torus geometry cache quantized to 1% ratio
        steps (`quantizedShapeRatio`, then named `quantizedTorusRatio` —
        Python rounding, the desktop's own `ensure_ratio_list` fix), bounding
        a swept ratio at ~50 entries where it leaked one geometry per distinct
        float.
      - `roundHalfToEven` moved to `src/gv/pythonRound.ts`: channels ↔
        colorPalette became an ESM cycle, which the browser rejects with a
        TDZ ReferenceError while vitest's bundling tolerates it — the app
        failed to BOOT with 1112 tests green, which is the drive-the-UI
        rule's whole argument.
      - Parity: the desktop's two new examples are vendored as fixtures AND
        as built-in scenes (Channel parameters / Mood background — each is a
        teaching scene, one station per new attribute).
        `dump_channel_frames.py` handles the engine's widened binding tuples
        and now also records the color_r/g/b a palette binding RESOLVES
        into, so resolution is pinned value for value;
        `channelParity.test.ts` diffs six fixtures. Unit tests pin the clamp
        table, resolve-last, reset-restores-palette-outputs, the glyph
        swap/hide/placement paths and the torus cache bound.
      - Driven in Chrome: the mood scene's background animates, the blend
        mode reaches Additive in the ember phase, and Stop restores the row
        (that pass caught the Node Table not repainting on Stop/seek —
        fixed); the parameters scene's topo/geometry step and hide strobes
        in the live table; show_text's pop measured as label-canvas ink.
      - Known non-animating edges, both matching a build-time bake no example
        exercises: a hide-bound LINK's edge (link batches are per build) and
        World-Grid colour writes (excluded from appearance sync since 6,
        for the per-part colour rule).
   t. Fetch Basemap (shipped 2026-07-31, Jeff's request — a port of desktop
      `8573571`, the GIS mapping feature): a flat World Grid downloads real
      map imagery (OSM streets / Esri World Imagery satellite / OpenTopoMap
      terrain — free, key-less) for its data's lon/lat bounding box and wears
      it as its texture, with the grid extents set to the map's EXACT
      coverage so glyphs and map features line up. Button in the Properties
      panel when a single World Grid is selected (the desktop's World Grid
      panel doesn't exist here yet), disabled for a globe; it opens a
      FloatWindow that prefills the window from the grid's DIRECT children
      (descendants place relative to them), previews tiles/zoom/output size
      live, and fetches without blocking.
      - Split mirrors the desktop's: `src/gv/basemap.ts` is the pure math
        (providers, bbox pad/clamp/validate, zoom selection under the 60-tile
        politeness cap, slippy-tile ranges, and the Web Mercator →
        plate-carrée ROW resample as typed-array ops, node-testable);
        `src/render/basemapFetch.ts` is the browser half (fetch + canvas
        stitch + attribution stamp + PNG encode); `src/ui/basemapWindow.ts`
        the dialog; main.ts `applyBasemap` the scene wiring — extents into
        the trigger_lo/hi extras, texture_id assigned with the desktop's
        insertion-shift rule (a NEW image at sort position N bumps every
        node's id ≥ N; a refetch overwrites in place, nothing moves), Grid
        Wire promoted to Grid so the texture shows, texture cache fully
        reset (ids may have shifted AND bytes changed behind a decoded id).
      - Reprojection is mandatory, same reason as there: tiles are Mercator,
        the grid drapes linearly in latitude — a plain crop is ~40 rows off
        mid-image for a US-sized window. Two int()-vs-floor traps surfaced
        by parity: Python truncates toward zero (at the Mercator limit the
        norm is −2e−16, floor answers −1) and Math.trunc's −0 fails a strict
        0 compare. Both pinned by the whole_earth parity case.
      - Platform divergences, deliberate: the tile cache is the Cache API
        (per-origin, survives reloads) instead of a disk folder; the
        identifying User-Agent is impossible in a browser (forbidden header)
        so the browser's own UA + Referer stand in; and the PNG persists by
        DOWNLOAD (like Save CSV) since a browser can't write media/ — the
        saved CSV references `media/zz_basemap_grid<id>.png` and the download
        hands the user exactly that file, said in the status line. In-scene
        it applies live either way (media index insertion, so the texture
        row lists it by name).
      - Parity: `tools/dump_basemap_plans.py` runs the REAL desktop planner
        AND its private `_reproject_to_equirect` (fed canvases whose pixels
        encode their own position, the desktop test's own trick) over 12
        windows; `src/gv/basemap.parity.test.ts` diffs plans exactly and the
        sampling arrays value for value. Verified to FAIL against floor
        truncation and against a linear (no-reproject) row map.
        `src/gv/basemap.test.ts` ports tests/test_basemap.py's pure cases.
      - Driven in Chrome (18 checks): real OSM fetch on the World Grid
        example (56 tiles, 1.9 s, PNG inspected — San Diego streets,
        attribution stamped), refetch entirely from cache (0 network hits),
        Fit to Children, live preview, globe refusal, extents/texture/status
        all measured, console clean.
      - Same V1 gaps as the desktop, on purpose: globe grids, antimeridian
        windows, no one-click grid adoption for gridless lat/lon scenes.
        Adding Mapbox or another key-carrying provider is a PROVIDERS entry
        plus auth, both sides.
   u. Draw Mode (shipped 2026-08-13, Jeff's request — a port of desktop
      `dfef096` + `253547b`, v1 and v2 together): **D** paints objects onto a
      flat World Grid with the mouse. A left click stamps the brush where the
      cursor meets the grid's drawing plane; a left drag stamps a trail, one
      per Stamp Spacing pixels of cursor travel (the fractal-forest rule).
      Every stamp is a real child of the grid, so a drawing saves, reloads and
      moves with the grid like any other part of the scene.
      - Split as the desktop's is: `src/gv/drawMode.ts` is the data half
        (`placeStamp`, `shouldStamp`, no THREE in it) and
        `src/render/drawPlane.ts` the geometry (`gridHit`). The inversion is
        EXACT rather than approximate, which is the point: our forward rule
        (buildScene's `framePosition`) puts a flat grid's child at
        `gridFrame.matrixWorld · diag(grid.scale) · (lon − c_lon, lat − c_lat,
        tz)`, so the desktop's `grid_world_basis` is that product here — the
        grid's own scale re-spaces its children rather than living on its
        frame (the ANTz Grid rule), so it has to be multiplied back in. A
        stamp then lands under the cursor by construction at any grid
        translate/rotate/scale or nesting depth.
      - The brush is Single Object (the New Object Defaults) or any Glyph
        Composer hyperglyph, chosen in a Stamp menu that brushes ACCUMULATE
        into so strokes can alternate. Templates arrive by Load… (a saved
        .json) or the Composer's new **Use as Draw Brush** button, which
        registers a SNAPSHOT (a JSON round trip, as there — later edits must
        not mutate what an in-progress drawing stamps) and turns Draw Mode on.
      - Jitter is drawn ONCE per stamp, not per node, so a hyperglyph stays
        coherent: heading adds a uniform spin to each ROOT's rotate_z (child
        placement composes the parent rotation, so the subtree turns) and
        scale multiplies all three root axes by one factor. Only rows at the
        stamp's base branch level are touched; everything deeper rides along.
        A jitter left at 0 does not consult the rng at all — the desktop's own
        short-circuit, and observable, since it decides where a later stamp's
        draws land in the stream.
      - Gestures, all desktop parity: plain click-select is suspended while
        the mode is on, but Ctrl+click add-select, Shift+drag region select
        (the documented way to grab a bad stroke and Delete it), right-drag
        orbit, middle-button pan and the wheel keep working. The stroke owns
        the whole left drag (no orbiting underneath it) and captures the
        pointer. Draw Mode and Camera Mode displace each other, both claiming
        the left button; the gizmo handles go away for the same reason while
        the armed mode stays sticky (the 6h rule). Esc or D exits.
      - Web-side adaptations, both forced by the platform rather than chosen:
        `rebuildScene` rebuilds the whole graph, so a stroke's stamps are
        rAF-COALESCED into one rebuild per frame (the Global Scale slider's
        trade, for the same reason), flushed when the stroke ends so the
        report and the screen agree; and a frame built since the last render
        has no world matrix, so `drawStamp` calls `updateWorldMatrix` on the
        grid's ancestors chain — a stamp is routinely the very next thing
        after a rebuild.
      - Divergence, agreed with Jeff 2026-08-13: drawing WORKS IN STEREO,
        where the desktop refuses it (its per-eye camera matrices are never
        captured, the same restriction its rubber band and gizmo carry). Ours
        come free — `cameraForPointer` already remaps the eye that drew the
        half the pointer is in onto full-canvas coordinates for single-node
        picking, and `gridHit` takes a ray. Measured: a left-half click reads
        against its own half (mono re-projection 750 px where a mono reading
        would give 400), and the two eyes agree on the cursor's grid position
        to 0.33 units out of 24.
      - `createWorldGrid` (`src/gv/createNode.ts`) came with it — desktop
        `_create_world_grid`, whole-earth window at 1:1, Grid Wire, 36×18
        segments. Entering Draw Mode in a gridless scene creates one (the mode
        is meaningless without a target) and it also earns a New World Grid
        button, which this app had been missing outright.
      - Target precedence is the desktop's: a SELECTED grid, else the scene's
        first in file order. Globe grids are refused with a hint, as there.
      - Parity: `tools/dump_draw_stamps.py` runs the REAL desktop `grid_hit`,
        `place_stamp` (under a seeded `random.Random`, so the jitter diffs
        against CPython through `PythonRandom`) and `should_stamp`;
        `src/render/drawMode.parity.test.ts` diffs 9 grid hits, 7 stamps and
        the spacing gate. Verified to FAIL against a dropped extents-centre
        term, against swapping the two jitter draws, and against losing the
        zero-jitter short-circuit. `drawPlane.test.ts` adds the round trip
        (click a pixel, stamp, re-project onto the same pixel at 1e-6) under
        translate/rotate/scale, a windowed grid and a nested one.
      - Driven in Chrome, 50 measured checks over two passes: stamp lands on
        the clicked pixel to 0.01 px (raised Draw Z included), 300 px of
        travel at 30 px spacing = 11 stamps and at 100 px = 4, jitter ranges
        and per-stamp coherence, every suspended/surviving gesture, the mode
        interlocks, a composer brush planting a 7-node subtree with only its
        root on the grid, stereo both halves, the globe refusal, and a
        save→reload round trip of 115 rows. The first pass also caught the
        Draw Mode button rendering as an unstyled default-white browser button
        (it is not inside `.hud-create-buttons`) — screenshot-visible, and
        invisible to all 1215 unit tests.
   v. Minimum glyph size, opt-in (shipped 2026-08-13, same session as 6u at
      Jeff's ask — a port of desktop `6d82d68`). GlyphViz clamped every
      glyph's rendered scale to 0.2 per axis from its earliest commits, so a
      near-zero-scale node stayed big enough to click. The clamp silently
      overrode authored data — the desktop's AutoSleep example has a
      deliberately thin 0.07 h deep-sleep axis that drew as 0.2, so the
      encoding lied about the data it stands for — and it is now OFF by
      default on both sides, behind an **Enforce Minimum Glyph Size (0.2)**
      checkbox in the Scene panel's Global Scale group (the desktop's own
      placement, its Properties-panel Global Scale group; its second surface,
      a View-menu item, has no counterpart here because this app has no menu
      bar).
      - The setting lives in `src/render/baseScale.ts`
        (`scaleFloor` / `setEnforceScaleFloor`, desktop `Scene.scale_floor` /
        `Viewport.enforce_scale_floor`) rather than a module of its own,
        because it is the second half of ONE expression —
        `max(own scale · base_scale, floor)` — and that is also why the
        desktop puts the checkbox inside the Global Scale group. The order
        matters and is pinned: the clamp lands on scale × Global Scale, so
        raising the slider LIFTS a small node off it (0.05 × 5 = 0.25),
        where a floor-then-scale reading would draw it at 1.0.
      - One reader, `drawScaleCorrection`, where the desktop has four
        (`_bake_draw_data`, `_bake_draw_rows`, `node_world_matrix` and
        `viewport._radius_of`). Its camera-framing hint needed the setting
        because it frames from node DATA; `fitCameraTo` here frames from
        `Box3.setFromObject`, i.e. the real geometry, so it already matches
        whatever was drawn. `RENDER_SCALE_FLOOR` retired in favour of
        `DEFAULT_SCALE_FLOOR` beside the setting, one name for one thing.
      - Toggling takes the Global Scale slider's in-place path
        (`rescaleSceneFrames`, now shared as `refreshDrawScales`), not a
        rebuild: the graph's shape does not change, only its numbers. A
        viewer setting like Show Grid — it survives a scene load and no
        writer knows about it.
      - Divergence from the desktop's `max()`, deliberate: with the clamp OFF
        a NEGATIVE authored scale keeps its sign (a mirrored glyph stays
        mirrored) instead of being pulled up to +0.2. That follows from the
        desktop's own `if self.scale_floor:` guard, which this mirrors.
      - Parity: `tools/dump_draw_matrices.py` takes the floor as a fourth
        argument and records it, since like the Global Scale it is an input to
        a draw matrix that no CSV can carry. All four existing fixtures were
        REGENERATED at 0.2 and came back byte-identical (a check on the
        desktop engine itself), and two new `_nofloor` fixtures diff the
        default state — the direction the harness previously could not see at
        all, since it asserted the clamp as a renderer fact. Verified to FAIL
        when `drawScaleCorrection` ignores the setting.
      - Three existing tests had baked the clamp in (buildScene's draw rules,
        the DynamicNodes re-derivation, and the selection halo, which measures
        RENDERED size) — each now states which setting it is exercising, and
        the buildScene one covers both.
      - Driven in Chrome, 15 measured checks: a 0.05 glyph draws at 0.05 and
        clamps to 0.2 on demand, a 4 × 0.05 sliver keeps its 80:1 shape and is
        squared to 20:1 by the clamp, a full-size glyph is untouched either
        way, the Global-Scale ordering above, both status messages, survival
        across a scene load, and nothing about it in the saved CSV.
   w. Topology Scale (shipped 2026-08-14, at Jeff's ask once the desktop
      feature had earned real-use feedback — a port of desktop `55928c0`,
      which section 11 had deliberately HELD until then). A topology reads
      some of a child's translate axes as ANGLES (Sphere's longitude,
      Torus's orbital angle) and others as DISTANCES (a Cube facet's two
      axes, Pin/Cylinder height, every axis of the Cartesian family). Values
      authored for the angular reading are enormous under the other one, so
      switching a parent from Sphere to Cube threw its children ~180× out —
      off screen, with no clue where they went. `topoScale` on the PARENT
      multiplies exactly the distance-valued axes of its own topology.
      - The classification is ONE table, `LINEAR_PLACEMENT_AXES` in
        `src/render/topology.ts` (the desktop's, verbatim), and the whole
        feature is a PRE-MULTIPLY inside `topoOffset` — every per-topology
        case is untouched, because scaling an axis before the math is
        identical to scaling the distance term the math derives from it
        (`radial = B + tz` becomes `B + k·tz`). That is also what
        guarantees the property the field exists for: an angular axis is
        never touched, so no value can distort a circular layout.
        `topoBaseRotation` reads the RAW translate on both sides — every
        axis it consults is angular anyway.
      - World Grid children and roots are exempt, which `parentTopoScale`
        answers with 1.0 at the one call site (buildScene's
        `framePosition`): a grid's footprint is sized from the same extents
        window its children's coordinates are read in, and a root's
        translate IS its world position.
      - Default 1.0 = one translate unit is one world unit, GlyphViz's
        behaviour since its first commit AND the load default for a missing
        column, so nothing that exists changes. `TOPO_SCALE_ANTZ` (1/180) is
        ANTz's convention, where a linear axis spans the parent's own extent
        (360 units across a facet) — the setting at which a degrees-authored
        layout survives the switch intact. Written only when some parent has
        actually been retuned, and at 10 SIGNIFICANT FIGURES
        (`_PRECISE_FLOAT_COLS`) rather than the 6 decimal places every other
        float column takes, which would round 1/180 to four.
      - The move-drag inverse divides the factor back out per axis (desktop
        `_move_divisors`), so a retuned parent's children still track the
        cursor 1:1. `invertTopoOffset` runs the whole inversion in SCALED
        space — `prev` is lifted into it, since it is only ever an unwrap
        reference or a singularity hold — and unscales the result, which
        makes it the exact inverse rather than an approximation of one.
      - Bindable as a Channels attribute (35 now), classified as PLACEMENT
        but not SHAPE: it is the one placement field that changes nothing
        about the node itself. Animating it alongside `topo` is what holds a
        subtree in frame across a switch between an angular and a linear
        topology.
      - GUI: a "Topo Scale" row directly under Topology (the desktop's own
        placement — it describes the same thing, this node's coordinate
        system for its children), applying ABSOLUTELY to the whole
        selection, so Select By ▸ Topology ▸ Cube and one edit retunes every
        cube parent. Number box, log slider (`src/ui/topoScale.ts`, DOM-free
        so it tests in plain node) and 1:1 / ANTz presets, which write the
        EXACT constant rather than routing through the box's six decimals.
        Divergence: the desktop's four widgets share one row; a 300px panel
        cannot, so the box and presets take one line and the slider the
        next. A `TopoScl` column joins the Node Table at `%g`.
      - The scattered-children hint (`src/render/scatterHint.ts`, desktop
        `worst_child_placement_ratio` + `_hint_scattered_children`): after a
        topology change — J/Shift+J or the inspector's own combo, which
        reaches it through a new `EditNotes.topologyChanged` flag rather
        than firing on every field — a child past 20× its parent's own
        rendered radius says so and names the field. Only for parents still
        at the neutral value; a tuned one is not a mistake. The radius is
        read off the GLYPH's world matrix (largest column norm), which is
        the desktop's `node_draw_data(...)[2]` exactly, since that is where
        the draw scale lives here.
      - Knock-on, now closed: `Channel_Parameters_Example`'s CSV was
        REGENERATED on the desktop with the ANTz value on station 2, so the
        vendored channel fixture and this app's built-in copy of that scene
        are re-vendored from the desktop repo.
      - Parity: `topo_scale_gv_node.csv` + its `dump_world_transforms.py`
        dump (the tool needed no change — topo_scale rides in on the CSV).
        Every topology id appears as a parent at a non-default value,
        including the ANTz constant, a negative and a large one, with
        children exercising all three axes; plus the exempt cases (grids at
        absurd values, a root carrying one) and a four-level chain where
        each level rescales the one below. Verified to FAIL both ways: 64
        of 104 rows wrong without the pre-multiply, 31 wrong if every axis
        is treated as linear — which is the half that pins the angular
        entries.
      - Driven in Chrome, 34 measured checks over four passes: the row's
        layout and that nothing overflows the panel, J to Cube scattering
        the children 288× and raising the hint, the ANTz preset storing
        1/180 exactly and pulling them back, the 1:1 preset, the slider,
        the Node Table's `0.00555556`, the saved CSV's column, the fixture
        loading and matching the desktop dump live in the browser to 6e-13,
        a real gizmo drag reading back as +180 under the ANTz scale with
        the other two axes pinned, a radial drag on a Sphere parent moving
        altitude alone, and a ratio edit raising no hint.
   x. Glyph Composer: Topology Scale + the preview camera (shipped
      2026-08-14, Jeff's request — a port of desktop `88091e1`, the two
      frustrations he hit composing glyphs).
      - TOPOLOGY SCALE. The Composer speaks ONE placement vocabulary — an
        Angular level always hands the next one translate_x = 0…360 — but the
        PARENT's topology decides whether that is degrees or world units.
        Under Sphere/Torus/Cylinder it is a revolution; under
        Cube/Pin/Plane/None it is 360 WORLD UNITS, which put the children
        ~300× the parent's radius away, off screen with no clue where they
        went. `topoScale` (6w) existed to reconcile exactly that, and nothing
        in the Composer reached it.
        - `LevelSpec` now carries `topoScale` + `topoScaleAuto`, stamped onto
          generated nodes by `generateNodes`. `suggestedTopoScale` returns
          TOPO_SCALE_ANTZ precisely when a 0…360 sweep is about to be read as
          a distance (the CHILD level is Angular and `LINEAR_PLACEMENT_AXES`
          marks that axis linear), and 1.0 otherwise — so a design that was
          already correct is never touched. Measured in Chrome on the default
          recipe under a Cube trunk: children at 300 world units become 1.94,
          a 154× pull-in, and a Sphere trunk is left at 1.0.
        - The per-level form gets a Topo Scale row directly under Ratio,
          mirroring the Properties panel's (number box + log slider + 1:1 /
          ANTz presets) plus an Auto checkbox, on by default. Touching the
          value or a preset takes the level off Auto, because the control you
          reached for IS the decision. A one-line note under the row says
          which of the three states it is in.
        - Nothing READS the box back — every control writes straight into the
          LevelSpec — because the box shows six decimals and a read-back would
          quietly round the ANTz preset from 1/180 to 0.005556 on the next
          preview tick. Verified in the browser: the inserted node carries
          0.005555555555555556.
        - `LINEAR_PLACEMENT_AXES` moved from `render/topology.ts` to
          `gv/placementAxes.ts` (re-exported, so no import site changed): the
          recipe model reads the same table, and it is documented as pure
          logic with no GL in it. The desktop makes the same split — the table
          lives in the Qt-free `glyphviz_core/topology.py`, read by both the
          recipe model and the viewport.
        - THE GENERATOR gets the fit for free, and it matters there: its pool
          is named ANGULAR_SAFE_TOPOS but contains Pin, which reads
          translate_x as HEIGHT, so an angular level under a Pin parent was a
          360-unit vertical smear. Pin is the only cause on either side. It
          DID change previously generated art (the desktop measured 31% of a
          200-design sample, pulling in 7.5×–117×) and Jeff asked for it
          knowing that. No rng draw moved: re-dumping the vendored fixture
          changed `topo_scale` and NOTHING else across all 5,236 nodes, so a
          seed still names the same design, drawn at a size you can see.
        - Parity: `dump_glyph_recipes.py` now walks EVERY topology id as the
          parent of an angular level (a check on `LINEAR_PLACEMENT_AXES`
          itself, not on a copy of it), plus manual values, a manual 1.0
          overruling the fit, linear children asking for no fit, and a
          four-level alternating chain; both dumps carry `topo_scale` and both
          fixtures were regenerated. Verified to FAIL two ways — 13 cases
          without the fit, 25 if every axis is treated as linear, which is the
          half that pins the angular entries.
      - PREVIEW CAMERA. This app already held the camera across re-previews
        and had a Fit View button (a divergence called out when the Composer
        shipped, 2026-07-28); desktop `88091e1` adopted the same behaviour and
        the same button, so the two now agree and the note is history rather
        than a difference. What was left to port is small: the button takes
        the desktop's NAME, **Reset View**, and its wording; and loading a
        template now RE-FRAMES, since it is a different glyph entirely rather
        than one to keep an old camera aimed at. The desktop's other half —
        its `set_nodes` 50-unit framing floor leaving a composed glyph a speck
        — has no counterpart, `frameCamera` having always framed off the real
        extent.
      - Driven in Chrome, 28 measured checks: the row's layout, order and
        that it does not overflow the form; the presets rendering as styled
        buttons rather than raw browser ones (the Draw Mode lesson from 6u);
        every state of the fit and its note; the 300 → 1.94 measurement above
        and its reverse through the 1:1 preset; a typed 0.25 stored verbatim;
        and the camera proved by PIXELS — orbit the preview, edit a parameter
        back to the same design, and the frame is byte-identical to the
        orbited view rather than to the framed one, with Reset View returning
        it exactly. Plus an end-to-end generator diff: seed 2147483646 at five
        levels inserts 469 nodes with 42 fitted Pins, the vendored desktop
        fixture's own numbers. Console clean.
   y. Camera smoothing (shipped 2026-08-14, Jeff's request — a port of desktop
      `81f28e1` + `2404f86`): optional ANTz-style "inertia" on camera
      navigation. A **Smoothing** slider (a time constant, 0–0.60 s in
      hundredths — the desktop's own scale, so a number set here reads straight
      across), Off/ANTz presets and an **Applies to** scope, in the Scene
      panel's world group directly under the Camera row. Off by default, and a
      viewer setting: it survives a scene load and never reaches the CSV.
      - WHY: former ANTz users missed the glide under the Left+Right drag, and
        Dr. Warner reported patients with movement disorders such as
        Parkinson's benefiting from how it buffered their tremor. ANTz offered
        no way to adjust or disable it, which is the other half of the ask.
      - ANTz had TWO independent smoothers and only one is the effect people
        remember: a 10-cycle boxcar of the raw mouse deltas (the tremor
        filter), and a first-order low-pass on the camera's world POSITION
        while targeting. The second is the divisive one, and the smoothing was
        never the problem — ANTz eased position while applying the orbit angle
        and the zoom instantly the same frame, so the eye crawled toward a
        solution the aim had already left and the orbited object swung out of
        frame. This eases the whole rig COHERENTLY (azimuth, elevation,
        distance and target under one time constant), so the framing holds
        throughout; measured in Chrome, the eye stays on its orbit sphere to
        1.7e-13 of a 220-unit arm across a 128° glide. The filter is
        `1 − exp(−dt/tau)`, exactly frame-rate independent, unlike ANTz's
        `0.05·(65/(fps+5))` fudge. The boxcar is deliberately NOT ported: pure
        latency plus ringing, and it cannot produce coast-to-rest.
      - `src/render/cameraSmoothing.ts` is the desktop's Qt-free
        `camera_smoothing.py` plus the goal-state block `viewport.py` wraps
        around it, pure and DOM-free so it tests in plain node;
        `cameraSmoothing.test.ts` ports `tests/test_camera_smoothing.py` case
        for case and adds the goal-state rules.
      - THE ONE ARCHITECTURAL DIFFERENCE: the desktop owns its actual rig as
        four `_cam_*` fields, so pointing each gesture at `_cam_goal_*` was the
        whole job. Here the actual IS `camera.position` + `controls.target`,
        because OrbitControls owns them — so only the GOAL is stored, the
        actual is decomposed per call (`rigFromView`, moved out of `CameraRig`
        so both share one convention), and every reader of the live camera
        (matrices, picking, distance-scaled speeds, stereo, the FPS panel)
        stays untouched, which is the desktop's own contract read the other way
        round.
      - `SmoothOrbitControls` (`src/render/smoothOrbitControls.ts`) is how
        orbit/pan/wheel — three's code, not ours — come to write a goal: its
        `update()` hands OrbitControls the goal, lets it accumulate the drag
        onto that, reads the new goal back and restores the lagging actual for
        rendering. Handing it the ACTUAL instead would cost gain rather than
        add lag: the goal would only ever lead by one frame's delta, so there
        would be no coast-to-rest at all. tau = 0 steps aside on the first
        line, floating-point noise included.
        - Its own `update()` return value cannot say whether a gesture
          happened — it reports whether the CAMERA moved since the last call,
          which is also true on every frame of a manual combo glide. So the
          goal handed in is compared with the goal handed back, at 1e-9 of the
          arm length (one pixel of orbit moves the eye seven orders of
          magnitude further). That test is what keeps the once-a-frame update
          from being mistaken for an unsmoothed gesture and halting the glide.
      - The Left+Right combo drag is this app's own code, so it writes the goal
        directly (desktop `_orbit_zoom_camera`), and the pivot snap onto the
        selection glides with it — precisely where ANTz put its low-pass
        (`npSetCamTarget`), except that easing the pivot together with the aim
        is the version that does not throw the object out of frame. Measured:
        the pivot travels 99 units onto the selected node over the glide and
        lands on it exactly.
      - Everything PROGRAMMATIC snaps (`snapCameraGoal`, the desktop's
        `_snap_camera_goal`): scene framing, camera presets, double-click
        focus, flight, the exit from an immersive session. Follow Selected is
        the one exception — see the fix in 6cc.
        Switching cameras or entering Camera Mode RECONCILES instead (a direct
        write wins if nothing was gliding, otherwise the glide lands), so a
        saved viewpoint records where the user aimed. Camera Mode is excluded
        outright: rate flight is already integrated per tick and re-derives the
        rig from the current eye, so a lagging actual would curve the flight
        path.
      - An unsmoothed gesture HALTS a glide in progress, which falls out of
        `_settle_camera` collapsing the goal onto the camera. Jeff's follow-up
        commit records that as emergent and wanted; it is why a left-click
        stops a coasting camera dead.
      - Web-only divergences:
        - No repaint timer to release — this app's animation loop always runs,
          where the desktop's ~30 fps timer has to be held open for the glide
          and let go at sub-pixel tolerance. The tolerance is kept at the
          desktop's numbers anyway, and still earns its place twice: it LANDS
          the glide exactly on its goal, and it is what lets a direct camera
          write be adopted at face value. Not to be tightened — it is the fix
          for the ANTz complaint about waiting for the camera to lock.
        - With smoothing ON, an orbit stops one degree short of the pole: the
          goal is a rig and a rig has no representation for the up-vector
          singularity. That is the desktop's own ±89° limit and this app's
          combo drag's; only a plain OrbitControls drag could previously go
          over.
        - Three's own `enableDamping` stays off. It is a per-frame constant, so
          it drifts with frame rate, cannot be scoped, and knows nothing of the
          combo drag it never sees.
        - The readout says `0.33 s` where the desktop appends `(ANTz)`; a 300px
          panel row has no width for it, so the suffix is in the status line
          the presets print.
      - Found by DRIVING it, and invisible to every other check: releasing one
        button of a chord arrives as a zero-delta `pointermove` carrying the
        new bitmask (which is why the combo state machine hangs off pointermove
        at all — Qt has no equivalent, so the desktop never meets this). That
        no-op was running the plain-orbit path and ending the glide at the
        exact moment the user let go. A move that moves nothing is no longer a
        gesture.
      - Driven in Chrome, 30 measured checks: the rows' layout, order and
        styling; off = the camera stops dead at the release (drift 7e-13); the
        combo gliding 190 units past the release and settling in 2.1 s with a
        zero azimuth residual; the arm length holding; monotone approach (a lag
        filter, never momentum); the halt; scope=all covering plain orbit,
        wheel zoom and pan; presets, focus and scene framing staying jumps;
        Camera Mode flying and stopping dead with smoothing on; and the setting
        surviving a scene load. Plus a stereo pass: the pair glides with the
        arm length unchanged to 1e-3 and a clean console.
   z. New-object placement: wrap the lattice, expose the step and Z (shipped
      2026-08-14, Jeff's request — a port of desktop `c2d8f13`). Repeated
      N / Shift+N / New Node / New Child ran translate_x on forever, so a long
      run went off in a line and — the real bug — a circular parent's 73rd child
      at the historical spacing of 5 landed exactly on top of its first, 360°
      being one lap. ANTz never had that problem: `npNodeNew` stepped x and
      WRAPPED the row, bumping translate_y every 24 children (24 × 15 = one
      lap). This adopts the wrap and makes ANTz's two hardcoded numbers
      adjustable.
      - `src/gv/placement.ts` is the desktop's Qt-free `placement.py`, pure and
        DOM-free so it tests in plain node, and reached TWO ways because the two
        callers know different things: `wrappedGridOffset(index, step)` places a
        child by ORDINAL (its parent knows how many it has), `stepFrom(x, y,
        step)` places a root RELATIVE to the last one created (a root has no
        ordinal). `placement.test.ts` is `tests/test_placement.py` case for
        case, including the 200-step run that pins the two entry points against
        each other — they have to walk ONE lattice or a run of N and a run of
        Shift+N would drift apart.
      - Only x wraps. translate_y keeps climbing, a deliberate divergence from
        ANTz, which folded both axes back into −180…180 and so eventually reused
        slots; a long run here grows a taller grid instead.
      - Placement Step (default 5.0, the historical CHILD spacing) therefore
        changes the ROOT step 10 → 5, so both gestures share one lattice. Typing
        15 gives ANTz's own. `columnsPerRow` is the number that makes the
        setting legible — "wraps at 360" means nothing until you know it is 72
        objects — so the tooltip and the status line both report it live, the
        desktop's `_update_step_tip` / `_on_new_step_changed`.
      - Placement Z is TWO boxes, root (0.0) and child (5.0), because the axis
        MEANS different things at the two levels: height above the world plane
        for a root, offset off the parent for a child — which is why a child at
        0 would sit inside a topology-None parent while a root at 5 would hover
        off the grid. On a Sphere/Torus/Cylinder parent the child number lifts
        it radially off the surface instead. Labelled `root` / `child` inline
        (new `.hud-sublabel`, which must not claim the row's 64px label column):
        the desktop labels its pair too, and unlike the neighbouring Jitter pair
        the two are not guessable from order.
      - Two rules that keep the lattice honest, both the desktop's: root
        placement keys on the last root CREATED (highest id) rather than the
        largest translate_x, which a wrap breaks — after wrapping, the largest x
        is back in the previous row and the array would fold onto itself; and
        World Grids are skipped, a grid being the surface the array sits ON.
        Links never consume a child slot, since they render between their two
        ends and ignore translate, so counting one would leave a hole.
      - All five desktop call sites exist here and share the helpers: N, Shift+N
        (`createRootNode` / `createChildNode`), both paste branches
        (`pasteSubtree`, which grew the same `placement` parameter) and mesh
        import. `nextRootX` is retired for `nextRootPos`, joined by
        `nextChildPos` — the desktop's `_next_root_pos` / `_next_child_pos`.
      - The three existing tests that had baked in the old +10 root step are the
        behaviour this replaces, and now state the new rule.
      - Driven in Chrome, 25 measured checks: the rows' size, order and that
        nothing overflows the 276px panel; the live tooltip (72 at step 5, 24 at
        ANTz's 15) and both status messages; children stepping and wrapping at
        step 120; a changed child Z reaching the next child without disturbing
        the X/Y lattice; the Shift+N KEY walking the same lattice as the button;
        roots stepping and wrapping at 150; the two Z boxes staying independent;
        a World Grid taking no slot; and both paste branches taking the Z of
        their destination level. Plus the payoff, measured through the real
        scene graph: 80 children at step 5 on a Sphere parent read
        (350,0) (355,0) **(0,5)** (5,5) across the wrap, child 73 sits one 5°
        step of arc from child 1 where it used to sit ON it (distance 0), and
        the closest pair of all 80 is 0.7822 — which is the equator spacing
        0.7851 × cos 5°, i.e. plain longitude spacing on the second ring rather
        than crowding. Console clean.
   aa. Pin glyph rebuilt to ANTz's shape (shipped 2026-08-14, Jeff's request —
      a port of desktop `979b9db`). The Pin was a sphere floating above an
      OPEN-ended frustum: two see-through holes, and it hung BELOW the node
      origin, so a Topo.Pin parent's children floated clear of the whole glyph.
      It is now ANTz's `DrawPinDL` (npgeometry.c:493) at 1/5 scale — a 10:1
      cone standing on a genuine apex AT the origin, shaft rising along +Z,
      capped by a dome whose rim IS the cone's base circle.
      - The holes were never a trade-off on either side. `gluCylinder` draws a
        lateral surface and never end caps, and the desktop's `_draw_pin` —
        unlike `_draw_cone`/`_draw_cylinder` beside it — never added the
        `gluDisk`s; this app inherited the shape as an uncapped `zTubeGeometry`
        under a `zSphereGeometry` head. Here the cone tapers to a point, so the
        bottom needs no cap at all, and only the UPPER hemisphere of the ball
        is built: with its equator flush on the rim the dome IS the cap, and
        the lower half would be sealed inside the cone where nothing could see
        it. The rim therefore appears TWICE at one position, carrying the
        cone's normal and the dome's, because the surface genuinely creases
        5.7° there and one averaged normal would smear the join.
      - APEX-AT-THE-ORIGIN is the load-bearing half, not styling: Topo.Pin
        places children at `B + translate_x` along +Z, so they ride the shaft
        only if the shaft is the +Z half of the glyph. `topology.ts` needed no
        change (the desktop commit doesn't touch `topology.py` either) — but
        that was VERIFIED rather than assumed, since the whole point is the two
        halves agreeing, and a test now pins the glyph's extent against
        `topoOffset` so they cannot drift apart again. Measured live on the
        topology example: tx 0 lands exactly at the head's centre (+1.0 above
        the tip) and tx −1.5 half a unit BELOW the tip. Consequence, expected
        and seen: **every existing Pin rises about one glyph height** (the
        desktop checked Multi_Hike_Race; two built-in scenes here draw pins).
      - `zPinGeometry` lives in `uvGeometry.ts` with the other hand-built round
        primitives — one geometry now, not two, so a pin is one draw call and
        one `WireframeGeometry`, and `createGlyphObject`/`createPickProxy` lost
        their Pin special cases entirely (it is an ordinary SOLID_BUILDERS /
        WIRE_BUILDERS entry). PIN_HEIGHT/PIN_RADIUS sit with the other
        proportion constants in `glyphGeometry.ts`, mirroring `geometry_data`,
        and are PASSED IN rather than imported the other way, which is what
        keeps the two modules acyclic.
      - Divergences, all this app's existing conventions rather than new
        choices: the wire pin is `WireframeGeometry` of the solid, like every
        other wire glyph here, where the desktop traces meridians and latitude
        rings (it derives both from one meridian for the same reason this
        derives both from one geometry — the wire cannot drift into being a
        different shape); tessellation is 32 slices / 8 dome stacks against the
        desktop's 12 / 4, matching the neighbouring web glyphs, which are
        likewise finer than their desktop twins; and u runs eastward from −X
        per this module's shared equirect convention rather than the desktop's
        `u = i/slices` from +X. The desktop's v is kept exactly — 0 at the tip
        to 1 at the pole, ONE run across cone and dome, which is the mapping
        two separate primitives could not give.
      - The pole ring is written out as an exact zero rather than left to
        `cos(π/2)`'s 6e-17: an almost-zero radius is not zero, and the band
        below it would emit a second, degenerate triangle per slice instead of
        collapsing. Found by asserting the face count (512 = 32 × 16), not by
        looking at it.
      - Driven in Chrome: the glyph's own vertices span z 0 → 1.1 at radius
        0.1 with nothing below the tip, one geometry per pin (was two),
        FrontSide, 512 triangles; close-ups looking up at the tip and down at
        the dome show a closed, watertight solid, and the wire pin reads as one
        silhouette converging on a real point. Console clean but for the
        pre-existing `map: undefined` warnings.
   bb. Links carry shape, and both tool windows learn the format (shipped
      2026-08-15, Jeff's request — a port of desktop `21f400c` + `a9a845d` +
      `2d36a05`, driven by his new **Hyperglyph Tree Designer**, a Lab page
      that designs branching trees and exports them as Glyph Composer
      templates). Jeff asked for the two TOOL changes; the renderer one is a
      prerequisite he had forgotten this app was missing (agreed 2026-08-15) —
      the Designer's presets set `link_geo` to 19/1/11/16, so without it a tree
      imported here would draw as stick-lines instead of limbs.
      - A LINK IS ANY GEOMETRY, stretched between its two ends (desktop
        `21f400c`, ANTz `npDrawLink`). `src/render/linkGeometry.ts` is the
        desktop's Qt-free `link_geometry.py`: `Rz(atan2(uy,ux) − 90°) ·
        Rx(asin(uz) + 90°)` built column by column, `ratio` on BOTH cross-axes,
        the endpoint distance as the length. A link has no independent pose —
        its own translate/rotate/scale play no part, and neither does the
        Global Scale slider or the minimum-size clamp, which belong to a
        node's own draw matrix.
        - The roll is ANTz's composition, NOT an arbitrary-up cross product
          (which is what the prism tube beside it still uses): column 0 is
          horizontal, so a glyph link keeps a gravity-referenced roll as it
          swings around instead of flipping when a reference axis is crossed.
        - Each glyph's OWN local z extent maps onto the segment rather than
          ANTz's fixed 2 units. Identical for every −1…1 shape; it differs only
          for Pin, whose apex sits at its local origin (6aa) — a pin link's tip
          lands on A and its dome on B, where ANTz left it hanging past the
          B-end.
        - Line (27), Prism (28) and Point (22) stay line-drawn. That set IS the
          back-compat surface: Org_Event_Network's 6,400 Point edges render
          exactly as before. An id this app doesn't render yet warns and draws
          nothing, where the desktop falls back to a sphere — the same
          divergence buildScene already has for an ordinary node.
        - A glyph link is ONE Object3D each, where lines and prisms batch —
          the desktop's own trade ("performance is left to the author; Line is
          still one keystroke away"). Its matrix is rewritten per frame from
          its endpoints like every other edge, but `updateMatrixWorld(true)` is
          FORCED rather than flagged: the halo pass and the raycaster read
          matrixWorld in the same frame, where a flag would only be consumed by
          the renderer's next traversal.
        - It is pick-solid across its whole body (a proxy under the glyph, plus
          the existing centre-line picker — the desktop's pick pass draws
          both), and a selected one draws a HALO, which the O-cycling workflow
          needs. The halo's z bounds come from the geometry's own span, so
          `Selection` now keeps a per-halo `[zLo, zHi]` instead of assuming
          ±1.05 — a Pin limb's box runs −0.275…11.275 on an 11-unit edge, not a
          cube centred on the midpoint. Line and prism links still get none.
        - O / Shift+O cycles a link through the FULL geometry range (skipping
          Mesh and Point), where it used to toggle Line↔Prism — that toggle was
          a link's whole vocabulary before this. The two existing tests that
          pinned the toggle are the behaviour this replaces.
        - The desktop's other two pieces have no web counterpart: its
          inspector `ratio` box was widened 1.0 → 10.0, where this app's row
          has never had a cap; and its PDB bond change lands in an importer
          section 10 deliberately does not port.
        - Parity: `tools/dump_link_matrices.py` runs the REAL
          `link_glyph_matrix` over 15 endpoint/ratio/geometry cases (vertical
          both ways, degenerate, pin, far from the origin, hairline and fat
          ratios) plus `is_glyph_link`/`local_z_span` for all 29 ids;
          `linkGeometry.parity.test.ts` diffs at 1e-12. Verified to FAIL both
          ways — 3 cases without the pin span, 15 with the roll columns
          flipped.
      - COMPOSER LINK LEVELS (desktop `a9a845d`). A `LevelSpec` carries
        `linkGeo` / `linkRatio` / an optional link colour pair, and
        `generateNodes` emits a companion type-7 Link from each of the level's
        objects back to its parent. Separate a level from its parent (Altitude
        Z) and the link becomes the visible limb — which is what turns a
        composed glyph from a stack of touching shells into a jointed,
        branching structure.
        - Emission is CHILD-THEN-EDGE with sequential ids, so the Composer's
          insert (which only offsets `startId`) and Draw Mode stamping stay
          coherent with no remapping. The interleaving is as much of the
          contract as the values are, which is why the parity fixture carries
          `child_id` and the test diffs it row for row.
        - `linkGeo` null is the default AND the load default for every key a
          template omits, so the entire existing template population generates
          byte-identically — checked by regenerating the vendored fixture: 34
          of 35 existing cases came back with unchanged nodes (the 35th is the
          random-placement one, un-reproducible on both sides by design).
        - Ignored on level 0: a root's parent is whatever the glyph is inserted
          under, not part of the glyph. A linked level also DOUBLES its
          contribution to `projectedNodeCount`.
        - GUI: a "Link to Parent" group at the foot of every non-root level's
          form — enable checkbox, Geometry (Mesh and Point excluded, the same
          two ids the O-cycle skips on a link), Thickness, Use node color, and
          the link's own colour + gradient, greyed in one `sync()` chain the
          way the desktop's checkable QGroupBox drives `setEnabled`. The level
          list marks a linked level with the desktop's own `⌁`.
      - GENERATOR ▸ SAVE RECIPE… (desktop `2d36a05`): the Hyperglyph Generator
        writes its design as the same Glyph Template .json the Composer opens,
        so a randomized hyperglyph worth keeping can be reworked level by level
        instead of only being inserted as-is. Named `Hyperglyph_<seed>` — the
        design's reproducible identity — which is also the downloaded filename.
        - The awkward part is that with Idle Motion running the preview is
          SPINNING when Save is clicked. A recipe stores one rotation per LEVEL
          while idle motion gives every NODE its own axis and speed, so
          "Capture live orientation" (on by default) captures level 0 — the
          single trunk node — exactly, and takes each deeper level's FIRST node
          as its representative. First-node over a circular mean deliberately:
          it is an orientation that genuinely occurred on screen and stays
          stable as the spread grows.
        - `composerSafeAngle` folds only OUT-OF-RANGE values into 0…360, using
          Python's modulo sign. Rate integration has no wraparound, so an
          idling glyph reaches tens of thousands of degrees, which a rotation
          field would clamp — while a static recipe still round-trips
          byte-identically rather than having every authored −20 rewritten as
          340. The snapshot skips LINK rows, whose rotate is inert and always
          0.
        - The size warning is a NODE COUNT (`COMPOSER_EDIT_NODE_WARN` = 2000),
          not a file size: the .json is tiny whatever the tree expands to, and
          what gets heavy is the Composer's auto-preview rebuilding the whole
          tree 350 ms after every keystroke. Said in the info line right after
          Regenerate — while Regenerate is still one cheap click away — and
          again as a Save/Cancel `confirm()` at save time. The default budget
          of 500 never trips it, pinned by a test so the prompt does not become
          something to click through.
      - Driven in Chrome, 57 measured checks over three passes, including the
        motivating case END TO END: the real Tree Designer page (opened from
        the desktop repo over `file://`) exports its Classic Fractal Tree, the
        web Composer loads all 10 levels with the 8 linked ones marked, and the
        767-node tree renders with 255 limbs — each spanning its own two
        endpoints to 4e-16, none of them line-drawn. Then a limb picked by
        clicking its body, its halo, O re-shaping it, the CSV round trip (255
        type-7 rows out and back with no dangling B-end), the same tree as a
        Draw Mode brush painting a forest (two stamps, 0 duplicate ids), and
        the Generator's Save Recipe → the file reopening in the Composer.
        Console clean throughout.
        - One thing the pictures settled that no measurement would have: at the
          whole tree's default framing a limb is ~10 px long and the joint
          spheres cover its midpoint, so a click there correctly selects the
          sphere in front. The pick check had to frame a limb close up before
          it meant anything.
   cc. Follow Selected no longer vetoes navigation (fixed 2026-08-17, Jeff's
      bug report — a port of desktop `b156103`, the same bug there). With
      camera smoothing on (6y) and Follow on (6g), an orbit/zoom/pan drag moved
      the camera not at all; only a sliver landed at the release.
      - Cause: `applyFollowTarget` ended with `snapCameraGoal()`, which points
        the WHOLE goal — azimuth, elevation, distance and target — at wherever
        the rendered camera currently is. Follow runs every frame from the
        animation loop, BEFORE `applyCameraSmoothing`, and under smoothing the
        rendered camera is deliberately behind its goal. So every frame
        re-pointed the goal at the lagging actual and erased the drag's aim
        before the filter could chase it.
      - Fix: follow owns the PIVOT only — `camSmoothing.goal.target = [...]`
        instead of the snap. It stays UNSMOOTHED (following a moving node
        tracks a source, not a hand tremor; easing it would leave the camera
        permanently trailing), and it can be: the delta above already moved eye
        and pivot together, so the actual rig's azimuth/elevation/distance are
        untouched and matching the goal's target to the same point leaves both
        rigs' aim and zoom intact. A fresh array, never an alias — `copyRig`'s
        own rule. Panning stays overridden while following, as documented.
      - Web-only: the lockup needed a MOVING followed node. `applyFollowTarget`
        returns early on a zero delta, so a static pivot never reached the snap
        at all — which is why an orbit drag on a still scene looked fine and
        the same drag on a Channels-animated one was dead. That is precisely
        the case Follow exists for, and it is what the drive had to reproduce.
      - The desktop's second-order effect does NOT apply here: the same snap
        made `_camera_settled()` read true mid-glide and released the
        continuous-repaint timer the glide depends on. This app renders from an
        unconditional `renderer.setAnimationLoop`, and `settled()` is read
        nowhere outside `cameraSmoothing.ts` itself.
      - Tests: `cameraSmoothing.test.ts` gains the desktop's
        `test_camera_smoothing_viewport.py` shape — 30 frames of a held drag
        (orbit, orbit+zoom, wheel zoom) asserting the final azimuth/elevation/
        distance are EXACTLY equal with Follow on and off, plus the narrow
        goal-level rules. Follow itself lives in main.ts wired to a THREE
        camera, so what the test drives is the two rig operations
        `applyFollowTarget` performs; verified to FAIL (5 tests) with the snap
        put back.
      - Driven in Chrome, 11 measured checks on the Sine wave example with
        Channels playing and a moving node followed: the bug reproduced first
        at **0.000° of orbit with Follow on against −54.000° with it off**, and
        a zoom ratio of 1.0000 (dead), then the fix measured at −54.000° /
        13.500° / 0.6912 with Follow on — identical to Follow off — with the
        pivot still tracking the animating node, the Left+Right combo drag
        orbiting and zooming under the default scope, and a clean console.
   dd. Save Selection As… (shipped 2026-08-17, Jeff's request — a port of
      desktop `7ed0b55`, the second of the two scene-file features section 11
      lists; File ▸ Merge is still unstarted). **Ctrl+Alt+S** and a Save
      Selection… button in the Scene panel's save row write the selected nodes
      to a node CSV of their own, leaving the open scene untouched.
      - THE PROBLEM IT SOLVES, and the whole reason it is not "save the
        highlighted rows": a node whose `parent_id` names a row the file does
        not contain is treated as a ROOT (buildScene's `effectiveParent`, the
        desktop's `_resolve_hierarchy`) — and a root's translate IS its world
        position, with no topology offset. A Sphere child authored at
        (30, 45, 5) meaning longitude/latitude/altitude reloads as literal world
        (30, 45, 5); a World Grid child's lon/lat lands off the map. A naive
        subset save relocates and reorients everything in it.
      - Three detach policies, defaulting to BAKING the world placement in:
        translate takes the world position, rotate/scale come from decomposing
        `world_basis` into R · diag(s). That is exact rather than approximate,
        because world_basis is what every descendant composes off — for its own
        basis and, through the offset, for its position — so preserving it pins
        the ENTIRE SUBTREE, rod cap offsets and World Grid footprints included.
        Measured through a real writer → parser → buildScene round trip: every
        element of every frame's matrixWorld within 4.6e-7, which is the CSV's
        6-decimal formatting rather than the maths (the desktop reports 4.4e-7).
      - `src/gv/selectionExport.ts` is the whole rule set and is THREE-free —
        membership, re-rooting, branch levels, `decomposeBasis`,
        `eulerXyzFromMatrix`, the filenames. Where the renderer actually PUT
        each node is INJECTED as a `Map<id, WorldPlacement>`, which
        `src/render/selectionPlacement.ts` derives from `applyFrameTransform`
        itself rather than from a second copy of the placement math — the
        promise is that a fragment reopens where THIS app drew it, so the
        transform baked has to be the one this app composed. That is the
        desktop's `scene` argument read the other way round, and the same split
        basemap.ts/basemapFetch.ts and drawMode.ts/drawPlane.ts already make.
      - `_nearest_rotation` is an SVD on the desktop and JavaScript ships none,
        so the web runs HIGHAM'S POLAR ITERATION (`R ← (R + R⁻ᵀ)/2`), which
        converges to the same orthogonal factor, returns an already-orthonormal
        input unchanged on the first comparison (the case every unsheared export
        takes), and is the reason this feature has a parity harness at all. A
        rank-deficient basis — a collapsed axis — is completed to a right-handed
        orthonormal frame first rather than handed to a singular inverse; the
        invented direction is multiplied by a zero scale either way, which is
        the desktop's own reasoning for letting numpy invent one.
      - Membership is the house rule Copy and Delete already set: a node brings
        its descendants, plus links with both ends inside (auto-added even when
        unselected), minus links with one end outside, plus the World row at the
        head of the file. Ids are PRESERVED, unlike a merge's rebasing, so
        `record_id` and channel bindings stay coherent for free; branch levels
        are restated (`recomputeBranchLevels`, the desktop's
        `scene_merge.recompute_branch_levels`, which lands here first and should
        be shared when Merge is ported).
      - Two limits reported rather than hidden, in the desktop's own wording: a
        rotated, non-uniformly scaled ancestor SHEARS the basis, which no
        rotate+scale pair can express (counted as approximated), and motion
        rates change frame of reference when a node is re-rooted.
      - A third that cannot be reported per node, and is the one thing the drive
        turned up that no unit test would have: a WORLD GRID detached from a
        SCALED ancestor. A grid's own scale re-spaces its children without
        stretching them (the ANTz Grid rule) and a root grid's frame carries
        scale (1, 1, 1) by construction, so the ancestor's scale has nowhere to
        go but the grid's own scale field. Its plate and its direct children's
        positions come out identical; their SHAPES, and everything below them,
        divide by that factor. The desktop does the same thing value for value —
        its own test uses an unscaled parent and never meets it — and "Save its
        parent nodes too" is the way out.
      - Companions, all under the node file's own derived stem
        (`Cyclone_gv_node.csv` → `Cyclone_gv_selection_node.csv` + `_tag` /
        `_ch-map` / `_ch-tracks`, save stamp stripped): the Channels pair is
        filtered at the FILE level (`src/gv/channelExport.ts`, the desktop's
        `export_channel_subset`) so a column neither parser reads still
        round-trips, and writes NOTHING when no channel matches — an empty
        ch-map would be found as the fragment's companion and shadow a real one
        sharing the folder. `currentChannelFiles` keeps the loaded scene's two
        files as text for exactly this.
      - Web-side divergences, both platform rather than behaviour: the files
        arrive as DOWNLOADS, like Save gv_node.csv and Save PNG, so the "give
        the fragment its own folder" advice in the desktop's docs is the user's
        to follow; and the tag companion is written only when the node CSV does
        NOT carry labels inline. The desktop always inlines text/link AND writes
        the tag file, so its fragment carries labels twice; this app preserves
        the scene's own authoring style (the rule the Save button already
        follows), so exactly one of the two files holds them and neither style
        can lose them.
      - Parity: `tools/dump_selection_exports.py` runs the REAL desktop
        `build_selection` over 28 cases across four fixtures — a new synthetic
        `selection_export_gv_node.csv` modelled on the desktop test's own
        `_deep_scene` + `_grid_scene` (four levels, HTR and Euler rotations, a
        rod, links reaching in and out, a flat grid under a rotated + scaled
        parent, a globe grid, a topo_scale parent, a collapsed axis, a sheared
        ancestor, rates) plus the real Topology_Example, World_Grid_Example and
        topo_scale scenes. `selectionExport.parity.test.ts` diffs the plan's
        counts and every written row field for field, and pins `decomposeBasis`
        and `eulerXyzFromMatrix` separately so a failure can name which half
        disagreed. Those two blocks are dumped UNROUNDED — rounding a basis to
        12 places invents ~1e-12 of shear in it, and near gimbal lock moves an
        angle by 3e-7. Verified to FAIL three ways: without the grid-scale
        re-application, without the reflection fold, and without the link
        auto-add.
      - Driven in Chrome, 41 measured checks over three scenes: the button's
        size, placement and disabled-with-no-selection behaviour; the window
        fitting on screen with nothing overflowing and every option labelled;
        the preview moving with all four controls (7 → 2 rows on descendants,
        → 9 with parents, → 6 without scene settings); the saved CSV holding
        exactly the promised rows with the World row leading it, ids preserved
        and branch levels restated; the fragment REOPENED and its world matrix
        measured at 4.58e-7; the Channels pair filtered to one track with
        `cyclecount` intact; a tag-file scene's 18 labels reaching the tag
        companion; and the empty-selection message. The picture caught the one
        thing the numbers did not: the disabled channels row read as an ordinary
        enabled one, so its wording greys with it now.
   ee. Adjustable tag text size (shipped 2026-08-18, Jeff's request — a port of
      desktop `aadae11`). Tag labels painted at a hardcoded size, which reads
      small at a normal working camera distance. `tag_font_size` is now a
      World-row scene setting on the same pattern as `tag_color_*`, so the size
      travels with the scene FILE rather than being a viewer preference, driven
      by a 6–36 pt slider with a live readout.
      - `TAG_DEFAULT_FONT_SIZE = 11`, two points up from the old hardcoded 9 pt,
        and it is also the LOAD default — so every existing scene picks up the
        larger type with no file change. The column is written only when it
        differs, which is what keeps every example scene column-stable through a
        load/save round trip.
      - The clamp lives at the READ point (`clampTagFontSize` in
        `src/gv/worldNode.ts`, the desktop's `Viewport._tag_font_size`), not
        only in the slider: a Channels track or a hand-edited CSV can put
        anything in the field, and the overlay must never be asked to paint at a
        size no slider position reproduces. `tagTextStyle` returns it beside the
        colour pair it already carried, and gained a `tagTextStyleOf(world)`
        variant for the animated path, which already holds the row.
      - Qt sizes tag text in POINTS and canvas in px. The old hardcoded `12px`
        WAS the desktop's 9 pt at Qt's assumed 96 dpi, so `TAG_PT_TO_PX = 4/3`
        is the conversion that keeps a number set here the same SIZE as the same
        number set there. Kept as an exact ratio rather than rounded per size —
        a canvas font size may be fractional, and rounding would make several
        slider steps draw identically.
      - Bindable as a Channels attribute (36 now), a World-row setting like
        `render_mode` and the fog fields: it changes what is drawn, never where
        anything sits, so it is in none of the fast-path sets. It reaches the
        screen through `syncAnimatedWorld`, which now refreshes the cached tag
        style — deliberately WITHOUT writing the panel slider, since a playing
        scene would otherwise drag the control out from under the user (the
        desktop's slider likewise syncs only on load). Stop re-syncs both.
      - GUI placement is the Selection panel's Labels section, this app's home
        for the desktop's Display group since 6i — under "Tag Text Matches Node
        Color", where the desktop puts it. A slider rather than a list of point
        sizes, the desktop's own reasoning: what reads well depends on the
        scene, the label lengths and the distance you work at, and that wants
        live feedback against the labels themselves. Captioned ABOVE rather than
        beside (the desktop's layout too) because "Tag Text Size: 11 pt" does
        not fit the 44px label column the rows above it use. Writing `value` on
        the input fires no event, so the load-time sync cannot loop back through
        the handler that synthesizes a World row — merely opening a file must
        not add one.
      - Divergence: the slider greys for a scene with no labels at all, with the
        tag colour and label checkboxes around it, where the desktop leaves it
        live. The same small divergence that section already makes.
      - The XR billboard label (`render/xrLabel.ts`) deliberately does NOT
        follow it: that label is sized in METRES on a 0.6 m quad, so a screen
        point size has nothing to say about it. The desktop's own XR spike has
        no such setting either.
      - Driven in Chrome, 22 measured checks: the row's size, order and that it
        fits the 300px panel; the range and default; and the setting pinned to
        REAL INK rather than to a number moving between objects — one label
        isolated by tag search plus Labels of Selected Only measures 7 / 12 / 35
        px tall and 24 / 42 / 135 px wide at 6 / 11 / 36 pt (a width ratio of
        3.21 against the point ratio 3.27, the rest being whole-pixel
        quantisation), with the whole-scene ink returning EXACTLY to its
        default count when the slider does. Plus the arrow keys stepping it, the
        saved CSV growing the column only once changed and carrying 24 on the
        World row with every glyph row still at 11, and a reload syncing the
        slider to 30.
   ff. Pause Rate Animation [P] + Lock X/Y/Z together (shipped 2026-08-22,
      Jeff's request — two desktop controls this app was missing, neither of
      them from a recent commit: both predate the survey in section 11 and were
      simply never noticed as gaps).
      - PAUSE RATE ANIMATION, desktop View ▸ Pause Rate Animation with its P
        shortcut (`MainWindow._toggle_rates_paused`). **P** freezes every
        rate-animated node where it stands and P again resumes it.
        - The load-bearing part is that the desktop does NOT merely stop
          integrating: it ZEROES the nine rate fields, keeping the originals in
          a snapshot keyed by node id, and puts them back on resume. That is
          the whole feature — a Save made while paused writes a genuinely
          static file, not one that only looked still on screen. Freezing a
          Hyperglyph mid-evolution and saving the pose is the case it exists
          for, and the desktop's Hyperglyph Generator docstring points at it by
          name.
        - This app already had a Rate Motion checkbox in the Channels panel
          that stopped the integration in place — the same idea done half way,
          and recorded as such when Channels shipped ("Not done: the desktop's
          rate-pause snapshot restore"). So the checkbox and the key are now
          ONE state, and it is the desktop's: a second control meaning nearly
          the same thing is the trap the desktop's own scale-lock comment warns
          about. Its label reads `Rate Motion  [P]` and its sense is kept
          (checked = moving) rather than inverted to the desktop's menu wording,
          the checkbox having shipped first and being muscle memory here.
        - `snapshotAndZeroRates` / `restoreRates` in `src/gv/rates.ts`, pure and
          DOM-free like the integrator beside them. The snapshot test is the
          desktop's `if any(rates)` — the nine fields, ignoring `freeze`, so a
          frozen node's stored rates are zeroed for the save too and restored
          untouched. A node deleted while paused is skipped on resume rather
          than being an error, which is why the snapshot is keyed by id on both
          sides.
        - Divergence, an improvement rather than a difference of opinion: the
          integration is ALSO gated on the paused flag. Zeroing alone is enough
          for a CSV-authored rate, but a CHANNEL bound to a rate field writes it
          back every frame, and a pause a channel can undo is not one. It costs
          one boolean.
        - Web-side consequence with no desktop counterpart: `rateCandidates`
          reads the fields the pause just zeroed, so the very press that pauses
          would have reported "0 rate nodes", hidden the Rate Motion row and —
          in a channel-less scene — the whole Channels panel, leaving P as the
          only way back. `rateNodeCount()` counts the frozen ones, and the
          panel's note says `press P to resume` while paused.
        - A new scene resets the pause (its snapshot names ids that mean nothing
          in another file). Small divergence: the desktop leaves its menu item
          checked across a load, pointing at the previous file's snapshot.
        - Alt+P stays Save PNG (the desktop's F12, which a browser keeps); the
          two are unrelated and the BARE key is the one the other app teaches.
      - LOCK X/Y/Z TOGETHER, the desktop's `_insp_scale_lock`: a checkbox under
        the Properties panel's scale group (its own placement, below Scale Rate)
        that ties the three scale axes.
        - It is ONE control for one idea, governing both the panel boxes and
          Scale-mode gizmo drags — the desktop's own reasoning for not putting a
          second checkbox on the Manipulate toolbar. The two act differently
          only because a drag has to: the boxes state an absolute size and can
          honestly equalize all three, while a drag shares its FACTOR
          (`uniformScaleFactor` in `src/gv/multiEdit.ts`, the desktop's
          `next(iter(deltas.values()))`), because equalizing mid-drag would snap
          a deliberately 3:1:1 glyph to a cube on the first pixel. Measured in
          Chrome: an X-handle drag took all three axes ×4.001589 and the 3:1
          proportion came out at 3.000000:1.
        - Ticking it deliberately changes nothing on its own (desktop
          `_on_scale_lock_toggled` / the Composer's `_on_lock_toggled` both only
          record the flag) — the next edit is what ties them, so arming the lock
          can never silently reshape a glyph.
        - Off by default, and panel-wide rather than per node, so it lives on
          the Inspector and survives both the rebuild every edit triggers and
          the selection changing under it. Arming Scale mode reports which way
          it is set, and toggling it while Scale is armed says so, both in the
          desktop's wording.
        - The desktop's SECOND scale lock, on New Object Defaults, has no
          counterpart because this app's Create panel has one Scale field for
          all three axes — already locked, by construction. The Glyph Composer's
          copy shipped with the Composer in 6x.
        - Divergence: the desktop draws a tie-line between the three handle tips
          while locked (`gizmo_mode == MODE_SIZE and uniform_scale`).
          TransformControls' handles are three's, not ours; the status line and
          the checkbox carry the state instead.
        - Fixed in passing, because the locked path had to write `frame.scale`
          itself: a Scale drag never re-derived the GLYPH's draw scale, which is
          where the opt-in minimum size, the Global Scale and a Rod's
          proportions live — so a glyph dragged past the minimum kept shrinking
          until the release committed. The immersive grab (`xrGrabApplySize`)
          had always done this; both paths do now.
      - Found by DRIVING it, and invisible to every other check: a focused HUD
        checkbox was swallowing every single-key command. The keydown handler's
        `typing` guard treats any INPUT as a text field, so clicking a panel
        checkbox killed J/T/H/P and the Ctrl chords until something else took
        focus — at its worst here, where the checkbox and the key are one
        control (click Rate Motion, press P, nothing happens). A checkbox has
        nothing to type into, so it is no longer `typing` — except for Space and
        Enter, which ACTIVATE the control and whose preventDefault would take
        that away. Tool-window controls keep the old rule, which is what they
        were given it for.
      - Driven in Chrome, 47 measured checks: both rows' size, wording, order
        and that they fit the 300px panels; rates integrating, then frozen at
        exactly the three carrying nodes with every field at zero and nothing
        moving over 600 ms; a Save while paused emitting 22 columns and NO rate
        group at all; resume restoring 0.5 / 3 / 0.01 exactly and motion
        resuming; the key and the checkbox driving each other in both
        directions; Space still belonging to the focused checkbox; a scene load
        dropping the pause; the lock off by default, changing nothing when
        ticked, equalizing on the next typed value, surviving the rebuild; and a
        REAL gizmo drag on the X handle (found by hovering along the projected
        axis until `gizmo.axis` reads 'X') measured locked and unlocked.
   gg. Interior geometries (shipped 2026-08-24, Jeff's request — a port of
      desktop `2ba3c4c`, which he had verified there against real GoPro Max2 360
      footage, with a hand-off spec written from this repo's own `src/`):
      **four new geometry ids that draw a shape's INSIDE surface**, so a texture
      or video can be watched from within — a 360° video sphere, a cylindrical
      panorama, a video room. Cube (Interior) 29, Sphere (Interior) 30, Cylinder
      (Interior) 31, Cylinder (Interior, Open) 32; `GEOMETRY_MAX` 28 → 32. (The
      desktop counts the other way — its `GEO_COUNT` is 33 — so the two numbers
      never match and neither is wrong.)
      - The ids ARE the contract, CSVs moving between the two apps. And riding
        in `geometry` rather than in a flag or a node type is the whole
        packaging decision: no new column, so the look saves, loads, O-cycles
        and animates through Channels for free — the rule the link geometries
        already set.
      - THE DESIGN, and the part most likely to be got wrong: **an interior
        shape is a MIRRORED shape, not a two-sided one.** Looking at the inside
        of an outward-mapped surface is inherently a mirror view — the desktop
        measured a texture reading "R" coming back as "Я" with culling simply
        switched off — and the un-mirroring lives in the vertex and UV data,
        which is why it is a geometry and not a state flag. Three consequences,
        all deliberate: mirrored, still SINGLE-SIDED (one fragment per pixel,
        and alpha on a translucent node keeps behaving — `DoubleSide` is the
        reach that would undo it), and drawn UNLIT.
      - `mirroredGeometry` (uvGeometry.ts) reflects through x = 0 IN THE
        BUFFERGEOMETRY, not on the object's scale: three.js compensates for a
        negative-determinant `matrixWorld` (`WebGLState.setMaterial` flips
        `gl.frontFace`), so `mesh.scale.x = -1` gives a mirrored but still
        EXTERIOR shape — the opposite of what is wanted. Baked into the geometry
        the determinant stays positive, nothing compensates, and the faces
        genuinely become back-facing from outside. It is also three's own
        canonical 360-video idiom. The sphere and both cylinders therefore reuse
        the EXISTING builders unchanged, so an interior variant is the same
        shape, tessellation and UV layout as its exterior twin rather than a
        second implementation to keep in step.
      - The CUBE needs a bespoke builder, because **one reflection cannot
        un-mirror all six faces** — the two perpendicular to the mirror axis
        swap places without their own UVs turning over and read backwards.
        `zCubeInteriorGeometry` builds each face from a screen-space basis for a
        viewer at the centre (`right = axis × up`), which lays u to the viewer's
        right and v upward and, being right-handed, winds the quad CCW from
        inside for free. Floor and ceiling take OPPOSITE y, which is not a typo:
        an orbit camera looking down has screen-up pointing away from its
        azimuth and one looking up has it pointing along, so the same y would
        leave one of the two 180° round from the other.
      - UNLIT is `solidMaterial`'s new third argument, building a
        MeshBasicMaterial — worldGridGeometry.ts's own call for a map, and the
        desktop's `_unlit` for exactly these ids. The mirror leaves normals
        pointing OUTWARD (the inverse transpose of diag(−1,1,1) is itself), so a
        lit interior would render at the ambient terms alone; and flipping them
        instead would light it with a key light bolted to the camera
        (lighting.ts), giving a video a bright patch that slides across it as
        the viewer turns — very unpleasant in VR. The cache key gained an
        `|unlit` component so the two material classes cannot collide.
      - END CAPS are TWO IDS, not a field (`src/gv/interiorGeometry.ts`, the
        desktop's `CYLINDER_INTERIOR_BY_CAPS` / `has_caps` / `with_caps`): open
        is a panorama you look along or a link you fly down, capped is a closed
        room. `zTubeGeometry` had already parameterised the caps, so the open
        one is both flags off. The Properties panel's **End caps** checkbox
        swaps the id, sits directly under Geometry (the desktop's placement) and
        the two controls follow each other in BOTH directions — without that,
        the next edit anywhere in the panel would write the dropdown's stale id
        back over this one. `withCaps` is a no-op for every other id, which is
        what stops a mixed selection having its spheres turned into cylinders;
        the row keys on the PRIMARY, as the desktop's does, so it greys out when
        the primary is not one of the pair. A disabled checkbox alone is not
        legible at this size, so `.ins-check:has(input:disabled)` greys the
        wording with it — the lesson the Save Selection window already learned.
      - Web-specific decision the desktop had no counterpart for: `PICK_MATERIAL`
        is `DoubleSide`, which would stop a ray on the NEAR wall you cannot even
        see, and a video room would then swallow every click meant for the scene
        standing inside it. Interior proxies take a FrontSide pick material
        instead, restoring the desktop invariant "the pick pass draws what the
        visible pass draws": from outside you pick the far inner wall, so
        whatever is in the room is nearer and still wins the click. Measured
        both ways in the drive.
      - Nothing else needed changing, and each is worth recording as a
        non-change: links carry them (interiors span −1..1, so
        `DEFAULT_LOCAL_Z_SPAN` is right, and an open interior cylinder is a tube
        you can fly down); the O-cycle picks them up from `GEOMETRY_MAX`, on
        both sides; every geometry menu builds from `GEOMETRY_NAMES`; and World
        Grids are untouched, `gridIsGlobe` still keying on the plain sphere ids
        — an interior globe grid (a planetarium with lon/lat children) is a
        follow-up, not part of this. `dynamicNodes`' `mapped` list did widen to
        Basic as well as Lambert, since a channel-animated `texture_id` is
        exactly what a 360 video wants.
      - FOG deliberately stays ON for interiors, unlike the halos and the gizmo:
        the desktop's fog is global GL state that its `glDisable(GL_LIGHTING)`
        does not touch, so a desktop interior fogs too. Unlit is about
        BRIGHTNESS, not about opting out of the scene.
      - Parity: the link fixture was regenerated against the real desktop module
        (`dump_link_matrices.py`, now 33 ids) and came back with the four new
        rows appended and NOTHING else moved — a check on the desktop's link
        math being untouched. The count assertion is `GEOMETRY_MAX + 1` now, so
        a new shape on either side shows up as a missing row rather than
        silently going unchecked.
      - Tests mirror the desktop's `test_interior_geometry.py`: every interior
        face's geometric normal points AT the origin; UV HANDEDNESS — "not
        mirrored" stated without pixels — recovers ∂p/∂u × ∂p/∂v per face and
        checks it points inward, WITH THE EXTERIOR TWINS AS THE CONTROL, which
        is the contrast back-face culling alone cannot produce; six quads, six
        axis normals, the full [0,1]² per face, the walls upright and floor and
        ceiling opposed; the open tube emitting no cap geometry and the capped
        one two; separate cached geometries for the pair (shared, the checkbox
        would do nothing on screen); and that mirroring in place never reaches
        the shared exterior geometry.
      - Driven in Chrome, 28 measured checks against a scene built for it (a
        50-unit interior sphere and video room wearing generated
        quartile-stripe textures): from inside the sphere u increases to the
        viewer's RIGHT (blue → yellow) where an un-mirrored one would read
        yellow → blue, at the texture's own 0,0,255 where the exterior control
        varies 239 → 128 across its curvature; v runs north, white overhead and
        black underfoot; the video room's wall, ceiling AND floor all read white
        band up, red left, blue right; from outside the shape shows its far
        inner wall rather than vanishing; a glyph inside the room still takes
        the click and the room itself is still pickable; the End caps row's
        size, placement, both directions of agreement, its greyed disabled
        state and a mixed selection leaving a plain sphere alone; O stepping
        28 → 29 → … → 32; and the ids saving in the geometry column with no new
        column. Console clean.
        - Verified to FAIL: with the mirror removed, the sphere is not merely
          reversed from the centre but COMPLETELY INVISIBLE — every ray out of
          the centre meets exactly one wall, which back-face culling then
          discards. Three checks went red.
      - **CONFIRMED IN VR ON HARDWARE** by Jeff, 2026-08-24, the same day it
        shipped: "I tested the build, especially in VR, and it worked
        beautifully." Which is the test that mattered — a headset viewer stands
        at the centre of the shape, so the mirror, the unlit brightness and the
        near-plane clearance are all being judged at once, in the one place the
        feature exists for.
      - Known follow-ups, the desktop's own: stereoscopic 360 (top/bottom or
        side-by-side footage) needs per-eye UV offsets and is mono-only here;
        and the interior globe World Grid above. With mono confirmed in the
        headset, STEREOSCOPIC 360 is now the obvious next step for this feature
        — the desktop names it as such too. Do not start it unprompted.
   hh. Flat Ring (shipped 2026-08-26, Jeff's request — a port of desktop
      `721b827`, so that its companion example, the **Armillary World**
      (`9d26323`, 991 nodes built out of rings), can be walked around in VR):
      **two new geometry ids that draw a torus with a RECTANGULAR
      cross-section** — Flat Ring 33 and Flat Ring Wire 34; `GEOMETRY_MAX`
      32 → 34. (The desktop counts the other way — its `GEO_COUNT` is 35 — so
      the two numbers never match and neither is wrong.)
      - WHY IT IS A SHAPE and not a squashed torus: four real faces, each with
        its own constant normal and its own corner vertices, so the edges stay
        CRISP where a torus shades smoothly round its tube and slides its
        highlight along it. That is the difference between soft tubing and a
        machined band, which is what an armillary, an astrolabe or a graduated
        dial is made of — and only a flat face holds a legible texture.
      - The two proportions come from fields that ALREADY EXIST, so there is no
        new column and every existing control — the panel row, the gizmo, the
        Channels binding, the CSV writer — works on it unchanged: `ratio` is the
        band's RADIAL width, `scale_z` its height.
        - `ratio` reading as a radial width is not a second meaning for the
          field, it is the one it already had. `torusRadii` puts a tube between
          radius 1 − 2·ratio and 1 spanning z ±ratio — a torus's cross-section
          is ALREADY a square with rounded corners — and `ringDims`
          (glyphGeometry.ts, the desktop's `ring_dims`) restates those same
          extents as a box. So Torus ↔ Flat Ring is a pure change of LOOK: same
          silhouette, same bounding extents, and `topoOffset` places a
          Torus-topology parent's children identically whichever the parent
          wears. Measured live: a Torus and a Ring at ratio 0.14 and scale 4
          both span 2.88–4 radially × ±0.56 in z.
        - The alternative — `ratio` as a height:width ratio plus a new column
          for the width — was rejected on the desktop for three reasons that
          hold here too, one of them platform-specific: height would need a
          column, a row, a gizmo and a binding that `scale_z` already has; the
          per-ratio geometry cache stays ONE-dimensional, since height rides on
          the node's scale outside the built geometry, where a second shape
          parameter could mint ten thousand geometries on a Channels sweep and
          nothing here ever evicts one; and an existing scene can swap the id
          without moving anything. The cost is that local half-height is
          `ratio`, so a thin band needs a large `scale_z` to stand tall.
          Measured on a purpose-built scene: ratio 0.02 at scale_z 20 is a 5:1
          upright hoop and ratio 0.4 at scale_z 0.4 a 10:1 flat dial, out of the
          same field pair.
      - TEXTURES are the point of the flat faces, and the rule is that EVERY
        face carries a full 0–1 UV span of its OWN — v does not walk the
        cross-section perimeter the way the torus's mapping does. So one
        undistorted copy of a marking strip lands on the outer wall and another
        on the dial face, and the aspect decides which one the viewer reads; a
        perimeter-walking v would smear one image across all four faces and
        break it at every corner. Each face's u runs in the direction that reads
        FORWARDS from that face's natural viewing side — decreasing angle on the
        inner wall, seen from within the hole, and on the underside.
        Equivalently (∂p/∂u × ∂p/∂v) points along the face normal on all four,
        which is the same handedness contract the interior geometries carry
        (6gg) and pinned the same way, with the reversal verified to FAIL.
      - `zRingGeometry` / `zRingWireGeometry` live in `uvGeometry.ts` with the
        other hand-built primitives, taking their dimensions as ARGUMENTS rather
        than importing `ringDims` — the split zPinGeometry already makes, and
        what keeps the two modules acyclic. `RATIO_SHAPED_GEOMETRIES` (the
        desktop's own set) is what routes both ids to the per-ratio cache, read
        by the glyph factory and by `dynamicNodes`' shape key rather than named
        twice; `quantizedTorusRatio` became `quantizedShapeRatio` with it,
        mirroring the desktop's `ensure_torus_list` → `ensure_ratio_list`.
      - DIVERGENCE, and the one place this leaves the app's own convention:
        the wire ring is TRACED (four edge circles + 12 cross-section rungs, the
        desktop's own `_draw_ring(solid=False)`) where every other wire glyph
        here is a `WireframeGeometry` of its solid. That reading IS the shape: a
        WireframeGeometry of a 48-station band is 400-odd edges of cross-hatch
        that close into a solid mat at any distance, the opposite of an
        instrument hoop. Drift is not the hazard it is for the pin (6aa) either,
        since both forms are swept from the same `ringDims` rectangle.
      - The PICK PROXY is per-ratio, unlike the torus's fixed one. The ring is
        the shape whose `ratio` decides how much of its own footprint is solid
        at all — a rail is a band 4% of its radius wide, a graduated dial is most
        of a disc — so a fixed proxy would let clicks through the middle of a
        wide dial and catch clicks aimed through a thin hoop's hole. It costs
        nothing: at the same quantized ratio it IS the geometry the glyph draws,
        which is why `createPickProxy` grew a `ratio` argument rather than a
        second cache.
      - Nothing else needed changing, and each is worth recording as a
        non-change: O/Shift+O picks the pair up from `GEOMETRY_MAX` on both
        sides (33 → 34 → wrap, driven); every geometry menu and the VR Shape
        page build from `GEOMETRY_NAMES`; a Channels-bound `geometry` clamps to
        the new max; and links carry them unchanged — the regenerated
        `link_matrices.json` came back with the two new rows appended and
        NOTHING else moved, which is a check on the desktop's link math being
        untouched.
      - The desktop's one GUI change came with it: the inspector's `ratio` row
        gained that app's own tooltip, which is where the Flat Ring's reading of
        the field is explained beside the four other things it means.
      - Parity: `tools/dump_ring_geometry.py` runs the REAL desktop `_draw_ring`
        with the GL entry points swapped for recorders — the trick
        `dump_topology_overlays.py` already uses — over seven ratios including
        both sides of the hole closing, and `ringGeometry.parity.test.ts` diffs
        the position, normal AND texture coordinate of every emitted vertex in
        order, plus the wire loops and `ringDims` against `torusRadii`. The web
        emits in the desktop's own per-face, per-station order so the flat
        arrays compare element for element; the builder's DEFAULT tessellation
        is pinned separately, since a periodic shape that agrees at 8 stations
        agrees at any count and could otherwise silently draw a 12-sided band.
        Verified to FAIL against a flipped inner-wall u (5 cases) and against a
        reversed winding.
      - Driven in Chrome, 20 measured checks over two scenes: the real
        Armillary World's 991 rows load with all 40 rings and 26 wire rings
        drawn, 17 cached shapes between them, each spanning radius 1 and ±its
        own quantized ratio, 11 wearing their textures, and a click on a band
        selecting a ring; then a purpose-built five-ring scene measuring the
        square cross-section, the rail, the dial, the hoop, the wire ring's
        240 segments and the Torus-extents equivalence above. Console clean.
        - The PICTURE is what settles this one, as it did for 6gg: the zodiac
          ring's flat face reads CAPRICORN 270 deg, AQUARIUS 300 deg, TAURUS
          30 deg the right way round and undistorted, the horizon dial's
          azimuth numerals and tick marks with them — which is a mirrored UV,
          a smeared one and a broken corner all ruled out at once, in the way
          the feature actually gets used.
      - **CONFIRMED IN VR ON HARDWARE** by Jeff, 2026-08-26, the same day it
        shipped: he walked the Armillary World in a headset and called the
        immersive experience "excellent". Which is the test that mattered — the
        scene exists to be stood inside, and the rings' crisp edges and the
        legibility of their graduated bands are judged at reading distance
        there, not from a desktop orbit.
        - The scene itself is NOT final: Jeff is making adjustments to it on
          the desktop before it becomes an official example, so its CSV and
          textures will change. Don't vendor it or build anything on its exact
          row ids until he says it has settled.
        - The same session's real finding is about the app, not the shape:
          **the immersive CONTROLS need improvement** (his words). That is the
          next piece of work — see the XR pending list in section 9.
   ii. Tag labels on by default + Channel In (shipped 2026-08-29, Jeff's
      request — two of the desktop's most-demanded features, ported the day he
      built them there; his desktop working tree, not yet a commit). Unrelated
      to each other, and shipped together because he asked for them together.
      - TAG LABELS DEFAULT ON, SCOPED TO THE SELECTION (desktop
        `Viewport.show_tags` / `show_tags_selected_only`, both False → True).
        The PAIR is the default, and either half alone is worse: all-tags-off
        hides the labels a scene's author wrote, all-tags-on buries a large
        scene in text. Together they mean "click a glyph, read what it is" —
        discoverable without ever cluttering the view. T still toggles the
        first; unchecking the second labels every tagged node at once.
        - Three lines of state (main.ts's two flags and the two checkboxes)
          that must agree at boot, which is what the drive measured rather
          than assumed. Nothing else changed: the cap, the pinning exemption
          and the XR billboard label all behave as before.
        - No web counterpart to the desktop half of that commit: its headless
          tools (`export_frame.py`, `benchmark_frames.py`,
          `capture_tour_shots.py`) had to start saying
          `show_tags_selected_only = False` explicitly, since a headless render
          has no selection and would otherwise draw zero tags. This app's Save
          PNG captures what is on screen, selection included, so it needs no
          such opt-out.
      - CHANNEL IN (desktop `set_channel_id` / `channel_attrs` /
        `_refresh_channel_in_row` / `_ch_rebind`): a node's `ch_input_id` — the
        join that decides which channel of a Channels animation drives it — is
        now editable from the Properties panel, directly under the texture row
        (the desktop's own placement: both are ids pointing into a companion
        file rather than properties of the glyph). Before this it could only be
        written into the node CSV by hand, so there was no way to try an
        animation against a node you were looking at.
        - `setChannelInputId` (gv/channels.ts) writes back through whichever of
          `CH_INPUT_KEYS` the file already used — `channelInputId` reads the
          FIRST key present, so always adding `ch_input_id` would leave a
          GaiaViz-dialect row with two columns that disagree, and grow its file
          a column it never had. 0 is written, never deleted.
        - REBINDING IS RESET-THEN-REBIND, and the order is the feature:
          `bindChannels` snapshots each newly-bound node's CURRENT field values
          as the ones Stop restores, so re-resolving mid-playback without
          resetting first would bake whatever frame was on screen into the
          scene permanently — and a node taken OFF a channel would keep that
          frame's values instead of returning to its own. `rebindChannels`
          runs BEFORE the rebuild, since the build is what registers the
          animated slice with DynamicNodes; main.ts now keeps the PARSED
          companions (`channelData`) alongside the resolved animation for it,
          where it used to hand them to `bindChannels` and forget them.
        - `loadChannels` no longer discards an animation whose channels no node
          points at (the desktop dropped its `has_bindings` requirement in the
          same commit): a channel file nothing references yet is precisely the
          scene this row exists to wire up, and hiding the transport left
          nothing to bind against. The `frameCount > 0` half of the old guard
          stays — that IS "there is nothing to play".
        - Divergence, and the same one the texture row already makes: the row
          is a MENU of the channels the loaded ch-map actually offers, each
          labelled with what it drives (`3 · translate_z, color_r`), with ‹ ›
          steppers that walk it — where the desktop has a bare spin box. This
          app has the parsed map in hand and a channel id is otherwise a number
          with nothing on screen to check it against. An id the map does NOT
          carry still round-trips, as an `Unknown (99)` entry, because a scene
          may legitimately be wired up before its channel file exists; with no
          channel file at all the row degrades to the desktop's plain id field.
        - The hint line under the row is the discovery half and is the
          desktop's wording exactly (`ui/channelIn.ts`, pure text, no DOM in
          it): what the chosen channel drives, or how many channels the file
          has and which ids they use, plus `(selection differs)` for a mixed
          selection. `channelAttributes` filters through the same bindable-
          attribute table `bindChannels` uses, so the hint promises only what
          will actually happen — never merely what the file says.
        - Applies ABSOLUTELY to every selected node (the desktop's rule), so
          pointing several nodes at one channel makes them animate in unison.
          The scene line's bound-node count now follows a rebind rather than
          being frozen at load, and `__gv.channelState` gained `bound` for the
          same reason — after that line, the bound set is nowhere in the DOM.
      - Parity: the desktop's `tests/test_channel_binding.py` is ported case
        for case into `channels.test.ts` (the key round trip, the explicit 0,
        the attribute filter, and the reset-then-rebind ordering);
        `ui/channelIn.test.ts` pins every hint and status string.
      - Driven in Chrome, 41 measured checks over three passes and four scenes:
        both checkboxes checked at boot with ZERO label ink until something is
        selected and 360 px² of it after (1833 with the scope unchecked, i.e.
        the whole scene); T still toggling from the new default; the row's
        size, order, wrapping and that nothing overflows the 300px panel; a
        node bound mid-playback taking channel 5 and MOVING frame to frame
        (2.89 → 1.90); clearing it back to the CSV value while still playing;
        a three-node selection binding as one; the steppers walking the list
        and wrapping; the saved CSV carrying the column; and — on a scene built
        to the desktop test's own shape, whose channels bind nothing — the
        transport on screen anyway, then node 1 bound to channel 3 and frame 2
        driving translate_z to 9 and color_r to 30 with its sibling untouched
        at 0 / 90, the desktop test's own numbers.
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
       draw floor on that node's own glyph — and on nobody else's,
       since the floor is per node (see 6p).
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
     - Bug fixed 2026-07-27 (Jeff reported it on Breathing_Century, the
       only example in the corpus built this way): an animated `color_a`
       could not fade a glyph OUT. Three bakes transparency into the
       shader program — `parameters.opaque` (transparent false AND
       NormalBlending) emits `#define OPAQUE`, and `opaque_fragment`
       then forces `diffuseColor.a = 1.0` — so flipping
       `material.transparent` at run time does nothing until a
       recompile. Every glyph authored at `color_a` 255 went on drawing
       solid at opacity 0. Breathing_Century's whole animation is that
       flip (each of ~1,700 glyphs is born transparent and snaps solid
       the year it happened), which is why nothing else in the corpus
       showed it: the fade-INS worked, because a material built at the
       example's ghosted 175 was already compiled transparent. Per-frame
       opacity writes now go through `setNaturalTransparency`
       (renderMode.ts, where `applyToMaterial` already handled the same
       hazard) — the flag is only touched when it actually changes, so a
       steady scene pays nothing, and a render mode's forced
       transparency stays in charge where it has one (Additive et al.
       force it on, Off forces it off and ignores alpha outright).
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
   - ~~Imported meshes~~ (shipped 2026-07-28, Jeff's request): geometry
     23 (Mesh) now draws an imported .obj/.stl, and models can be
     imported IN the web app, not merely referenced by a CSV.
     `src/gv/meshFile.ts` parses (pure data, no THREE — testable in plain
     node), `src/render/meshLibrary.ts` holds the session's registry.
     - The parse reproduces what the desktop's `mesh_loader.py` gets out
       of trimesh, which is more than the file says. `load(force='mesh')`
       runs `process=True`, so THREE things happen before GlyphViz's own
       normalization: duplicate vertices MERGE (an STL has none shared,
       so this is what makes it a connected surface), faces with NaN/∞
       coordinates are REMOVED (`remove_infinite_values`), and
       `vertex_normals` is the ANGLE-WEIGHTED mean of adjacent face
       normals over the merged vertices. So a desktop STL glyph is
       smooth-shaded and its own facet normals never reach the screen —
       both reproduced here. Then GlyphViz's own step: centre on the AABB
       centre, divide by the farthest vertex, so a model composes with
       scale_x/y/z exactly like every built-in glyph ("fits within radius
       ~1").
       - The NaN pass is not defensive programming: Jeff's own
         `isosurface2.stl` (VTK-written) has 6,929 such facets out of
         32,828, and ONE left in makes the bounding box NaN and the whole
         model disappear. The count is reported on import, where the
         desktop drops them silently.
     - No loader dependency. Three ships STLLoader/OBJLoader, but neither
       merges vertices, so both would flat-shade an STL where the desktop
       is smooth — the divergence is in exactly the part an addon would
       own. Same call the CSV tokenizer and the zip reader made.
     - Rendering: `GlyphStyle.mesh`, resolved in buildScene from
       `BuildSceneOptions.meshes`. DoubleSide, because the desktop drops
       back-face culling around a mesh display list (an imported file
       cannot be trusted to wind outward). A mesh_id nothing has supplied
       draws the desktop's SPHERE fallback — the state every CSV saved
       with meshes reopens in — with one warning per id, not per node.
       Picking is against the mesh itself, like the desktop's pick pass.
     - Import (desktop `_import_mesh_file`, Meshes ▸ Import Mesh File…):
       the target rule is Paste's — exactly one node selected → the model
       is assigned to it (geometry 23 + mesh_id, everything else kept);
       nothing selected → a new root object (type 5, scale 5, grey, and
       topo 0, the one path that does NOT take the New Object Defaults
       topology); more than one → refused with a reason. Web-only: the
       picker takes several files (the first lands on the selection, the
       rest become objects), and a drop of nothing but models imports
       instead of failing as a scene open.
     - Ids are import order and session-scoped, as there — the CSV
       carries the id and nothing else, so the library OUTLIVES a scene
       load (import a model, then open a CSV that names mesh_id 1).
       Re-importing the same file reuses its id and re-reads it.
     - The one invented convention: a scene folder MAY ship its own
       models (next to the node CSV, or in `mesh/`/`meshes/`/`models/`),
       and those take ids 1..N by sorted name — the same rule `media/` →
       texture_id already follows, and the only way a mesh_id can mean
       the same thing twice. Such a scene REPLACES the library; a scene
       without models leaves it alone. Worth mirroring on the desktop,
       which today cannot reopen its own mesh scenes.
     - Divergence: a mesh takes the node's `texture_id` when the file
       carries UVs (boid1.obj does). The desktop never textures a mesh at
       all — `mesh_loader` keeps no texture coordinates and `register_mesh`
       emits no `glTexCoord` — but the texture row already promises this,
       and a file with no UVs is still left untextured rather than
       smearing one texel over the model.
     - PLY/GLB/GLTF are refused BY NAME ("desktop GlyphViz reads this
       through trimesh… export as .obj or .stl") rather than as unknown
       formats: the desktop accepts them, so a user meeting a refusal
       here needs to know which side is missing it.
   - ~~Hyperglyph Generator~~ (shipped 2026-07-28, Jeff's request): a port
     of desktop Tools ▸ Hyperglyph Generator… (`hyperglyph_dialog.py` +
     the slice of `hyperglyph_lab/hyperglyph_generator.py` it uses).
     Ctrl+H — the desktop's own chord, and unlike Ctrl+N it IS
     interceptable — or a Create-panel button opens a FLOATING window:
     parameters, Regenerate, a live 3D preview, Insert into Scene.
     - It is the app's only non-docked chrome, and deliberately so.
       Jeff asked for the desktop's interaction specifically: a window
       you drag aside, generate a few designs in, and drop the one you
       like into the scene behind it. A docked panel would have to be
       dismissed to see the result of using it. Modeless where the
       desktop is `exec()`-modal — its Insert already edits the live
       scene, so modality buys nothing there and costs the ability to
       move the camera between insertions here.
     - The preview is a SECOND WebGLRenderer on its own canvas, reusing
       buildScene + the app's lighting rig, driven from the main
       animation loop rather than a second rAF. It integrates rates, so
       Idle Motion actually spins. Its materials are CLONED out of the
       shared cache — `clearMaterialCache()` on scene load would
       otherwise dispose materials the preview is still drawing with.
     - `src/gv/pythonRandom.ts` is the load-bearing part: CPython's
       Mersenne Twister plus the exact `random.Random` wrappers
       (genrand_res53, top-k-bits `getrandbits`, `_randbelow`'s REJECTION
       loop). The desktop's whole model is "Seed + Max Nodes + Branch
       Levels determine the design, always", so a seed that named a
       different hyperglyph here would be meaningless to write down.
       `Math.floor(random() * n)` is not a shortcut — it consumes a
       different number of draws and desynchronises the rest of the
       design. Vectors dumped from CPython pin it.
     - `src/gv/glyphRecipe.ts` (the LevelSpec/GlyphRecipe model, shared
       with the desktop's Glyph Composer) and `src/gv/hyperglyph.ts` (the
       design vocabulary: 6 geometry families, 6 hue schemes, the node
       budget). The ORDER of the rng calls in `randomRecipe` is the
       specification, not an implementation detail — hoisting a draw out
       of the conditional that guards it repoints every existing seed.
     - Parity: `tools/dump_hyperglyphs.py` runs the REAL desktop
       generator; `hyperglyph.parity.test.ts` diffs 12 designs / 5,236
       nodes field for field (verified to FAIL when two adjacent rng
       draws are swapped). Also checked end to end against
       `dump_world_transforms.py` for a generated design: the desktop
       renders the same sprawling shape, to float32.
     - Desktop BUG found and reported: `pick_level_counts` calls
       `randint(max(2, guess - 2), min(12, guess + 2))` where
       `guess = round(max_nodes ** (1/depth))`. Only the HIGH end is
       capped at MAX_BRANCH, so once `guess` passes 14 the low end
       overshoots it and the range runs backwards — ValueError out of
       the dialog. Shallow trees are where `guess` runs away (at depth 1
       it IS the budget). Scanned against the real function over the
       spinbox ranges: Branch Levels 2 fails at Max Nodes ≥ 15, 3 at
       ≥ 211, 4 at ≥ 3049, and 5–10 never fail up to 20000 — so the
       default 500 breaks Branch Levels 2 and 3, while the default depth
       of 5 is fine, which is presumably why it went unnoticed. The web
       clamps the low end DOWN to the high one, which only fires where
       the desktop cannot generate at all, so no seed's design changes.
     - Divergence, inherited rather than chosen: idle motion depends on
       ABSOLUTE branch level (it skips level 0 and alternates by depth),
       so a design inserted UNDER a selected node gets a spinning trunk
       and different rates than the same seed inserted at the root.
       Shape, colour and geometry are identical either way. Arguably
       right — the counter-rotation is against the ring the node
       actually hangs from.
     - Not ported: `generate_batch`, the ratings CSV and
       `mutate_recipe`'s explore/exploit loop. Those belong to the
       standalone `hyperglyph_lab/` CLI/notebook, which writes files and
       learns from Jeff's hand-entered scores — a different tool.
   - ~~Glyph Composer~~ (shipped 2026-07-28, Jeff's request): a port of
     desktop Tools ▸ Glyph Composer… (`glyph_composer_dialog.py`), the
     hand-built counterpart to the Hyperglyph Generator's rolled one.
     Ctrl+G — the desktop's own chord, and interceptable — or a
     Create-panel button opens a second FLOATING window: a branch-level
     list with Add/Remove, a parameter form for the selected level, a
     live preview, template Save/Load, and Insert into Scene.
     - The recipe MODEL was already here: `generateNodes` /`LevelSpec` /
       `GlyphRecipe` shipped with the Generator, which randomizes exactly
       what this dialog edits. What this added to `glyphRecipe.ts` is the
       dialog's own pieces — `ROOT_DIST_MODES` / `NONROOT_DIST_MODES` /
       `DIST_LABELS`, `defaultRecipe()`, `addedLevelSpec()` (the "+ Add
       Level" defaults, which are NOT the dataclass defaults), and the
       template JSON.
     - Templates are the desktop's `recipe_to_dict` file exactly —
       snake_case keys, colours as arrays, `color_end: null` for a solid
       level — because a .json written by either app has to open in the
       other. That is the only route a design takes between the two.
       Unknown keys are ignored and missing ones take the dataclass
       default, matching `recipe_from_dict`'s `.get(...)` reads, so a
       template from an older or newer build still loads. A file that is
       not a recipe at all is REFUSED and reported rather than replacing
       the design in progress with an empty one.
     - Two pieces were factored OUT of `hyperglyphWindow.ts` rather than
       copied: `ui/floatWindow.ts` (the draggable/resizable/closable
       frame) and `ui/glyphPreview.ts` (the second WebGLRenderer, its
       material privatisation, and its rate integration). The Generator
       now sits on both, so the app has one floating-window behaviour and
       one preview renderer, not two of each. The desktop drops a whole
       second `Viewport` widget into each dialog for the same reason.
     - Divergences, all platform rather than behaviour except the last:
       - LAYOUT. The desktop is a 900×700 dialog with a splitter (levels
         left, form right). A floating window in a browser viewport is
         narrow, so the same pieces STACK in the desktop's own
         top-to-bottom reading order. Nothing added, nothing removed.
       - ALPHA. `<input type="color">` has no alpha channel where
         QColorDialog is opened with ShowAlphaChannel, so each colour
         gets its own 0–255 field beside the swatch. Recipes carry RGBA
         either way, so a template still round-trips.
       - LIVE BINDING. Every control writes its own field the moment it
         changes, where the desktop reads its widgets back in one
         `_save_params` pass — a design whose own module docstring is a
         note about the stale-QWidget crash it caused. There is no save
         pass to forget here and no widget that can outlive its spec.
       - PREVIEW CAMERA (a real behaviour choice, and the simplest
         default rather than a ported one). It HOLDS position across
         re-previews. The desktop's `_do_preview` calls
         `Viewport.set_nodes`, which resets `_cam_target`/`_cam_distance`
         and rebuilds `_cameras` — right for loading a scene, the job it
         was written for, but here it fires 350 ms after every keystroke,
         so an orbited preview snaps back the moment a value is nudged
         and a scale or spacing change cannot be judged against the view
         it was made in. A Fit View button puts the desktop's behaviour
         one click away, and the first preview of a design always frames
         it.
     - Insert is `_insert_into_scene`, which the two dialogs share almost
       line for line: the PRIMARY selected node is the parent (row order,
       as everywhere), nothing selected means a new root object, the
       trunk keeps the recipe's own (0,0,0) rather than being offset like
       a pasted subtree, and the TRUNK alone is selected afterwards — so
       a second insertion nests under the first.
     - Parity: `tools/dump_glyph_recipes.py` runs the REAL desktop
       `generate_nodes` and `recipe_to_dict`;
       `src/gv/glyphRecipe.parity.test.ts` diffs 13 recipes / 169 nodes
       field for field and round-trips every template. The Generator's
       harness already covered `generate_nodes`, but only over recipes it
       can PRODUCE (Angular and Linear, a narrow slice of the ranges) —
       these are deliberately the cases it cannot reach: Circular / Grid
       / Random placement, a ragged grid, solid vs gradient colour (one
       truncates, the other rounds half-to-EVEN), a count of 1 where the
       gradient's denominator would divide by zero, and four levels of
       nesting. Verified to FAIL against a `ceil`→`floor` grid slip and
       against half-up gradient rounding.
     - Small fix that came with it: viewport single-key commands now
       stand down while focus is inside a tool window. Browsers focus a
       button on click, so a Space meant to re-press Preview Now would
       otherwise also reach the viewport and toggle Channels playback.
       The Generator had the same latent problem.
   - Remaining: a curated set of hosted example folders (agreed
     2026-07-25, textures downscaled to ~2048px — the full examples tree
     is 315 MB and is never shipped wholesale). Lower priority per Jeff
     (2026-07-25): folder drop and zip already let users draw from their
     own copy of the GlyphViz examples.
8. ~~Camera Mode + camera views~~ (shipped 2026-07-30, the last of Jeff's
   four-feature ask): **C** toggles free flight, **Shift+C** cycles the
   camera views. Ports desktop `d66304a`, the ANTz-style RATE flight rework,
   not `7a73392`'s per-move drag with banking (the port-the-revisit rule; the
   desktop replaced that at its test group's request, and banking went with
   it — the up vector is always world-Z). `src/render/cameraMode.ts` is the
   whole model, DOM- and THREE-free; `cameraMode.test.ts` is the desktop's
   271-line `tests/test_camera_mode.py` spec ported test for test.
   - The model: the rig stays the same azimuth/elevation/distance/target
     orbit rig, and flight only changes which end of the arm the mouse
     drives. Orbit swings the EYE around a fixed target; flight swings the
     TARGET around a fixed eye (turning, look-around) and translates both
     together (flying, sliding) — the arm length never changes, so the
     target rides along in front of the camera instead of pinning it, and
     switching back off leaves it wherever flight ended, ready to orbit.
   - Rate flight, desktop constants exactly: the left-press point is a
     bearings origin; the held cursor offset sets a continuous speed
     (0.01 arm-lengths/s and 0.5°/s per px, 3px per-axis dead zone measured
     from its EDGE so motion ramps from zero), integrated per frame on the
     animation loop's existing dtMs — motion continues while the mouse sits
     still, returning to the origin stops it, and a click (never leaving the
     dead zone) still picks. Translation is plane-locked to the heading
     (forward with pitch dropped): altitude never changes. Turning re-aims
     ABOUT THE EYE — reaimAboutEye re-derives the target from the preserved
     eye, since naively bumping azimuth orbits, the exact anchored feel the
     mode exists to escape. Right-drag look-around (0.25°/px, elevation
     clamped ±89°), Left+Right strafe (0.004 arm/px), wheel flies 0.12
     arm-lengths/notch (zooming would silently slow every later drag —
     speeds scale off the arm).
   - The desktop's press/release/combo handlers collapse to ONE transition
     rule in `flyPointerEvent`: whenever the Left/Right chord changes,
     exactly-Left (re)drops the origin at the cursor, anything else suspends
     flight. That single rule reproduces the fresh press, the combo-start
     suspension, the combo-end re-anchor (the stale origin would lurch), and
     the toggled-mid-drag adoption; the rig also forgets the chord on mode
     entry, so a button held from before Camera Mode can't replay a stale
     delta. main.ts routes every canvas pointer event to the rig first while
     the mode is on (a Shift rubber-band sweep in progress keeps the pointer
     it grabbed — sweeps still work in flight, desktop parity) and captures
     the pointer, so a long hold survives leaving the canvas.
   - OrbitControls stands aside COMPLETELY while flying (every place that
     restored `controls.enabled = true` now restores `!flyMode`), and the
     loop pushes the rig into the camera each frame. A sticky flyPressMoved
     flag joins comboUsedInPress in the click guard: a rate flight ENDS its
     cursor at the press point (that is how you stop), so the release-
     displacement test alone would misread a whole flight as a click.
   - Camera views: Main + locked +X/+Y/+Z reference views onto the world
     origin (elevation 89 for +Z, short of the singularity), in a Scene-
     panel Camera row; switching saves the live viewpoint into the outgoing
     slot, so Main's zoom survives a round trip through the axis views.
     Locked views are zoom-only — OrbitControls rotate/pan off, the manual
     combo keeps its zoom half and drops the orbit, plain orbit is inert,
     and the combo pivot snap and dblclick recenter are skipped. Picking a
     locked view LEAVES Camera Mode; C on a locked view switches to Main
     first (desktop rules). A scene load re-derives the axis distance (max
     node distance from the ORIGIN × 1.5, min 50 — they aim at the origin,
     so the scene's span about its own centre is the wrong measure) and
     drops back to Main; fly mode itself survives the load, as there.
   - Interlocks: entering Camera Mode clears Follow Selected (following
     would undo flight's translation on the spot) and detaches the gizmo
     handles — the armed mode stays sticky per the 6h rule, the handles
     just go away and return on exit. Stereo needed nothing: flight drives
     the one main camera and the per-eye derivation is downstream (driven
     in stereo to prove it). Divergences, deliberate: F mid-flight leaves
     Camera Mode (the entry interlock in reverse — the desktop lets follow
     and flight fight per frame, which reads as an accident, not a design);
     middle-button does nothing while flying where the desktop keeps its
     pan (OrbitControls is all-or-nothing; simplest default); no
     camera_state snapshot API (it exists for desktop Watch-and-Reload,
     which this app doesn't have).
   - `window.__gv` exposes camera/controls/flyRig/gizmo read-only for the
     headless drive harness — nothing in the DOM shows the eye position.
     Driven in Chrome twice (45 + 9 measured checks): held-offset flight
     continues over two 600ms samples with the mouse still, altitude and
     arm length hold to 1e-6, turn pivots at 1e-13 of eye movement, strafe
     keeps cos(aim) ≥ 1−1e-9, handles detach/reattach, axis distances came
     out 159/50/861 across three scenes, stereo flight and look both move,
     console clean throughout.
9. WebXR — immersive mode, v1 (shipped 2026-08-14, Jeff's request once the
   backlog emptied). An **Enter VR** button in the Scene panel's world group
   walks into the scene with a headset: fly it, point at a node and select it.
   The plan agreed that day was P0 (session + rig) + P1 (navigate and inspect)
   as the first shippable thing, with the in-VR control panel, passthrough AR
   and authoring gestures as later phases (see the Pending list at the end of
   this item).
   - WHY HERE and not the desktop: a headset browser opens the deployed URL —
     no APK, no sideload, no Link cable — and every feature this app already
     has is in the scene graph a session draws. The desktop's OpenXR spike
     (`../glyphviz/glyphviz_xr/`) can only run PC-tethered, and is a spike
     rather than a maintained feature. What it IS good for is the interaction
     spec: Jeff has flown scenes with those controls, so `controller_nav.py`'s
     mapping and constants are ported behaviour-for-behaviour.
   - THE ONE ARCHITECTURAL DECISION: move the RIG, not the world.
     `src/render/xrNav.ts` (pure maths, no THREE and no DOM, like
     cameraMode.ts) defines
     `rig = T(nav) · R_z(yaw) · R_x(+90°) · S(scale)` with the camera and
     controllers parented to it. The spike does the opposite — it pushes
     `Translate · RotateX(-90) · Scale` onto the modelview and carries
     locomotion in `rig_inverse` — which is right for immediate-mode GL and
     wrong here: every world-space buffer this app keeps (halo vertices, link
     endpoints, surface quads, Draw Mode's grid inversion) is computed in
     scene coordinates, so re-basing the scene would put them in a different
     space than the maths that writes them. Moving the rig instead left
     buildScene, picking and every overlay untouched.
     - `R_x(+90°)` maps WebXR's Y-up reference space onto GlyphViz's Z-up
       world. Because three composes the headset pose through the rig's world
       matrix, the rig's SCALE scales IPD and head motion by the same factor —
       so `scale` reads as "how big the world is" rather than as a cheat, with
       honest stereo depth at any size. It is WORLD UNITS PER METRE, the
       reciprocal of the desktop's `--scale` (`auto_scale_for_scene` returns
       `target / extent` and applies it to the world); same picture, inverse
       number, and worth knowing before someone "fixes" one to match.
     - Every gesture ends in one solve, `solveNav(worldPoint, xrPoint, …)` —
       "hold this world point still under this hand/head while something else
       changes". That is what makes turning pivot about the HEAD and a pinch
       scale about the point between the hands.
   - CONTROLS, the spike's exactly: left stick flies at 3 m/s relative to
     where the head is really looking (plane-locked, so looking down while
     flying forward never sinks you), right stick turns at 90°/s and rises,
     squeeze grabs the world and drags it, trigger picks, A/X re-fits, B/Y
     plays/pauses Channels. Flight is suppressed while a hand grabs, as there.
     - Web ADDITIONS: a thumbstick dead zone measured from its edge (OpenXR
       had already deadzoned the sticks before `ControllerNav` saw them; a raw
       WebXR gamepad axis has not), and the TWO-HANDED pinch — scale and yaw
       about the midpoint — because it is the gesture every headset user
       reaches for first and it is how you get from the 20 m default placement
       to a tabletop model and back without a menu.
     - DIVERGENCE: turning pivots about the head. The desktop accumulates
       `nav_yaw` and rotates the world about the tracking origin, which swings
       a viewer standing away from it sideways through the scene. Strictly
       better and it costs one solve.
     - Placement defaults are the spike's CLI: 20 m target size, 15 m in
       front, 0.35 m below eye level, re-derived from the live head pose so
       the scene lands in front of the viewer whichever way they are facing.
   - PICKING is the app's own `pickNodeId(raycaster, root)` with a controller
     ray instead of a mouse ray — links, grid occlusion and animated-hide all
     behave as they do with a mouse, because nothing about that path had to
     change. `raycaster.camera` is handed the scene camera so LinkPicker's
     pick width keeps the same ANGULAR size it has on the desktop.
   - LABELS: the tag overlay is a 2D canvas stacked over the WebGL one, so a
     session never sees it. `src/render/xrLabel.ts` draws the SELECTED node's
     label as a billboard instead, a port of the spike's `text_billboard.py`
     (64px Arial, the dark shadow at +2px, pale yellow face, a 0.6 m quad, and
     its single-entry cache — the texture is redrawn only when the text
     changes). Unconditional, as the spike's is: the scene-wide Show Tag
     Labels toggle lives on a T key and a checkbox, neither of which a headset
     can reach.
     - The trap, found by looking at the picture rather than the numbers: a
       Sprite takes its SIZE from the model matrix but offsets it in EYE
       space, so under a scaled camera rig the quad is measured in metres
       while its position stays in world units. Multiplying the rig scale into
       both drew a label an entire scene wide — and every scene-graph
       assertion about it passed.
   - THE HEAD POSE comes off `renderer.xr.getCamera()`, never the app camera.
     Both carry the viewer pose in XR space during a session, but the app
     camera is also written by ordinary desktop code — `fitCameraTo` reframes
     it on every scene load — and a fit computed from one of those writes put
     the scene 191 m away at a desktop framing's angle. Found by driving it;
     no unit test would have. `rememberDesktopCamera()` then takes that
     framing as the pose to restore on exit, since the headset is about to
     overwrite the camera it was written into.
   - INTERLOCKS: cross-eye stereo switches off (the compositor owns that job
     now), OrbitControls and Camera Mode stand aside, Follow Selected is
     inert, the transform gizmo detaches (TransformControls drags from a
     screen-space pointer, and a headset has none) while the armed mode stays
     sticky per the 6h rule, Save PNG says it is unavailable rather than
     saving the mirror, and fat-line pixel widths come from the XR
     framebuffer's per-eye half rather than the page's size. Exiting restores
     the camera pose, near/far and parent.
   - NO PARITY HARNESS, deliberately: the spike has no authoritative maths to
     diff against — what guarantees the headset shows the RIGHT scene is the
     draw-matrix and placement parity already in place. `xrNav.test.ts` (22
     tests) pins the rig maths; the rest is driven.
   - DRIVEN IN CHROME against an emulated Quest 3 (the `iwer` package's
     runtime, installed into the page before the app's support probe runs):
     34 measured checks over two scenes. Entry places the scene 15.01 m ahead;
     flight measures 3.0 m/s and holds altitude to 0; turning measures 92°/s
     and moves the world under the head by 3e-14 units; a grab pins its point
     to 2e-16 m; hands apart halve the units-per-metre; a trigger ray picks
     the node aimed at, with the app's ray matching the intended one to 1e-13;
     a miss clears the selection; a scene loaded mid-session re-frames itself;
     Channels play from B/Y and animate nodes in the headset; every interlock
     and the whole exit path. Console clean. (The one pre-existing warning in
     that console, `THREE.Material: parameter 'map' has value of undefined`
     from glyphGeometry's untextured materials, is not XR's and was left
     alone.)
   - PERFORMANCE is the real ceiling and is untested on device: this app draws
     roughly one call per glyph, and a Quest renders two eyes at 72–90 Hz. v1
     is honest for scenes in the low thousands of nodes (SineWave 231,
     Topology 109, Global_Terrorism 2,470); past that the `\` draw limit is
     the lever, and InstancedMesh batching — which would help the desktop web
     app just as much — is a separate project, not something immersive mode
     should drag in unannounced.
   - **v1 CONFIRMED ON HARDWARE** by Jeff on his Quest 3, 2026-08-14: "works
     like a champ."
   - **P2, the wrist control panel** (shipped 2026-08-14, immediately after):
     a quad on the LEFT grip that the other hand points at, standing in for
     the DOM HUD a session cannot see. `src/ui/xrPanelModel.ts` is the layout
     and hit-testing (pure, no THREE and no DOM); `src/render/xrPanel.ts`
     paints it and turns ray hits into actions.
     - Why a wrist panel: always findable (look at your hand), never occluding
       the scene being inspected, and needing no summon gesture. It is
       BILLBOARDED to the head rather than rigidly mounted, since half the
       poses a wrist turns through would otherwise read it edge-on. Left X
       puts it away and brings it back — the screengrab-chrome rule of item 6h,
       in a headset.
     - What earns a place: things you cannot otherwise do from inside the
       headset — the Channels transport (stop/play/scrub), the draw limit (the
       frame-rate lever, `\`'s own factors so the panel and the key agree), the
       built-in scene walk, and two framings (Room view at the spike's 20 m,
       Tabletop at 1.5 m, each placed at a distance proportional to its size).
       Plus the selection readout, which is the inspector reduced to a glance.
       Everything that EDITS node data stays out: that is the authoring phase,
       and a wrist panel is a poor place to discover it.
     - A scene with no Channels shows no transport at all, rather than an inert
       Play button — there is no tooltip in a headset to explain a dead
       control.
     - The panel takes the trigger when the ray is on it and the scene never
       sees that press (`XrPointerTarget` in xrSession.ts): it is to the ray
       what the DOM HUD is to the mouse. The pointing hand's laser also stops
       AT the panel, since a beam that carries on through the button reads as
       missing it.
     - Repaints only when a signature of what it displays changes — the
       billboard label's single-entry cache rule, generalised.
     - A Mesh, not a Sprite: a mesh's vertices go through the model-view matrix
       so its size lands in metres exactly as its position does. The Sprite
       trap noted above is the reason that is worth stating.
     - Three faults the PICTURE caught after 28 measured checks had passed
       (the dumped panel texture is the only way to judge this without a
       headset): the Fit row sat flush with the panel's rounded edge and drew
       clipped; the header and the scene row printed the same scene name twice;
       and the transport used ▶/❙❙/■ text glyphs, whose font coverage a headset
       browser cannot be assumed to have — they are canvas PATHS now, and the
       scene stepper took ‹ › so a solid triangle never appears twice meaning
       two different things.
   - **P3, the wrist PROPERTIES panel** (shipped 2026-08-16, Jeff's request):
     editing a selected node's own parameters from inside the headset. A second
     quad, on the RIGHT wrist, pointed at with the left hand — the inspector
     (`ui/inspector.ts`) re-expressed for a device with no keyboard and no
     mouse. `src/ui/xrPropertiesModel.ts` is the layout, values and hit-testing
     (pure); `src/render/xrProperties.ts` paints it and turns ray hits into
     edits.
     - Jeff asked for the design to be settled before it was built, being new
       to VR interaction. Four decisions, all taken 2026-08-16:
       - PLACEMENT: right wrist, not a page on the existing left panel and not
         a summoned floating slab. A wrist panel is always findable and never
         lost, and putting the two on OPPOSITE wrists means each is pointed at
         with the hand that is not wearing it — neither hand has to both hold a
         panel and drive it. What a wrist costs is that your arm must be up to
         read it, fine for a glance at the transport and tiring for a
         ten-minute edit, so the panel PINS: one button unclips it onto a slab
         parked in front of you and clips it back. Same layout at both ends,
         1.7× larger when pinned — the win is resting your arm and having both
         hands free, not more rows.
       - BUTTON: **A** shows and hides it, mirroring X on the left, so each
         hand's face button drives the panel on that wrist. A's old job
         (re-fit) was already duplicated by the control panel's Room view
         button, so nothing lost a home. Worth recording what is NOT available:
         the left Menu and right Meta buttons never reach the page at all — the
         runtime keeps both — so the real budget is trigger, squeeze, stick,
         stick-CLICK (still unused on both hands) and two face buttons per hand.
       - SCOPE: everything except `text` and `link`. The reason recorded here
         at the time — that a headset browser cannot raise a keyboard into a
         running immersive session — **was wrong**, corrected 2026-08-16 when
         Jeff pointed out that he can already point and click the Quest's own
         keyboard. See the keyboard entry in the XR pending list below: the
         panel shows the tag text so you know which node you have, and typing
         it is an open item rather than a platform limit.
       - NOT direct grab-to-move: that stays with the pending authoring-
         gestures phase, which has to settle the topology inverse in VR, undo,
         and how a glyph grab shares the squeeze with grabbing the WORLD.
     - Three widget shapes, because none of the DOM controls survive the trip:
       a STEPPER `‹ value ›` for every enum-ish field, a TOGGLE for hide /
       show_text, and a NUDGE (`− value +`, plus press-and-drag on the value to
       SCRUB) for the vectors. The steppers already HAVE desktop cycle
       semantics — J/O for topo/geometry, =/− and Alt+=/Alt+− for the palette
       pair — so a VR stepper row is literally that key with a face on it, and
       every action routes through the same `cycleTargets` subset and the same
       `rebuildScene(false)` the DOM panels use, so the two inspectors cannot
       drift.
     - PAGES (Shape / Move / Look), not one long list: the quad is the size of
       a large phone and five rows is what fits at a row height a ray can
       reliably hit. ONE axis chip and ONE step chip serve all three vector
       rows — nine live number fields on a 22 cm quad is not something a laser
       can hit. The step ladder is 0.01 … 100 for all three vectors rather than
       a natural one each: the chip has to read at a glance, and a user wanting
       5° is better served pressing + five times than learning that rotate's
       ladder differs from translate's.
     - The SCRUB is what makes a value with no end stops draggable, and it is
       quantised to the step (40 notches across the panel width) so a dragged
       value walks a lattice of round numbers rather than landing wherever the
       hand stopped. It mutates the node and rewrites that node's own frame in
       place — `applyFrameTransform` + `applyGlyphDrawScale`, the gizmo drag's
       own path — and commits ONCE on release. A `rebuildScene` per frame at 90
       Hz is not affordable at any real scene's size, and this is the same
       trade a mouse gizmo drag already makes. Targeted rather than
       `refreshDrawScales`, which is the whole-scene version and right only for
       the Global Scale slider; children ride along free, being nested under
       their parent's Object3D. Measured in the drive: the node's Object3D
       identity is unchanged across every frame of a scrub and replaced on
       release.
     - `render/xrSurface.ts` was FACTORED OUT of xrPanel.ts rather than copied
       into the new file — the quad, canvas texture, billboarding, ray hit
       test, hover/press/drag/release and the roundRect/ellipsis painters — so
       the app has one panel behaviour, the same call ui/floatWindow.ts and
       ui/glyphPreview.ts made when the Composer joined the Generator. The pure
       hit-test primitives went to `ui/xrWidget.ts`, which both panel models
       read.
     - Two changes this made to the SHIPPED control panel, both deliberate:
       - Panels are no longer DEPTH TESTED (`depthTest`/`depthWrite` off,
         `renderOrder` puts them last). Flying INSIDE a scene is the whole
         point of immersive mode and exactly when you reach for the Properties
         panel, and it puts glyphs closer than your own wrist — a depth-tested
         panel then draws in pieces. A control surface must never be sliced by
         the scene it controls.
       - `setPointerTarget` became `setPointerTargets`, NEAREST hit wins. Every
         target is asked rather than stopping at the first: `hover` is also
         what records which widget is lit, so asking only until the first hit
         would leave a stale highlight on the panel the ray had just left.
     - The pinned slab is a child of the RIG, not of the head and not of the
       world: parked in rig space it stays where you left it as you look around
       (a head-locked panel is nauseating) while still travelling with you as
       you fly, and it is not rescaled by a two-handed pinch the way a
       world-anchored one would be. Its forward direction has PITCH DROPPED, so
       a panel pinned while you are looking at your feet lands in front of you
       rather than on the floor. Leaving the session unpins it — a slab parked
       in the last session's rig space would be waiting in mid-air at the start
       of the next one.
     - `xrPropertiesModel.test.ts` pins the layout invariants the control panel
       learned the hard way (everything inside the quad, nothing overlapping,
       a bottom margin so no widget draws clipped, every widget at least 0.1 of
       the quad so a ray can hit it) plus the page contents, the greying of the
       types J and O never touch, the 1-based facet, the name-without-id rule,
       and the scrub quantisation.
     - Driven in Chrome against the emulated Quest 3, 54 measured checks: both
       panels on opposite grips, the ray shortening to the panel it touches, a
       panel press never disturbing the selection behind it, every page's
       widgets producing the right data change (topo/geometry stepping on the
       real cycle rules, the palette index resolving into a literal colour,
       alpha clamping, both flags), the axis and step chips re-aiming the same
       three rows, a quarter-width scrub measuring exactly 10 notches of the
       step with no rebuild in between, A and X toggling their own panel and
       only their own, the pin round trip (re-parent, 1.7×, parked 0.776 m from
       the head = √(0.75² + 0.2²), no drift when the head turns, and back), and
       a clean console.
       - The dumped panel TEXTURE is what caught the one real defect, after all
         54 numeric checks had passed: the Move page's step chip was a bare
         `− 10 +` with nothing saying what the 10 was, and a headset has no
         tooltip. It is captioned now. Same lesson as the control panel's own
         three picture-only faults — an in-headset surface has to be looked at.
   - **P4, grab-to-move + the Select page** (shipped 2026-08-16, Jeff's
     request, immediately after P3). He asked for the Selection controls and
     offered to take direct grab-to-move first, on the assumption that a
     multi-selection could not otherwise be moved as a group. **That premise
     was wrong and worth recording:** the Properties panel's nudge and scrub
     have looped over `selectedNodes()` since P3, so group move/rotate/scale
     already worked. Nothing was gated on the grab; it was built because it is
     the better gesture, not because anything needed it.
     - GRAB-TO-MOVE. Hold the trigger on an **already-selected** glyph and it
       rides the ray; the whole selection comes with it. Trigger on an
       unselected glyph still just selects, so no shipped gesture changed
       meaning — "click to select, click-drag to move", which is also the
       desktop's model, its gizmo needing a selection first. Chosen over
       squeeze (agreed 2026-08-16): squeeze is the primary LOCOMOTION gesture,
       and making it conditional on the ray crossing a selected node would
       silently turn a world-grab into an object drag.
       - The ray is a FISHING ROD, not a hand: the grabbed point keeps its
         distance along the ray, so the same gesture works at arm's length and
         across a 20 m scene, and turning the wrist swings it. Translation
         only — the hand's rotation is deliberately not applied, since a free
         6-DoF grab makes an accidental tumble far too easy and rotate is one
         page away.
       - It invents no second way to write CSV. `invertFrameTranslate` was
         factored OUT of the mouse gizmo's `objectChange` (with
         `translateDragContext` beside it) so the frame-moves-then-read-it-back
         rule has exactly one statement; the grab moves `frame.position` and
         calls it, then `applyDragToFollowers(node, 'translate')` pushes the
         primary's per-field change onto the rest in each node's OWN topology
         coordinates — the desktop's `_apply_axis_deltas`, which is what makes
         a group drag round-trip to CSV. Measured: two nodes 2.7 units apart
         took byte-identical translate deltas.
       - No `pickDominantField` pinning, unlike the mouse. A gizmo handle
         constrains motion to one axis and the pinning keeps the other two from
         drifting; a grabbed hand moves freely in all three and every axis it
         moves is meant.
       - A **2 cm threshold of real hand travel** (metres, so it means the same
         at any world scale) separates a drag from a click, and a press that
         never crosses it falls back to the ordinary select — which is what
         keeps "click a node inside a multi-selection to reduce the selection
         to it" working. Measured both ways.
       - Runs in place at frame rate and commits ONCE on release, the scrub's
         trade and the mouse gizmo's. A squeeze on the same hand CANCELS the
         grab rather than fighting it: that hand is now dragging the world, and
         a glyph following both would move twice.
     - THE SELECT PAGE, a fourth tab on the right wrist (Select / Shape / Move
       / Look). Chosen over a third floating surface and over tabs on the left
       panel: the right wrist already IS "the selection", and this is the
       choosing half beside the editing half, which is also the order you use
       them in. Costs no new input and no new surface.
       - Every rule is `gv/selectionOps.ts`'s, unchanged — this is a face on
         the desktop's Select By and Visibility groups, calling the same
         functions the DOM Selection panel's buttons do. Two steppers (criterion
         / value), an apply button whose label follows the **add** checkbox,
         then All / None / Invert and Hide / Show all / Only.
       - It is the ONE page that renders with nothing selected, which is the
         point of it; only the other three fall back to the empty state, and
         that state now points at this tab rather than being a dead end.
       - Hide and Only grey out with no selection; **Show all never does** — it
         is the way OUT of a hide, and has to stay reachable from a state where
         everything visible is hidden and nothing is selected.
       - `criterionValues` is O(nodes) and this runs on the animation loop, so
         the host scans for ONE criterion — the panel exposes which through
         `xrProperties.criterion`, read before `update` — memoised on an epoch
         `rebuildScene` bumps, since geometry and topology are exactly what the
         Shape steppers edit. The value list is therefore one frame behind a
         criterion change, the same staleness rule the rest of the app runs on,
         and the index resets to 0 on that change because it belonged to the
         old list.
     - Driven in Chrome against the emulated Quest 3, **80 measured checks**
       (the 54 from P3 plus 26): Select All taking all 109 bulk-selectable rows,
       Invert emptying it, Select matching yielding exactly one branch level and
       exactly one geometry, **Add unioning 18 + 91 = 109 across two levels**
       where a replace would have given 91, Only hiding precisely the
       complement, and the grab moving a 109-node selection with identical
       deltas, no rebuild mid-drag, and both the click and the
       unselected-glyph cases leaving the data untouched.
       - The picture caught the defect again, after all 80 numeric checks
         passed: the **add checkbox was an unlabelled empty box**. Captioned
         now. That is twice in two sessions — an in-headset surface has to be
         looked at, and the panel-texture dump is the only way to do it.
   - **P5, grab-to-turn/size + add-select** (shipped 2026-08-16, Jeff's request
     — the two things P4 left open, taken the same day).
     - GRAB MODES. The grab IS the transform gizmo in a headset, so it carries
       the gizmo's own three sticky modes rather than inventing three gestures:
       a **Move / Turn / Size chip** on the Properties panel's Move page, under
       the three vector rows it writes. Read ONCE at `beginXrGrab`, so a mode
       change can never rewrite a different field from a drag already in flight.
       - TURN takes the hand's own rotation since the grab began. The delta is a
         WORLD rotation and the frame's is parent-local, so it is conjugated —
         `P⁻¹·R·P` — onto the orientation the frame started with, and read back
         through the gizmo's own rotate branch (strip `frameBaseRotation`, which
         is constant through a turn since it depends only on translate, then
         `invertLocalRotation` in whichever convention the node declares). A
         twist needs its own threshold, an ANGLE, because a roll in place moves
         the hand barely at all.
       - SIZE is hand travel along the RAY: the one axis the fishing rod leaves
         unused, since move mode locks the handle distance. Exponential — 25 cm
         doubles, 25 cm back halves — so the gesture is exactly reversible and a
         size can always be walked back by retracing it. Uniform on all three
         axes: one hand cannot say "taller but not wider", and the per-axis rows
         above are how you say that. Followers take a RATIO, not a delta
         (`_apply_axis_deltas`), which is what preserves a group's proportions.
       - Measured: 0.3 → 0.6 on a 25 cm push and → 0.15 on the pull back, all
         three axes to 1e-9; a 12°-per-step wrist roll stepping the node ~11.2°
         per sample; and each mode leaving the other two fields untouched.
     - ADD-SELECT on the **right thumbstick click, held as a modifier** — this
       app's Ctrl, and the first claim on either of the two free inputs. Trigger
       toggles one node's membership instead of replacing the selection, and the
       modifier SUPPRESSES the grab outright: the gesture is about the selection,
       not about moving what is in it. A modifier press on empty space leaves the
       selection alone, exactly as Ctrl+click does with a mouse. One modifier for
       both hands, taken off the right stick so the comfortable chord is
       cross-handed (right thumb, left index) while same-handed still works.
     - THE BUG THE DRIVE CAUGHT, and nothing else would have:
       `setFromRotationMatrix(ray.matrixWorld)` needs an UNSCALED rotation
       matrix, and the XR rig's world matrix carries the world-units-per-metre
       scale (~150 on a typical fit). The extracted quaternion was meaningless,
       so `angleTo` between two frames of a real wrist twist read ~0 and the
       turn threshold never opened — the node simply never rotated, with a clean
       console and every scene-graph assertion passing. `getWorldQuaternion`
       decomposes, which divides the scale back out. Anything reading an
       ORIENTATION off an object under the XR rig must decompose, never extract.
     - Harness lesson recorded with it: the drive's `pointAt` helper used to
       no-op when a widget was missing, which sent the following press to the
       SCENE and cleared the selection, making every later check nonsense. It
       now throws, and asserts the hover actually landed before pressing.
     - Driven in Chrome, **100 measured checks** (P3's 54 + P4's 26 + 20).
   - **TEXT ENTRY — open, and NOT blocked by the platform** (raised by Jeff
     2026-08-16, deferred by him the same day: "the VR implementation is so new
     and currently I am the only one testing it, so there is no urgency").
     - P3 recorded that `text`/`link` were read-only because a headset browser
       cannot raise a keyboard in a session. That is FALSE and was corrected on
       the spot. `XRSession.isSystemKeyboardSupported` is a standard property —
       `node_modules/@types/webxr/index.d.ts` carries it on `XRSession`, and
       iwer's `metaQuest3` profile declares it `true`. Focusing a real DOM input
       during a session lets the browser raise the SYSTEM keyboard as a
       compositor overlay: the same one the wearer already points at and clicks,
       drawn by the runtime, delivering ordinary `input`/`keydown` events. The
       page draws nothing.
     - The mistake to avoid repeating: "the DOM HUD is invisible in a session,
       therefore DOM text entry is unreachable" — true of the panel, false in
       general, and the system keyboard is precisely the exception. Do not
       generalise from the HUD's invisibility again.
     - Two things the EMULATOR cannot settle, because it reports the flag and
       implements nothing behind it — both need Jeff's Quest:
       - whether the Quest Browser raises the keyboard for a hidden/offscreen
         focused input, or insists on a visible one (if visible, a 1px focused
         input is the fix, not a redesign);
       - where the in-progress string is echoed, since the DOM input cannot be
         seen — the panel would have to draw it as it is typed.
     - Shape when it happens: a "type…" affordance on the row, focusing a
       hidden input, the panel echoing the string, and a clean fallback when
       `isSystemKeyboardSupported` is false. Do NOT start it unprompted.
   - **P6, a pointer you can see and a controller that shows its input**
     (shipped 2026-08-27, Jeff's report on walking the Armillary World: the
     immersive experience was excellent but **the controls need improvement**).
     Asked which, he named three things, and the first two are this item — the
     third (a curved dashboard with a mode COLUMN) is Phase C below.
     - **THE RAY WAS BEHIND THE PANEL, by construction.** You could not see
       where you were pointing; the only feedback was a button lighting up. Two
       decisions met badly: panels draw with `depthTest: false` and
       `renderOrder = 5` (P3's call, and the right one — a depth-tested panel is
       sliced into pieces when you fly inside a scene, which is exactly when you
       reach for it), while the ray was a plain `Line` at renderOrder 0. And the
       ray is SHORTENED to its hit distance, so it terminated precisely at the
       surface that then painted over it: the last centimetre, the only part
       that says where you are aiming, was the guaranteed-invisible one.
       - `src/render/xrPointer.ts` is both halves. The BEAM is a tapered tube
         that fades in from the hand (a 4-component vertex colour, so the taper
         survives `scale.z`), and while it is on a panel it takes that panel's
         own depth treatment one order LATER. Off a panel it goes back to
         ordinary depth testing — a laser aimed into the scene has no business
         streaking over the glyphs it is aimed at, so the mode is per frame, one
         boolean.
       - The RETICLE is the piece that actually answers the complaint: a ring
         lying on the surface at the hit point, in the hand's colour. Before
         this, the gap BETWEEN two widgets was indistinguishable from missing
         the panel altogether. Four states — on the surface (dim, no dot), on a
         live widget (bright, dot, 1.2×), on a disabled one (grey, no dot: inert
         is now visible BEFORE the press rather than only after nothing
         happens), and pressed (0.78×, accent). `disabled` moved onto
         `XrWidgetBase` for that, since it is now read by the pointer as well as
         the painter.
       - `XrPointerTarget.hover` therefore returns an `XrPointerHit` (distance,
         world point, normal, what is under it) instead of a bare distance. The
         normal comes off the MESH's own orientation, not the intersection's
         face normal — a curved or scaled quad still wants the face it is lying
         on, which is what keeps this working when Phase C lands.
       - The reticle hangs off the RIG, not the world and not the ray: the rig's
         local units are perceived metres (xrNav.ts), so its dimensions mean what
         they say at any world scale.
     - **THE CONTROLLER WAS A WIREFRAME BOX** — P1's placeholder, 4 × 4 × 9 cm,
       saying nothing about what the hardware was doing. Jeff asked for the
       Unity-style feedback he had seen: visible thumbstick movement.
       `src/render/xrControllerModel.ts` draws a real one, and
       `src/render/xrControllerPose.ts` is the pure input→part-transform half
       (no THREE, no DOM, tested in plain node like xrNav.ts).
       - Thumbstick TILTS (17° at full throw, gated to the unit circle so a
         diagonal cannot out-tip a full axis push), and depresses on a stick
         click; trigger sweeps with the analog value; grip pad slides toward the
         palm; face buttons sink. Each has a LAMP that lights at the threshold
         the app actually acts on — past `STICK_DEADZONE`, past
         `TRIGGER_THRESHOLD`, past `GRAB_ON_THRESHOLD` — so the model teaches
         the dead zone instead of hiding it. The tilt itself shows the RAW
         stick, deliberately: inside the dead zone the stick still moves on
         screen, which is the one state where the app otherwise looks broken.
       - BUILT rather than loaded, agreed with Jeff. three ships
         `XRControllerModelFactory`, which fetches the official per-device glTF
         and animates it off the gamepad — the Unity behaviour exactly, and
         `motion-controllers.module.js` + `GLTFLoader` already ship with three,
         so it was a real option. Three reasons went the other way: this app
         renders with `outputColorSpace = LinearSRGBColorSpace` and
         `NoToneMapping` to match fixed-function GL (lighting.ts), under which a
         PBR asset with metalness and no environment map comes out dull; the
         assets are third-party bytes from a CDN at run time, or a few hundred
         KB vendored; and a stock controller can only show the HARDWARE. This
         one also shows GlyphViz — a billboarded badge on the RIGHT controller
         carries the armed grab mode and flags the add-select modifier, state
         with nowhere else to live in a headset.
       - Body greys are LIGHTER than a real Touch controller's black plastic, on
         purpose: the app shades at `albedo · (0.5 + max(N·L, 0))` and writes
         straight to the framebuffer, so 0.16 albedo lands at 0.16–0.24 —
         invisible against GlyphViz's near-black default background. Found by
         looking at a rendered frame; every scene-graph assertion passed with
         the dark values.
     - Driven in Chrome against the emulated Quest 3, 35 measured checks: the
       beam's render order against the panel's, its depth mode in both states,
       its length against the real shot (0.3937 m vs 0.3922 m), the reticle 1.50
       mm off the face and inside the quad at the uv the ray actually hit, all
       four of its states, and every moving part of the model with its lamp
       threshold — the stick at −17.2° pushed forward and still moving (unlit)
       at 0.07 deflection, the trigger at 0.35 and 1.0, the grip pad travelling
       toward the palm, the two controllers mirrored and differently coloured,
       and the badge facing the viewer to dot 1.0.
       - Harness quirk worth keeping: **iwer's emulated controller points along
         +Z, not −Z**, so an aim helper must `lookAt` the MIRRORED point.
         Aiming at the target directly measures dot = −1 and every check
         downstream is nonsense.
       - The PICTURES caught two faults after the numbers passed, which is now
         four sessions running: the controller body was invisible against a dark
         scene (above), and the badge was rigidly mounted to the wrist, so half
         of a hand's poses showed it edge-on — it billboards now, like the
         panels.
   - **P7, the curved dashboard** (shipped 2026-08-27, the third thing Jeff
     named, and confirmed on hardware between P6 and this: "I tested the dist
     and it works great"). A top row of four mode tabs had already filled the
     panel's width by construction — `TAB_W = (1 − PAD·5) / 4`, so a fifth mode
     could only come out of the width of the other four — and his ask was for
     room to grow: "there will be additional features to be added and we need a
     larger panel-like surface."
     - **THE CURVE** is `src/render/xrCurvedPanel.ts`: a cylindrical shell that
       wraps its edges TOWARD the viewer. It is a drop-in for one reason worth
       stating plainly — `XrSurface.hover` reads `hit.uv` and every widget is in
       normalised coordinates (ui/xrWidget.ts), so ANY geometry carrying
       PlaneGeometry's UV parameterisation drives the existing layouts, painters
       and hit tests unchanged. Nothing above it learned about curvature.
       - Curvature is a RATIO of the panel's own width, not a radius in metres,
         so the shape is scale-invariant: the pinned slab wraps through the same
         angle as the wrist-docked one and reads as the same object made bigger.
         `PANEL_CURVE = 0.7` puts the radius at 1.43 × width, which approximates
         a cylinder centred on the EYE in both states — pinned, 0.57 m across at
         0.75 m (radius 0.81); docked, 0.30 m at roughly 0.35 m (radius 0.43).
         Measured: the corners sit 0.779 m from the head against the middle's
         0.776 m.
       - The panel's width is its ARC LENGTH, not its footprint — the chord is
         necessarily narrower (2R·sin(θ/2) against R·θ). Pinned by a test,
         because "the panel came out 1% narrow" is exactly the kind of thing
         someone later corrects by scaling the geometry and quietly breaking
         every layout on it.
       - `XrSurface.hover` now takes its normal from the INTERSECTION (three
         interpolates it from the vertex normals and flips it toward the ray)
         rather than from the mesh's orientation, so the P6 reticle lies flat on
         the surface at the point it is touching. Measured at the panel's edge:
         dot 1.0 against the true surface normal, 0.9635 against the plane the
         panel would have been. `surfacePoint(u, v)` is the inverse — the world
         point at a normalised coordinate, curvature included.
       - Both wrist panels are curved, so the two match; only the properties
         panel's LAYOUT changed.
     - **THE MODE COLUMN** runs down the LEFT edge (Jeff is left-handed and will
       reach for it with that hand). A column is bounded by HEIGHT where a row
       was bounded by width, and the panel has six row slots for four modes —
       which is what makes Draw Mode a line in `PAGES` rather than a redesign.
       The open mode is marked by a bar down its INSIDE edge, not the tab row's
       underline, which in a column reads as a divider between two entries.
     - **THE CONTENT TRANSFORM** (`cx` / `cw` / `crect`) is the part that makes
       the panel keep scaling rather than scale once: every control is stated in
       CONTENT-relative coordinates and mapped through it, so the column can be
       widened, narrowed or moved without re-tuning a single control column.
     - The quad's size in METRES (`PANEL_W_M` / `PANEL_H_M`, 0.30 × 0.215) moved
       INTO the model, because the layout is what decides whether a control is
       big enough to hit and that question is only answerable in centimetres.
       The layout test's hittable-size invariant is now physical — 2.4 cm, about
       3.4° at a 40 cm reading distance — where it had been a normalised 0.1 that
       silently changed meaning the moment the panel's own dimensions did, which
       is precisely what this change did to it. `PINNED_SCALE` 1.7 → 1.9, so the
       unclipped dashboard is 57 cm across.
     - Driven in Chrome, 21 measured checks: the shell's 2.6 cm of wrap over
       29.4 cm, its edges bowing toward the viewer, the ray still finding every
       widget on the curved face, the reticle on the surface rather than the
       plane, the column's single x and four descending y, the column clear of
       the content, a press from the column switching pages, Select ▸ All
       reaching 109 nodes through the new layout, the pin round trip, and the
       pinned dashboard still taking the ray at 0.78 m.
       - The PICTURES caught what the numbers could not, for the fifth session
         running: the subtitle sat exactly on the mode column's first button and
         read as a caption FOR it. Header spacing and the row lattice were
         retuned around it (`ROW_TOP` 0.205, subtitle at 0.14).
       - One row of the six is deliberately left empty on every page. That is the
         headroom the change exists to create, not an oversight.
   - **P8, drawing in VR** (shipped 2026-08-27, Jeff asked for it by name —
     "that would be amazing" — after confirming P7 in the headset). Draw Mode
     (roadmap 6u) reached with a controller: point at a flat World Grid, hold
     the trigger, and objects are stamped along the stroke.
     - It is the SAME mode, not a second one — the same `drawMode` flag the D
       key arms, the same `gridHit` / `placeStamp` / `shouldStamp`, the same
       brushes and the same Draw Z. That was possible because the groundwork was
       already right: `gridHit` took a RAY (never a mouse position) and the two
       drawMode functions are pure. A Draw page and a gesture is the whole port.
     - **THE GESTURE rides the trigger's existing claim mechanism** — `onPick`
       returns true, then `onDragRay`/`onDragEnd` — so xrSession's button logic
       needed no change at all. Draw claims the trigger exactly as it claims the
       left button with a mouse: plain click-select is what a stroke replaces,
       while the add-select modifier still selects (the desktop's "Ctrl+click
       still works" rule, in the one chord this app has for Ctrl) and is the
       documented way to grab a bad stroke and Delete it. Squeeze locomotion,
       the wrist panels and both sticks are untouched.
     - **SPACING is in the GRID's own child coordinates, not pixels of travel**,
       and it is the one draw setting NOT shared with the DOM panel — the two
       measure different things. On screen, pixels tie the brush to a zoom the
       person drawing can see. In a headset you walk about while you draw and
       cannot judge your own distance to the plane, so an angular spacing would
       scatter stamps when you happened to be standing back and crowd them when
       you leaned in: the same stroke coming out differently for a reason
       invisible to the person making it. Grid units make the brush a property
       of the DRAWING. Default 5.0, which is the New Object placement step.
     - **THE CURSOR is the P6 reticle**, handed a synthetic `XrPointerHit` at
       the grid plane through a new `XrCallbacks.aimHit` — so the beam shortens
       to the plane and the ring lies flat on it with no new drawing code. Only
       Draw Mode answers that callback, so a scene with nothing to report pays
       nothing (and a continuous raycast against Event_Cloud's 209k glyphs never
       happens — this one is a matrix inverse, not a traversal).
       - Which exposed a fault in the P6 reticle itself, found by looking at a
         rendered frame: it was a FIXED 8 mm ring, sized for a panel at 35 cm,
         and a grid you are drawing on is fifteen metres away — where 8 mm is
         0.06° and simply invisible. It holds a constant ANGULAR size now.
         Measured: 576 mm at 15.8 m, against the 16 mm a fixed one would draw.
         Every numeric check about the cursor had passed, because the cursor was
         in exactly the right place and too small to see.
     - The Draw page is the fifth mode-column entry and fills all six rows,
       which is what the sixth slot was left for in P7: a toggle named by what
       pressing it does, a brush stepper, and Draw Z / spacing / spin / size.
       It renders with nothing selected, like Select, and carries its own report
       in the subtitle — the status line is DOM and a headset never sees it.
     - Driven in Chrome, 27 measured checks: the cursor 1.5 mm from the aimed
       grid point and 576 mm across at 15.8 m; a stamp landing at (−30, 5) for
       an aim at (−30, 5); a 120-unit stroke giving 6 stamps at spacing 20 and
       16 at spacing 5, with no consecutive pair closer than the spacing IN GRID
       UNITS; every stamp having a frame and a visible glyph (a node with no
       frame is a row in a CSV, not a drawing); Draw Z reaching both the stamp
       and the DOM panel's own input; the add-select modifier still selecting;
       the wrist panel still taking presses; and the stick still flying.
       - Harness lesson worth keeping: the first version TELEPORTED the aiming
         hand to just above its target, which is not a pose anybody can adopt
         and made every distance-dependent reading meaningless — the reticle
         measured 0.7 m from a grid the head was fifteen metres from, which is
         what nearly hid the sizing fault above. Aim from where a hand actually
         is, about 25 cm in front of the head.
     - **Bug fixed the same day, from Jeff's device report**: a stroke's objects
       appeared only when the trigger was RELEASED, where the mouse version
       draws them as they go. `requestDrawRebuild` coalesced its rebuild onto
       `window.requestAnimationFrame` — and the page's own rAF stops firing
       while an immersive session presents, frame callbacks coming from
       `XRSession.requestAnimationFrame` instead. So the rebuild sat queued
       until `finishDrawStroke` cancelled it and rebuilt synchronously on
       release. It is coalesced onto THIS APP'S animation loop now (a flag, and
       `flushDrawRebuild` at the top of `setAnimationLoop`), which three drives
       from the session while presenting and from window rAF otherwise — so one
       mechanism is correct in both modes with no branch, and the mouse path
       keeps its once-per-frame coalescing unchanged.
       - **The emulator cannot reproduce this, and the reason is worth keeping**:
         iwer implements the emulated session's rAF ON TOP OF window rAF, so
         stubbing the global to imitate a headset stops the app's animation loop
         altogether — reproducing something worse than the device rather than
         the device. Measured: with the stub in place the controller ray stopped
         updating entirely. A drive can still check the property the fix
         establishes (the draw path schedules nothing through window rAF —
         verified by recording a stack for every registration: 0 of 59 during a
         stroke) and that stamps have frames at every point along one
         (2/2 → 3/3 → 4/4 → 5/5 with the trigger still held). The SYMPTOM lives
         only on hardware.
       - Anything else that must run per frame during a session belongs on the
         animation loop for the same reason. The one remaining `rAF` user is the
         Global Scale slider, which is a DOM control a session cannot reach.
     - Not done, deliberately: no brush LOADING in-headset (a file picker has no
       headset counterpart, so the page steps through brushes the desktop side
       has already loaded), and no undo beyond selecting a stroke and deleting
       it.
   - Context worth having for both: the Armillary World is a scene of NESTED
     CONCENTRIC rings, so it exercises immersive navigation harder than anything
     driven before — the viewer is inside a structure whose parts surround them
     at every radius, where the earlier drives flew around scenes seen from
     outside. The emulated-Quest recipe reproduces the scene (open the folder,
     then enter VR) but cannot reproduce how a gesture FEELS, so his device is
     the instrument: ship something for him to try rather than proving it
     headlessly.
   - PENDING after that, in the order agreed: passthrough AR (`immersive-ar` on
     Quest 3, small once the rig exists, and the demo that impresses people) —
     Jeff deferred it 2026-08-14 in favour of the desktop-feature catch-up; then
     hand tracking and comfort options (snap turn, vignette). The authoring
     gestures are largely done now: grab-to-move/turn/size shipped as P4+P5 and
     Draw Mode as P8, with add-select on the RIGHT thumbstick click; the LEFT
     stick click is the one free input left. Still absent in-headset: a
     rubber-band region select (the desktop's Shift+drag has no ray analogue
     worth guessing at), text entry (deferred by Jeff — see above), and loading
     a Composer brush without going out to the desktop.
10. Deliberately NOT ported (Jeff, 2026-07-30, on completing the roadmap
    through step 8 — the two remaining desktop features, by conscious
    choice, so their absence is a decision and not a gap):
    - PDB molecule import. No revisit planned.
    - File ▸ Watch and Reload, and with it the RSS Feed example that
      depends on it. Excluded FOR NOW — Jeff explicitly reserved the right
      to change his mind ("it could make a great web demo"). If he asks
      for web-demo ideas, this is the one to offer; don't start it
      unprompted. (This is also why the desktop's camera_state snapshot
      API has no web counterpart — see section 8.)
11. Desktop features awaiting a port (surveyed 2026-08-13 over the desktop's
    commits since 2026-08-01 — most of that stretch is docs-site, packaging
    and example content; these are the app-behaviour ones):
    - ~~**Topology Scale**~~ (desktop `55928c0`) — held through 2026-08-13 for
      a few days' real use on the desktop, which came back positive;
      **shipped 2026-08-14, see roadmap 6w**, including the re-vendoring of
      `Channel_Parameters_Example`, whose CSV that commit regenerated.
    - ~~The 0.2 render scale floor is opt-in, default OFF~~ (desktop
      `6d82d68`) — **shipped 2026-08-13, see roadmap 6v.**
    - ~~Glyph Composer Topology Scale + preview camera~~ (desktop `88091e1`,
      landed after this survey) — **shipped 2026-08-14, see roadmap 6x.**
    - ~~**Camera smoothing**~~ (desktop `81f28e1` + `2404f86`, 2026-08-14) —
      **shipped 2026-08-14, see roadmap 6y.** It is a REVISIT of ANTz's
      mechanism rather than a copy of it, and the reasons it diverges are the
      design — that is why the port follows the desktop's coherent-rig version
      and not ANTz's own.
    - ~~**New-object placement: wrap the lattice, expose the step and Z**~~
      (desktop `c2d8f13`) — **shipped 2026-08-14, see roadmap 6z.** ANTz stepped
      translate_x and WRAPPED the row (`npNodeNew`: −15 per sibling, bumping
      translate_y every 24 children — one 360 lap); GlyphViz stepped x
      forever, so a long run of N / Shift+N ran off in a line and a circular
      parent's 25th child landed on top of its first. The commit adopts the
      wrap and makes ANTz's two hardcoded numbers adjustable: a Placement Step
      (default 5.0, which changes the ROOT step from 10 → 5 so both gestures
      share one lattice) and a Placement Z with SEPARATE root (0.0) and child
      (5.0) boxes, because the axis means height above the world plane for a
      root and offset off the parent for a child. The lattice is Qt-free in
      `glyphviz_core/placement.py` and reached two ways a test pins against
      each other over 200 steps — children by ordinal (`wrapped_grid_offset`),
      roots relative to the previous object (`step_from`), since a root has no
      ordinal. Root placement keys on the last root CREATED rather than
      `max(translate_x)` (a wrap breaks that) and skips World Grids; links no
      longer consume a child slot; translate_y deliberately does NOT wrap.
      Five call sites share the helpers, and all five exist here too:
      `createRootNode` / `createChildNode` (`src/gv/createNode.ts`), both
      paste branches (`src/gv/clipboard.ts`, whose `nextRootX` is the same
      allocator) and mesh import. Read `placement.py` and its test first.
    - ~~**Pin glyph rebuilt to ANTz's DrawPinDL**~~ (desktop `979b9db`) —
      **shipped 2026-08-14, see roadmap 6aa.** It was the agreed next port
      (Jeff, 2026-08-14, on ending the placement session), to be followed by a
      commit AND a push, which this repo otherwise never does unprompted.
    - ~~**Links carry shape, and the two tool windows learn the format**~~
      (desktop `21f400c` + `a9a845d` + `2d36a05`, plus `16c9426` which this app
      already behaved as) — **shipped 2026-08-15, see roadmap 6bb.** Jeff asked
      for the two TOOL ports (Composer link levels, Generator Save Recipe…)
      after building the Hyperglyph Tree Designer; the link-as-any-geometry
      renderer came with them as the prerequisite that makes a Designer tree
      draw as limbs rather than hairlines.
    - **The two scene-file features (Jeff 2026-08-15).** The second shipped
      2026-08-17 (roadmap 6dd); the first is still open:
      - **File ▸ Merge** (desktop `1bf847d`, Ctrl+M): merge a second node CSV
        into the loaded scene. Qt-free in `glyphviz_core/scene_merge.py`
        (`merge_nodes` + `recompute_branch_levels`, with a `MergeResult`
        report), tested by `tests/test_scene_merge.py`. Web-side it has to
        meet this app's own file layer — a merge is a second `bundle.ts`
        scene, so companion tag files, `media/` and the Channels companions
        are all questions the desktop's single-CSV merge does not face.
        `recomputeBranchLevels` already exists here, in
        `src/gv/selectionExport.ts`, and should move somewhere both can share
        when this lands — it is scene_merge's function on the desktop.
      - ~~**File ▸ Save Selection As…**~~ (desktop `7ed0b55`) — **shipped
        2026-08-17, see roadmap 6dd.**
    - ~~**Adjustable tag text size**~~ (desktop `aadae11`, 2026-08-18) —
      **shipped 2026-08-18, see roadmap 6ee.**
    - ~~**Interior geometries**~~ (desktop `2ba3c4c`, 2026-08-24) — **shipped
      2026-08-24, see roadmap 6gg.** Jeff wrote the hand-off spec himself
      (`INTERIOR_GEOMETRIES_PORT.md`, committed with the port), read from this
      app's own `src/`; it is kept only as a record of the brief, the roadmap
      entry now carrying everything it said and the measurements besides.
    - ~~**Flat Ring**~~ (desktop `721b827`, 2026-08-26) — **shipped 2026-08-26,
      see roadmap 6hh.** Its companion example, the **Armillary World**
      (`9d26323`), is the scene Jeff asked for it for and it opens here as a
      folder or a zip; it is NOT vendored as a built-in, since the built-in
      scenes are CSV-only and this one is 991 nodes plus eleven textures.
      Worth reading its README even so — three authoring rules generalise past
      it (a ring that carries children must be scaled UNIFORMLY, since children
      inherit a parent's per-axis scale; a ring's texture must be built at the
      RING's aspect, which for a thin hoop is 150:1; and tilting a ring takes
      two Euler angles, not one).
    - ~~**Tag label defaults + Channel In**~~ (desktop working tree, 2026-08-28
      — not yet committed there when this was ported) — **shipped 2026-08-29,
      see roadmap 6ii.** Jeff named both as being on the short list of his
      most-demanded features. Read `tests/test_channel_binding.py` and
      `test_channel_binding_gui.py` on that side; the second file's tag-default
      tests are the desktop's own statement of the pair rule.
    - **3D force-directed graph layout** (desktop `d0b9beb` + `bf204b5`,
      2026-08-18) — NOT surveyed yet. It landed alongside the font-size commit
      with two collaboration-network examples and a Trust Network scene that
      "builds itself"; read those commits before planning anything, and expect
      it to be a Tools-window port rather than a renderer change.
    - **Hyperglyph Tree Designer** (desktop `418569c`) — a self-contained
      browser page in `hyperglyph_lab/`, shipped twice (there and under
      `glyphviz-docs/docs/hyperglyph_lab/`, pinned byte-identical by a test).
      Nothing to port: it is already a web tool, it writes the Composer
      template format both apps read, and this app opens its output (proved
      end to end in 6bb's drive). Worth linking to from this app one day, not
      reimplementing.
    - Texture support on the flat 2-D markers (desktop `f67757d`) is probably
      already equivalent here — `uvGeometry.ts` gives Circle/Cross/Star UVs
      the desktop had none for — but the desktop's crop-not-stretch rule
      (it reuses the Grid's [−1,1]²→[0,1]² window) is worth one check.
    - Two desktop commits in that window are the desktop catching up to THIS
      app, and need nothing here: `e47754e` (mesh NaN/inf face removal, which
      `meshFile.ts` already did) and `aa7fa89` (the transform gizmo handles,
      added there "matching what users liked in GlyphViz Web").
    - Seven new example scenes landed too (Cosmic Web at 43,414 galaxies, RFC
      Genealogy, Periodic System, Wind Rose, Decay Chain, Tropical Cyclone,
      Magnetic Field), and the desktop docs site now publishes ONE ZIP PER
      EXAMPLE (`6041af2`) — those open directly in this app, which is the
      cheapest possible answer to the hosted-examples item in section 7.

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
