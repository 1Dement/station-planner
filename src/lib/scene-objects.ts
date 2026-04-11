import * as THREE from 'three';
import { CatalogItem } from './catalog';
import { createProceduralModel } from './procedural-models';

export interface PlacedObject {
  id: string;
  catalogId: string;
  mesh: THREE.Object3D;
  outlineMesh: THREE.LineSegments;
  label: THREE.Sprite;
  dimensions: { width: number; depth: number; height: number };
  clearance: number;
  name: string;
}

const textureCanvas = (text: string, bgColor: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffffff44';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Segoe UI, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  return new THREE.CanvasTexture(canvas);
};

// GLB model cache to avoid reloading
const glbCache = new Map<string, THREE.Object3D>();

export function createObjectMesh(item: CatalogItem): THREE.Object3D {
  // Check if we have a cached GLB clone
  if (item.glb && glbCache.has(item.glb)) {
    const clone = glbCache.get(item.glb)!.clone();
    clone.userData = { catalogId: item.id, type: 'placeable' };
    return clone;
  }

  const group = createProceduralModel(item);
  group.userData = { catalogId: item.id, type: 'placeable' };
  group.castShadow = true;
  return group;
}

// Async loader for GLB — call once at startup to preload
export async function preloadGLBModels(items: CatalogItem[]): Promise<void> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  const glbItems = items.filter(i => i.glb);
  await Promise.all(glbItems.map(item => {
    if (!item.glb) return Promise.resolve();
    return new Promise<void>((resolve) => {
      loader.load(
        `/models/${item.glb}`,
        (gltf) => {
          const model = gltf.scene;
          model.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          // Scale to match catalog dimensions
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          box.getSize(size);
          const scale = Math.min(item.width / size.x, item.height / size.y, item.depth / size.z);
          model.scale.multiplyScalar(scale);
          // Center on XZ, align bottom to Y=0
          const box2 = new THREE.Box3().setFromObject(model);
          model.position.y -= box2.min.y;
          model.position.x -= (box2.min.x + box2.max.x) / 2;
          model.position.z -= (box2.min.z + box2.max.z) / 2;

          const wrapper = new THREE.Group();
          wrapper.add(model);
          wrapper.userData = { catalogId: item.id, type: 'placeable' };
          glbCache.set(item.glb!, wrapper);
          resolve();
        },
        undefined,
        () => resolve() // silently fall back to procedural on error
      );
    });
  }));
}

export function createOutline(obj: THREE.Object3D, item: CatalogItem): THREE.LineSegments {
  // Bounding box outline
  const boxGeo = new THREE.BoxGeometry(item.width, item.height, item.depth);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x0071e3,
    linewidth: 2,
    transparent: true,
    opacity: 0.8,
  });
  const outline = new THREE.LineSegments(edges, lineMaterial);
  outline.position.y = item.height / 2;
  outline.visible = false;
  return outline;
}

export function createLabel(name: string, height: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  const radius = 16;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(512 - radius, 0);
  ctx.quadraticCurveTo(512, 0, 512, radius);
  ctx.lineTo(512, 128 - radius);
  ctx.quadraticCurveTo(512, 128, 512 - radius, 128);
  ctx.lineTo(radius, 128);
  ctx.quadraticCurveTo(0, 128, 0, 128 - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.fill();

  ctx.strokeStyle = '#0071e3';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#1d1d1f';
  ctx.font = 'bold 32px Segoe UI, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.position.y = height + 0.3;
  sprite.visible = false;

  return sprite;
}

export function createPlacedObject(item: CatalogItem, position: THREE.Vector3): PlacedObject {
  const mesh = createObjectMesh(item);
  mesh.position.set(position.x, 0, position.z);

  const outline = createOutline(mesh, item);
  mesh.add(outline);

  const label = createLabel(item.name, item.height);
  mesh.add(label);

  return {
    id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    catalogId: item.id,
    mesh,
    outlineMesh: outline,
    label,
    dimensions: { width: item.width, depth: item.depth, height: item.height },
    clearance: item.clearance,
    name: item.name,
  };
}

export function highlightObject(obj: PlacedObject, selected: boolean) {
  obj.outlineMesh.visible = selected;
  obj.label.visible = selected;
  // Set emissive on all child meshes
  obj.mesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.set(selected ? 0x0071e3 : 0x000000);
      child.material.emissiveIntensity = selected ? 0.15 : 0;
    }
  });
}

export function checkCollision(a: PlacedObject, b: PlacedObject): boolean {
  const aBox = new THREE.Box3().setFromObject(a.mesh);
  const bBox = new THREE.Box3().setFromObject(b.mesh);
  return aBox.intersectsBox(bBox);
}

export function getDistance(a: PlacedObject, b: PlacedObject): number {
  const aPos = new THREE.Vector2(a.mesh.position.x, a.mesh.position.z);
  const bPos = new THREE.Vector2(b.mesh.position.x, b.mesh.position.z);
  const aHalf = Math.max(a.dimensions.width, a.dimensions.depth) / 2;
  const bHalf = Math.max(b.dimensions.width, b.dimensions.depth) / 2;
  return aPos.distanceTo(bPos) - aHalf - bHalf;
}

export interface LayoutData {
  version: string;
  timestamp: string;
  roomDimensions: { width: number; depth: number };
  objects: Array<{
    catalogId: string;
    name: string;
    position: { x: number; y: number; z: number };
    rotation: number;
    dimensions: { width: number; depth: number; height: number };
  }>;
}

export function exportLayout(objects: PlacedObject[], roomWidth: number, roomDepth: number): LayoutData {
  return {
    version: '1.0',
    timestamp: new Date().toISOString(),
    roomDimensions: { width: roomWidth, depth: roomDepth },
    objects: objects.map(obj => ({
      catalogId: obj.catalogId,
      name: obj.name,
      position: {
        x: Math.round(obj.mesh.position.x * 1000) / 1000,
        y: Math.round(obj.mesh.position.y * 1000) / 1000,
        z: Math.round(obj.mesh.position.z * 1000) / 1000,
      },
      rotation: Math.round(obj.mesh.rotation.y * (180 / Math.PI) * 10) / 10,
      dimensions: obj.dimensions,
    })),
  };
}
