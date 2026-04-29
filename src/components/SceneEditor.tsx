'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CATALOG, CATEGORIES, CatalogItem, getCatalogByCategory } from '@/lib/catalog';
import {
  PlacedObject, createPlacedObject, highlightObject,
  checkCollision, getDistance, exportLayout
} from '@/lib/scene-objects';
import { loadBuildingIntoScene, snapToWall, WallSegment, DoorPanel } from '@/lib/building-loader';

const DEFAULT_ROOM_WIDTH = 12;
const DEFAULT_ROOM_DEPTH = 8;
const GRID_SNAP = 0.05;

function setEmissiveAll(obj: THREE.Object3D, color: number, intensity: number) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.set(color);
      child.material.emissiveIntensity = intensity;
    }
  });
}

export default function SceneEditor() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const togglePlanView = () => setViewMode((m) => (m === '3d' ? '2d' : '3d'));
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const composerRef = useRef<any>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const objectsRef = useRef<PlacedObject[]>([]);
  const selectedRef = useRef<PlacedObject | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const floorPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const roomWidthRef = useRef(DEFAULT_ROOM_WIDTH);
  const roomDepthRef = useRef(DEFAULT_ROOM_DEPTH);
  const buildingBoundsRef = useRef<{ minX: number; maxX: number; minZ: number; maxZ: number } | null>(null);
  const wallSegmentsRef = useRef<WallSegment[]>([]);
  const doorPanelsRef = useRef<Array<{ panel: THREE.Object3D; pivot: THREE.Group; info: DoorPanel }>>([]);
  const ceilingRef = useRef<THREE.Mesh | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const mouseDownPosRef = useRef(new THREE.Vector2());
  // Door toggle (click to open/close)
  const snapLinesRef = useRef<THREE.Group | null>(null);

  const [selectedObj, setSelectedObj] = useState<PlacedObject | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('shelving');
  const [showCatalog, setShowCatalog] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collisions, setCollisions] = useState<string[]>([]);
  const [objectCount, setObjectCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Gata de lucru');
  const [roomWidth, setRoomWidth] = useState(DEFAULT_ROOM_WIDTH);
  const [roomDepth, setRoomDepth] = useState(DEFAULT_ROOM_DEPTH);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);
  const [showCeiling, setShowCeiling] = useState(false);
  const [fpMode, setFpMode] = useState(false);
  const fpModeRef = useRef(false);
  const [fpEditMode, setFpEditMode] = useState(false);
  const fpEditRef = useRef(false);
  const [orbitEditMode, setOrbitEditMode] = useState(false);
  const orbitEditRef = useRef(false);
  const [fpAction, setFpAction] = useState<{ obj: PlacedObject; x: number; y: number } | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const selectedObjects = useRef<PlacedObject[]>([]); // multiSelect support
  const fpDraggingRef = useRef<PlacedObject | null>(null);
  const [fpDragging, setFpDragging] = useState<string | null>(null); // name of dragged obj
  const [measureMode, setMeasureMode] = useState(false);
  const measurePt1Ref = useRef<THREE.Vector3 | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);
  const measureLabelRef = useRef<THREE.Sprite | null>(null);
  const fpKeysRef = useRef<Set<string>>(new Set());
  const fpYawRef = useRef(0);
  const fpPitchRef = useRef(0);
  const fpTickRef = useRef<(() => void) | null>(null);

  // Undo/redo
  interface HistoryEntry { id: string; x: number; z: number; ry: number }
  const undoStackRef = useRef<HistoryEntry[][]>([]);
  const redoStackRef = useRef<HistoryEntry[][]>([]);

  // Keep refs in sync for use in event handlers
  useEffect(() => { roomWidthRef.current = roomWidth; }, [roomWidth]);
  useEffect(() => { roomDepthRef.current = roomDepth; }, [roomDepth]);
  useEffect(() => { fpModeRef.current = fpMode; }, [fpMode]);
  // Resize 3D viewport when catalog panel opens/closes
  useEffect(() => {
    setTimeout(() => {
      if (!canvasRef.current || !rendererRef.current || !cameraRef.current || !composerRef.current) return;
      const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      composerRef.current.setSize(w, h);
    }, 350); // after CSS transition
  }, [showCatalog]);
  useEffect(() => { fpEditRef.current = fpEditMode; }, [fpEditMode]);
  useEffect(() => { orbitEditRef.current = orbitEditMode; }, [orbitEditMode]);

  const snap = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;

  const clearSnapLines = () => {
    const g = snapLinesRef.current;
    if (!g) return;
    while (g.children.length) {
      const c = g.children[0];
      if (c instanceof THREE.Line) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      if (c instanceof THREE.Sprite) { (c.material as THREE.SpriteMaterial).map?.dispose(); (c.material as THREE.SpriteMaterial).dispose(); }
      g.remove(c);
    }
  };

  const addSnapLine = (x1: number, z1: number, x2: number, z2: number) => {
    const g = snapLinesRef.current;
    if (!g) return;
    const mat = new THREE.LineDashedMaterial({ color: 0x0071e3, dashSize: 0.08, gapSize: 0.05, linewidth: 1, transparent: true, opacity: 0.7 });
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, 0.03, z1),
      new THREE.Vector3(x2, 0.03, z2),
    ]);
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    g.add(line);
  };

  const addSnapDistLabel = (x: number, z: number, dist: number) => {
    const g = snapLinesRef.current;
    if (!g || dist < 0.02) return;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,113,227,0.85)';
    ctx.roundRect(0, 0, 128, 40, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${(dist * 100).toFixed(0)} cm`, 64, 20);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.set(x, 0.4, z);
    sprite.scale.set(0.6, 0.19, 1);
    g.add(sprite);
  };

  // Snap with visual indicators - returns snapped position + draws lines
  const snapWithIndicators = (obj: PlacedObject, rawX: number, rawZ: number): [number, number] => {
    clearSnapLines();
    let nx = rawX, nz = rawZ;
    const tw = obj.dimensions.width / 2, td = obj.dimensions.depth / 2;
    let snappedWall = false;

    // Wall snap
    if (wallSegmentsRef.current.length > 0) {
      const r = snapToWall(nx, nz, obj.dimensions.depth, wallSegmentsRef.current, 0.6);
      if (r.snapped) {
        nx = r.x; nz = r.z; obj.mesh.rotation.y = r.rotation;
        snappedWall = true;
        // Draw wall snap line
        const ws = wallSegmentsRef.current.find(w => {
          const wx = w.x2 - w.x1, wz = w.z2 - w.z1;
          const len2 = wx * wx + wz * wz;
          if (len2 < 0.01) return false;
          const t = Math.max(0, Math.min(1, ((nx - w.x1) * wx + (nz - w.z1) * wz) / len2));
          const cx = w.x1 + t * wx, cz = w.z1 + t * wz;
          return Math.sqrt((nx - cx) ** 2 + (nz - cz) ** 2) < 0.8;
        });
        if (ws) addSnapLine(ws.x1, ws.z1, ws.x2, ws.z2);
      }
    }

    // Tetris snap to other objects
    const SNAP_T = 0.12;
    for (const other of objectsRef.current) {
      if (other.id === obj.id) continue;
      const ox = other.mesh.position.x, oz = other.mesh.position.z;
      const ow = other.dimensions.width / 2, od = other.dimensions.depth / 2;

      // Edge-to-edge X
      if (Math.abs(nz - oz) < Math.max(od, td) + 0.3) {
        if (Math.abs((nx + tw) - (ox - ow)) < SNAP_T) {
          nx = ox - ow - tw;
          addSnapLine(ox - ow, oz - od - 0.3, ox - ow, oz + od + 0.3);
          addSnapDistLabel((nx + ox) / 2, (nz + oz) / 2, 0);
        }
        if (Math.abs((nx - tw) - (ox + ow)) < SNAP_T) {
          nx = ox + ow + tw;
          addSnapLine(ox + ow, oz - od - 0.3, ox + ow, oz + od + 0.3);
        }
      }
      // Edge-to-edge Z
      if (Math.abs(nx - ox) < Math.max(ow, tw) + 0.3) {
        if (Math.abs((nz + td) - (oz - od)) < SNAP_T) {
          nz = oz - od - td;
          addSnapLine(ox - ow - 0.3, oz - od, ox + ow + 0.3, oz - od);
        }
        if (Math.abs((nz - td) - (oz + od)) < SNAP_T) {
          nz = oz + od + td;
          addSnapLine(ox - ow - 0.3, oz + od, ox + ow + 0.3, oz + od);
        }
      }
      // Align same row/column
      if (Math.abs(nz - oz) < SNAP_T && Math.abs(nx - ox) < ow + tw + 0.5) {
        nz = oz;
        addSnapLine(Math.min(nx - tw, ox - ow) - 0.3, oz, Math.max(nx + tw, ox + ow) + 0.3, oz);
      }
      if (Math.abs(nx - ox) < SNAP_T && Math.abs(nz - oz) < od + td + 0.5) {
        nx = ox;
        addSnapLine(ox, Math.min(nz - td, oz - od) - 0.3, ox, Math.max(nz + td, oz + od) + 0.3);
      }
    }

    // Grid snap as fallback (only if no wall/tetris snap)
    if (!snappedWall) {
      const G = 0.10;
      const gridX = Math.round(nx / G) * G;
      const gridZ = Math.round(nz / G) * G;
      // Only apply grid if no tetris snapped (check if we moved from raw)
      if (Math.abs(nx - rawX) < 0.01) nx = gridX;
      if (Math.abs(nz - rawZ) < 0.01) nz = gridZ;
    }

    return [nx, nz];
  };

  const saveSnapshot = () => {
    const snapshot = objectsRef.current.map(o => ({
      id: o.id, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
    }));
    undoStackRef.current.push(snapshot);
    redoStackRef.current = [];
  };

  const applySnapshot = (snap: { id: string; x: number; z: number; ry: number }[]) => {
    for (const s of snap) {
      const obj = objectsRef.current.find(o => o.id === s.id);
      if (obj) { obj.mesh.position.x = s.x; obj.mesh.position.z = s.z; obj.mesh.rotation.y = s.ry; }
    }
    checkAllCollisions();
  };

  const undo = () => {
    if (undoStackRef.current.length === 0) return;
    const current = objectsRef.current.map(o => ({
      id: o.id, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
    }));
    redoStackRef.current.push(current);
    const prev = undoStackRef.current.pop()!;
    applySnapshot(prev);
    setStatusMsg('Undo');
  };

  const clearMeasure = () => {
    if (measureLineRef.current && sceneRef.current) {
      sceneRef.current.remove(measureLineRef.current);
      measureLineRef.current.geometry.dispose();
      measureLineRef.current = null;
    }
    if (measureLabelRef.current && sceneRef.current) {
      sceneRef.current.remove(measureLabelRef.current);
      if (measureLabelRef.current.material instanceof THREE.SpriteMaterial) {
        measureLabelRef.current.material.map?.dispose();
        measureLabelRef.current.material.dispose();
      }
      measureLabelRef.current = null;
    }
    measurePt1Ref.current = null;
  };

  const handleMeasureClick = (clientX: number, clientY: number) => {
    const pt = getFloorIntersection(clientX, clientY);
    if (!pt || !sceneRef.current) return;

    if (!measurePt1Ref.current) {
      // First click
      clearMeasure();
      measurePt1Ref.current = pt.clone();
      setStatusMsg('Masurare: click al doilea punct');
    } else {
      // Second click — draw line + label
      const p1 = measurePt1Ref.current;
      const p2 = pt.clone();
      const dist = p1.distanceTo(p2);

      const lineMat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, 0.05, p1.z),
        new THREE.Vector3(p2.x, 0.05, p2.z),
      ]);
      const line = new THREE.Line(lineGeo, lineMat);
      sceneRef.current.add(line);
      measureLineRef.current = line;

      // Label
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(220,40,40,0.85)';
      ctx.roundRect(0, 0, 256, 64, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${dist.toFixed(2)} m`, 128, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.position.set((p1.x + p2.x) / 2, 0.5, (p1.z + p2.z) / 2);
      sprite.scale.set(1.2, 0.3, 1);
      sceneRef.current.add(sprite);
      measureLabelRef.current = sprite;

      setStatusMsg(`Distanta: ${dist.toFixed(2)} m`);
      measurePt1Ref.current = null;
    }
  };

  const redo = () => {
    if (redoStackRef.current.length === 0) return;
    const current = objectsRef.current.map(o => ({
      id: o.id, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
    }));
    undoStackRef.current.push(current);
    const next = redoStackRef.current.pop()!;
    applySnapshot(next);
    setStatusMsg('Redo');
  };

  const getFloorIntersection = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    if (!rendererRef.current || !cameraRef.current) return null;
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycasterRef.current.setFromCamera(mouse, cameraRef.current);
    const target = new THREE.Vector3();
    const hit = raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, target);
    return hit ? target : null;
  }, []);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaecf0);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50, canvasRef.current.clientWidth / canvasRef.current.clientHeight, 0.1, 200
    );
    camera.position.set(10, 8, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    canvasRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Indoor environment lighting (reflections + soft ambient)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI / 2.05;
    orbit.minDistance = 2;
    orbit.maxDistance = 50;
    orbit.target.set(0, 0, 0);
    orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    orbitRef.current = orbit;

    // Lights — warm indoor setup
    const ambientLight = new THREE.AmbientLight(0xfff8f0, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
    dirLight.position.set(6, 10, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 40;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.radius = 4;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xc4d8f0, 0.5);
    fillLight.position.set(-6, 6, -4);
    scene.add(fillLight);

    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0xe8dcc8, 0.6);
    scene.add(hemiLight);

    // Load building from DXF data
    const buildingResult = loadBuildingIntoScene(scene);
    buildingBoundsRef.current = buildingResult.exteriorBounds;
    wallSegmentsRef.current = buildingResult.wallSegments;
    ceilingRef.current = buildingResult.ceiling;
    const bw = buildingResult.exteriorBounds.maxX - buildingResult.exteriorBounds.minX;
    const bd = buildingResult.exteriorBounds.maxZ - buildingResult.exteriorBounds.minZ;
    setRoomWidth(Math.ceil(bw));
    setRoomDepth(Math.ceil(bd));
    roomWidthRef.current = Math.ceil(bw);
    roomDepthRef.current = Math.ceil(bd);

    // Position camera to see the whole building
    camera.position.set(bw * 0.6, Math.max(bw, bd) * 0.5, bd * 0.8);
    orbit.target.set(
      (buildingResult.exteriorBounds.minX + buildingResult.exteriorBounds.maxX) / 2,
      1,
      (buildingResult.exteriorBounds.minZ + buildingResult.exteriorBounds.maxZ) / 2
    );
    orbit.update();

    const gridHelper = new THREE.GridHelper(40, 40, 0xc0c0c0, 0xd4d4d4);
    gridHelper.position.y = 0.005;
    scene.add(gridHelper);

    // Exterior environment
    // Ground plane (asphalt/parking)
    const extGroundGeo = new THREE.PlaneGeometry(80, 80);
    const extGroundMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, metalness: 0.05 });
    const extGround = new THREE.Mesh(extGroundGeo, extGroundMat);
    extGround.rotation.x = -Math.PI / 2;
    extGround.position.y = -0.02;
    extGround.receiveShadow = true;
    scene.add(extGround);

    // Grass patches around parking
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5a8f3c, roughness: 0.95, metalness: 0 });
    for (const [gx, gz, gw, gd] of [[-25, 0, 12, 60], [25, 0, 12, 60], [0, -25, 60, 12], [0, 25, 60, 12]] as [number, number, number, number][]) {
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), grassMat);
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(gx, -0.015, gz);
      grass.receiveShadow = true;
      scene.add(grass);
    }

    // Parking lines
    const linesMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const bz = buildingResult.exteriorBounds.minZ - 3;
    for (let i = 0; i < 6; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 4.5), linesMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(-6 + i * 2.5, -0.01, bz - 3);
      scene.add(line);
    }

    // Simple trees (cylinder trunk + sphere canopy)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.8 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3d7a2a, roughness: 0.9 });
    for (const [tx, tz] of [[-18, -12], [-18, 0], [-18, 10], [18, -12], [18, 0], [18, 10], [-8, 22], [0, 22], [8, 22]] as [number, number][]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 2.5, 8), trunkMat);
      trunk.position.set(tx, 1.25, tz);
      trunk.castShadow = true;
      scene.add(trunk);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), canopyMat);
      canopy.position.set(tx, 3.2, tz);
      canopy.castShadow = true;
      scene.add(canopy);
    }

    // Fuel pump islands (simple boxes)
    const pumpMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.4, metalness: 0.3 });
    const islandMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const iz = bz - 8 - i * 5;
      // Island base
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 3.5), islandMat);
      island.position.set(0, 0.075, iz);
      island.receiveShadow = true;
      scene.add(island);
      // Pump
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.4), pumpMat);
      pump.position.set(0, 0.9 + 0.15, iz);
      pump.castShadow = true;
      scene.add(pump);
      // Screen on pump
      const scrMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x0a2040, emissiveIntensity: 0.1 });
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.01), scrMat);
      scr.position.set(0, 1.5 + 0.15, iz + 0.21);
      scene.add(scr);
    }

    // Canopy over pumps
    const canopyRoofMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.1 });
    const canopyRoof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.15, 18), canopyRoofMat);
    canopyRoof.position.set(0, 4.5, bz - 13);
    canopyRoof.castShadow = true;
    canopyRoof.receiveShadow = true;
    scene.add(canopyRoof);
    // Canopy pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.3, metalness: 0.2 });
    for (const [px, pz] of [[-3.5, bz - 5], [3.5, bz - 5], [-3.5, bz - 21], [3.5, bz - 21]] as [number, number][]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.5, 8), pillarMat);
      pillar.position.set(px, 2.25, pz);
      pillar.castShadow = true;
      scene.add(pillar);
    }

    // Snap indicator lines group
    const snapGroup = new THREE.Group();
    snapGroup.userData = { type: 'snapLines' };
    scene.add(snapGroup);
    snapLinesRef.current = snapGroup;

    // Place furniture objects from DXF
    if (buildingResult.dxfObjects && buildingResult.dxfObjects.length > 0) {
      for (const dxfObj of buildingResult.dxfObjects) {
        const catalogItem = CATALOG.find(c => c.id === dxfObj.catalogId);
        if (!catalogItem) continue;
        const pos = new THREE.Vector3(dxfObj.x, 0, dxfObj.z);
        const obj = createPlacedObject(catalogItem, pos);
        obj.mesh.rotation.y = (dxfObj.rotation || 0) * (Math.PI / 180);
        scene.add(obj.mesh);
        objectsRef.current.push(obj);
      }
      setObjectCount(objectsRef.current.length);
      setStatusMsg(`Importat ${objectsRef.current.length} obiecte din DXF`);
    }

    // Create door panels as interactive objects
    if (buildingResult.doorPanels && buildingResult.doorPanels.length > 0) {
      const doorPanelMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7, metalness: 0.05 });

      for (const dp of buildingResult.doorPanels) {
        // Pivot at hinge point
        const pivot = new THREE.Group();
        pivot.position.set(dp.hingeX, 0, dp.hingeZ);
        pivot.rotation.y = -dp.startAngle; // closed position
        pivot.userData = {
          type: 'doorPanel',
          startAngle: dp.startAngle,
          endAngle: dp.endAngle,
          hingeX: dp.hingeX,
          hingeZ: dp.hingeZ,
          isOpen: false,
        };

        // Panel mesh (offset from pivot by half width)
        const panelGeo = new THREE.BoxGeometry(dp.width - 0.06, dp.height - 0.08, 0.04);
        const panel = new THREE.Mesh(panelGeo, doorPanelMat);
        panel.position.set(dp.width / 2, dp.height / 2, 0);
        panel.castShadow = true;
        panel.userData = { type: 'doorPanel' };
        pivot.add(panel);

        // Handle
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.04), handleMat);
        handle.position.set(dp.width * 0.7, dp.height * 0.48, 0.04);
        handle.userData = { type: 'doorPanel' };
        pivot.add(handle);

        scene.add(pivot);
        doorPanelsRef.current.push({ panel, pivot, info: dp });
      }
    }

    // Post-processing: SSAO for depth
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ssaoPass = new SSAOPass(scene, camera, canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    ssaoPass.kernelRadius = 8;
    ssaoPass.minDistance = 0.005;
    ssaoPass.maxDistance = 0.1;
    composer.addPass(ssaoPass);
    composer.addPass(new OutputPass());
    composerRef.current = composer;

    // Animation loop (single loop for both orbit + FP mode)
    const animate = () => {
      requestAnimationFrame(animate);
      if (orbit.enabled) {
        orbit.update();
      } else if (fpTickRef.current) {
        fpTickRef.current();
      }
      composer.render();
    };
    animate();

    // Resize
    const handleResize = () => {
      if (!canvasRef.current) return;
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      composer.dispose();
      renderer.dispose();
      if (canvasRef.current && renderer.domElement.parentNode === canvasRef.current) {
        canvasRef.current.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildRoom(scene: THREE.Scene, w: number, d: number) {
    if (roomGroupRef.current) {
      scene.remove(roomGroupRef.current);
      roomGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }

    const group = new THREE.Group();
    group.userData = { type: 'room' };

    const floorGeo = new THREE.PlaneGeometry(w, d);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.8,
      metalness: 0.2,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.receiveShadow = true;
    floor.userData = { type: 'floor' };
    group.add(floor);

    const wallHeight = 3.2;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd4c8b0,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(w, wallHeight), wallMat);
    backWall.position.set(0, wallHeight / 2, -d / 2);
    group.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(d, wallHeight), wallMat.clone());
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-w / 2, wallHeight / 2, 0);
    group.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(d, wallHeight), wallMat.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(w / 2, wallHeight / 2, 0);
    group.add(rightWall);

    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(w, wallHeight), wallMat.clone());
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(0, wallHeight / 2, d / 2);
    group.add(frontWall);

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0f3460, transparent: true, opacity: 0.6 });
    const corners = [
      [-w/2, 0, -d/2], [w/2, 0, -d/2], [w/2, 0, d/2], [-w/2, 0, d/2],
      [-w/2, wallHeight, -d/2], [w/2, wallHeight, -d/2], [w/2, wallHeight, d/2], [-w/2, wallHeight, d/2],
    ];
    const edgeIndices = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7],
    ];
    edgeIndices.forEach(([a, b]) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...corners[a] as [number, number, number]),
        new THREE.Vector3(...corners[b] as [number, number, number]),
      ]);
      group.add(new THREE.Line(geo, edgeMat));
    });

    addDimensionLabel(group, `${w.toFixed(1)}m`, new THREE.Vector3(0, 0.05, d/2 + 0.3));
    addDimensionLabel(group, `${d.toFixed(1)}m`, new THREE.Vector3(w/2 + 0.3, 0.05, 0));

    scene.add(group);
    roomGroupRef.current = group;
  }

  function addDimensionLabel(parent: THREE.Group, text: string, pos: THREE.Vector3) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(15, 52, 96, 0.7)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#4ecca3';
    ctx.font = 'bold 28px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(1.0, 0.25, 1);
    parent.add(sprite);
  }

  const checkAllCollisions = useCallback(() => {
    const cols: string[] = [];
    const objs = objectsRef.current;
    for (let i = 0; i < objs.length; i++) {
      setEmissiveAll(objs[i].mesh, 0x000000, 0);
      for (let j = i + 1; j < objs.length; j++) {
        if (checkCollision(objs[i], objs[j])) {
          cols.push(`${objs[i].name} ↔ ${objs[j].name}`);
          setEmissiveAll(objs[i].mesh, 0xff0000, 0.3);
          setEmissiveAll(objs[j].mesh, 0xff0000, 0.3);
        }
      }
    }
    setCollisions(cols);
  }, []);

  // ========== DRAG & DROP SYSTEM ==========
  // In orbit edit mode: OrbitControls disabled, left-click = select + drag objects
  // In normal mode: OrbitControls enabled, no object interaction
  useEffect(() => {
    if (orbitEditMode && orbitRef.current) orbitRef.current.enabled = false;
    if (!orbitEditMode && orbitRef.current && !fpMode) orbitRef.current.enabled = true;
  }, [orbitEditMode, fpMode]);

  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (fpModeRef.current) return;
      if (!orbitEditRef.current) return; // No interaction in non-edit mode
      mouseDownPosRef.current.set(e.clientX, e.clientY);

      const rect = el.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      // Click on object = select + prepare drag
      const meshes = objectsRef.current.map(o => o.mesh);
      const hits = raycasterRef.current.intersectObjects(meshes, true);
      if (hits.length > 0) {
        let clicked = hits[0].object as THREE.Object3D;
        let obj = objectsRef.current.find(o => o.mesh === clicked);
        while (!obj && clicked.parent) { clicked = clicked.parent; obj = objectsRef.current.find(o => o.mesh === clicked); }
        if (obj) {
          if (selectedRef.current && selectedRef.current !== obj) highlightObject(selectedRef.current, false);
          selectedRef.current = obj;
          setSelectedObj(obj);
          highlightObject(obj, true);
          const floorPoint = getFloorIntersection(e.clientX, e.clientY);
          if (floorPoint) {
            dragOffsetRef.current.set(obj.mesh.position.x - floorPoint.x, 0, obj.mesh.position.z - floorPoint.z);
          }
          saveSnapshot();
          isDraggingRef.current = true;
          el.style.cursor = 'grabbing';
          setStatusMsg(`Drag: ${obj.name} | R=rotire`);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (fpModeRef.current) return;
      if (!orbitEditRef.current) return;

      if (!isDraggingRef.current || !selectedRef.current) {
        el.style.cursor = 'crosshair';
        return;
      }

      const floorPoint = getFloorIntersection(e.clientX, e.clientY);
      if (floorPoint && selectedRef.current) {
        const obj = selectedRef.current;
        const rawX = floorPoint.x + dragOffsetRef.current.x;
        const rawZ = floorPoint.z + dragOffsetRef.current.z;

        const bounds = buildingBoundsRef.current;
        let bx = rawX, bz = rawZ;
        if (bounds) {
          const hw = obj.dimensions.width / 2, hd = obj.dimensions.depth / 2;
          bx = Math.max(bounds.minX + hw, Math.min(bounds.maxX - hw, bx));
          bz = Math.max(bounds.minZ + hd, Math.min(bounds.maxZ - hd, bz));
        }

        const [nx, nz] = snapWithIndicators(obj, bx, bz);
        obj.mesh.position.x = nx;
        obj.mesh.position.z = nz;
        obj.mesh.position.y = 0;
        checkAllCollisions();
        setSelectedObj({ ...obj });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (fpModeRef.current) return;
      if (!orbitEditRef.current) return;

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        clearSnapLines();
        el.style.cursor = 'crosshair';
        if (selectedRef.current) {
          setStatusMsg(`Plasat: ${selectedRef.current.name}`);
        }
        checkAllCollisions();
        return;
      }

      // Simple click (no drag)
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        if (measureMode) { handleMeasureClick(e.clientX, e.clientY); return; }

        const rect = el.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

        // Door toggle
        const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
        const doorHits = raycasterRef.current.intersectObjects(doorMeshes, true);
        if (doorHits.length > 0) {
          let clickedDoor = doorHits[0].object as THREE.Object3D;
          let doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor || d.panel === clickedDoor);
          while (!doorEntry && clickedDoor.parent) { clickedDoor = clickedDoor.parent; doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor); }
          if (doorEntry) {
            const ud = doorEntry.pivot.userData;
            ud.isOpen = !ud.isOpen;
            doorEntry.pivot.rotation.y = ud.isOpen ? -ud.endAngle : -ud.startAngle;
            setStatusMsg(ud.isOpen ? 'Usa deschisa' : 'Usa inchisa');
            return;
          }
        }

        // Deselect on empty click (selection happens in mouseDown when edit mode)
        if (!isDraggingRef.current) {
          // Clicked on empty space - deselect
          if (selectedRef.current) highlightObject(selectedRef.current, false);
          selectedRef.current = null;
          setSelectedObj(null);
          setStatusMsg('Gata de lucru');
          objectsRef.current.forEach(o => setEmissiveAll(o.mesh, 0x000000, 0));
          checkAllCollisions();
        }
      }
    };

    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mouseup', handleMouseUp);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseup', handleMouseUp);
    };
  }, [checkAllCollisions, getFloorIntersection]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (fpModeRef.current) return; // FP mode handles its own keys
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Delete' && selectedRef.current) {
        deleteSelected();
      }
      if ((e.key === 'r' || e.key === 'R') && selectedRef.current) {
        const step = e.shiftKey ? Math.PI / 12 : Math.PI / 8; // Shift=15°, normal=22.5°
        let angle = selectedRef.current.mesh.rotation.y + step;
        const snapT = 8 * Math.PI / 180;
        for (const c of [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI, 3 * Math.PI / 2, 2 * Math.PI]) {
          if (Math.abs(angle - c) < snapT) { angle = c; break; }
        }
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        saveSnapshot();
        selectedRef.current.mesh.rotation.y = angle;
        setStatusMsg(`Rotit: ${selectedRef.current.name} ${Math.round(angle * 180 / Math.PI)}°`);
        setSelectedObj({ ...selectedRef.current });
        checkAllCollisions();
      }
      if (e.key === 'Escape') {
        if (selectedRef.current) {
          highlightObject(selectedRef.current, false);
        }
        selectedRef.current = null;
        setSelectedObj(null);
      }
      if ((e.key === 'd' || e.key === 'D') && selectedRef.current) {
        duplicateSelected();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addObject = (item: CatalogItem) => {
    if (!sceneRef.current) return;
    let pos: THREE.Vector3;
    if (fpMode && cameraRef.current) {
      // Spawn 2m in front of camera
      const cam = cameraRef.current;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      dir.y = 0; dir.normalize();
      pos = new THREE.Vector3(cam.position.x + dir.x * 2, 0, cam.position.z + dir.z * 2);
    } else {
      const bounds = buildingBoundsRef.current;
      const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
      const centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;
      const offset = (Math.random() - 0.5) * 2;
      pos = new THREE.Vector3(centerX + offset, 0, centerZ + offset);
    }
    const obj = createPlacedObject(item, pos);
    sceneRef.current.add(obj.mesh);
    objectsRef.current.push(obj);
    setObjectCount(objectsRef.current.length);
    setStatusMsg(`Adăugat: ${item.name} — Trage-l unde vrei!`);

    if (selectedRef.current) highlightObject(selectedRef.current, false);
    selectedRef.current = obj;
    setSelectedObj(obj);
    highlightObject(obj, true);
    checkAllCollisions();
  };

  const deleteSelected = () => {
    if (!selectedRef.current || !sceneRef.current) return;
    const obj = selectedRef.current;
    sceneRef.current.remove(obj.mesh);
    // geometry disposed in traverse below
    obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
    objectsRef.current = objectsRef.current.filter(o => o.id !== obj.id);
    selectedRef.current = null;
    setSelectedObj(null);
    setObjectCount(objectsRef.current.length);
    setStatusMsg('Obiect sters');
    checkAllCollisions();
  };

  const duplicateSelected = () => {
    if (!selectedRef.current) return;
    const item = CATALOG.find(c => c.id === selectedRef.current!.catalogId);
    if (!item) return;
    const pos = selectedRef.current.mesh.position.clone();
    pos.x += item.width + 0.3;
    const obj = createPlacedObject(item, pos);
    obj.mesh.rotation.y = selectedRef.current.mesh.rotation.y;
    sceneRef.current?.add(obj.mesh);
    objectsRef.current.push(obj);
    setObjectCount(objectsRef.current.length);

    highlightObject(selectedRef.current, false);
    selectedRef.current = obj;
    setSelectedObj(obj);
    highlightObject(obj, true);
    setStatusMsg(`Duplicat: ${item.name}`);
    checkAllCollisions();
  };

  const clearAllObjects = () => {
    if (objectsRef.current.length === 0) return;
    saveSnapshot();
    objectsRef.current.forEach(obj => {
      sceneRef.current?.remove(obj.mesh);
      obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
    });
    objectsRef.current = [];
    selectedRef.current = null;
    setSelectedObj(null);
    setObjectCount(0);
    setCollisions([]);
    setStatusMsg('Toate obiectele sterse');
  };

  const rotateSelected = (deg: number) => {
    if (!selectedRef.current) return;
    saveSnapshot();
    selectedRef.current.mesh.rotation.y += deg * (Math.PI / 180);
    setStatusMsg(`Rotit: ${selectedRef.current.name} (${(selectedRef.current.mesh.rotation.y * 180 / Math.PI).toFixed(0)}°)`);
    setSelectedObj({ ...selectedRef.current });
    checkAllCollisions();
  };

  const handleExport = () => {
    const data = exportLayout(objectsRef.current, roomWidth, roomDepth);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-layout-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Layout exportat!');
  };

  const saveLayoutToStorage = () => {
    const data = exportLayout(objectsRef.current, roomWidth, roomDepth);
    localStorage.setItem('station-planner-layout', JSON.stringify(data));
    setStatusMsg(`Layout salvat local (${objectsRef.current.length} obiecte)`);
  };

  const loadLayoutFromStorage = () => {
    const raw = localStorage.getItem('station-planner-layout');
    if (!raw) { setStatusMsg('Niciun layout salvat local'); return; }
    try {
      const data = JSON.parse(raw);
      objectsRef.current.forEach(obj => {
        sceneRef.current?.remove(obj.mesh);
        obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
      });
      objectsRef.current = [];
      selectedRef.current = null;
      setSelectedObj(null);
      data.objects?.forEach((objData: { catalogId: string; position: { x: number; z: number }; rotation: number }) => {
        const item = CATALOG.find(c => c.id === objData.catalogId);
        if (item) {
          const pos = new THREE.Vector3(objData.position.x, 0, objData.position.z);
          const obj = createPlacedObject(item, pos);
          obj.mesh.rotation.y = (objData.rotation || 0) * (Math.PI / 180);
          sceneRef.current?.add(obj.mesh);
          objectsRef.current.push(obj);
        }
      });
      setObjectCount(objectsRef.current.length);
      setStatusMsg(`Layout incarcat: ${objectsRef.current.length} obiecte`);
      checkAllCollisions();
    } catch { setStatusMsg('Eroare la incarcarea layout-ului local'); }
  };

  const handleImportLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        objectsRef.current.forEach(obj => {
          sceneRef.current?.remove(obj.mesh);
          // geometry disposed in traverse below
          obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
        });
        objectsRef.current = [];
        selectedRef.current = null;
        setSelectedObj(null);

        if (data.roomDimensions) {
          setRoomWidth(data.roomDimensions.width);
          setRoomDepth(data.roomDimensions.depth);
          buildRoom(sceneRef.current!, data.roomDimensions.width, data.roomDimensions.depth);
        }

        data.objects?.forEach((objData: { catalogId: string; position: { x: number; z: number }; rotation: number }) => {
          const item = CATALOG.find(c => c.id === objData.catalogId);
          if (item) {
            const pos = new THREE.Vector3(objData.position.x, 0, objData.position.z);
            const obj = createPlacedObject(item, pos);
            obj.mesh.rotation.y = (objData.rotation || 0) * (Math.PI / 180);
            sceneRef.current?.add(obj.mesh);
            objectsRef.current.push(obj);
          }
        });
        setObjectCount(objectsRef.current.length);
        setStatusMsg(`Layout importat: ${objectsRef.current.length} obiecte`);
        checkAllCollisions();
      } catch (err) {
        setStatusMsg('Eroare la import layout!');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLoadPointCloud = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sceneRef.current) return;
    setStatusMsg('Se incarca point cloud...');

    const loader = new PLYLoader();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const geometry = loader.parse(buffer);
      geometry.computeVertexNormals();

      const hasColors = geometry.hasAttribute('color');
      const material = new THREE.PointsMaterial({
        size: 0.03,
        vertexColors: hasColors,
        color: hasColors ? undefined : 0x88aacc,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      });

      const points = new THREE.Points(geometry, material);
      points.userData = { type: 'pointcloud' };
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const center = new THREE.Vector3();
      box.getCenter(center);
      points.position.sub(center);
      points.position.y -= box.min.y - center.y;

      sceneRef.current?.add(points);
      setPointCloudLoaded(true);

      const size = new THREE.Vector3();
      box.getSize(size);
      const newW = Math.ceil(size.x + 1);
      const newD = Math.ceil(size.z + 1);
      setRoomWidth(newW);
      setRoomDepth(newD);
      buildRoom(sceneRef.current!, newW, newD);

      setStatusMsg(`Point cloud: ${(geometry.attributes.position.count / 1000).toFixed(0)}K puncte`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const updateRoom = () => {
    if (sceneRef.current) {
      buildRoom(sceneRef.current, roomWidth, roomDepth);
    }
  };

  const handlePrintLayout = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    // Capture top-down view
    const cam = cameraRef.current;
    const savedPos = cam.position.clone();
    const savedTarget = orbitRef.current?.target.clone();
    cam.position.set(0, 15, 0.01);
    orbitRef.current?.target.set(0, 0, 0);
    orbitRef.current?.update();
    rendererRef.current.render(sceneRef.current, cam);
    const imgData = rendererRef.current.domElement.toDataURL('image/png');
    // Restore camera
    cam.position.copy(savedPos);
    if (savedTarget && orbitRef.current) { orbitRef.current.target.copy(savedTarget); orbitRef.current.update(); }
    // Print window with layout image + object list
    const objList = objectsRef.current.map(o => `<li>${o.name} (${(o.dimensions.width*100).toFixed(0)}x${(o.dimensions.depth*100).toFixed(0)}cm) pos: ${o.mesh.position.x.toFixed(1)},${o.mesh.position.z.toFixed(1)}</li>`).join('');
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><head><title>Station Layout</title><style>body{font-family:sans-serif;padding:20px}img{max-width:100%;border:1px solid #ccc}ul{columns:2;font-size:12px}</style></head><body><h2>Station Planner Layout</h2><p>${objectsRef.current.length} obiecte | ${roomWidth}x${roomDepth}m | ${new Date().toLocaleDateString()}</p><img src="${imgData}"/><h3>Lista obiectelor</h3><ul>${objList}</ul></body></html>`);
      win.document.close();
      win.print();
    }
    setStatusMsg('Layout trimis la imprimanta');
  };

  const handleScreenshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `station-screenshot-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setStatusMsg('Screenshot salvat!');
  };

  const resetCamera = () => {
    if (cameraRef.current && orbitRef.current) {
      cameraRef.current.position.set(10, 8, 10);
      orbitRef.current.target.set(0, 0, 0);
      orbitRef.current.update();
    }
  };

  // Area calculation — compute room area in square meters
  const areaCalcSqm = (): number => {
    return roomWidth * roomDepth;
  };

  // Floor texture support
  const applyFloorTexture = (floorMesh: THREE.Mesh, texturePath: string) => {
    const loader = new THREE.TextureLoader();
    const floorTexture = loader.load(texturePath, (map) => {
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(roomWidth, roomDepth);
    });
    if (floorMesh.material instanceof THREE.MeshStandardMaterial) {
      floorMesh.material.map = floorTexture;
      floorMesh.material.needsUpdate = true;
    }
  };

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(prev => !prev);
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(darkMode ? 0xeaecf0 : 0x1a1a2e);
    }
  };

  // Multi-select toggle
  const toggleMultiSelect = (obj: PlacedObject) => {
    const idx = selectedObjects.current.findIndex(o => o.id === obj.id);
    if (idx >= 0) {
      selectedObjects.current.splice(idx, 1);
      highlightObject(obj, false);
    } else {
      selectedObjects.current.push(obj);
      highlightObject(obj, true);
    }
  };

  // Object properties panel data
  const getObjectProperties = (obj: PlacedObject) => {
    const item = CATALOG.find(c => c.id === obj.catalogId);
    return {
      infoPanel: true,
      name: obj.name,
      catalogId: obj.catalogId,
      width: obj.dimensions.width,
      depth: obj.dimensions.depth,
      height: obj.dimensions.height,
      x: obj.mesh.position.x,
      z: obj.mesh.position.z,
      rotation: obj.mesh.rotation.y * (180 / Math.PI),
      description: item?.description ?? '',
      clearance: obj.clearance,
    };
  };

  const topView = () => {
    if (cameraRef.current && orbitRef.current) {
      cameraRef.current.position.set(0, 15, 0.01);
      orbitRef.current.target.set(0, 0, 0);
      orbitRef.current.update();
    }
  };

  const enterFpMode = () => {
    if (!cameraRef.current || !orbitRef.current) return;
    setFpMode(true);
    setOrbitEditMode(false);
    orbitRef.current.saveState();
    orbitRef.current.enabled = false;
    const cam = cameraRef.current;
    // Start at entrance (sliding door gap between front windows, Z≈-6.5)
    const bounds = buildingBoundsRef.current;
    const entranceX = bounds ? (bounds.minX + bounds.maxX) / 2 - 1 : -3;
    const entranceZ = bounds ? bounds.minZ + 0.5 : -6.2;
    cam.position.set(entranceX, 1.7, entranceZ);
    // Look toward interior (+Z direction)
    fpYawRef.current = Math.PI;
    fpPitchRef.current = 0;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(0, fpYawRef.current, 0, 'YXZ');
    setStatusMsg('Walkthrough: WASD mers | Click+drag rotire | ESC iesire');
  };

  const exitFpMode = () => {
    setFpMode(false);
    setFpEditMode(false);
    setFpAction(null);
    fpDraggingRef.current = null;
    setFpDragging(null);
    fpKeysRef.current.clear();
    if (orbitRef.current && cameraRef.current) {
      orbitRef.current.enabled = true;
      cameraRef.current.rotation.order = 'XYZ';
      resetCamera();
    }
  };

  // First-person controls — no pointer lock, drag to look, WASD to move
  useEffect(() => {
    if (!fpMode) return;
    const el = rendererRef.current?.domElement;
    if (!el) return;

    let mouseDown = false;
    let lastMX = 0, lastMY = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (fpDraggingRef.current) {
          undo();
          fpDraggingRef.current.mesh.position.y = 0;
          fpDraggingRef.current = null;
          setFpDragging(null);
          setStatusMsg('Mutare anulata');
          return;
        }
        if (fpAction) { setFpAction(null); return; }
        exitFpMode();
        return;
      }
      // R to rotate while dragging — free rotate with snap at 0/90/180/270
      if ((e.key === 'r' || e.key === 'R') && fpDraggingRef.current) {
        const step = e.shiftKey ? Math.PI / 12 : Math.PI / 8; // Shift=15°, normal=22.5°
        let angle = fpDraggingRef.current.mesh.rotation.y + step;
        // Snap to 0/90/180/270 if within 8°
        const snapThreshold = 8 * Math.PI / 180;
        const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI, 3 * Math.PI / 2, 2 * Math.PI];
        for (const c of cardinals) {
          if (Math.abs(angle - c) < snapThreshold) { angle = c; break; }
        }
        // Normalize to [-PI, PI]
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        fpDraggingRef.current.mesh.rotation.y = angle;
        setStatusMsg(`Rotit: ${Math.round(angle * 180 / Math.PI)}°`);
        return;
      }
      if (fpEditMode && (e.key === 'r' || e.key === 'R') && selectedRef.current) {
        rotateSelected(45); return;
      }
      if (fpEditMode && e.key === 'Delete' && selectedRef.current) {
        deleteSelected(); return;
      }
      fpKeysRef.current.add(e.key.toLowerCase());
      if (['w','a','s','d',' ','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { fpKeysRef.current.delete(e.key.toLowerCase()); };

    // Right-click drag = look, Left-click = interact/drag objects
    let leftDown = false;
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== el) return;
      if (e.button === 2) {
        mouseDown = true;
        lastMX = e.clientX; lastMY = e.clientY;
        el.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0 && fpEditRef.current && cameraRef.current) {
        // Try to pick up an object
        const rect = el.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycasterRef.current.setFromCamera(mouse, cameraRef.current);
        const meshes = objectsRef.current.map(o => o.mesh);
        const hits = raycasterRef.current.intersectObjects(meshes, true);
        if (hits.length > 0) {
          let clicked = hits[0].object as THREE.Object3D;
          let found = objectsRef.current.find(o => o.mesh === clicked);
          while (!found && clicked.parent) { clicked = clicked.parent; found = objectsRef.current.find(o => o.mesh === clicked); }
          if (found) {
            saveSnapshot();
            fpDraggingRef.current = found;
            setFpDragging(found.name);
            if (selectedRef.current) highlightObject(selectedRef.current, false);
            selectedRef.current = found;
            setSelectedObj(found);
            highlightObject(found, true);
            found.mesh.position.y = 0.15; // lift slightly
            el.style.cursor = 'grabbing';
            leftDown = true;
            return;
          }
        }
        leftDown = true;
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      // Right-click look
      if (mouseDown) {
        const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
        lastMX = e.clientX; lastMY = e.clientY;
        fpYawRef.current -= dx * 0.003;
        fpPitchRef.current -= dy * 0.003;
        fpPitchRef.current = Math.max(-1.2, Math.min(1.2, fpPitchRef.current));
        return;
      }
      // Left-drag: move picked object on floor plane with snap indicators
      if (leftDown && fpDraggingRef.current && cameraRef.current) {
        const rect = el.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycasterRef.current.setFromCamera(mouse, cameraRef.current);
        const target = new THREE.Vector3();
        if (raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, target)) {
          const [sx, sz] = snapWithIndicators(fpDraggingRef.current, target.x, target.z);
          fpDraggingRef.current.mesh.position.x = sx;
          fpDraggingRef.current.mesh.position.z = sz;
          fpDraggingRef.current.mesh.position.y = 0.15;
        }
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) { mouseDown = false; el.style.cursor = 'crosshair'; return; }
      if (e.button !== 0) return;

      // Drop dragged object
      if (fpDraggingRef.current) {
        fpDraggingRef.current.mesh.position.y = 0;
        clearSnapLines();
        setStatusMsg(`Plasat: ${fpDraggingRef.current.name}`);
        fpDraggingRef.current = null;
        setFpDragging(null);
        el.style.cursor = 'crosshair';
        leftDown = false;
        return;
      }
      leftDown = false;

      if (e.target !== el) return;
      if (!cameraRef.current) return;
      const rect = el.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(mouse, cameraRef.current);

      // Doors toggle
      const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
      const doorHits = raycasterRef.current.intersectObjects(doorMeshes, true);
      if (doorHits.length > 0) {
        let obj = doorHits[0].object as THREE.Object3D;
        let entry = doorPanelsRef.current.find(d => d.pivot === obj || d.panel === obj);
        while (!entry && obj.parent) { obj = obj.parent; entry = doorPanelsRef.current.find(d => d.pivot === obj); }
        if (entry) {
          const ud = entry.pivot.userData;
          ud.isOpen = !ud.isOpen;
          entry.pivot.rotation.y = ud.isOpen ? -ud.endAngle : -ud.startAngle;
          setStatusMsg(ud.isOpen ? 'Usa deschisa' : 'Usa inchisa');
          return;
        }
      }

      // Edit mode: right-click on object → popup
      if (fpEditRef.current) {
        const meshes = objectsRef.current.map(o => o.mesh);
        const objHits = raycasterRef.current.intersectObjects(meshes, true);
        if (objHits.length > 0) {
          let clicked = objHits[0].object as THREE.Object3D;
          let found = objectsRef.current.find(o => o.mesh === clicked);
          while (!found && clicked.parent) { clicked = clicked.parent; found = objectsRef.current.find(o => o.mesh === clicked); }
          if (found) {
            if (selectedRef.current) highlightObject(selectedRef.current, false);
            selectedRef.current = found;
            setSelectedObj(found);
            highlightObject(found, true);
            setFpAction({ obj: found, x: e.clientX, y: e.clientY });
          }
        } else {
          if (selectedRef.current) highlightObject(selectedRef.current, false);
          selectedRef.current = null; setSelectedObj(null); setFpAction(null);
        }
      }
    };
    const onContextMenu = (e: Event) => { e.preventDefault(); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('contextmenu', onContextMenu);
    el.style.cursor = 'crosshair';

    // Wall collision check — returns true if position is too close to any wall
    const PLAYER_RADIUS = 0.25;
    const checkWallCollision = (x: number, z: number): boolean => {
      for (const w of wallSegmentsRef.current) {
        const wx = w.x2 - w.x1, wz = w.z2 - w.z1;
        const len2 = wx * wx + wz * wz;
        if (len2 < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((x - w.x1) * wx + (z - w.z1) * wz) / len2));
        const cx = w.x1 + t * wx, cz = w.z1 + t * wz;
        const dist = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (dist < PLAYER_RADIUS + w.thickness / 2) return true;
      }
      return false;
    };

    // FP tick called from main animation loop (no separate rAF)
    fpTickRef.current = () => {
      const cam = cameraRef.current;
      if (!cam) return;

      cam.rotation.set(fpPitchRef.current, fpYawRef.current, 0, 'YXZ');

      const speed = fpKeysRef.current.has('shift') ? 0.16 : 0.08;
      const keys = fpKeysRef.current;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      right.y = 0; right.normalize();

      // Calculate desired position
      let nx = cam.position.x, nz = cam.position.z;
      if (keys.has('w') || keys.has('arrowup')) { nx += forward.x * speed; nz += forward.z * speed; }
      if (keys.has('s') || keys.has('arrowdown')) { nx -= forward.x * speed; nz -= forward.z * speed; }
      if (keys.has('a') || keys.has('arrowleft')) { nx -= right.x * speed; nz -= right.z * speed; }
      if (keys.has('d') || keys.has('arrowright')) { nx += right.x * speed; nz += right.z * speed; }

      // Slide along walls: try full move, then each axis separately
      if (!checkWallCollision(nx, nz)) {
        cam.position.x = nx;
        cam.position.z = nz;
      } else if (!checkWallCollision(nx, cam.position.z)) {
        cam.position.x = nx;
      } else if (!checkWallCollision(cam.position.x, nz)) {
        cam.position.z = nz;
      }
      cam.position.y = 1.7;
    };

    return () => {
      fpTickRef.current = null;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('contextmenu', onContextMenu);
      el.style.cursor = 'default';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fpMode]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: '#f5f5f7' }}>
      {/* Left Panel - Catalog */}
      <div
        className={`${showCatalog ? 'w-72' : 'w-0'} transition-all duration-300 flex-shrink-0 overflow-hidden`}
        style={showCatalog ? { background: '#fff', borderRight: '1px solid #e5e5ea', boxShadow: '2px 0 8px rgba(0,0,0,0.04)' } : {}}
      >
        <div className="w-72 h-full flex flex-col">
          {/* Header */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #e5e5ea' }}>
            <h1 className="text-sm font-semibold" style={{ color: '#1d1d1f' }}>Station Planner</h1>
            <p className="text-[11px] mt-0.5" style={{ color: '#86868b' }}>Planificare spatiu statie</p>
          </div>

          {/* Point Cloud + Dims */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #e5e5ea' }}>
            <label className="flex items-center justify-center gap-1.5 w-full text-xs py-2 rounded-lg cursor-pointer transition-all hover:opacity-90" style={{ background: pointCloudLoaded ? '#30d158' : '#0071e3', color: '#fff' }}>
              {pointCloudLoaded ? 'Point Cloud OK' : 'Incarca Point Cloud'}
              <input type="file" accept=".ply" onChange={handleLoadPointCloud} className="hidden" />
            </label>
          </div>

          {/* Search */}
          <div className="px-3 py-2" style={{ borderBottom: '1px solid #e5e5ea' }}>
            <input
              type="text"
              placeholder="Cauta echipament..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg outline-none"
              style={{ background: '#f5f5f7', border: '1px solid #e5e5ea', color: '#1d1d1f' }}
            />
          </div>

          {/* Categories */}
          <div className="flex flex-wrap gap-1 px-3 py-2.5" style={{ borderBottom: '1px solid #e5e5ea' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className="text-[11px] px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: activeCategory === cat.id ? '#0071e3' : '#f5f5f7',
                  color: activeCategory === cat.id ? '#fff' : '#1d1d1f',
                  fontWeight: activeCategory === cat.id ? 600 : 400,
                }}
              >
                {cat.icon} {cat.name} ({getCatalogByCategory(cat.id).length})
              </button>
            ))}
          </div>

          {/* Catalog items */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {(searchQuery.trim() ? CATALOG.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.description.toLowerCase().includes(searchQuery.toLowerCase())) : getCatalogByCategory(activeCategory)).map(item => (
              <button
                key={item.id}
                onClick={() => addObject(item)}
                title={item.description}
                className="w-full text-left px-3 py-2.5 mb-1 rounded-xl transition-all hover:shadow-sm active:scale-[0.98]"
                style={{ background: '#f5f5f7', border: '1px solid transparent' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = '#eef0f2'; (e.target as HTMLElement).style.borderColor = '#d1d1d6'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = '#f5f5f7'; (e.target as HTMLElement).style.borderColor = 'transparent'; }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: '#1d1d1f' }}>{item.name}</div>
                    <div className="text-[10px]" style={{ color: '#86868b' }}>
                      {(item.width * 100).toFixed(0)} x {(item.depth * 100).toFixed(0)} x {(item.height * 100).toFixed(0)} cm
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="px-3 py-2 flex gap-2" style={{ borderTop: '1px solid #e5e5ea' }}>
            <button onClick={handleExport} className="flex-1 text-[11px] py-2 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#0071e3', color: '#fff' }}>Export</button>
            <button onClick={handleScreenshot} className="flex-1 text-[11px] py-2 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>Screenshot</button>
            <label className="flex-1 text-[11px] py-2 rounded-lg font-medium text-center cursor-pointer transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>
              Import
              <input type="file" accept=".json" onChange={handleImportLayout} className="hidden" />
            </label>
          </div>
          <div className="px-3 pb-3 flex gap-2">
            <button onClick={saveLayoutToStorage} className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#30d158', color: '#fff' }}>Salveaza</button>
            <button onClick={loadLayoutFromStorage} className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>Incarca</button>
            <button onClick={handlePrintLayout} className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>Print</button>
          </div>
        </div>
      </div>

      {/* Main 3D Viewport */}
      <div className="flex-1 relative">
        <div ref={canvasRef} className="w-full h-full" />

        {/* Crosshair in walk mode */}
        {fpMode && (
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 50 }}>
            <svg width="24" height="24" viewBox="0 0 24 24">
              <line x1="12" y1="4" x2="12" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <line x1="12" y1="14" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <line x1="4" y1="12" x2="10" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <line x1="14" y1="12" x2="20" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <circle cx="12" cy="12" r="1.5" fill="white" opacity="0.5" />
            </svg>
          </div>
        )}

        {!fpMode && (
          <button
            onClick={() => setShowCatalog(!showCatalog)}
            className="absolute top-3 left-3 w-8 h-8 rounded-lg flex items-center justify-center text-sm z-10 hover:opacity-80 transition-all"
            style={{ background: '#fff', boxShadow: 'var(--shadow)', color: '#1d1d1f' }}
          >
            {showCatalog ? '\u25C0' : '\u25B6'}
          </button>
        )}

        {/* ORBIT MODE toolbar */}
        {!fpMode && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl z-10"
            style={{ background: '#fff', boxShadow: 'var(--shadow-lg)' }}
          >
            <button onClick={() => rotateSelected(-45)} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors" style={{ color: '#1d1d1f' }}>-45°</button>
            <button onClick={() => rotateSelected(45)} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors" style={{ color: '#1d1d1f' }}>+45°</button>
            <button onClick={() => rotateSelected(90)} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors" style={{ color: '#1d1d1f' }}>90°</button>
            <div className="w-px h-4 mx-0.5" style={{ background: '#e5e5ea' }} />
            <button onClick={duplicateSelected} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors" style={{ color: '#1d1d1f' }}>Duplica</button>
            <button onClick={deleteSelected} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors" style={{ color: '#ff3b30' }}>Sterge</button>
            <button onClick={clearAllObjects} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors" style={{ color: '#ff3b30' }} title="Sterge toate obiectele">X Tot</button>
            <div className="w-px h-4 mx-0.5" style={{ background: '#e5e5ea' }} />
            <button onClick={resetCamera} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors font-medium" style={{ color: '#1d1d1f' }}>3D</button>
            <button onClick={topView} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors font-medium" style={{ color: '#1d1d1f' }}>2D</button>
            <button onClick={() => { setShowCeiling(!showCeiling); if (ceilingRef.current) ceilingRef.current.visible = !showCeiling; }} className="text-[11px] px-2.5 py-1.5 rounded-lg transition-colors" style={{ background: showCeiling ? '#0071e3' : 'transparent', color: showCeiling ? '#fff' : '#1d1d1f' }}>Tavan</button>
            <button onClick={() => setOrbitEditMode(!orbitEditMode)} className="text-[11px] px-3 py-1.5 rounded-lg font-semibold transition-all hover:opacity-90" style={{ background: orbitEditMode ? '#f59e0b' : 'transparent', color: orbitEditMode ? '#fff' : '#1d1d1f' }}>{orbitEditMode ? 'Edit ON' : 'Edit'}</button>
            <button onClick={enterFpMode} className="text-[11px] px-3 py-1.5 rounded-lg font-semibold transition-all hover:opacity-90" style={{ background: '#0071e3', color: '#fff' }}>Walk</button>
            <button onClick={() => { if (measureMode) clearMeasure(); setMeasureMode(!measureMode); }} className="text-[11px] px-2.5 py-1.5 rounded-lg transition-colors" style={{ background: measureMode ? '#ff3b30' : 'transparent', color: measureMode ? '#fff' : '#1d1d1f' }}>Masura</button>
          </div>
        )}

        {/* WALK MODE HUD */}
        {fpMode && (
          <>
            {/* Top bar — compact */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full z-10" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
              <button onClick={exitFpMode} className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: '#ef4444', color: '#fff' }}>ESC Iesire</button>
              <button
                onClick={() => { setFpEditMode(!fpEditMode); setShowCatalog(!fpEditMode); setFpAction(null); }}
                className="text-xs px-3 py-1 rounded-full font-semibold"
                style={{ background: fpEditMode ? '#f59e0b' : '#3b82f6', color: '#fff' }}
              >
                {fpEditMode ? 'Editare ON' : 'Editare'}
              </button>
              <button onClick={() => { setShowCeiling(!showCeiling); if (ceilingRef.current) ceilingRef.current.visible = !showCeiling; }} className="text-xs px-3 py-1 rounded-full" style={{ background: showCeiling ? '#6b7280' : 'rgba(255,255,255,0.15)', color: '#fff' }}>Tavan</button>
            </div>

            {/* Bottom HUD */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center z-10 pointer-events-none">
              {fpDragging ? (
                <div className="px-5 py-2.5 rounded-xl text-xs font-medium" style={{ background: 'rgba(0,113,227,0.85)', backdropFilter: 'blur(6px)', color: '#fff' }}>
                  Muti: {fpDragging} — trage cu mouse-ul, elibereaza = plaseaza
                </div>
              ) : (
                <div className="px-4 py-2 rounded-lg text-xs" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', color: 'rgba(255,255,255,0.7)' }}>
                  <span className="font-mono">WASD</span> mers &nbsp; <span className="font-mono">Shift</span> sprint &nbsp; <span className="font-mono">RMB+drag</span> rotire &nbsp; <span className="font-mono">LMB</span> usi{fpEditMode && ' / drag obiecte'}
                </div>
              )}
            </div>

            {/* FP Edit — action popup at click position */}
            {fpAction && (
              <div
                className="absolute z-30 p-0.5 rounded-2xl"
                onMouseDown={e => e.stopPropagation()}
                onMouseUp={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                style={{
                  left: Math.min(fpAction.x, window.innerWidth - 200),
                  top: Math.min(fpAction.y, window.innerHeight - 220),
                  background: 'rgba(30,30,30,0.9)',
                  backdropFilter: 'blur(20px)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                  minWidth: 180,
                }}
              >
                <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <p className="text-xs font-semibold text-white">{fpAction.obj.name}</p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {(fpAction.obj.dimensions.width * 100).toFixed(0)} x {(fpAction.obj.dimensions.depth * 100).toFixed(0)} cm
                  </p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => {
                      if (!fpAction) return;
                      fpAction.obj.mesh.rotation.y += Math.PI / 2;
                      setStatusMsg(`Rotit: ${fpAction.obj.name} 90°`);
                      setFpAction(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span style={{ fontSize: 14 }}>&#8635;</span> Roteste 90°
                  </button>
                  <button
                    onClick={() => {
                      if (!fpAction) return;
                      fpAction.obj.mesh.rotation.y += Math.PI / 4;
                      setStatusMsg(`Rotit: ${fpAction.obj.name} 45°`);
                      setFpAction(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span style={{ fontSize: 14 }}>&#8635;</span> Roteste 45°
                  </button>
                  <button
                    onClick={() => {
                      if (!fpAction || !sceneRef.current) return;
                      const obj = fpAction.obj;
                      sceneRef.current.remove(obj.mesh);
                      obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
                      objectsRef.current = objectsRef.current.filter(o => o.id !== obj.id);
                      selectedRef.current = null;
                      setSelectedObj(null);
                      setObjectCount(objectsRef.current.length);
                      setFpAction(null);
                      setStatusMsg(`Sters: ${obj.name}`);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
                    style={{ color: '#ff453a' }}
                  >
                    <span style={{ fontSize: 14 }}>&#10005;</span> Sterge
                  </button>
                </div>
                <div className="py-1" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <button
                    onClick={() => { setFpAction(null); if (selectedRef.current) highlightObject(selectedRef.current, false); selectedRef.current = null; setSelectedObj(null); }}
                    className="w-full text-left px-3 py-2 text-xs text-white/50 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    Inchide
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Selected object info (orbit mode only) */}
        {!fpMode && selectedObj && (
          <div className="absolute top-14 right-3 w-52 p-3 rounded-xl z-10" style={{ background: '#fff', boxShadow: 'var(--shadow-lg)' }}>
            <h3 className="text-xs font-semibold mb-1.5" style={{ color: '#0071e3' }}>{selectedObj.name}</h3>
            <div className="space-y-0.5 text-[10px]" style={{ color: '#86868b' }}>
              <p>{(selectedObj.dimensions.width * 100).toFixed(0)} x {(selectedObj.dimensions.depth * 100).toFixed(0)} x {(selectedObj.dimensions.height * 100).toFixed(0)} cm</p>
              <p>Pozitie: ({selectedObj.mesh.position.x.toFixed(2)}, {selectedObj.mesh.position.z.toFixed(2)}) m</p>
              <p>Rotatie: {(selectedObj.mesh.rotation.y * 180 / Math.PI).toFixed(0)}°</p>
            </div>
          </div>
        )}

        {/* Collision warnings */}
        {!fpMode && collisions.length > 0 && (
          <div className="absolute bottom-12 right-3 w-52 p-2.5 rounded-xl z-10" style={{ background: '#fff0f0', boxShadow: 'var(--shadow)', border: '1px solid #fecaca' }}>
            <h3 className="text-[11px] font-semibold mb-1" style={{ color: '#ff3b30' }}>Coliziuni ({collisions.length})</h3>
            {collisions.slice(0, 4).map((c, i) => (<p key={i} className="text-[10px]" style={{ color: '#86868b' }}>{c}</p>))}
          </div>
        )}

        {/* Object Info/Properties Panel */}
        {!fpMode && selectedObj && (
          <div className="absolute top-28 right-3 w-56 p-3 rounded-xl z-10" style={{ background: darkMode ? '#2d2d3f' : '#fff', boxShadow: 'var(--shadow-lg)', color: darkMode ? '#e0e0e0' : '#1d1d1f' }}>
            <h3 className="text-xs font-semibold mb-2" style={{ color: '#0071e3' }}>Proprietati</h3>
            {(() => {
              const props = getObjectProperties(selectedObj);
              return (
                <div className="space-y-1 text-[10px]" style={{ color: darkMode ? '#aaa' : '#86868b' }}>
                  <p><strong>ID:</strong> {props.catalogId}</p>
                  <p><strong>Dimensiuni:</strong> {(props.width * 100).toFixed(0)} x {(props.depth * 100).toFixed(0)} x {(props.height * 100).toFixed(0)} cm</p>
                  <p><strong>Pozitie:</strong> ({props.x.toFixed(2)}, {props.z.toFixed(2)}) m</p>
                  <p><strong>Rotatie:</strong> {props.rotation.toFixed(0)}deg</p>
                  <p><strong>Clearance:</strong> {(props.clearance * 100).toFixed(0)} cm</p>
                  {props.description && <p><strong>Descriere:</strong> {props.description}</p>}
                </div>
              );
            })()}
          </div>
        )}

        {/* Bottom status bar */}
        {!fpMode && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-1.5 text-[11px] z-10" style={{ background: darkMode ? 'rgba(30,30,50,0.9)' : 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e5e5ea', color: darkMode ? '#aaa' : '#86868b' }}>
            <span style={{ color: darkMode ? '#e0e0e0' : '#1d1d1f' }}>{statusMsg}</span>
            <div className="flex items-center gap-3">
              <span>{objectCount} obiecte</span>
              <span>Suprafata: {areaCalcSqm().toFixed(1)} mp</span>
              <button onClick={toggleDarkMode} className="px-2 py-0.5 rounded text-[10px]" style={{ background: darkMode ? '#555' : '#e5e5ea', color: darkMode ? '#fff' : '#333' }}>{darkMode ? 'Light' : 'Dark'}</button>
              <span className="hidden sm:inline">{orbitEditMode ? 'Edit ON: Click+drag=Muta | R=Rotire | Del=Sterge | D=Duplica | Ctrl+Z=Undo' : 'Click Edit pentru a muta obiecte | R=Rotire | Ctrl+Z=Undo'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
