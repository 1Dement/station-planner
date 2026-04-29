import type { Vec2 } from './vec2';

export const SNAP_ENDPOINT      = 'endpoint' as const;
export const SNAP_MIDPOINT      = 'midpoint' as const;
export const SNAP_PERPENDICULAR = 'perpendicular' as const;
export const SNAP_PARALLEL      = 'parallel' as const;
export const SNAP_GRID          = 'grid' as const;

export type SnapMode =
  | typeof SNAP_ENDPOINT
  | typeof SNAP_MIDPOINT
  | typeof SNAP_PERPENDICULAR
  | typeof SNAP_PARALLEL
  | typeof SNAP_GRID;

export interface SnapHit {
  point: Vec2;
  mode: SnapMode;
  distance: number;
}

interface Segment { start: Vec2; end: Vec2; }

const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function snapToEndpoint(p: Vec2, segments: Segment[], tolerance = 0.5): SnapHit | null {
  let best: SnapHit | null = null;
  const tol2 = tolerance * tolerance;
  for (const s of segments) {
    for (const v of [s.start, s.end]) {
      const d2 = dist2(p, v);
      if (d2 < tol2 && (!best || d2 < best.distance * best.distance)) {
        best = { point: { ...v }, mode: SNAP_ENDPOINT, distance: Math.sqrt(d2) };
      }
    }
  }
  return best;
}

export function snapToMidpoint(p: Vec2, segments: Segment[], tolerance = 0.5): SnapHit | null {
  let best: SnapHit | null = null;
  const tol2 = tolerance * tolerance;
  for (const s of segments) {
    const m: Vec2 = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 };
    const d2 = dist2(p, m);
    if (d2 < tol2 && (!best || d2 < best.distance * best.distance)) {
      best = { point: m, mode: SNAP_MIDPOINT, distance: Math.sqrt(d2) };
    }
  }
  return best;
}

export function snapToPerpendicular(p: Vec2, segments: Segment[], tolerance = 0.5): SnapHit | null {
  let best: SnapHit | null = null;
  const tol2 = tolerance * tolerance;
  for (const s of segments) {
    const dx = s.end.x - s.start.x;
    const dy = s.end.y - s.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t = ((p.x - s.start.x) * dx + (p.y - s.start.y) * dy) / len2;
    if (t < 0 || t > 1) continue;
    const foot: Vec2 = { x: s.start.x + t * dx, y: s.start.y + t * dy };
    const d2 = dist2(p, foot);
    if (d2 < tol2 && (!best || d2 < best.distance * best.distance)) {
      best = { point: foot, mode: SNAP_PERPENDICULAR, distance: Math.sqrt(d2) };
    }
  }
  return best;
}

export function snapToParallel(
  p: Vec2,
  cursorOrigin: Vec2,
  segments: Segment[],
  angleToleranceRad = 0.0873, // ~5°
): SnapHit | null {
  const cdx = p.x - cursorOrigin.x;
  const cdy = p.y - cursorOrigin.y;
  const cLen = Math.hypot(cdx, cdy);
  if (cLen < 1e-9) return null;
  const cAngle = Math.atan2(cdy, cdx);
  let best: SnapHit | null = null;
  for (const s of segments) {
    const dx = s.end.x - s.start.x;
    const dy = s.end.y - s.start.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-9) continue;
    const segAngle = Math.atan2(dy, dx);
    const diff = Math.abs(((cAngle - segAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const aligned = Math.min(diff, Math.PI - diff);
    if (aligned < angleToleranceRad) {
      const projected: Vec2 = {
        x: cursorOrigin.x + Math.cos(segAngle) * cLen,
        y: cursorOrigin.y + Math.sin(segAngle) * cLen,
      };
      const d = Math.hypot(projected.x - p.x, projected.y - p.y);
      if (!best || d < best.distance) {
        best = { point: projected, mode: SNAP_PARALLEL, distance: d };
      }
    }
  }
  return best;
}

export function snapToGrid(p: Vec2, gridSize = 0.1): SnapHit {
  const snapped: Vec2 = {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
  return { point: snapped, mode: SNAP_GRID, distance: Math.hypot(p.x - snapped.x, p.y - snapped.y) };
}

export function snap(
  p: Vec2,
  segments: Segment[],
  enabled: ReadonlySet<SnapMode> = new Set([SNAP_ENDPOINT, SNAP_MIDPOINT, SNAP_GRID]),
  tolerance = 0.5,
  cursorOrigin?: Vec2,
): SnapHit | null {
  const candidates: (SnapHit | null)[] = [];
  if (enabled.has(SNAP_ENDPOINT)) candidates.push(snapToEndpoint(p, segments, tolerance));
  if (enabled.has(SNAP_MIDPOINT)) candidates.push(snapToMidpoint(p, segments, tolerance));
  if (enabled.has(SNAP_PERPENDICULAR)) candidates.push(snapToPerpendicular(p, segments, tolerance));
  if (enabled.has(SNAP_PARALLEL) && cursorOrigin) {
    candidates.push(snapToParallel(p, cursorOrigin, segments));
  }
  if (enabled.has(SNAP_GRID)) candidates.push(snapToGrid(p));
  // Priority order: endpoint > midpoint > perpendicular > parallel > grid
  // Within enabled, closest hit wins
  return candidates
    .filter((h): h is SnapHit => h !== null)
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}
