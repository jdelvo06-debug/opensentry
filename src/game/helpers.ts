/**
 * OpenSentry helpers — ported from backend/app/config.py + backend/app/helpers.py
 */

import type {
  DroneState,
  DroneType,
  SensorConfig,
  SensorType,
  EffectorConfig,
  EffectorType,
  EffectorRuntimeState,
  PlacementConfig,
  CatalogSensor,
  CatalogEffector,
  CatalogCombined,
} from './state';

// ---------------------------------------------------------------------------
// Physics constants (from config.py)
// ---------------------------------------------------------------------------

/** Knots to km/s conversion factor (1 knot = 0.000514444 km/s) */
export const KTS_TO_KMS: number = 0.000514444;

// ---------------------------------------------------------------------------
// Effector-vs-drone effectiveness matrix (from helpers.py)
// ---------------------------------------------------------------------------

const EFFECTIVENESS_MATRIX: Record<string, Record<string, number>> = {
  rf_jam: {
    commercial_quad: 0.9,
    fixed_wing: 0.4,
    micro: 0.7,
    swarm: 0.6,
    improvised: 0.5,
    improvised_hardened: 0.15,
    shahed: 0.0,
  },
  electronic: {
    commercial_quad: 0.9,
    fixed_wing: 0.4,
    micro: 0.7,
    swarm: 0.6,
    improvised: 0.5,
    improvised_hardened: 0.15,
    shahed: 0.0,
  },
  kinetic: {
    commercial_quad: 0.95,
    fixed_wing: 0.8,
    micro: 0.5,
    swarm: 0.3,
    improvised: 0.7,
    improvised_hardened: 0.7,
    shahed: 0.85,
  },
  net_interceptor: {
    commercial_quad: 0.85,
    fixed_wing: 0.6,
    micro: 0.9,
    swarm: 0.4,
    improvised: 0.6,
    improvised_hardened: 0.5,
    shahed: 0.2,
  },
  directed_energy: {
    commercial_quad: 0.9,
    fixed_wing: 0.9,
    micro: 0.95,
    swarm: 0.8,
    improvised: 0.8,
    improvised_hardened: 0.75,
    shahed: 0.7,
  },
  de_laser: {
    commercial_quad: 0.9,
    fixed_wing: 0.85,
    micro: 0.95,
    swarm: 0.4,
    improvised: 0.8,
    improvised_hardened: 0.75,
    shahed: 0.7,
  },
  de_hpm: {
    commercial_quad: 0.7,
    fixed_wing: 0.6,
    micro: 0.85,
    swarm: 0.9,
    improvised: 0.75,
    improvised_hardened: 0.45,
    shahed: 0.25,
  },
  shenobi_pm: {
    commercial_quad: 0.95,
    fixed_wing: 0.3,
    micro: 0.9,
    swarm: 0.7,
    improvised: 0.6,
    improvised_hardened: 0.2,
    shahed: 0.0,
  },
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** Return effectiveness score 0-1 based on effector type vs drone type. */
export function effectorEffectiveness(
  effectorType: string,
  droneType: string,
): number {
  const row = EFFECTIVENESS_MATRIX[effectorType];
  if (!row) return 0.5;
  const val = row[droneType];
  return val !== undefined ? val : 0.5;
}

/** Calculate threat level based on closest non-neutralized hostile track range. */
export function threatLevel(drones: DroneState[]): string {
  let minRange = Infinity;
  for (const drone of drones) {
    if (!drone.neutralized && drone.detected && !drone.is_ambient) {
      const dist = Math.sqrt(drone.x ** 2 + drone.y ** 2);
      minRange = Math.min(minRange, dist);
    }
  }

  if (minRange === Infinity) return 'green';
  if (minRange < 1.0) return 'red';
  if (minRange < 2.0) return 'orange';
  if (minRange < 3.0) return 'yellow';
  return 'green';
}

/** Find an effector state dict by its id. */
export function findEffectorConfig(
  effectors: EffectorRuntimeState[],
  effectorId: string,
): EffectorRuntimeState | null {
  for (const e of effectors) {
    if (e.id === effectorId) return e;
  }
  return null;
}

/** Check if drone is within effector range and FOV. */
export function checkEffectorInRange(
  effState: EffectorRuntimeState,
  drone: DroneState,
): boolean {
  const ex = effState.x ?? 0.0;
  const ey = effState.y ?? 0.0;
  const dist = Math.sqrt((drone.x - ex) ** 2 + (drone.y - ey) ** 2);
  if (dist > (effState.range_km ?? 999)) return false;

  const fov = effState.fov_deg ?? 360;
  if (fov < 360) {
    const dx = drone.x - ex;
    const dy = drone.y - ey;
    const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const facing = effState.facing_deg ?? 0;
    const diff = Math.abs(((bearing - facing + 180) % 360 + 360) % 360 - 180);
    if (diff > fov / 2) return false;
  }
  return true;
}

/** Check if any Ku-Band FCS radar has the drone in range. */
export function checkKuFcsTracking(
  sensorConfigs: SensorConfig[],
  drone: DroneState,
): boolean {
  for (const s of sensorConfigs) {
    if (
      !s.id.toLowerCase().includes('kufcs') &&
      !s.name.toLowerCase().includes('kufcs')
    )
      continue;
    const dist = Math.sqrt((drone.x - s.x) ** 2 + (drone.y - s.y) ** 2);
    if (dist <= s.range_km) return true;
  }
  return false;
}

/**
 * Check if any Shenobi RF sensor has the drone in detection range
 * and the drone is RF-emitting (library match required).
 */
export function checkNexusRfTracking(
  sensorConfigs: SensorConfig[],
  drone: DroneState,
): boolean {
  if (!drone.rf_emitting) return false;
  for (const s of sensorConfigs) {
    if (s.type !== ('rf' as SensorType)) continue;
    if (
      !s.id.toLowerCase().includes('shenobi') &&
      !s.name.toLowerCase().includes('shenobi')
    )
      continue;
    const dist = Math.sqrt((drone.x - s.x) ** 2 + (drone.y - s.y) ** 2);
    if (dist <= s.range_km) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Build sensors / effectors from player placement
// ---------------------------------------------------------------------------

/**
 * Build SensorConfig list from player's placement choices.
 * Also generates sensor configs from combined placements (e.g. Shenobi).
 */
export function buildSensorsFromPlacement(
  placement: PlacementConfig,
  catalogSensors: Map<string, CatalogSensor>,
  catalogCombined?: Map<string, CatalogCombined>,
): SensorConfig[] {
  const sensors: SensorConfig[] = [];

  for (let i = 0; i < placement.sensors.length; i++) {
    const placed = placement.sensors[i];
    const cat = catalogSensors.get(placed.catalog_id);
    if (cat == null) continue;
    sensors.push({
      id: `sensor_${i}_${placed.catalog_id}`,
      name: cat.name,
      type: cat.type as SensorType,
      range_km: cat.range_km,
      status: 'active',
      x: placed.x,
      y: placed.y,
      fov_deg: cat.fov_deg,
      facing_deg: placed.facing_deg,
      requires_los: cat.requires_los,
    });
  }

  // Combined systems (e.g. Shenobi) — auto-create sensor at same position
  if (catalogCombined) {
    for (let i = 0; i < placement.combined.length; i++) {
      const placed = placement.combined[i];
      const cat = catalogCombined.get(placed.catalog_id);
      if (cat == null) continue;
      sensors.push({
        id: `combined_sensor_${i}_${placed.catalog_id}`,
        name: `${cat.name} RF`,
        type: cat.sensor_type as SensorType,
        range_km: cat.sensor_range_km,
        status: 'active',
        x: placed.x,
        y: placed.y,
        fov_deg: cat.fov_deg,
        facing_deg: placed.facing_deg,
        requires_los: cat.requires_los,
      });
    }
  }

  return sensors;
}

/**
 * Build EffectorConfig list from player's placement choices.
 * Also generates effector configs from combined placements (e.g. Shenobi).
 */
export function buildEffectorsFromPlacement(
  placement: PlacementConfig,
  catalogEffectors: Map<string, CatalogEffector>,
  catalogCombined?: Map<string, CatalogCombined>,
): EffectorConfig[] {
  const effectors: EffectorConfig[] = [];

  for (let i = 0; i < placement.effectors.length; i++) {
    const placed = placement.effectors[i];
    const cat = catalogEffectors.get(placed.catalog_id);
    if (cat == null) continue;
    effectors.push({
      id: `effector_${i}_${placed.catalog_id}`,
      name: cat.name,
      type: cat.type as EffectorType,
      range_km: cat.range_km,
      status: 'ready',
      recharge_seconds: cat.recharge_seconds,
      x: placed.x,
      y: placed.y,
      fov_deg: cat.fov_deg,
      facing_deg: placed.facing_deg,
      requires_los: cat.requires_los,
      single_use: cat.single_use,
      ammo_count: cat.ammo_count ?? null,
      ammo_remaining: cat.ammo_count ?? null,
    });
  }

  // Combined systems (e.g. Shenobi) — auto-create effector at same position
  if (catalogCombined) {
    for (let i = 0; i < placement.combined.length; i++) {
      const placed = placement.combined[i];
      const cat = catalogCombined.get(placed.catalog_id);
      if (cat == null) continue;
      effectors.push({
        id: `combined_effector_${i}_${placed.catalog_id}`,
        name: `${cat.name} PM`,
        type: cat.effector_type as EffectorType,
        range_km: cat.effector_range_km,
        status: 'ready',
        recharge_seconds: cat.recharge_seconds,
        x: placed.x,
        y: placed.y,
        fov_deg: cat.fov_deg,
        facing_deg: placed.facing_deg,
        requires_los: cat.requires_los,
        single_use: cat.single_use,
        ammo_count: null,
        ammo_remaining: null,
      });
    }
  }

  return effectors;
}
