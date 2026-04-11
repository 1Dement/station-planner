import * as THREE from 'three';
import { CatalogItem } from './catalog';

// === MATERIALS (PBR-quality with RoomEnvironment reflections) ===
const metalMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.15, metalness: 0.9 });
const brushedMetal = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.35, metalness: 0.85 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.25, metalness: 0.8 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.75, metalness: 0.02 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5, metalness: 0.05 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.15 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xddeeff, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.45, metalness: 0.2 });
const counterTopMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.3, metalness: 0.05 });
const counterBodyMat = new THREE.MeshStandardMaterial({ color: 0x48413a, roughness: 0.7, metalness: 0.05 });
const blueMat = new THREE.MeshStandardMaterial({ color: 0x1a5faa, roughness: 0.35, metalness: 0.3 });
const greenLed = new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.8 });
const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1628, roughness: 0.05, metalness: 0.4, emissive: 0x0a2040, emissiveIntensity: 0.15 });
const fabricMat = new THREE.MeshStandardMaterial({ color: 0x4a4240, roughness: 0.9, metalness: 0.0 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// Random product color for shelf items
function productColor(): THREE.MeshStandardMaterial {
  const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e, 0xd4a843, 0xc0392b];
  return new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.6, metalness: 0.05 });
}

// Add product boxes on shelves
function addProducts(group: THREE.Group, shelfW: number, shelfY: number, shelfD: number, x = 0, z = 0, count = 4) {
  const pw = (shelfW - 0.06) / count;
  for (let i = 0; i < count; i++) {
    const ph = 0.08 + Math.random() * 0.12;
    const pd = shelfD * 0.5 + Math.random() * shelfD * 0.3;
    const px = x - shelfW / 2 + 0.03 + pw * i + pw / 2;
    group.add(box(pw * 0.85, ph, pd, productColor(), px, shelfY + ph / 2 + 0.01, z));
  }
}

// === SHELF WALL (upgraded) ===
function createShelfWall(w: number, h: number, d: number, shelfCount = 5): THREE.Group {
  const group = new THREE.Group();
  const fw = 0.025;

  // Uprights (L-profile shape simulated with 2 thin boxes)
  for (const sx of [-1, 1]) {
    const px = sx * (w / 2 - fw / 2);
    group.add(box(fw, h, fw * 2, brushedMetal, px, h / 2, -d / 2 + fw));
    group.add(box(fw, h, d, brushedMetal, px, h / 2, 0));
  }

  // Back panel (pegboard look)
  group.add(box(w - 0.02, h - 0.02, 0.008, whiteMat, 0, h / 2, -d / 2 + 0.004));

  // Shelves with lip
  const shelfH = 0.015;
  for (let i = 0; i < shelfCount; i++) {
    const y = (i / (shelfCount - 1)) * (h - 0.06) + 0.03;
    group.add(box(w - 0.04, shelfH, d - 0.02, brushedMetal, 0, y, 0.01));
    // Front lip
    group.add(box(w - 0.04, 0.025, 0.003, brushedMetal, 0, y + 0.02, d / 2 - 0.01));
    // Products on shelf (skip bottom)
    if (i > 0) addProducts(group, w - 0.06, y, d - 0.04, 0, 0.01, 3 + Math.floor(Math.random() * 3));
  }

  return group;
}

// === GONDOLA (upgraded) ===
function createGondola(w: number, h: number, d: number, shelfCount = 4): THREE.Group {
  const group = new THREE.Group();
  const fw = 0.025;

  // 4 uprights
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(box(fw, h, fw, brushedMetal, sx * (w / 2 - fw / 2), h / 2, sz * (d / 2 - fw / 2)));
    }
  }

  // Central divider
  group.add(box(w - 0.02, h - 0.05, 0.006, brushedMetal, 0, h / 2, 0));

  // Top header (price strip)
  group.add(box(w + 0.01, 0.06, d + 0.01, darkMetal, 0, h + 0.03, 0));

  // Shelves on both sides + products
  const shelfH = 0.015;
  const shelfD = d / 2 - 0.03;
  for (let i = 0; i < shelfCount; i++) {
    const y = (i / (shelfCount - 1)) * (h - 0.06) + 0.03;
    for (const sz of [-1, 1]) {
      group.add(box(w - 0.04, shelfH, shelfD, brushedMetal, 0, y, sz * (d / 4)));
      group.add(box(w - 0.04, 0.02, 0.003, brushedMetal, 0, y + 0.015, sz * (d / 2 - 0.02)));
      if (i > 0) addProducts(group, w - 0.06, y, shelfD - 0.02, 0, sz * (d / 4), 3 + Math.floor(Math.random() * 2));
    }
  }

  return group;
}

// === FRIDGE (upgraded — commercial glass-door) ===
function createFridge(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.7 });

  // Body (dark interior visible through glass)
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.1 });
  group.add(box(w, h, d, interiorMat, 0, h / 2, 0));

  // Top + bottom frame
  group.add(box(w + 0.01, 0.06, d + 0.01, frameMat, 0, h - 0.03, 0));
  group.add(box(w + 0.01, 0.08, d + 0.01, frameMat, 0, 0.04, 0));

  // Door count based on width
  const doors = w > 1.2 ? 3 : w > 0.8 ? 2 : 1;
  const doorW = (w - 0.04) / doors;
  for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + 0.02 + doorW * i + doorW / 2;
    // Glass panel
    group.add(box(doorW - 0.02, h - 0.18, 0.015, glassMat, dx, h / 2, d / 2 + 0.005));
    // Door frame (thin border)
    group.add(box(doorW, 0.02, 0.025, frameMat, dx, h - 0.08, d / 2));
    group.add(box(doorW, 0.02, 0.025, frameMat, dx, 0.09, d / 2));
    group.add(box(0.015, h - 0.16, 0.025, frameMat, dx - doorW / 2 + 0.007, h / 2, d / 2));
    group.add(box(0.015, h - 0.16, 0.025, frameMat, dx + doorW / 2 - 0.007, h / 2, d / 2));
    // Handle
    group.add(box(0.015, 0.25, 0.025, metalMat, dx + doorW / 2 - 0.025, h * 0.55, d / 2 + 0.02));
  }

  // Interior shelves (glass)
  const glassShelf = new THREE.MeshPhysicalMaterial({ color: 0xeef4ff, roughness: 0.1, transparent: true, opacity: 0.25, clearcoat: 0.5 });
  for (let i = 1; i < 5; i++) {
    group.add(box(w - 0.05, 0.008, d - 0.06, glassShelf, 0, i * (h / 5), -0.01));
  }

  // LED strip at top inside
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xddeeff, emissiveIntensity: 0.4 });
  group.add(box(w - 0.06, 0.01, 0.02, ledMat, 0, h - 0.08, d / 2 - 0.04));

  return group;
}

// === CHEST FREEZER ===
function createChestFreezer(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w, h - 0.05, d, whiteMat, 0, (h - 0.05) / 2, 0));
  // Curved glass top (simulated with angled box)
  group.add(box(w - 0.03, 0.02, d - 0.03, glassMat, 0, h - 0.03, 0));
  // Metal rim
  group.add(box(w + 0.01, 0.03, 0.03, brushedMetal, 0, h - 0.015, -d / 2 + 0.015));
  group.add(box(w + 0.01, 0.03, 0.03, brushedMetal, 0, h - 0.015, d / 2 - 0.015));
  group.add(box(0.03, 0.03, d, brushedMetal, -w / 2 + 0.015, h - 0.015, 0));
  group.add(box(0.03, 0.03, d, brushedMetal, w / 2 - 0.015, h - 0.015, 0));
  // Brand strip
  group.add(box(w, 0.08, 0.005, darkMat, 0, h * 0.5, d / 2));
  return group;
}

// === COUNTER (upgraded) ===
function createCounter(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Body
  group.add(box(w, h - 0.04, d, counterBodyMat, 0, (h - 0.04) / 2, 0));
  // Countertop with overhang
  group.add(box(w + 0.03, 0.04, d + 0.02, counterTopMat, 0, h - 0.02, 0.01));
  // Front panel (lighter)
  const frontMat = new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 0.6, metalness: 0.05 });
  group.add(box(w - 0.02, h - 0.12, 0.008, frontMat, 0, h / 2 - 0.02, d / 2 - 0.004));
  // Kick plate
  group.add(box(w - 0.04, 0.06, 0.005, darkMetal, 0, 0.03, d / 2));
  // POS terminal (on counter)
  group.add(box(0.25, 0.02, 0.18, darkMat, w * 0.2, h, 0));
  group.add(box(0.20, 0.22, 0.015, screenMat, w * 0.2, h + 0.14, -0.04));
  return group;
}

// === COFFEE MACHINE (upgraded) ===
function createCoffeeMachine(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.3 });

  // Main body
  group.add(box(w, h * 0.65, d, bodyMat, 0, h * 0.325, 0));
  // Top hopper
  group.add(box(w * 0.5, h * 0.3, d * 0.5, bodyMat, 0, h * 0.8, 0));
  // Hopper dome (transparent)
  const hopperMat = new THREE.MeshPhysicalMaterial({ color: 0x443322, roughness: 0.2, transparent: true, opacity: 0.4, clearcoat: 0.5 });
  group.add(box(w * 0.4, h * 0.12, d * 0.4, hopperMat, 0, h * 0.92, 0));
  // Screen
  group.add(box(w * 0.5, h * 0.15, 0.008, screenMat, 0, h * 0.5, d / 2 + 0.004));
  // Drip tray
  group.add(box(w * 0.45, 0.015, d * 0.25, metalMat, 0, h * 0.12, d * 0.25));
  // Nozzle area
  group.add(box(w * 0.15, h * 0.05, 0.025, metalMat, 0, h * 0.35, d / 2 - 0.01));
  // Chrome accent strip
  group.add(box(w * 0.8, 0.008, 0.005, metalMat, 0, h * 0.65, d / 2 + 0.003));

  return group;
}

// === ATM (upgraded) ===
function createATM(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w, h, d, blueMat, 0, h / 2, 0));
  // Front panel (lighter)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2570b5, roughness: 0.4, metalness: 0.4 });
  group.add(box(w - 0.02, h - 0.06, 0.008, panelMat, 0, h / 2, d / 2 - 0.004));
  // Screen
  group.add(box(w * 0.55, h * 0.22, 0.01, screenMat, 0, h * 0.65, d / 2 + 0.001));
  // Keypad area
  const keypadMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 });
  group.add(box(w * 0.35, h * 0.12, 0.025, keypadMat, 0, h * 0.4, d / 2 + 0.01));
  // Card slot
  group.add(box(0.06, 0.005, 0.03, darkMetal, w * 0.15, h * 0.55, d / 2 + 0.015));
  // Cash dispensr
  group.add(box(w * 0.4, 0.015, 0.04, darkMetal, 0, h * 0.22, d / 2 + 0.01));
  // Brand logo area
  group.add(box(w * 0.5, 0.04, 0.005, whiteMat, 0, h * 0.88, d / 2 + 0.005));
  return group;
}

// === FIRE EXTINGUISHER (upgraded) ===
function createExtinguisher(_w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const r = 0.055;
  // Main cylinder
  const cylGeo = new THREE.CylinderGeometry(r, r * 1.02, h * 0.68, 16);
  const cyl_mesh = new THREE.Mesh(cylGeo, redMat);
  cyl_mesh.position.y = h * 0.34;
  cyl_mesh.castShadow = true;
  group.add(cyl_mesh);
  // Top cone
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r, h * 0.08, 12), redMat).translateY(h * 0.72));
  // Handle assembly
  group.add(box(0.05, 0.06, 0.025, darkMetal, 0, h * 0.78, 0));
  // Lever
  group.add(box(0.04, 0.01, 0.05, metalMat, 0, h * 0.82, 0));
  // Hose
  group.add(cyl(0.006, 0.18, darkMat, 0.03, h * 0.6, 0.015));
  // Nozzle
  group.add(box(0.012, 0.04, 0.012, darkMat, 0.03, h * 0.48, 0.015));
  // Pressure gauge
  group.add(cyl(0.012, 0.008, whiteMat, 0, h * 0.76, r + 0.005, 8));
  // Wall bracket
  group.add(box(0.08, 0.04, 0.005, metalMat, 0, h * 0.65, -r - 0.003));
  return group;
}

// === AUTO SLIDING DOOR (upgraded) ===
function createAutoDoor(w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.25, metalness: 0.7 });

  // Top housing (sensor + mechanism)
  group.add(box(w + 0.08, 0.12, 0.14, frameMat, 0, h + 0.06, 0));
  // Frame posts (tapered)
  group.add(box(0.04, h, 0.06, frameMat, -w / 2, h / 2, 0));
  group.add(box(0.04, h, 0.06, frameMat, w / 2, h / 2, 0));
  // Bottom rail
  group.add(box(w, 0.02, 0.06, frameMat, 0, 0.01, 0));
  // Floor guide
  group.add(box(w * 0.6, 0.005, 0.03, metalMat, 0, 0.003, 0));

  // Glass panels
  const panelW = w / 2 - 0.06;
  group.add(box(panelW, h - 0.18, 0.02, glassMat, -w / 4 - 0.01, h / 2, 0));
  group.add(box(panelW, h - 0.18, 0.02, glassMat, w / 4 + 0.01, h / 2, 0));
  // Glass panel metal handles
  group.add(box(0.22, 0.015, 0.035, brushedMetal, -w / 4 - 0.01, h * 0.45, 0.025));
  group.add(box(0.22, 0.015, 0.035, brushedMetal, w / 4 + 0.01, h * 0.45, 0.025));

  // Sensor LED
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), greenLed).translateX(0).translateY(h + 0.05).translateZ(0.07));

  // Sticker strips on glass (safety)
  const stickerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true, opacity: 0.4 });
  group.add(box(panelW * 0.6, 0.04, 0.001, stickerMat, -w / 4, h * 0.5, 0.012));
  group.add(box(panelW * 0.6, 0.04, 0.001, stickerMat, w / 4, h * 0.5, 0.012));

  return group;
}

// === DOOR (upgraded) ===
function createDoor(w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.55, metalness: 0.05 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3c, roughness: 0.65, metalness: 0.03 });
  const fw = 0.04;

  // Frame
  group.add(box(fw, h, fw, frameMat, -w / 2, h / 2, 0));
  group.add(box(fw, h, fw, frameMat, w / 2, h / 2, 0));
  group.add(box(w, fw, fw, frameMat, 0, h - fw / 2, 0));

  // Door panel with raised panels (2 recessed rectangles)
  const panel = new THREE.Group();
  panel.add(box(w - 0.06, h - 0.06, 0.035, panelMat, (w - 0.06) / 2, h / 2, 0));
  // Raised panel details
  const raisedMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6, metalness: 0.03 });
  panel.add(box(w * 0.6, h * 0.3, 0.005, raisedMat, (w - 0.06) / 2, h * 0.7, 0.02));
  panel.add(box(w * 0.6, h * 0.35, 0.005, raisedMat, (w - 0.06) / 2, h * 0.3, 0.02));

  const pivot = new THREE.Group();
  pivot.position.set(-w / 2 + 0.03, 0, 0);
  pivot.add(panel);
  pivot.rotation.y = -0.2;
  group.add(pivot);

  // Handle (lever type)
  group.add(box(0.08, 0.015, 0.03, metalMat, w * 0.15, h * 0.48, 0.035));
  // Keyhole
  group.add(cyl(0.008, 0.01, metalMat, w * 0.15, h * 0.44, 0.035, 8));

  return group;
}

// === VITRINE (display case, upgraded) ===
function createVitrine(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Base unit
  group.add(box(w, h * 0.28, d, whiteMat, 0, h * 0.14, 0));
  // Glass sides
  group.add(box(w - 0.01, h * 0.65, 0.008, glassMat, 0, h * 0.6, d / 2 - 0.004));
  group.add(box(w - 0.01, h * 0.65, 0.008, whiteMat, 0, h * 0.6, -d / 2 + 0.004));
  group.add(box(0.008, h * 0.65, d, glassMat, -w / 2 + 0.004, h * 0.6, 0));
  group.add(box(0.008, h * 0.65, d, glassMat, w / 2 - 0.004, h * 0.6, 0));
  // Top
  group.add(box(w, 0.015, d, brushedMetal, 0, h * 0.93, 0));
  // Shelves
  const glassShelf = new THREE.MeshPhysicalMaterial({ color: 0xeef8ff, roughness: 0.1, transparent: true, opacity: 0.2, clearcoat: 0.5 });
  for (let i = 1; i < 3; i++) group.add(box(w - 0.03, 0.006, d - 0.03, glassShelf, 0, h * 0.28 + i * h * 0.2, 0));
  // LED inside top
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff5e0, emissiveIntensity: 0.3 });
  group.add(box(w - 0.04, 0.006, 0.015, ledMat, 0, h * 0.92, d / 2 - 0.03));
  return group;
}

// === LCD MONITOR (upgraded) ===
function createLCD(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.6 });
  // Bezel
  group.add(box(w, h, d, bezelMat, 0, h / 2, 0));
  // Screen
  group.add(box(w - 0.03, h - 0.03, 0.003, screenMat, 0, h / 2, d / 2));
  // Wall mount bracket
  group.add(box(0.06, 0.06, 0.03, darkMetal, 0, h / 2, -d / 2 - 0.015));
  return group;
}

// === TOTEM (upgraded) ===
function createTotem(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Base plate
  group.add(box(w * 0.45, 0.03, d * 0.6, darkMetal, 0, 0.015, 0));
  // Pole
  group.add(cyl(0.025, h * 0.4, brushedMetal, 0, h * 0.22, 0));
  // Screen housing
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.15, metalness: 0.5 });
  group.add(box(w, h * 0.5, d * 0.25, bezelMat, 0, h * 0.7, 0));
  // Screen
  group.add(box(w - 0.03, h * 0.45, 0.003, screenMat, 0, h * 0.7, d * 0.125 + 0.001));
  return group;
}

// === SLUSH MACHINE (upgraded) ===
function createSlush(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Base unit
  group.add(box(w, h * 0.35, d, whiteMat, 0, h * 0.175, 0));
  // Two transparent bowls
  const bowl1 = new THREE.MeshPhysicalMaterial({ color: 0xff3344, roughness: 0.1, transparent: true, opacity: 0.35, clearcoat: 0.8 });
  const bowl2 = new THREE.MeshPhysicalMaterial({ color: 0x0099ff, roughness: 0.1, transparent: true, opacity: 0.35, clearcoat: 0.8 });
  group.add(box(w * 0.38, h * 0.45, d * 0.65, bowl1, -w * 0.2, h * 0.6, 0));
  group.add(box(w * 0.38, h * 0.45, d * 0.65, bowl2, w * 0.2, h * 0.6, 0));
  // Top covers
  group.add(box(w * 0.4, 0.02, d * 0.6, whiteMat, -w * 0.2, h * 0.83, 0));
  group.add(box(w * 0.4, 0.02, d * 0.6, whiteMat, w * 0.2, h * 0.83, 0));
  // Tap nozzles
  group.add(box(0.02, 0.06, 0.03, darkMetal, -w * 0.2, h * 0.38, d / 2 - 0.01));
  group.add(box(0.02, 0.06, 0.03, darkMetal, w * 0.2, h * 0.38, d / 2 - 0.01));
  // Drip tray
  group.add(box(w * 0.6, 0.01, 0.06, metalMat, 0, h * 0.36, d / 2 + 0.02));
  return group;
}

// === BAR TABLE ===
function createBarTable(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const topMat = new THREE.MeshStandardMaterial({ color: 0x6b5b4b, roughness: 0.5, metalness: 0.03 });
  // Tabletop
  group.add(box(w, 0.03, d, topMat, 0, h - 0.015, 0));
  // Legs
  const legH = h - 0.04;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(cyl(0.02, legH, brushedMetal, sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06)));
    }
  }
  // Foot rail
  group.add(box(w - 0.1, 0.02, 0.02, brushedMetal, 0, h * 0.25, d / 2 - 0.06));
  return group;
}

// === BAR STOOL ===
function createBarStool(w: number, _h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const seatH = 0.75;
  // Seat (round)
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(w / 2 - 0.02, w / 2 - 0.02, 0.04, 16), fabricMat).translateY(seatH));
  // Central pole
  group.add(cyl(0.02, seatH - 0.05, brushedMetal, 0, seatH / 2 - 0.02, 0));
  // Base (4 feet)
  for (let a = 0; a < 4; a++) {
    const angle = (a / 4) * Math.PI * 2;
    group.add(box(0.15, 0.015, 0.025, brushedMetal, Math.cos(angle) * 0.12, 0.008, Math.sin(angle) * 0.12));
  }
  // Foot rest ring
  group.add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 8, 16), brushedMetal).translateY(0.3).rotateX(Math.PI / 2));
  return group;
}

// === BENCH ===
function createBench(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Seat cushion
  group.add(box(w, 0.08, d, fabricMat, 0, h * 0.45, 0));
  // Back cushion
  group.add(box(w, h * 0.45, 0.06, fabricMat, 0, h * 0.72, -d / 2 + 0.03));
  // Base
  group.add(box(w, h * 0.4, d, darkMat, 0, h * 0.2, 0));
  // Legs
  for (const sx of [-1, 1]) {
    group.add(box(0.04, 0.04, d, brushedMetal, sx * (w / 2 - 0.04), 0.02, 0));
  }
  return group;
}

// === TRASH (selective) ===
function createTrash(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const compartments = w > 0.5 ? 3 : 1;
  const cw = (w - 0.02) / compartments;
  const colors = [0x2980b9, 0xf1c40f, 0x2c3e50]; // plastic, paper, residual
  for (let i = 0; i < compartments; i++) {
    const cx = -w / 2 + 0.01 + cw * i + cw / 2;
    const mat = new THREE.MeshStandardMaterial({ color: colors[i % 3], roughness: 0.5, metalness: 0.1 });
    group.add(box(cw - 0.005, h, d, mat, cx, h / 2, 0));
    // Lid
    group.add(box(cw - 0.01, 0.015, d - 0.01, brushedMetal, cx, h - 0.008, 0));
    // Opening hole
    group.add(box(cw * 0.4, 0.005, d * 0.15, darkMat, cx, h + 0.003, d * 0.15));
  }
  return group;
}

// === GENERIC BOX (better fallback) ===
function createGenericBox(w: number, h: number, d: number, color: string): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 });
  group.add(box(w, h, d, mat, 0, h / 2, 0));
  // Subtle edge highlight
  group.add(box(w + 0.005, 0.01, d + 0.005, brushedMetal, 0, h, 0));
  return group;
}

export function createProceduralModel(item: CatalogItem): THREE.Group {
  const { width: w, height: h, depth: d, id } = item;

  // Rafturi
  if (id.includes('shelf-wall') || id === 'magazine-rack') return createShelfWall(w, h, d);
  if (id.includes('gondola') || id === 'endcap-display') return createGondola(w, h, d);

  // Frigidere
  if (id.includes('fridge-') || id === 'grab-and-go') return createFridge(w, h, d);
  if (id === 'fridge-wall-6door') return createFridge(w, h, d);
  if (id.includes('freezer') || id === 'ice-cream-freezer') return createChestFreezer(w, h, d);

  // Vitrine
  if (id === 'sandwich-display' || id === 'pastry-display' || id === 'heated-display') return createVitrine(w, h, d);

  // Tejghele
  if (id.includes('counter') || id === 'tobacco-display' || id.includes('impulse') || id === 'coffee-corner-table') return createCounter(w, h, d);

  // Food & Cafea
  if (id.includes('coffee-machine')) return createCoffeeMachine(w, h, d);
  if (id === 'coffee-fridge') return createGenericBox(w, h, d, '#b0b0b0');
  if (id === 'microwave-station') return createCoffeeMachine(w, h, d);
  if (id === 'hot-dog-grill') return createVitrine(w, h, d);
  if (id === 'slush-machine') return createSlush(w, h, d);
  if (id === 'juice-machine') return createCoffeeMachine(w, h, d);

  // Tech
  if (id === 'atm' || id === 'self-payment') return createATM(w, h, d);
  if (id === 'promo-totem') return createTotem(w, h, d);
  if (id.includes('lcd-wall')) return createLCD(w, h, d);

  // Uși
  if (id === 'door-auto-double') return createAutoDoor(w, h, d);
  if (id.includes('door-')) return createDoor(w, h, d);

  // Mobilier
  if (id.includes('bar-table')) return createBarTable(w, h, d);
  if (id === 'bar-stool') return createBarStool(w, h, d);
  if (id === 'bench-wall') return createBench(w, h, d);
  if (id.includes('trash')) return createTrash(w, h, d);

  // Siguranță
  if (id === 'fire-extinguisher') return createExtinguisher(w, h, d);

  return createGenericBox(w, h, d, item.color);
}
