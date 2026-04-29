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
