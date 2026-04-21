import type {
  BaseTemplate,
  PlacementConfig,
  PlacedEquipment,
  ProtectedAsset,
  TerrainFeature,
} from "../types";
import { gameXYToLatLng } from "./coordinates";

const DEFAULT_BASE_LAT = 32.5;
const DEFAULT_BASE_LNG = 45.5;
const CENTER_EPSILON_KM = 0.001;
const OPERATIONAL_CENTER_THRESHOLD_KM = 0.5;

function centroid(points: number[][]): [number, number] {
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  return [sumX / points.length, sumY / points.length];
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function translatePolygon(points: number[][], dx: number, dy: number): number[][] {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

function translatePlaced(items: PlacedEquipment[], dx: number, dy: number): PlacedEquipment[] {
  return items.map((item) => ({
    ...item,
    x: item.x + dx,
    y: item.y + dy,
  }));
}

function translateAssets(assets: ProtectedAsset[], dx: number, dy: number): ProtectedAsset[] {
  return assets.map((asset) => ({
    ...asset,
    x: asset.x + dx,
    y: asset.y + dy,
  }));
}

function translateTerrain(terrain: TerrainFeature[], dx: number, dy: number): TerrainFeature[] {
  return terrain.map((feature) => ({
    ...feature,
    polygon: translatePolygon(feature.polygon, dx, dy),
  }));
}

function assetCentroid(assets: ProtectedAsset[]): [number, number] {
  let sumX = 0;
  let sumY = 0;
  for (const asset of assets) {
    sumX += asset.x;
    sumY += asset.y;
  }
  return [sumX / assets.length, sumY / assets.length];
}

function terrainCentroid(terrain: TerrainFeature[]): [number, number] | null {
  const points: number[][] = [];
  for (const feature of terrain) {
    for (const point of feature.polygon) {
      points.push(point);
    }
  }
  return points.length ? centroid(points) : null;
}

function runwayFirstTerrainCentroid(terrain: TerrainFeature[]): [number, number] | null {
  const runwayPoints: number[][] = [];
  for (const feature of terrain) {
    if (feature.type !== "runway") continue;
    for (const point of feature.polygon) {
      runwayPoints.push(point);
    }
  }
  if (runwayPoints.length) return centroid(runwayPoints);
  return terrainCentroid(terrain);
}

function operationalAnchor(
  assets: ProtectedAsset[],
  terrain: TerrainFeature[],
  boundary: number[][],
): [number, number] {
  const terrainCenter = runwayFirstTerrainCentroid(terrain);
  if (terrainCenter) return terrainCenter;
  if (assets.length > 0) return assetCentroid(assets);
  return centroid(boundary);
}

function applyMovedAssets(
  assets: ProtectedAsset[],
  movedAssets: PlacementConfig["moved_assets"],
): ProtectedAsset[] {
  if (!movedAssets?.length) return assets;
  const movedById = new Map(movedAssets.map((asset) => [asset.id, asset]));
  return assets.map((asset) => {
    const moved = movedById.get(asset.id);
    return moved ? { ...asset, x: moved.x, y: moved.y } : asset;
  });
}

export function isPolygonDrivenCustomBase(baseTemplate: BaseTemplate): boolean {
  return isCustomBaseTemplate(baseTemplate) || Boolean(baseTemplate.location_name);
}

export function stripCustomBaseScaffold(baseTemplate: BaseTemplate): BaseTemplate {
  if (!isPolygonDrivenCustomBase(baseTemplate)) return baseTemplate;
  return {
    ...baseTemplate,
    protected_assets: [],
    terrain: [],
  };
}

export function isCustomBaseTemplate(baseTemplate: BaseTemplate): boolean {
  return (
    baseTemplate.id === "custom" ||
    baseTemplate.id === "custom_location" ||
    baseTemplate.name.startsWith("Custom:")
  );
}

export function recenterCustomBase(
  baseTemplate: BaseTemplate,
  placement: PlacementConfig,
): { baseTemplate: BaseTemplate; placement: PlacementConfig } {
  if (!placement.boundary || placement.boundary.length < 3) {
    return { baseTemplate, placement };
  }
  if (isPolygonDrivenCustomBase(baseTemplate)) {
    const [centerX, centerY] = centroid(placement.boundary);
    if (Math.hypot(centerX, centerY) < CENTER_EPSILON_KM) {
      const strippedBaseTemplate = stripCustomBaseScaffold(baseTemplate);
      return {
        baseTemplate: {
          ...strippedBaseTemplate,
          boundary: placement.boundary,
        },
        placement: {
          ...placement,
          moved_assets: undefined,
        },
      };
    }

    const baseLat = baseTemplate.center_lat ?? DEFAULT_BASE_LAT;
    const baseLng = baseTemplate.center_lng ?? DEFAULT_BASE_LNG;
    const [centerLat, centerLng] = gameXYToLatLng(centerX, centerY, baseLat, baseLng);
    const offsetX = -centerX;
    const offsetY = -centerY;
    const recenteredBoundary = translatePolygon(placement.boundary, offsetX, offsetY);

    return {
      baseTemplate: {
        ...stripCustomBaseScaffold(baseTemplate),
        center_lat: centerLat,
        center_lng: centerLng,
        boundary: recenteredBoundary,
      },
      placement: {
        ...placement,
        boundary: recenteredBoundary,
        sensors: translatePlaced(placement.sensors, offsetX, offsetY),
        effectors: translatePlaced(placement.effectors, offsetX, offsetY),
        combined: translatePlaced(placement.combined, offsetX, offsetY),
        moved_assets: undefined,
      },
    };
  }
  const assetsAtPlacedPositions = applyMovedAssets(
    baseTemplate.protected_assets,
    placement.moved_assets,
  );
  const [anchorX, anchorY] = operationalAnchor(
    assetsAtPlacedPositions,
    baseTemplate.terrain,
    placement.boundary,
  );

  if (Math.hypot(anchorX, anchorY) < OPERATIONAL_CENTER_THRESHOLD_KM) {
    return { baseTemplate, placement };
  }

  const baseLat = baseTemplate.center_lat ?? DEFAULT_BASE_LAT;
  const baseLng = baseTemplate.center_lng ?? DEFAULT_BASE_LNG;
  const [centerLat, centerLng] = gameXYToLatLng(anchorX, anchorY, baseLat, baseLng);
  const offsetX = -anchorX;
  const offsetY = -anchorY;
  const movedAssetsRelativeToNewCenter = placement.moved_assets?.map((asset) => ({
    ...asset,
    x: asset.x + offsetX,
    y: asset.y + offsetY,
  }));
  const terrainRelativeToNewCenter = translateTerrain(baseTemplate.terrain, offsetX, offsetY);

  return {
    baseTemplate: {
      ...baseTemplate,
      center_lat: centerLat,
      center_lng: centerLng,
      boundary: translatePolygon(placement.boundary, offsetX, offsetY),
      protected_assets: translateAssets(assetsAtPlacedPositions, offsetX, offsetY),
      terrain: terrainRelativeToNewCenter,
    },
    placement: {
      ...placement,
      boundary: translatePolygon(placement.boundary, offsetX, offsetY),
      sensors: translatePlaced(placement.sensors, offsetX, offsetY),
      effectors: translatePlaced(placement.effectors, offsetX, offsetY),
      combined: translatePlaced(placement.combined, offsetX, offsetY),
      moved_assets: movedAssetsRelativeToNewCenter,
    },
  };
}

export function normalizeLoadedBaseTemplate(baseTemplate: BaseTemplate): BaseTemplate {
  if (!baseTemplate.boundary || baseTemplate.boundary.length < 3) {
    return stripCustomBaseScaffold(baseTemplate);
  }

  if (isPolygonDrivenCustomBase(baseTemplate)) {
    const strippedBaseTemplate = stripCustomBaseScaffold(baseTemplate);
    const [centerX, centerY] = centroid(strippedBaseTemplate.boundary);
    if (Math.abs(centerX) < CENTER_EPSILON_KM && Math.abs(centerY) < CENTER_EPSILON_KM) {
      return strippedBaseTemplate;
    }

    const baseLat = strippedBaseTemplate.center_lat ?? DEFAULT_BASE_LAT;
    const baseLng = strippedBaseTemplate.center_lng ?? DEFAULT_BASE_LNG;
    const [centerLat, centerLng] = gameXYToLatLng(centerX, centerY, baseLat, baseLng);
    const offsetX = -centerX;
    const offsetY = -centerY;

    return {
      ...strippedBaseTemplate,
      center_lat: centerLat,
      center_lng: centerLng,
      boundary: translatePolygon(strippedBaseTemplate.boundary, offsetX, offsetY),
    };
  }

  const [centerX, centerY] = centroid(baseTemplate.boundary);
  const originInsideBoundary = pointInPolygon([0, 0], baseTemplate.boundary);
  const shouldNormalize =
    !originInsideBoundary &&
    (Math.abs(centerX) >= CENTER_EPSILON_KM || Math.abs(centerY) >= CENTER_EPSILON_KM);

  let normalizedBaseTemplate = baseTemplate;

  if (shouldNormalize) {
    const baseLat = baseTemplate.center_lat ?? DEFAULT_BASE_LAT;
    const baseLng = baseTemplate.center_lng ?? DEFAULT_BASE_LNG;
    const [centerLat, centerLng] = gameXYToLatLng(centerX, centerY, baseLat, baseLng);
    const offsetX = -centerX;
    const offsetY = -centerY;

    normalizedBaseTemplate = {
      ...baseTemplate,
      center_lat: centerLat,
      center_lng: centerLng,
      boundary: translatePolygon(baseTemplate.boundary, offsetX, offsetY),
      protected_assets: translateAssets(baseTemplate.protected_assets, offsetX, offsetY),
      terrain: translateTerrain(baseTemplate.terrain, offsetX, offsetY),
    };
  }

  if (!normalizedBaseTemplate.protected_assets.length) {
    return normalizedBaseTemplate;
  }

  const outsideCount = normalizedBaseTemplate.protected_assets.filter(
    (asset) => !pointInPolygon([asset.x, asset.y], normalizedBaseTemplate.boundary),
  ).length;
  const [boundaryCx, boundaryCy] = centroid(normalizedBaseTemplate.boundary);
  const [assetCx, assetCy] = assetCentroid(normalizedBaseTemplate.protected_assets);
  const assetOffsetMagnitude = Math.hypot(assetCx, assetCy);

  if (
    outsideCount > normalizedBaseTemplate.protected_assets.length / 2 &&
    assetOffsetMagnitude > 1
  ) {
    const shiftX = boundaryCx - assetCx;
    const shiftY = boundaryCy - assetCy;
    return {
      ...normalizedBaseTemplate,
      protected_assets: translateAssets(normalizedBaseTemplate.protected_assets, shiftX, shiftY),
      terrain: translateTerrain(normalizedBaseTemplate.terrain, shiftX, shiftY),
    };
  }
  const [anchorX, anchorY] = operationalAnchor(
    normalizedBaseTemplate.protected_assets,
    normalizedBaseTemplate.terrain,
    normalizedBaseTemplate.boundary,
  );

  if (Math.hypot(anchorX, anchorY) < OPERATIONAL_CENTER_THRESHOLD_KM) {
    return normalizedBaseTemplate;
  }

  const baseLat = normalizedBaseTemplate.center_lat ?? DEFAULT_BASE_LAT;
  const baseLng = normalizedBaseTemplate.center_lng ?? DEFAULT_BASE_LNG;
  const [centerLat, centerLng] = gameXYToLatLng(anchorX, anchorY, baseLat, baseLng);
  const offsetX = -anchorX;
  const offsetY = -anchorY;

  return {
    ...normalizedBaseTemplate,
    center_lat: centerLat,
    center_lng: centerLng,
    boundary: translatePolygon(normalizedBaseTemplate.boundary, offsetX, offsetY),
    protected_assets: translateAssets(normalizedBaseTemplate.protected_assets, offsetX, offsetY),
    terrain: translateTerrain(normalizedBaseTemplate.terrain, offsetX, offsetY),
  };
}
