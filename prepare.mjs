#!/usr/bin/env node
/**
 * Station Planner — Auto Research Evaluation Script
 * DO NOT MODIFY — this is the fixed evaluation metric
 *
 * Scores the current state of the codebase on:
 * 1. Build success (50 pts)
 * 2. Catalog completeness (20 pts)
 * 3. Feature count (20 pts)
 * 4. Code quality (10 pts)
 *
 * Total: 0-100
 * Run: node prepare.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let totalScore = 0;
const details = {};

// ─── 1. BUILD SUCCESS (50 pts) ──────────────────────────
console.log('🔨 Testing build...');
try {
  execSync('npx next build', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  totalScore += 50;
  details.build = 'PASS (50/50)';
  console.log('  ✅ Build: PASS (50/50)');
} catch (e) {
  details.build = 'FAIL (0/50)';
  console.log('  ❌ Build: FAIL (0/50)');
  // If build fails, still try to score other metrics
}

// ─── 2. CATALOG COMPLETENESS (20 pts) ───────────────────
console.log('📦 Checking catalog...');
try {
  const catalogFile = readFileSync(join(ROOT, 'src/lib/catalog.ts'), 'utf8');

  // Count catalog items
  const itemMatches = catalogFile.match(/id:\s*'/g) || [];
  const itemCount = itemMatches.length;

  // Count categories
  const catMatches = catalogFile.match(/id:\s*'[^']+',\s*name:\s*'/g) || [];
  const categoryCount = catMatches.length;

  // Score: scales up to 100 items and 15 categories for full points
  const itemScore = Math.min(itemCount, 100) * 0.15; // max 15 pts for 100 items
  const catScore = Math.min(categoryCount, 15) * 0.333; // max 5 pts for 15 categories
  const catalogScore = Math.min(Math.round(itemScore + catScore), 20);

  totalScore += catalogScore;
  details.catalog = `${catalogScore}/20 (${itemCount} items, ${categoryCount} categories)`;
  console.log(`  📦 Catalog: ${catalogScore}/20 (${itemCount} items, ${categoryCount} categories)`);
} catch (e) {
  details.catalog = '0/20 (error reading catalog)';
  console.log('  ❌ Catalog: 0/20 (error)');
}

// ─── 3. FEATURE COUNT (20 pts) ──────────────────────────
console.log('⚡ Checking features...');
try {
  const editorFile = readFileSync(join(ROOT, 'src/components/SceneEditor.tsx'), 'utf8');
  const sceneFile = readFileSync(join(ROOT, 'src/lib/scene-objects.ts'), 'utf8');
  const procFile = readFileSync(join(ROOT, 'src/lib/procedural-models.ts'), 'utf8');
  const allCode = editorFile + sceneFile + procFile;

  let featureScore = 0;
  const features = [];

  // Core features (1 pt each)
  const featureChecks = [
    { name: 'Drag & Drop', pattern: /isDragging|onDrag|dragStart/i },
    { name: 'Rotation', pattern: /rotate|rotation|ry\b/i },
    { name: 'Delete', pattern: /delete|remove.*object/i },
    { name: 'Collision Detection', pattern: /collision|checkCollision/i },
    { name: 'Export', pattern: /export.*layout|exportLayout/i },
    { name: 'Undo/Redo', pattern: /undo|redo|undoStack/i },
    { name: 'First Person', pattern: /firstPerson|fpMode|first.person/i },
    { name: 'Measurement', pattern: /measure|measureMode|distance/i },
    { name: 'Grid Snap', pattern: /gridSnap|GRID_SNAP|snap.*grid/i },
    { name: 'Point Cloud', pattern: /PLYLoader|pointCloud|ply/i },
    { name: 'Orbit Controls', pattern: /OrbitControls/i },
    { name: 'SSAO', pattern: /SSAOPass|ssao/i },
    { name: 'Shadows', pattern: /castShadow|receiveShadow/i },
    { name: 'Door Toggle', pattern: /door|DoorPanel/i },
    { name: 'Wall Snap', pattern: /snapToWall|wallSnap/i },
    { name: 'Multi-Select', pattern: /multiSelect|selectedObjects\b/i },
    { name: 'Copy/Duplicate', pattern: /duplicate|clone.*object/i },
    { name: 'Keyboard Shortcuts', pattern: /keydown|keyup|KeyboardEvent/i },
    { name: 'Room Resize', pattern: /roomWidth|roomDepth|setRoomWidth/i },
    { name: 'Ceiling Toggle', pattern: /ceiling|showCeiling/i },
    { name: 'Screenshot Export', pattern: /screenshot|toDataURL|canvas.*save/i },
    { name: 'Dark Mode', pattern: /darkMode|dark-mode|theme.*dark/i },
    { name: 'Alignment Guides', pattern: /alignment|guide.*line|snapLine/i },
    { name: 'Object Labels', pattern: /label|nameTag|textSprite/i },
    { name: 'Floor Texture', pattern: /floorTexture|floor.*material.*map/i },
    { name: 'Area Calculation', pattern: /area.*calc|sqm|square.*meter/i },
    { name: 'Save/Load Layout', pattern: /save.*layout|load.*layout|localStorage.*layout/i },
    { name: 'Print Layout', pattern: /print|window\.print/i },
    { name: 'Zoom to Fit', pattern: /zoomToFit|fitAll|resetCamera/i },
    { name: 'Object Info Panel', pattern: /infoPanel|details.*panel|properties/i },
  ];

  for (const check of featureChecks) {
    if (check.pattern.test(allCode)) {
      featureScore++;
      features.push(check.name);
    }
  }

  const fScore = Math.min(Math.round(featureScore * 20 / 30), 20); // scale 30 possible features to 20 pts
  totalScore += fScore;
  details.features = `${fScore}/20 (${features.length} features: ${features.join(', ')})`;
  console.log(`  ⚡ Features: ${fScore}/20 (${features.length} detected)`);
} catch (e) {
  details.features = '0/20 (error)';
  console.log('  ❌ Features: 0/20 (error)');
}

// ─── 4. CODE QUALITY (10 pts) ───────────────────────────
console.log('🧹 Checking code quality...');
try {
  let qualityScore = 10;

  const editorFile = readFileSync(join(ROOT, 'src/components/SceneEditor.tsx'), 'utf8');

  // Deductions
  const anyCount = (editorFile.match(/:\s*any\b/g) || []).length;
  if (anyCount > 5) qualityScore -= 2;

  // Check for console.log (should be minimal in production)
  const consoleCount = (editorFile.match(/console\.log/g) || []).length;
  if (consoleCount > 10) qualityScore -= 1;

  // Check file size (too large = needs refactoring)
  const lineCount = editorFile.split('\n').length;
  if (lineCount > 3000) qualityScore -= 2;

  // Check for TODO/FIXME/HACK
  const todoCount = (editorFile.match(/TODO|FIXME|HACK/gi) || []).length;
  if (todoCount > 5) qualityScore -= 1;

  // Bonus: TypeScript strict (no ts-ignore)
  const tsIgnore = (editorFile.match(/ts-ignore|ts-expect-error/g) || []).length;
  if (tsIgnore > 3) qualityScore -= 2;

  qualityScore = Math.max(qualityScore, 0);
  totalScore += qualityScore;
  details.quality = `${qualityScore}/10 (${lineCount} lines, ${anyCount} any, ${consoleCount} console.log, ${todoCount} TODO)`;
  console.log(`  🧹 Quality: ${qualityScore}/10`);
} catch (e) {
  details.quality = '0/10 (error)';
  console.log('  ❌ Quality: 0/10 (error)');
}

// ─── FINAL SCORE ────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════');
console.log(`  TOTAL SCORE: ${totalScore}/100`);
console.log('═══════════════════════════════════════');
console.log('');
console.log('Details:', JSON.stringify(details, null, 2));

// Output just the score for automated parsing
process.stdout.write(`\nSCORE:${totalScore}\n`);
