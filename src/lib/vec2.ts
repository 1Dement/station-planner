export interface Vec2 { x: number; y: number; }

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v2add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const v2sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const v2mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const v2dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const v2len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const v2dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const v2norm = (a: Vec2): Vec2 => {
  const l = v2len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const v2eq = (a: Vec2, b: Vec2, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
