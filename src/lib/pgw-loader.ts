export interface PGWGeoref {
  pixelSizeX: number;
  rotationY: number;
  rotationX: number;
  pixelSizeY: number;
  originX: number;
  originY: number;
}

export function loadPGW(text: string): PGWGeoref {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 6) {
    throw new Error(`PGW must have 6 numeric lines, got ${lines.length}`);
  }
  const nums = lines.slice(0, 6).map(parseFloat);
  if (nums.some(n => Number.isNaN(n))) {
    throw new Error('PGW contains non-numeric lines');
  }
  return {
    pixelSizeX: nums[0],
    rotationY: nums[1],
    rotationX: nums[2],
    pixelSizeY: nums[3],
    originX: nums[4],
    originY: nums[5],
  };
}

export function pixelToWorld(geo: PGWGeoref, col: number, row: number): { x: number; y: number } {
  return {
    x: geo.pixelSizeX * col + geo.rotationY * row + geo.originX,
    y: geo.rotationX * col + geo.pixelSizeY * row + geo.originY,
  };
}

export function worldExtent(geo: PGWGeoref, widthPx: number, heightPx: number): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  const corners = [
    pixelToWorld(geo, 0, 0),
    pixelToWorld(geo, widthPx, 0),
    pixelToWorld(geo, 0, heightPx),
    pixelToWorld(geo, widthPx, heightPx),
  ];
  return {
    minX: Math.min(...corners.map(c => c.x)),
    minY: Math.min(...corners.map(c => c.y)),
    maxX: Math.max(...corners.map(c => c.x)),
    maxY: Math.max(...corners.map(c => c.y)),
  };
}
