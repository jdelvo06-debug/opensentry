import type { ViewshedResult, ViewshedStats } from "./types";

// ─── Viewshed computation ────────────────────────────────────────────────────

export const NUM_RAYS = 72;
export const MAX_RANGE_KM = 15;
export const STEP_KM = 0.15;
export const EARTH_RADIUS_KM = 6371;

export const viewshedCache = new Map<string, ViewshedResult>();

export function cacheKey(lat: number, lng: number, alt: number, rangeKm?: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)},${alt}${rangeKm != null ? `,${rangeKm}` : ''}`;
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function offsetLatLng(
  lat: number,
  lng: number,
  distKm: number,
  bearingRad: number,
): [number, number] {
  const angDist = distKm / EARTH_RADIUS_KM;
  const latR = degToRad(lat);
  const lngR = degToRad(lng);
  const newLat = Math.asin(
    Math.sin(latR) * Math.cos(angDist) +
      Math.cos(latR) * Math.sin(angDist) * Math.cos(bearingRad),
  );
  const newLng =
    lngR +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latR),
      Math.cos(angDist) - Math.sin(latR) * Math.sin(newLat),
    );
  return [radToDeg(newLat), radToDeg(newLng)];
}

export async function fetchElevations(
  points: { latitude: number; longitude: number }[],
): Promise<number[]> {
  const BATCH = 200;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    let retries = 0;
    let resp: Response | null = null;
    let lastError: string | null = null;
    while (retries < 3) {
      try {
        resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: batch }),
        });
        if (resp.ok) break;
        lastError = `HTTP ${resp.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      retries++;
      if (retries < 3) {
        await new Promise((r) => setTimeout(r, 500 * retries)); // Exponential backoff
      }
    }
    if (!resp || !resp.ok) {
      console.error(`[BDA] Elevation API failed after ${retries} retries: ${lastError}`);
      throw new Error(`Elevation API error: ${lastError || 'no response'}`);
    }
    const data = await resp.json();
    for (const r of data.results) {
      results.push(r.elevation);
    }
  }
  return results;
}

export async function computeViewshed(
  lat: number,
  lng: number,
  altitudeM: number,
  rangeKm: number,
): Promise<ViewshedResult> {
  const effectiveRange = Math.min(rangeKm, MAX_RANGE_KM);
  const steps = Math.ceil(effectiveRange / STEP_KM);

  const allPoints: { latitude: number; longitude: number }[] = [
    { latitude: lat, longitude: lng },
  ];
  const rayPoints: { ray: number; step: number; lat: number; lng: number }[] =
    [];

  for (let r = 0; r < NUM_RAYS; r++) {
    const bearing = (r / NUM_RAYS) * 2 * Math.PI;
    for (let s = 1; s <= steps; s++) {
      const dist = s * STEP_KM;
      const [pLat, pLng] = offsetLatLng(lat, lng, dist, bearing);
      allPoints.push({ latitude: pLat, longitude: pLng });
      rayPoints.push({ ray: r, step: s, lat: pLat, lng: pLng });
    }
  }

  const elevations = await fetchElevations(allPoints);
  const centerElev = elevations[0] + altitudeM;

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 1; i < elevations.length; i++) {
    if (elevations[i] < minElev) minElev = elevations[i];
    if (elevations[i] > maxElev) maxElev = elevations[i];
  }

  const visibleEdge: [number, number][] = [];
  const blockedSectors: [number, number][][] = [];
  let totalCells = 0;
  let visibleCells = 0;

  for (let r = 0; r < NUM_RAYS; r++) {
    let maxAngle = -(Math.PI / 2);
    let lastVisible: [number, number] | null = null;
    let firstBlocked: [number, number] | null = null;
    const bearing = (r / NUM_RAYS) * 2 * Math.PI;
    const nextBearing = ((r + 1) / NUM_RAYS) * 2 * Math.PI;

    for (let s = 0; s < steps; s++) {
      totalCells++;
      const idx = 1 + r * steps + s;
      const dist = (s + 1) * STEP_KM;
      const elev = elevations[idx];
      const distM = dist * 1000;
      const angle = Math.atan2(elev - centerElev, distM);

      if (angle >= maxAngle) {
        maxAngle = angle;
        lastVisible = [
          rayPoints[r * steps + s].lat,
          rayPoints[r * steps + s].lng,
        ];
        visibleCells++;
        if (firstBlocked) {
          firstBlocked = null;
        }
      } else {
        if (!firstBlocked) {
          firstBlocked = [
            rayPoints[r * steps + s].lat,
            rayPoints[r * steps + s].lng,
          ];
        }
      }
    }

    if (lastVisible) {
      visibleEdge.push(lastVisible);
    } else {
      visibleEdge.push(offsetLatLng(lat, lng, effectiveRange, bearing));
    }

    if (lastVisible) {
      const lastVisibleDist = Math.sqrt(
        Math.pow((lastVisible[0] - lat) * 111.32, 2) +
          Math.pow(
            (lastVisible[1] - lng) * 111.32 * Math.cos(degToRad(lat)),
            2,
          ),
      );
      if (lastVisibleDist < effectiveRange * 0.95) {
        const sector: [number, number][] = [lastVisible];
        const nextR = (r + 1) % NUM_RAYS;
        const nextRayEnd: [number, number] = [
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lat ?? lat,
          rayPoints[Math.min(nextR * steps + steps - 1, rayPoints.length - 1)]
            ?.lng ?? lng,
        ];
        sector.push(offsetLatLng(lat, lng, effectiveRange, bearing));
        sector.push(offsetLatLng(lat, lng, effectiveRange, nextBearing));
        const nextLastIdx = 1 + nextR * steps + (steps - 1);
        if (nextLastIdx < elevations.length) {
          sector.push(nextRayEnd);
        }
        sector.push(lastVisible);
        if (sector.length >= 4) {
          blockedSectors.push(sector);
        }
      }
    }
  }

  if (visibleEdge.length > 0) {
    visibleEdge.push(visibleEdge[0]);
  }

  const area = computePolygonAreaKm2(visibleEdge);
  const blockedCells = totalCells - visibleCells;
  const coveragePercent =
    totalCells > 0 ? (visibleCells / totalCells) * 100 : 0;

  return {
    polygon: visibleEdge,
    blockedSectors,
    area,
    stats: {
      totalCells,
      visibleCells,
      blockedCells,
      coveragePercent,
      sensorElevation: elevations[0] + altitudeM,
      minElevation: minElev === Infinity ? 0 : minElev,
      maxElevation: maxElev === -Infinity ? 0 : maxElev,
    },
  };
}

export function computePolygonAreaKm2(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const avgLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(degToRad(avgLat));

  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = points[i][1] * kmPerDegLng;
    const y1 = points[i][0] * kmPerDegLat;
    const x2 = points[i + 1][1] * kmPerDegLng;
    const y2 = points[i + 1][0] * kmPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// ─── FOV cone computation ────────────────────────────────────────────────────

export function computeFovCone(
  lat: number,
  lng: number,
  rangeKm: number,
  facingDeg: number,
  fovDeg: number,
): [number, number][] {
  const points: [number, number][] = [[lat, lng]];
  const halfFov = fovDeg / 2;
  const startAngle = facingDeg - halfFov;
  const steps = Math.max(12, Math.ceil(fovDeg));
  for (let i = 0; i <= steps; i++) {
    const angleDeg = startAngle + (i / steps) * fovDeg;
    const bearingRad = degToRad(angleDeg);
    points.push(offsetLatLng(lat, lng, rangeKm, bearingRad));
  }
  points.push([lat, lng]);
  return points;
}
