#!/usr/bin/env node
/**
 * Station Planner — Auto Research Evaluation Script v2
 * Wall tool + PGW + IFC phase
 *
 * Score model:
 *   oldScore (0-100): build / catalog / features / quality (preserved from v1)
 *   newScore (0-100): wall data / behavior / PGW / backdrop / snap / edges / IFC / camera + bundle penalty + type bonus
 *   FINAL = round((oldScore + newScore) / 2)
 *
 * Backward compat: an experiment maxing v1 only (oldScore=100, newScore=0) reports 50.
 * Pre-v2 results.tsv rows at 100 should be read as "50 of v2 score".
 *
 * Runtime budget: < 60s. Build dominates (~25-40s). All other checks are sync regex + tiny mock imports.
 *
 * Security note: invocations of npx use static literal arguments only, no user/dynamic input.
 */

import * as cp from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const runSync = cp.execSync;
const spawnProc = cp.spawnSync;

const ROOT = process.cwd();
const detail = {};
let oldScore = 0;
let newScore = 0;
let buildOutput = '';

const safeRead = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const exists = (p) => existsSync(join(ROOT, p));

// ════════════════════════════════════════════════════════════════════════
// PART A — LEGACY 100 pts (preserved from v1)
// ════════════════════════════════════════════════════════════════════════

// ─── A1. BUILD SUCCESS (50 pts) ────────────────────────────────────────
console.log('[A1] build...');
let buildPass = false;
try {
  buildOutput = runSync('npx next build', {
    cwd: ROOT, stdio: 'pipe', timeout: 90_000, encoding: 'utf8'
  });
  oldScore += 50;
  buildPass = true;
  detail.A1_build = 'PASS (50/50)';
  console.log('  build PASS');
} catch (e) {
  buildOutput = (e.stdout || '') + (e.stderr || '');
  detail.A1_build = 'FAIL (0/50)';
  console.log('  build FAIL');
}

// ─── A2. CATALOG (20 pts) ──────────────────────────────────────────────
console.log('[A2] catalog...');
try {
  const cat = safeRead(join(ROOT, 'src/lib/catalog.ts'));
  const items = (cat.match(/id:\s*'/g) || []).length;
  const cats = (cat.match(/id:\s*'[^']+',\s*name:\s*'/g) || []).length;
  const itemPts = Math.min(items, 100) * 0.15;
  const catPts = Math.min(cats, 15) * 0.333;
  const score = Math.min(Math.round(itemPts + catPts), 20);
  oldScore += score;
  detail.A2_catalog = `${score}/20 (${items} items, ${cats} cats)`;
  console.log(`  ${score}/20`);
} catch { detail.A2_catalog = '0/20'; }

// ─── A3. FEATURES (20 pts) ─────────────────────────────────────────────
console.log('[A3] features...');
try {
  const allCode =
    safeRead(join(ROOT, 'src/components/SceneEditor.tsx')) +
    safeRead(join(ROOT, 'src/lib/scene-objects.ts')) +
    safeRead(join(ROOT, 'src/lib/procedural-models.ts'));
  const checks = [
    /isDragging|onDrag|dragStart/i, /rotate|rotation|ry\b/i, /delete|remove.*object/i,
    /collision|checkCollision/i, /export.*layout|exportLayout/i, /undo|redo|undoStack/i,
    /firstPerson|fpMode|first.person/i, /measure|measureMode|distance/i,
    /gridSnap|GRID_SNAP|snap.*grid/i, /PLYLoader|pointCloud|ply/i, /OrbitControls/i,
    /SSAOPass|ssao/i, /castShadow|receiveShadow/i, /door|DoorPanel/i,
    /snapToWall|wallSnap/i, /multiSelect|selectedObjects\b/i, /duplicate|clone.*object/i,
    /keydown|keyup|KeyboardEvent/i, /roomWidth|roomDepth|setRoomWidth/i, /ceiling|showCeiling/i,
    /screenshot|toDataURL|canvas.*save/i, /darkMode|dark-mode|theme.*dark/i,
    /alignment|guide.*line|snapLine/i, /label|nameTag|textSprite/i,
    /floorTexture|floor.*material.*map/i, /area.*calc|sqm|square.*meter/i,
    /save.*layout|load.*layout|localStorage.*layout/i, /print|window\.print/i,
    /zoomToFit|fitAll|resetCamera/i, /infoPanel|details.*panel|properties/i,
  ];
  const hits = checks.filter(p => p.test(allCode)).length;
  const score = Math.min(Math.round(hits * 20 / 30), 20);
  oldScore += score;
  detail.A3_features = `${score}/20 (${hits}/30 hits)`;
  console.log(`  ${score}/20`);
} catch { detail.A3_features = '0/20'; }

// ─── A4. QUALITY (10 pts) ──────────────────────────────────────────────
console.log('[A4] quality...');
try {
  let q = 10;
  const f = safeRead(join(ROOT, 'src/components/SceneEditor.tsx'));
  if ((f.match(/:\s*any\b/g) || []).length > 5) q -= 2;
  if ((f.match(/console\.log/g) || []).length > 10) q -= 1;
  if (f.split('\n').length > 3000) q -= 2;
  if ((f.match(/TODO|FIXME|HACK/gi) || []).length > 5) q -= 1;
  if ((f.match(/ts-ignore|ts-expect-error/g) || []).length > 3) q -= 2;
  q = Math.max(q, 0);
  oldScore += q;
  detail.A4_quality = `${q}/10`;
  console.log(`  ${q}/10`);
} catch { detail.A4_quality = '0/10'; }

// ════════════════════════════════════════════════════════════════════════
// PART B — NEW 100 pts (wall / PGW / IFC phase)
// ════════════════════════════════════════════════════════════════════════

const wallSrc   = safeRead(join(ROOT, 'src/lib/wall-tool.ts'));
const snapSrc   = safeRead(join(ROOT, 'src/lib/wall-snap.ts'));
const pgwSrc    = safeRead(join(ROOT, 'src/lib/pgw-loader.ts'));
const ifcSrc    = safeRead(join(ROOT, 'src/lib/ifc-export.ts'));
const editorSrc = safeRead(join(ROOT, 'src/components/SceneEditor.tsx'));

// helper: dynamic import via on-the-fly tsc transpile (no extra deps)
async function probeImport(file) {
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'ap2-'));
    const r = spawnProc('npx', [
      '-y', '-p', 'typescript', 'tsc',
      '--target', 'es2022', '--module', 'esnext',
      '--moduleResolution', 'bundler',
      '--esModuleInterop', '--skipLibCheck', '--allowJs',
      '--outDir', tmp, file
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000, shell: process.platform === 'win32' });
    if (r.status !== 0) return null;
    const baseName = file.replace(/\.ts$/, '.js').split(/[/\\]/).pop();
    const guess = join(tmp, baseName);
    if (!existsSync(guess)) return null;
    const fileUrl = pathToFileURL(guess).href;
    return await import(fileUrl);
  } catch { return null; }
}

// ─── B1. WALL DATA MODEL (12 pts) ──────────────────────────────────────
console.log('[B1] wall data model...');
try {
  let s = 0;
  if (/export\s+(interface|type)\s+Wall\b/.test(wallSrc))         s += 2;
  if (/export\s+(interface|type)\s+WallSegment\b/.test(wallSrc))  s += 2;
  if (/export\s+(interface|type)\s+WallVertex\b/.test(wallSrc))   s += 2;
  if (/export\s+(interface|type)\s+WallStyle\b/.test(wallSrc))    s += 2;
  if (/export\s+(interface|type)\s+WallLayer\b/.test(wallSrc))    s += 2;
  if (/start\s*:\s*Vec[23]/.test(wallSrc) && /end\s*:\s*Vec[23]/.test(wallSrc)) s += 2;
  s = Math.min(s, 12);
  newScore += s;
  detail.B1_wall_model = `${s}/12`;
  console.log(`  ${s}/12`);
} catch { detail.B1_wall_model = '0/12'; }

// ─── B2. WALL BEHAVIOR SURFACE (14 pts) ────────────────────────────────
console.log('[B2] wall behavior...');
try {
  let s = 0;
  const fns = ['addWall','removeWall','splitWall','mergeWalls','snapWall','findWallIntersection','wallsToPolygons'];
  for (const fn of fns) {
    const re = new RegExp(`export\\s+(function|const)\\s+${fn}\\b`);
    if (re.test(wallSrc)) s += 2;
  }
  s = Math.min(s, 14);
  newScore += s;
  detail.B2_wall_behavior = `${s}/14`;
  console.log(`  ${s}/14`);
} catch { detail.B2_wall_behavior = '0/14'; }

// ─── B3. PGW LOADER (10 pts) ───────────────────────────────────────────
console.log('[B3] PGW loader...');
try {
  let s = 0;
  if (/export\s+(function|const)\s+loadPGW\b/.test(pgwSrc)) s += 4;
  if (s > 0 && exists('src/lib/pgw-loader.ts')) {
    const mod = await probeImport('src/lib/pgw-loader.ts');
    if (mod && typeof mod.loadPGW === 'function') {
      const px = +(0.1 + Math.random()).toFixed(6);
      const py = -+(0.1 + Math.random()).toFixed(6);
      const ox = +(400000 + Math.random() * 200000).toFixed(3);
      const oy = +(5500000 + Math.random() * 200000).toFixed(3);
      const text = `${px}\n0.0\n0.0\n${py}\n${ox}\n${oy}`;
      try {
        const r = mod.loadPGW(text);
        const ok = r &&
          Math.abs((r.pixelSizeX ?? r.pixelWidth ?? r[0]) - px) < 1e-3 &&
          Math.abs((r.pixelSizeY ?? r.pixelHeight ?? r[3]) - py) < 1e-3 &&
          Math.abs((r.originX ?? r.x ?? r[4]) - ox) < 1e-1 &&
          Math.abs((r.originY ?? r.y ?? r[5]) - oy) < 1e-1;
        if (ok) s += 6;
      } catch {}
    }
  }
  s = Math.min(s, 10);
  newScore += s;
  detail.B3_pgw = `${s}/10`;
  console.log(`  ${s}/10`);
} catch { detail.B3_pgw = '0/10'; }

// ─── B4. PNG BACKDROP (8 pts) ──────────────────────────────────────────
console.log('[B4] PNG backdrop...');
try {
  let s = 0;
  if (/TextureLoader|ImageLoader|new\s+THREE\.Texture/.test(editorSrc)) s += 4;
  const allLib = pgwSrc + wallSrc + safeRead(join(ROOT, 'src/lib/backdrop.ts'));
  if (/export\s+(function|const)\s+placeBackdropFromPGW\b/.test(allLib)) s += 4;
  s = Math.min(s, 8);
  newScore += s;
  detail.B4_backdrop = `${s}/8`;
  console.log(`  ${s}/8`);
} catch { detail.B4_backdrop = '0/8'; }

// ─── B5. SNAP COVERAGE (10 pts) ────────────────────────────────────────
console.log('[B5] snap modes...');
try {
  let s = 0;
  const all = wallSrc + snapSrc;
  const modes = ['ENDPOINT','MIDPOINT','PERPENDICULAR','PARALLEL','GRID'];
  for (const m of modes) {
    const cap = m.toLowerCase();
    const fnName = 'snapTo' + m.charAt(0) + cap.slice(1);
    const hasConst = new RegExp(`export\\s+const\\s+SNAP_${m}\\b`).test(all);
    const hasFn    = new RegExp(`(function|const)\\s+${fnName}\\b`, 'i').test(all);
    if (hasConst && hasFn) s += 2;
  }
  s = Math.min(s, 10);
  newScore += s;
  detail.B5_snap = `${s}/10`;
  console.log(`  ${s}/10`);
} catch { detail.B5_snap = '0/10'; }

// ─── B6. EDGE / CORNER DETECTION (8 pts) ───────────────────────────────
console.log('[B6] edge & corner...');
try {
  let s = 0;
  if (/export\s+(function|const)\s+detectEdges\b/.test(wallSrc))   s += 2;
  if (/export\s+(function|const)\s+detectCorners\b/.test(wallSrc)) s += 2;
  if (/tJunction|TJunction|t_junction|T_JUNCTION/.test(wallSrc))   s += 1;
  if (exists('src/lib/wall-tool.ts')) {
    const mod = await probeImport('src/lib/wall-tool.ts');
    if (mod && typeof mod.detectCorners === 'function') {
      const cases = [
        { walls: [{start:{x:0,y:0},end:{x:10,y:0}},{start:{x:10,y:0},end:{x:10,y:10}}], expected: 1 },
        { walls: [{start:{x:0,y:0},end:{x:10,y:0}},{start:{x:10,y:0},end:{x:10,y:10}},{start:{x:10,y:10},end:{x:0,y:10}},{start:{x:0,y:10},end:{x:0,y:0}}], expected: 4 },
        { walls: [{start:{x:0,y:0},end:{x:5,y:0}}], expected: 0 },
      ];
      let ok = 0;
      for (const c of cases) {
        try {
          const r = mod.detectCorners(c.walls);
          if (Array.isArray(r) ? r.length === c.expected : r === c.expected) ok++;
        } catch {}
      }
      s += Math.round((ok / cases.length) * 3);
    }
  }
  s = Math.min(s, 8);
  newScore += s;
  detail.B6_edges = `${s}/8`;
  console.log(`  ${s}/8`);
} catch { detail.B6_edges = '0/8'; }

// ─── B7. IFC EXPORT (22 pts) ───────────────────────────────────────────
console.log('[B7] IFC export...');
try {
  let s = 0;
  if (/export\s+(function|const)\s+exportToIFC\b/.test(ifcSrc)) s += 4;
  if (s > 0 && exists('src/lib/ifc-export.ts')) {
    const mod = await probeImport('src/lib/ifc-export.ts');
    if (mod && typeof mod.exportToIFC === 'function') {
      const mockWalls = [
        { start:{x:0,y:0}, end:{x:10,y:0}, height: 3 },
        { start:{x:10,y:0}, end:{x:10,y:10}, height: 3 },
        { start:{x:10,y:10}, end:{x:0,y:10}, height: 3 },
        { start:{x:0,y:10}, end:{x:0,y:0}, height: 3 },
      ];
      let out = '';
      try { out = String(mod.exportToIFC(mockWalls) || ''); } catch {}
      if (/^ISO-10303-21\s*;/m.test(out) && /HEADER\s*;/i.test(out)) s += 3;
      if (/FILE_SCHEMA\s*\(\s*\(\s*'IFC[24]X?3?'/i.test(out)) s += 3;
      const entities = [
        /IFCPROJECT\s*\(/i, /IFCSITE\s*\(/i, /IFCBUILDING\s*\(/i,
        /IFCBUILDINGSTOREY\s*\(/i, /IFCWALLSTANDARDCASE\s*\(/i, /IFCMATERIAL\s*\(/i,
      ];
      for (const re of entities) if (re.test(out)) s += 2;
      const wallMatches = (out.match(/IFCWALLSTANDARDCASE\s*\(/gi) || []).length;
      if (wallMatches > 0 && wallMatches !== mockWalls.length) s = Math.max(0, s - 4);
    }
  }
  s = Math.min(s, 22);
  newScore += s;
  detail.B7_ifc = `${s}/22`;
  console.log(`  ${s}/22`);
} catch { detail.B7_ifc = '0/22'; }

// ─── B8. CAMERA TOGGLE (6 pts) ─────────────────────────────────────────
console.log('[B8] camera toggle...');
try {
  let s = 0;
  if (/PerspectiveCamera/.test(editorSrc))  s += 2;
  if (/OrthographicCamera/.test(editorSrc)) s += 2;
  if (/viewMode|cameraMode|set2DMode|togglePlanView|is2D/.test(editorSrc)) s += 2;
  s = Math.min(s, 6);
  newScore += s;
  detail.B8_camera = `${s}/6`;
  console.log(`  ${s}/6`);
} catch { detail.B8_camera = '0/6'; }

// ─── B9. BUNDLE PENALTY (-10 to 0) ─────────────────────────────────────
console.log('[B9] bundle size...');
try {
  let penalty = 0;
  const m = buildOutput.match(/First Load JS shared by all\s+([\d.]+)\s*kB/i)
        || buildOutput.match(/Load JS\s+([\d.]+)\s*kB/i);
  const kb = m ? parseFloat(m[1]) : 0;
  if (kb > 500) {
    penalty = -Math.min(10, Math.ceil((kb - 500) / 50));
  }
  newScore += penalty;
  detail.B9_bundle = `${penalty} (${kb || '?'} kB)`;
  console.log(`  ${penalty} pts (${kb || '?'} kB)`);
} catch { detail.B9_bundle = '0 (?)'; }

// ─── B10. TYPE STRICTNESS BONUS (10 pts) ───────────────────────────────
console.log('[B10] type strictness...');
try {
  let s = 0;
  const newFiles = [
    { src: wallSrc, name: 'wall-tool' },
    { src: pgwSrc,  name: 'pgw-loader' },
    { src: ifcSrc,  name: 'ifc-export' },
  ];
  let allExist = true;
  for (const f of newFiles) {
    if (!f.src) { allExist = false; continue; }
    const anyCount = (f.src.match(/:\s*any\b/g) || []).length;
    const ignoreCount = (f.src.match(/ts-ignore|ts-expect-error/g) || []).length;
    if (anyCount === 0 && ignoreCount === 0) s += 3;
  }
  if (allExist) s += 1;
  s = Math.min(s, 10);
  newScore += s;
  detail.B10_strict = `${s}/10`;
  console.log(`  ${s}/10`);
} catch { detail.B10_strict = '0/10'; }

// ════════════════════════════════════════════════════════════════════════
// FINAL
// ════════════════════════════════════════════════════════════════════════

oldScore = Math.max(0, Math.min(100, oldScore));
newScore = Math.max(0, Math.min(100, newScore));
const finalScore = Math.round((oldScore + newScore) / 2);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  oldScore (v1 baseline): ${oldScore}/100`);
console.log(`  newScore (v2 wall/IFC): ${newScore}/100`);
console.log(`  FINAL (avg, normalized): ${finalScore}/100`);
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('Breakdown:', JSON.stringify(detail, null, 2));

try {
  const tsv = join(ROOT, 'results.tsv');
  if (!existsSync(tsv)) {
    writeFileSync(tsv, 'timestamp\texperiment\thypothesis\tscore\tstatus\toldScore\tnewScore\n');
  }
} catch {}

process.stdout.write(`\nSCORE:${finalScore}\nOLD:${oldScore}\nNEW:${newScore}\n`);
