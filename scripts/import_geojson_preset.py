#!/usr/bin/env python3
"""
Import a traced GeoJSON polygon into an existing curated base preset.

Typical workflow:
1. Open the target base in https://geojson.io/
2. Trace the perimeter as a Polygon
3. Save/export the GeoJSON
4. Run:

   python3 scripts/import_geojson_preset.py \
     --preset kunsan_ab \
     --geojson /path/to/kunsan.geojson

The script will:
- derive a new center from the traced polygon centroid
- convert the polygon into the preset's local km coordinates
- shift existing protected assets + terrain polygons so they stay in the same
  real-world place relative to the new center
- update placement_bounds_km automatically
"""

from __future__ import annotations

import argparse
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Iterable, Sequence


ROOT = Path(__file__).resolve().parents[1]
BASES_DIR = ROOT / "frontend" / "public" / "data" / "bases"
KM_PER_DEG_LAT = 110.574


def km_per_deg_lng(lat_deg: float) -> float:
    return 111.320 * math.cos(math.radians(lat_deg))


def local_to_geo(x_km: float, y_km: float, center_lat: float, center_lng: float) -> tuple[float, float]:
    lat = center_lat + (y_km / KM_PER_DEG_LAT)
    lng = center_lng + (x_km / km_per_deg_lng(center_lat))
    return lat, lng


def geo_to_local(lat: float, lng: float, center_lat: float, center_lng: float) -> tuple[float, float]:
    x_km = (lng - center_lng) * km_per_deg_lng(center_lat)
    y_km = (lat - center_lat) * KM_PER_DEG_LAT
    return x_km, y_km


def resolve_preset_path(value: str) -> Path:
    candidate = Path(value)
    if candidate.exists():
        return candidate.resolve()
    json_candidate = BASES_DIR / f"{value}.json"
    if json_candidate.exists():
        return json_candidate
    raise FileNotFoundError(f"Preset not found: {value}")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def ensure_lon_lat_pairs(ring: Sequence[Sequence[float]]) -> list[tuple[float, float]]:
    coords = [(float(lon), float(lat)) for lon, lat in ring]
    if len(coords) >= 2 and coords[0] == coords[-1]:
        coords = coords[:-1]
    if len(coords) < 3:
        raise ValueError("Polygon ring must contain at least 3 unique points")
    return coords


def polygon_area_lonlat(points: Sequence[tuple[float, float]]) -> float:
    area = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def polygon_centroid_lonlat(points: Sequence[tuple[float, float]]) -> tuple[float, float]:
    area = polygon_area_lonlat(points)
    if abs(area) < 1e-9:
        mean_lon = sum(lon for lon, _ in points) / len(points)
        mean_lat = sum(lat for _, lat in points) / len(points)
        return mean_lon, mean_lat

    factor = 1.0 / (6.0 * area)
    cx = 0.0
    cy = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return cx * factor, cy * factor


def iter_polygons(geojson: dict) -> Iterable[list[tuple[float, float]]]:
    geo_type = geojson.get("type")

    if geo_type == "FeatureCollection":
        for feature in geojson.get("features", []):
            yield from iter_polygons(feature)
        return

    if geo_type == "Feature":
        geometry = geojson.get("geometry") or {}
        yield from iter_polygons(geometry)
        return

    if geo_type == "Polygon":
        coords = geojson.get("coordinates") or []
        if not coords:
            return
        yield ensure_lon_lat_pairs(coords[0])
        return

    if geo_type == "MultiPolygon":
        for polygon in geojson.get("coordinates") or []:
            if polygon:
                yield ensure_lon_lat_pairs(polygon[0])
        return

    raise ValueError(f"Unsupported GeoJSON type: {geo_type}")


def load_primary_polygon(path: Path) -> list[tuple[float, float]]:
    data = load_json(path)
    polygons = list(iter_polygons(data))
    if not polygons:
        raise ValueError(f"No polygon found in {path}")
    return max(polygons, key=lambda pts: abs(polygon_area_lonlat(pts)))


def rebase_local_point(
    x_km: float,
    y_km: float,
    old_center_lat: float,
    old_center_lng: float,
    new_center_lat: float,
    new_center_lng: float,
) -> tuple[float, float]:
    abs_lat, abs_lng = local_to_geo(x_km, y_km, old_center_lat, old_center_lng)
    return geo_to_local(abs_lat, abs_lng, new_center_lat, new_center_lng)


def round_point(point: tuple[float, float], places: int = 2) -> list[float]:
    return [round(point[0], places), round(point[1], places)]


def update_assets(
    assets: list[dict],
    old_center_lat: float,
    old_center_lng: float,
    new_center_lat: float,
    new_center_lng: float,
) -> list[dict]:
    updated = []
    for asset in assets:
        copy = deepcopy(asset)
        copy["x"], copy["y"] = round_point(
            rebase_local_point(
                float(asset["x"]),
                float(asset["y"]),
                old_center_lat,
                old_center_lng,
                new_center_lat,
                new_center_lng,
            ),
            places=2,
        )
        updated.append(copy)
    return updated


def update_terrain(
    terrain_items: list[dict],
    old_center_lat: float,
    old_center_lng: float,
    new_center_lat: float,
    new_center_lng: float,
) -> list[dict]:
    updated = []
    for item in terrain_items:
        copy = deepcopy(item)
        new_polygon = []
        for x_km, y_km in item.get("polygon", []):
            new_polygon.append(
                round_point(
                    rebase_local_point(
                        float(x_km),
                        float(y_km),
                        old_center_lat,
                        old_center_lng,
                        new_center_lat,
                        new_center_lng,
                    ),
                    places=2,
                )
            )
        copy["polygon"] = new_polygon
        updated.append(copy)
    return updated


def compute_placement_bounds(boundary: Sequence[Sequence[float]]) -> float:
    max_extent = max(max(abs(float(x)), abs(float(y))) for x, y in boundary)
    return round(max_extent * 1.05, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import traced GeoJSON into an OpenSentry preset")
    parser.add_argument("--preset", required=True, help="Preset id (e.g. kunsan_ab) or path to preset JSON")
    parser.add_argument("--geojson", required=True, help="Path to a GeoJSON file containing a traced polygon")
    parser.add_argument("--output", help="Optional output path; defaults to updating the preset in place")
    args = parser.parse_args()

    preset_path = resolve_preset_path(args.preset)
    output_path = Path(args.output).resolve() if args.output else preset_path

    preset = load_json(preset_path)
    polygon_lonlat = load_primary_polygon(Path(args.geojson).resolve())
    centroid_lng, centroid_lat = polygon_centroid_lonlat(polygon_lonlat)

    old_center_lat = float(preset["center_lat"])
    old_center_lng = float(preset["center_lng"])
    new_center_lat = centroid_lat
    new_center_lng = centroid_lng

    new_boundary = [
        round_point(geo_to_local(lat, lng, new_center_lat, new_center_lng), places=2)
        for lng, lat in polygon_lonlat
    ]

    updated = deepcopy(preset)
    updated["center_lat"] = round(new_center_lat, 6)
    updated["center_lng"] = round(new_center_lng, 6)
    updated["boundary"] = new_boundary
    updated["placement_bounds_km"] = compute_placement_bounds(new_boundary)

    if "protected_assets" in preset:
        updated["protected_assets"] = update_assets(
            preset["protected_assets"],
            old_center_lat,
            old_center_lng,
            new_center_lat,
            new_center_lng,
        )

    if "terrain" in preset:
        updated["terrain"] = update_terrain(
            preset["terrain"],
            old_center_lat,
            old_center_lng,
            new_center_lat,
            new_center_lng,
        )

    output_path.write_text(json.dumps(updated, indent=2) + "\n")

    print(f"Updated preset: {output_path}")
    print(f"New center: {updated['center_lat']}, {updated['center_lng']}")
    print(f"Boundary points: {len(updated['boundary'])}")
    print(f"placement_bounds_km: {updated['placement_bounds_km']}")


if __name__ == "__main__":
    main()
