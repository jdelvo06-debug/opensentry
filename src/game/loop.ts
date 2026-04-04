/**
 * Game loop tick logic — ported from main.py tick functions + tutorial logic.
 */

/** Ray-casting point-in-polygon test (game XY coords). */
function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  const n = polygon.length;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

import type {
  DroneState, GameState, DroneStartConfig, ScenarioConfig,
  SensorConfig, EffectorConfig, PlacementConfig, BaseTemplate,
  TerrainFeature, EquipmentCatalog, PlayerAction,
} from './state.js';
import { createGameState } from './state.js';
import { KTS_TO_KMS, threatLevel } from './helpers.js';
import { createDroneFromConfig, moveDrone, distanceToBase } from './drone.js';
import { updateJammedDrone, updatePntJammedDrone, pickJamBehavior, applyPntJamming } from './jamming.js';
import { updateShenobiDrone } from './shenobi.js';
import { updateJackal } from './jackal.js';
import { updateSensors, calculateConfidence } from './detection.js';
import { generateWaveDrones, generateAmbientObject, initialAmbientSchedule, AMBIENT_INTERVALS } from './waves.js';
import { calculateScore, calculateScoreMulti, applyCompletionMultiplier } from './scoring.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;

// ---------------------------------------------------------------------------
// Track label helper
// ---------------------------------------------------------------------------

function nextTrackLabel(gs: GameState): string {
  gs.track_counter += 1;
  return `TRN-${String(gs.track_counter).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Spawn variance helpers
// ---------------------------------------------------------------------------

function uniformRandom(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function applySpawnVariance(cfg: DroneStartConfig): DroneStartConfig {
  const v = cfg.spawn_variance;
  if (!v) return cfg;
  return {
    ...cfg,
    start_x: cfg.start_x + uniformRandom(v.x_range[0], v.x_range[1]),
    start_y: cfg.start_y + uniformRandom(v.y_range[0], v.y_range[1]),
    heading: cfg.heading + uniformRandom(-v.heading_variance, v.heading_variance),
    speed: cfg.speed + uniformRandom(-v.speed_variance, v.speed_variance),
  };
}

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

export function initGameState(
  scenario: ScenarioConfig,
  sensorConfigs: SensorConfig[],
  effectorConfigsList: EffectorConfig[],
  placementConfig: PlacementConfig | null,
  baseTemplate: BaseTemplate | null,
  terrain: TerrainFeature[],
): GameState {
  const gs = createGameState(scenario, sensorConfigs, effectorConfigsList, placementConfig, baseTemplate, terrain);

  // Spawn initial drones (apply spawn variance for randomization)
  for (const droneCfg of scenario.drones) {
    const cfg = applySpawnVariance(droneCfg);
    gs.drone_configs.set(cfg.id, cfg);
    if (cfg.spawn_delay <= 0) {
      const drone = createDroneFromConfig(cfg);
      drone.display_label = nextTrackLabel(gs);
      gs.drones.push(drone);
      gs.behaviors.set(cfg.id, cfg.behavior);
    } else {
      gs.pending_spawns.push(cfg);
    }
  }

  // Init effector runtime state
  for (const eff of effectorConfigsList) {
    const isJammer = eff.type === 'rf_jam' || eff.type === 'electronic';
    gs.effector_states.push({
      id: eff.id, name: eff.name, type: eff.type,
      range_km: eff.range_km, status: eff.status,
      recharge_seconds: eff.recharge_seconds, recharge_remaining: 0,
      x: eff.x, y: eff.y, fov_deg: eff.fov_deg,
      facing_deg: eff.facing_deg, requires_los: eff.requires_los,
      single_use: eff.single_use, ammo_count: eff.ammo_count,
      ammo_remaining: eff.ammo_remaining,
      ...(isJammer ? { jammer_active: false } : {}),
    });
  }

  // Init sensor runtime
  for (const s of sensorConfigs) {
    gs.sensor_runtime.push({ id: s.id, status: s.status, detecting: [] });
  }

  // Ambient traffic schedule
  gs.next_ambient_times = new Map(Object.entries(initialAmbientSchedule()));

  // Load boundary polygon for polygon-accurate breach checks
  // Placement config boundary (custom drawn polygon) takes priority over base template default
  if (placementConfig && (placementConfig as any).boundary && (placementConfig as any).boundary.length >= 3) {
    gs.boundary_polygon = (placementConfig as any).boundary.map((p: number[]) => [p[0], p[1]] as [number, number]);
  } else if (baseTemplate && baseTemplate.boundary && baseTemplate.boundary.length >= 3) {
    gs.boundary_polygon = baseTemplate.boundary.map(p => [p[0], p[1]] as [number, number]);
  }

  // Protected area
  if (baseTemplate && baseTemplate.protected_assets.length > 0) {
    const assets = baseTemplate.protected_assets;
    const cx = assets.reduce((s, a) => s + a.x, 0) / assets.length;
    const cy = assets.reduce((s, a) => s + a.y, 0) / assets.length;
    gs.protected_area_center = [cx, cy];
    const maxDist = Math.max(...assets.map(a => Math.sqrt((a.x - cx) ** 2 + (a.y - cy) ** 2)));
    gs.protected_area_radius = Math.max(maxDist + 0.15, 0.2);
  }
  gs.warning_area_radius = gs.protected_area_radius * 1.5;

  return gs;
}

export function buildGameStartMsg(gs: GameState): Msg {
  const msg: Msg = {
    type: 'game_start',
    scenario: {
      name: gs.scenario.name,
      description: gs.scenario.description,
      difficulty: gs.scenario.difficulty,
    },
    sensors: gs.sensor_configs.map(s => ({
      id: s.id, name: s.name, type: s.type,
      range_km: s.range_km, status: s.status,
      x: s.x, y: s.y, fov_deg: s.fov_deg, facing_deg: s.facing_deg,
    })),
    effectors: gs.effector_configs.map(e => ({
      id: e.id, name: e.name, type: e.type,
      range_km: e.range_km, status: e.status,
      recharge_seconds: e.recharge_seconds,
      x: e.x, y: e.y, fov_deg: e.fov_deg, facing_deg: e.facing_deg,
      ...(e.ammo_count !== null ? { ammo_count: e.ammo_count } : {}),
      ...(e.ammo_remaining !== null ? { ammo_remaining: e.ammo_remaining } : {}),
    })),
    engagement_zones: gs.scenario.engagement_zones,
    tutorial: gs.scenario.tutorial,
    tutorial_prompts: gs.scenario.tutorial_prompts || [],
    protected_area: {
      center_x: gs.protected_area_center[0],
      center_y: gs.protected_area_center[1],
      radius_km: Math.round(gs.protected_area_radius * 1000) / 1000,
      warning_radius_km: Math.round(gs.warning_area_radius * 1000) / 1000,
    },
  };

  if (gs.base_template) {
    msg.base = {
      id: gs.base_template.id,
      name: gs.base_template.name,
      boundary: gs.base_template.boundary,
      protected_assets: gs.base_template.protected_assets,
      terrain: gs.base_template.terrain,
    };
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Tick functions
// ---------------------------------------------------------------------------

export function tickSpawns(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];

  // Delayed scenario drones
  const newlySpawned: DroneStartConfig[] = [];
  for (const cfg of gs.pending_spawns) {
    if (elapsed >= cfg.spawn_delay) {
      const label = nextTrackLabel(gs);
      const newDrone = { ...createDroneFromConfig(cfg), wave_number: gs.current_wave, display_label: label };
      gs.drones.push(newDrone);
      gs.behaviors.set(cfg.id, cfg.behavior);
      newlySpawned.push(cfg);
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `RADAR: New contact emerging \u2014 ${label}`,
      });
    }
  }
  for (const cfg of newlySpawned) {
    const idx = gs.pending_spawns.indexOf(cfg);
    if (idx >= 0) gs.pending_spawns.splice(idx, 1);
  }

  // Ambient traffic
  if (gs.scenario.no_ambient) return events;
  const ATC_CLEARABLE_AMB = new Set(['commercial_aircraft', 'military_jet']);

  for (const [ambType, nextTime] of gs.next_ambient_times) {
    if (elapsed < gs.ambient_suppressed_until && ATC_CLEARABLE_AMB.has(ambType)) continue;
    if (elapsed >= nextTime) {
      let [ambCfg, counter] = generateAmbientObject(gs.ambient_counter, ambType, elapsed);
      gs.ambient_counter = counter;
      while (gs.drone_configs.has(ambCfg.id)) {
        gs.ambient_counter++;
        [ambCfg, counter] = generateAmbientObject(gs.ambient_counter, ambType, elapsed);
        gs.ambient_counter = counter;
      }
      gs.drone_configs.set(ambCfg.id, ambCfg);
      const ambLabel = nextTrackLabel(gs);
      let ambDrone: DroneState = { ...createDroneFromConfig(ambCfg), is_ambient: true, wave_number: 0, display_label: ambLabel };
      if (ambType === 'commercial_aircraft' || ambType === 'military_jet') {
        ambDrone = {
          ...ambDrone,
          affiliation: 'friendly',
          classified: true,
          dtid_phase: 'identified',
          classification: ambType === 'commercial_aircraft' ? 'passenger_aircraft' : 'military_jet',
        };
      }
      gs.drones.push(ambDrone);
      gs.behaviors.set(ambCfg.id, ambCfg.behavior);
      const interval = AMBIENT_INTERVALS[ambType];
      if (interval) {
        gs.next_ambient_times.set(ambType, elapsed + interval[0] + Math.random() * (interval[1] - interval[0]));
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Free-play phase-based spawning
// ---------------------------------------------------------------------------

/** Drone templates for free-play phase spawning, keyed by threat type string. */
const _FREE_PLAY_TEMPLATES: Record<string, Omit<DroneStartConfig, 'id' | 'start_x' | 'start_y' | 'heading' | 'spawn_delay'>> = {
  commercial_quad: {
    drone_type: 'commercial_quad', altitude: 150, speed: 35, behavior: 'direct_approach',
    rf_emitting: true, should_engage: true,
    correct_classification: 'commercial_quad', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
  micro: {
    drone_type: 'micro', altitude: 80, speed: 25, behavior: 'evasive',
    rf_emitting: true, should_engage: true,
    correct_classification: 'micro', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic', 'kinetic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
  fixed_wing: {
    drone_type: 'fixed_wing', altitude: 300, speed: 60, behavior: 'direct_approach',
    rf_emitting: false, should_engage: true,
    correct_classification: 'fixed_wing', correct_affiliation: 'hostile',
    optimal_effectors: ['kinetic'], acceptable_effectors: ['kinetic', 'electronic'], roe_violations: [],
  },
  improvised: {
    drone_type: 'improvised', altitude: 100, speed: 30, behavior: 'direct_approach',
    rf_emitting: true, should_engage: true,
    correct_classification: 'improvised', correct_affiliation: 'hostile',
    optimal_effectors: ['electronic', 'kinetic'], acceptable_effectors: ['electronic', 'kinetic'], roe_violations: [],
  },
  shahed: {
    drone_type: 'shahed', altitude: 200, speed: 80, behavior: 'direct_approach',
    rf_emitting: false, should_engage: true,
    correct_classification: 'shahed', correct_affiliation: 'hostile',
    optimal_effectors: ['kinetic'], acceptable_effectors: ['kinetic'], roe_violations: [],
  },
  bird: {
    drone_type: 'bird', altitude: 150, speed: 30, behavior: 'evasive',
    rf_emitting: false, should_engage: false,
    correct_classification: 'bird', correct_affiliation: 'neutral',
    optimal_effectors: [], acceptable_effectors: [], roe_violations: ['electronic', 'kinetic', 'rf_jam', 'directed_energy', 'net_interceptor'],
  },
  balloon: {
    drone_type: 'weather_balloon', altitude: 800, speed: 3, behavior: 'waypoint_path',
    rf_emitting: false, should_engage: false,
    correct_classification: 'weather_balloon', correct_affiliation: 'neutral',
    optimal_effectors: [], acceptable_effectors: [], roe_violations: ['electronic', 'kinetic', 'rf_jam', 'directed_energy', 'net_interceptor'],
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function tickFreePlaySpawns(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];
  const phases = gs.scenario.phases;
  if (!phases || !gs.scenario.free_play) return events;

  // Determine current phase (use last phase for endless mode)
  let currentPhase = phases[phases.length - 1];
  for (const p of phases) {
    if (elapsed >= p.start_seconds && elapsed < p.end_seconds) {
      currentPhase = p;
      break;
    }
  }

  // Check spawn interval
  if (elapsed - gs.free_play_last_spawn_time < currentPhase.spawn_interval) return events;

  // Check max_active (non-neutralized, non-ambient threats)
  const activeThreatCount = gs.drones.filter(d => !d.is_ambient && !d.neutralized).length;
  if (activeThreatCount >= currentPhase.max_active) return events;

  // Pick random threat type from phase
  const types = currentPhase.threat_types;
  const chosenType = types[Math.floor(Math.random() * types.length)];
  const template = _FREE_PLAY_TEMPLATES[chosenType];
  if (!template) return events;

  gs.free_play_spawn_counter += 1;
  const angle = Math.random() * 2 * Math.PI;
  const dist = 3.5 + Math.random() * 1.5;
  const startX = dist * Math.cos(angle);
  const startY = dist * Math.sin(angle);
  const heading = ((Math.atan2(-startY, -startX) * 180) / Math.PI + 360) % 360;

  const cfg: DroneStartConfig = {
    id: `fp-${gs.free_play_spawn_counter}`,
    ...template,
    start_x: round2(startX),
    start_y: round2(startY),
    heading,
    altitude: template.altitude + Math.floor(Math.random() * 60 - 30),
    speed: template.speed + Math.floor(Math.random() * 10 - 5),
    spawn_delay: 0,
  };

  // For balloons, add a waypoint
  if (chosenType === 'balloon') {
    cfg.waypoints = [[round2(startX + (Math.random() - 0.5)), round2(startY + (Math.random() - 0.5))]];
  }

  gs.drone_configs.set(cfg.id, cfg);
  const label = nextTrackLabel(gs);
  // Birds and balloons in free-play are ambient — they despawn when off-map and don't count as threats
  const isAmbientType = chosenType === 'bird' || chosenType === 'balloon';
  const drone = { ...createDroneFromConfig(cfg), wave_number: gs.current_wave, display_label: label, is_ambient: isAmbientType };
  gs.drones.push(drone);
  gs.behaviors.set(cfg.id, cfg.behavior);
  gs.free_play_last_spawn_time = elapsed;

  events.push({
    type: 'event', timestamp: Math.round(elapsed * 10) / 10,
    message: `RADAR: New contact emerging \u2014 ${label}`,
  });

  return events;
}

export function tickWaves(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];
  if (gs.scenario.waves_enabled === false) return events;
  const threatDrones = gs.drones.filter(d => !d.is_ambient);
  if (!gs.pending_spawns.length && threatDrones.length && threatDrones.every(d => d.neutralized)) {
    if (gs.wave_all_neutralized_time === null) {
      gs.wave_all_neutralized_time = elapsed;
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: 'ALL THREATS NEUTRALIZED \u2014 MAINTAINING WATCH',
      });
    } else if (elapsed - gs.wave_all_neutralized_time >= gs.wave_pause_seconds) {
      gs.current_wave++;
      gs.wave_all_neutralized_time = null;
      gs.wave_pause_seconds = 30 + Math.random() * 30;
      const [newCfgs, newCounter] = generateWaveDrones(gs.current_wave, gs.wave_drone_counter, gs.scenario.id);
      gs.wave_drone_counter = newCounter;
      for (const wcfg of newCfgs) {
        gs.drone_configs.set(wcfg.id, wcfg);
        gs.pending_spawns.push({ ...wcfg, spawn_delay: elapsed + wcfg.spawn_delay });
      }
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `WARNING: WAVE ${gs.current_wave} \u2014 NEW CONTACTS INBOUND`,
      });
    }
  } else {
    gs.wave_all_neutralized_time = null;
  }
  return events;
}

export function tickEffectorRecharge(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];
  for (const effState of gs.effector_states) {
    if (effState.type === 'rf_jam' || effState.type === 'electronic') continue;
    if (effState.status === 'recharging') {
      effState.recharge_remaining -= gs.tick_rate;
      if (effState.recharge_remaining <= 0) {
        effState.status = 'ready';
        effState.recharge_remaining = 0;
        events.push({
          type: 'event', timestamp: Math.round(elapsed * 10) / 10,
          message: `${effState.name}: Ready`,
        });
      }
    }
  }
  return events;
}

export function tickPassiveJamming(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];
  for (const effState of gs.effector_states) {
    if (effState.type !== 'rf_jam' && effState.type !== 'electronic') continue;
    if (!effState.jammer_active) continue;
    if ((effState.recharge_remaining ?? 0) > 0) continue;

    const effX = effState.x ?? 0;
    const effY = effState.y ?? 0;
    const rangeKm = effState.range_km ?? 3.0;

    for (let i = 0; i < gs.drones.length; i++) {
      const drone = gs.drones[i];
      if (drone.neutralized || drone.is_interceptor) continue;
      if (drone.shenobi_cm_active) continue;
      if ((drone.jam_cooldown ?? 0) > 0) continue;
      const dist = Math.sqrt((drone.x - effX) ** 2 + (drone.y - effY) ** 2);
      if (dist > rangeKm) continue;

      const updateFields: Partial<DroneState> = {};
      let rfApplied = false;
      let pntApplied = false;

      // RF jamming
      if (!drone.jammed) {
        const behavior = pickJamBehavior(drone.drone_type);
        if (behavior === null) {
          if (!gs.jam_resist_notified.has(drone.id)) {
            gs.jam_resist_notified.add(drone.id);
            events.push({
              type: 'event', timestamp: Math.round(elapsed * 10) / 10,
              message: `RF JAM: ${(drone.display_label || drone.id).toUpperCase()} \u2014 RESISTANT (no effect)`,
            });
          }
        } else {
          const jamDuration = 5 + Math.random() * 5;
          // Don't mark defeated at jam start — drone is still flying/visible.
          // defeated is set when neutralized=true resolves in jamming.ts tick.
          updateFields.jammed = true;
          updateFields.jammed_behavior = behavior;
          updateFields.jammed_time_remaining = jamDuration;
          if (!gs.engage_times.has(drone.id)) gs.engage_times.set(drone.id, elapsed);
          if (!gs.effector_used.has(drone.id)) gs.effector_used.set(drone.id, effState.type);
          events.push({
            type: 'event', timestamp: Math.round(elapsed * 10) / 10,
            message: `RF JAM: ${(drone.display_label || drone.id).toUpperCase()} \u2014 ${behavior.replace(/_/g, ' ').toUpperCase()}`,
          });
          rfApplied = true;
        }
      }

      // PNT jamming
      if (!drone.pnt_jammed) {
        const [pntEffective, pntDrift] = applyPntJamming(drone.drone_type);
        if (pntEffective) {
          const pntDuration = 15 + Math.random() * 10;
          updateFields.pnt_jammed = true;
          updateFields.pnt_drift_magnitude = pntDrift;
          updateFields.pnt_jammed_time_remaining = pntDuration;
          pntApplied = true;
          if (!rfApplied) {
            const pntKey = `pnt_${drone.id}`;
            if (!gs.jam_resist_notified.has(pntKey)) {
              gs.jam_resist_notified.add(pntKey);
              events.push({
                type: 'event', timestamp: Math.round(elapsed * 10) / 10,
                message: `PNT: ${(drone.display_label || drone.id).toUpperCase()} \u2014 NAVIGATION DEGRADED (${Math.round(pntDuration)}s)`,
              });
            }
            if (!gs.engage_times.has(drone.id)) gs.engage_times.set(drone.id, elapsed);
            if (!gs.effector_used.has(drone.id)) gs.effector_used.set(drone.id, effState.type);
          }
        }
      }

      if (Object.keys(updateFields).length > 0) {
        gs.drones[i] = { ...drone, ...updateFields };
      }
    }
  }
  return events;
}

export function tickDrones(gs: GameState, elapsed: number): Msg[] {
  const events: Msg[] = [];

  for (let i = 0; i < gs.drones.length; i++) {
    const drone = gs.drones[i];
    if (drone.neutralized) {
      _updateSensorRuntime(gs, i);
      continue;
    }

    // JACKAL interceptor
    if (drone.is_interceptor) {
      const [updated, mutations, cevents, engResults] = updateJackal(drone, gs.drones, gs.tick_rate, elapsed);
      gs.drones[i] = updated;
      events.push(...cevents, ...engResults);
      for (const mutated of mutations) {
        for (let mi = 0; mi < gs.drones.length; mi++) {
          if (gs.drones[mi].id === mutated.id) {
            gs.drones[mi] = mutated;
            break;
          }
        }
      }
      continue;
    }

    // Shenobi CM active — highest priority, overrides RF/PNT jam movement
    if (gs.drones[i].shenobi_cm_active) {
      const [updated, nevents] = updateShenobiDrone(gs.drones[i], gs.tick_rate, elapsed);
      gs.drones[i] = updated;
      events.push(...nevents);
      continue;
    }

    // RF-jammed drone
    if (drone.jammed) {
      const [updated, jevents] = updateJammedDrone(drone, gs.tick_rate, elapsed);
      gs.drones[i] = updated;
      events.push(...jevents);
      continue;
    }

    // PNT-jammed drone
    if (drone.pnt_jammed) {
      const [updated, pevents] = updatePntJammedDrone(drone, gs.tick_rate, elapsed);
      gs.drones[i] = updated;
      events.push(...pevents);
      continue;
    }

    // Decrement jam cooldown (post-atti_mode lockout)
    if ((gs.drones[i].jam_cooldown ?? 0) > 0) {
      gs.drones[i] = { ...gs.drones[i], jam_cooldown: Math.max(0, gs.drones[i].jam_cooldown - gs.tick_rate) };
    }

    // Tutorial gate
    if (gs.scenario.tutorial && !gs.drones[i].is_ambient && _tutorialGateActive(gs, gs.drones[i])) {
      // Drone holds position
    } else {
      // Normal movement
      const cfg = gs.drone_configs.get(gs.drones[i].id);
      if (cfg) {
        gs.drones[i] = moveDrone(gs.drones[i], gs.tick_rate, gs.behaviors.get(gs.drones[i].id) || 'direct_approach', {
          waypoints: cfg.waypoints ?? undefined,
          orbit_radius: cfg.orbit_radius ?? 1.5,
          orbit_center: cfg.orbit_center ?? undefined,
          detected_by_player: gs.drones[i].detected,
          evasive_states: gs.evasive_states,
        });
      }
    }

    // Base proximity — polygon check if available, radial fallback
    if (!gs.drones[i].is_ambient) {
      const drone = gs.drones[i];
      const inBase = gs.boundary_polygon.length >= 3
        ? pointInPolygon(drone.x, drone.y, gs.boundary_polygon)
        : distanceToBase(drone) < gs.scenario.base_radius_km;
      if (inBase) {
        gs.drone_reached_base = true;
        const breachKey = `breach_${drone.id}`;
        if (!gs.event_flags.has(breachKey)) {
          gs.event_flags.add(breachKey);
          events.push({
            type: 'base_breach',
            timestamp: Math.round(elapsed * 10) / 10,
            drone_id: drone.id,
            message: `\u26a0 BASE PERIMETER BREACHED \u2014 ${drone.drone_type.toUpperCase()} INSIDE WIRE`,
          });
        }
      }
    }

    // Remove ambient objects that leave the map
    if (gs.drones[i].is_ambient) {
      const dist = Math.sqrt(gs.drones[i].x ** 2 + gs.drones[i].y ** 2);
      if (dist > 12.0) {
        gs.drones[i] = { ...gs.drones[i], neutralized: true };
      }
    }

    // Sensor detection
    if (!gs.drones[i].neutralized && !gs.drones[i].is_interceptor) {
      events.push(..._runSensorsForDrone(gs, i, elapsed));
    }
  }

  return events;
}

function _runSensorsForDrone(gs: GameState, i: number, elapsed: number): Msg[] {
  const events: Msg[] = [];
  let drone = gs.drones[i];
  const [detectingIds, readings] = updateSensors(drone, gs.sensor_configs, gs.terrain);
  const dist = distanceToBase(drone);
  const confidence = calculateConfidence(detectingIds, dist);

  // Shenobi RF data
  const shenobiUpdates: Partial<DroneState> = {};
  for (const reading of readings) {
    const r = reading as unknown as Record<string, unknown>;
    if (r.is_shenobi) {
      shenobiUpdates.frequency_band = r.frequency_band as string;
      shenobiUpdates.downlink_detected = r.downlink_detected as boolean;
      shenobiUpdates.uplink_detected = r.uplink_detected as boolean;
    }
  }
  if (Object.keys(shenobiUpdates).length > 0) {
    // Log event when uplink is first detected (enables Shenobi 1/2 → 2/2 transition)
    const prevUplink = gs.drones[i].uplink_detected;
    gs.drones[i] = { ...gs.drones[i], ...shenobiUpdates };
    drone = gs.drones[i];
    if (!prevUplink && shenobiUpdates.uplink_detected) {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — UPLINK DETECTED (protocol acquisition possible)`,
      });
    }
  }

  // First detection time
  if (detectingIds.length > 0 && !gs.detection_times.has(drone.id)) {
    gs.detection_times.set(drone.id, elapsed);
  }

  // Sensor acquisition/loss events
  const prev = gs.previously_detected.get(drone.id) ?? new Set<string>();
  const newSensors = new Set(detectingIds.filter(id => !prev.has(id)));
  if (prev.size === 0 && detectingIds.length > 0) {
    const hasNexus = readings.some(r => (r as unknown as Record<string, unknown>).is_shenobi);
    const hasNonNexusRadar = detectingIds.some(sid =>
      !sid.toLowerCase().includes('shenobi') &&
      (sid.toLowerCase().includes('radar') || sid.toLowerCase().includes('tpq') || sid.toLowerCase().includes('kufcs'))
    );
    const detectLabel = hasNexus && !hasNonNexusRadar ? 'Shenobi RF' : 'RADAR';
    events.push({
      type: 'event', timestamp: Math.round(elapsed * 10) / 10,
      message: `${detectLabel}: New contact detected \u2014 ${(drone.display_label || drone.id).toUpperCase()}`,
    });
  } else {
    for (const sid of newSensors) {
      const sensorName = sid.toUpperCase().replace(/_/g, ' ');
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `${sensorName}: Acquiring ${(drone.display_label || drone.id).toUpperCase()}`,
      });
    }
  }
  for (const sid of prev) {
    if (!detectingIds.includes(sid)) {
      const sensorName = sid.toUpperCase().replace(/_/g, ' ');
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `${sensorName}: Lost contact \u2014 ${(drone.display_label || drone.id).toUpperCase()}`,
      });
    }
  }
  gs.previously_detected.set(drone.id, new Set(detectingIds));

  // Track coasting
  const droneId = drone.id;
  const wasDetected = drone.detected;
  const nowDetecting = detectingIds.length > 0;

  if (nowDetecting) {
    gs.coast_sensor_loss_time.delete(droneId);
    if (drone.coasting) {
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${droneId.toUpperCase()} \u2014 Sensor contact reacquired`,
      });
    }
    gs.drones[i] = {
      ...drone,
      detected: true, sensors_detecting: detectingIds,
      confidence, coasting: false, coast_start_time: 0,
    };
  } else if (wasDetected || drone.coasting) {
    if (!gs.coast_sensor_loss_time.has(droneId)) {
      gs.coast_sensor_loss_time.set(droneId, elapsed);
      gs.drones[i] = {
        ...gs.drones[i],
        last_known_heading: drone.heading,
        last_known_speed: drone.speed,
      };
    }

    const timeWithout = elapsed - gs.coast_sensor_loss_time.get(droneId)!;

    if (timeWithout >= gs.coast_drop_time) {
      gs.drones[i] = {
        ...gs.drones[i],
        detected: false, coasting: false,
        sensors_detecting: [], confidence: 0,
      };
      gs.coast_sensor_loss_time.delete(droneId);
      events.push({
        type: 'event', timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${droneId.toUpperCase()} \u2014 Track dropped (coast timeout)`,
      });
    } else if (timeWithout >= gs.coast_delay) {
      if (!drone.coasting) {
        events.push({
          type: 'event', timestamp: Math.round(elapsed * 10) / 10,
          message: `TRACK: ${droneId.toUpperCase()} \u2014 Coasting (extrapolating)`,
        });
      }
      const cur = gs.drones[i];
      const headingRad = cur.last_known_heading * Math.PI / 180;
      const speedKms = cur.last_known_speed * KTS_TO_KMS;
      const newX = cur.x + Math.cos(headingRad) * speedKms * gs.tick_rate;
      const newY = cur.y + Math.sin(headingRad) * speedKms * gs.tick_rate;
      let newTrail = [...cur.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]];
      if (newTrail.length > 20) newTrail = newTrail.slice(-20);
      gs.drones[i] = {
        ...cur,
        detected: true, coasting: true,
        coast_start_time: gs.coast_sensor_loss_time.get(droneId)!,
        sensors_detecting: [], confidence: Math.max(0, confidence - 0.1),
        x: newX, y: newY, trail: newTrail,
      };
    } else {
      gs.drones[i] = {
        ...gs.drones[i],
        detected: true, sensors_detecting: detectingIds, confidence,
      };
    }
  } else {
    gs.drones[i] = {
      ...gs.drones[i],
      detected: false, sensors_detecting: detectingIds, confidence,
    };
  }

  _updateSensorRuntime(gs, i);
  return events;
}

function _updateSensorRuntime(gs: GameState, droneIdx: number): void {
  const drone = gs.drones[droneIdx];
  for (const sr of gs.sensor_runtime) {
    const idx = sr.detecting.indexOf(drone.id);
    if (idx >= 0) sr.detecting.splice(idx, 1);
    if (drone.sensors_detecting.includes(sr.id)) {
      sr.detecting.push(drone.id);
    }
  }
}

// ---------------------------------------------------------------------------
// State message builder
// ---------------------------------------------------------------------------

export function buildStateMsg(gs: GameState, elapsed: number, timeRemaining: number): Msg {
  const tracks: Msg[] = [];
  for (const drone of gs.drones) {
    if (drone.detected || drone.neutralized) {
      let etaSeconds: number | null = null;
      if (!drone.neutralized && drone.speed > 0) {
        const dx = drone.x - gs.protected_area_center[0];
        const dy = drone.y - gs.protected_area_center[1];
        const distToCenter = Math.sqrt(dx * dx + dy * dy);
        const distToEdge = Math.max(0, distToCenter - gs.protected_area_radius);
        const speedKms = drone.speed * KTS_TO_KMS;
        if (speedKms > 0) etaSeconds = distToEdge / speedKms;
      }

      tracks.push({
        id: drone.id,
        display_label: drone.display_label || drone.id,
        dtid_phase: drone.dtid_phase,
        affiliation: drone.affiliation,
        x: Math.round(drone.x * 1000) / 1000,
        y: Math.round(drone.y * 1000) / 1000,
        altitude_ft: Math.round(drone.altitude),
        speed_kts: Math.round(drone.speed),
        heading_deg: Math.round(drone.heading * 10) / 10,
        confidence: drone.confidence,
        classification: drone.classification,
        trail: drone.trail,
        sensors_detecting: drone.sensors_detecting,
        neutralized: drone.neutralized,
        coasting: drone.coasting,
        hold_fire: gs.hold_fire_tracks.has(drone.id),
        eta_protected: etaSeconds !== null ? Math.round(etaSeconds * 10) / 10 : null,
        wave_number: drone.wave_number,
        is_ambient: drone.is_ambient,
        jammed: drone.jammed,
        jammed_behavior: drone.jammed_behavior,
        pnt_jammed: drone.pnt_jammed,
        is_interceptor: drone.is_interceptor,
        interceptor_target: drone.interceptor_target,
        intercept_phase: drone.intercept_phase,
        frequency_band: drone.frequency_band,
        uplink_detected: drone.uplink_detected,
        downlink_detected: drone.downlink_detected,
        shenobi_cm_active: drone.shenobi_cm_active,
        shenobi_cm_state: drone.shenobi_cm_state,
        drone_type: drone.drone_type,
        spinup_remaining: Math.round(drone.spinup_remaining * 10) / 10,
      });
    }
  }

  return {
    type: 'state',
    elapsed: Math.round(elapsed * 10) / 10,
    time_remaining: Math.round(timeRemaining * 10) / 10,
    threat_level: threatLevel(gs.drones),
    wave_number: gs.current_wave,
    tracks,
    sensors: gs.sensor_runtime.map(sr => ({ id: sr.id, status: sr.status, detecting: sr.detecting })),
    effectors: gs.effector_states.map(es => ({
      id: es.id, name: es.name ?? '', type: es.type ?? '',
      status: es.status,
      ...(es.ammo_count !== null ? { ammo_count: es.ammo_count } : {}),
      ...(es.ammo_remaining !== null ? { ammo_remaining: es.ammo_remaining } : {}),
      ...(es.jammer_active !== undefined ? { jammer_active: es.jammer_active } : {}),
    })),
    ambient_suppressed_until: Math.round(gs.ambient_suppressed_until * 10) / 10,
    paused: gs.paused,
    ...(gs.scenario.tutorial ? { tutorial_step: gs.tutorial_step } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------

function _tutorialGateActive(gs: GameState, drone: DroneState): boolean {
  if (gs.tutorial_step === 0 && drone.detected) {
    gs.tutorial_step = 1;
  }
  return false;
}

export function advanceTutorialStep(
  gs: GameState, actionName: string, targetId: string, effectorId?: string,
): Msg[] {
  if (!gs.scenario.tutorial) return [];
  const msgs: Msg[] = [];
  const step = gs.tutorial_step;

  if (step === 1 && actionName === 'confirm_track') {
    gs.tutorial_step = 2;
    msgs.push({
      type: 'tutorial',
      message: 'Track confirmed. Now slew the EO/IR Camera to get a visual on the target. Use the Radial Action Wheel (right-click the track) \u2192 SLEW CAMERA, or use the button in the Engagement Panel.',
    });
  } else if (step === 2 && actionName === 'slew_camera') {
    gs.tutorial_step = 3;
    gs.tutorial_camera_slewed = true;
    msgs.push({
      type: 'tutorial',
      message: 'Camera is locked on. Study the silhouette \u2014 this determines your classification. When ready, proceed to IDENTIFY.',
    });
  } else if (actionName === 'identify' && (step === 2 || step === 3)) {
    if (step === 2) {
      gs.tutorial_step = 3;
      gs.tutorial_camera_slewed = true;
    }
    gs.tutorial_step = 4;
    const drone = gs.drones.find(d => d.id === targetId);
    if (drone) {
      const cfg = gs.drone_configs.get(targetId);
      const givenCls = gs.classification_given.get(targetId);
      const correctCls = cfg?.correct_classification ?? gs.scenario.correct_classification;
      if (givenCls && givenCls !== correctCls) {
        msgs.push({
          type: 'tutorial_feedback',
          message: 'Incorrect classification. Check the camera feed \u2014 look at the silhouette shape.',
          severity: 'warning',
        });
      }
    }
    msgs.push({
      type: 'tutorial',
      message: 'Contact classified. Now declare the affiliation — is this track HOSTILE, NEUTRAL, FRIENDLY, or UNKNOWN? Use the buttons in the Engagement Panel or the Radial Action Wheel.',
    });
  } else if (step === 4 && actionName === 'declare_affiliation') {
    gs.tutorial_step = 5;
    msgs.push({
      type: 'tutorial',
      message: 'Affiliation declared. Now select an effector to engage. RF/PNT Jammer is the optimal choice for a commercial quad \u2014 it has low collateral risk.',
    });
  } else if ((step === 4 || step === 5) && actionName === 'engage') {
    let effState = null;
    if (effectorId) {
      for (const es of gs.effector_states) {
        if (es.id === effectorId) { effState = es; break; }
      }
    }
    if (effState?.type === 'kinetic') {
      const drone = gs.drones.find(d => d.id === targetId);
      if (drone?.drone_type === 'commercial_quad') {
        msgs.push({
          type: 'tutorial_feedback',
          message: 'JACKAL is overkill for a commercial quad \u2014 high collateral risk. Jammer is the optimal choice.',
          severity: 'warning',
        });
      }
    }
    gs.tutorial_step = 6;
  }

  return msgs;
}

export function checkTutorialPrompts(gs: GameState): Msg[] {
  if (!gs.scenario.tutorial || !gs.scenario.tutorial_prompts) return [];
  const msgs: Msg[] = [];
  for (const tp of gs.scenario.tutorial_prompts) {
    const trigger = tp.trigger;
    if (gs.tutorial_prompts_sent.has(trigger)) continue;
    let shouldSend = false;
    if (trigger === 'detected') {
      shouldSend = gs.drones.some(d => d.detected) && gs.tutorial_step >= 1;
    } else if (trigger === 'tracked') {
      shouldSend = gs.tutorial_step >= 2;
    } else if (trigger === 'identify_ready') {
      continue;
    } else if (trigger === 'identified') {
      shouldSend = gs.tutorial_step >= 4;
    } else if (trigger === 'defeated') {
      shouldSend = gs.tutorial_step >= 6;
      if (shouldSend) gs.tutorial_step = 7;
    }
    if (shouldSend) {
      msgs.push({ type: 'tutorial', message: tp.message });
      gs.tutorial_prompts_sent.add(trigger);
    }
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export function buildDebrief(gs: GameState, catalog?: EquipmentCatalog): Msg {
  const ambientTypes = new Set(['passenger_aircraft', 'military_jet', 'weather_balloon']);
  let threatDroneCfgs: DroneStartConfig[] = [];
  for (const cfg of gs.drone_configs.values()) {
    if (ambientTypes.has(cfg.drone_type)) continue;
    if (cfg.drone_type === 'bird' && cfg.correct_affiliation === 'neutral') continue;
    threatDroneCfgs.push(cfg);
  }
  // Include ambient objects that were engaged (ROE violations)
  for (const a of gs.actions) {
    if (a.action === 'engage') {
      const cfg = gs.drone_configs.get(a.target_id);
      if (cfg && !cfg.should_engage && !threatDroneCfgs.includes(cfg)) {
        threatDroneCfgs.push(cfg);
      }
    }
  }

  const scorableCfgs = threatDroneCfgs.length > 0 ? threatDroneCfgs : Array.from(gs.drone_configs.values());

  // Build drone speed lookup from configs
  const droneSpeeds = new Map<string, number>();
  for (const cfg of scorableCfgs) {
    droneSpeeds.set(cfg.id, cfg.speed);
  }

  let score;
  if (scorableCfgs.length <= 1) {
    const primaryCfg = scorableCfgs[0] ?? null;
    const pid = primaryCfg?.id ?? '';
    score = calculateScore(
      gs.scenario, gs.actions,
      gs.detection_times.get(pid) ?? 0,
      gs.confirm_times.get(pid) ?? null,
      gs.identify_times.get(pid) ?? null,
      gs.engage_times.get(pid) ?? null,
      gs.classification_given.get(pid) ?? null,
      gs.affiliation_given.get(pid) ?? null,
      gs.effector_used.get(pid) ?? null,
      gs.drone_reached_base,
      gs.confidence_at_identify.get(pid) ?? 0,
      gs.first_click_times.get(pid) ?? null,
      droneSpeeds.get(pid) ?? 0,
      gs.placement_config,
      gs.base_template,
      catalog,
    );
  } else {
    const dronesReached = new Set(
      gs.drones.filter(d => !d.is_ambient && (
        gs.boundary_polygon.length >= 3
          ? pointInPolygon(d.x, d.y, gs.boundary_polygon)
          : distanceToBase(d) < gs.scenario.base_radius_km
      )).map(d => d.id)
    );
    score = calculateScoreMulti(
      gs.scenario, scorableCfgs, gs.actions,
      gs.detection_times,
      gs.confirm_times,
      gs.identify_times,
      gs.engage_times,
      gs.classification_given,
      gs.affiliation_given,
      gs.effector_used,
      dronesReached,
      gs.confidence_at_identify,
      gs.first_click_times,
      droneSpeeds,
      gs.placement_config,
      gs.base_template,
      catalog,
    );
  }

  const elapsed = Date.now() / 1000 - gs.start_time - gs.total_paused_seconds;
  const { completion_multiplier, time_bonus_detail } = applyCompletionMultiplier(elapsed, gs.max_duration);
  score.total_score = Math.round(score.total_score * completion_multiplier * 10) / 10;
  score.grade = score.total_score >= 95 ? 'S'
    : score.total_score >= 85 ? 'A'
    : score.total_score >= 70 ? 'B'
    : score.total_score >= 50 ? 'C' : 'F';
  score.completion_multiplier = completion_multiplier;
  score.time_bonus_detail = time_bonus_detail;

  // Debrief notes for hardened FPV EW saturation
  const debriefNotes: string[] = [];
  for (const d of gs.drones) {
    if (d.drone_type !== 'improvised_hardened') continue;
    const jamAttempts = gs.actions.filter(a => a.action === 'engage' && a.target_id === d.id && a.effector).length;
    if (jamAttempts >= 3) {
      debriefNotes.push('EW saturation on hardened FPV \u2014 consider kinetic defeat on frequency-hop targets');
      break;
    }
  }

  return {
    type: 'debrief',
    score,
    drone_reached_base: gs.drone_reached_base,
    waves_completed: gs.current_wave,
    debrief_notes: debriefNotes.length > 0 ? debriefNotes : undefined,
  };
}
