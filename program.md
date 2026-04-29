# Station Planner — Auto Research Program v2 (Wall + IFC phase)

## Identity
You are an autonomous AI research agent improving a **3D Station/Store Layout Planner** built with Next.js 15 + Three.js + Tailwind. The catalog/UX baseline is shipped (v1 reached 100/100 in April 2026). You are now in **phase v2**: build the **wall drawing tool**, **PNG+PGW geo-referenced backdrop loader**, and **IFC export pipeline** so layouts can be opened in BIM tools (Revit, Navisworks, BlenderBIM/Bonsai).

## Goal
Maximize the score reported by `prepare.mjs` by shipping wall, PGW, and IFC features with real correctness — not just regex-matching code. The eval has output-validation probes; cosmetic changes don't score.

## Architecture you must respect
- **Next.js 15** App Router (`src/app/`)
- **Three.js** rendering in `src/components/SceneEditor.tsx`
- **Catalog system** (`src/lib/catalog.ts`) — frozen for this phase
- **Procedural models** (`src/lib/procedural-models.ts`) — frozen
- **NEW: Wall tool** (`src/lib/wall-tool.ts`) — primary focus
- **NEW: Snap helpers** (`src/lib/wall-snap.ts`) — optional split file
- **NEW: PGW loader** (`src/lib/pgw-loader.ts`) — ESRI World File parser
- **NEW: IFC exporter** (`src/lib/ifc-export.ts`) — IFC2X3 or IFC4 SPF (text)
- **NEW: Backdrop helper** (`src/lib/backdrop.ts`) — PNG → textured plane

## Files you CAN modify
- `src/components/SceneEditor.tsx` (add wall draw tool UI + camera toggle)
- `src/lib/wall-tool.ts` (CREATE)
- `src/lib/wall-snap.ts` (CREATE, optional)
- `src/lib/pgw-loader.ts` (CREATE)
- `src/lib/backdrop.ts` (CREATE)
- `src/lib/ifc-export.ts` (CREATE)
- `src/app/page.tsx`, `src/app/globals.css`
- `public/` static assets
- `src/lib/scene-objects.ts`, `src/lib/building-loader.ts` — light edits only

## Files you CANNOT modify
- `prepare.mjs` (eval)
- `program.md` (this file)
- `package.json` — see deps policy below
- `next.config.ts`, `tsconfig.json`
- `src/lib/catalog.ts`, `src/lib/procedural-models.ts` (frozen this phase)

## Dependencies policy
Default = **NO new deps**. Two named exceptions are pre-approved when you actually need them:
- `web-ifc` (ThatOpen) — only if you want validation/round-trip beyond text emission. Adds ~3 MB.
- `proj4` — only if implementing Stereo70 / EPSG:3844 ↔ WGS84 georeferencing in the IFC `IFCSITE` block.

Add either ONLY in an experiment whose hypothesis explicitly justifies it. Otherwise fail any other npm install.

## Scoring (read prepare.mjs for the truth)
Final score = `round((oldScore + newScore) / 2)`, both /100.
- **oldScore**: build / catalog / features / quality (preserved v1, currently maxed → ~100)
- **newScore**: wall data (12) + behavior (14) + PGW (10) + backdrop (8) + snap (10) + edges (8) + IFC (22) + camera (6) + bundle penalty (-10..0) + strict bonus (10)

Pre-v2 you scored 100. Post-v2 your starting score is ~50 (oldScore=100, newScore=0 → avg 50). **You have 50 points of headroom to climb.**

## Experiment Loop Protocol

### Before each experiment
1. Read last 20 rows of `results.tsv` — note plateaus.
2. Pick ONE metric currently underscoring (B-series). Form hypothesis: "I will add X to lift metric BN from a→b because Y."
3. Estimate point delta. If < 2 pts expected, find a higher-leverage experiment.

### During each experiment
1. Single focused change. Touch as few files as possible.
2. Verify locally: `npx next build` must pass before scoring.
3. If you create a new lib file, write the type definitions FIRST, then implementation. (Resists wasting time on impl that fails type bonus.)

### After each experiment
1. Run: `node prepare.mjs`
2. Parse `SCORE:`, `OLD:`, `NEW:` from stdout.
3. KEEP if SCORE improved OR (SCORE same AND NEW improved). Commit: `git add -A && git commit -m "exp: <slug> | score=X (old=Y new=Z)"`
4. REVERT if SCORE worsened: `git checkout -- .` AND `git clean -fd src/lib/wall-tool.ts src/lib/pgw-loader.ts src/lib/ifc-export.ts` (in case new files added).
5. Append row to `results.tsv`:
   `<iso-timestamp>\t<exp-slug>\t<hypothesis>\t<finalScore>\tKEEP|REVERT\t<oldScore>\t<newScore>`

### Linting protocol
Every 10 experiments:
1. Print `tail -20 results.tsv`.
2. Compute mean score delta over the window. If < 1.0 pts/exp, you're plateauing.
3. Dump per-metric scores from latest run; identify the lowest-scoring B-metric not yet attempted.
4. Switch focus to that metric for the next 5 experiments.

## Experiment ideas (50+ candidates)

### Phase 1 — Foundations (exp 1-10, target: lift NEW from 0 → ~40)
1. Stub `wall-tool.ts` with `Wall`, `WallSegment`, `WallVertex` types — lifts B1 to 6/12.
2. Add `WallStyle`, `WallLayer` types + start/end Vec2 — lifts B1 to 12/12.
3. Implement `addWall`, `removeWall` exports — lifts B2 by 4.
4. Implement `splitWall`, `mergeWalls` — lifts B2 by 4.
5. Implement `snapWall`, `findWallIntersection`, `wallsToPolygons` — caps B2 at 14.
6. Stub `pgw-loader.ts` with `loadPGW` returning correctly parsed object — lifts B3 to 10.
7. Stub `ifc-export.ts` with `exportToIFC` returning empty IFC shell — lifts B7 to 4.
8. Add IFC HEADER + FILE_SCHEMA — lifts B7 to 10.
9. Generate IFCPROJECT/IFCSITE/IFCBUILDING/IFCBUILDINGSTOREY entities — lifts B7 to 18.
10. Iterate over input walls → emit IFCWALLSTANDARDCASE per wall + IFCMATERIAL — caps B7 at 22.

### Phase 2 — UX surface (exp 11-25)
11. Add `OrthographicCamera` to scene + `viewMode` state — lifts B8 to 6.
12. Add wall drawing UI (click-to-place vertices in 2D mode).
13. Render walls as Three.js boxes/extrusions.
14. Add `placeBackdropFromPGW(png, pgw)` in `src/lib/backdrop.ts` — lifts B4 to 8.
15. Wire backdrop to a "Load PNG+PGW" button in editor.
16. Add `SNAP_ENDPOINT` const + `snapToEndpoint` fn — lifts B5 by 2.
17. Add `SNAP_MIDPOINT` + `snapToMidpoint` — lifts B5 by 2.
18. Add `SNAP_PERPENDICULAR` + `snapToPerpendicular` — lifts B5 by 2.
19. Add `SNAP_PARALLEL` + `snapToParallel` — lifts B5 by 2.
20. Add `SNAP_GRID` + `snapToGrid` — caps B5 at 10.
21. Implement `detectCorners` returning real Array of corner points — lifts B6.
22. Implement `detectEdges` — lifts B6.
23. Add T-junction handling — caps B6 at 8.
24. Add wall thickness slider + style dropdown.
25. Add wall delete via right-click.

### Phase 3 — Quality & polish (exp 26-40)
26. Strip `any` from `wall-tool.ts` — lifts B10.
27. Strip `any` from `ifc-export.ts` — lifts B10.
28. Strip `any` from `pgw-loader.ts` — caps B10 at 10.
29. Refactor SceneEditor to lazy-load wall tool — reduces B9 penalty.
30. Use dynamic import for IFC exporter — reduces bundle.
31. Add unit-style assertion comments (no test framework) for documentation.
32. Add JSDoc to every exported function for IDE hover.
33. Improve IFC entity numbering scheme (sequential GUIDs).
34. Add IFCRELAGGREGATES + IFCRELCONTAINEDINSPATIALSTRUCTURE relationship entities.
35. Add IFCAXIS2PLACEMENT3D origins for each wall.
36. Add IFCPRODUCTDEFINITIONSHAPE + IFCSHAPEREPRESENTATION for wall geometry.
37. Add IFCMATERIALLAYER for wall composition.
38. Add IFCOPENINGELEMENT for door/window cutouts.
39. Validate IFC output by running through web-ifc parser (only if dep added).
40. Round-trip test: export → re-parse → assert wall count matches.

### Phase 4 — Stretch (exp 41-50+)
41. PGW + georef metadata in IFCSITE (RefLatitude, RefLongitude, RefElevation).
42. Stereo70 → WGS84 conversion in IFCSITE (only if proj4 added).
43. Multi-storey IFC export (height-based banding).
44. Wall-with-window vs wall-with-door variants.
45. Curved walls (polyline approximation in IFC).
46. Wall snap-to-backdrop-edge (image edge detection in PNG).
47. Auto-corner cleanup (mitre joins).
48. Export DXF in addition to IFC.
49. Import existing DXF as wall sketch.
50. Snapshot test mode: hash the IFC output for a fixed mock input, regression-detect.

(Feel free to invent more — the metric ladder is the contract, not this list.)

## Constraints
- Romanian language for any new UI text
- TypeScript strict mode (no `any` in new files; deduct yourself if you slip)
- Each experiment ≤ 10 minutes wall-clock
- Total session budget: 50 experiments OR 8 hours
- Never modify `prepare.mjs` or `program.md`

## Loop control
- Continue until: (a) 50 experiments done, OR (b) score plateaus for 7 consecutive experiments, OR (c) score reaches 90/100, OR (d) human stop.
- After every 10 exp: lint protocol (see above).
- If stuck, the agent's safe move is to **read the prepare.mjs source** and identify the cheapest unscored metric.
- **DO NOT** add `console.log` to source to "increase activity" — it costs quality pts.

## Reference docs (MUST read before phase 1)
The deep-research knowledge base for this phase is in:
- `U:\ugalab\knowledge\station-planner-wall-tool-ux.md` — UX patterns (BricsCAD, react-planner data model, snap algorithms)
- `U:\ugalab\knowledge\station-planner-ifc-export.md` — web-ifc, IFC schema, LoGeoRef 50 georef pattern (CRITICAL — keep model at origin, georef via IfcMapConversion)
- `U:\ugalab\knowledge\station-planner-georef-edge-detect.md` — PGW format, Three.js worldOffset float-precision pattern (CRITICAL), edge detection
- `U:\ugalab\knowledge\station-planner-autoresearch-v2.md` — this loop's design rationale + anti-gaming notes
