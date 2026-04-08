/**
 * Coordinate conversion between game x/y (km relative to base center)
 * and lat/lng (WGS84) using equirectangular approximation.
 * Accurate to <0.5% for distances under 20km.
 */

const KM_PER_DEG_LAT = 111.32;

function kmPerDegLng(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

/** Convert game x/y (km, x=east, y=north) to lat/lng */
export function gameXYToLatLng(
  x: number,
  y: number,
  baseLat: number,
  baseLng: number,
): [number, number] {
  const lat = baseLat + y / KM_PER_DEG_LAT;
  const lng = baseLng + x / kmPerDegLng(baseLat);
  return [lat, lng];
}

/** Convert lat/lng to game x/y (km, x=east, y=north) */
export function latLngToGameXY(
  lat: number,
  lng: number,
  baseLat: number,
  baseLng: number,
): { x: number; y: number } {
  const x = (lng - baseLng) * kmPerDegLng(baseLat);
  const y = (lat - baseLat) * KM_PER_DEG_LAT;
  return { x, y };
}

/** Convert a polygon of [x,y] game coords to [lat,lng][] */
export function gamePolygonToLatLng(
  polygon: number[][],
  baseLat: number,
  baseLng: number,
): [number, number][] {
  return polygon.map(([x, y]) => gameXYToLatLng(x, y, baseLat, baseLng));
}

/** Get base center coordinates from a base template, falling back to defaults */
export function getBaseCenter(base: {
  center_lat?: number;
  center_lng?: number;
}): { lat: number; lng: number } {
  return {
    lat: base.center_lat ?? 32.5,
    lng: base.center_lng ?? 45.5,
  };
}
