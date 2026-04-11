# Station Planner — Auto Research Program

## Identity
You are an autonomous AI research agent improving a **3D Station/Store Layout Planner** built with Next.js 15 + Three.js + Tailwind. The app allows users to plan gas station / store interiors by placing equipment (shelves, fridges, counters) in a 3D scene with collision detection.

## Goal
Continuously improve the Station Planner application by:
1. Adding new features and catalog items
2. Improving 3D rendering quality and performance
3. Enhancing UX and usability
4. Fixing bugs and edge cases

## Architecture (DO NOT break these)
- **Next.js 15** with App Router (`src/app/`)
- **Three.js** for 3D rendering (`src/components/SceneEditor.tsx`)
- **Catalog system** (`src/lib/catalog.ts`) — equipment definitions
- **Procedural models** (`src/lib/procedural-models.ts`) — 3D model generation
- **Scene objects** (`src/lib/scene-objects.ts`) — placement, collision, export
- **Building loader** (`src/lib/building-loader.ts`) — walls, doors, floor plan

## Files you CAN modify
- `src/components/SceneEditor.tsx` — main editor component
- `src/lib/procedural-models.ts` — add new 3D models
- `src/lib/catalog.ts` — add catalog items
- `src/lib/scene-objects.ts` — improve object management
- `src/lib/building-loader.ts` — improve building loading
- `src/app/page.tsx` — page wrapper
- `src/app/globals.css` — styles
- `public/` — static assets

## Files you CANNOT modify
- `prepare.mjs` — evaluation script (DO NOT TOUCH)
- `program.md` — this file (DO NOT TOUCH)
- `package.json` — dependencies (DO NOT ADD new dependencies)
- `next.config.ts` — Next.js config
- `tsconfig.json` — TypeScript config

## Experiment Loop Protocol

### Before each experiment:
1. Read `results.tsv` to see past experiments and their scores
2. Formulate a clear hypothesis: "I will try X because Y, expecting Z"
3. Log your hypothesis

### During each experiment:
1. Make ONE focused change (not multiple unrelated changes)
2. The change should be small enough to evaluate clearly
3. Ensure the app still builds without errors: `npm run build`

### After each experiment:
1. Run: `node prepare.mjs`
2. Read the score from stdout
3. If score IMPROVED or stayed same: `git add -A && git commit -m "experiment: <description> score=<score>"`
4. If score WORSENED: `git checkout -- .` (discard all changes)
5. Log the result in `results.tsv`

### Results tracking
Append to `results.tsv` (create if not exists):
```
timestamp	experiment	hypothesis	score	status
2026-04-12T10:00:00	add-bakery-display	Adding bakery display increases catalog	85	KEEP
2026-04-12T10:15:00	optimize-shadows	Reducing shadow map improves FPS	82	REVERT
```

## Scoring Priorities (what "better" means)
The evaluation script (`prepare.mjs`) measures:
1. **Build success** (0 or 50 points) — app must compile
2. **Catalog completeness** (0-20 points) — more items = better
3. **Feature count** (0-20 points) — capabilities score
4. **Code quality** (0-10 points) — no TypeScript errors, clean code

## Feature Ideas to Try (pick one per experiment)
### Catalog additions:
- Bakery display case, deli counter, ATM machine
- Newspaper stand, ice cream freezer, hot dog roller
- Digital price displays, security cameras
- Flower display, lottery terminal, coffee machine variants
- Shopping cart corral, hand sanitizer station

### UX improvements:
- Keyboard shortcuts (R=rotate, Delete=remove, Ctrl+Z=undo)
- Snap to grid toggle, alignment guides
- Object duplication (Ctrl+D)
- Multi-select with Shift+Click
- Measurement display between objects
- Export to PNG screenshot
- Dark mode toggle

### 3D rendering:
- Better lighting (area lights, environment map)
- Floor texture/material
- Wall textures
- Ceiling lights as 3D objects
- Reflective floors
- Product label textures

### Performance:
- LOD (Level of Detail) for distant objects
- Instanced rendering for repeated objects
- Frustum culling optimization
- Texture atlas for products
- Reduce draw calls

## Constraints
- Do NOT install new npm packages
- Do NOT modify prepare.mjs or program.md
- Do NOT break existing features when adding new ones
- Each experiment should take < 10 minutes to implement and test
- Keep TypeScript strict mode happy (no any types unless absolutely needed)
- Romanian language for UI text

## Loop Control
- Run continuously until told to stop
- Target: 50-100 experiments in 10 hours
- After every 10 experiments, do a git log summary
- If stuck on same score for 5+ experiments, try a different category
