"""Final autotest: REAL X-Ray + draw walls + add doors + windows + export IFC."""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

OUT = "C:/dev/station-planner/test-out"
PNG = "C:/dev/station-planner/public/test-data/xray/XRay_OR_Statie_OMW_Pipera_Interior.png"
PGW = "C:/dev/station-planner/public/test-data/xray/XRay_OR_Statie_OMW_Pipera_Interior.pgw"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.goto("http://localhost:3700")
    page.wait_for_load_state("networkidle", timeout=30000)
    page.wait_for_selector("canvas", timeout=20000)
    page.wait_for_timeout(2500)

    # Top-down @ altitude 35
    page.evaluate("() => window.__sp.setTopDown(35)")
    page.wait_for_timeout(300)

    # Hide preloaded building
    page.evaluate("""() => {
        const keep = new Set([
            window.__sp.wallGroup,
            window.__sp.previewLine,
            window.__sp.snapMarkerRef.current,
        ].filter(Boolean));
        for (const child of [...window.__sp.scene.children]) {
            if (keep.has(child)) continue;
            if (child.isLight) continue;
            if (child.type === 'Mesh' || child.type === 'Group') child.visible = false;
            if (child.type === 'GridHelper') child.visible = false;
        }
    }""")

    # Upload X-Ray
    page.locator("input[type='file'][accept*='pgw']").first.set_input_files([PNG, PGW])
    page.wait_for_timeout(2000)

    canvases = page.locator("canvas").all()
    canvas = max(canvases, key=lambda c: (c.bounding_box() or {}).get("width", 0) * (c.bounding_box() or {}).get("height", 0))
    box = canvas.bounding_box()
    cx, cy = box["width"] / 2, box["height"] / 2

    # === DRAW 4 OUTER WALLS ===
    print("=== Drawing 4 outer walls ===", flush=True)
    # Click the toolbar's wall button (button containing "Perete" but NOT in catalog list)
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            if (b.textContent.trim() === 'Perete') { b.click(); return; }
        }
    }""")
    page.wait_for_timeout(400)
    px_per_m = 28  # at altitude 35 with FOV 50
    corners = [(-12, 8), (12, 8), (12, -10), (-12, -10), (-12, 8)]
    for mx, my in corners:
        canvas.click(position={"x": cx + mx * px_per_m, "y": cy - my * px_per_m}, force=True)
        page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    wc = page.evaluate("() => window.__sp.countWalls()")
    print(f"  walls drawn: {wc}", flush=True)
    page.screenshot(path=f"{OUT}/D1-walls-only.png", full_page=True)

    # === ADD 2 DOORS on first 2 walls ===
    print("=== Adding doors (click middle of walls 1 + 2) ===", flush=True)
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.trim() === 'Usa') { b.click(); return; } }
    }""")
    page.wait_for_timeout(400)
    # Wall 1: top (y=+8m), span x=-12..12 → middle = (0, 8)
    canvas.click(position={"x": cx + 0, "y": cy - 8 * px_per_m}, force=True)
    page.wait_for_timeout(400)
    # Wall 2: right (x=+12m), span y=-10..8 → middle = (12, -1)
    canvas.click(position={"x": cx + 12 * px_per_m, "y": cy - (-1) * px_per_m}, force=True)
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    hc = page.evaluate("() => window.__sp.countHoles()")
    print(f"  doors added: {hc}", flush=True)

    # === ADD 2 WINDOWS on walls 3 + 4 ===
    print("=== Adding windows (walls 3 + 4) ===", flush=True)
    page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.trim() === 'Geam') { b.click(); return; } }
    }""")
    page.wait_for_timeout(400)
    # Wall 3: bottom (y=-10), middle = (0, -10)
    canvas.click(position={"x": cx + 0, "y": cy - (-10) * px_per_m}, force=True)
    page.wait_for_timeout(400)
    # Wall 4: left (x=-12), middle = (-12, -1)
    canvas.click(position={"x": cx + (-12) * px_per_m, "y": cy - (-1) * px_per_m}, force=True)
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    hc = page.evaluate("() => window.__sp.countHoles()")
    print(f"  total holes: {hc}", flush=True)

    page.screenshot(path=f"{OUT}/D2-walls-doors-windows.png", full_page=True)

    # === Switch to perspective 3D to see panels ===
    page.evaluate("""() => {
        window.__sp.camera.position.set(20, 14, 22);
        window.__sp.orbit.target.set(0, 1.5, 0);
        window.__sp.orbit.update();
    }""")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/D3-3d-perspective.png", full_page=True)

    # Walk-thru: closer view of one wall
    page.evaluate("""() => {
        window.__sp.camera.position.set(0, 1.7, 14);
        window.__sp.orbit.target.set(0, 1.7, 0);
        window.__sp.orbit.update();
    }""")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/D4-3d-eye-level.png", full_page=True)

    # Inspect holes data
    holes = page.evaluate("() => window.__sp.holesRef.current")
    print(f"\nHOLES DATA:", flush=True)
    for h in holes:
        print(f"  {h['kind']}: wall={h['wallId'][-8:]}, offset={h['offset']:.2f}m, w={h['width']}m, h={h['height']}m, sill={h['sillHeight']}m", flush=True)

    # === EXPORT IFC ===
    print("\n=== Export IFC ===", flush=True)
    with page.expect_download(timeout=10000) as dl_info:
        page.locator("button:has-text('Export IFC')").first.click()
    dl = dl_info.value
    ifc_path = os.path.join(OUT, "doors-windows.ifc")
    dl.save_as(ifc_path)
    with open(ifc_path, "r", encoding="utf-8") as f:
        ifc = f.read()

    counts = {
        'IFCWALLSTANDARDCASE': len(re.findall(r"IFCWALLSTANDARDCASE\(", ifc)),
        'IFCDOOR': len(re.findall(r"IFCDOOR\(", ifc)),
        'IFCWINDOW': len(re.findall(r"IFCWINDOW\(", ifc)),
        'IFCOPENINGELEMENT': len(re.findall(r"IFCOPENINGELEMENT\(", ifc)),
        'IFCRELVOIDSELEMENT': len(re.findall(r"IFCRELVOIDSELEMENT\(", ifc)),
        'IFCRELFILLSELEMENT': len(re.findall(r"IFCRELFILLSELEMENT\(", ifc)),
        'IFCEXTRUDEDAREASOLID': len(re.findall(r"IFCEXTRUDEDAREASOLID\(", ifc)),
        'IFCMATERIAL': len(re.findall(r"IFCMATERIAL\(", ifc)),
    }
    print(f"IFC: {os.path.getsize(ifc_path)} bytes, {len(ifc.splitlines())} lines", flush=True)
    for k, v in counts.items():
        print(f"  {k}: {v}", flush=True)

    browser.close()

print("\n=== Errors ===")
for e in errs: print(e)
print("\n=== Screenshots ===")
for f in sorted(os.listdir(OUT)):
    if f.startswith("D"):
        print(f"  {f}: {os.path.getsize(os.path.join(OUT, f))} bytes")
