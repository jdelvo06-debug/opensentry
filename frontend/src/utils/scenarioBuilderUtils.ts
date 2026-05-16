export type DroneType =
  | "commercial_quad"
  | "micro"
  | "fixed_wing"
  | "improvised"
  | "improvised_hardened"
  | "shahed";

export const DRONE_TYPES: DroneType[] = [
  "commercial_quad",
  "micro",
  "fixed_wing",
  "improvised",
  "improvised_hardened",
  "shahed",
];

export const SECTOR_BEARINGS: Record<string, number> = {
  N: 90,
  NE: 45,
  E: 0,
  SE: 315,
  S: 270,
  SW: 225,
  W: 180,
  NW: 135,
};

export const BEHAVIORS = ["direct_approach", "evasive", "orbit", "waypoint_path"] as const;
export type ThreatBehavior = (typeof BEHAVIORS)[number];

export interface ThreatGroupDef {
  id: string;
  droneType: string;
  count: number;
  bearingDeg: number;
  spawnOffsetSeconds: number;
  staggerSeconds: number;
  altitude: number;
  speed: number;
  behavior: string;
}

export interface WaveDef {
  id: string;
  startSeconds?: number;
  threatGroups?: ThreatGroupDef[];
  droneType?: string;
  count?: number;
  spawnSector?: string;
  delaySeconds?: number;
  staggerSeconds?: number;
  altitude?: number;
  speed?: number;
  behavior?: string;
}

export interface NormalizedWaveDef {
  id: string;
  startSeconds: number;
  threatGroups: ThreatGroupDef[];
}

export interface DroneTemplate {
  altitude: number;
  speed: number;
  rf_emitting: boolean;
  optimal_effectors: string[];
  acceptable_effectors: string[];
}

export const DRONE_TEMPLATES: Record<DroneType, DroneTemplate> = {
  commercial_quad: {
    altitude: 150,
    speed: 35,
    rf_emitting: true,
    optimal_effectors: ["de_laser", "electronic"],
    acceptable_effectors: ["electronic", "kinetic", "de_laser"],
  },
  micro: {
    altitude: 80,
    speed: 25,
    rf_emitting: true,
    optimal_effectors: ["electronic", "de_laser"],
    acceptable_effectors: ["electronic", "de_laser", "kinetic"],
  },
  fixed_wing: {
    altitude: 300,
    speed: 60,
    rf_emitting: false,
    optimal_effectors: ["kinetic", "de_laser"],
    acceptable_effectors: ["kinetic", "de_laser", "electronic"],
  },
  improvised: {
    altitude: 100,
    speed: 50,
    rf_emitting: true,
    optimal_effectors: ["electronic", "de_laser"],
    acceptable_effectors: ["electronic", "de_laser", "kinetic"],
  },
  improvised_hardened: {
    altitude: 100,
    speed: 55,
    rf_emitting: true,
    optimal_effectors: ["de_laser", "kinetic"],
    acceptable_effectors: ["kinetic", "de_laser", "electronic"],
  },
  shahed: {
    altitude: 300,
    speed: 100,
    rf_emitting: false,
    optimal_effectors: ["kinetic"],
    acceptable_effectors: ["kinetic", "de_laser"],
  },
};

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asDroneType(value: unknown): DroneType {
  return typeof value === "string" && value in DRONE_TEMPLATES
    ? (value as DroneType)
    : "commercial_quad";
}

export function sectorToBearing(sector: unknown, fallback: number): number {
  if (typeof sector === "number" && Number.isFinite(sector)) return sector;
  if (typeof sector !== "string") return fallback;

  const normalized = sector.toLowerCase().trim();
  const cardinal: Record<string, number> = {
    n: 90,
    north: 90,
    ne: 45,
    northeast: 45,
    e: 0,
    east: 0,
    se: 315,
    southeast: 315,
    s: 270,
    south: 270,
    sw: 225,
    southwest: 225,
    w: 180,
    west: 180,
    nw: 135,
    northwest: 135,
  };

  if (normalized in cardinal) return cardinal[normalized];
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeBearing(value: unknown, fallback = 90): number {
  const numeric = asNumber(value, fallback);
  return ((numeric % 360) + 360) % 360;
}

export function headingTowardOrigin(x: number, y: number): number {
  return (((Math.atan2(-y, -x) * 180) / Math.PI) + 360) % 360;
}

export function createDefaultThreatGroup(id: string): ThreatGroupDef {
  return {
    id,
    droneType: "commercial_quad",
    count: 1,
    bearingDeg: SECTOR_BEARINGS.N,
    spawnOffsetSeconds: 0,
    staggerSeconds: 5,
    altitude: 150,
    speed: 35,
    behavior: "direct_approach",
  };
}

export function normalizeThreatGroup(
  value: unknown,
  fallbackId: string,
  legacyWave?: WaveDef,
): ThreatGroupDef {
  const data = value as Partial<ThreatGroupDef> & Record<string, unknown>;
  const legacy = legacyWave as Record<string, unknown> | undefined;
  const droneType = asDroneType(data?.droneType ?? legacy?.droneType ?? legacy?.drone_type ?? legacy?.type);
  const template = DRONE_TEMPLATES[droneType];
  const legacyBearing = sectorToBearing(legacy?.spawnSector ?? legacy?.spawn_sector ?? legacy?.sector, SECTOR_BEARINGS.N);

  return {
    id: typeof data?.id === "string" && data.id ? data.id : fallbackId,
    droneType,
    count: Math.max(1, Math.round(asNumber(data?.count ?? legacy?.count ?? legacy?.qty ?? legacy?.quantity ?? legacy?.droneCount, 1))),
    bearingDeg: normalizeBearing(data?.bearingDeg ?? data?.bearing_deg ?? legacyBearing, SECTOR_BEARINGS.N),
    spawnOffsetSeconds: Math.max(0, asNumber(data?.spawnOffsetSeconds ?? data?.spawn_offset_seconds, 0)),
    staggerSeconds: Math.max(0, asNumber(data?.staggerSeconds ?? data?.stagger_seconds ?? legacy?.staggerSeconds ?? legacy?.stagger_seconds ?? legacy?.stagger, 5)),
    altitude: Math.max(10, asNumber(data?.altitude ?? legacy?.altitude, template.altitude)),
    speed: Math.max(5, asNumber(data?.speed ?? legacy?.speed, template.speed)),
    behavior: typeof data?.behavior === "string"
      ? data.behavior
      : typeof legacy?.behavior === "string"
        ? legacy.behavior
        : "direct_approach",
  };
}

export function normalizeWave(wave: WaveDef, waveIndex = 0): NormalizedWaveDef {
  const data = wave as unknown as Record<string, unknown>;
  const threatGroups = Array.isArray(wave.threatGroups) && wave.threatGroups.length > 0
    ? wave.threatGroups.map((group, index) => normalizeThreatGroup(group, `group-${index + 1}`))
    : [normalizeThreatGroup(undefined, "group-1", wave)];
  const legacyStart = data.delaySeconds ?? data.delay_seconds ?? data.delay;

  return {
    id: typeof wave.id === "string" && wave.id ? wave.id : `wave-${waveIndex + 1}`,
    startSeconds: Math.max(0, asNumber(data.startSeconds ?? data.start_seconds ?? legacyStart, 30)),
    threatGroups,
  };
}

export function normalizeWaves(waves: WaveDef[]): NormalizedWaveDef[] {
  return waves.map((wave, index) => normalizeWave(wave, index));
}

function groupEndSeconds(wave: NormalizedWaveDef, group: ThreatGroupDef): number {
  return wave.startSeconds + group.spawnOffsetSeconds + group.count * group.staggerSeconds + 30;
}

/**
 * Compute the minimum scenario duration from wave definitions.
 * Returns the end time of the latest wave + a 60s buffer, rounded up to 30s,
 * with a floor of 300s.
 */
export function computeScenarioDuration(waves: WaveDef[]): number {
  const lastWaveEnd = normalizeWaves(waves).reduce((max, wave) => {
    const waveEnd = wave.threatGroups.reduce(
      (groupMax, group) => Math.max(groupMax, groupEndSeconds(wave, group)),
      0,
    );
    return Math.max(max, waveEnd);
  }, 300);
  return Math.max(300, Math.ceil((lastWaveEnd + 60) / 30) * 30);
}

/**
 * Convert WaveDef[] into the drones[] array format used in scenario JSON.
 */
export function buildScenarioDrones(waves: WaveDef[]): Record<string, unknown>[] {
  const drones: Record<string, unknown>[] = [];

  normalizeWaves(waves).forEach((wave, waveIdx) => {
    wave.threatGroups.forEach((group, groupIdx) => {
      const droneType = asDroneType(group.droneType);
      const template = DRONE_TEMPLATES[droneType];

      for (let droneIdx = 0; droneIdx < group.count; droneIdx += 1) {
        const offsetDeg = group.count > 1 ? (droneIdx - (group.count - 1) / 2) * 8 : 0;
        const bearingRad = ((group.bearingDeg + offsetDeg) * Math.PI) / 180;
        const distanceKm = 4 + ((waveIdx + groupIdx + droneIdx) % 6) * 0.18;
        const startX = Number((Math.cos(bearingRad) * distanceKm).toFixed(2));
        const startY = Number((Math.sin(bearingRad) * distanceKm).toFixed(2));

        drones.push({
          id: `wave-${waveIdx + 1}-group-${groupIdx + 1}-${droneIdx + 1}`,
          drone_type: droneType,
          start_x: startX,
          start_y: startY,
          altitude: group.altitude,
          speed: group.speed,
          heading: Math.round(headingTowardOrigin(startX, startY)),
          behavior: group.behavior,
          rf_emitting: template.rf_emitting,
          spawn_delay: wave.startSeconds + group.spawnOffsetSeconds + droneIdx * group.staggerSeconds,
          correct_classification: droneType,
          correct_affiliation: "hostile",
          optimal_effectors: template.optimal_effectors,
          acceptable_effectors: template.acceptable_effectors,
          spawn_variance: {
            x_range: [-0.6, 0.6],
            y_range: [-0.6, 0.6],
            heading_variance: 12,
            speed_variance: 6,
          },
          ...(
            group.behavior === "waypoint_path"
              ? { waypoints: [[startX * 0.4, startY * 0.4], [-startX * 0.2, -startY * 0.2]] }
              : {}
          ),
        });
      }
    });
  });

  return drones;
}
