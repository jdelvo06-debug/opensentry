// ─── Pure geometry helpers (no Leaflet dependency) ──────────────────────────

/** Shoelace formula for polygon area in km² (game XY coordinates) */
export function shoelaceArea(vertices: { x: number; y: number }[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

/** Centroid of a polygon in game XY */
export function verticesCentroid(
  vertices: { x: number; y: number }[],
): { x: number; y: number } {
  const n = vertices.length;
  let cx = 0;
  let cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / n, y: cy / n };
}

/** Centroid of a polygon defined as number[][] */
export function polygonCentroid(polygon: number[][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  const n = polygon.length;
  return [cx / n, cy / n];
}

/** Convert degrees to radians */
export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
