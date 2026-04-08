'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
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
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const mouseDownPosRef = useRef(new THREE.Vector2());
  const isDraggingDoorRef = useRef(false);
  const draggingDoorRef = useRef<{ pivot: THREE.Group; info: DoorPanel } | null>(null);

  const [selectedObj, setSelectedObj] = useState<PlacedObject | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('shelving');
  const [showCatalog, setShowCatalog] = useState(true);
  const [collisions, setCollisions] = useState<string[]>([]);
  const [objectCount, setObjectCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Gata de lucru');
  const [roomWidth, setRoomWidth] = useState(DEFAULT_ROOM_WIDTH);
  const [roomDepth, setRoomDepth] = useState(DEFAULT_ROOM_DEPTH);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);

  // Keep refs in sync for use in event handlers
  useEffect(() => { roomWidthRef.current = roomWidth; }, [roomWidth]);
  useEffect(() => { roomDepthRef.current = roomDepth; }, [roomDepth]);

  const snap = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;

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
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.FogExp2(0x1a1a2e, 0.015);
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
    renderer.toneMappingExposure = 1.2;
    canvasRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

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

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(8, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x6699ff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x362d1b, 0.4);
    scene.add(hemiLight);

    // Load building from DXF data
    const buildingResult = loadBuildingIntoScene(scene);
    buildingBoundsRef.current = buildingResult.exteriorBounds;
    wallSegmentsRef.current = buildingResult.wallSegments;
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

    const gridHelper = new THREE.GridHelper(40, 80, 0x0f3460, 0x0a1e3d);
    gridHelper.position.y = 0.002;
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

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
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
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
      mouseDownPosRef.current.set(e.clientX, e.clientY);

      const rect = el.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      // Check door panels first
      const doorMeshes = doorPanelsRef.current.map(d => d.pivot);
      const doorIntersects = raycasterRef.current.intersectObjects(doorMeshes, true);
      if (doorIntersects.length > 0) {
        let clickedDoor = doorIntersects[0].object as THREE.Object3D;
        let doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor || d.panel === clickedDoor);
        while (!doorEntry && clickedDoor.parent) {
          clickedDoor = clickedDoor.parent;
          doorEntry = doorPanelsRef.current.find(d => d.pivot === clickedDoor);
        }
        if (doorEntry) {
          isDraggingDoorRef.current = true;
          draggingDoorRef.current = doorEntry;
          if (orbitRef.current) orbitRef.current.enabled = false;
          el.style.cursor = 'grabbing';
          setStatusMsg(`Ușă: drag pentru deschidere/închidere`);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

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
      // Door panel drag — rotate on hinge
      if (isDraggingDoorRef.current && draggingDoorRef.current) {
        const floorPt = getFloorIntersection(e.clientX, e.clientY);
        if (floorPt) {
          const dp = draggingDoorRef.current;
          // Angle from hinge to mouse position
          const dx = floorPt.x - dp.info.hingeX;
          const dz = floorPt.z - dp.info.hingeZ;
          let angle = Math.atan2(dz, dx);

          // Clamp between startAngle and endAngle
          const sa = Math.min(dp.info.startAngle, dp.info.endAngle);
          const ea = Math.max(dp.info.startAngle, dp.info.endAngle);
          angle = Math.max(sa, Math.min(ea, angle));

          dp.pivot.rotation.y = -angle;
        }
        return;
      }

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

        // Wall snap: snap to any wall segment from DXF
        const isWallItem = obj.catalogId.includes('shelf-wall') || obj.catalogId === 'tobacco-display' || obj.catalogId === 'fire-extinguisher' || obj.catalogId === 'first-aid' || obj.catalogId === 'drink-cooler' || obj.catalogId === 'fridge-vertical' || obj.catalogId === 'fridge-double';
        if (isWallItem && wallSegmentsRef.current.length > 0) {
          const result = snapToWall(newX, newZ, obj.dimensions.depth, wallSegmentsRef.current, 0.8);
          if (result.snapped) {
            newX = result.x;
            newZ = result.z;
            obj.mesh.rotation.y = result.rotation;
          }
        }

        obj.mesh.position.x = newX;
        obj.mesh.position.z = newZ;
        obj.mesh.position.y = 0;
        checkAllCollisions();
        setSelectedObj({ ...obj });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Release door panel drag
      if (isDraggingDoorRef.current) {
        isDraggingDoorRef.current = false;
        draggingDoorRef.current = null;
        if (orbitRef.current) orbitRef.current.enabled = true;
        el.style.cursor = 'default';
        setStatusMsg('Ușă ajustată');
        return;
      }

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
        // It was a click, not a drag
        const rect = el.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);
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
      if (e.key === 'Delete' && selectedRef.current) {
        deleteSelected();
      }
      if ((e.key === 'r' || e.key === 'R') && selectedRef.current) {
        // Rotate 45 degrees
        selectedRef.current.mesh.rotation.y += Math.PI / 4;
        setStatusMsg(`Rotit: ${selectedRef.current.name} (${(selectedRef.current.mesh.rotation.y * 180 / Math.PI).toFixed(0)}°)`);
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
    // Place at center of view (camera target)
    const bounds = buildingBoundsRef.current;
    const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    const centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;
    // Small random offset so objects don't stack exactly
    const offset = (Math.random() - 0.5) * 2;
    const pos = new THREE.Vector3(centerX + offset, 0, centerZ + offset);
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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left Panel - Catalog */}
      <div
        className={`${showCatalog ? 'w-72' : 'w-0'} transition-all duration-300 flex-shrink-0 overflow-hidden`}
        style={{ background: 'var(--panel-bg)', borderRight: '1px solid var(--panel-border)' }}
      >
        <div className="w-72 h-full flex flex-col">
          <div className="p-3 border-b" style={{ borderColor: 'var(--panel-border)' }}>
            <h1 className="text-base font-bold" style={{ color: 'var(--accent)' }}>
              Station Planner 3D
            </h1>
            <p className="text-xs opacity-60 mt-0.5">Planificare spatiu statie carburant</p>
          </div>

          <div className="p-3 border-b" style={{ borderColor: 'var(--panel-border)' }}>
            <h3 className="text-xs font-bold uppercase opacity-50 mb-2">Incinta</h3>
            <label
              className="block w-full text-center text-xs py-2 px-3 rounded cursor-pointer mb-2 transition-colors"
              style={{ background: 'var(--panel-border)', color: 'var(--success)' }}
            >
              {pointCloudLoaded ? 'Point Cloud Incarcat' : 'Incarca Point Cloud (.ply)'}
              <input type="file" accept=".ply" onChange={handleLoadPointCloud} className="hidden" />
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs opacity-50">Latime (m)</label>
                <input
                  type="number" value={roomWidth} min={3} max={50} step={0.5}
                  onChange={e => setRoomWidth(Number(e.target.value))}
                  onBlur={updateRoom}
                  className="w-full text-xs p-1.5 rounded mt-0.5"
                  style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)' }}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs opacity-50">Adancime (m)</label>
                <input
                  type="number" value={roomDepth} min={3} max={50} step={0.5}
                  onChange={e => setRoomDepth(Number(e.target.value))}
                  onBlur={updateRoom}
                  className="w-full text-xs p-1.5 rounded mt-0.5"
                  style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)' }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 p-3 border-b" style={{ borderColor: 'var(--panel-border)' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{
                  background: activeCategory === cat.id ? 'var(--accent)' : 'var(--panel-border)',
                  color: activeCategory === cat.id ? '#fff' : 'var(--foreground)',
                }}
              >
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {getCatalogByCategory(activeCategory).map(item => (
              <button
                key={item.id}
                onClick={() => addObject(item)}
                className="w-full text-left p-2.5 mb-1.5 rounded transition-all hover:scale-[1.02]"
                style={{
                  background: 'var(--background)',
                  border: '1px solid var(--panel-border)',
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: item.color + '40' }}
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{item.name}</div>
                    <div className="text-[10px] opacity-50">
                      {(item.width * 100).toFixed(0)}x{(item.depth * 100).toFixed(0)}x{(item.height * 100).toFixed(0)} cm
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="p-3 border-t flex flex-col gap-1.5" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="flex gap-1.5">
              <button
                onClick={handleExport}
                className="flex-1 text-xs py-1.5 rounded font-semibold transition-colors"
                style={{ background: 'var(--success)', color: '#000' }}
              >
                Export JSON
              </button>
              <button
                onClick={handleScreenshot}
                className="flex-1 text-xs py-1.5 rounded font-semibold transition-colors"
                style={{ background: 'var(--panel-border)', color: 'var(--foreground)' }}
              >
                Screenshot
              </button>
            </div>
            <label
              className="block w-full text-center text-xs py-1.5 rounded cursor-pointer transition-colors"
              style={{ background: 'var(--panel-border)', color: 'var(--foreground)' }}
            >
              Import Layout
              <input type="file" accept=".json" onChange={handleImportLayout} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Main 3D Viewport */}
      <div className="flex-1 relative">
        <div ref={canvasRef} className="w-full h-full" />

        <button
          onClick={() => setShowCatalog(!showCatalog)}
          className="absolute top-3 left-3 w-8 h-8 rounded flex items-center justify-center text-sm z-10"
          style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
          title={showCatalog ? 'Ascunde catalog' : 'Arata catalog'}
        >
          {showCatalog ? '◀' : '▶'}
        </button>

        {/* Top toolbar */}
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg z-10"
          style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
        >
          <button
            onClick={() => rotateSelected(-45)}
            className="text-xs px-3 py-1.5 rounded font-semibold transition-colors hover:opacity-80"
            style={{ background: 'var(--panel-border)' }}
            title="Roteste -45°"
          >
            ↶ -45°
          </button>
          <button
            onClick={() => rotateSelected(45)}
            className="text-xs px-3 py-1.5 rounded font-semibold transition-colors hover:opacity-80"
            style={{ background: 'var(--panel-border)' }}
            title="Roteste +45°"
          >
            ↷ +45°
          </button>
          <button
            onClick={() => rotateSelected(90)}
            className="text-xs px-3 py-1.5 rounded font-semibold transition-colors hover:opacity-80"
            style={{ background: 'var(--panel-border)' }}
            title="Roteste 90°"
          >
            ↻ 90°
          </button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--panel-border)' }} />
          <button
            onClick={duplicateSelected}
            className="text-xs px-2 py-1.5 rounded transition-colors hover:opacity-80"
            style={{ background: 'var(--panel-border)' }}
            title="Duplica (D)"
          >
            ⧉ Duplica
          </button>
          <button
            onClick={deleteSelected}
            className="text-xs px-2 py-1.5 rounded transition-colors hover:opacity-80"
            style={{ background: '#e9456033', color: 'var(--accent)' }}
            title="Sterge (Del)"
          >
            Sterge
          </button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--panel-border)' }} />
          <button onClick={resetCamera} className="text-xs px-2 py-1.5 rounded transition-colors hover:opacity-80" style={{ background: 'var(--panel-border)' }} title="Reset camera">
            3D
          </button>
          <button onClick={topView} className="text-xs px-2 py-1.5 rounded transition-colors hover:opacity-80" style={{ background: 'var(--panel-border)' }} title="Vedere de sus">
            2D
          </button>
        </div>

        {/* Selected object info */}
        {selectedObj && (
          <div
            className="absolute top-14 right-3 w-56 p-3 rounded-lg z-10"
            style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
          >
            <h3 className="text-xs font-bold mb-2" style={{ color: 'var(--success)' }}>
              {selectedObj.name}
            </h3>
            <div className="space-y-1 text-[10px] opacity-70">
              <p>Dimensiuni: {(selectedObj.dimensions.width * 100).toFixed(0)}x{(selectedObj.dimensions.depth * 100).toFixed(0)}x{(selectedObj.dimensions.height * 100).toFixed(0)} cm</p>
              <p>Pozitie X: {selectedObj.mesh.position.x.toFixed(2)}m</p>
              <p>Pozitie Z: {selectedObj.mesh.position.z.toFixed(2)}m</p>
              <p>Rotatie: {(selectedObj.mesh.rotation.y * 180 / Math.PI).toFixed(1)}°</p>
              <p>Clearance minim: {(selectedObj.clearance * 100).toFixed(0)} cm</p>
            </div>
            {objectsRef.current.length > 1 && (
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
                <p className="text-[10px] font-bold opacity-50 mb-1">Distante:</p>
                {objectsRef.current
                  .filter(o => o.id !== selectedObj.id)
                  .map(o => ({ name: o.name, dist: getDistance(selectedObj, o) }))
                  .sort((a, b) => a.dist - b.dist)
                  .slice(0, 4)
                  .map((d, i) => (
                    <p key={i} className="text-[10px]" style={{
                      color: d.dist < selectedObj.clearance ? 'var(--accent)' : 'var(--success)'
                    }}>
                      → {d.name}: {(d.dist * 100).toFixed(0)} cm
                      {d.dist < selectedObj.clearance && ' ⚠'}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Collision warnings */}
        {collisions.length > 0 && (
          <div
            className="absolute bottom-16 right-3 w-56 p-3 rounded-lg z-10 max-h-48 overflow-y-auto"
            style={{ background: '#e9456022', border: '1px solid var(--accent)' }}
          >
            <h3 className="text-xs font-bold mb-1" style={{ color: 'var(--accent)' }}>
              Coliziuni ({collisions.length})
            </h3>
            {collisions.slice(0, 8).map((c, i) => (
              <p key={i} className="text-[10px] opacity-80">{c}</p>
            ))}
            {collisions.length > 8 && (
              <p className="text-[10px] opacity-50">...si inca {collisions.length - 8}</p>
            )}
          </div>
        )}

        {/* Bottom status bar */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 text-xs z-10"
          style={{ background: 'var(--panel-bg)', borderTop: '1px solid var(--panel-border)' }}
        >
          <span>{statusMsg}</span>
          <div className="flex items-center gap-4 opacity-60">
            <span>Obiecte: {objectCount}</span>
            <span>Grid: {GRID_SNAP * 100}cm</span>
            <span className="hidden sm:inline">Drag=Muta | R=Roteste | D=Duplica | Del=Sterge | Click dreapta=Orbit</span>
          </div>
        </div>
      </div>
    </div>
  );
}
