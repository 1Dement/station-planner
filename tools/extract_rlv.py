"""
extract_rlv.py — RLV CURAT.dxf -> building-data.json

Reads CLADIRI_ACTIVE HATCH boundaries + closed polylines on layer 0,
emits the schema consumed by src/lib/building-loader.ts:

{
  walls: [{points: [[x,z], ...], closed: 1, area}],
  hatchOuter: [[x,z], ...] | null,
  hatchHoles: [[[x,z], ...]],
  objects: [], doors: [], windows: []
}

Coords: local meters, centered around bbox midpoint (Three.js origin).
DXF Y axis -> scene Z axis (top-down convention).
"""
from __future__ import annotations
import json
import math
from pathlib import Path

import ezdxf
from ezdxf.entities import Hatch

import sys
DEFAULT_DXF = r"C:\dev\station-planner\public\test-data\rlveu\dxf_out\RLVEU_CURAT.dxf"
DXF = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DXF)
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else r"C:\dev\station-planner\src\lib\building-data.json")


def poly_area(pts: list[list[float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def hatch_paths(h: Hatch) -> list[tuple[str, list[list[float]]]]:
    """Return list of (path_kind, polygon) tuples where kind = 'poly' or 'edges'."""
    out: list[tuple[str, list[list[float]]]] = []
    for path in h.paths:
        loop: list[list[float]] = []
        kind = "poly"
        if hasattr(path, "vertices") and path.vertices:
            for v in path.vertices:
                loop.append([float(v[0]), float(v[1])])
        elif hasattr(path, "edges") and path.edges:
            kind = "edges"
            seen: list[tuple[float, float]] = []
            for ed in path.edges:
                etype = type(ed).__name__
                if etype == "LineEdge":
                    s = (float(ed.start[0]), float(ed.start[1]))
                    e = (float(ed.end[0]), float(ed.end[1]))
                    if not seen or seen[-1] != s:
                        seen.append(s)
                    seen.append(e)
                elif etype in ("ArcEdge", "EllipseEdge"):
                    n_seg = 24
                    cx, cy = float(ed.center[0]), float(ed.center[1])
                    r = float(getattr(ed, "radius", 1.0))
                    a0 = math.radians(float(ed.start_angle))
                    a1 = math.radians(float(ed.end_angle))
                    if not getattr(ed, "ccw", True):
                        a0, a1 = a1, a0
                    if a1 < a0:
                        a1 += 2 * math.pi
                    for i in range(n_seg + 1):
                        t = a0 + (a1 - a0) * i / n_seg
                        seen.append((cx + r * math.cos(t), cy + r * math.sin(t)))
                elif etype == "SplineEdge":
                    for cp in ed.control_points:
                        seen.append((float(cp[0]), float(cp[1])))
            loop = [list(p) for p in seen]
        if len(loop) >= 3:
            if loop[0] != loop[-1]:
                loop.append(list(loop[0]))
            out.append((kind, loop))
    return out


def main() -> None:
    doc = ezdxf.readfile(DXF)
    msp = doc.modelspace()

    poly_paths: list[list[list[float]]] = []
    edge_paths: list[list[list[float]]] = []
    for h in msp.query('HATCH[layer=="CLADIRI_ACTIVE"]'):
        for kind, loop in hatch_paths(h):
            (poly_paths if kind == "poly" else edge_paths).append(loop)

    extra_polys: list[list[list[float]]] = []
    for e in msp.query('LWPOLYLINE[layer=="0"]'):
        if not e.closed:
            continue
        pts = [[float(p[0]), float(p[1])] for p in e.get_points("xy")]
        if len(pts) >= 3:
            if pts[0] != pts[-1]:
                pts.append(list(pts[0]))
            extra_polys.append(pts)

    # Doors = ARCs (door swings). center=hinge, radius=door width, start_angle=closed direction.
    raw_doors: list[dict] = []
    for a in msp.query("ARC"):
        r = float(a.dxf.radius)
        if not (0.4 <= r <= 1.6):
            continue
        cx0, cy0 = float(a.dxf.center[0]), float(a.dxf.center[1])
        s_deg = float(a.dxf.start_angle) % 360.0
        e_deg = float(a.dxf.end_angle) % 360.0
        raw_doors.append({"x_raw": cx0, "y_raw": cy0, "width": round(r, 3),
                          "startAngle": round(s_deg, 1), "endAngle": round(e_deg, 1)})

    all_polys = poly_paths + edge_paths + extra_polys
    if not all_polys:
        raise SystemExit("No CLADIRI_ACTIVE HATCH or closed polylines found")

    flat = [p for poly in all_polys for p in poly]
    xs = [p[0] for p in flat]
    ys = [p[1] for p in flat]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0

    def center(poly: list[list[float]]) -> list[list[float]]:
        return [[round(x - cx, 4), round(y - cy, 4)] for x, y in poly]

    poly_paths = [center(p) for p in poly_paths]
    edge_paths = [center(p) for p in edge_paths]
    extra_polys = [center(p) for p in extra_polys]

    doors = [
        {
            "x": round(d["x_raw"] - cx, 4),
            "z": round(d["y_raw"] - cy, 4),
            "width": d["width"],
            "startAngle": d["startAngle"],
            "endAngle": d["endAngle"],
            "hingeAngle": d["startAngle"],
        }
        for d in raw_doors
    ]

    # HATCH 1 polyline path = building exterior outline -> hatchOuter
    # HATCH 2 edge paths = interior wall stripes -> walls (each stripe is a thin closed poly)
    # layer 0 closed poly = canopy or secondary -> walls
    hatch_outer = max(poly_paths, key=poly_area) if poly_paths else None

    walls: list[dict] = []
    rest_polys = [p for p in poly_paths if p is not hatch_outer] + edge_paths + extra_polys
    for poly in rest_polys:
        a = poly_area(poly)
        if a < 0.05:
            continue
        walls.append({"points": poly, "closed": 1, "area": round(a, 4)})

    hatch_holes: list[list[list[float]]] = []

    out = {
        "walls": walls,
        "hatchOuter": hatch_outer,
        "hatchHoles": hatch_holes,
        "objects": [],
        "doors": doors,
        "windows": [],
        "_meta": {
            "source": str(DXF.name),
            "originalCenterStereo70": [round(cx, 4), round(cy, 4)],
            "extents": {
                "minX": round(min(xs) - cx, 4),
                "maxX": round(max(xs) - cx, 4),
                "minY": round(min(ys) - cy, 4),
                "maxY": round(max(ys) - cy, 4),
                "widthM": round(max(xs) - min(xs), 4),
                "heightM": round(max(ys) - min(ys), 4),
            },
            "counts": {
                "polyPaths": len(poly_paths),
                "edgePaths": len(edge_paths),
                "extraPolys": len(extra_polys),
                "wallsOut": len(walls),
                "doorsOut": len(doors),
                "hasHatchOuter": hatch_outer is not None,
            },
        },
    }

    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(f"Wrote {OUT}")
    print(f"  poly paths (HATCH polyline): {len(poly_paths)}")
    print(f"  edge paths (HATCH edge loops): {len(edge_paths)}")
    print(f"  extra closed polys (layer 0): {len(extra_polys)}")
    print(f"  walls emitted: {len(walls)}")
    print(f"  doors emitted (from ARCs): {len(doors)}")
    print(f"  hatchOuter: {'yes (' + str(len(hatch_outer)) + ' verts)' if hatch_outer else 'no'}")
    print(f"  bbox local: w={out['_meta']['extents']['widthM']}m h={out['_meta']['extents']['heightM']}m")


if __name__ == "__main__":
    main()
