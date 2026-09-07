"""Dump the desktop GlyphViz point-cloud IMPORTER to JSON, and write its fixtures.

The desktop half of the W2 parity harness. It runs the REAL
`glyphviz_core.point_cloud_loader` — `fit_to_world`, `resolve_colors`, `_ramp`
through it, `class_color` / `class_name`, `_decimation_index` and
`import_to_nodes` — and writes what each one produced. The web side diffs its
own `src/gv/pointCloudLoader.ts` against this in
src/gv/pointCloudLoader.parity.test.ts.

The fixtures are WRITTEN here rather than committed from somewhere else, for the
reason the desktop's own test gives: each file then states the property it is
about — 16-bit colour, a huge projected origin, an unclassified file, a stray
outlier, a withheld flag, a LAS 1.4 user class — right where the assertion is.
They are small (a few thousand points each) and they are what both sides read,
so a difference can only be a difference in the RULES.

Two of them are the same points in two containers: `utm.las` and `utm.laz`. That
pair is what pins the web app's LAZ path — its wasm decoder must reproduce, byte
for byte, the records the uncompressed file hands over — without vendoring a
multi-megabyte real tile.

WHAT IS NOT DIFFED, and why: the `random` decimation. The desktop draws from
numpy's PCG64 and the web from CPython's Mersenne Twister, so the two pick
different points from the same file. That is a deliberate divergence documented
on `decimationIndex` — the desktop's import dialog exposes no seed at all, so
"the same seed picks the same points in both apps" is a promise nobody has made.
`stride` and `voxel` ARE diffed exactly, and every rule downstream of the sample
is diffed for all three by feeding the web the index set the desktop chose.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_point_cloud_import.py \
        src/gv/fixtures/pointcloud

Regenerate whenever the desktop importer changes. CI never runs this — the JSON
and the fixture files are committed.
"""

import json
import sys
from pathlib import Path

import numpy as np

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

import laspy                                               # noqa: E402
from glyphviz_core import point_cloud_loader as pcl        # noqa: E402


# --------------------------------------------------------------- fixtures ---

def write_las(path: Path, xyz, *, rgb=None, classification=None, intensity=None,
              withheld=None, scale=0.01, point_format=None, version="1.2"):
    """Write a LAS (or LAZ, by extension) with the given per-point data.

    The point format is chosen from what the caller supplies, so a test asking
    for "a file with no RGB" gets a file that genuinely has no RGB fields rather
    than one with zeroed ones.
    """
    if point_format is None:
        point_format = 3 if rgb is not None else 2
    header = laspy.LasHeader(point_format=point_format, version=version)
    header.scales = np.array([scale, scale, scale])
    header.offsets = np.floor(np.min(xyz, axis=0))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    if rgb is not None:
        las.red, las.green, las.blue = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    if classification is not None:
        las.classification = classification
    if intensity is not None:
        las.intensity = intensity
    if withheld is not None:
        las.withheld = withheld
    las.write(str(path))
    return str(path)


def make_fixtures(out_dir: Path) -> dict[str, str]:
    """Every point-cloud file the web tests read. Returns name -> path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    made: dict[str, str] = {}

    # A file shaped like real airborne LIDAR: projected coordinates with a huge
    # origin, 16-bit colour, ASPRS classification and intensity.
    rng = np.random.default_rng(3)
    n = 5000
    utm_xyz = np.stack([
        635_000.0 + rng.random(n) * 3000.0,      # easting
        851_000.0 + rng.random(n) * 4000.0,      # northing
        400.0 + rng.random(n) * 200.0,           # elevation
    ], axis=1)
    utm_rgb = (rng.random((n, 3)) * 60000).astype(np.uint16)      # 16-bit
    utm_cls = rng.choice([2, 5, 6, 9], size=n, p=[0.65, 0.25, 0.05, 0.05])
    utm_int = (rng.random(n) * 60000).astype(np.uint16)
    made['utm'] = write_las(out_dir / "utm.las", utm_xyz, rgb=utm_rgb,
                            classification=utm_cls.astype(np.uint8),
                            intensity=utm_int)
    # The SAME points, compressed. The web reads this through its wasm codec and
    # must land on exactly the cloud the uncompressed file gives.
    made['utm_laz'] = write_las(out_dir / "utm.laz", utm_xyz, rgb=utm_rgb,
                                classification=utm_cls.astype(np.uint8),
                                intensity=utm_int)

    # 8-bit values sitting in the 16-bit colour fields. Scaling these by >>8
    # turns the cloud black — the failure the heuristic exists to prevent.
    rng8 = np.random.default_rng(11)
    eight_xyz = rng8.random((400, 3)) * np.array([50.0, 30.0, 8.0])
    eight_rgb = (rng8.random((400, 3)) * 255).astype(np.uint16)
    made['eight_bit'] = write_las(out_dir / "eight_bit.las", eight_xyz,
                                  rgb=eight_rgb)

    # Nearly every LAS file HAS a classification column; most public ones leave
    # it all 0 or all 1. Colouring by class there gives one flat grey cloud.
    unc_xyz = np.random.default_rng(5).random((600, 3)) * np.array([200.0, 150.0, 40.0])
    made['unclassified'] = write_las(out_dir / "unclassified.las", unc_xyz,
                                     classification=np.zeros(600, dtype=np.uint8))

    # One absurd return, the kind airborne LIDAR reliably contains. Fitting off
    # raw min/max would collapse the real cloud toward invisibility.
    rng2 = np.random.default_rng(2)
    out_xyz = rng2.random((5000, 3)) * np.array([1000.0, 1000.0, 50.0])
    out_xyz[0] = [500_000.0, 500_000.0, 90_000.0]
    made['outlier'] = write_las(out_dir / "outlier.las", out_xyz, scale=0.1)

    # A legacy file with the withheld bit set. Classification shares its byte
    # with three flags in point formats 0-5, so an unmasked read of these
    # class-2 points comes back as 130 and drops out of every class rule.
    rng3 = np.random.default_rng(7)
    wh_xyz = rng3.random((500, 3)) * np.array([80.0, 60.0, 20.0])
    wh_cls = np.where(np.arange(500) % 5 == 0, 6, 2).astype(np.uint8)
    wh_flag = (np.arange(500) % 3 == 0)
    made['withheld'] = write_las(out_dir / "withheld.las", wh_xyz,
                                 classification=wh_cls, withheld=wh_flag)

    # LAS 1.4, point format 6: a full classification byte, so the user-defined
    # codes past 31 that a real tile carries can actually be written.
    rng4 = np.random.default_rng(13)
    user_xyz = rng4.random((800, 3)) * np.array([300.0, 500.0, 60.0])
    user_cls = rng4.choice([2, 64, 65, 73, 77], size=800).astype(np.uint8)
    made['user_classes'] = write_las(out_dir / "user_classes.las", user_xyz,
                                     classification=user_cls,
                                     point_format=6, version="1.4")

    # ASCII: a comment, a commented header, and colour in the 0-255 columns.
    #
    # The header is a COMMENT rather than a bare "x y z r g b" line, and that is
    # not tidiness -- it is routing around a desktop bug this port found. Its
    # `_read_ascii` promises in as many words that "any leading line that does
    # not parse as numbers is treated as a header and skipped", and for a
    # COMMA-delimited file it is; for a WHITESPACE-delimited one the header row
    # comes back as a row of NaNs, the comma retry then reads the whole file as
    # one 302-column row, `rows2.shape[1] >= 3` accepts it, and the file fails
    # with "No x y z columns found". Reported to Jeff. The web reader skips any
    # unparseable leading line, which is what that docstring describes, and
    # `pointCloudLoader.test.ts` pins the case the desktop cannot read.
    ascii_rows = ["# a scanner comment", "# x y z r g b"]
    rng5 = np.random.default_rng(17)
    for i in range(300):
        p = rng5.random(3) * np.array([40.0, 25.0, 9.0])
        c = (rng5.random(3) * 255).astype(int)
        ascii_rows.append(f"{p[0]:.4f} {p[1]:.4f} {p[2]:.4f} {c[0]} {c[1]} {c[2]}")
    (out_dir / "scan.xyz").write_text("\n".join(ascii_rows) + "\n")
    made['ascii'] = str(out_dir / "scan.xyz")

    # A dense patch beside a sparse one — the case voxel sampling exists for.
    rng6 = np.random.default_rng(1)
    sparse = rng6.random((2000, 3)) * np.array([100.0, 100.0, 5.0])
    dense = rng6.random((8000, 3)) * np.array([10.0, 100.0, 5.0])
    made['uneven'] = write_las(out_dir / "uneven.las",
                               np.vstack([sparse, dense]), scale=0.001)

    # A binary PLY point cloud with vertex colour, read through trimesh there
    # and through src/io/plyFile.ts here.
    import trimesh
    rng7 = np.random.default_rng(23)
    ply_xyz = rng7.random((450, 3)) * np.array([12.0, 9.0, 3.0])
    ply_rgb = (rng7.random((450, 3)) * 255).astype(np.uint8)
    cloud = trimesh.PointCloud(ply_xyz, colors=np.hstack(
        [ply_rgb, np.full((450, 1), 255, dtype=np.uint8)]))
    (out_dir / "scan.ply").write_bytes(cloud.export(file_type='ply', encoding='binary'))
    made['ply'] = str(out_dir / "scan.ply")

    return made


# ------------------------------------------------------------------ dumps ---

def node_row(node) -> dict:
    """Every field of a node the web builder also writes."""
    return {
        'id': node.id, 'type': node.type, 'parent_id': node.parent_id,
        'branch_level': node.branch_level,
        'translate': [node.translate_x, node.translate_y, node.translate_z],
        'scale': [node.scale_x, node.scale_y, node.scale_z],
        'color': [node.color_r, node.color_g, node.color_b, node.color_a],
        'geometry': node.geometry, 'topo': node.topo, 'ratio': node.ratio,
        'hide': node.hide, 'rotation_mode': node.rotation_mode,
        'text': node.text,
    }


def dump_fit(paths) -> list[dict]:
    """fit_to_world over each fixture, at several spans and exaggerations."""
    cases = []
    for key in ('utm', 'outlier', 'unclassified', 'ascii'):
        data = pcl.load_point_cloud(paths[key], max_points=None)
        for span, exag in ((360.0, 1.0), (100.0, 1.0), (360.0, 3.0), (25.0, 0.5)):
            fitted, scale, center = pcl.fit_to_world(data.points, span, exag)
            cases.append({
                'file': Path(paths[key]).name, 'span': span,
                'exaggeration': exag, 'scale': scale,
                'center': center.tolist(),
                'fitted_head': fitted[:8].tolist(),
                'fitted_min': fitted.min(axis=0).tolist(),
                'fitted_max': fitted.max(axis=0).tolist(),
            })
    # An empty cloud must not explode.
    fitted, scale, center = pcl.fit_to_world(np.zeros((0, 3)))
    cases.append({'file': '(empty)', 'span': pcl.DEFAULT_WORLD_SPAN,
                  'exaggeration': 1.0, 'scale': scale, 'center': center.tolist(),
                  'fitted_head': [], 'fitted_min': None, 'fitted_max': None})
    return cases


def dump_colors(paths) -> list[dict]:
    """resolve_colors in every mode over every fixture that can serve it."""
    cases = []
    for key in ('utm', 'eight_bit', 'unclassified', 'user_classes', 'ascii',
                'withheld', 'ply'):
        data = pcl.load_point_cloud(paths[key], max_points=None)
        fitted, _, _ = pcl.fit_to_world(data.points)
        for mode in pcl.COLOR_MODES:
            colors, used = pcl.resolve_colors(data, mode, fitted_z=fitted[:, 2])
            cases.append({
                'file': Path(paths[key]).name, 'requested': mode, 'used': used,
                # The head pins the mapping and the sum pins every row of it —
                # a per-point diff of 5,000 rows in JSON would be megabytes.
                'head': colors[:12].tolist(),
                'sum': [int(v) for v in colors.astype(np.int64).sum(axis=0)],
            })
    return cases


def dump_class_table() -> dict:
    """The ASPRS table, and the hue hash for codes past it."""
    codes = list(range(0, 20)) + [31, 32, 63, 64, 65, 66, 68, 73, 76, 77, 128, 255]
    return {
        'colors': {str(c): list(pcl.class_color(c)) for c in codes},
        'names': {str(c): pcl.class_name(c) for c in codes},
    }


def dump_decimation(paths) -> list[dict]:
    """stride and voxel index sets, which are deterministic on both sides.

    `random` is excluded on purpose — see this file's header. The voxel cases
    stay under _VOXEL_SEARCH_FACTOR x the target so no pre-sample runs, which
    is the branch that would otherwise inherit the RNG divergence.
    """
    cases = []
    for key in ('utm', 'uneven', 'ascii'):
        data = pcl.load_point_cloud(paths[key], max_points=None)
        for method in ('stride', 'voxel'):
            for target in (100, 500, 1200):
                if method == 'voxel' and len(data) > target * pcl._VOXEL_SEARCH_FACTOR:
                    continue
                idx = pcl._decimation_index(len(data), target, method, 0,
                                            coords=data.points)
                cases.append({
                    'file': Path(paths[key]).name, 'method': method,
                    'total': len(data), 'target': target,
                    'kept': int(len(idx)), 'index': [int(v) for v in idx],
                })
    return cases


def dump_imports(paths) -> list[dict]:
    """import_to_nodes end to end: every node field and the whole report."""
    plans = [
        # (fixture, kwargs)
        ('utm', dict(max_points=200, method='stride')),
        ('utm', dict(max_points=200, method='stride', color_mode='classification')),
        ('utm', dict(max_points=200, method='stride', color_mode='elevation',
                     exaggeration=2.5, span=100.0, point_size=6.0)),
        ('utm', dict(max_points=200, method='stride', color_mode='intensity',
                     start_id=41)),
        ('utm', dict(max_points=150, method='stride', keep_classes=[5, 6, 9])),
        ('utm', dict(max_points=None, method='stride', keep_classes=[6])),
        # 500 rather than a rounder 400 for a load-bearing reason: below
        # len/_VOXEL_SEARCH_FACTOR (417 for this 5,000-point fixture) the voxel
        # search runs on a RANDOM pre-sample, which is the one branch that
        # inherits the numpy-vs-Mersenne divergence. A parity case must exercise
        # the deterministic path or it is testing the RNG.
        ('utm', dict(max_points=500, method='voxel')),
        ('eight_bit', dict(max_points=None, method='stride')),
        ('unclassified', dict(max_points=None, method='stride')),
        ('outlier', dict(max_points=300, method='stride')),
        ('withheld', dict(max_points=None, method='stride',
                          color_mode='classification')),
        ('withheld', dict(max_points=None, method='stride', keep_classes=[2])),
        ('user_classes', dict(max_points=None, method='stride',
                              color_mode='classification')),
        ('user_classes', dict(max_points=200, method='stride',
                              keep_classes=[64, 73])),
        ('ascii', dict(max_points=None, method='stride')),
        ('ascii', dict(max_points=90, method='stride', point_size=12.0,
                       parent_translate=(10.0, -4.0, 2.0))),
        ('ply', dict(max_points=None, method='stride')),
        ('ply', dict(max_points=100, method='stride', label_points=True)),
    ]
    out = []
    for key, kwargs in plans:
        nodes, report = pcl.import_to_nodes(paths[key], **kwargs)
        report = dict(report)
        report.pop('source', None)          # an absolute path, host-specific
        report['classes'] = {str(c): list(v) for c, v in report['classes'].items()}
        out.append({
            'file': Path(paths[key]).name,
            'options': {k: (list(v) if isinstance(v, (list, tuple)) else v)
                        for k, v in kwargs.items()},
            'report': report,
            'parent': node_row(nodes[0]),
            # Every point of a small import, a sample of a large one -- with the
            # LAST row always included, since an off-by-one at the tail is
            # exactly what a head-only diff misses.
            'points': [node_row(n) for n in nodes[1:]] if len(nodes) <= 201 else
                      [node_row(n) for n in nodes[1:21]] + [node_row(nodes[-1])],
            'point_count': len(nodes) - 1,
        })
    return out


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    out_dir = Path(sys.argv[1])
    paths = make_fixtures(out_dir)

    payload = {
        'constants': {
            'default_max_points': pcl.DEFAULT_MAX_POINTS,
            'default_world_span': pcl.DEFAULT_WORLD_SPAN,
            'fit_percentiles': list(pcl.FIT_PERCENTILES),
            'color_modes': list(pcl.COLOR_MODES),
            'decimate_methods': list(pcl.DECIMATE_METHODS),
            'voxel_search_factor': pcl._VOXEL_SEARCH_FACTOR,
            'supported_extensions': list(pcl.SUPPORTED_EXTENSIONS),
        },
        'class_table': dump_class_table(),
        'fit': dump_fit(paths),
        'colors': dump_colors(paths),
        'decimation': dump_decimation(paths),
        'imports': dump_imports(paths),
    }
    target = out_dir / "point_cloud_import.json"
    target.write_text(json.dumps(payload, indent=1))
    print(f"wrote {target} "
          f"({len(payload['fit'])} fits, {len(payload['colors'])} colour cases, "
          f"{len(payload['decimation'])} decimations, "
          f"{len(payload['imports'])} imports)")
    for name, path in sorted(paths.items()):
        print(f"  fixture {name}: {Path(path).name}")


if __name__ == "__main__":
    main()
