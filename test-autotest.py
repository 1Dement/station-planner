"""Aggressive auto-test: load PNG+PGW, draw walls, export IFC, verify contents."""
import sys, io, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

OUT = "C:/dev/station-planner/test-out"
os.makedirs(OUT, exist_ok=True)

CONSOLE = []
ERRORS = []

# Intercept download
DOWNLOAD_PATH = None

def on_download(d):
    global DOWNLOAD_PATH
    DOWNLOAD_PATH = os.path.join(OUT, d.suggested_filename)
    d.save_as(DOWNLOAD_PATH)
    print(f"[DOWNLOAD] {DOWNLOAD_PATH}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: CONSOLE.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: ERRORS.append(str(e)))
    page.on("download", on_download)

    print("=== Step 1: Load page ===", flush=True)
    page.goto("http://localhost:3700")
    page.wait_for_load_state("networkidle", timeout=30000)
    page.wait_for_selector("canvas", timeout=20000)
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/A1-loaded.png", full_page=True)

    print("=== Step 2: Upload PNG + PGW backdrop ===", flush=True)
    file_input = page.locator("input[type='file'][accept*='pgw']").first
    png = "C:/dev/station-planner/public/test-data/ortofoto-test.png"
    pgw = "C:/dev/station-planner/public/test-data/ortofoto-test.pgw"
    file_input.set_input_files([png, pgw])
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/A2-backdrop-loaded.png", full_page=True)

    # Inspect scene via page.evaluate — count meshes, find backdrop
    scene_info = page.evaluate("""() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return {error: 'no canvas'};
        // Three.js stores its scene on the renderer; we can't easily reach it from outside.
        // But we can probe via the global if exposed.
        return {
            canvases: document.querySelectorAll('canvas').length,
            hasFileInput: !!document.querySelector("input[type='file'][accept*='pgw']"),
        };
    }""")
    print(f"SCENE_INFO: {scene_info}", flush=True)

    # Force top-down view by rotating with mouse drag (OrbitControls)
    print("=== Step 3: Rotate camera to top-down ===", flush=True)
    canvases = page.locator("canvas").all()
    canvas = max(canvases, key=lambda c: (c.bounding_box() or {}).get("width", 0) * (c.bounding_box() or {}).get("height", 0))
    box = canvas.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    # Drag from middle upward to rotate camera to top-down
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx, cy - 400, steps=20)  # drag up = rotate to top-down
    page.mouse.up()
    page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/A3-topdown-with-backdrop.png", full_page=True)

    print("=== Step 4: Enter wall draw mode ===", flush=True)
    wall_btn = page.locator("text=Deseneaza perete").first
    wall_btn.click()
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/A4-wall-mode.png", full_page=True)

    print("=== Step 5: Draw 4 walls forming a room ===", flush=True)
    cx_b, cy_b = box["width"] / 2, box["height"] / 2
    # Larger room — closer to default building scale
    offsets = [(-200, -150), (200, -150), (200, 150), (-200, 150), (-200, -150)]
    for i, (dx, dy) in enumerate(offsets):
        canvas.click(position={"x": cx_b + dx, "y": cy_b + dy}, force=True)
        page.wait_for_timeout(400)
        print(f"  click {i+1}: ({cx_b + dx:.0f}, {cy_b + dy:.0f})", flush=True)
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/A5-walls-drawn.png", full_page=True)

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # Read wall count from UI
    try:
        wall_count_html = page.locator(".text-\\[11px\\]:has-text('Pereti:')").first.inner_text()
        print(f"WALL_COUNT_LABEL: {wall_count_html}", flush=True)
    except Exception as e:
        print(f"WALL_LABEL_ERR: {e}", flush=True)

    print("=== Step 6: Toggle 2D mode ===", flush=True)
    try:
        view_btn = page.locator("button:has-text('3D')").first
        if view_btn.is_visible():
            view_btn.click()
            page.wait_for_timeout(800)
            page.screenshot(path=f"{OUT}/A6-2d-walls.png", full_page=True)
    except Exception as e:
        print(f"2D_TOGGLE_ERR: {e}", flush=True)

    print("=== Step 7: Export IFC (download interception) ===", flush=True)
    with page.expect_download(timeout=10000) as dl_info:
        export_btn = page.locator("button:has-text('Export IFC')").first
        export_btn.click()
    dl = dl_info.value
    ifc_path = os.path.join(OUT, "exported.ifc")
    dl.save_as(ifc_path)
    print(f"IFC_DOWNLOADED: {ifc_path} size={os.path.getsize(ifc_path)} bytes", flush=True)

    # Validate IFC content
    with open(ifc_path, "r", encoding="utf-8") as f:
        ifc = f.read()
    print(f"IFC_LINES: {len(ifc.splitlines())}", flush=True)
    import re
    walls_in_ifc = len(re.findall(r"IFCWALLSTANDARDCASE\(", ifc))
    has_header = ifc.startswith("ISO-10303-21;")
    has_schema = "FILE_SCHEMA(('IFC4'" in ifc
    has_project = "IFCPROJECT(" in ifc
    has_site = "IFCSITE(" in ifc
    has_building = "IFCBUILDING(" in ifc
    has_storey = "IFCBUILDINGSTOREY(" in ifc
    has_material = "IFCMATERIAL(" in ifc
    print(f"IFC_VALIDATION:", flush=True)
    print(f"  header_ok={has_header}", flush=True)
    print(f"  schema_ok={has_schema}", flush=True)
    print(f"  project={has_project}, site={has_site}, building={has_building}, storey={has_storey}", flush=True)
    print(f"  material={has_material}", flush=True)
    print(f"  walls_in_ifc={walls_in_ifc}", flush=True)

    print("=== Step 8: Final screenshot ===", flush=True)
    page.screenshot(path=f"{OUT}/A7-final.png", full_page=True)

    browser.close()

print("\n=== CONSOLE (last 15) ===")
for line in CONSOLE[-15:]:
    print(line)
print("\n=== JS ERRORS ===")
for e in ERRORS:
    print(e)
print(f"\n=== Screenshots ===")
for f in sorted(os.listdir(OUT)):
    if f.startswith("A"):
        size = os.path.getsize(os.path.join(OUT, f))
        print(f"  {f}: {size} bytes")
