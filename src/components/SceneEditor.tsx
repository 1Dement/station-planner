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
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CATALOG, CATEGORIES, CatalogItem, getCatalogByCategory } from '@/lib/catalog';
import {
  PlacedObject, createPlacedObject, highlightObject,
  checkCollision, getDistance, exportLayout
} from '@/lib/scene-objects';
import { loadBuildingIntoScene, snapToWall, WallSegment, DoorPanel, SlidingDoor } from '@/lib/building-loader';
import type { Wall, Hole } from '@/lib/wall-tool';
import { DEFAULT_WALL_STYLE, DEFAULT_DOOR, DEFAULT_WINDOW, findNearestWall } from '@/lib/wall-tool';
import { snap as snapPoint, SNAP_ENDPOINT, SNAP_MIDPOINT, SNAP_GRID } from '@/lib/wall-snap';
import { exportToIFC } from '@/lib/ifc-export';
import { loadPGW } from '@/lib/pgw-loader';
import { placeBackdropFromPGW } from '@/lib/backdrop';
import { createWallMesh, updateWallGroup, createPreviewLine, setPreviewLine, createSnapMarker } from '@/lib/wall-renderer';

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
  const togglePlanView = () => {
    setViewMode((m) => {
      const next = m === '3d' ? '2d' : '3d';
      const orbit = orbitRef.current;
      const persp = cameraRef.current;
      const renderer = rendererRef.current;
      const renderPass = renderPassRef.current;
      const ssao = ssaoPassRef.current;
      if (!orbit || !persp || !renderer) return next;

      if (next === '2d') {
        // Switch to ORTHOGRAPHIC top-down (true CAD plan view, zero perspective).
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        const aspect = w / h;
        const viewW = 25; // initial visible width in meters; user pans/zooms
        const viewH = viewW / aspect;
        let ortho = orthoCameraRef.current;
        if (!ortho) {
          ortho = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 500);
          orthoCameraRef.current = ortho;
        } else {
          ortho.left = -viewW / 2; ortho.right = viewW / 2;
          ortho.top = viewH / 2; ortho.bottom = -viewH / 2;
        }
        const tgt = orbit.target;
        ortho.position.set(tgt.x, 100, tgt.z);
        ortho.up.set(0, 0, -1);
        ortho.lookAt(tgt);
        ortho.zoom = 1;
        ortho.updateProjectionMatrix();

        cameraRef.current = ortho as unknown as THREE.PerspectiveCamera;
        if (renderPass) renderPass.camera = ortho;
        if (ssao) ssao.camera = ortho;
        orbit.object = ortho;

        orbit.minPolarAngle = 0;
        orbit.maxPolarAngle = 0;
        orbit.enableRotate = false;
        orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      } else {
        // Back to perspective + free orbit
        cameraRef.current = persp;
        if (renderPass) renderPass.camera = persp;
        if (ssao) ssao.camera = persp;
        orbit.object = persp;
        persp.up.set(0, 1, 0);
        orbit.minPolarAngle = 0;
        orbit.maxPolarAngle = Math.PI / 2.05;
        orbit.enableRotate = true;
        orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      }
      orbit.update();
      return next;
    });
  };
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const composerRef = useRef<any>(null);
  const renderPassRef = useRef<RenderPass | null>(null);
  const ssaoPassRef = useRef<SSAOPass | null>(null);
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
  const slidingDoorsRef = useRef<SlidingDoor[]>([]);
  const ceilingRef = useRef<THREE.Mesh | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const mouseDownPosRef = useRef(new THREE.Vector2());
  // Door toggle (click to open/close)
  const snapLinesRef = useRef<THREE.Group | null>(null);

  // Wall drawing state + refs
  type Tool = 'select' | 'wall' | 'door' | 'window' | 'extend' | 'trim';
  const [currentTool, setCurrentTool] = useState<Tool>('select');
  const currentToolRef = useRef<Tool>('select');
  const wallsRef = useRef<Wall[]>([]);
  const holesRef = useRef<Hole[]>([]);
  const [wallCount, setWallCount] = useState(0);
  const [holeCount, setHoleCount] = useState(0);
  const wallGroupRef = useRef<THREE.Group | null>(null);
  const wallPreviewLineRef = useRef<THREE.Line | null>(null);
  const wallStartPtRef = useRef<{ x: number; y: number } | null>(null);
  const snapMarkerRef = useRef<THREE.Mesh | null>(null);
  const backdropMeshRef = useRef<THREE.Mesh | null>(null);
  const [wallThickness, setWallThickness] = useState(0.25);
  const [wallHeight, setWallHeight] = useState(3.0);
  const [drawHint, setDrawHint] = useState<string>('');
  const pendingPlaceRef = useRef<CatalogItem | null>(null);
  const [pendingPlaceItem, setPendingPlaceItem] = useState<CatalogItem | null>(null);
  const cadFirstWallRef = useRef<string | null>(null);  // wall id picked as base for extend/trim
  const [showWallPanel, setShowWallPanel] = useState(false);
  const [walkSpeed, setWalkSpeed] = useState(1.0);
  const walkSpeedRef = useRef(1.0);
  useEffect(() => { walkSpeedRef.current = walkSpeed; }, [walkSpeed]);
  const [fov, setFov] = useState(50);
  useEffect(() => {
    const c = cameraRef.current as THREE.PerspectiveCamera | null;
    if (c && c.isPerspectiveCamera) { c.fov = fov; c.updateProjectionMatrix(); }
  }, [fov]);

  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);

  // Re-render walls when viewMode changes (2D ribbon vs 3D extrude)
  useEffect(() => {
    if (wallGroupRef.current) {
      updateWallGroup(wallGroupRef.current, wallsRef.current, viewMode, null, holesRef.current);
    }
  }, [viewMode]);

  // ESC to cancel wall/door/window drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (wallStartPtRef.current) {
          wallStartPtRef.current = null;
          if (wallPreviewLineRef.current) wallPreviewLineRef.current.visible = false;
          if (snapMarkerRef.current) snapMarkerRef.current.visible = false;
        }
        if (currentToolRef.current !== 'select') {
          setCurrentTool('select');
          setDrawHint('');
        }
        if (pendingPlaceRef.current) {
          pendingPlaceRef.current = null;
          setPendingPlaceItem(null);
          setStatusMsg('Plasare anulata');
        }
        cadFirstWallRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wall draw tool actions
  const handleToggleWallTool = () => {
    if (currentTool === 'wall') {
      setCurrentTool('select');
      wallStartPtRef.current = null;
      setDrawHint('');
      if (wallPreviewLineRef.current) wallPreviewLineRef.current.visible = false;
      if (snapMarkerRef.current) snapMarkerRef.current.visible = false;
    } else {
      setCurrentTool('wall');
      wallStartPtRef.current = null;
      setDrawHint('Click pt punct start | ESC = iesi');
    }
  };

  const handleToggleDoorTool = () => {
    if (currentTool === 'door') {
      setCurrentTool('select');
      setDrawHint('');
    } else {
      setCurrentTool('door');
      setDrawHint('Click pe perete pt usa (90x210cm) | ESC = iesi');
    }
  };

  const handleToggleWindowTool = () => {
    if (currentTool === 'window') {
      setCurrentTool('select');
      setDrawHint('');
    } else {
      setCurrentTool('window');
      setDrawHint('Click pe perete pt geam (120x140cm @ 90cm) | ESC = iesi');
    }
  };

  const handleClearWalls = () => {
    if (!confirm(`Sterg ${wallsRef.current.length} pereti?`)) return;
    wallsRef.current = [];
    setWallCount(0);
    if (wallGroupRef.current) updateWallGroup(wallGroupRef.current, [], viewMode, null, []);
    holesRef.current = [];
    setHoleCount(0);
  };

  const handleExportIFC = () => {
    if (wallsRef.current.length === 0) {
      alert('Niciun perete de exportat. Foloseste tool Perete intai.');
      return;
    }
    const ifc = exportToIFC(wallsRef.current, {
      projectName: 'Station Planner Layout',
      buildingName: 'Statie',
      holes: holesRef.current,
    });
    const blob = new Blob([ifc], { type: 'application/x-step' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-${Date.now()}.ifc`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`IFC exportat: ${wallsRef.current.length} pereti, ${ifc.length} bytes`);
  };

  const handleLoadBackdrop = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length < 1) return;
    const pngFile = Array.from(files).find(f => /\.(png|jpg|jpeg)$/i.test(f.name));
    const pgwFile = Array.from(files).find(f => /\.(pgw|wld|jgw)$/i.test(f.name));
    if (!pngFile) { alert('Selecteaza si fisier PNG/JPG.'); return; }
    if (!pgwFile) { alert('Selecteaza si fisier PGW/JGW/WLD.'); return; }
    const pngUrl = URL.createObjectURL(pngFile);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const pgw = loadPGW(String(reader.result));
        const loader = new THREE.TextureLoader();
        loader.load(pngUrl, (texture) => {
          if (!sceneRef.current) return;
          // Get image dims from texture
          const img = texture.image as HTMLImageElement;
          const placement = placeBackdropFromPGW(texture, img.width, img.height, pgw, 0.65);
          // Remove previous backdrop
          if (backdropMeshRef.current) sceneRef.current.remove(backdropMeshRef.current);
          sceneRef.current.add(placement.mesh);
          backdropMeshRef.current = placement.mesh;
          setStatusMsg(`Backdrop ${img.width}x${img.height} px = ${placement.widthMeters.toFixed(1)}x${placement.heightMeters.toFixed(1)} m`);
        });
      } catch (err) {
        alert(`Eroare PGW: ${(err as Error).message}`);
      }
    };
    reader.readAsText(pgwFile);
  };

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
  const measureModeRef = useRef(false);
  const measurePt1Ref = useRef<THREE.Vector3 | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);
  const measureLabelRef = useRef<THREE.Sprite | null>(null);
  const measurementsRef = useRef<Array<{ line: THREE.Line; label: THREE.Sprite; dist: number }>>([]);
  const measurePreviewRef = useRef<{ line: THREE.Line; label: THREE.Sprite } | null>(null);
  const dragGhostRef = useRef<THREE.Mesh | null>(null);
  const fpKeysRef = useRef<Set<string>>(new Set());
  const fpYawRef = useRef(0);
  const fpPitchRef = useRef(0);
  const fpTickRef = useRef<(() => void) | null>(null);

  // Undo/redo
  interface HistoryEntry { id: string; catalogId?: string; x: number; z: number; ry: number }
  const undoStackRef = useRef<HistoryEntry[][]>([]);
  const redoStackRef = useRef<HistoryEntry[][]>([]);

  // Keep refs in sync for use in event handlers
  useEffect(() => { roomWidthRef.current = roomWidth; }, [roomWidth]);
  useEffect(() => { roomDepthRef.current = roomDepth; }, [roomDepth]);
  useEffect(() => { fpModeRef.current = fpMode; }, [fpMode]);
  useEffect(() => { measureModeRef.current = measureMode; if (!measureMode) { clearMeasurePreview(); measurePt1Ref.current = null; } }, [measureMode]);
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

    // Tetris snap to other objects (object-to-object) — wider tolerance so it triggers easier
    const SNAP_T = 0.25;
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
      id: o.id, catalogId: o.catalogId, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
    }));
    undoStackRef.current.push(snapshot);
    redoStackRef.current = [];
  };

  const applySnapshot = (snap: { id: string; catalogId?: string; x: number; z: number; ry: number }[]) => {
    // Remove objects no longer in snapshot
    const keepIds = new Set(snap.map(s => s.id));
    const toRemove = objectsRef.current.filter(o => !keepIds.has(o.id));
    for (const obj of toRemove) {
      sceneRef.current?.remove(obj.mesh);
      obj.mesh.traverse(c => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); if (c.material instanceof THREE.Material) c.material.dispose(); }});
    }
    objectsRef.current = objectsRef.current.filter(o => keepIds.has(o.id));
    // Add or update from snapshot
    for (const s of snap) {
      let obj = objectsRef.current.find(o => o.id === s.id);
      if (!obj && s.catalogId) {
        const item = CATALOG.find(c => c.id === s.catalogId);
        if (item && sceneRef.current) {
          obj = createPlacedObject(item, new THREE.Vector3(s.x, 0, s.z));
          obj.id = s.id;
          sceneRef.current.add(obj.mesh);
          objectsRef.current.push(obj);
        }
      }
      if (obj) { obj.mesh.position.x = s.x; obj.mesh.position.z = s.z; obj.mesh.rotation.y = s.ry; }
    }
    setObjectCount(objectsRef.current.length);
    if (selectedRef.current && !objectsRef.current.find(o => o.id === selectedRef.current!.id)) {
      selectedRef.current = null;
      setSelectedObj(null);
    }
    checkAllCollisions();
  };

  const undo = () => {
    if (undoStackRef.current.length === 0) return;
    const current = objectsRef.current.map(o => ({
      id: o.id, catalogId: o.catalogId, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
    }));
    redoStackRef.current.push(current);
    const prev = undoStackRef.current.pop()!;
    applySnapshot(prev);
    setStatusMsg('Undo');
  };

  const clearMeasure = () => {
    // Clear all persistent measurements + the in-progress one
    if (sceneRef.current) {
      for (const m of measurementsRef.current) {
        sceneRef.current.remove(m.line); m.line.geometry.dispose();
        sceneRef.current.remove(m.label);
        if (m.label.material instanceof THREE.SpriteMaterial) {
          m.label.material.map?.dispose(); m.label.material.dispose();
        }
      }
    }
    measurementsRef.current = [];
    measurePt1Ref.current = null;
    measureLineRef.current = null;
    measureLabelRef.current = null;
  };

  const snapMeasurePt = (raw: THREE.Vector3): THREE.Vector3 => {
    const snapDist = 1.5;
    const candidates: Array<{ x: number; z: number; d: number }> = [];
    // Wall segment endpoints + projection onto segment
    for (const w of wallSegmentsRef.current) {
      for (const [x, z] of [[w.x1, w.z1], [w.x2, w.z2]]) {
        candidates.push({ x, z, d: Math.hypot(raw.x - x, raw.z - z) });
      }
      // Project click onto wall segment for "nearest point on wall edge"
      const wx = w.x2 - w.x1, wz = w.z2 - w.z1;
      const len2 = wx * wx + wz * wz;
      if (len2 > 0.01) {
        const t = Math.max(0, Math.min(1, ((raw.x - w.x1) * wx + (raw.z - w.z1) * wz) / len2));
        const px = w.x1 + t * wx, pz = w.z1 + t * wz;
        candidates.push({ x: px, z: pz, d: Math.hypot(raw.x - px, raw.z - pz) });
      }
    }
    for (const o of objectsRef.current) {
      const ox = o.mesh.position.x, oz = o.mesh.position.z;
      const w = o.dimensions.width / 2, d = o.dimensions.depth / 2;
      for (const [dx, dz] of [[-w, -d], [w, -d], [w, d], [-w, d], [0, 0]]) {
        candidates.push({ x: ox + dx, z: oz + dz, d: Math.hypot(raw.x - (ox + dx), raw.z - (oz + dz)) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const out = raw.clone();
    if (candidates.length && candidates[0].d < snapDist) {
      out.x = candidates[0].x; out.z = candidates[0].z;
    } else {
      out.x = Math.round(raw.x * 10) / 10;
      out.z = Math.round(raw.z * 10) / 10;
    }
    return out;
  };

  const updateMeasurePreview = (clientX: number, clientY: number) => {
    if (!measurePt1Ref.current || !sceneRef.current) return;
    const raw = getFloorIntersection(clientX, clientY);
    if (!raw) return;
    const pt = snapMeasurePt(raw);
    const p1 = measurePt1Ref.current;
    const dist = p1.distanceTo(pt);
    const points = [
      new THREE.Vector3(p1.x, 0.06, p1.z),
      new THREE.Vector3(pt.x, 0.06, pt.z),
    ];
    if (!measurePreviewRef.current) {
      const mat = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, mat);
      sceneRef.current.add(line);
      // Label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.scale.set(1.4, 0.35, 1);
      sceneRef.current.add(sprite);
      measurePreviewRef.current = { line, label: sprite };
    } else {
      measurePreviewRef.current.line.geometry.setFromPoints(points);
    }
    // Update label content + position
    const lbl = measurePreviewRef.current.label;
    const mat = lbl.material as THREE.SpriteMaterial;
    const tex = mat.map as THREE.CanvasTexture;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(255,170,0,0.9)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${dist.toFixed(2)} m`, 128, 32);
    tex.needsUpdate = true;
    lbl.position.set((p1.x + pt.x) / 2, 0.6, (p1.z + pt.z) / 2);
  };

  const clearMeasurePreview = () => {
    if (measurePreviewRef.current && sceneRef.current) {
      sceneRef.current.remove(measurePreviewRef.current.line);
      measurePreviewRef.current.line.geometry.dispose();
      sceneRef.current.remove(measurePreviewRef.current.label);
      const m = measurePreviewRef.current.label.material as THREE.SpriteMaterial;
      m.map?.dispose(); m.dispose();
      measurePreviewRef.current = null;
    }
  };

  const handleMeasureClick = (clientX: number, clientY: number) => {
    const ptRaw = getFloorIntersection(clientX, clientY);
    if (!ptRaw || !sceneRef.current) return;
    const pt = snapMeasurePt(ptRaw);

    if (!measurePt1Ref.current) {
      // First click — preserve previous measurements; only set first point
      measurePt1Ref.current = pt.clone();
      setStatusMsg('Masurare: click al doilea punct (ESC anuleaza)');
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
      measurementsRef.current.push({ line, label: sprite, dist });

      setStatusMsg(`Distanta: ${dist.toFixed(2)} m | click pt masura noua, ESC pt iesire`);
      measurePt1Ref.current = null;
    }
  };

  const redo = () => {
    if (redoStackRef.current.length === 0) return;
    const current = objectsRef.current.map(o => ({
      id: o.id, catalogId: o.catalogId, x: o.mesh.position.x, z: o.mesh.position.z, ry: o.mesh.rotation.y
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
    // Sky shader (Potree-style atmospheric scattering)
    {
      const sky = new Sky();
      sky.scale.setScalar(450);
      const u = (sky.material as THREE.ShaderMaterial).uniforms;
      u.turbidity.value = 7;
      u.rayleigh.value = 1.6;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.78;
      // Sun position: ~mid-morning
      const sunPhi = THREE.MathUtils.degToRad(90 - 35); // elevation 35deg
      const sunTheta = THREE.MathUtils.degToRad(140);   // azimuth
      const sun = new THREE.Vector3();
      sun.setFromSphericalCoords(1, sunPhi, sunTheta);
      u.sunPosition.value.copy(sun);
      scene.add(sky);
      // Bake env map from sky for IBL reflections
    }
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
    slidingDoorsRef.current = buildingResult.slidingDoors || [];
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

    // Wall drawing primitives
    const wallGroup = new THREE.Group();
    wallGroup.name = 'user-walls';
    scene.add(wallGroup);
    wallGroupRef.current = wallGroup;

    const previewLine = createPreviewLine();
    scene.add(previewLine);
    wallPreviewLineRef.current = previewLine;

    const snapMarker = createSnapMarker();
    scene.add(snapMarker);
    snapMarkerRef.current = snapMarker;

    // Expose internals for headless testing (no-op in normal use)
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__sp = {
        scene, camera, renderer, orbit,
        wallGroup, wallsRef, holesRef, backdropMeshRef, snapMarkerRef, previewLine,
        setTopDown: (alt = 25) => {
          camera.position.set(0, alt, 0.001);
          orbit.target.set(0, 0, 0);
          orbit.update();
        },
        countMeshes: () => scene.children.length,
        countWalls: () => wallsRef.current.length,
        countHoles: () => holesRef.current.length,
        hasBackdrop: () => !!backdropMeshRef.current && (scene.children.includes(backdropMeshRef.current!)),
      };
    }

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
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    renderPassRef.current = renderPass;
    const ssaoPass = new SSAOPass(scene, camera, canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    ssaoPassRef.current = ssaoPass;
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
      const ortho = orthoCameraRef.current;
      if (ortho) {
        const aspect = w / h;
        const baseW = (ortho.right - ortho.left);
        const baseH = baseW / aspect;
        ortho.top = baseH / 2; ortho.bottom = -baseH / 2;
        ortho.updateProjectionMatrix();
      }
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
  // In orbit edit mode: OrbitControls STAY enabled for camera rotation.
  //   - Click+drag on object => move object (orbit suppressed for that gesture)
  //   - Click+drag empty/floor => orbit camera as usual
  // In normal/fp mode: OrbitControls disabled (handled elsewhere) or fp takes over.
  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enabled = !fpMode;
  }, [orbitEditMode, fpMode]);

  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (fpModeRef.current) return;

      // EXTEND tool: click base wall, then click target wall; extends base endpoint to intersection
      if (currentToolRef.current === 'extend' || currentToolRef.current === 'trim') {
        const fp = getFloorIntersection(e.clientX, e.clientY);
        if (!fp) return;
        const click = { x: fp.x, y: -fp.z };
        const hit = findNearestWall(wallsRef.current, click, 0.8);
        if (!hit) { setDrawHint('Click pe un perete (toleranta 80cm)'); return; }
        if (!cadFirstWallRef.current) {
          cadFirstWallRef.current = hit.wall.id;
          setDrawHint(`${currentToolRef.current === 'extend' ? 'EXTINDE' : 'TRIM'}: click pe peretele tinta`);
          return;
        }
        const baseId = cadFirstWallRef.current;
        cadFirstWallRef.current = null;
        if (baseId === hit.wall.id) {
          setDrawHint('Selecteaza alt perete'); return;
        }
        const base = wallsRef.current.find(w => w.id === baseId);
        const target = hit.wall;
        if (!base) return;
        // Line-line intersection (extended): base.start + t*(base.end-base.start) = target.start + s*(target.end-target.start)
        const x1 = base.start.x, y1 = base.start.y, x2 = base.end.x, y2 = base.end.y;
        const x3 = target.start.x, y3 = target.start.y, x4 = target.end.x, y4 = target.end.y;
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-6) { setDrawHint('Pereti paraleli, fara intersectie'); return; }
        const tNum = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);
        const t = tNum / denom;
        // Intersection point on base line:
        const ix = x1 + t * (x2 - x1);
        const iy = y1 + t * (y2 - y1);
        if (currentToolRef.current === 'extend') {
          // Move base endpoint nearest to click (or to intersection — pick the side that grows)
          const dStart = Math.hypot(x1 - click.x, y1 - click.y);
          const dEnd = Math.hypot(x2 - click.x, y2 - click.y);
          const updated = wallsRef.current.map(w => {
            if (w.id !== baseId) return w;
            return dStart < dEnd
              ? { ...w, start: { x: ix, y: iy } }
              : { ...w, end: { x: ix, y: iy } };
          });
          wallsRef.current = updated;
          if (wallGroupRef.current) updateWallGroup(wallGroupRef.current, wallsRef.current, viewMode, null, holesRef.current);
          setDrawHint(`Extins. Click alt perete pt continuare sau ESC.`);
        } else {
          // TRIM: split base at intersection, drop the half containing the click
          const dStart = Math.hypot(x1 - click.x, y1 - click.y);
          const dEnd = Math.hypot(x2 - click.x, y2 - click.y);
          const updated = wallsRef.current.map(w => {
            if (w.id !== baseId) return w;
            return dStart < dEnd
              ? { ...w, start: { x: ix, y: iy } }   // drop start half (closer to click)
              : { ...w, end: { x: ix, y: iy } };
          });
          wallsRef.current = updated;
          if (wallGroupRef.current) updateWallGroup(wallGroupRef.current, wallsRef.current, viewMode, null, holesRef.current);
          setDrawHint(`Trim aplicat. Click alt perete sau ESC.`);
        }
        return;
      }

      // Door / Window placement — click on a wall to add opening
      if (currentToolRef.current === 'door' || currentToolRef.current === 'window') {
        const fp = getFloorIntersection(e.clientX, e.clientY);
        if (!fp) return;
        const click = { x: fp.x, y: -fp.z };
        const hit = findNearestWall(wallsRef.current, click, 0.6);
        if (!hit) {
          setDrawHint('Click EXACT pe perete (toleranta 60cm)');
          return;
        }
        const isDoor = currentToolRef.current === 'door';
        const tmpl = isDoor ? DEFAULT_DOOR : DEFAULT_WINDOW;
        const w = tmpl.width;
        // Center the opening at the click (offset is from wall start)
        let offset = hit.offset - w / 2;
        const wallLen = Math.hypot(hit.wall.end.x - hit.wall.start.x, hit.wall.end.y - hit.wall.start.y);
        offset = Math.max(0.05, Math.min(wallLen - w - 0.05, offset));
        if (wallLen < w + 0.1) {
          setDrawHint(`Perete prea scurt (${wallLen.toFixed(2)}m) pt ${isDoor ? 'usa' : 'geam'} ${w}m`);
          return;
        }
        const id = `h-${Date.now()}-${holesRef.current.length}`;
        const hole: Hole = {
          id,
          wallId: hit.wall.id,
          kind: tmpl.kind,
          offset,
          width: w,
          height: tmpl.height,
          sillHeight: tmpl.sillHeight,
        };
        holesRef.current = [...holesRef.current, hole];
        setHoleCount(holesRef.current.length);
        // Re-render all walls to include new hole
        if (wallGroupRef.current) {
          updateWallGroup(wallGroupRef.current, wallsRef.current, viewMode, null, holesRef.current);
        }
        setDrawHint(`${isDoor ? 'Usa' : 'Geam'} adaugat (${holesRef.current.length}) | continua sau ESC`);
        return;
      }

      // Wall draw tool — captures clicks regardless of orbit edit mode
      if (currentToolRef.current === 'wall') {
        const fp = getFloorIntersection(e.clientX, e.clientY);
        if (!fp) return;
        // Convert Three.js (X, _, -Y_plan) → plan (X, Y_plan)
        let candidate = { x: fp.x, y: -fp.z };
        // Snap
        const segs = wallsRef.current.map(w => ({ start: w.start, end: w.end }));
        const hit = snapPoint(candidate, segs, new Set([SNAP_ENDPOINT, SNAP_MIDPOINT, SNAP_GRID]), 0.4);
        if (hit) candidate = hit.point;

        if (!wallStartPtRef.current) {
          // First click — capture start
          wallStartPtRef.current = candidate;
          setDrawHint(`Click 2 pt punct final | ESC = anuleaza`);
        } else {
          // Second click — finalize wall
          const start = wallStartPtRef.current;
          const end = candidate;
          if (Math.hypot(end.x - start.x, end.y - start.y) > 0.05) {
            const id = `w-${Date.now()}-${wallsRef.current.length}`;
            const wall: Wall = {
              id,
              start: { ...start },
              end: { ...end },
              thickness: wallThickness,
              height: wallHeight,
              style: DEFAULT_WALL_STYLE,
              vertices: [`${id}-v1`, `${id}-v2`],
              holes: [],
            };
            wallsRef.current = [...wallsRef.current, wall];
            setWallCount(wallsRef.current.length);
            // Re-render walls
            if (wallGroupRef.current) {
              updateWallGroup(wallGroupRef.current, wallsRef.current, viewMode, null, holesRef.current);
            }
            // Chain mode — start of next wall = end of this one
            wallStartPtRef.current = { ...end };
            setDrawHint(`Perete adaugat (${wallsRef.current.length}) | continua sau ESC`);
          }
        }
        if (wallPreviewLineRef.current && wallStartPtRef.current) {
          setPreviewLine(wallPreviewLineRef.current, wallStartPtRef.current, wallStartPtRef.current);
        }
        return;
      }

      // Always record mousedown for measure tool drag-vs-click detection
      mouseDownPosRef.current.set(e.clientX, e.clientY);
      if (measureModeRef.current) return; // measure handled in mouseUp
      if (!orbitEditRef.current) return; // No further interaction in non-edit mode

      const rect = el.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      // Pending click-to-place: drop the queued catalog item at click position
      if (pendingPlaceRef.current) {
        const fp = getFloorIntersection(e.clientX, e.clientY);
        if (fp) {
          const item = pendingPlaceRef.current;
          pendingPlaceRef.current = null;
          setPendingPlaceItem(null);
          if (orbitRef.current) orbitRef.current.enabled = true;
          placeObjectAt(item, new THREE.Vector3(fp.x, 0, fp.z));
          e.stopImmediatePropagation();
          return;
        }
      }

      // Click on object = select + prepare drag (suspend orbit while dragging)
      // Map every hit to its top-level placed object, pick the closest *that is actually visible*
      const meshes = objectsRef.current.map(o => o.mesh);
      const allHits = raycasterRef.current.intersectObjects(meshes, true);
      let obj: PlacedObject | undefined;
      for (const h of allHits) {
        if (!h.object.visible) continue;
        const mat = (h.object as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && 'opacity' in mat && (mat as THREE.Material & { opacity: number }).opacity < 0.05) continue;
        let walker: THREE.Object3D | null = h.object;
        while (walker) {
          const found = objectsRef.current.find(o => o.mesh === walker);
          if (found) { obj = found; break; }
          walker = walker.parent;
        }
        if (obj) break;
      }
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
        if (orbitRef.current) orbitRef.current.enabled = false;
        // Spawn ghost outline ring on floor showing target footprint
        if (sceneRef.current) {
          if (dragGhostRef.current) sceneRef.current.remove(dragGhostRef.current);
          const w = obj.dimensions.width, d = obj.dimensions.depth;
          const ghostGeo = new THREE.PlaneGeometry(w, d);
          const ghostMat = new THREE.MeshBasicMaterial({ color: 0x0071e3, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false });
          const ghost = new THREE.Mesh(ghostGeo, ghostMat);
          ghost.rotation.x = -Math.PI / 2;
          ghost.rotation.z = obj.mesh.rotation.y;
          ghost.position.set(obj.mesh.position.x, 0.02, obj.mesh.position.z);
          ghost.renderOrder = 999;
          sceneRef.current.add(ghost);
          dragGhostRef.current = ghost;
        }
        e.stopImmediatePropagation();
        setStatusMsg(`Drag: ${obj.name} | R=rotire | snap zid + obiecte`);
      }
      // No object hit: orbit handles the click naturally
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (fpModeRef.current) return;

      // Wall draw tool — update preview + snap marker
      if (currentToolRef.current === 'wall') {
        el.style.cursor = 'crosshair';
        const fp = getFloorIntersection(e.clientX, e.clientY);
        if (!fp) return;
        let cur = { x: fp.x, y: -fp.z };
        const segs = wallsRef.current.map(w => ({ start: w.start, end: w.end }));
        const hit = snapPoint(cur, segs, new Set([SNAP_ENDPOINT, SNAP_MIDPOINT, SNAP_GRID]), 0.4);
        if (snapMarkerRef.current) {
          if (hit) {
            cur = hit.point;
            snapMarkerRef.current.position.set(hit.point.x, 0.03, -hit.point.y);
            snapMarkerRef.current.visible = true;
          } else {
            snapMarkerRef.current.visible = false;
          }
        }
        if (wallStartPtRef.current && wallPreviewLineRef.current) {
          setPreviewLine(wallPreviewLineRef.current, wallStartPtRef.current, cur);
          const dx = cur.x - wallStartPtRef.current.x;
          const dy = cur.y - wallStartPtRef.current.y;
          const len = Math.hypot(dx, dy);
          setDrawHint(`Lungime: ${(len * 100).toFixed(0)} cm | click pt punct final | ESC anuleaza`);
        }
        return;
      }

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
        if (dragGhostRef.current) {
          dragGhostRef.current.position.set(nx, 0.02, nz);
          dragGhostRef.current.rotation.z = obj.mesh.rotation.y;
        }
        checkAllCollisions();
        setSelectedObj({ ...obj });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Measure tool works in any mode (orbit free, edit, walk) — gate first
      if (measureModeRef.current) {
        const dx0 = e.clientX - mouseDownPosRef.current.x;
        const dy0 = e.clientY - mouseDownPosRef.current.y;
        if (Math.abs(dx0) < 5 && Math.abs(dy0) < 5) {
          handleMeasureClick(e.clientX, e.clientY);
          return;
        }
      }
      if (fpModeRef.current) return;
      // Note: removed early-exit on !orbitEditRef so door clicks (sliding/swing) work in free orbit too.

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        clearSnapLines();
        if (dragGhostRef.current && sceneRef.current) {
          sceneRef.current.remove(dragGhostRef.current);
          dragGhostRef.current.geometry.dispose();
          if (dragGhostRef.current.material instanceof THREE.Material) dragGhostRef.current.material.dispose();
          dragGhostRef.current = null;
        }
        el.style.cursor = 'crosshair';
        if (orbitRef.current) orbitRef.current.enabled = !fpModeRef.current;
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
        if (measureModeRef.current) { handleMeasureClick(e.clientX, e.clientY); return; }

        const rect = el.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

        // Sliding door toggle (gas station double sliding)
        const slidingGroups = slidingDoorsRef.current.map(s => s.group);
        const slidingHits = slidingGroups.length ? raycasterRef.current.intersectObjects(slidingGroups, true) : [];
        if (slidingHits.length > 0) {
          let n: THREE.Object3D | null = slidingHits[0].object;
          let entry: SlidingDoor | undefined;
          while (n) {
            entry = slidingDoorsRef.current.find(s => s.group === n);
            if (entry) break;
            n = n.parent;
          }
          if (entry) {
            const ud = entry.group.userData as { isOpen: boolean };
            ud.isOpen = !ud.isOpen;
            const targetOffset = ud.isOpen ? entry.halfW - 0.04 : 0;
            const startL = entry.panelL.position.x;
            const startR = entry.panelR.position.x;
            const endL = -(entry.halfW - 0.04) / 2 - 0.02 - targetOffset;
            const endR = +(entry.halfW - 0.04) / 2 + 0.02 + targetOffset;
            const t0 = performance.now();
            const dur = 600;
            const tween = () => {
              const t = Math.min(1, (performance.now() - t0) / dur);
              const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
              entry!.panelL.position.x = startL + (endL - startL) * k;
              entry!.panelR.position.x = startR + (endR - startR) * k;
              if (t < 1) requestAnimationFrame(tween);
            };
            tween();
            setStatusMsg(ud.isOpen ? 'Usa glisanta deschisa' : 'Usa glisanta inchisa');
            return;
          }
        }

        // Swing door toggle
        const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
        const doorHits = raycasterRef.current.intersectObjects(doorMeshes, true);
        if (doorHits.length > 0) {
          let clickedDoor: THREE.Object3D | null = doorHits[0].object;
          let doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor || d.panel === clickedDoor);
          while (!doorEntry && clickedDoor && clickedDoor.parent) {
            clickedDoor = clickedDoor.parent;
            doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor || d.panel === clickedDoor);
          }
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

  const isInsideWall = (x: number, z: number, halfW: number, halfD: number): boolean => {
    // Returns true if obj footprint center is too close to any wall stripe edge.
    const PAD = 0.10;
    const r = Math.max(halfW, halfD) + PAD;
    for (const w of wallSegmentsRef.current) {
      const wx = w.x2 - w.x1, wz = w.z2 - w.z1;
      const len2 = wx * wx + wz * wz;
      if (len2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((x - w.x1) * wx + (z - w.z1) * wz) / len2));
      const cx = w.x1 + t * wx, cz = w.z1 + t * wz;
      const dist = Math.hypot(x - cx, z - cz);
      if (dist < r + w.thickness / 2) return true;
    }
    return false;
  };

  const generateOMWLayout = () => {
    if (!sceneRef.current || !buildingBoundsRef.current) return;
    const b = buildingBoundsRef.current;
    const bw = b.maxX - b.minX, bd = b.maxZ - b.minZ;
    // Relative-coord layout (rx,rz in 0..1 of bbox, ry deg)
    const layout: Array<{ id: string; rx: number; rz: number; ry?: number }> = [
      // Coffee corner (NW)
      { id: 'coffee-machine-main', rx: 0.18, rz: 0.18, ry: 180 },
      { id: 'coffee-machine-secondary', rx: 0.30, rz: 0.18, ry: 180 },
      { id: 'juice-machine', rx: 0.42, rz: 0.18, ry: 180 },
      { id: 'microwave-station', rx: 0.54, rz: 0.18, ry: 180 },
      { id: 'hot-dog-grill', rx: 0.66, rz: 0.18, ry: 180 },
      { id: 'coffee-fridge', rx: 0.10, rz: 0.30, ry: 90 },
      // Aisles (3 gondole row, parallel to long axis)
      { id: 'gondola-double-90', rx: 0.30, rz: 0.45, ry: 0 },
      { id: 'gondola-double-90', rx: 0.30, rz: 0.55, ry: 0 },
      { id: 'gondola-double-90', rx: 0.30, rz: 0.65, ry: 0 },
      { id: 'gondola-double-60', rx: 0.50, rz: 0.50, ry: 0 },
      { id: 'gondola-double-60', rx: 0.50, rz: 0.60, ry: 0 },
      // Endcap displays at aisle ends
      { id: 'endcap-display', rx: 0.30, rz: 0.38 },
      { id: 'endcap-display', rx: 0.30, rz: 0.72 },
      // Front counter / checkout
      { id: 'counter-main', rx: 0.50, rz: 0.30, ry: 90 },
      { id: 'tobacco-display', rx: 0.50, rz: 0.22, ry: 0 },
      { id: 'impulse-rack', rx: 0.42, rz: 0.30 },
      { id: 'self-payment', rx: 0.62, rz: 0.30, ry: 90 },
      // Wall fridges back
      { id: 'fridge-wall-6door', rx: 0.85, rz: 0.50, ry: -90 },
      { id: 'fridge-2door', rx: 0.85, rz: 0.30, ry: -90 },
      { id: 'ice-cream-freezer', rx: 0.85, rz: 0.70, ry: -90 },
      // Dining zone (SW)
      { id: 'bar-table-round', rx: 0.15, rz: 0.85 },
      { id: 'bar-stool', rx: 0.10, rz: 0.85 },
      { id: 'bar-stool', rx: 0.20, rz: 0.85 },
      { id: 'bar-table-round', rx: 0.30, rz: 0.85 },
      { id: 'bar-stool', rx: 0.25, rz: 0.85 },
      { id: 'bar-stool', rx: 0.35, rz: 0.85 },
      // Decor / totems / utility
      { id: 'digital-menu-board', rx: 0.50, rz: 0.10, ry: 180 },
      { id: 'promo-totem', rx: 0.65, rz: 0.45 },
      { id: 'atm', rx: 0.10, rz: 0.50, ry: 90 },
      { id: 'trash-selective', rx: 0.50, rz: 0.92 },
      { id: 'hand-sanitizer', rx: 0.45, rz: 0.92 },
      { id: 'fire-extinguisher', rx: 0.92, rz: 0.92 },
    ];
    let placed = 0, skipped = 0;
    saveSnapshot();
    for (const it of layout) {
      const item = CATALOG.find(c => c.id === it.id);
      if (!item) continue;
      let x = b.minX + it.rx * bw;
      let z = b.minZ + it.rz * bd;
      const halfW = item.width / 2;
      const halfD = item.depth / 2;
      // Try original; if collides with wall, search a small spiral up to 1.5m
      if (isInsideWall(x, z, halfW, halfD)) {
        let found = false;
        for (let r = 0.3; r <= 1.5 && !found; r += 0.3) {
          for (let a = 0; a < 360; a += 30) {
            const tx = x + Math.cos(a * Math.PI / 180) * r;
            const tz = z + Math.sin(a * Math.PI / 180) * r;
            if (!isInsideWall(tx, tz, halfW, halfD)) { x = tx; z = tz; found = true; break; }
          }
        }
        if (!found) { skipped++; continue; }
      }
      const obj = createPlacedObject(item, new THREE.Vector3(x, 0, z));
      if (it.ry) obj.mesh.rotation.y = it.ry * Math.PI / 180;
      sceneRef.current!.add(obj.mesh);
      objectsRef.current.push(obj);
      placed++;
    }
    setObjectCount(objectsRef.current.length);
    setStatusMsg(`Generat layout OMW: ${placed} obiecte plasate${skipped ? ` (${skipped} sarite, fara loc liber)` : ''}. Ctrl+Z anuleaza.`);
    checkAllCollisions();
  };

  const placeObjectAt = (item: CatalogItem, pos: THREE.Vector3) => {
    if (!sceneRef.current) return;
    const obj = createPlacedObject(item, pos);
    sceneRef.current.add(obj.mesh);
    objectsRef.current.push(obj);
    setObjectCount(objectsRef.current.length);
    setStatusMsg(`Plasat: ${item.name}`);
    if (selectedRef.current) highlightObject(selectedRef.current, false);
    selectedRef.current = obj;
    setSelectedObj(obj);
    highlightObject(obj, true);
    checkAllCollisions();
  };

  const addObject = (item: CatalogItem) => {
    if (!sceneRef.current) return;
    if (fpMode && cameraRef.current) {
      // FP mode: spawn 2m in front of camera (no click-to-place)
      const cam = cameraRef.current;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      dir.y = 0; dir.normalize();
      placeObjectAt(item, new THREE.Vector3(cam.position.x + dir.x * 2, 0, cam.position.z + dir.z * 2));
      return;
    }
    // Edit mode: queue for click-to-place
    pendingPlaceRef.current = item;
    setPendingPlaceItem(item);
    setStatusMsg(`Click pe podea pentru a plasa: ${item.name} (ESC anuleaza)`);
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
    const bounds = buildingBoundsRef.current;
    // Prefer to start OUTSIDE the sliding door, looking IN.
    const sliding = slidingDoorsRef.current[0];
    if (sliding) {
      const sx = sliding.group.position.x;
      const sz = sliding.group.position.z;
      const sy = sliding.group.rotation.y; // closed-direction rotation around Y (= -startRad in extractor)
      // outward normal of the door (perpendicular to opening): rotate +Z by sy
      // pivot's local +X is the closed direction; perpendicular to it = +Z (panel faces along +Z in local)
      const outX = Math.sin(sy);
      const outZ = Math.cos(sy);
      cam.position.set(sx + outX * 2.5, 1.7, sz + outZ * 2.5);
      // Face toward door: forward dir = (-outX, 0, -outZ). yaw such that camera default -Z
      // becomes that dir. With three.js Y-rot by θ, -Z maps to (sin θ, 0, -cos θ).
      // Solve: sin θ = -outX, cos θ = outZ => θ = atan2(-outX, outZ)
      fpYawRef.current = Math.atan2(-outX, outZ);
    } else if (bounds) {
      // Fallback: south-east of building, facing center
      cam.position.set(bounds.maxX + 2, 1.7, (bounds.minZ + bounds.maxZ) / 2);
      fpYawRef.current = -Math.PI / 2;
    } else {
      cam.position.set(0, 1.7, -6.2);
      fpYawRef.current = Math.PI;
    }
    fpPitchRef.current = -0.05;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(fpPitchRef.current, fpYawRef.current, 0, 'YXZ');
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
      // Measure mode click in walk: hit floor at click point, no rotation/object pickup
      if (e.button === 0 && measureModeRef.current) {
        handleMeasureClick(e.clientX, e.clientY);
        return;
      }
      if (e.button === 2) {
        mouseDown = true;
        lastMX = e.clientX; lastMY = e.clientY;
        el.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0 && cameraRef.current) {
        const rect = el.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycasterRef.current.setFromCamera(mouse, cameraRef.current);
        // Sliding door toggle in walk
        const slidingGroups = slidingDoorsRef.current.map(s => s.group);
        const slidingHits = slidingGroups.length ? raycasterRef.current.intersectObjects(slidingGroups, true) : [];
        if (slidingHits.length > 0) {
          let n: THREE.Object3D | null = slidingHits[0].object;
          let entry: SlidingDoor | undefined;
          while (n) { entry = slidingDoorsRef.current.find(s => s.group === n); if (entry) break; n = n.parent; }
          if (entry) {
            const ud = entry.group.userData as { isOpen: boolean };
            ud.isOpen = !ud.isOpen;
            const targetOffset = ud.isOpen ? entry.halfW - 0.04 : 0;
            const startL = entry.panelL.position.x;
            const startR = entry.panelR.position.x;
            const endL = -(entry.halfW - 0.04) / 2 - 0.02 - targetOffset;
            const endR = +(entry.halfW - 0.04) / 2 + 0.02 + targetOffset;
            const t0 = performance.now(); const dur = 600;
            const tween = () => {
              const t = Math.min(1, (performance.now() - t0) / dur);
              const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
              entry!.panelL.position.x = startL + (endL - startL) * k;
              entry!.panelR.position.x = startR + (endR - startR) * k;
              if (t < 1) requestAnimationFrame(tween);
            };
            tween();
            return;
          }
        }
        // Swing door toggle in walk
        const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
        const doorHits = doorMeshes.length ? raycasterRef.current.intersectObjects(doorMeshes, true) : [];
        if (doorHits.length > 0) {
          let clicked: THREE.Object3D | null = doorHits[0].object;
          let entry = doorPanelsRef.current.find(d => d.pivot === clicked || d.panel === clicked);
          while (!entry && clicked && clicked.parent) { clicked = clicked.parent; entry = doorPanelsRef.current.find(d => d.pivot === clicked || d.panel === clicked); }
          if (entry) {
            const ud = entry.pivot.userData;
            ud.isOpen = !ud.isOpen;
            entry.pivot.rotation.y = ud.isOpen ? -ud.endAngle : -ud.startAngle;
            return;
          }
        }
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

      const baseSpeed = fpKeysRef.current.has('shift') ? 0.16 : 0.08;
      const speed = baseSpeed * walkSpeedRef.current;
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

        {/* Wall toolbar (top-right) — collapsible, hidden by default */}
        {!fpMode && showWallPanel && (
          <div className="absolute top-3 right-3 z-20 flex flex-col gap-2 p-3 rounded-xl" style={{ background: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', border: '1px solid #e5e5ea', minWidth: 260 }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#86868b' }}>Pereti & IFC</div>
            <div className="flex gap-2">
              <button
                onClick={handleToggleWallTool}
                className="flex-1 text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: currentTool === 'wall' ? '#0071e3' : '#f5f5f7', color: currentTool === 'wall' ? '#fff' : '#1d1d1f', border: currentTool === 'wall' ? 'none' : '1px solid #d1d1d6' }}
              >
                {currentTool === 'wall' ? 'Iesi perete' : 'Perete'}
              </button>
              <button
                onClick={handleToggleDoorTool}
                className="text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: currentTool === 'door' ? '#c97800' : '#f5f5f7', color: currentTool === 'door' ? '#fff' : '#1d1d1f', border: currentTool === 'door' ? 'none' : '1px solid #d1d1d6' }}
              >
                Usa
              </button>
              <button
                onClick={handleToggleWindowTool}
                className="text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: currentTool === 'window' ? '#0099cc' : '#f5f5f7', color: currentTool === 'window' ? '#fff' : '#1d1d1f', border: currentTool === 'window' ? 'none' : '1px solid #d1d1d6' }}
              >
                Geam
              </button>
              <button
                onClick={() => { cadFirstWallRef.current = null; setCurrentTool(currentTool === 'extend' ? 'select' : 'extend'); setDrawHint(currentTool === 'extend' ? '' : 'EXTINDE: click pe peretele de extins'); }}
                className="text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: currentTool === 'extend' ? '#34c759' : '#f5f5f7', color: currentTool === 'extend' ? '#fff' : '#1d1d1f', border: currentTool === 'extend' ? 'none' : '1px solid #d1d1d6' }}
                title="Extinde perete pana atinge un alt perete"
              >
                Extinde
              </button>
              <button
                onClick={() => { cadFirstWallRef.current = null; setCurrentTool(currentTool === 'trim' ? 'select' : 'trim'); setDrawHint(currentTool === 'trim' ? '' : 'TRIM: click pe peretele de taiat'); }}
                className="text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: currentTool === 'trim' ? '#ff9500' : '#f5f5f7', color: currentTool === 'trim' ? '#fff' : '#1d1d1f', border: currentTool === 'trim' ? 'none' : '1px solid #d1d1d6' }}
                title="Taie portiune din perete intre intersectii"
              >
                Trim
              </button>
              <button
                onClick={togglePlanView}
                title={viewMode === '2d' ? 'Plan 2D blocat (top-down) - click pt 3D' : 'Comuta la plan 2D blocat (top-down)'}
                className="text-xs py-2 px-3 rounded-lg font-medium transition-all"
                style={{ background: viewMode === '2d' ? '#30d158' : '#f5f5f7', color: viewMode === '2d' ? '#fff' : '#1d1d1f', border: viewMode === '2d' ? 'none' : '1px solid #d1d1d6' }}
              >
                {viewMode === '2d' ? '🔒 PLAN 2D' : '📐 Plan 2D'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: '#1d1d1f' }}>
              <label className="flex items-center gap-1">
                Grosime:
                <input type="number" step="0.05" min="0.05" max="0.5" value={wallThickness}
                  onChange={e => setWallThickness(parseFloat(e.target.value) || 0.25)}
                  className="w-14 px-1.5 py-1 rounded text-[11px]"
                  style={{ background: '#f5f5f7', border: '1px solid #d1d1d6' }} />m
              </label>
              <label className="flex items-center gap-1">
                Inaltime:
                <input type="number" step="0.1" min="0.5" max="6" value={wallHeight}
                  onChange={e => setWallHeight(parseFloat(e.target.value) || 3)}
                  className="w-14 px-1.5 py-1 rounded text-[11px]"
                  style={{ background: '#f5f5f7', border: '1px solid #d1d1d6' }} />m
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={handleClearWalls} disabled={wallCount === 0}
                className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-all"
                style={{ background: wallCount === 0 ? '#f5f5f7' : '#ff453a', color: wallCount === 0 ? '#86868b' : '#fff', border: 'none', cursor: wallCount === 0 ? 'not-allowed' : 'pointer' }}>
                Sterge tot
              </button>
              <button onClick={handleExportIFC} disabled={wallCount === 0}
                className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition-all"
                style={{ background: wallCount === 0 ? '#f5f5f7' : '#0071e3', color: wallCount === 0 ? '#86868b' : '#fff', border: 'none', cursor: wallCount === 0 ? 'not-allowed' : 'pointer' }}>
                Export IFC
              </button>
            </div>
            <label className="text-[11px] py-1.5 px-2 rounded-lg text-center cursor-pointer transition-all hover:opacity-80" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>
              Incarca PNG + PGW (georef)
              <input type="file" accept=".png,.jpg,.jpeg,.pgw,.jgw,.wld" multiple onChange={handleLoadBackdrop} className="hidden" />
            </label>
            <div className="text-[11px]" style={{ color: '#86868b' }}>
              Pereti: <span style={{ color: '#1d1d1f', fontWeight: 600 }}>{wallCount}</span>
              {' | '}Deschideri: <span style={{ color: '#1d1d1f', fontWeight: 600 }}>{holeCount}</span>
              {drawHint && <div style={{ marginTop: 4, color: '#0071e3' }}>{drawHint}</div>}
            </div>
          </div>
        )}

        {/* ORBIT MODE — main top bar (5 primary actions) */}
        {!fpMode && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 rounded-2xl z-10"
            style={{ background: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,0.14)', border: '1px solid #e5e5ea' }}
          >
            <button
              onClick={() => setOrbitEditMode(!orbitEditMode)}
              className="text-[12px] px-4 py-2 rounded-xl font-semibold transition-all"
              style={{ background: orbitEditMode ? '#f59e0b' : '#f5f5f7', color: orbitEditMode ? '#fff' : '#1d1d1f' }}
              title={orbitEditMode ? 'Edit ON: click+drag muta obiecte' : 'Comuta in modul EDITARE'}
            >
              {orbitEditMode ? '✏️ EDITARE ON' : '✏️ EDITARE'}
            </button>
            <button
              onClick={enterFpMode}
              className="text-[12px] px-4 py-2 rounded-xl font-semibold"
              style={{ background: '#f5f5f7', color: '#1d1d1f' }}
              title="Intra in modul WALK (mers prin spatiu)"
            >
              🚶 WALK-MODE
            </button>
            <button
              onClick={() => { setShowCeiling(!showCeiling); if (ceilingRef.current) ceilingRef.current.visible = !showCeiling; }}
              className="text-[12px] px-4 py-2 rounded-xl font-semibold transition-colors"
              style={{ background: showCeiling ? '#6b7280' : '#f5f5f7', color: showCeiling ? '#fff' : '#1d1d1f' }}
              title="Toggle tavan"
            >
              🏠 TAVAN
            </button>
            <button
              onClick={togglePlanView}
              className="text-[12px] px-4 py-2 rounded-xl font-semibold transition-colors"
              style={{ background: viewMode === '2d' ? '#30d158' : '#f5f5f7', color: viewMode === '2d' ? '#fff' : '#1d1d1f' }}
              title={viewMode === '2d' ? 'Plan 2D blocat (top-down ortho)' : 'Comuta la PLAN 2D'}
            >
              {viewMode === '2d' ? '🔒 PLAN 2D' : '📐 PLAN 2D'}
            </button>
            <button
              onClick={generateOMWLayout}
              className="text-[12px] px-4 py-2 rounded-xl font-semibold"
              style={{ background: '#7c3aed', color: '#fff' }}
              title="Auto Planner Station — genereaza layout (cafea, gondole, frigidere, dining, casa)"
            >
              ⚡ AUTO PLANNER STATION
            </button>
            <button
              onClick={saveLayoutToStorage}
              className="text-[12px] px-3 py-2 rounded-xl font-semibold"
              style={{ background: '#30d158', color: '#fff' }}
              title="Salveaza layout (browser storage)"
            >
              💾 SAVE
            </button>
            <button
              onClick={loadLayoutFromStorage}
              className="text-[12px] px-3 py-2 rounded-xl font-semibold"
              style={{ background: '#5ac8fa', color: '#fff' }}
              title="Incarca ultimul layout salvat"
            >
              📂 LOAD
            </button>
            <button
              onClick={handleExport}
              className="text-[12px] px-3 py-2 rounded-xl font-semibold"
              style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}
              title="Descarca layout JSON"
            >
              ⬇ EXPORT
            </button>
            <label
              className="text-[12px] px-3 py-2 rounded-xl font-semibold cursor-pointer"
              style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}
              title="Incarca layout din JSON"
            >
              ⬆ IMPORT
              <input type="file" accept=".json" onChange={handleImportLayout} className="hidden" />
            </label>
            <div className="w-px h-6 mx-0.5" style={{ background: '#e5e5ea' }} />
            {/* Secondary tools */}
            <button onClick={() => rotateSelected(-45)} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-gray-100" style={{ color: '#1d1d1f' }} title="Roteste -45deg">-45°</button>
            <button onClick={() => rotateSelected(45)} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-gray-100" style={{ color: '#1d1d1f' }} title="Roteste +45deg">+45°</button>
            <button onClick={() => rotateSelected(90)} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-gray-100" style={{ color: '#1d1d1f' }} title="Roteste 90deg">90°</button>
            <button onClick={duplicateSelected} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-gray-100" style={{ color: '#1d1d1f' }}>Duplica</button>
            <button onClick={deleteSelected} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-red-50" style={{ color: '#ff3b30' }}>Sterge</button>
            <button onClick={clearAllObjects} className="text-[11px] px-2 py-1.5 rounded-lg hover:bg-red-50" style={{ color: '#ff3b30' }} title="Sterge tot">X Tot</button>
            <button
              onClick={() => { if (measureMode) clearMeasure(); setMeasureMode(!measureMode); setStatusMsg(!measureMode ? 'Masura: click 2 puncte pe podea (snap la colt zid)' : ''); }}
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ background: measureMode ? '#ff3b30' : '#f5f5f7', color: measureMode ? '#fff' : '#1d1d1f' }}
              title="Tool masura: click pe podea pt 2 puncte (cm/m). Click pe Masura iar pt iesire."
            >
              📏 MĂSURARE
            </button>
            <button
              onClick={() => setShowWallPanel(!showWallPanel)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ background: showWallPanel ? '#0071e3' : '#f5f5f7', color: showWallPanel ? '#fff' : '#1d1d1f' }}
              title="Toggle panel desenare zid + IFC export"
            >
              🧱 IFC
            </button>
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: '#f5f5f7' }} title={`FOV ${fov}deg`}>
              <span className="text-[10px] font-mono" style={{ color: '#86868b' }}>FOV</span>
              <input type="range" min={20} max={110} step={1} value={fov} onChange={(e) => setFov(parseInt(e.target.value))} className="w-20 accent-blue-500" disabled={viewMode === '2d'} />
              <span className="text-[10px] font-mono w-7 text-right" style={{ color: '#1d1d1f' }}>{fov}°</span>
            </div>
          </div>
        )}

        {/* WALK MODE HUD */}
        {fpMode && (
          <>
            {/* Top bar — walk mode (5 actions: EDITARE, TAVAN, PLAN 2D N/A in walk, SPEED, ESC IESIRE) */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-2xl z-10" style={{ background: 'rgba(15,15,25,0.78)', backdropFilter: 'blur(10px)', boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
              <button
                onClick={() => { setFpEditMode(!fpEditMode); setShowCatalog(!fpEditMode); setFpAction(null); }}
                className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                style={{ background: fpEditMode ? '#f59e0b' : '#3b82f6', color: '#fff' }}
                title={fpEditMode ? 'Editare ON: drag obiecte' : 'Comuta editare obiecte'}
              >
                ✏️ {fpEditMode ? 'EDITARE ON' : 'EDITARE'}
              </button>
              <button
                onClick={() => { setShowCeiling(!showCeiling); if (ceilingRef.current) ceilingRef.current.visible = !showCeiling; }}
                className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                style={{ background: showCeiling ? '#6b7280' : 'rgba(255,255,255,0.15)', color: '#fff' }}
              >
                🏠 TAVAN
              </button>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.10)' }}>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>VITEZA</span>
                <input
                  type="range" min={0.3} max={3} step={0.1} value={walkSpeed}
                  onChange={(e) => setWalkSpeed(parseFloat(e.target.value))}
                  className="w-24 accent-blue-500"
                  title={`x${walkSpeed.toFixed(1)} - Shift = sprint`}
                />
                <span className="text-[10px] font-mono w-8 text-right" style={{ color: '#fff' }}>x{walkSpeed.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.10)' }} title={`FOV ${fov}deg`}>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>FOV</span>
                <input type="range" min={40} max={110} step={1} value={fov} onChange={(e) => setFov(parseInt(e.target.value))} className="w-20 accent-blue-500" />
                <span className="text-[10px] font-mono w-8 text-right" style={{ color: '#fff' }}>{fov}°</span>
              </div>
              <button
                onClick={() => { if (measureMode) clearMeasure(); setMeasureMode(!measureMode); }}
                className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                style={{ background: measureMode ? '#ff3b30' : 'rgba(255,255,255,0.15)', color: '#fff' }}
                title="Tool masura: click 2 puncte pe podea"
              >
                📏 MĂSURARE
              </button>
              <button
                onClick={exitFpMode}
                className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                style={{ background: '#ef4444', color: '#fff' }}
                title="Iesi din walk mode (ESC)"
              >
                ✕ ESC IESIRE
              </button>
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

        {/* Catalog obiecte plasate (Andrei feedback) */}
        {!fpMode && objectCount > 0 && (
          <div className="absolute bottom-12 left-3 w-60 p-2.5 rounded-xl z-10" style={{ background: darkMode ? '#1c1c2e' : '#fff', boxShadow: 'var(--shadow)', border: '1px solid ' + (darkMode ? '#333' : '#d1d1d6'), maxHeight: '40vh', overflowY: 'auto', color: darkMode ? '#e0e0e0' : '#1d1d1f' }}>
            <h3 className="text-[11px] font-semibold mb-1.5" style={{ color: '#0071e3' }}>Obiecte plasate ({objectCount})</h3>
            <ul className="space-y-0.5">
              {objectsRef.current.map(o => (
                <li
                  key={o.id}
                  onClick={() => {
                    if (selectedRef.current) highlightObject(selectedRef.current, false);
                    selectedRef.current = o;
                    setSelectedObj(o);
                    highlightObject(o, true);
                    setStatusMsg(`Selectat: ${o.name}`);
                  }}
                  className="text-[10px] px-1.5 py-1 rounded cursor-pointer transition-colors"
                  style={{
                    background: selectedObj && selectedObj.id === o.id ? '#0071e3' : 'transparent',
                    color: selectedObj && selectedObj.id === o.id ? '#fff' : (darkMode ? '#aaa' : '#1d1d1f'),
                  }}
                >
                  {o.name} <span style={{ opacity: 0.6 }}>({o.mesh.position.x.toFixed(1)}, {o.mesh.position.z.toFixed(1)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pending placement banner */}
        {!fpMode && pendingPlaceItem && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg z-20 text-[11px] font-semibold" style={{ background: '#0071e3', color: '#fff', boxShadow: 'var(--shadow)' }}>
            Click pe podea pt plasare: {pendingPlaceItem.name} (ESC anuleaza)
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
