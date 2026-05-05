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


def _detect_window_triplets(msp) -> list[dict]:
    """Find groups of 3 parallel close-overlapping segments on layer 0 = window symbols."""
    from collections import defaultdict
    segs = []
    for e in msp.query('LWPOLYLINE[layer=="0"]'):
        pts = list(e.get_points("xy"))
        if len(pts) != 2:
            continue
        s = (float(pts[0][0]), float(pts[0][1]))
        en = (float(pts[1][0]), float(pts[1][1]))
        L = math.hypot(en[0] - s[0], en[1] - s[1])
        if L < 0.05:
            continue
        ang = math.atan2(en[1] - s[1], en[0] - s[0])
        if ang < 0:
            ang += math.pi
        if ang >= math.pi:
            ang -= math.pi
        segs.append({"s": s, "e": en, "L": L, "ang": ang,
                     "mx": (s[0] + en[0]) / 2, "my": (s[1] + en[1]) / 2})

    def perp(a, b):
        L = a["L"]
        nx = -(a["e"][1] - a["s"][1]) / L
        ny = (a["e"][0] - a["s"][0]) / L
        return abs((b["mx"] - a["s"][0]) * nx + (b["my"] - a["s"][1]) * ny)

    def overlap(a, b):
        L = a["L"]
        dx = (a["e"][0] - a["s"][0]) / L
        dy = (a["e"][1] - a["s"][1]) / L
        t1 = (b["s"][0] - a["s"][0]) * dx + (b["s"][1] - a["s"][1]) * dy
        t2 = (b["e"][0] - a["s"][0]) * dx + (b["e"][1] - a["s"][1]) * dy
        if t1 > t2:
            t1, t2 = t2, t1
        return max(0, min(L, t2) - max(0, t1))

    buckets = defaultdict(list)
    for sg in segs:
        buckets[round(math.degrees(sg["ang"]) / 5) * 5].append(sg)

    triplets = []
    used = set()
    for pool in buckets.values():
        if len(pool) < 3:
            continue
        for a in sorted(pool, key=lambda c: -c["L"]):
            if id(a) in used:
                continue
            partners = []
            for b in pool:
                if a is b or id(b) in used:
                    continue
                d = perp(a, b)
                ov = overlap(a, b) / min(a["L"], b["L"])
                if d < 0.25 and ov > 0.6:
                    partners.append((d, b))
            if len(partners) < 2:
                continue
            partners.sort(key=lambda x: x[0])
            triple = [a, partners[0][1], partners[1][1]]
            sorted_t = sorted(triple, key=lambda c: perp(a, c))
            spread = perp(sorted_t[0], sorted_t[2])
            if not (0.05 <= spread <= 0.35):
                continue
            avg_w = sum(c["L"] for c in triple) / 3
            if not (0.6 <= avg_w <= 2.5):
                continue
            for c in triple:
                used.add(id(c))
            triplets.append({
                "x_raw": sum(c["mx"] for c in triple) / 3,
                "y_raw": sum(c["my"] for c in triple) / 3,
                "width": round(avg_w, 3),
                "thickness": round(spread, 3),
                "ang_deg": round(math.degrees(a["ang"]), 1),
            })
    return triplets


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

    # Windows = triplets of parallel close 2-vert polylines on layer 0
    # (releveu convention: 3 parallel lines instead of wall hatch at openings)
    raw_windows = _detect_window_triplets(msp)

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

    windows = [
        {
            "x": round(w["x_raw"] - cx, 4),
            "z": round(w["y_raw"] - cy, 4),
            "width": w["width"],
            "depth": w["thickness"],
            "horizontal": 1 if abs(w["ang_deg"]) < 5 or abs(w["ang_deg"] - 180) < 5 else 0,
            "points": [],
        }
        for w in raw_windows
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
        "windows": windows,
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
                "windowsOut": len(windows),
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
    print(f"  windows emitted (3-line triplets): {len(windows)}")
    print(f"  hatchOuter: {'yes (' + str(len(hatch_outer)) + ' verts)' if hatch_outer else 'no'}")
    print(f"  bbox local: w={out['_meta']['extents']['widthM']}m h={out['_meta']['extents']['heightM']}m")


if __name__ == "__main__":
    main()
