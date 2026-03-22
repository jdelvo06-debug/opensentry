/**
 * SKYSHIELD drone movement — ported from backend/app/drone.py
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
// Evasive state (module-level — shared across connections, same as Python)
// ---------------------------------------------------------------------------

interface EvasiveState {
  offset_rad: number;
  alt_offset: number;
  next_jink: number;
  tick_counter: number;
}

const _evasiveState: Map<string, EvasiveState> = new Map();

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
    shinobi_cm_active: null,
    shinobi_cm_state: null,
    shinobi_cm_time_remaining: 0,
    shinobi_cm_initial_duration: 0,
    display_label: '',
  };
}

export interface MoveDroneOptions {
  waypoints?: number[][] | null;
  orbit_radius?: number;
  orbit_center?: number[] | null;
  detected_by_player?: boolean;
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
  } = options;

  switch (behavior) {
    case 'direct_approach':
      return _directApproach(drone, dt);
    case 'orbit':
      return _orbit(drone, dt, orbit_radius, orbit_center ?? [0, 0]);
    case 'waypoint_path':
      return _waypointPath(drone, dt, waypoints ?? []);
    case 'evasive':
      return _evasive(drone, dt, detected_by_player);
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
): DroneState {
  // Until detected, fly straight in
  if (!detected_by_player) return _directApproach(drone, dt);

  // Initialise evasive state on first call
  if (!_evasiveState.has(drone.id)) {
    _evasiveState.set(drone.id, {
      offset_rad: 0.0,
      alt_offset: 0.0,
      next_jink: 0.0,
      tick_counter: 0.0,
    });
  }

  const state = _evasiveState.get(drone.id)!;
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
