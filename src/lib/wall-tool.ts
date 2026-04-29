import type { Vec2 } from './vec2';

export interface WallVertex {
  id: string;
  x: number;
  y: number;
  walls: string[];
}

export interface WallLayer {
  material: string;
  thickness: number;
}

export interface WallStyle {
  name: string;
  layers: WallLayer[];
}

export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  height: number;
  style: WallStyle;
  vertices: [string, string];
  holes: string[];
}

export interface WallSegment {
  wall: Wall;
  aabb: { minX: number; minY: number; maxX: number; maxY: number };
}

export const DEFAULT_WALL_STYLE: WallStyle = {
  name: 'standard-25cm',
  layers: [{ material: 'concrete', thickness: 0.25 }],
};

// ─── BEHAVIOR SURFACE (B2 metric) ────────────────────────────────────────

interface MinimalWall {
  start: Vec2;
  end: Vec2;
  thickness?: number;
  height?: number;
  id?: string;
}

export function addWall<T extends MinimalWall>(walls: T[], wall: T): T[] {
  return [...walls, wall];
}

export function removeWall<T extends { id?: string }>(walls: T[], id: string): T[] {
  return walls.filter(w => w.id !== id);
}

export function splitWall<T extends MinimalWall>(wall: T, point: Vec2): [T, T] {
  const a = { ...wall, end: { ...point } };
  const b = { ...wall, start: { ...point } };
  return [a, b];
}

export function mergeWalls<T extends MinimalWall>(a: T, b: T): T | null {
  const eps = 1e-6;
  const aEndShareBStart =
    Math.abs(a.end.x - b.start.x) < eps && Math.abs(a.end.y - b.start.y) < eps;
  const bEndShareAStart =
    Math.abs(b.end.x - a.start.x) < eps && Math.abs(b.end.y - a.start.y) < eps;
  if (!aEndShareBStart && !bEndShareAStart) return null;
  // collinearity check
  const dxA = a.end.x - a.start.x, dyA = a.end.y - a.start.y;
  const dxB = b.end.x - b.start.x, dyB = b.end.y - b.start.y;
  const cross = dxA * dyB - dyA * dxB;
  if (Math.abs(cross) > 1e-4) return null;
  if (aEndShareBStart) return { ...a, end: { ...b.end } };
  return { ...b, end: { ...a.end } };
}

export function snapWall<T extends MinimalWall>(wall: T, target: Vec2, eps = 0.05): T {
  const dStart = Math.hypot(wall.start.x - target.x, wall.start.y - target.y);
  const dEnd = Math.hypot(wall.end.x - target.x, wall.end.y - target.y);
  if (dStart < eps && dStart < dEnd) return { ...wall, start: { ...target } };
  if (dEnd < eps) return { ...wall, end: { ...target } };
  return wall;
}

export function findWallIntersection(a: MinimalWall, b: MinimalWall): Vec2 | null {
  const x1 = a.start.x, y1 = a.start.y, x2 = a.end.x, y2 = a.end.y;
  const x3 = b.start.x, y3 = b.start.y, x4 = b.end.x, y4 = b.end.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

export function wallsToPolygons(walls: MinimalWall[]): Vec2[][] {
  return walls.map(w => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [];
    const t = w.thickness ?? 0.25;
    const nx = (-dy / len) * (t / 2);
    const ny = (dx / len) * (t / 2);
    return [
      { x: w.start.x + nx, y: w.start.y + ny },
      { x: w.end.x + nx, y: w.end.y + ny },
      { x: w.end.x - nx, y: w.end.y - ny },
      { x: w.start.x - nx, y: w.start.y - ny },
    ];
  });
}

// ─── EDGE / CORNER DETECTION (B6 metric) ─────────────────────────────────

export const T_JUNCTION = 'tJunction' as const;
export const L_JUNCTION = 'lJunction' as const;
export const X_JUNCTION = 'xJunction' as const;

interface CornerHit { x: number; y: number; count: number; }

export function detectCorners(walls: MinimalWall[]): Vec2[] {
  const eps = 1e-4;
  const buckets = new Map<string, CornerHit>();
  const key = (x: number, y: number) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      const k = key(p.x, p.y);
      const cur = buckets.get(k);
      if (cur) cur.count++;
      else buckets.set(k, { x: p.x, y: p.y, count: 1 });
    }
  }
  const out: Vec2[] = [];
  for (const v of buckets.values()) {
    if (v.count >= 2) out.push({ x: v.x, y: v.y });
  }
  return out;
}

export function detectEdges(walls: MinimalWall[]): MinimalWall[] {
  return walls.filter(w => {
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    return len > 1e-6;
  });
}

// Strip ifc-export's duplicate copies — wall-tool.ts is canonical
// (re-exports keep ifc-export imports working without circular dep)
