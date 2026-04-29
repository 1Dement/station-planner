import * as THREE from 'three';
import type { Wall, Hole } from './wall-tool';
import { wallsToPolygons } from './wall-tool';

/**
 * Generate wall mesh for ONE wall, optionally with door/window holes cut out.
 * 2D mode: flat ribbon (holes shown as gaps).
 * 3D mode: extruded box, with panels above doors / above+below windows.
 */
export function createWallMesh(
  wall: Wall,
  viewMode: '2d' | '3d',
  selected = false,
  holes: Hole[] = [],
): THREE.Object3D {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return new THREE.Group();

  const polygons = wallsToPolygons([wall]);
  const poly = polygons[0];
  if (!poly || poly.length < 4) return new THREE.Group();

  const color = selected ? 0xff8c00 : 0x6b6b6b;

  if (viewMode === '2d') {
    // Flat ribbon at floor level — show full wall with holes as separate small markers
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(poly[0].x, poly[0].y);
    shape.lineTo(poly[1].x, poly[1].y);
    shape.lineTo(poly[2].x, poly[2].y);
    shape.lineTo(poly[3].x, poly[3].y);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.005;
    mesh.userData.wallId = wall.id;
    group.add(mesh);
    // Door/window markers — distinct color rectangles overlaying the wall ribbon
    for (const h of holes) {
      const marker = createHoleMarker2D(wall, h, len);
      if (marker) group.add(marker);
    }
    return group;
  }

  // 3D mode: build wall as panels around holes
  return createWallPanels3D(wall, holes, len, color);
}

function createHoleMarker2D(wall: Wall, hole: Hole, len: number): THREE.Object3D | null {
  if (hole.offset < 0 || hole.offset > len) return null;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const ang = Math.atan2(dy, dx);
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  const center = {
    x: wall.start.x + (hole.offset + hole.width / 2) * cosA,
    y: wall.start.y + (hole.offset + hole.width / 2) * sinA,
  };
  const w = hole.width;
  const t = wall.thickness * 1.4;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -t / 2);
  shape.lineTo(w / 2, -t / 2);
  shape.lineTo(w / 2, t / 2);
  shape.lineTo(-w / 2, t / 2);
  shape.closePath();
  const color = hole.kind === 'door' ? 0xc97800 : 0x0099cc;
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -ang;
  mesh.position.set(center.x, 0.01, -center.y);
  mesh.renderOrder = 5;
  return mesh;
}

function createWallPanels3D(wall: Wall, holes: Hole[], len: number, color: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.wallId = wall.id;

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const ang = Math.atan2(dy, dx);
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  const t = wall.thickness;
  const h = wall.height;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });

  /**
   * Build a single rectangular wall segment box.
   * `s` and `e` are wall-local offsets along axis (in meters, 0..len).
   * `yMin`/`yMax` are vertical bounds (0..wallHeight).
   */
  const addBox = (s: number, e: number, yMin: number, yMax: number) => {
    if (e - s < 1e-4 || yMax - yMin < 1e-4) return;
    const segLen = e - s;
    const segH = yMax - yMin;
    const geo = new THREE.BoxGeometry(segLen, segH, t);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Position centroid: midpoint along wall axis at (s+e)/2 from start
    const midOffset = (s + e) / 2;
    const cxWorld = wall.start.x + midOffset * cosA;
    const cyWorld = wall.start.y + midOffset * sinA;
    // In Three.js: X = world X, Z = -world Y (plan-to-3D mapping), Y = vertical
    mesh.position.set(cxWorld, yMin + segH / 2, -cyWorld);
    mesh.rotation.y = -ang;
    mesh.userData.wallId = wall.id;
    group.add(mesh);
  };

  // Sort holes by offset
  const sortedHoles = [...holes].filter(h => h.offset >= 0 && h.offset + h.width <= len + 1e-6).sort((a, b) => a.offset - b.offset);

  if (sortedHoles.length === 0) {
    // Simple full box
    addBox(0, len, 0, h);
    return group;
  }

  // Build panels around each hole
  let cursor = 0;
  for (const hole of sortedHoles) {
    const holeStart = hole.offset;
    const holeEnd = hole.offset + hole.width;

    // Solid panel from cursor → holeStart (full height)
    if (holeStart > cursor) {
      addBox(cursor, holeStart, 0, h);
    }

    // Panels around the hole opening
    const sill = hole.sillHeight;
    const top = hole.sillHeight + hole.height;

    // Below sill (for windows)
    if (sill > 0) {
      addBox(holeStart, holeEnd, 0, sill);
    }
    // Above opening (header/lintel)
    if (top < h) {
      addBox(holeStart, holeEnd, top, h);
    }

    cursor = holeEnd;
  }
  // Last panel after final hole
  if (cursor < len) {
    addBox(cursor, len, 0, h);
  }

  return group;
}

export function updateWallGroup(
  group: THREE.Group,
  walls: Wall[],
  viewMode: '2d' | '3d',
  selectedId: string | null = null,
  allHoles: Hole[] = [],
) {
  // Clear
  while (group.children.length > 0) {
    const c = group.children[0];
    group.remove(c);
    disposeRecursive(c);
  }
  // Index holes by wall
  const holesByWall = new Map<string, Hole[]>();
  for (const h of allHoles) {
    if (!holesByWall.has(h.wallId)) holesByWall.set(h.wallId, []);
    holesByWall.get(h.wallId)!.push(h);
  }
  // Add fresh
  for (const w of walls) {
    const wallHoles = holesByWall.get(w.id) || [];
    group.add(createWallMesh(w, viewMode, w.id === selectedId, wallHoles));
  }
}

function disposeRecursive(obj: THREE.Object3D) {
  obj.traverse(child => {
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
    const m = (child as THREE.Mesh).material;
    if (Array.isArray(m)) m.forEach(mm => mm.dispose());
    else if (m && 'dispose' in m) m.dispose();
  });
}

export function createPreviewLine(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const mat = new THREE.LineDashedMaterial({ color: 0x0071e3, dashSize: 0.15, gapSize: 0.08, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

export function setPreviewLine(line: THREE.Line, start: { x: number; y: number }, end: { x: number; y: number }) {
  const positions = line.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, start.x, 0.02, -start.y);
  positions.setXYZ(1, end.x, 0.02, -end.y);
  positions.needsUpdate = true;
  line.computeLineDistances();
  line.visible = true;
}

export function createSnapMarker(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(0.25, 0.25);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 999;
  mesh.visible = false;
  return mesh;
}
