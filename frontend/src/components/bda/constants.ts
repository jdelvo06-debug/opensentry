// frontend/src/components/bda/constants.ts
import type { EquipmentCatalog } from "../../types";
import type { SystemDef } from "./types";

export const SHAW_AFB = { lat: 33.9722, lng: -80.4756 };
export const DEFAULT_ZOOM = 14;

export const COLORS = {
  bg: "#0a0e1a",
  card: "#0f1520",
  border: "#1a2235",
  text: "#e6edf3",
  muted: "#6b7b8d",
  accent: "#00d4ff",
  danger: "#ff4d4d",
  warning: "#d29922",
  success: "#3fb950",
  purple: "#a371f7",
};

export const TYPE_COLORS: Record<string, string> = {
  radar: "#388bfd",
  eoir: "#e3b341",
  electronic: "#00bfbf",
  kinetic: "#f85149",
  rf: "#bc8cff",
  shenobi_pm: "#bc8cff",
  directed_energy: "#ff6a00",
  de_laser: "#ff6a00",
  de_hpm: "#00d4ff",
};

export interface AltitudeBand {
  label: string;
  color: string;
  icon: string;
  presets: { value: number; label: string }[];
}

export const ALTITUDE_BANDS: AltitudeBand[] = [
  {
    label: "LOW",
    color: "#3fb950",
    icon: "🟢",
    presets: [
      { value: 2, label: "2m" },
      { value: 10, label: "10m" },
      { value: 25, label: "25m" },
      { value: 50, label: "50m" },
    ],
  },
  {
    label: "MED",
    color: "#d29922",
    icon: "🟡",
    presets: [
      { value: 100, label: "100m" },
      { value: 200, label: "200m" },
      { value: 300, label: "300m" },
    ],
  },
  {
    label: "HIGH",
    color: "#f85149",
    icon: "🔴",
    presets: [
      { value: 500, label: "500m" },
      { value: 1000, label: "1km" },
      { value: 2000, label: "2km" },
    ],
  },
];

export function getAltitudeBand(altM: number): AltitudeBand {
  if (altM <= 50) return ALTITUDE_BANDS[0];
  if (altM <= 300) return ALTITUDE_BANDS[1];
  return ALTITUDE_BANDS[2];
}

export function getAltitudeBandLabel(altM: number): string {
  const band = getAltitudeBand(altM);
  if (band.label === "LOW") return "Ground vehicles / low drones";
  if (band.label === "MED") return "Tactical drones / helicopters";
  return "Fixed-wing / high-altitude";
}

export function buildSystemDefs(catalog: EquipmentCatalog): SystemDef[] {
  const defs: SystemDef[] = [];

  for (const s of catalog.sensors) {
    defs.push({
      id: s.catalog_id,
      name: s.name,
      category: "sensor",
      type: s.type,
      range_km: s.range_km,
      fov_deg: s.fov_deg,
      color: TYPE_COLORS[s.type] || COLORS.muted,
      letter: s.catalog_id === "tpq51" ? "L" : s.catalog_id === "kufcs" ? "K" : "E",
      description: s.description,
      requires_los: s.requires_los,
    });
  }

  for (const e of catalog.effectors) {
    defs.push({
      id: e.catalog_id,
      name: e.name,
      category: "effector",
      type: e.type,
      range_km: e.range_km,
      fov_deg: e.fov_deg,
      color: TYPE_COLORS[e.type] || COLORS.muted,
      letter: e.catalog_id === "rf_jammer" ? "R" : e.catalog_id === "de_laser_3k" ? "D" : e.catalog_id === "de_hpm_3k" ? "M" : "J",
      description: e.description,
      requires_los: e.requires_los,
    });
  }

  for (const c of catalog.combined || []) {
    defs.push({
      id: c.catalog_id,
      name: c.name,
      category: "combined",
      type: c.sensor_type,
      range_km: c.sensor_range_km,
      sensor_range_km: c.sensor_range_km,
      effector_range_km: c.effector_range_km,
      fov_deg: c.fov_deg,
      color: TYPE_COLORS[c.sensor_type] || "#bc8cff",
      letter: "S",
      description: c.description,
      requires_los: c.requires_los,
    });
  }

  return defs;
}
