import type { BaseTemplate } from "../types";

const DEFAULT_BOUNDARY: number[][] = [
  [-0.3, -0.3],
  [-0.3, 0.3],
  [0.3, 0.3],
  [0.3, -0.3],
];

export function buildGenericCustomBase(
  location: { lat: number; lng: number; name: string },
  id: "custom" | "custom_location",
): BaseTemplate {
  return {
    id,
    name: id === "custom" ? `Custom (${location.name})` : `Custom: ${location.name}`,
    description: `Custom location at ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`,
    size: "small",
    center_lat: location.lat,
    center_lng: location.lng,
    default_zoom: 15,
    boundary: DEFAULT_BOUNDARY,
    protected_assets: [],
    terrain: [],
    approach_corridors: [],
    max_sensors: 3,
    max_effectors: 2,
    placement_bounds_km: 0.35,
    location_name: location.name,
  };
}
