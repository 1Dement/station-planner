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
}

interface WindowData {
  x: number; z: number;
  width: number;
  depth: number;
  horizontal: number;
  points: number[][];
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
} {
  const data = buildingData as BuildingJSON;
  const group = new THREE.Group();
  group.userData = { type: 'building' };
  const wallSegments: WallSegment[] = [];
  const doorPanels: DoorPanel[] = [];

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd0c8b0,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.25 });

  let extMinX = Infinity, extMaxX = -Infinity, extMinZ = Infinity, extMaxZ = -Infinity;

  // === WALL FACES (vertical only, no caps) ===
  for (const wall of data.walls) {
    const pts = wall.points;
    if (pts.length < 3 || wall.area < 0.05) continue;

    const isBig = wall.area > 50;
    const wallH = isBig ? WALL_HEIGHT : INTERIOR_WALL_HEIGHT;

    const mesh = buildWallFaces(pts, wallH, wallMat);
    group.add(mesh);

    // Top edge
    const topPts = [...pts, pts[0]].map(([x, z]) => new THREE.Vector3(x, wallH, z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts), edgeMat));

    // Always track bounds from all walls
    for (const [x, z] of pts) {
      extMinX = Math.min(extMinX, x); extMaxX = Math.max(extMaxX, x);
      extMinZ = Math.min(extMinZ, z); extMaxZ = Math.max(extMaxZ, z);
    }

    addEdgeSegments(pts, wallSegments, isBig, isBig ? 0.20 : 0.12);
  }

  // === HATCH CAP (top surface covering wall thickness) ===
  if (data.hatchOuter && data.hatchHoles) {
    const cap = buildHatchCap(data.hatchOuter, data.hatchHoles, WALL_HEIGHT, wallMat);
    group.add(cap);
  }

  // === DOORS (aligned to nearest wall, uniform top) ===
  if (data.doors) {
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.6, metalness: 0.1 });
    const doorArcMat = new THREE.LineBasicMaterial({ color: 0xffc107, opacity: 0.6, transparent: true });
    const DOOR_H = 2.1;
    const FRAME_W = 0.04;
    const WALL_THICK = 0.20;
    // All walls top at same height = INTERIOR_WALL_HEIGHT for interior doors
    const UNIFORM_TOP = INTERIOR_WALL_HEIGHT;

    for (const door of data.doors as DoorData[]) {
      const dw = door.width;
      const startRad = (door.startAngle || 0) * Math.PI / 180;
      const endRad = (door.endAngle || 90) * Math.PI / 180;

      // Find nearest wall segment to align door frame
      let bestWallAngle = startRad;
      let bestDist = Infinity;
      for (const ws of wallSegments) {
        const wx = ws.x2 - ws.x1, wz = ws.z2 - ws.z1;
        const len2 = wx * wx + wz * wz;
        if (len2 < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((door.x - ws.x1) * wx + (door.z - ws.z1) * wz) / len2));
        const cx = ws.x1 + t * wx, cz = ws.z1 + t * wz;
        const dist = Math.sqrt((door.x - cx) ** 2 + (door.z - cz) ** 2);
        if (dist < bestDist && dist < 0.5) {
          bestDist = dist;
          bestWallAngle = Math.atan2(wz, wx);
        }
      }

      // Snap wall angle to nearest 90° (walls are axis-aligned)
      let wallAngle = bestWallAngle;
      const snapAngles = [0, Math.PI/2, Math.PI, -Math.PI/2, -Math.PI];
      let minDiff = Infinity;
      for (const sa of snapAngles) {
        const diff = Math.abs(wallAngle - sa);
        if (diff < minDiff) { minDiff = diff; wallAngle = sa; }
      }

      // Door opening direction from startAngle — determines which side panel opens
      // Frame goes along wall, perpendicular to opening direction
      const cosA = Math.cos(wallAngle), sinA = Math.sin(wallAngle);
      const latchX = door.x + cosA * dw;
      const latchZ = door.z + sinA * dw;
      const midX = (door.x + latchX) / 2;
      const midZ = (door.z + latchZ) / 2;

      // Frame posts — same height as door, NOT taller
      const hingePost = new THREE.Mesh(new THREE.BoxGeometry(FRAME_W, DOOR_H, FRAME_W), doorFrameMat);
      hingePost.position.set(door.x, DOOR_H / 2, door.z);
      group.add(hingePost);

      const latchPost = new THREE.Mesh(new THREE.BoxGeometry(FRAME_W, DOOR_H, FRAME_W), doorFrameMat);
      latchPost.position.set(latchX, DOOR_H / 2, latchZ);
      group.add(latchPost);

      // Top beam — flush with door top
      const beam = new THREE.Mesh(new THREE.BoxGeometry(dw, FRAME_W, FRAME_W), doorFrameMat);
      beam.position.set(midX, DOOR_H, midZ);
      beam.rotation.y = -wallAngle;
      group.add(beam);

      // Door panel (movable)
      doorPanels.push({
        hingeX: door.x, hingeZ: door.z,
        width: dw, height: DOOR_H,
        startAngle: startRad, endAngle: endRad,
      });

      // Arc on floor
      const arcStart = Math.min(startRad, endRad);
      const arcEnd = Math.max(startRad, endRad);
      const curve = new THREE.EllipseCurve(door.x, door.z, dw, dw, arcStart, arcEnd, false, 0);
      const arcPts = curve.getPoints(16).map(p => new THREE.Vector3(p.x, 0.02, p.y));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), doorArcMat));

      // Wall above door — exact width of door opening, uniform height
      const aboveH = UNIFORM_TOP - DOOR_H;
      if (aboveH > 0.05) {
        const above = new THREE.Mesh(new THREE.BoxGeometry(dw, aboveH, WALL_THICK), wallMat);
        above.position.set(midX, DOOR_H + aboveH / 2, midZ);
        above.rotation.y = -wallAngle;
        above.castShadow = true;
        group.add(above);
      }
    }
  }

  // === WINDOWS (magenta rectangles = glass panels) ===
  if (data.windows) {
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88ccee, roughness: 0.05, metalness: 0.1,
      transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.5 });
    const subWallMat = new THREE.MeshStandardMaterial({ color: 0xd0c8b0, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
    const WIN_SILL = 0.9;
    const WIN_HEIGHT = 1.4;
    const WIN_WALL_H = WALL_HEIGHT;

    for (const win of data.windows as WindowData[]) {
      if (win.width < 0.3) continue;

      const isHoriz = !!(win as { horizontal?: number }).horizontal;
      const angle = isHoriz ? 0 : Math.PI / 2;
      const wallThick = 0.20;

      // Wall BELOW window (podea → pervaz)
      const belowGeo = new THREE.BoxGeometry(win.width, WIN_SILL, wallThick);
      const below = new THREE.Mesh(belowGeo, subWallMat);
      below.position.set(win.x, WIN_SILL / 2, win.z);
      below.rotation.y = angle;
      below.castShadow = true;
      group.add(below);

      // Wall ABOVE window (top geam → tavan)
      const aboveH = WIN_WALL_H - WIN_SILL - WIN_HEIGHT;
      if (aboveH > 0.05) {
        const aboveGeo = new THREE.BoxGeometry(win.width, aboveH, wallThick);
        const above = new THREE.Mesh(aboveGeo, subWallMat);
        above.position.set(win.x, WIN_SILL + WIN_HEIGHT + aboveH / 2, win.z);
        above.rotation.y = angle;
        above.castShadow = true;
        group.add(above);
      }

      // Glass panel
      const glassGeo = new THREE.BoxGeometry(win.width, WIN_HEIGHT, 0.02);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(win.x, WIN_SILL + WIN_HEIGHT / 2, win.z);
      glass.rotation.y = angle;
      group.add(glass);

      // Frame top + sill
      const ft = new THREE.Mesh(new THREE.BoxGeometry(win.width + 0.04, 0.03, wallThick + 0.02), frameMat);
      ft.position.set(win.x, WIN_SILL + WIN_HEIGHT, win.z);
      ft.rotation.y = angle;
      group.add(ft);

      const fs = new THREE.Mesh(new THREE.BoxGeometry(win.width + 0.04, 0.03, wallThick + 0.04), frameMat);
      fs.position.set(win.x, WIN_SILL, win.z);
      fs.rotation.y = angle;
      group.add(fs);
    }

    // === AUTO SLIDING DOOR — find gap between front windows ===
    // Deduplicate windows by position
    const uniqueWins: WindowData[] = [];
    for (const w of data.windows as WindowData[]) {
      if (!uniqueWins.some(u => Math.abs(u.x - w.x) < 0.3 && Math.abs(u.z - w.z) < 0.3)) {
        uniqueWins.push(w);
      }
    }
    // Find pairs of windows on same Z with a gap between them
    for (let i = 0; i < uniqueWins.length; i++) {
      for (let j = i + 1; j < uniqueWins.length; j++) {
        const w1 = uniqueWins[i], w2 = uniqueWins[j];
        if (Math.abs(w1.z - w2.z) > 0.5) continue;
        // Calculate gap
        const left = w1.x < w2.x ? w1 : w2;
        const right = w1.x < w2.x ? w2 : w1;
        const gapLeft = left.x + left.width / 2;
        const gapRight = right.x - right.width / 2;
        const gapW = gapRight - gapLeft;
        if (gapW < 0.8 || gapW > 4) continue; // gap must be 0.8-4m

        const doorX = (gapLeft + gapRight) / 2;
        const doorZ = (w1.z + w2.z) / 2;
        const doorW = gapW;
        const DOOR_H = 2.3;

        if (true) {
          const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });

          // Frame posts
          const postGeo = new THREE.BoxGeometry(0.06, DOOR_H, 0.12);
          const post1 = new THREE.Mesh(postGeo, doorFrameMat);
          post1.position.set(doorX - doorW/2, DOOR_H/2, doorZ);
          group.add(post1);
          const post2 = new THREE.Mesh(postGeo, doorFrameMat);
          post2.position.set(doorX + doorW/2, DOOR_H/2, doorZ);
          group.add(post2);

          // Top frame
          const topGeo = new THREE.BoxGeometry(doorW + 0.06, 0.15, 0.12);
          const topFrame = new THREE.Mesh(topGeo, doorFrameMat);
          topFrame.position.set(doorX, DOOR_H, doorZ);
          group.add(topFrame);

          // Glass doors (2 panels, slightly open)
          const panelW = doorW / 2 - 0.05;
          const doorGlassMat = new THREE.MeshStandardMaterial({
            color: 0x99ccdd, roughness: 0.05, metalness: 0.1,
            transparent: true, opacity: 0.25, side: THREE.DoubleSide,
          });
          const panelGeo = new THREE.BoxGeometry(panelW, DOOR_H - 0.2, 0.03);
          const leftDoor = new THREE.Mesh(panelGeo, doorGlassMat);
          leftDoor.position.set(doorX - panelW/2 - 0.02, DOOR_H/2, doorZ);
          group.add(leftDoor);
          const rightDoor = new THREE.Mesh(panelGeo, doorGlassMat);
          rightDoor.position.set(doorX + panelW/2 + 0.02, DOOR_H/2, doorZ);
          group.add(rightDoor);

          // Bottom rail
          const rail = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.03, 0.08), doorFrameMat);
          rail.position.set(doorX, 0.015, doorZ);
          group.add(rail);

          // Sensor on top
          const sensorMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.5 });
          const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), sensorMat);
          sensor.position.set(doorX, DOOR_H + 0.05, doorZ + 0.06);
          group.add(sensor);

          // Wall above door — uniform with other doors
          const aboveDoorH = WIN_WALL_H - DOOR_H;
          if (aboveDoorH > 0.05) {
            const aboveGeo = new THREE.BoxGeometry(doorW + 0.06, aboveDoorH, 0.20);
            const above = new THREE.Mesh(aboveGeo, subWallMat);
            above.position.set(doorX, DOOR_H + aboveDoorH/2, doorZ);
            above.castShadow = true;
            group.add(above);
          }
        }
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x505050, roughness: 0.85, metalness: 0.1 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((extMinX + extMaxX) / 2, -0.01, (extMinZ + extMaxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  scene.add(group);
  return {
    exteriorBounds: { minX: extMinX, maxX: extMaxX, minZ: extMinZ, maxZ: extMaxZ },
    wallSegments,
    dxfObjects: data.objects || [],
    doorPanels,
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
