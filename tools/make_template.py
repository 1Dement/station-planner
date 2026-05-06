"""
make_template.py -- generate TEMPLATE_RELEVEU.dxf with layer convention + examples
Run: python tools/make_template.py
Output: U:\\TEMPLATE_RELEVEU.dxf  -> convert to DWG via ODA
"""
import math
from pathlib import Path
import ezdxf

OUT_DXF = Path(r"U:\TEMPLATE_RELEVEU.dxf")

doc = ezdxf.new(dxfversion="R2018", setup=True)
doc.units = 6  # meters
msp = doc.modelspace()

# ----- LAYERS -----
LAYERS = {
    "PERETI":   {"color": 8,  "desc": "Pereti - HATCH plin"},
    "USI":      {"color": 1,  "desc": "Usi - ARC swing per usa + TEXT"},
    "GEAMURI":  {"color": 4,  "desc": "Geamuri - 3 linii paralele + TEXT"},
    "TEXT_INFO":{"color": 7,  "desc": "Etichete tip + dimensiuni"},
}
for name, props in LAYERS.items():
    if name not in doc.layers:
        doc.layers.add(name=name, color=props["color"])

TXT_STYLE = "Standard"

# ----- HELPERS -----
def add_wall_hatch(pts):
    """Add closed hatch on PERETI (one wall stripe)."""
    h = msp.add_hatch(color=8, dxfattribs={"layer": "PERETI"})
    h.paths.add_polyline_path(pts, is_closed=True)

def add_door(hinge, width, start_angle_deg, swing_ccw=True, label="USA 90"):
    """Add door arc on USI + label on TEXT_INFO."""
    end_deg = start_angle_deg + (90 if swing_ccw else -90)
    msp.add_arc(
        center=hinge,
        radius=width,
        start_angle=min(start_angle_deg, end_deg),
        end_angle=max(start_angle_deg, end_deg),
        dxfattribs={"layer": "USI"},
    )
    msp.add_text(label, height=0.15, dxfattribs={"layer": "TEXT_INFO"}).set_placement(
        (hinge[0] + 0.1, hinge[1] - 0.3)
    )

def add_window(start, end, label="GEAM 120 H90"):
    """Add 3 parallel lines (window) + label on TEXT_INFO."""
    sx, sy = start
    ex, ey = end
    L = math.hypot(ex - sx, ey - sy)
    nx, ny = -(ey - sy) / L, (ex - sx) / L  # perpendicular unit
    THK = 0.20  # window total thickness
    for off in (-THK / 2, 0, THK / 2):
        msp.add_lwpolyline(
            [(sx + nx * off, sy + ny * off), (ex + nx * off, ey + ny * off)],
            dxfattribs={"layer": "GEAMURI"},
        )
    mx, my = (sx + ex) / 2, (sy + ey) / 2
    msp.add_text(label, height=0.15, dxfattribs={"layer": "TEXT_INFO"}).set_placement(
        (mx + nx * (THK / 2 + 0.4), my + ny * (THK / 2 + 0.4))
    )

# ----- LEGEND TEXT (top) -----
legend = [
    "TEMPLATE RELEVEU - Conventie layere & etichete",
    "",
    "PERETI: HATCH plin per stripa zid",
    "USI: ARC swing pe layer USI + TEXT alaturat",
    "GEAMURI: 3 linii paralele pe layer GEAMURI + TEXT",
    "",
    "USA 90              -> swing, latime 90 cm",
    "USA DUBLA 160       -> 2 ARCs apropiate, latime totala 160 cm",
    "USA GLISANTA 200    -> opening sliding, latime 200 cm (no swing)",
    "GEAM 120 H90        -> fereastra 120 cm, sill 90 cm",
    "GEAM PANOU 200      -> vitrina full-height 200 cm (sill 0)",
]
for i, ln in enumerate(legend):
    msp.add_text(ln, height=0.25, dxfattribs={"layer": "TEXT_INFO"}).set_placement(
        (0, 25 - i * 0.5)
    )

# ----- EXAMPLE 1: simple room with 1 door + 1 window -----
# Room A: 4x3m, door on south wall, window on north wall
# Walls = 4 stripe rectangles (perimeter walls each rendered as closed hatch)
THK = 0.20  # wall thickness
def wall_rect(x1, y1, x2, y2, thk=THK):
    """Wall stripe between (x1,y1)-(x2,y2) with given thickness."""
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * thk / 2, dx / L * thk / 2
    return [
        (x1 + nx, y1 + ny),
        (x2 + nx, y2 + ny),
        (x2 - nx, y2 - ny),
        (x1 - nx, y1 - ny),
    ]

# Room A perimeter (4x3m at origin), door 90cm in south wall (mid), window 120cm in north
# south wall: split around door at x=1.5..2.4
add_wall_hatch(wall_rect(0, 0, 1.5, 0))
add_wall_hatch(wall_rect(2.4, 0, 4, 0))
# north wall: split around window at x=1.4..2.6
add_wall_hatch(wall_rect(0, 3, 1.4, 3))
add_wall_hatch(wall_rect(2.6, 3, 4, 3))
# west wall (full)
add_wall_hatch(wall_rect(0, 0, 0, 3))
# east wall (full)
add_wall_hatch(wall_rect(4, 0, 4, 3))

# Door: hinge at (1.5, 0.1), swing 90 deg into room (CCW from 0)
add_door(hinge=(1.5, 0.1), width=0.9, start_angle_deg=0, swing_ccw=True, label="USA 90")
# Window 120cm wide, sill 90cm
add_window(start=(1.4, 3.0), end=(2.6, 3.0), label="GEAM 120 H90")

# ----- EXAMPLE 2: USA DUBLA (double door) -----
# Two arcs swinging toward each other in 2m wide opening at y=-2
add_wall_hatch(wall_rect(0, -2, 1.0, -2))
add_wall_hatch(wall_rect(3.0, -2, 4, -2))
add_door(hinge=(1.0, -1.9), width=1.0, start_angle_deg=0, swing_ccw=True, label="USA DUBLA 160")
add_door(hinge=(3.0, -1.9), width=1.0, start_angle_deg=180, swing_ccw=False, label="")

# ----- EXAMPLE 3: USA GLISANTA + GEAM PANOU (storefront) -----
add_wall_hatch(wall_rect(0, -5, 0.5, -5))
add_wall_hatch(wall_rect(3.5, -5, 4, -5))
# Sliding door 200cm gap (no arc, just label) -- using a special arc with very small radius as marker
# Convention: USA GLISANTA = an arc with radius LARGER than 1.6m (out of standard door range)
# OR: just text label + opening (no arc). For template, use an arc r=0.2 as placeholder
msp.add_arc(center=(2.0, -4.9), radius=0.2,
            start_angle=0, end_angle=180,
            dxfattribs={"layer": "USI"})
msp.add_text("USA GLISANTA 200", height=0.15, dxfattribs={"layer": "TEXT_INFO"}).set_placement(
    (1.2, -5.4)
)

# Glass storefront panel (full height, 250cm wide)
add_window(start=(5.0, -5.0), end=(7.5, -5.0), label="GEAM PANOU 250")

OUT_DXF.parent.mkdir(parents=True, exist_ok=True)
doc.saveas(OUT_DXF)
print(f"Wrote {OUT_DXF}")
print("Convert DXF->DWG: open in CAD or run ODA File Converter")
