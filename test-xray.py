"""Test with REAL OMW Pipera X-Ray scan + draw walls along visible building lines."""
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

    print("=== 1. Load page ===", flush=True)
    page.goto("http://localhost:3700")
    page.wait_for_load_state("networkidle", timeout=30000)
    page.wait_for_selector("canvas", timeout=20000)
    page.wait_for_timeout(2500)

    print("=== 2. Top-down view (zoom out for ~26x23m building) ===", flush=True)
    # Camera at 35m altitude, looking down at origin → 26x23m fits in viewport
    page.evaluate("""() => {
        window.__sp.camera.position.set(0, 35, 0.001);
        window.__sp.orbit.target.set(0, 0, 0);
        window.__sp.orbit.update();
    }""")
    page.wait_for_timeout(500)

    print("=== 3. Upload REAL X-Ray + PGW ===", flush=True)
    file_input = page.locator("input[type='file'][accept*='pgw']").first
    file_input.set_input_files([PNG, PGW])
    page.wait_for_timeout(2000)

    bd = page.evaluate("""() => {
        const m = window.__sp.backdropMeshRef.current;
        if (!m) return null;
        const dims = m.geometry.parameters;
        return { x: m.position.x, y: m.position.y, z: m.position.z, w: dims.width, h: dims.height,
                 wo: m.userData.worldOffset };
    }""")
    print(f"BACKDROP: {bd}", flush=True)
    page.screenshot(path=f"{OUT}/X1-xray-loaded.png", full_page=True)

    # Hide existing pre-loaded building so backdrop is fully visible
    print("=== 4. Hide existing building geometry ===", flush=True)
    hidden = page.evaluate("""() => {
        let count = 0;
        window.__sp.scene.traverse(o => {
            if (o.userData && (o.userData.isWall || o.userData.isBuilding)) { o.visible = false; count++; }
            // Hide non-backdrop, non-wall meshes that aren't our wallGroup or backdrop
        });
        // Brute force: hide everything except our wall group, backdrop, lights, camera helpers
        const keep = new Set(['user-walls']);
        const keepObjects = new Set([
            window.__sp.wallGroup,
            window.__sp.backdropMeshRef.current,
            window.__sp.previewLine,
            window.__sp.snapMarkerRef.current,
        ].filter(Boolean));
        let hidden2 = 0;
        for (const child of [...window.__sp.scene.children]) {
            if (keepObjects.has(child)) continue;
            if (child.isLight) continue;
            if (child.type === 'GridHelper') { child.visible = false; hidden2++; continue; }
            if (child.type === 'Mesh' || child.type === 'Group') {
                child.visible = false;
                hidden2++;
            }
        }
        return { generic_hidden: count, mesh_hidden: hidden2, total_children: window.__sp.scene.children.length };
    }""")
    print(f"HIDE_RESULT: {hidden}", flush=True)
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/X2-xray-clean.png", full_page=True)

    print("=== 5. Trace walls along visible X-Ray edges ===", flush=True)
    page.locator("text=Deseneaza perete").first.click()
    page.wait_for_timeout(400)

    canvases = page.locator("canvas").all()
    canvas = max(canvases, key=lambda c: (c.bounding_box() or {}).get("width", 0) * (c.bounding_box() or {}).get("height", 0))
    box = canvas.bounding_box()
    print(f"CANVAS_BOX: {box}", flush=True)
    cx, cy = box["width"] / 2, box["height"] / 2

    # Camera at altitude 35 looking down → in pixel coords, image scale = ?
    # We'll trace along the X-Ray's outer building outline. The X-Ray is 26x23m centered at origin.
    # At cam altitude 35 with default FOV 50°, visible width ≈ 2*35*tan(25°) ≈ 32.6m
    # → 1m ≈ canvas_width / 32.6 = 1312 / 32.6 ≈ 40 px
    # Outer boundary in image local coords: roughly from (-12, -10) to (+12, +10) in scene meters
    # Map to canvas px: (cx + lx*40, cy - ly*40)
    px_per_m = 40

    # Outer rectangle of building (rough trace from screenshot)
    corners_m = [
        (-12, 8), (12, 8), (12, -10), (-12, -10), (-12, 8),
    ]
    for i, (mx, my) in enumerate(corners_m):
        px_x = cx + mx * px_per_m
        px_y = cy - my * px_per_m
        canvas.click(position={"x": px_x, "y": px_y}, force=True)
        page.wait_for_timeout(350)
        wc = page.evaluate("() => window.__sp.countWalls()")
        print(f"  click {i+1} at ({mx:+.1f}m, {my:+.1f}m) px=({px_x:.0f},{px_y:.0f}) → walls={wc}", flush=True)

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    walls = page.evaluate("""() => window.__sp.wallsRef.current.map(w => ({
        s: w.start, e: w.end,
        len: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
    }))""")
    print(f"\nWALLS_DRAWN ({len(walls)}):", flush=True)
    total_perim = 0
    for i, w in enumerate(walls):
        print(f"  {i+1}: ({w['s']['x']:+.2f}, {w['s']['y']:+.2f}) → ({w['e']['x']:+.2f}, {w['e']['y']:+.2f}) len={w['len']:.2f}m", flush=True)
        total_perim += w['len']
    print(f"  Total perimeter: {total_perim:.2f}m", flush=True)

    page.screenshot(path=f"{OUT}/X3-walls-traced.png", full_page=True)

    print("=== 6. Switch to 3D perspective view ===", flush=True)
    page.evaluate("""() => {
        window.__sp.camera.position.set(20, 18, 20);
        window.__sp.orbit.target.set(0, 0, 0);
        window.__sp.orbit.update();
    }""")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/X4-3d-extruded.png", full_page=True)

    print("=== 7. Export IFC ===", flush=True)
    with page.expect_download(timeout=10000) as dl_info:
        page.locator("button:has-text('Export IFC')").first.click()
    dl = dl_info.value
    ifc_path = os.path.join(OUT, "xray-traced.ifc")
    dl.save_as(ifc_path)
    with open(ifc_path, "r", encoding="utf-8") as f:
        ifc = f.read()
    walls_in_ifc = len(re.findall(r"IFCWALLSTANDARDCASE\(", ifc))
    print(f"IFC: {os.path.getsize(ifc_path)} bytes, {len(ifc.splitlines())} lines, {walls_in_ifc} IfcWall", flush=True)

    browser.close()

print("\n=== Errors ===")
for e in errs: print(e)
print("\n=== Screenshots ===")
for f in sorted(os.listdir(OUT)):
    if f.startswith("X"):
        print(f"  {f}: {os.path.getsize(os.path.join(OUT, f))} bytes")
