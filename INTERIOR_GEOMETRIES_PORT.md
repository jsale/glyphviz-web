# Port "Interior Geometries" to GlyphViz Web

Hand-off spec for a GlyphViz Web session. The desktop side shipped
2026-08-24 as commit `2ba3c4c` in `glyphviz` ("Interior geometries: see a
video from inside a sphere, cylinder or cube"). Read that commit and
`glyphviz_gl/geometry.py` if anything below is ambiguous — it is the
reference implementation.

**Goal:** apply a texture or video to a sphere, cylinder or cube and view it
from *inside*, so a 360° video can be watched in VR. Confirmed working on the
desktop with real GoPro Max2 360 footage.

**Note on this document:** the Web-repo specifics below were read from
`src/` on 2026-08-24. Re-read those files before acting — the repo moves.

---

## 1. The four ids — these must match the desktop exactly

CSVs move between desktop and Web, so the numbers are the contract.

| id | desktop constant | display name |
|---|---|---|
| 29 | `GEO_CUBE_INTERIOR` | Cube (Interior) |
| 30 | `GEO_SPHERE_INTERIOR` | Sphere (Interior) |
| 31 | `GEO_CYLINDER_INTERIOR` | Cylinder (Interior) |
| 32 | `GEO_CYLINDER_INTERIOR_OPEN` | Cylinder (Interior, Open) |

In `src/gv/types.ts`: add four entries to the `Geometry` const, four entries
to the geometry name table, and bump `GEOMETRY_MAX` from 28 to **32**. (Note
Web counts differently from desktop — `GEOMETRY_MAX` is the highest id,
desktop's `GEO_COUNT` is the count, now 33.)

No new column. The mode rides in `geometry`, exactly like the link
geometries, so it saves, loads, cycles on O and animates through Channels for
free.

---

## 2. The thing that actually matters: mirror, don't just stop culling

This is the whole design, and it is the part most likely to be got wrong.

**Looking at the inside of an outward-mapped surface is inherently a MIRROR
view.** A mesh that merely renders its back faces shows the video *reversed* —
text, faces and logos all backwards. Measured on the desktop: an equirect
texture reading **R** came back as **Я** with culling simply switched off, and
as a correct **R** once the geometry was mirrored.

So the rule is: **an interior shape is a mirrored shape, not a two-sided
one.** Three consequences, all of them deliberate:

1. Mirrored geometry, so the image reads forwards from inside.
2. Still **single-sided** — one fragment per pixel, and alpha on a
   translucent node keeps behaving. Do not reach for `DoubleSide`.
3. Drawn **unlit**, so the footage comes through at its own brightness.

On (3): the reflection does *not* turn the normals inward. The inverse
transpose of `diag(-1,1,1)` maps a sphere's outward normal to the outward
normal at the mirrored point — still outward. On the desktop a white interior
sphere measured 0.505 grey, exactly the ambient terms with zero diffuse, i.e.
the video was playing at about half brightness. Lighting it instead would be
worse: the light is a headlight fixed in eye space, so a lit interior carries
a bright patch that slides across the video as the viewer turns — which in VR
would be very unpleasant. Unlit is the same call `_draw_world_grid` already
makes for a map.

---

## 3. Implementation

### 3.1 The mirror — three.js does NOT behave like raw OpenGL here

**Mirror the GEOMETRY, not the object's scale.** three.js compensates for a
negative-determinant `matrixWorld` (`WebGLState.setMaterial` flips
`gl.frontFace`), so `mesh.scale.x = -1` gives you a *mirrored but still
exterior* shape — the opposite of what you want. Baking the mirror into the
`BufferGeometry` leaves the determinant positive, so no compensation kicks in
and the faces genuinely become back-facing from outside:

```ts
const geo = zSphereGeometry(1, 32, 16)
geo.scale(-1, 1, 1)          // faces now point inward
```

This is also three.js's own canonical 360-video idiom (see its
`webgl_video_panorama_equirectangular` example), so it is the well-trodden
path rather than a trick.

Material stays `side: THREE.FrontSide`.

### 3.2 Sphere and cylinder — reuse the existing builders

`src/render/uvGeometry.ts` already has exactly what is needed:

- `zSphereGeometry(radius, slices, stacks)`
- `zTubeGeometry(radiusBottom, radiusTop, height, { capBottom, capTop, slices })`

so the caps question is already parameterised — the open cylinder is simply
both cap flags off. In `src/render/glyphGeometry.ts`'s solid-builder table:

```ts
[Geometry.SphereInterior]: () => interior(zSphereGeometry(1, 32, 16)),
[Geometry.CylinderInterior]: () => interior(
  zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT,
                { slices: 32, capBottom: true, capTop: true })),
[Geometry.CylinderInteriorOpen]: () => interior(
  zTubeGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, CYLINDER_HEIGHT,
                { slices: 32 })),
```

with `const interior = (g: THREE.BufferGeometry) => g.scale(-1, 1, 1)`.

### 3.3 The cube needs a bespoke builder — do not mirror `BoxGeometry`

**One reflection cannot un-mirror all six faces.** The two faces
perpendicular to the mirror axis swap places without their own UVs turning
over, so they read backwards. This cost real time on the desktop; don't
rediscover it.

Build each face from a screen-space basis for a viewer at the centre —
`right = axis × up` — then emit corners `p00, p10, p11, p01` at
`(axis ± right ± up) * halfExtent` with UVs `(0,0) (1,0) (1,1) (0,1)`. Being
right-handed, that lays u to the viewer's right and v upward *and* winds the
quad CCW-from-inside for free. Normals are `-axis`.

The face table (Z-up, matching Web's `z*Geometry` convention):

```ts
// [outward axis, which way is up on that face]
[[ 1, 0, 0], [0, 0,  1]],   // walls: +Z up
[[-1, 0, 0], [0, 0,  1]],
[[ 0, 1, 0], [0, 0,  1]],
[[ 0,-1, 0], [0, 0,  1]],
[[ 0, 0, 1], [0, 1,  0]],   // ceiling, looked up at
[[ 0, 0,-1], [0,-1,  0]],   // floor, looked down at
```

**The opposite y on floor and ceiling is not a typo.** An orbit camera
looking down has screen-up pointing away from its azimuth, and one looking up
has it pointing along — so giving both faces the same y leaves one of them
180° round from the other. Measured, then fixed. With the table above, a
viewer at the centre facing +Y reads the wall ahead, the floor and the ceiling
all the same way up.

Desktop reference: `_CUBE_INTERIOR_FACES` and `_draw_cube_interior` in
`glyphviz_gl/geometry.py`.

### 3.4 Unlit material

`solidMaterial()` in `src/render/glyphGeometry.ts` builds a
`MeshLambertMaterial`. Interior ids need `MeshBasicMaterial` instead — same
`color` / `map` / `transparent` / `opacity`, `side: THREE.FrontSide`. The
precedent is already in the repo: `src/render/worldGridGeometry.ts` uses
`MeshBasicMaterial` for the same reason (a map must read at full brightness).
Keep it in the existing material cache; just extend the cache key so lit and
unlit variants don't collide.

Consider `fog: false` too — a judgement call, but a video sphere you are
standing inside should probably not be fogged.

### 3.5 Caps as two ids, plus the checkbox

Caps are **not** a field. The capped and open cylinders are two geometry ids
and the checkbox swaps between them, which is why the choice travels in the
CSV with no new column. Port these three helpers from
`glyphviz_core/geometry_data.py`:

- `CYLINDER_INTERIOR_BY_CAPS = { true: 31, false: 32 }`
- `hasCaps(geometry)` → `geometry === 31`
- `withCaps(geometry, caps)` → the other member of the pair, **a no-op for
  every other id**

That last point matters: the checkbox runs over the whole selection, and a
mixed selection must not have its spheres turned into cylinders.

In the Properties panel: an **End caps** checkbox under the Geometry
dropdown, enabled only when the node is on one of the pair, disabled
everywhere else. The two controls must follow each other in *both*
directions — picking the open cylinder from the dropdown clears the tick, and
ticking the box updates the dropdown — or the next edit anywhere in the panel
will put the node back on the old id.

---

## 4. Web-specific differences from the desktop — check these

1. **`PICK_MATERIAL` is `MeshBasicMaterial({ side: THREE.DoubleSide })`**
   (`glyphGeometry.ts`). So a Web interior node will be pickable from outside
   as well as inside, where the desktop's pick pass shares the visible pass's
   winding exactly. Probably harmless, possibly even desirable — but it is a
   deliberate decision to make, not something to leave unnoticed. The desktop
   invariant is "the pick pass draws what the visible pass draws."
2. **`solidMaterial(style, doubleSided)`** already has a `doubleSided` path.
   Interiors must **not** use it. If anything in the Web app can flip a node
   to `DoubleSide`, an interior node on that path loses the effect.
3. **Wire/solid pick substitution**: interior ids are solid and have no wire
   twin, so they should not appear in any wire→solid mapping.

---

## 5. Behaviour worth knowing (same on both sides)

- **From outside** you see the *far* inner wall, like looking into a bowl.
  The node stays visible and clickable — it is not invisible. (I predicted
  invisible early on; the render proved otherwise.)
- **Scale is ordinary.** An interior sphere at `scale 57.3` with Global Scale
  1.0 has a 57.3-unit radius. Fly inside and look around.
- **Links carry them.** Interior shapes span −1..1 like every other glyph, so
  the link-stretching math needs no change: a link with an open interior
  cylinder is a tube you can fly down.
- **World Grids are untouched.** `gridIsGlobe()` still keys on the plain
  sphere ids, so an interior globe grid — a planetarium with lon/lat-placed
  children — is a follow-up, not part of this.

---

## 6. Tests to mirror

Desktop has `tests/test_interior_geometry.py` (37) and
`tests/test_interior_geometry_gui.py` (11). The ones worth reproducing:

- **Winding**: every interior face's geometric normal points *at* the origin.
- **UV handedness** — this is "not mirrored" stated without pixels: for each
  face, `(p10 − p00) × (p01 − p00)` must point at the origin. Run the same
  assertion on the *exterior* cube as a control and it comes out the other
  way; that contrast is the bug back-face culling alone can't fix.
- **Cube coverage**: six quads, six axis-aligned normals, each face carrying
  the full `[0,1]²`.
- **Caps**: the open tube emits no cap geometry, the capped one emits two,
  and the pre-existing cylinder is byte-identical to before.
- **Separate cached geometries** for the capped and open ids — if they shared
  one, the checkbox would do nothing on screen.
- **Panel**: checkbox ↔ dropdown agreement both directions, mixed-selection
  safety, and the O-key cycle keeping the row in sync.

---

## 7. VR checklist for Jeff

1. Equirect 360 still frame first, then the GoPro video — text in frame is
   the test that the un-mirroring worked.
2. Stand at the centre and turn a full circle: no seam jump, no brightness
   patch sliding with your gaze (that would mean it is still lit).
3. Look straight up and straight down — the sphere's poles are where
   tessellation artefacts show.
4. Check the sphere radius against the XR near plane and world scale; too
   small and the near plane clips into the wall.
5. The video room (interior cube) is the read-the-walls test: all four walls
   plus floor and ceiling should be upright and forwards.
6. Frame rate with video texture upload per frame — this is the one place a
   headset may struggle where the desktop doesn't.

---

## 8. Known follow-ups

- **Stereoscopic 360** (top/bottom or side-by-side 3D footage) needs per-eye
  UV offsets and is not covered here — mono equirect only. This is the
  obvious next step for VR if the mono version lands well.
- **Interior globe World Grid** — a planetarium with lon/lat children on the
  inside of the sphere.
