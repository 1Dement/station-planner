import * as THREE from 'three';
import { CatalogItem } from './catalog';

const metalMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8, metalness: 0.05 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xE8E8E8, roughness: 0.4, metalness: 0.1 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.2 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.3 });
const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5, metalness: 0.3 });
const counterMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.7, metalness: 0.05 });
const blueMat = new THREE.MeshStandardMaterial({ color: 0x1E90FF, roughness: 0.4, metalness: 0.3 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Raft de perete: cadru metalic + polițe din lemn
function createShelfWall(w: number, h: number, d: number, shelfCount: number = 5): THREE.Group {
  const group = new THREE.Group();
  const frameW = 0.03;

  // 2 stâlpi verticali (cadru metalic)
  group.add(box(frameW, h, frameW, metalMat, -w/2 + frameW/2, h/2, 0));
  group.add(box(frameW, h, frameW, metalMat, w/2 - frameW/2, h/2, 0));

  // Polițe
  const shelfH = 0.02;
  for (let i = 0; i < shelfCount; i++) {
    const y = (i / (shelfCount - 1)) * (h - 0.05) + 0.02;
    group.add(box(w, shelfH, d, woodMat, 0, y, 0));
  }

  // Panou spate
  group.add(box(w, h, 0.01, whiteMat, 0, h/2, -d/2 + 0.005));

  return group;
}

// Gondolă dublă: 2 fețe cu polițe, cadru metalic central
function createGondola(w: number, h: number, d: number, shelfCount: number = 4): THREE.Group {
  const group = new THREE.Group();
  const frameW = 0.03;

  // 4 stâlpi la colțuri
  group.add(box(frameW, h, frameW, metalMat, -w/2 + frameW/2, h/2, -d/2 + frameW/2));
  group.add(box(frameW, h, frameW, metalMat, w/2 - frameW/2, h/2, -d/2 + frameW/2));
  group.add(box(frameW, h, frameW, metalMat, -w/2 + frameW/2, h/2, d/2 - frameW/2));
  group.add(box(frameW, h, frameW, metalMat, w/2 - frameW/2, h/2, d/2 - frameW/2));

  // Separator central
  group.add(box(w, h, 0.01, metalMat, 0, h/2, 0));

  // Polițe pe ambele fețe
  const shelfH = 0.02;
  const shelfD = d/2 - 0.02;
  for (let i = 0; i < shelfCount; i++) {
    const y = (i / (shelfCount - 1)) * (h - 0.05) + 0.02;
    group.add(box(w, shelfH, shelfD, woodMat, 0, y, -d/4));
    group.add(box(w, shelfH, shelfD, woodMat, 0, y, d/4));
  }

  // Top header
  group.add(box(w + 0.02, 0.08, d + 0.02, metalMat, 0, h + 0.04, 0));

  return group;
}

// Frigider vertical cu ușă de sticlă
function createFridge(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();

  // Corp
  group.add(box(w, h, d, whiteMat, 0, h/2, 0));

  // Ușă sticlă (față)
  group.add(box(w - 0.04, h - 0.1, 0.02, glassMat, 0, h/2, d/2 - 0.01));

  // Cadru ușă
  group.add(box(0.03, h - 0.05, 0.03, metalMat, -w/2 + 0.015, h/2, d/2));
  group.add(box(0.03, h - 0.05, 0.03, metalMat, w/2 - 0.015, h/2, d/2));
  group.add(box(w, 0.03, 0.03, metalMat, 0, h - 0.03, d/2));
  group.add(box(w, 0.03, 0.03, metalMat, 0, 0.03, d/2));

  // Polițe interioare
  for (let i = 1; i < 5; i++) {
    const y = i * (h / 5);
    group.add(box(w - 0.06, 0.01, d - 0.06, glassMat, 0, y, 0));
  }

  // Mâner
  group.add(box(0.02, 0.3, 0.02, metalMat, w/2 - 0.04, h * 0.6, d/2 + 0.015));

  return group;
}

// Ladă frigorifică
function createChestFreezer(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w, h, d, whiteMat, 0, h/2, 0));
  // Capac sticlă sus
  group.add(box(w - 0.04, 0.02, d - 0.04, glassMat, 0, h - 0.01, 0));
  // Cadru sus
  group.add(box(w, 0.04, 0.04, metalMat, 0, h, -d/2 + 0.02));
  group.add(box(w, 0.04, 0.04, metalMat, 0, h, d/2 - 0.02));
  return group;
}

// Tejghea casă
function createCounter(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Blat
  group.add(box(w, 0.04, d, counterMat, 0, h, 0));
  // Corp
  group.add(box(w, h - 0.04, d, darkMat, 0, (h - 0.04)/2, 0));
  // Față mai deschisă
  group.add(box(w, h - 0.1, 0.01, counterMat, 0, h/2, d/2));
  return group;
}

// Aparat cafea
function createCoffeeMachine(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  // Corp principal
  group.add(box(w, h * 0.7, d, darkMat, 0, h * 0.35, 0));
  // Partea de sus (boabe)
  group.add(box(w * 0.6, h * 0.3, d * 0.6, darkMat, 0, h * 0.85, 0));
  // Zona de dozare
  group.add(box(w * 0.4, h * 0.15, 0.02, metalMat, 0, h * 0.4, d/2));
  // Tavă
  group.add(box(w * 0.5, 0.02, d * 0.3, metalMat, 0, h * 0.15, d * 0.2));
  return group;
}

// ATM / Bancomat
function createATM(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w, h, d, blueMat, 0, h/2, 0));
  // Ecran
  group.add(box(w * 0.6, h * 0.25, 0.01, glassMat, 0, h * 0.65, d/2 + 0.005));
  // Tastatură
  group.add(box(w * 0.5, h * 0.12, 0.03, metalMat, 0, h * 0.4, d/2));
  // Slot card
  group.add(box(0.08, 0.01, 0.04, metalMat, w * 0.15, h * 0.55, d/2 + 0.01));
  return group;
}

// Stingător
function createExtinguisher(_w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const r = 0.06;
  const cylGeo = new THREE.CylinderGeometry(r, r, h * 0.7, 12);
  const cyl = new THREE.Mesh(cylGeo, redMat);
  cyl.position.y = h * 0.35;
  cyl.castShadow = true;
  group.add(cyl);
  // Mâner
  group.add(box(0.06, 0.08, 0.03, darkMat, 0, h * 0.75, 0));
  // Furtun
  group.add(box(0.015, 0.15, 0.015, darkMat, 0.03, h * 0.6, 0.02));
  return group;
}

// Auto sliding glass door (benzinarie style)
function createAutoDoor(w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });
  const glassMatD = new THREE.MeshStandardMaterial({ color: 0x99ccdd, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, side: THREE.DoubleSide });

  // Top beam (sensor housing)
  group.add(box(w + 0.10, 0.15, 0.12, frameMat, 0, h, 0));

  // Frame posts
  group.add(box(0.05, h, 0.06, frameMat, -w/2, h/2, 0));
  group.add(box(0.05, h, 0.06, frameMat, w/2, h/2, 0));

  // Bottom rail
  group.add(box(w, 0.03, 0.08, frameMat, 0, 0.015, 0));

  // 2 glass panels (slightly open = gap in center)
  const panelW = w/2 - 0.08;
  group.add(box(panelW, h - 0.22, 0.03, glassMatD, -w/4 - 0.02, h/2, 0));
  group.add(box(panelW, h - 0.22, 0.03, glassMatD, w/4 + 0.02, h/2, 0));

  // Sensor dot on top
  const sensorMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.5 });
  const sensorGeo = new THREE.SphereGeometry(0.02, 8, 8);
  const sensor = new THREE.Mesh(sensorGeo, sensorMat);
  sensor.position.set(0, h + 0.05, 0.06);
  group.add(sensor);

  // Handle bars (push bar style)
  group.add(box(0.3, 0.02, 0.04, frameMat, -w/4, h * 0.45, 0.04));
  group.add(box(0.3, 0.02, 0.04, frameMat, w/4, h * 0.45, 0.04));

  return group;
}

// Door with frame + panel
function createDoor(w: number, h: number, _d: number): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.6, metalness: 0.1 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7, metalness: 0.05 });
  const fw = 0.05;

  // Frame posts
  group.add(box(fw, h, fw, frameMat, -w/2, h/2, 0));
  group.add(box(fw, h, fw, frameMat, w/2, h/2, 0));
  // Top beam
  group.add(box(w, fw, fw, frameMat, 0, h, 0));

  // Door panel (slightly open - rotated 15°)
  const panel = box(w - 0.06, h - 0.08, 0.04, panelMat, (w-0.06)/2, h/2, 0);
  const pivot = new THREE.Group();
  pivot.position.set(-w/2 + 0.03, 0, 0);
  pivot.add(panel);
  panel.position.x = (w - 0.06) / 2;
  pivot.rotation.y = -0.25; // slightly open
  group.add(pivot);

  // Handle
  group.add(box(0.02, 0.15, 0.03, metalMat, w/4, h * 0.48, 0.04));

  return group;
}

// Generic box (fallback)
function createGenericBox(w: number, h: number, d: number, color: string): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  group.add(box(w, h, d, mat, 0, h/2, 0));
  return group;
}

// Vitrină patiserie/sandvișuri (sticlă curbată)
function createVitrine(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w, h * 0.3, d, whiteMat, 0, h * 0.15, 0)); // baza
  group.add(box(w, h * 0.65, 0.02, glassMat, 0, h * 0.65, d/2 - 0.01)); // sticla fata
  group.add(box(w, h * 0.65, 0.02, whiteMat, 0, h * 0.65, -d/2 + 0.01)); // spate
  group.add(box(0.02, h * 0.65, d, glassMat, -w/2 + 0.01, h * 0.65, 0)); // lateral
  group.add(box(0.02, h * 0.65, d, glassMat, w/2 - 0.01, h * 0.65, 0)); // lateral
  // polite
  for (let i = 1; i < 3; i++) group.add(box(w - 0.04, 0.01, d - 0.04, glassMat, 0, h * 0.3 + i * h * 0.2, 0));
  return group;
}

// Monitor LCD (perete)
function createLCD(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.5 });
  group.add(box(w, h, d, screenMat, 0, h/2, 0));
  // ecran
  const screenGlassMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.05, metalness: 0.0, emissive: 0x112244, emissiveIntensity: 0.3 });
  group.add(box(w - 0.04, h - 0.04, 0.005, screenGlassMat, 0, h/2, d/2));
  return group;
}

// Totem promotional
function createTotem(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.add(box(w * 0.3, h * 0.15, d * 0.5, darkMat, 0, h * 0.075, 0)); // baza
  group.add(box(0.05, h * 0.85, 0.05, metalMat, 0, h * 0.55, 0)); // stalp
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.5 });
  group.add(box(w, h * 0.45, d * 0.3, screenMat, 0, h * 0.75, 0)); // ecran
  return group;
}

// Slush machine
function createSlush(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const slushMat = new THREE.MeshStandardMaterial({ color: 0x00CED1, roughness: 0.3, metalness: 0.1 });
  group.add(box(w, h * 0.4, d, whiteMat, 0, h * 0.2, 0)); // baza
  // 2 cuve transparente
  group.add(box(w * 0.4, h * 0.5, d * 0.7, glassMat, -w * 0.2, h * 0.65, 0));
  group.add(box(w * 0.4, h * 0.5, d * 0.7, slushMat, w * 0.2, h * 0.65, 0));
  group.add(box(w, 0.03, d, metalMat, 0, h * 0.4, 0)); // separator
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
  if (id === 'coffee-fridge') return createGenericBox(w, h, d, '#C0C0C0');
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

  // Siguranță
  if (id === 'fire-extinguisher') return createExtinguisher(w, h, d);

  return createGenericBox(w, h, d, item.color);
}
