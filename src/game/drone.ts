/**
 * OpenSentry drone movement — ported from backend/app/drone.py
 *
 * All movement behaviors: direct_approach, orbit, waypoint_path, evasive.
 * Module-level evasive state map (blocks multiplayer — mirrors Python caveat).
 */

import type { DroneState, DroneStartConfig } from './state';
import { KTS_TO_KMS } from './helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TRAIL_LENGTH = 20;

// ---------------------------------------------------------------------------
// Evasive state type (stored per-GameState, not module-level)
// ---------------------------------------------------------------------------

export interface EvasiveState {
  offset_rad: number;
  alt_offset: number;
  next_jink: number;
  tick_counter: number;
}

// ---------------------------------------------------------------------------
// Erratic wander state (for birds and ambient tracks)
// ---------------------------------------------------------------------------

export interface ErraticState {
  heading_offset: number;
  speed_factor: number;
  next_turn: number;
  tick_counter: number;
}

// ---------------------------------------------------------------------------
// Drift-ascend state (for weather balloons)
// ---------------------------------------------------------------------------

export interface DriftAscendState {
  altitude_gain_rate: number;
  lateral_drift_offset: number;
  next_drift: number;
  tick_counter: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a DroneState from a scenario spawn config. */
export function createDroneFromConfig(config: DroneStartConfig): DroneState {
  return {
    id: config.id,
    drone_type: config.drone_type,
    x: config.start_x,
    y: config.start_y,
    altitude: config.altitude,
    speed: config.speed,
    heading: config.heading,
    rf_emitting: config.rf_emitting,
    trail: [[config.start_x, config.start_y]],
    // defaults
    detected: false,
    classified: false,
    classification: null,
    neutralized: false,
    dtid_phase: 'detected',
    affiliation: 'unknown',
    confidence: 0,
    sensors_detecting: [],
    coasting: false,
    coast_start_time: 0,
    last_known_heading: 0,
    last_known_speed: 0,
    hold_fire: false,
    wave_number: 1,
    is_ambient: false,
    jammed: false,
    jammed_behavior: null,
    jammed_time_remaining: 0,
    pnt_jammed: false,
    pnt_drift_magnitude: 0,
    pnt_jammed_time_remaining: 0,
    is_interceptor: false,
    interceptor_target: null,
    intercept_phase: null,
    spinup_remaining: 0,
    intercept_attempts: 0,
    frequency_band: null,
    uplink_detected: false,
    downlink_detected: false,
    shenobi_cm_active: null,
    shenobi_cm_state: null,
    shenobi_cm_time_remaining: 0,
    shenobi_cm_initial_duration: 0,
    display_label: '',
    jam_cooldown: 0,
    remove_at: null,
  };
}

export interface MoveDroneOptions {
  waypoints?: number[][] | null;
  orbit_radius?: number;
  orbit_center?: number[] | null;
  detected_by_player?: boolean;
  /** Per-game evasive state map (from GameState.evasive_states). */
  evasive_states?: Map<string, EvasiveState>;
  /** Per-game erratic wander state map (from GameState.erratic_states). */
  erratic_states?: Map<string, ErraticState>;
  /** Per-game drift-ascend state map (from GameState.drift_ascend_states). */
  drift_ascend_states?: Map<string, DriftAscendState>;
}

/** Update a drone's position for one tick. Returns a new DroneState (immutable). */
export function moveDrone(
  drone: DroneState,
  dt: number,
  behavior: string,
  options: MoveDroneOptions = {},
): DroneState {
  if (drone.neutralized) return drone;

  const {
    waypoints = null,
    orbit_radius = 1.5,
    orbit_center = null,
    detected_by_player = false,
    evasive_states,
    erratic_states,
    drift_ascend_states,
  } = options;

  switch (behavior) {
    case 'direct_approach':
      return _directApproach(drone, dt);
    case 'orbit':
      return _orbit(drone, dt, orbit_radius, orbit_center ?? [0, 0]);
    case 'waypoint_path':
      return _waypointPath(drone, dt, waypoints ?? []);
    case 'evasive':
      return _evasive(drone, dt, detected_by_player, evasive_states);
    case 'erratic_wander':
      return _erraticWander(drone, dt, waypoints ?? [], erratic_states);
    case 'drift_ascend':
      return _driftAscend(drone, dt, waypoints ?? [], drift_ascend_states);
    default:
      return _directApproach(drone, dt);
  }
}

/** Euclidean distance from drone position to base (origin). */
export function distanceToBase(drone: DroneState): number {
  return Math.sqrt(drone.x ** 2 + drone.y ** 2);
}

// ---------------------------------------------------------------------------
// Movement behaviors (private)
// ---------------------------------------------------------------------------

function _directApproach(drone: DroneState, dt: number): DroneState {
  const dist = Math.sqrt(drone.x ** 2 + drone.y ** 2);
  if (dist < 0.01) return drone;

  const angle = Math.atan2(-drone.y, -drone.x);
  const speed_kms = drone.speed * KTS_TO_KMS;
  const dx = Math.cos(angle) * speed_kms * dt;
  const dy = Math.sin(angle) * speed_kms * dt;

  let new_x = drone.x + dx;
  let new_y = drone.y + dy;

  // Don't overshoot the origin
  const new_dist = Math.sqrt(new_x ** 2 + new_y ** 2);
  if (new_dist > dist) {
    new_x = 0.0;
    new_y = 0.0;
  }

  const heading_deg = ((angle * 180) / Math.PI + 360) % 360;
  const trail = _updateTrail(drone.trail, new_x, new_y);

  return { ...drone, x: new_x, y: new_y, heading: heading_deg, trail };
}

function _orbit(
  drone: DroneState,
  dt: number,
  radius: number,
  center: number[],
): DroneState {
  const cx = center[0];
  const cy = center[1];
  const rel_x = drone.x - cx;
  const rel_y = drone.y - cy;
  const dist = Math.sqrt(rel_x ** 2 + rel_y ** 2);
  const speed_kms = drone.speed * KTS_TO_KMS;

  let new_x: number;
  let new_y: number;
  let heading_deg: number;

  if (dist < 0.01) {
    // At center — jump to orbit radius
    new_x = cx + radius;
    new_y = cy;
    heading_deg = 0.0;
  } else if (Math.abs(dist - radius) > 0.05) {
    // Spiraling in/out toward orbit radius
    const target_angle = Math.atan2(rel_y, rel_x);
    const radial_angle = dist > radius ? target_angle + Math.PI : target_angle;
    const tangent_angle = target_angle + Math.PI / 2;
    const blend = 0.5;

    const move_angle = Math.atan2(
      blend * Math.sin(radial_angle) + (1 - blend) * Math.sin(tangent_angle),
      blend * Math.cos(radial_angle) + (1 - blend) * Math.cos(tangent_angle),
    );

    const dx = Math.cos(move_angle) * speed_kms * dt;
    const dy = Math.sin(move_angle) * speed_kms * dt;
    new_x = drone.x + dx;
    new_y = drone.y + dy;
    heading_deg = ((move_angle * 180) / Math.PI + 360) % 360;
  } else {
    // On orbit — pure circular motion
    const current_angle = Math.atan2(rel_y, rel_x);
    const angular_speed = speed_kms / radius;
    const new_angle = current_angle + angular_speed * dt;
    new_x = cx + radius * Math.cos(new_angle);
    new_y = cy + radius * Math.sin(new_angle);
    heading_deg = ((new_angle + Math.PI / 2) * 180 / Math.PI + 360) % 360;
  }

  const trail = _updateTrail(drone.trail, new_x, new_y);
  return { ...drone, x: new_x, y: new_y, heading: heading_deg, trail };
}

function _waypointPath(
  drone: DroneState,
  dt: number,
  waypoints: number[][],
): DroneState {
  if (waypoints.length === 0) return _directApproach(drone, dt);

  // Find closest upcoming waypoint
  let targetIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const d = Math.sqrt((drone.x - wp[0]) ** 2 + (drone.y - wp[1]) ** 2);
    if (d < minDist) {
      minDist = d;
      targetIdx = i;
    }
  }

  // If close to current waypoint, advance to next
  if (minDist < 0.05 && targetIdx < waypoints.length - 1) {
    targetIdx += 1;
  }

  const target = waypoints[targetIdx];
  const dx_target = target[0] - drone.x;
  const dy_target = target[1] - drone.y;
  const dist = Math.sqrt(dx_target ** 2 + dy_target ** 2);

  if (dist < 0.01) {
    // Arrived at final waypoint — hold position
    const trail = _updateTrail(drone.trail, drone.x, drone.y);
    return { ...drone, trail };
  }

  const angle = Math.atan2(dy_target, dx_target);
  const speed_kms = drone.speed * KTS_TO_KMS;
  const step = speed_kms * dt;

  let new_x: number;
  let new_y: number;

  if (step >= dist) {
    new_x = target[0];
    new_y = target[1];
  } else {
    new_x = drone.x + Math.cos(angle) * step;
    new_y = drone.y + Math.sin(angle) * step;
  }

  const heading_deg = ((angle * 180) / Math.PI + 360) % 360;
  const trail = _updateTrail(drone.trail, new_x, new_y);

  return { ...drone, x: new_x, y: new_y, heading: heading_deg, trail };
}

function _evasive(
  drone: DroneState,
  dt: number,
  detected_by_player: boolean,
  evasive_states?: Map<string, EvasiveState>,
): DroneState {
  // Until detected, fly straight in
  if (!detected_by_player) return _directApproach(drone, dt);

  // Use provided per-game state map (falls back to a local map for backwards compat)
  const stateMap = evasive_states ?? new Map<string, EvasiveState>();

  // Initialise evasive state on first call
  if (!stateMap.has(drone.id)) {
    stateMap.set(drone.id, {
      offset_rad: 0.0,
      alt_offset: 0.0,
      next_jink: 0.0,
      tick_counter: 0.0,
    });
  }

  const state = stateMap.get(drone.id)!;
  state.tick_counter += dt;

  // Time for a new jink?
  if (state.tick_counter >= state.next_jink) {
    const offsetDeg = _randomRange(30, 60) * _randomChoice();
    state.offset_rad = (offsetDeg * Math.PI) / 180;
    state.alt_offset = _randomRange(25, 50) * _randomChoice();
    state.next_jink = state.tick_counter + _randomRange(2.0, 4.0);
  }

  const speed_kms = drone.speed * KTS_TO_KMS;
  const base_angle = Math.atan2(-drone.y, -drone.x);
  const angle = base_angle + state.offset_rad;

  const dx = Math.cos(angle) * speed_kms * dt;
  const dy = Math.sin(angle) * speed_kms * dt;
  const new_x = drone.x + dx;
  const new_y = drone.y + dy;
  const new_alt = Math.max(30, Math.min(500, drone.altitude + state.alt_offset * dt));
  const heading_deg = ((angle * 180) / Math.PI + 360) % 360;
  const trail = _updateTrail(drone.trail, new_x, new_y);

  return {
    ...drone,
    x: new_x,
    y: new_y,
    altitude: new_alt,
    heading: heading_deg,
    trail,
  };
}

function _erraticWander(
  drone: DroneState,
  dt: number,
  waypoints: number[][],
  erratic_states?: Map<string, ErraticState>,
): DroneState {
  const stateMap = erratic_states ?? new Map<string, ErraticState>();

  // Initialise erratic state on first call
  if (!stateMap.has(drone.id)) {
    stateMap.set(drone.id, {
      heading_offset: 0.0,
      speed_factor: 1.0,
      next_turn: _randomRange(1.5, 4.0),
      tick_counter: 0.0,
    });
  }

  const state = stateMap.get(drone.id)!;
  state.tick_counter += dt;

  // Time for a heading change?
  if (state.tick_counter >= state.next_turn) {
    // Random heading offset between -45 and +45 degrees (erratic but still outbound)
    state.heading_offset = _randomRange(-45, 45) * (Math.PI / 180);
    // Speed varies (birds speed up and slow down)
    state.speed_factor = _randomRange(0.6, 1.2);
    state.next_turn = state.tick_counter + _randomRange(2.0, 5.0);
  }

  // Base heading: toward exit waypoint if available, otherwise away from base
  let baseAngle: number;
  if (waypoints.length > 0) {
    const wp = waypoints[waypoints.length - 1];
    const distToWp = Math.sqrt((drone.x - wp[0]) ** 2 + (drone.y - wp[1]) ** 2);
    if (distToWp < 0.3) {
      // Reached exit waypoint — keep drifting in current direction
      baseAngle = (drone.heading * Math.PI) / 180;
    } else {
      baseAngle = Math.atan2(wp[1] - drone.y, wp[0] - drone.x);
    }
  } else {
    // No waypoint — fly away from base center (opposite of toward-origin angle)
    baseAngle = Math.atan2(drone.y, drone.x) + Math.PI;
  }

  const angle = baseAngle + state.heading_offset;
  const speed_kms = drone.speed * KTS_TO_KMS * state.speed_factor;
  const dx = Math.cos(angle) * speed_kms * dt;
  const dy = Math.sin(angle) * speed_kms * dt;
  const new_x = drone.x + dx;
  const new_y = drone.y + dy;
  const heading_deg = ((angle * 180) / Math.PI + 360) % 360;

  // Slight altitude variation (birds go up and down)
  const alt_offset = _randomRange(-10, 10) * dt;
  const new_alt = Math.max(20, Math.min(2000, drone.altitude + alt_offset));

  const trail = _updateTrail(drone.trail, new_x, new_y);
  return { ...drone, x: new_x, y: new_y, altitude: new_alt, heading: heading_deg, trail };
}

function _driftAscend(
  drone: DroneState,
  dt: number,
  waypoints: number[][],
  drift_ascend_states?: Map<string, DriftAscendState>,
): DroneState {
  const stateMap = drift_ascend_states ?? new Map<string, DriftAscendState>();

  // Initialise drift-ascend state on first call
  if (!stateMap.has(drone.id)) {
    stateMap.set(drone.id, {
      altitude_gain_rate: _randomRange(50, 150),  // ft per tick-second
      lateral_drift_offset: 0.0,
      next_drift: _randomRange(5.0, 12.0),
      tick_counter: 0.0,
    });
  }

  const state = stateMap.get(drone.id)!;
  state.tick_counter += dt;

  // Drift direction changes occasionally
  if (state.tick_counter >= state.next_drift) {
    state.lateral_drift_offset = _randomRange(-30, 30) * (Math.PI / 180);
    state.next_drift = state.tick_counter + _randomRange(8.0, 15.0);
  }

  // Move toward waypoint with drift offset
  let baseAngle: number;
  if (waypoints.length > 0) {
    const wp = waypoints[waypoints.length - 1];
    baseAngle = Math.atan2(wp[1] - drone.y, wp[0] - drone.x);
  } else {
    // No waypoint — drift outward from base (opposite of toward-origin angle)
    baseAngle = Math.atan2(drone.y, drone.x) + Math.PI;
  }

  const angle = baseAngle + state.lateral_drift_offset;
  const speed_kms = drone.speed * KTS_TO_KMS;
  const dx = Math.cos(angle) * speed_kms * dt;
  const dy = Math.sin(angle) * speed_kms * dt;
  const new_x = drone.x + dx;
  const new_y = drone.y + dy;
  const heading_deg = ((angle * 180) / Math.PI + 360) % 360;

  // Steady altitude gain — balloon climbs out of detection range
  const new_alt = drone.altitude + state.altitude_gain_rate * dt;

  const trail = _updateTrail(drone.trail, new_x, new_y);
  return { ...drone, x: new_x, y: new_y, altitude: new_alt, heading: heading_deg, trail };
}

// ---------------------------------------------------------------------------
// Trail helper
// ---------------------------------------------------------------------------

function _updateTrail(
  trail: number[][],
  x: number,
  y: number,
): number[][] {
  const point: number[] = [
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
  ];
  const newTrail = [...trail, point];
  if (newTrail.length > MAX_TRAIL_LENGTH) {
    return newTrail.slice(newTrail.length - MAX_TRAIL_LENGTH);
  }
  return newTrail;
}

// ---------------------------------------------------------------------------
// Random helpers (mirrors Python random.uniform / random.choice([-1, 1]))
// ---------------------------------------------------------------------------

function _randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function _randomChoice(): -1 | 1 {
  return Math.random() < 0.5 ? -1 : 1;
}
