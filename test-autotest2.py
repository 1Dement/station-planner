"""Autotest v2 — uses window.__sp debug refs to verify scene state directly."""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

OUT = "C:/dev/station-planner/test-out"
os.makedirs(OUT, exist_ok=True)

CONSOLE = []
ERRORS = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: CONSOLE.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: ERRORS.append(str(e)))

    print("=== Step 1: Load page ===", flush=True)
    page.goto("http://localhost:3700")
    page.wait_for_load_state("networkidle", timeout=30000)
    page.wait_for_selector("canvas", timeout=20000)
    page.wait_for_timeout(3000)

    # Verify __sp debug object available
    has_sp = page.evaluate("() => typeof window.__sp !== 'undefined'")
    print(f"DEBUG_SP_EXPOSED: {has_sp}", flush=True)

    print("=== Step 2: Switch camera to top-down via JS ===", flush=True)
    page.evaluate("() => window.__sp.setTopDown()")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/B1-topdown.png", full_page=True)

    print("=== Step 3: Upload PNG + PGW backdrop ===", flush=True)
    file_input = page.locator("input[type='file'][accept*='pgw']").first
    png = "C:/dev/station-planner/public/test-data/ortofoto-test.png"
    pgw = "C:/dev/station-planner/public/test-data/ortofoto-test.pgw"
    file_input.set_input_files([png, pgw])
    page.wait_for_timeout(2500)

    has_backdrop = page.evaluate("() => window.__sp.hasBackdrop()")
    backdrop_pos = page.evaluate("""() => {
        const m = window.__sp.backdropMeshRef.current;
        if (!m) return null;
        const dims = m.geometry.parameters;
        return { x: m.position.x, y: m.position.y, z: m.position.z, w: dims.width, h: dims.height };
    }""")
    print(f"BACKDROP_IN_SCENE: {has_backdrop}, pos/dim: {backdrop_pos}", flush=True)
    page.screenshot(path=f"{OUT}/B2-backdrop-topdown.png", full_page=True)

    print("=== Step 4: Enter wall draw mode ===", flush=True)
    page.locator("text=Deseneaza perete").first.click()
    page.wait_for_timeout(400)

    print("=== Step 5: Draw 4 walls forming a 6x6m room ===", flush=True)
    canvases = page.locator("canvas").all()
    canvas = max(canvases, key=lambda c: (c.bounding_box() or {}).get("width", 0) * (c.bounding_box() or {}).get("height", 0))
    box = canvas.bounding_box()
    cx_b, cy_b = box["width"] / 2, box["height"] / 2
    # Top-down camera at (0, 25, 0.001) looking at origin → 1 m ≈ 30-40 px at this zoom
    # Use 200 px offsets for ~6 m room
    offsets = [(-200, -200), (200, -200), (200, 200), (-200, 200), (-200, -200)]
    for i, (dx, dy) in enumerate(offsets):
        canvas.click(position={"x": cx_b + dx, "y": cy_b + dy}, force=True)
        page.wait_for_timeout(400)
        wc = page.evaluate("() => window.__sp.countWalls()")
        print(f"  click {i+1} → walls in scene: {wc}", flush=True)

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    final_walls = page.evaluate("""() => {
        const ws = window.__sp.wallsRef.current;
        return ws.map(w => ({
            id: w.id,
            start: w.start,
            end: w.end,
            len: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
            thickness: w.thickness,
            height: w.height,
        }));
    }""")
    print(f"FINAL_WALLS_DATA:", flush=True)
    for w in final_walls:
        print(f"  {w['id']}: ({w['start']['x']:.2f},{w['start']['y']:.2f}) → ({w['end']['x']:.2f},{w['end']['y']:.2f}) len={w['len']:.2f}m", flush=True)

    page.screenshot(path=f"{OUT}/B3-walls-drawn-topdown.png", full_page=True)

    print("=== Step 6: Toggle to 2D ===", flush=True)
    page.locator("button:has-text('3D')").first.click()
    page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/B4-2d-mode.png", full_page=True)

    print("=== Step 7: Camera to default 3D + render walls extruded ===", flush=True)
    page.evaluate("""() => {
        window.__sp.camera.position.set(15, 12, 15);
        window.__sp.orbit.target.set(0, 0, 0);
        window.__sp.orbit.update();
    }""")
    # Toggle back to 3D
    page.locator("button:has-text('2D')").first.click()
    page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/B5-3d-extruded.png", full_page=True)

    print("=== Step 8: Export IFC ===", flush=True)
    with page.expect_download(timeout=10000) as dl_info:
        page.locator("button:has-text('Export IFC')").first.click()
    dl = dl_info.value
    ifc_path = os.path.join(OUT, "exported2.ifc")
    dl.save_as(ifc_path)
    with open(ifc_path, "r", encoding="utf-8") as f:
        ifc = f.read()
    walls_in_ifc = len(re.findall(r"IFCWALLSTANDARDCASE\(", ifc))
    print(f"IFC: {os.path.getsize(ifc_path)} bytes, {len(ifc.splitlines())} lines, {walls_in_ifc} walls", flush=True)
    # Check headers
    print(f"  ISO header: {ifc.startswith('ISO-10303-21;')}", flush=True)
    print(f"  IFC4 schema: {chr(10).join(re.findall(r'FILE_SCHEMA[^;]+', ifc))}", flush=True)
    print(f"  IFCPROJECT: {bool(re.search(r'IFCPROJECT', ifc))}", flush=True)
    print(f"  IFCSITE: {bool(re.search(r'IFCSITE', ifc))}", flush=True)
    print(f"  IFCBUILDING: {bool(re.search(r'IFCBUILDING', ifc))}", flush=True)
    print(f"  IFCBUILDINGSTOREY: {bool(re.search(r'IFCBUILDINGSTOREY', ifc))}", flush=True)
    print(f"  IFCMATERIAL: {bool(re.search(r'IFCMATERIAL\(', ifc))}", flush=True)
    print(f"  IFCEXTRUDEDAREASOLID: {len(re.findall(r'IFCEXTRUDEDAREASOLID', ifc))} occurrences", flush=True)
    print(f"  IFCRELAGGREGATES: {len(re.findall(r'IFCRELAGGREGATES', ifc))}", flush=True)
    print(f"  IFCRELCONTAINEDINSPATIALSTRUCTURE: {len(re.findall(r'IFCRELCONTAINEDINSPATIALSTRUCTURE', ifc))}", flush=True)

    browser.close()

print("\n=== JS ERRORS ===")
for e in ERRORS:
    print(e)

print(f"\n=== Screenshots in {OUT} ===")
for f in sorted(os.listdir(OUT)):
    if f.startswith("B"):
        print(f"  {f}: {os.path.getsize(os.path.join(OUT, f))} bytes")
