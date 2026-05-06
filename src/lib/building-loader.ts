import * as THREE from 'three';
import earcut from 'earcut';
import buildingData from './building-data.json';

const WALL_HEIGHT = 3.0;
const INTERIOR_WALL_HEIGHT = 2.55;

interface WallPolygon {
  points: number[][];
  closed: number;
  area: number;
}

interface DxfObject {
  catalogId: string;
  x: number;
  z: number;
  rotation: number;
  layer: string;
}

interface DoorData {
  x: number; z: number;
  width: number;
  startAngle: number;
  endAngle: number;
  hingeAngle: number;
  kind?: 'swing' | 'sliding' | 'double';
  label?: string;
  yFlipped?: boolean;
}

interface WindowData {
  x: number; z: number;
  width: number;
  depth: number;
  horizontal: number;
  points: number[][];
  sillM?: number;
  fullHeight?: boolean;
  label?: string;
}

interface BuildingJSON {
  walls: WallPolygon[];
  hatchOuter: number[][] | null;
  hatchHoles: number[][][];
  objects?: DxfObject[];
  doors?: DoorData[];
  windows?: WindowData[];
}

export interface WallSegment {
  x1: number; z1: number;
  x2: number; z2: number;
  nx: number; nz: number;
  isExterior: boolean;
  thickness: number;
}

function addEdgeSegments(pts: number[][], segments: WallSegment[], isExterior: boolean, thickness: number) {
  const all = [...pts, pts[0]];
  for (let j = 0; j < all.length - 1; j++) {
    const [x1, z1] = all[j]; const [x2, z2] = all[j + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.05) continue;
    segments.push({ x1, z1, x2, z2, nx: -dz / len, nz: dx / len, isExterior, thickness });
  }
}

// Wall: only vertical faces, no caps
function buildWallFaces(pts: number[][], height: number, mat: THREE.Material): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vi = 0;

  const all = [...pts, pts[0]];
  for (let i = 0; i < all.length - 1; i++) {
    const [x1, z1] = all[i];
    const [x2, z2] = all[i + 1];
    const base = vi;
    vertices.push(x1, 0, z1, x2, 0, z2, x2, height, z2, x1, height, z1);
    vi += 4;
    indices.push(base, base+1, base+2, base, base+2, base+3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Hatch cap: flat surface on top of walls (the hatched area = solid wall from above)
// Uses earcut for each hole individually to avoid complex multi-hole triangulation issues
function buildHatchCap(outer: number[][], holes: number[][][], height: number, mat: THREE.Material): THREE.Group {
  const capGroup = new THREE.Group();

  // Strategy: build the hatch area as outer polygon with all holes
  // Use earcut which handles holes natively

  // Flatten outer + holes into earcut format
  const flatCoords: number[] = [];
  const holeIndices: number[] = [];

  // Outer boundary
  for (const [x, z] of outer) {
    flatCoords.push(x, z);
  }

  // Add holes
  for (const hole of holes) {
    holeIndices.push(flatCoords.length / 2); // index where this hole starts
    for (const [x, z] of hole) {
      flatCoords.push(x, z);
    }
  }

  const triIndices = earcut(flatCoords, holeIndices, 2);

  if (triIndices.length > 0) {
    const vertices: number[] = [];
    const totalPts = flatCoords.length / 2;

    for (let i = 0; i < totalPts; i++) {
      vertices.push(flatCoords[i * 2], height, flatCoords[i * 2 + 1]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(triIndices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    capGroup.add(mesh);

    // Bottom cap too (for seeing from below)
    const botVertices: number[] = [];
    for (let i = 0; i < totalPts; i++) {
      botVertices.push(flatCoords[i * 2], 0, flatCoords[i * 2 + 1]);
    }
    const botGeo = new THREE.BufferGeometry();
    botGeo.setAttribute('position', new THREE.Float32BufferAttribute(botVertices, 3));
    // Reverse winding for bottom
    const botIndices: number[] = [];
    for (let i = 0; i < triIndices.length; i += 3) {
      botIndices.push(triIndices[i+2], triIndices[i+1], triIndices[i]);
    }
    botGeo.setIndex(botIndices);
    botGeo.computeVertexNormals();
    const botMesh = new THREE.Mesh(botGeo, mat);
    capGroup.add(botMesh);
  }

  return capGroup;
}

function createTileFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const tiles = 4;
  const tileSize = size / tiles;
  const grout = 3;
  // Grout base
  ctx.fillStyle = '#b0a898';
  ctx.fillRect(0, 0, size, size);
  // Individual tiles with subtle variation
  for (let tx = 0; tx < tiles; tx++) {
    for (let ty = 0; ty < tiles; ty++) {
      const v = Math.floor(Math.random() * 10);
      ctx.fillStyle = `rgb(${200 + v},${196 + v},${188 + v})`;
      ctx.fillRect(tx * tileSize + grout / 2, ty * tileSize + grout / 2, tileSize - grout, tileSize - grout);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface DoorPanel {
  hingeX: number;
  hingeZ: number;
  width: number;
  height: number;
  startAngle: number; // radians - closed position
  endAngle: number;   // radians - fully open position
}

export function loadBuildingIntoScene(scene: THREE.Scene): {
  exteriorBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  wallSegments: WallSegment[];
  dxfObjects: DxfObject[];
  doorPanels: DoorPanel[];
  ceiling: THREE.Mesh;
} {
  const data = buildingData as BuildingJSON;
  const group = new THREE.Group();
  group.userData = { type: 'building' };
  const wallSegments: WallSegment[] = [];
  const doorPanels: DoorPanel[] = [];

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf2ede4,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const edgeMat = new THREE.LineBasicMaterial({ color: 0xc0b8a8, transparent: true, opacity: 0.12 });

  let extMinX = Infinity, extMaxX = -Infinity, extMinZ = Infinity, extMaxZ = -Infinity;

  // === WALL FACES ===
  for (const wall of data.walls) {
    const pts = wall.points;
    if (pts.length < 3 || wall.area < 0.05) continue;

    const isBig = wall.area > 50;
    const wallH = WALL_HEIGHT;

    // Render ALL walls as solid vertical faces
    const mesh = buildWallFaces(pts, wallH, wallMat);
    group.add(mesh);

    for (const [x, z] of pts) {
      extMinX = Math.min(extMinX, x); extMaxX = Math.max(extMaxX, x);
      extMinZ = Math.min(extMinZ, z); extMaxZ = Math.max(extMaxZ, z);
    }

    addEdgeSegments(pts, wallSegments, isBig, isBig ? 0.20 : 0.12);
  }

  // === HATCH as SOLID VOLUME (extruded outer - holes) ===
  if (data.hatchOuter && data.hatchHoles) {
    // Top + bottom caps
    const cap = buildHatchCap(data.hatchOuter, data.hatchHoles, WALL_HEIGHT, wallMat);
    group.add(cap);

    // Vertical walls for hatch outer boundary
    const outerWalls = buildWallFaces(data.hatchOuter, WALL_HEIGHT, wallMat);
    group.add(outerWalls);

    // Vertical walls for each hole boundary (inner faces)
    for (const hole of data.hatchHoles) {
      const holeWalls = buildWallFaces(hole, WALL_HEIGHT, wallMat);
      group.add(holeWalls);
    }
  }

  // === DOORS (header above + arc on floor; sliding gets glass strip instead of arc) ===
  if (data.doors) {
    const doorArcMat = new THREE.LineBasicMaterial({ color: 0xd4a843, opacity: 0.4, transparent: true });
    const headerMat = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const slidingGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xddf0ff, roughness: 0.02, metalness: 0.05,
      transparent: true, opacity: 0.18, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
    });
    const DOOR_H = 2.1;
    const HEADER_THICKNESS = 0.12;  // slim, blends with wall stripes

    for (const door of data.doors as DoorData[]) {
      const dw = door.width;
      const startDeg = ((door.startAngle || 0) % 360 + 360) % 360;
      const endDeg = ((door.endAngle || 90) % 360 + 360) % 360;
      const startRad = startDeg * Math.PI / 180;

      // Always render shortest arc; sign determines CW vs CCW
      let span = endDeg - startDeg;
      while (span > 180) span -= 360;
      while (span < -180) span += 360;
      const clockwise = span < 0;
      const arcEndRad = startRad + span * Math.PI / 180;

      // pivot.rotation.y = -startRad. Three.js Y-rot maps local +X to world (cos β, 0, -sin β).
      // Header center = hinge + (dw/2) along that direction.
      const cxw = door.x + (dw / 2) * Math.cos(startRad);
      const czw = door.z - (dw / 2) * Math.sin(startRad);

      const headerH = WALL_HEIGHT - DOOR_H;
      if (headerH > 0.05) {
        const hgGeo = new THREE.BoxGeometry(dw, headerH, HEADER_THICKNESS);
        const header = new THREE.Mesh(hgGeo, headerMat);
        header.position.set(cxw, DOOR_H + headerH / 2, czw);
        header.rotation.y = -startRad;
        header.castShadow = true;
        header.receiveShadow = true;
        group.add(header);
      }

      if (door.kind === 'sliding') {
        const glassGeo = new THREE.BoxGeometry(dw, DOOR_H, 0.04);
        const glass = new THREE.Mesh(glassGeo, slidingGlassMat);
        glass.position.set(cxw, DOOR_H / 2, czw);
        glass.rotation.y = -startRad;
        group.add(glass);
      } else {
        // Skip floor arc visualization (multiple nearby doors caused stacked-circle "cylinder").
        // Active swing panel below already indicates direction.
        doorPanels.push({
          hingeX: door.x, hingeZ: door.z,
          width: dw, height: DOOR_H,
          startAngle: startRad, endAngle: arcEndRad,
        });
      }
    }
  }

  // === WINDOWS (magenta rectangles = glass panels) ===
  if (data.windows) {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xddf0ff, roughness: 0.02, metalness: 0.05,
      transparent: true, opacity: 0.15, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.25, metalness: 0.7 });
    const subWallMat = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const WIN_WALL_H = WALL_HEIGHT;

    for (const win of data.windows as WindowData[]) {
      if (win.width < 0.3) continue;

      const isHoriz = !!(win as { horizontal?: number }).horizontal;
      const angle = isHoriz ? 0 : Math.PI / 2;
      const wallThick = 0.20;

      // Per-window sill + height from label
      const sill = win.fullHeight ? 0 : (win.sillM ?? 0.9);
      const winHeight = win.fullHeight ? WIN_WALL_H : Math.max(0.4, WIN_WALL_H - sill - 0.1);

      // Wall BELOW window (skip if full-height vitrina)
      if (sill > 0.05) {
        const belowGeo = new THREE.BoxGeometry(win.width, sill, wallThick);
        const below = new THREE.Mesh(belowGeo, subWallMat);
        below.position.set(win.x, sill / 2, win.z);
        below.rotation.y = angle;
        below.castShadow = true;
        group.add(below);
      }

      // Wall ABOVE window
      const aboveH = WIN_WALL_H - sill - winHeight;
      if (aboveH > 0.05) {
        const aboveGeo = new THREE.BoxGeometry(win.width, aboveH, wallThick);
        const above = new THREE.Mesh(aboveGeo, subWallMat);
        above.position.set(win.x, sill + winHeight + aboveH / 2, win.z);
        above.rotation.y = angle;
        above.castShadow = true;
        group.add(above);
      }

      // Glass panel
      const glassGeo = new THREE.BoxGeometry(win.width, winHeight, 0.02);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(win.x, sill + winHeight / 2, win.z);
      glass.rotation.y = angle;
      group.add(glass);

      // Frames top + sill (skip frame on full-height bottom)
      const ft = new THREE.Mesh(new THREE.BoxGeometry(win.width + 0.04, 0.03, wallThick + 0.02), frameMat);
      ft.position.set(win.x, sill + winHeight, win.z);
      ft.rotation.y = angle;
      group.add(ft);

      if (sill > 0.05) {
        const fs = new THREE.Mesh(new THREE.BoxGeometry(win.width + 0.04, 0.03, wallThick + 0.04), frameMat);
        fs.position.set(win.x, sill, win.z);
        fs.rotation.y = angle;
        group.add(fs);
      }
    }

  }

  // Also expand bounds from placed objects
  if (data.objects) {
    for (const obj of data.objects) {
      extMinX = Math.min(extMinX, obj.x - 1); extMaxX = Math.max(extMaxX, obj.x + 1);
      extMinZ = Math.min(extMinZ, obj.z - 1); extMaxZ = Math.max(extMaxZ, obj.z + 1);
    }
  }

  // Floor
  const floorW = extMaxX - extMinX + 0.3;
  const floorD = extMaxZ - extMinZ + 0.3;
  const floorGeo = new THREE.PlaneGeometry(floorW, floorD);
  const tileTexture = createTileFloorTexture();
  tileTexture.repeat.set(Math.ceil(floorW / 1.2), Math.ceil(floorD / 1.2));
  const floorMat = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.55, metalness: 0.05 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((extMinX + extMaxX) / 2, -0.01, (extMinZ + extMaxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // Ceiling
  const ceilingGeo = new THREE.PlaneGeometry(floorW, floorD);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((extMinX + extMaxX) / 2, WALL_HEIGHT, (extMinZ + extMaxZ) / 2);
  ceiling.receiveShadow = true;
  ceiling.visible = false; // off by default
  group.add(ceiling);

  scene.add(group);
  return {
    exteriorBounds: { minX: extMinX, maxX: extMaxX, minZ: extMinZ, maxZ: extMaxZ },
    wallSegments,
    dxfObjects: data.objects || [],
    doorPanels,
    ceiling,
  };
}

export function snapToWall(
  x: number, z: number, objDepth: number, walls: WallSegment[], snapDist: number = 0.5
): { x: number; z: number; rotation: number; snapped: boolean } {
  let bestDist = Infinity;
  let bestResult = { x, z, rotation: 0, snapped: false };
  for (const w of walls) {
    const wx = w.x2 - w.x1, wz = w.z2 - w.z1;
    const len2 = wx * wx + wz * wz;
    let t = ((x - w.x1) * wx + (z - w.z1) * wz) / len2;
    t = Math.max(0.05, Math.min(0.95, t));
    const cx = w.x1 + t * wx, cz = w.z1 + t * wz;
    const dist = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
    if (dist < snapDist && dist < bestDist) {
      bestDist = dist;
      const wallAngle = Math.atan2(wz, wx);
      const side = (x - cx) * w.nx + (z - cz) * w.nz;
      const sign = side >= 0 ? 1 : -1;
      const offset = w.thickness / 2 + objDepth / 2 + 0.005;
      bestResult = { x: cx + w.nx * offset * sign, z: cz + w.nz * offset * sign, rotation: sign >= 0 ? -wallAngle : -wallAngle + Math.PI, snapped: true };
    }
  }
  return bestResult;
}
