"""Dump the REAL desktop mesh loader's output, per face CORNER, to JSON.

`glyphviz_core/mesh_loader.load_mesh_file` is the whole of what an imported
model means on the desktop, and almost none of it is stated in the file: trimesh
welds duplicate vertices, drops NaN facets and DEGENERATE ones, then GlyphViz
re-centres on the AABB and divides by the farthest vertex, and `_crease_normals`
decides which edges stay hard. This app reimplements every one of those steps
(`src/gv/meshFile.ts`), so the two can disagree in ways nothing else notices — a
model that shades smooth on one side and faceted on the other, or one whose
texture lands a texel off.

Per CORNER because that is the one representation both sides share. The desktop
emits a normal and a texcoord per corner straight into a display list, so its
geometry is effectively un-indexed; a BufferGeometry needs one normal per
vertex, so the web SPLITS vertices at hard edges instead. Corner i of the dump
therefore lines up with corner i of the web's index array whatever each side did
to its vertex table.

The three quantities diffed are the three that can go wrong independently:
position (the normalization), uv (the texture), and normal (the crease pass).

Cases are the desktop's own Mesh Creation Lab, because a synthetic fixture would
not have found the thing this harness was written for — that the web kept 8
zero-area triangles in tower_plant and 6,408 of oak_canopy's 21,360, where
trimesh's `validate=True` drops them:

  tower_core   hard-surface box work: crisp creases, UV-textured facades
  tower_plant  the degenerate-face case, in miniature
  whale_body   a smooth lofted hull WITH UV seams — the case that proves a seam
               is not a crease, which is the bug the desktop fixed in 630f5ec
  car          a small mixed model: smooth and faceted surfaces together

Run with the desktop repo's conda env python (see that repo's CLAUDE.md; never
`conda run`), from the desktop repo so `glyphviz_core` imports:

    <glyphviz-env-python> <this file> <out.json> <model.obj> [more.obj ...]

Regenerate the vendored JSON only when the desktop mesh loader changes — its
crease angle, its trimesh flags, or its normalization. CI never runs this; the
JSON is committed.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, 'C:/Users/jsale/source/repos/glyphviz')

from glyphviz_core.mesh_loader import DEFAULT_CREASE_ANGLE, load_mesh_file  # noqa: E402


def dump(paths):
    out = {'crease_angle': float(DEFAULT_CREASE_ANGLE), 'models': {}}
    for path in paths:
        data = load_mesh_file(path)
        corners = []
        for f, face in enumerate(data.faces):
            for k, vi in enumerate(face):
                corners.append({
                    'p': [round(float(x), 9) for x in data.vertices[vi]],
                    'uv': ([round(float(x), 9) for x in data.uvs[vi]]
                           if data.uvs is not None else None),
                    'n': [round(float(x), 9) for x in data.normal_for(f, k, vi)],
                })
        out['models'][Path(path).name] = {
            'name': data.name,
            'triangles': int(len(data.faces)),
            'has_uvs': bool(data.has_uvs),
            'corners': corners,
        }
    return out


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dump(sys.argv[2:])), encoding='utf-8')
    print(f'wrote {target}')
