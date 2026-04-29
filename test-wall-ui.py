"""Verify Station Planner wall drawing UI + PGW upload flow."""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
from pathlib import Path
import json

CONSOLE = []
ERRORS = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: CONSOLE.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: ERRORS.append(str(e)))

    page.goto("http://localhost:3700")
    page.wait_for_load_state("networkidle", timeout=30000)
    # Wait for editor (canvas appears once SceneEditor mounts)
    try:
        page.wait_for_selector("canvas", timeout=20000)
    except Exception as e:
        print(f"NO_CANVAS: {e}")

    page.wait_for_timeout(2500)
    page.screenshot(path="C:/dev/station-planner/test-out/01-loaded.png", full_page=True)

    # Probe DOM
    text_content = page.locator("body").inner_text()[:1000]
    print("BODY_TEXT:", text_content[:600])

    # Look for wall toolbar
    wall_btn = page.locator("text=Deseneaza perete").first
    wall_btn_visible = wall_btn.is_visible() if wall_btn.count() > 0 else False
    print(f"WALL_BUTTON_VISIBLE: {wall_btn_visible}")

    if wall_btn_visible:
        wall_btn.click()
        page.wait_for_timeout(500)
        page.screenshot(path="C:/dev/station-planner/test-out/02-wall-mode.png", full_page=True)

        # Pick the LARGEST canvas (Three.js renderer; other = small dev tool)
        canvases = page.locator("canvas").all()
        print(f"CANVAS_COUNT: {len(canvases)}", flush=True)
        canvas = None
        max_area = 0
        for i, c in enumerate(canvases):
            bb = c.bounding_box()
            print(f"  canvas[{i}]: bbox={bb}", flush=True)
            if bb:
                area = bb["width"] * bb["height"]
                if area > max_area:
                    max_area = area
                    canvas = c
        if canvas is None:
            print("NO_CANVAS_FOUND", flush=True)
        else:
            box = canvas.bounding_box()
            print(f"USING_CANVAS bbox={box}", flush=True)
            cx_base, cy_base = box["width"] / 2, box["height"] / 2
            offsets = [(-150, -100), (150, -100), (150, 100), (-150, 100), (-150, -100)]
            for dx, dy in offsets:
                canvas.click(position={"x": cx_base + dx, "y": cy_base + dy}, force=True)
                page.wait_for_timeout(400)
        page.wait_for_timeout(500)
        page.screenshot(path="C:/dev/station-planner/test-out/03-walls-drawn.png", full_page=True)

        # Read wall count
        try:
            wall_count_text = page.locator("text=Pereti:").first.inner_text()
            print(f"WALL_COUNT_LABEL: {wall_count_text}")
        except Exception:
            pass

        # Press ESC to exit wall mode
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        page.screenshot(path="C:/dev/station-planner/test-out/04-after-esc.png", full_page=True)

    # Try to toggle 2D
    try:
        view_btn = page.locator("button:has-text('3D')").first
        if view_btn.is_visible():
            view_btn.click()
            page.wait_for_timeout(800)
            page.screenshot(path="C:/dev/station-planner/test-out/05-2d-mode.png", full_page=True)
    except Exception as e:
        print(f"VIEW_TOGGLE_ERR: {e}")

    # Upload PNG + PGW backdrop
    try:
        file_input = page.locator("input[type='file'][accept*='pgw']").first
        png = "C:/dev/station-planner/public/test-data/ortofoto-test.png"
        pgw = "C:/dev/station-planner/public/test-data/ortofoto-test.pgw"
        file_input.set_input_files([png, pgw])
        page.wait_for_timeout(1500)
        page.screenshot(path="C:/dev/station-planner/test-out/06-backdrop-loaded.png", full_page=True)
        # Read status
        status = page.locator("text=Backdrop").all_text_contents()
        print(f"BACKDROP_STATUS: {status}")
    except Exception as e:
        print(f"UPLOAD_ERR: {e}")

    # IFC export — won't be tested fully (download), just check button state
    try:
        export_btn = page.locator("button:has-text('Export IFC')").first
        print(f"EXPORT_IFC_ENABLED: {not export_btn.is_disabled()}")
    except Exception as e:
        print(f"EXPORT_BTN_ERR: {e}")

    browser.close()

print("\n=== CONSOLE ===")
for line in CONSOLE[-25:]:
    print(line)
print("\n=== ERRORS ===")
for e in ERRORS:
    print(e)
print(f"\nScreenshots in C:/dev/station-planner/test-out/")
