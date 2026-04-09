// frontend/src/components/bda/types.ts
import type { BaseTemplate, EquipmentCatalog, PlacementConfig, BaseInfo, ScenarioInfo } from "../../types";

export interface SystemDef {
  id: string;
  name: string;
  category: "sensor" | "effector" | "combined";
  type: string;
  range_km: number;
  sensor_range_km?: number;
  effector_range_km?: number;
  fov_deg: number;
  color: string;
  letter: string;
  description: string;
  requires_los: boolean;
}

export interface ViewshedStats {
  totalCells: number;
  visibleCells: number;
  blockedCells: number;
  coveragePercent: number;
  sensorElevation: number;
  minElevation: number;
  maxElevation: number;
}

export interface ViewshedResult {
  polygon: [number, number][];
  blockedSectors: [number, number][][];
  area: number;
  stats: ViewshedStats;
}

export interface PlacedSystem {
  uid: string;
  def: SystemDef;
  lat: number;
  lng: number;
  altitude: number;
  facing_deg: number;
  viewshed: [number, number][] | null;
  blockedSectors: [number, number][][] | null;
  viewshedLoading: boolean;
  viewshedArea: number | null;
  viewshedStats: ViewshedStats | null;
  visible: boolean;
}

export interface SelectedEquipment {
  sensors: { catalogId: string; qty: number }[];
  effectors: { catalogId: string; qty: number }[];
  combined: { catalogId: string; qty: number }[];
}

export type BdaStep = 1 | 2 | 3 | 4;
