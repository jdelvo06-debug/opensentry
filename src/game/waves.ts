/**
 * OpenSentry wave & ambient spawn logic — ported from backend/app/waves.py
 */

import type { DroneStartConfig, DroneType } from './state';

// --- Wave drone templates ---

interface WaveDroneTemplate {
  drone_type: DroneType;
  altitude: number;
  speed: number;
  behavior: string;
  rf_emitting: boolean;
  correct_classification: string;
  correct_affiliation: string;
  optimal_effectors: string[];
  acceptable_effectors: string[];
  roe_violations: string[];
}

const _WAVE_DRONE_TEMPLATES: WaveDroneTemplate[] = [
  {
    drone_type: 'commercial_quad', altitude: 150, speed: 35, behavior: 'direct_approach', rf_emitting: true,
    correct_classification: 'commercial_quad', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
  {
    drone_type: 'commercial_quad', altitude: 120, speed: 40, behavior: 'evasive', rf_emitting: true,
    correct_classification: 'commercial_quad', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
  {
    drone_type: 'fixed_wing', altitude: 300, speed: 60, behavior: 'direct_approach', rf_emitting: false,
    correct_classification: 'fixed_wing', correct_affiliation: 'hostile',
    optimal_effectors: ['kinetic'], acceptable_effectors: ['kinetic', 'electronic'], roe_violations: [],
  },
  {
    drone_type: 'micro', altitude: 80, speed: 25, behavior: 'evasive', rf_emitting: true,
    correct_classification: 'micro', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic', 'kinetic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
];

// Combat-hardened FPV with FHSS — same silhouette as improvised
const _HARDENED_FPV_TEMPLATE: WaveDroneTemplate = {
  drone_type: 'improvised_hardened', altitude: 100, speed: 55, behavior: 'direct_approach', rf_emitting: true,
  correct_classification: 'improvised', correct_affiliation: 'hostile',
  optimal_effectors: ['kinetic'], acceptable_effectors: ['kinetic', 'electronic'], roe_violations: [],
};

// Scenario IDs that may spawn hardened FPVs (swarm/hard scenarios only)
const _HARDENED_FPV_SCENARIOS = new Set(['swarm_attack']);

// --- Helpers ---

/** Random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
function uniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Pick a random element from an array. */
function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Wave generation ---

/**
 * Generate wave drones for the given wave number.
 * Returns [configs, updatedWaveDroneCounter].
 */
export function generateWaveDrones(
  waveNumber: number,
  waveDroneCounter: number,
  scenarioId?: string,
): [DroneStartConfig[], number] {
  if (waveNumber === 1) return [[], waveDroneCounter];

  const count = waveNumber === 2 ? randInt(2, 3) : randInt(4, 5);
  const configs: DroneStartConfig[] = [];

  // Build template pool — include hardened FPV only for qualifying scenarios
  const pool = scenarioId && _HARDENED_FPV_SCENARIOS.has(scenarioId)
    ? [..._WAVE_DRONE_TEMPLATES, _HARDENED_FPV_TEMPLATE]
    : _WAVE_DRONE_TEMPLATES;

  for (let i = 0; i < count; i++) {
    waveDroneCounter += 1;
    const template = choice(pool);

    const angle = uniform(0, 2 * Math.PI);
    const dist = uniform(3.5, 5.0);
    const startX = dist * Math.cos(angle);
    const startY = dist * Math.sin(angle);
    const heading = ((Math.atan2(-startY, -startX) * 180) / Math.PI + 360) % 360;

    const cfg: DroneStartConfig = {
      id: `wave${waveNumber}-${waveDroneCounter}`,
      drone_type: template.drone_type,
      start_x: round2(startX),
      start_y: round2(startY),
      altitude: template.altitude + randInt(-30, 30),
      speed: template.speed + randInt(-5, 5),
      heading,
      behavior: template.behavior,
      rf_emitting: template.rf_emitting,
      spawn_delay: i * uniform(2.0, 5.0),
      correct_classification: template.correct_classification,
      correct_affiliation: template.correct_affiliation,
      optimal_effectors: template.optimal_effectors,
      acceptable_effectors: template.acceptable_effectors,
      roe_violations: template.roe_violations,
      should_engage: true,
    };
    configs.push(cfg);
  }

  return [configs, waveDroneCounter];
}

// --- Ambient traffic ---

const _COMMERCIAL_CALLSIGNS = [
  'QR-412', 'EK-771', 'BA-209', 'LH-442', 'AF-381', 'SQ-026',
  'UA-857', 'DL-134', 'AA-291', 'JL-006', 'CX-888', 'TK-517',
];

const _MILITARY_CALLSIGNS = [
  'VIPER-01', 'RAPTOR-22', 'EAGLE-11', 'FALCON-03', 'HAWK-07',
  'COBRA-14', 'THUNDER-05', 'SHADOW-09', 'STORM-16', 'GHOST-21',
];

export const AMBIENT_INTERVALS: Record<string, [number, number]> = {
  commercial_aircraft: [90.0, 150.0],
  military_jet: [180.0, 300.0],
  bird: [90.0, 150.0],
  weather_balloon: [240.0, 420.0],
};

/**
 * Create an initial schedule mapping each ambient type to its first spawn time.
 */
export function initialAmbientSchedule(): Record<string, number> {
  const schedule: Record<string, number> = {};
  for (const [ambType, interval] of Object.entries(AMBIENT_INTERVALS)) {
    schedule[ambType] = uniform(interval[0], interval[1]);
  }
  return schedule;
}

const _ALL_ROE_VIOLATIONS = ['electronic', 'kinetic', 'rf_jam', 'directed_energy', 'net_interceptor'];

/**
 * Generate a single ambient object of the given type.
 * Returns [config, updatedAmbientCounter].
 */
export function generateAmbientObject(
  ambientCounter: number,
  objType: string,
  _elapsed: number,
): [DroneStartConfig, number] {
  ambientCounter += 1;
  let ambId = `TRN-${String(ambientCounter).padStart(3, '0')}`;

  let cfg: DroneStartConfig;

  if (objType === 'commercial_aircraft') {
    const callsign = choice(_COMMERCIAL_CALLSIGNS);
    ambId = callsign;
    const angle = uniform(0, 2 * Math.PI);
    const startX = 8.0 * Math.cos(angle);
    const startY = 8.0 * Math.sin(angle);
    const exitAngle = angle + Math.PI + uniform(-0.3, 0.3);
    const exitX = 15.0 * Math.cos(exitAngle);
    const exitY = 15.0 * Math.sin(exitAngle);
    const heading = ((Math.atan2(exitY - startY, exitX - startX) * 180) / Math.PI + 360) % 360;

    cfg = {
      id: ambId,
      drone_type: 'passenger_aircraft',
      start_x: round2(startX),
      start_y: round2(startY),
      altitude: randInt(15000, 35000),
      speed: randInt(400, 500),
      heading,
      behavior: 'waypoint_path',
      rf_emitting: true,
      spawn_delay: 0.0,
      waypoints: [[round2(exitX), round2(exitY)]],
      correct_classification: 'passenger_aircraft',
      correct_affiliation: 'friendly',
      optimal_effectors: [],
      acceptable_effectors: [],
      roe_violations: _ALL_ROE_VIOLATIONS,
      should_engage: false,
    };
  } else if (objType === 'military_jet') {
    const callsign = choice(_MILITARY_CALLSIGNS);
    ambId = callsign;
    const angle = uniform(0, 2 * Math.PI);
    const orbitDist = uniform(3.0, 6.0);
    const startX = 7.0 * Math.cos(angle);
    const startY = 7.0 * Math.sin(angle);
    const heading = ((Math.atan2(-startY, -startX) * 180) / Math.PI + 360) % 360;

    cfg = {
      id: ambId,
      drone_type: 'military_jet',
      start_x: round2(startX),
      start_y: round2(startY),
      altitude: randInt(5000, 15000),
      speed: randInt(500, 600),
      heading,
      behavior: 'orbit',
      rf_emitting: true,
      spawn_delay: 0.0,
      orbit_center: [round2(orbitDist * Math.cos(angle + 0.5)), round2(orbitDist * Math.sin(angle + 0.5))],
      orbit_radius: uniform(2.0, 4.0),
      correct_classification: 'fixed_wing',
      correct_affiliation: 'friendly',
      optimal_effectors: [],
      acceptable_effectors: [],
      roe_violations: _ALL_ROE_VIOLATIONS,
      should_engage: false,
    };
  } else if (objType === 'bird') {
    ambId = `TRN-${String(ambientCounter).padStart(3, '0')}`;
    // Spawn on one edge, fly through toward the opposite side and exit the map
    const entryAngle = uniform(0, 2 * Math.PI);
    const startDist = uniform(3.0, 6.0);
    const startX = startDist * Math.cos(entryAngle);
    const startY = startDist * Math.sin(entryAngle);
    // Exit point: roughly opposite side, off-map (>10km)
    const exitAngle = entryAngle + Math.PI + uniform(-0.6, 0.6);
    const exitDist = uniform(8.0, 11.0);
    const exitX = exitDist * Math.cos(exitAngle);
    const exitY = exitDist * Math.sin(exitAngle);
    const heading = ((Math.atan2(exitX - startX, exitY - startY) * 180 / Math.PI) + 360) % 360;

    cfg = {
      id: ambId,
      drone_type: 'bird',
      start_x: round2(startX),
      start_y: round2(startY),
      altitude: randInt(50, 500),
      speed: randInt(20, 40),
      heading,
      behavior: 'waypoint_path',
      rf_emitting: false,
      spawn_delay: 0.0,
      correct_classification: 'bird',
      correct_affiliation: 'neutral',
      optimal_effectors: [],
      acceptable_effectors: [],
      roe_violations: _ALL_ROE_VIOLATIONS,
      should_engage: false,
      waypoints: [[round2(exitX), round2(exitY)]],
    };
  } else if (objType === 'weather_balloon') {
    ambId = `TRN-${String(ambientCounter).padStart(3, '0')}`;
    const angle = uniform(0, 2 * Math.PI);
    const startDist = uniform(1.5, 4.0);
    const startX = startDist * Math.cos(angle);
    const startY = startDist * Math.sin(angle);

    cfg = {
      id: ambId,
      drone_type: 'weather_balloon',
      start_x: round2(startX),
      start_y: round2(startY),
      altitude: randInt(500, 2000),
      speed: randInt(0, 5),
      heading: uniform(0, 360),
      behavior: 'waypoint_path',
      rf_emitting: false,
      spawn_delay: 0.0,
      waypoints: [[round2(startX + uniform(-0.5, 0.5)), round2(startY + uniform(-0.5, 0.5))]],
      correct_classification: 'weather_balloon',
      correct_affiliation: 'neutral',
      optimal_effectors: [],
      acceptable_effectors: [],
      roe_violations: _ALL_ROE_VIOLATIONS,
      should_engage: false,
    };
  } else {
    throw new Error(`Unknown ambient type: ${objType}`);
  }

  return [cfg, ambientCounter];
}
