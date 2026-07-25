"""Dump the desktop GlyphViz ChannelEngine's per-frame attribute values to JSON.

The desktop half of the Channels parity harness (roadmap step 7): runs the REAL
engine (glyphviz_core.channel_loader + channel_engine) over a gv_node.csv and
its ch-map / ch-tracks companions, and records what every bound attribute holds
at a sample of frames. The web side diffs its own ChannelAnimation against this
in src/gv/channelParity.test.ts.

Run with the desktop repo's conda env python (see that repo's CLAUDE.md for how
to locate it; never `conda run`):

    <glyphviz-env-python> tools/dump_channel_frames.py \
        src/gv/fixtures/channels/rotation_convention/Rotation_Convention_Example_gv_node.csv \
        src/gv/fixtures/channels/rotation_convention/channel_frames.json

Companions are discovered exactly as the app discovers them: the node CSV's
folder must hold exactly one file whose name contains `ch-map` and one whose
name contains `ch-track`. That is why each fixture gets its own folder under
src/gv/fixtures/channels/ — two of them side by side would disable discovery
for both, in the app and here alike.

Every frame is dumped when there are at most MAX_FULL_FRAMES of them; longer
animations are sampled evenly (the first, last and a spread between), which is
enough to catch an off-by-one or a wrong column without vendoring a megabyte of
JSON. CI never runs this — the JSON is committed.
"""

import json
import sys
from pathlib import Path

# Import glyphviz_core from the sibling desktop repo without installing it.
DESKTOP_REPO = Path(__file__).resolve().parents[2] / "glyphviz"
sys.path.insert(0, str(DESKTOP_REPO))

from glyphviz_core.channel_engine import ChannelEngine              # noqa: E402
from glyphviz_core.channel_loader import (                          # noqa: E402
    find_channel_files, load_ch_map, load_ch_tracks,
)
from glyphviz_core.csv_reader import load_node_csv                  # noqa: E402

MAX_FULL_FRAMES = 200
SAMPLE_COUNT = 12


def sample_frames(frame_count: int) -> list[int]:
    if frame_count <= MAX_FULL_FRAMES:
        return list(range(frame_count))
    step = (frame_count - 1) / (SAMPLE_COUNT - 1)
    return sorted({int(round(i * step)) for i in range(SAMPLE_COUNT)})


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    csv_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])

    map_path, tracks_path = find_channel_files(str(csv_path))
    if not map_path or not tracks_path:
        print(f"No ch-map/ch-tracks companions next to {csv_path}")
        return 1

    nodes = load_node_csv(str(csv_path))
    ch_map = load_ch_map(map_path)
    tracks, id_to_col = load_ch_tracks(tracks_path)
    engine = ChannelEngine()
    engine.load(ch_map, tracks, id_to_col, nodes)

    # (node_id, attribute) pairs in binding order, deduplicated: the same field
    # can be bound twice (two map rows), and only the last write is observable.
    bound: list[tuple[int, str]] = []
    seen: set[tuple[int, str]] = set()
    for node, field, _col, _is_int in engine._bindings:   # noqa: SLF001
        key = (node.id, field)
        if key not in seen:
            seen.add(key)
            bound.append(key)

    by_id = {n.id: n for n in nodes}
    originals = [
        {"id": node_id, "attribute": attr, "value": engine._originals[node_id][attr]}  # noqa: SLF001
        for node_id, attr in bound
    ]

    frames = []
    for frame in sample_frames(engine.frame_count):
        engine.apply_frame(frame)
        frames.append({
            "frame": frame,
            "values": [
                round(float(getattr(by_id[node_id], attr)), 12) for node_id, attr in bound
            ],
        })
    engine.reset()

    out = {
        "source_csv": csv_path.name,
        "ch_map": map_path.name,
        "ch_tracks": tracks_path.name,
        "engine": "glyphviz_core.channel_engine.ChannelEngine",
        "frame_count": engine.frame_count,
        "bindings": [{"id": node_id, "attribute": attr} for node_id, attr in bound],
        "originals": originals,
        "frames": frames,
    }
    out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(
        f"Wrote {len(bound)} binding(s) over {len(frames)} of "
        f"{engine.frame_count} frame(s) to {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
