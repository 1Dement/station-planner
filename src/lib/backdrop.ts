import * as THREE from 'three';
import type { PGWGeoref } from './pgw-loader';

export interface BackdropPlacement {
  mesh: THREE.Mesh;
  worldOffset: { x: number; y: number };
  widthMeters: number;
  heightMeters: number;
}

/**
 * Create a textured plane at the right scale & position from a PNG + PGW pair.
 * Uses worldOffset pattern: scene math stays near origin to preserve Float32 precision;
 * absolute Stereo70 coords live in returned `worldOffset`, applied only at IFC export time.
 */
export function placeBackdropFromPGW(
  texture: THREE.Texture,
  widthPx: number,
  heightPx: number,
  pgw: PGWGeoref,
  opacity = 0.7,
): BackdropPlacement {
  const widthMeters = Math.abs(pgw.pixelSizeX) * widthPx;
  const heightMeters = Math.abs(pgw.pixelSizeY) * heightPx;

  // Center the plane at the image centroid in world coords
  const centerWorldX = pgw.originX + (widthMeters / 2) * Math.sign(pgw.pixelSizeX || 1);
  const centerWorldY = pgw.originY + (heightMeters / 2) * Math.sign(pgw.pixelSizeY || -1);
  const worldOffset = { x: centerWorldX, y: centerWorldY };

  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geometry = new THREE.PlaneGeometry(widthMeters, heightMeters);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Lay flat (Y is up in Three.js), slightly below ground to render under walls
  mesh.rotation.x = -Math.PI / 2;
  // Render slightly above floor so the texture is visible (existing scene has floor at Y=0)
  mesh.position.set(0, 0.01, 0);
  mesh.userData.isBackdrop = true;
  mesh.userData.worldOffset = worldOffset;
  mesh.userData.pgw = pgw;

  return { mesh, worldOffset, widthMeters, heightMeters };
}

export function setBackdropOpacity(placement: BackdropPlacement, opacity: number): void {
  const mat = placement.mesh.material;
  if (Array.isArray(mat)) return;
  if ('opacity' in mat) {
    mat.opacity = Math.max(0, Math.min(1, opacity));
    if ('transparent' in mat) mat.transparent = opacity < 1;
  }
}
