"""
extract_releveu.py -- DXF (template convention) -> building-data.json

Layer convention (case-insensitive):
  PERETI    -> wall HATCHes (closed paths, each = wall stripe)
  USI       -> door ARCs + TEXT labels nearby ("Usa", "Usa dubla", "Usa Glisanta")
  GEAMURI   -> 3 parallel lines per window + TEXT labels ("Geam total", "geam h pervaz X.Xm")

Emits BuildingJSON consumed by src/lib/building-loader.ts.

Usage:
  python tools/extract_releveu.py [INPUT.dxf] [OUTPUT.json]
"""
from __future__ import annotations
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import ezdxf

DEFAULT_DXF = r"U:\Pipera_omw_preparat.dxf"
DXF = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DXF)
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else r"C:\dev\station-planner\src\lib\building-data.json")

WALL_LAYER = "PERETI"
DOOR_LAYER = "USI"
WINDOW_LAYER = "GEAMURI"


def _layer_eq(a: str, b: str) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


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


def hatch_paths(h) -> list[tuple[str, list[list[float]]]]:
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
                t = type(ed).__name__
                if t == "LineEdge":
                    s = (float(ed.start[0]), float(ed.start[1]))
                    e = (float(ed.end[0]), float(ed.end[1]))
                    if not seen or seen[-1] != s:
                        seen.append(s)
                    seen.append(e)
                elif t in ("ArcEdge", "EllipseEdge"):
                    n_seg = 24
                    cx0, cy0 = float(ed.center[0]), float(ed.center[1])
                    r = float(getattr(ed, "radius", 1.0))
                    a0 = math.radians(float(ed.start_angle))
                    a1 = math.radians(float(ed.end_angle))
                    if not getattr(ed, "ccw", True):
                        a0, a1 = a1, a0
                    if a1 < a0:
                        a1 += 2 * math.pi
                    for i in range(n_seg + 1):
                        tt = a0 + (a1 - a0) * i / n_seg
                        seen.append((cx0 + r * math.cos(tt), cy0 + r * math.sin(tt)))
            loop = [list(p) for p in seen]
        if len(loop) >= 3:
            if loop[0] != loop[-1]:
                loop.append(list(loop[0]))
            out.append((kind, loop))
    return out


def collect_layer_texts(msp, layer: str) -> list[dict]:
    """Return list of {x,y,text} for TEXT/MTEXT on given layer."""
    res = []
    for t in msp.query("TEXT MTEXT"):
        if not _layer_eq(t.dxf.layer, layer):
            continue
        try:
            x = float(t.dxf.insert[0]); y = float(t.dxf.insert[1])
        except Exception:
            continue
        txt = t.dxf.text if hasattr(t.dxf, "text") else getattr(t, "text", "")
        res.append({"x": x, "y": y, "text": (txt or "").strip()})
    return res


def nearest_label(x: float, y: float, labels: list[dict], max_dist: float = 2.0) -> str:
    best, best_d = "", max_dist
    for lb in labels:
        d = math.hypot(lb["x"] - x, lb["y"] - y)
        if d < best_d:
            best_d = d
            best = lb["text"]
    return best


def parse_door_label(label: str) -> dict:
    """Return {kind: 'swing'|'sliding'|'double', width_cm: int|None}."""
    s = (label or "").lower()
    out = {"kind": "swing", "width_cm": None}
    if "glisant" in s:
        out["kind"] = "sliding"
    elif "dubla" in s:
        out["kind"] = "double"
    m = re.search(r"(\d{2,3})", s)
    if m:
        out["width_cm"] = int(m.group(1))
    return out


def parse_window_label(label: str) -> dict:
    """Return {full_height: bool, sill_m: float, width_cm: int|None}."""
    s = (label or "").lower()
    out = {"full_height": False, "sill_m": 0.9, "width_cm": None}
    if "total" in s or "panou" in s:
        out["full_height"] = True
        out["sill_m"] = 0.0
    m = re.search(r"pervaz\s+(\d+(?:[.,]\d+)?)\s*m", s)
    if m:
        out["sill_m"] = float(m.group(1).replace(",", "."))
    m = re.search(r"(\d{2,3})\s*cm", s)
    if m:
        out["width_cm"] = int(m.group(1))
    return out


def detect_windows(msp) -> list[dict]:
    """Each window = 1 polyline on GEAMURI layer. Extract bbox -> position, width, depth, orientation."""
    out = []
    for e in msp.query("LWPOLYLINE"):
        if not _layer_eq(e.dxf.layer, WINDOW_LAYER):
            continue
        pts = [(float(p[0]), float(p[1])) for p in e.get_points("xy")]
        if len(pts) < 4:
            continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        dx = x_max - x_min; dy = y_max - y_min
        if max(dx, dy) < 0.3:
            continue
        # window long axis = larger dim
        if dx >= dy:
            width, thickness, ang_deg = dx, dy, 0.0
        else:
            width, thickness, ang_deg = dy, dx, 90.0
        if not (0.3 <= width <= 6.0):
            continue
        out.append({
            "x_raw": (x_min + x_max) / 2,
            "y_raw": (y_min + y_max) / 2,
            "width": round(width, 3),
            "thickness": round(max(thickness, 0.1), 3),
            "ang_deg": ang_deg,
        })
    return out


def main() -> None:
    doc = ezdxf.readfile(str(DXF))
    msp = doc.modelspace()

    poly_paths, edge_paths = [], []
    for h in msp.query("HATCH"):
        if not _layer_eq(h.dxf.layer, WALL_LAYER): continue
        for kind, loop in hatch_paths(h):
            (poly_paths if kind == "poly" else edge_paths).append(loop)

    if not (poly_paths or edge_paths):
        raise SystemExit(f"No HATCH found on layer '{WALL_LAYER}'")

    # ARCs on USI
    arc_records = []
    for a in msp.query("ARC"):
        if not _layer_eq(a.dxf.layer, DOOR_LAYER): continue
        r = float(a.dxf.radius)
        cx0, cy0 = float(a.dxf.center[0]), float(a.dxf.center[1])
        s_deg = float(a.dxf.start_angle) % 360.0
        e_deg = float(a.dxf.end_angle) % 360.0
        arc_records.append({
            "x_raw": cx0, "y_raw": cy0, "radius": r,
            "startAngle": round(s_deg, 1), "endAngle": round(e_deg, 1),
        })

    door_labels = collect_layer_texts(msp, DOOR_LAYER)
    win_labels = collect_layer_texts(msp, WINDOW_LAYER)
    raw_windows = detect_windows(msp)

    # Centering on bbox of all wall verts + arc centers + window mids
    flat = [p for poly in (poly_paths + edge_paths) for p in poly]
    flat += [(a["x_raw"], a["y_raw"]) for a in arc_records]
    flat += [(w["x_raw"], w["y_raw"]) for w in raw_windows]
    xs = [p[0] for p in flat]; ys = [p[1] for p in flat]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0

    def center(poly): return [[round(x - cx, 4), round(y - cy, 4)] for x, y in poly]

    poly_paths = [center(p) for p in poly_paths]
    edge_paths = [center(p) for p in edge_paths]

    hatch_outer = max(poly_paths, key=poly_area) if poly_paths else None
    walls = []
    rest = [p for p in poly_paths if p is not hatch_outer] + edge_paths
    for poly in rest:
        a = poly_area(poly)
        if a < 0.05: continue
        walls.append({"points": poly, "closed": 1, "area": round(a, 4)})

    # Doors with label-driven kind
    doors = []
    for r in arc_records:
        lbl = nearest_label(r["x_raw"], r["y_raw"], door_labels, max_dist=3.0)
        info = parse_door_label(lbl)
        width = (info["width_cm"] / 100.0) if info["width_cm"] else r["radius"]
        doors.append({
            "x": round(r["x_raw"] - cx, 4),
            "z": round(r["y_raw"] - cy, 4),
            "width": round(width, 3),
            "startAngle": r["startAngle"],
            "endAngle": r["endAngle"],
            "hingeAngle": r["startAngle"],
            "kind": info["kind"],
            "label": lbl,
        })

    # Windows with label-driven sill
    WALL_H = 3.0
    windows = []
    for w in raw_windows:
        lbl = nearest_label(w["x_raw"], w["y_raw"], win_labels, max_dist=3.0)
        info = parse_window_label(lbl)
        width = (info["width_cm"] / 100.0) if info["width_cm"] else w["width"]
        windows.append({
            "x": round(w["x_raw"] - cx, 4),
            "z": round(w["y_raw"] - cy, 4),
            "width": round(width, 3),
            "depth": w["thickness"],
            "horizontal": 1 if abs(w["ang_deg"]) < 5 or abs(w["ang_deg"] - 180) < 5 else 0,
            "sillM": round(info["sill_m"], 3),
            "fullHeight": info["full_height"],
            "label": lbl,
            "points": [],
        })

    out = {
        "walls": walls,
        "hatchOuter": hatch_outer,
        "hatchHoles": [],
        "objects": [],
        "doors": doors,
        "windows": windows,
        "_meta": {
            "source": str(DXF.name),
            "originalCenter": [round(cx, 4), round(cy, 4)],
            "extents": {
                "minX": round(min(xs) - cx, 4), "maxX": round(max(xs) - cx, 4),
                "minY": round(min(ys) - cy, 4), "maxY": round(max(ys) - cy, 4),
                "widthM": round(max(xs) - min(xs), 4),
                "heightM": round(max(ys) - min(ys), 4),
            },
            "counts": {
                "wallsOut": len(walls),
                "doorsOut": len(doors),
                "windowsOut": len(windows),
                "doorsByKind": {k: sum(1 for d in doors if d["kind"] == k) for k in ("swing", "double", "sliding")},
                "windowsFullHeight": sum(1 for w in windows if w["fullHeight"]),
            },
        },
    }
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(f"Wrote {OUT}")
    print(f"  walls: {len(walls)} (hatchOuter: {'yes' if hatch_outer else 'no'})")
    print(f"  doors: {len(doors)} (swing={out['_meta']['counts']['doorsByKind']['swing']} "
          f"double={out['_meta']['counts']['doorsByKind']['double']} "
          f"sliding={out['_meta']['counts']['doorsByKind']['sliding']})")
    print(f"  windows: {len(windows)} (full-height={out['_meta']['counts']['windowsFullHeight']})")
    print(f"  bbox local: w={out['_meta']['extents']['widthM']}m h={out['_meta']['extents']['heightM']}m")


if __name__ == "__main__":
    main()
