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

// Wall: full extruded prism (vertical faces + top + bottom cap).
// Top cap is required so top-down ortho view shows wall outline as solid polygons.
function buildWallFaces(pts: number[][], height: number, mat: THREE.Material): THREE.Mesh {
  // Drop trailing duplicate of first vertex if present (extractor closes polylines).
  const ring = pts.slice();
  if (ring.length > 1) {
    const first = ring[0]; const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) ring.pop();
  }
  if (ring.length < 3) {
    return new THREE.Mesh(new THREE.BufferGeometry(), mat);
  }

  // Triangulate floor cap with earcut for top + bottom.
  const flat: number[] = [];
  for (const [x, z] of ring) flat.push(x, z);
  const tri = earcut(flat, [], 2);

  const vertices: number[] = [];
  const indices: number[] = [];
  let vi = 0;

  // Side faces (vertical) — winding chosen so outward normal matches CCW polygon.
  const closed = [...ring, ring[0]];
  for (let i = 0; i < closed.length - 1; i++) {
    const [x1, z1] = closed[i];
    const [x2, z2] = closed[i + 1];
    const base = vi;
    vertices.push(x1, 0, z1, x2, 0, z2, x2, height, z2, x1, height, z1);
    vi += 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Top cap (visible from above)
  const topBase = vi;
  for (const [x, z] of ring) { vertices.push(x, height, z); vi += 1; }
  for (let i = 0; i < tri.length; i += 3) {
    indices.push(topBase + tri[i], topBase + tri[i + 1], topBase + tri[i + 2]);
  }

  // Bottom cap (reverse winding so it faces down)
  const botBase = vi;
  for (const [x, z] of ring) { vertices.push(x, 0, z); vi += 1; }
  for (let i = 0; i < tri.length; i += 3) {
    indices.push(botBase + tri[i + 2], botBase + tri[i + 1], botBase + tri[i]);
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
  // Uniform red-brown wood with subtle horizontal grain (single color, no plank seams).
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Base color: rich reddish-brown
  ctx.fillStyle = '#9c4a2c';
  ctx.fillRect(0, 0, size, size);
  // Horizontal grain streaks
  for (let s = 0; s < 200; s++) {
    const sy = Math.random() * size;
    const dark = Math.random() < 0.5;
    ctx.strokeStyle = dark
      ? `rgba(60, 25, 12, ${0.06 + Math.random() * 0.10})`
      : `rgba(220, 160, 120, ${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.bezierCurveTo(size * 0.25, sy + (Math.random() - 0.5) * 3, size * 0.75, sy + (Math.random() - 0.5) * 3, size, sy);
    ctx.stroke();
  }
  // Soft luminance variation across surface
  for (let i = 0; i < 6; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = size * (0.25 + Math.random() * 0.35);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(${Math.random() < 0.5 ? '40,15,5' : '200,140,100'}, 0.05)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
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

export interface SlidingDoor {
  group: THREE.Group;
  panelL: THREE.Mesh;
  panelR: THREE.Mesh;
  halfW: number;
}

export function loadBuildingIntoScene(scene: THREE.Scene): {
  exteriorBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  wallSegments: WallSegment[];
  dxfObjects: DxfObject[];
  doorPanels: DoorPanel[];
  slidingDoors: SlidingDoor[];
  ceiling: THREE.Mesh;
} {
  const data = buildingData as BuildingJSON;
  const group = new THREE.Group();
  group.userData = { type: 'building' };
  const wallSegments: WallSegment[] = [];
  const doorPanels: DoorPanel[] = [];
  const slidingDoors: SlidingDoor[] = [];

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

      // Header (lintel) skipped: caused floating slabs in top-down view + misaligned with walls.
      // Door opening = natural gap in wall hatch is sufficient. May reintroduce later with proper wall snap.
      void headerMat; void HEADER_THICKNESS;

      if (door.kind === 'sliding') {
        // Gas-station style double sliding glass door.
        // Default to 2m if marker arc was tiny (e.g., 0.2m placeholder).
        const slideW = Math.max(dw, 2.0);
        const slideH = 2.3;
        const halfW = slideW / 2;
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });
        const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7 });
        // Re-center on opening midpoint; build a local group then rotate
        const grp = new THREE.Group();
        grp.position.set(cxw, 0, czw);
        grp.rotation.y = -startRad;

        // Frame posts at edges
        const postGeo = new THREE.BoxGeometry(0.06, slideH, 0.14);
        const post1 = new THREE.Mesh(postGeo, frameMat); post1.position.set(-halfW, slideH / 2, 0); grp.add(post1);
        const post2 = new THREE.Mesh(postGeo, frameMat); post2.position.set(+halfW, slideH / 2, 0); grp.add(post2);
        // Top rail (lintel for the doors)
        const topGeo = new THREE.BoxGeometry(slideW + 0.06, 0.18, 0.18);
        const topRail = new THREE.Mesh(topGeo, railMat); topRail.position.set(0, slideH + 0.09, 0); grp.add(topRail);
        // Bottom track
        const botGeo = new THREE.BoxGeometry(slideW, 0.03, 0.10);
        const botRail = new THREE.Mesh(botGeo, railMat); botRail.position.set(0, 0.015, 0); grp.add(botRail);
        // Two glass panels: each (slideW/2 - small gap) wide, slightly inset
        const panelW = (slideW / 2) - 0.04;
        const panelGeo = new THREE.BoxGeometry(panelW, slideH - 0.18, 0.04);
        const panelL = new THREE.Mesh(panelGeo, slidingGlassMat);
        panelL.position.set(-panelW / 2 - 0.02, (slideH - 0.18) / 2, 0);
        grp.add(panelL);
        const panelR = new THREE.Mesh(panelGeo, slidingGlassMat);
        panelR.position.set(+panelW / 2 + 0.02, (slideH - 0.18) / 2, 0);
        grp.add(panelR);
        // Sensor light
        const sensorMat = new THREE.MeshStandardMaterial({ color: 0x66ff66, emissive: 0x66ff66, emissiveIntensity: 0.6 });
        const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), sensorMat);
        sensor.position.set(0, slideH + 0.18 + 0.04, 0.10);
        grp.add(sensor);

        grp.userData = { type: 'slidingDoor', isOpen: false };
        // Tag panels so click detection finds them
        panelL.userData = { type: 'slidingDoor' };
        panelR.userData = { type: 'slidingDoor' };
        slidingDoors.push({ group: grp, panelL, panelR, halfW });

        group.add(grp);
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
  // Repeat texture: ~3m per tile so grain looks natural.
  tileTexture.repeat.set(Math.max(1, Math.ceil(floorW / 3)), Math.max(1, Math.ceil(floorD / 3)));
  const floorMat = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.78, metalness: 0.02 });
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

  // === EXTERIOR: Gas station canopy + 3 fuel pumps (in front of sliding door entrance) ===
  {
    const canopyGroup = new THREE.Group();
    canopyGroup.userData = { type: 'canopy' };
    // Find sliding door if any to position canopy in front of entrance
    const slidingDoor = (data.doors || []).find(d => (d as DoorData).kind === 'sliding');
    let cx = extMaxX + 7; // fallback east
    let cz = (extMinZ + extMaxZ) / 2;
    let canopyRotY = 0;
    if (slidingDoor) {
      const sa = slidingDoor.startAngle * Math.PI / 180;
      // outward normal of door (perpendicular to closed direction): rotate (1,0,0) by sa+90 around Y
      const outX = Math.sin(sa);
      const outZ = Math.cos(sa);
      const dist = 8;
      cx = slidingDoor.x + outX * dist;
      cz = slidingDoor.z + outZ * dist;
      canopyRotY = sa; // align canopy long axis perpendicular to door
    }
    const canopyW = 6, canopyD = 12, canopyH = 5;

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.35, metalness: 0.25 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.30, metalness: 0.15 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x0050b3, roughness: 0.4, metalness: 0.4, emissive: 0x002a66, emissiveIntensity: 0.15 });

    // Roof slab
    const roof = new THREE.Mesh(new THREE.BoxGeometry(canopyW, 0.20, canopyD), roofMat);
    roof.position.set(cx, canopyH, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    canopyGroup.add(roof);
    // OMW-style blue trim under roof edge
    const trim = new THREE.Mesh(new THREE.BoxGeometry(canopyW + 0.10, 0.35, canopyD + 0.10), trimMat);
    trim.position.set(cx, canopyH - 0.30, cz);
    canopyGroup.add(trim);

    // 4 corner pillars
    const pillarHalfW = canopyW / 2 - 0.30, pillarHalfD = canopyD / 2 - 0.30;
    for (const [px, pz] of [[-pillarHalfW, -pillarHalfD], [pillarHalfW, -pillarHalfD], [-pillarHalfW, pillarHalfD], [pillarHalfW, pillarHalfD]] as [number, number][]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.30, canopyH, 0.30), pillarMat);
      pillar.position.set(cx + px, canopyH / 2, cz + pz);
      pillar.castShadow = true;
      canopyGroup.add(pillar);
    }

    // 3 fuel pumps in a row centered along Z, on small island bases
    const pumpBaseMat = new THREE.MeshStandardMaterial({ color: 0xb5b5b5, roughness: 0.7, metalness: 0.05 });
    const pumpBodyMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.35, metalness: 0.3 });
    const pumpScreenMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x0066cc, emissiveIntensity: 0.4 });
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
    const spacing = canopyD / 4;  // 3 pumps across canopy length
    for (let i = 0; i < 3; i++) {
      const pz = cz - canopyD / 2 + spacing * (i + 1);
      // Island base
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.7), pumpBaseMat);
      island.position.set(cx, 0.09, pz);
      island.receiveShadow = true; island.castShadow = true;
      canopyGroup.add(island);
      // Pump body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.85, 0.42), pumpBodyMat);
      body.position.set(cx, 0.18 + 1.85 / 2, pz);
      body.castShadow = true;
      canopyGroup.add(body);
      // Display screen front
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.30, 0.02), pumpScreenMat);
      scr.position.set(cx, 0.18 + 1.85 - 0.30, pz + 0.22);
      canopyGroup.add(scr);
      // Top OMW logo strip
      const logo = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.43), trimMat);
      logo.position.set(cx, 0.18 + 1.85 + 0.09, pz);
      canopyGroup.add(logo);
      // Nozzle holders (2 sides)
      for (const side of [-1, 1]) {
        const noz = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.45, 0.16), nozzleMat);
        noz.position.set(cx + side * 0.30, 0.18 + 1.20, pz);
        canopyGroup.add(noz);
      }
    }

    // Concrete forecourt slab under canopy
    const forecourtMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85 });
    const forecourt = new THREE.Mesh(new THREE.PlaneGeometry(canopyW + 1.5, canopyD + 2), forecourtMat);
    forecourt.rotation.x = -Math.PI / 2;
    forecourt.position.set(cx, 0.005, cz);
    forecourt.receiveShadow = true;
    canopyGroup.add(forecourt);

    void canopyRotY;
    scene.add(canopyGroup);
  }

  scene.add(group);
  return {
    exteriorBounds: { minX: extMinX, maxX: extMaxX, minZ: extMinZ, maxZ: extMaxZ },
    wallSegments,
    dxfObjects: data.objects || [],
    doorPanels,
    slidingDoors,
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
