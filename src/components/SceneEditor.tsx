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

  const [selectedObj, setSelectedObj] = useState<PlacedObject | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('shelving');
  const [showCatalog, setShowCatalog] = useState(true);
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
  const [fpAction, setFpAction] = useState<{ obj: PlacedObject; x: number; y: number } | null>(null);
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
  useEffect(() => { fpEditRef.current = fpEditMode; }, [fpEditMode]);

  const snap = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;

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
  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left click
      // In FP mode, mouse is for looking — skip all drag/select logic
      if (fpModeRef.current) return;
      mouseDownPosRef.current.set(e.clientX, e.clientY);

      const rect = el.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      // Then check furniture objects
      const meshes = objectsRef.current.map(o => o.mesh);
      const intersects = raycasterRef.current.intersectObjects(meshes, true);

      if (intersects.length > 0) {
        // Find which PlacedObject owns this clicked child mesh
        let clicked = intersects[0].object as THREE.Object3D;
        let obj = objectsRef.current.find(o => o.mesh === clicked);
        while (!obj && clicked.parent) {
          clicked = clicked.parent;
          obj = objectsRef.current.find(o => o.mesh === clicked);
        }
        if (obj) {
          if (selectedRef.current && selectedRef.current !== obj) {
            highlightObject(selectedRef.current, false);
          }
          selectedRef.current = obj;
          setSelectedObj(obj);
          highlightObject(obj, true);

          const floorPoint = getFloorIntersection(e.clientX, e.clientY);
          if (floorPoint) {
            dragOffsetRef.current.set(
              obj.mesh.position.x - floorPoint.x,
              0,
              obj.mesh.position.z - floorPoint.z
            );
          }

          saveSnapshot();
          isDraggingRef.current = true;
          // Disable orbit ONLY when dragging an object
          if (orbitRef.current) orbitRef.current.enabled = false;
          el.style.cursor = 'grabbing';
          setStatusMsg(`Drag: ${obj.name}`);
          e.preventDefault();
          e.stopPropagation();
        }
      }
      // If no object hit, OrbitControls handles the event naturally (orbit/pan)
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (fpModeRef.current) return; // FP mode handles its own mouse

      if (!isDraggingRef.current || !selectedRef.current) {
        // Hover effect
        const rect = el.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycasterRef.current.setFromCamera(mouse, cameraRef.current!);
        const allInteractive = [...objectsRef.current.map(o => o.mesh), ...doorPanelsRef.current.map(d => d.pivot)];
        const intersects = raycasterRef.current.intersectObjects(allInteractive, true);
        el.style.cursor = intersects.length > 0 ? 'grab' : 'default';
        return;
      }

      const floorPoint = getFloorIntersection(e.clientX, e.clientY);
      if (floorPoint && selectedRef.current) {
        const obj = selectedRef.current;
        let newX = snap(floorPoint.x + dragOffsetRef.current.x);
        let newZ = snap(floorPoint.z + dragOffsetRef.current.z);

        // Auto-boundary: clamp to building exterior
        const bounds = buildingBoundsRef.current;
        if (bounds) {
          const objHalfW = obj.dimensions.width / 2;
          const objHalfD = obj.dimensions.depth / 2;
          newX = Math.max(bounds.minX + objHalfW, Math.min(bounds.maxX - objHalfW, newX));
          newZ = Math.max(bounds.minZ + objHalfD, Math.min(bounds.maxZ - objHalfD, newZ));
        }

        // Wall snap for all objects near walls
        if (wallSegmentsRef.current.length > 0) {
          const result = snapToWall(newX, newZ, obj.dimensions.depth, wallSegmentsRef.current, 0.6);
          if (result.snapped) {
            newX = result.x;
            newZ = result.z;
            obj.mesh.rotation.y = result.rotation;
          }
        }

        // Tetris snap: align edges with nearby objects
        const SNAP_DIST = 0.15;
        for (const other of objectsRef.current) {
          if (other.id === obj.id) continue;
          const ox = other.mesh.position.x, oz = other.mesh.position.z;
          const ow = other.dimensions.width / 2, od = other.dimensions.depth / 2;
          const tw = obj.dimensions.width / 2, td = obj.dimensions.depth / 2;

          // Snap X edges (left-to-right, right-to-left)
          if (Math.abs(newZ - oz) < Math.max(od, td) + 0.3) {
            if (Math.abs((newX + tw) - (ox - ow)) < SNAP_DIST) newX = ox - ow - tw;
            if (Math.abs((newX - tw) - (ox + ow)) < SNAP_DIST) newX = ox + ow + tw;
          }
          // Snap Z edges
          if (Math.abs(newX - ox) < Math.max(ow, tw) + 0.3) {
            if (Math.abs((newZ + td) - (oz - od)) < SNAP_DIST) newZ = oz - od - td;
            if (Math.abs((newZ - td) - (oz + od)) < SNAP_DIST) newZ = oz + od + td;
          }
          // Align same axis (objects side by side → same Z or same X)
          if (Math.abs(newZ - oz) < SNAP_DIST && Math.abs(newX - ox) < ow + tw + 0.5) newZ = oz;
          if (Math.abs(newX - ox) < SNAP_DIST && Math.abs(newZ - oz) < od + td + 0.5) newX = ox;
        }

        obj.mesh.position.x = newX;
        obj.mesh.position.z = newZ;
        obj.mesh.position.y = 0;
        checkAllCollisions();
        setSelectedObj({ ...obj });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (fpModeRef.current) return; // FP mode handles its own mouse

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        if (orbitRef.current) orbitRef.current.enabled = true;
        el.style.cursor = selectedRef.current ? 'grab' : 'default';
        if (selectedRef.current) {
          setStatusMsg(`Plasat: ${selectedRef.current.name} (${selectedRef.current.mesh.position.x.toFixed(2)}, ${selectedRef.current.mesh.position.z.toFixed(2)})`);
        }
        checkAllCollisions();
        return;
      }

      // Simple click (no drag) - check if it was just a click (not drag)
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // Measure mode intercept
        if (measureMode) { handleMeasureClick(e.clientX, e.clientY); return; }

        const rect = el.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

        // Check door click — toggle open/closed
        const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
        const doorHits = raycasterRef.current.intersectObjects(doorMeshes, true);
        if (doorHits.length > 0) {
          let clickedDoor = doorHits[0].object as THREE.Object3D;
          let doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor || d.panel === clickedDoor);
          while (!doorEntry && clickedDoor.parent) {
            clickedDoor = clickedDoor.parent;
            doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor);
          }
          if (doorEntry) {
            const ud = doorEntry.pivot.userData;
            ud.isOpen = !ud.isOpen;
            doorEntry.pivot.rotation.y = ud.isOpen ? -ud.endAngle : -ud.startAngle;
            setStatusMsg(ud.isOpen ? 'Ușă deschisă' : 'Ușă închisă');
            return;
          }
        }

        const meshes = objectsRef.current.map(o => o.mesh);
        const intersects = raycasterRef.current.intersectObjects(meshes, true);

        if (intersects.length === 0) {
          // Clicked on empty space - deselect
          if (selectedRef.current) {
            highlightObject(selectedRef.current, false);
          }
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
        rotateSelected(45);
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
      if (e.key === 'Escape') { exitFpMode(); return; }
      // FP edit mode shortcuts
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

    // Right-click drag = look around, Left-click = interact
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== el) return; // Only canvas clicks
      if (e.button === 2) { // Right click only for look
        mouseDown = true;
        lastMX = e.clientX;
        lastMY = e.clientY;
        el.style.cursor = 'grabbing';
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      const dx = e.clientX - lastMX;
      const dy = e.clientY - lastMY;
      lastMX = e.clientX;
      lastMY = e.clientY;
      fpYawRef.current -= dx * 0.003;
      fpPitchRef.current -= dy * 0.003;
      fpPitchRef.current = Math.max(-1.2, Math.min(1.2, fpPitchRef.current));
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) { mouseDown = false; el.style.cursor = 'crosshair'; return; }
      if (e.button !== 0) return;
      // Ignore clicks that happened on UI elements (not on canvas)
      if (e.target !== el) return;
      // Left click = interact (doors, objects in edit mode)
      if (!cameraRef.current) return;
      const rect = el.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(mouse, cameraRef.current);

      // Check doors first
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

      // In FP edit mode: click objects → show action popup
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
            // Show action popup at click position
            setFpAction({ obj: found, x: e.clientX, y: e.clientY });
          }
        } else {
          if (selectedRef.current) highlightObject(selectedRef.current, false);
          selectedRef.current = null;
          setSelectedObj(null);
          setFpAction(null);
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
        style={{ background: '#fff', borderRight: '1px solid #e5e5ea', boxShadow: '2px 0 8px rgba(0,0,0,0.04)' }}
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
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>

          {/* Catalog items */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {getCatalogByCategory(activeCategory).map(item => (
              <button
                key={item.id}
                onClick={() => addObject(item)}
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
          <div className="px-3 py-3 flex gap-2" style={{ borderTop: '1px solid #e5e5ea' }}>
            <button onClick={handleExport} className="flex-1 text-[11px] py-2 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#0071e3', color: '#fff' }}>Export</button>
            <button onClick={handleScreenshot} className="flex-1 text-[11px] py-2 rounded-lg font-medium transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>Screenshot</button>
            <label className="flex-1 text-[11px] py-2 rounded-lg font-medium text-center cursor-pointer transition-all hover:opacity-90" style={{ background: '#f5f5f7', color: '#1d1d1f', border: '1px solid #d1d1d6' }}>
              Import
              <input type="file" accept=".json" onChange={handleImportLayout} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Main 3D Viewport */}
      <div className="flex-1 relative">
        <div ref={canvasRef} className="w-full h-full" />

        {/* Crosshair in walk mode */}
        {fpMode && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
            <div style={{ width: 20, height: 20 }}>
              <div style={{ position: 'absolute', left: 9, top: 2, width: 2, height: 6, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
              <div style={{ position: 'absolute', left: 9, top: 12, width: 2, height: 6, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
              <div style={{ position: 'absolute', left: 2, top: 9, width: 6, height: 2, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
              <div style={{ position: 'absolute', left: 12, top: 9, width: 6, height: 2, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
            </div>
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
            <div className="w-px h-4 mx-0.5" style={{ background: '#e5e5ea' }} />
            <button onClick={resetCamera} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors font-medium" style={{ color: '#1d1d1f' }}>3D</button>
            <button onClick={topView} className="text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors font-medium" style={{ color: '#1d1d1f' }}>2D</button>
            <button onClick={() => { setShowCeiling(!showCeiling); if (ceilingRef.current) ceilingRef.current.visible = !showCeiling; }} className="text-[11px] px-2.5 py-1.5 rounded-lg transition-colors" style={{ background: showCeiling ? '#0071e3' : 'transparent', color: showCeiling ? '#fff' : '#1d1d1f' }}>Tavan</button>
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
              <div className="px-4 py-2 rounded-lg text-xs" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', color: 'rgba(255,255,255,0.8)' }}>
                <span className="font-mono">WASD</span> mers &nbsp; <span className="font-mono">Shift</span> sprint &nbsp; <span className="font-mono">Click dreapta+drag</span> rotire &nbsp; <span className="font-mono">Click stanga</span> usi{fpEditMode && ' / selectare'}
              </div>
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
                      if (!cameraRef.current || !fpAction) return;
                      saveSnapshot();
                      const cam = cameraRef.current;
                      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                      dir.y = 0; dir.normalize();
                      fpAction.obj.mesh.position.set(cam.position.x + dir.x * 2, 0, cam.position.z + dir.z * 2);
                      setStatusMsg(`Mutat: ${fpAction.obj.name} in fata ta`);
                      setFpAction(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <span style={{ fontSize: 14 }}>&#8644;</span> Muta in fata mea
                  </button>
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

        {/* Bottom status bar */}
        {!fpMode && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-1.5 text-[11px] z-10" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e5e5ea', color: '#86868b' }}>
            <span style={{ color: '#1d1d1f' }}>{statusMsg}</span>
            <div className="flex items-center gap-3">
              <span>{objectCount} obiecte</span>
              <span className="hidden sm:inline">Drag=Muta | R=Roteste | D=Duplica | Del=Sterge | Ctrl+Z=Undo</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
