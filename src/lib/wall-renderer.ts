import * as THREE from 'three';
import type { Wall } from './wall-tool';
import { wallsToPolygons } from './wall-tool';

export function createWallMesh(wall: Wall, viewMode: '2d' | '3d', selected = false): THREE.Object3D {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return new THREE.Group();

  const polygons = wallsToPolygons([wall]);
  const poly = polygons[0];
  if (!poly || poly.length < 4) return new THREE.Group();

  const shape = new THREE.Shape();
  // poly is [x,y] in plan; Three.js uses XZ for floor (Y is up)
  shape.moveTo(poly[0].x, poly[0].y);
  shape.lineTo(poly[1].x, poly[1].y);
  shape.lineTo(poly[2].x, poly[2].y);
  shape.lineTo(poly[3].x, poly[3].y);
  shape.closePath();

  const color = selected ? 0xff8c00 : 0x6b6b6b;
  const opacity = viewMode === '2d' ? 0.85 : 1.0;

  if (viewMode === '2d') {
    // Flat ribbon at floor level
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.005;
    mesh.userData.wallId = wall.id;
    return mesh;
  } else {
    // 3D extrude up by wall.height
    const extrudeSettings = { depth: wall.height, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wallId = wall.id;
    return mesh;
  }
}

export function updateWallGroup(group: THREE.Group, walls: Wall[], viewMode: '2d' | '3d', selectedId: string | null = null) {
  // Clear
  while (group.children.length > 0) {
    const c = group.children[0];
    group.remove(c);
    if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
    const m = (c as THREE.Mesh).material;
    if (Array.isArray(m)) m.forEach(mm => mm.dispose());
    else if (m && 'dispose' in m) m.dispose();
  }
  // Add fresh
  for (const w of walls) {
    group.add(createWallMesh(w, viewMode, w.id === selectedId));
  }
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
  // Convert plan (X,Y) → world (X, 0.01, -Y) so it shows above floor with Y-up
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
