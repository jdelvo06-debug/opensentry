/**
 * Shenobi Protocol Manipulation — countermeasure logic and
 * drone behavior updates for Shenobi defeats.
 *
 * Countermeasure types:
 *   - HOLD:     Freeze drone in place (hover lock)
 *   - LAND NOW: Forced descent to ground
 *   - DEAFEN:   Sever control link (drone enters failsafe behavior)
 *
 * CM state progression:
 *   - 1/2 (downlink only): Partial effect — drone responds sluggishly
 *   - 2/2 (uplink acquired): Full protocol control — immediate effect
 *
 * Direct port of backend/app/shenobi.py to TypeScript.
 */

import type { DroneState, DroneType } from './state';
import { KTS_TO_KMS } from './helpers';

// ---------------------------------------------------------------------------
// Frequency band assignment (library-based detection)
// ---------------------------------------------------------------------------

export const DRONE_FREQUENCY_MAP: Record<string, string> = {
  commercial_quad: '2.4GHz',
  micro: '5.8GHz',
  fixed_wing: '900MHz',
  swarm: '2.4GHz',
};

// Drones that Shenobi cannot affect (no RF control link in library)
export const Shenobi_IMMUNE_TYPES: Set<DroneType> = new Set<DroneType>([
  'bird',
  'weather_balloon',
  'passenger_aircraft',
  'military_jet',
]);

// ---------------------------------------------------------------------------
// Vulnerability / effectiveness checks
// ---------------------------------------------------------------------------

/** Check if a drone can be affected by Shenobi protocol manipulation. */
export function isShenobiVulnerable(drone: DroneState): boolean {
  if (Shenobi_IMMUNE_TYPES.has(drone.drone_type)) return false;
  if (!drone.rf_emitting) return false;
  return true;
}

/**
 * Determine if a Shenobi countermeasure succeeds on this drone.
 *
 * Fixed-wing UAS with autonomous navigation have a 30% chance to resist.
 * All other RF-emitting types are reliably affected.
 */
export function pickShenobiCmEffectiveness(
  drone: DroneState,
  _cmType: string,
): boolean {
  if (drone.drone_type === ('fixed_wing' as DroneType)) {
    return Math.random() > 0.3; // 70% success
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event helper type
// ---------------------------------------------------------------------------

interface NexusEvent {
  type: string;
  timestamp: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Update Shenobi-affected drones (called each tick from game loop)
// ---------------------------------------------------------------------------

/**
 * Advance a drone under Shenobi countermeasure effect by one tick.
 *
 * Returns a tuple of [updatedDrone, events].
 */
export function updateShenobiDrone(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, NexusEvent[]] {
  const events: NexusEvent[] = [];
  const cm = drone.shenobi_cm_active;
  const cmState = drone.shenobi_cm_state;

  // Decrement CM timer
  const prevRemaining = drone.shenobi_cm_time_remaining;
  const remaining = Math.max(0.0, prevRemaining - tickRate);
  drone = { ...drone, shenobi_cm_time_remaining: remaining };

  // Track how long CM has been active (initial duration - remaining)
  const cmElapsed = drone.shenobi_cm_initial_duration - remaining;

  // --- State progression: pending -> 1/2 -> 2/2 ---
  if (cmState === 'pending') {
    // After ~1 second, acquire downlink (1/2)
    if (cmElapsed >= 1.0 || remaining <= 0) {
      drone = {
        ...drone,
        shenobi_cm_state: '1/2',
        downlink_detected: true,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — Downlink acquired (1/2)`,
      });
    }
    return [drone, events];
  }

  if (cmState === '1/2') {
    // After uplink is detected, acquire full control (2/2)
    if (drone.uplink_detected) {
      // Reset timer to full duration when full control is established
      const newDuration = 20.0 + Math.random() * 20.0;
      drone = {
        ...drone,
        shenobi_cm_state: '2/2',
        shenobi_cm_time_remaining: newDuration,
        shenobi_cm_initial_duration: newDuration,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — Uplink acquired (2/2) — FULL CONTROL`,
      });
    } else if (cm === 'shenobi_hold') {
      // Partial hold — drone slows significantly
      const newSpeed = Math.max(5, drone.speed * 0.85);
      drone = { ...drone, speed: newSpeed };
    } else if (cm === 'shenobi_land_now') {
      // Partial land — slow descent
      const newAlt = Math.max(0, drone.altitude - 10 * tickRate);
      drone = { ...drone, altitude: newAlt };
    } else if (cm === 'shenobi_deafen') {
      // Partial deafen — intermittent link disruption (speed jitter)
      const newSpeed = drone.speed * (0.7 + Math.random() * 0.3);
      drone = { ...drone, speed: Math.max(0, newSpeed) };
    }
    return [drone, events];
  }

  // --- 2/2 state: full protocol control ---
  if (cmState === '2/2') {
    if (cm === 'shenobi_hold') {
      const [holdDrone, holdEvents] = applyHold(drone, tickRate, elapsed);
      drone = holdDrone;
      events.push(...holdEvents);
    } else if (cm === 'shenobi_land_now') {
      const [landDrone, landEvents] = applyLandNow(drone, tickRate, elapsed);
      drone = landDrone;
      events.push(...landEvents);
    } else if (cm === 'shenobi_deafen') {
      const [deafenDrone, deafenEvents] = applyDeafen(drone, tickRate, elapsed);
      drone = deafenDrone;
      events.push(...deafenEvents);
    }
  }

  // Check if CM effect has expired
  if (remaining <= 0 && !drone.neutralized) {
    drone = {
      ...drone,
      shenobi_cm_active: null,
      shenobi_cm_state: null,
      shenobi_cm_time_remaining: 0,
    };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — CM effect expired`,
    });
  }

  return [drone, events];
}

// ---------------------------------------------------------------------------
// Individual CM behavior implementations
// ---------------------------------------------------------------------------

/** HOLD: Freeze drone in place, then force controlled descent to ground. */
function applyHold(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, NexusEvent[]] {
  const events: NexusEvent[] = [];
  // First decelerate to a stop
  if (drone.speed > 1) {
    const newSpeed = Math.max(0, drone.speed - 20 * tickRate);
    drone = { ...drone, speed: newSpeed };
    return [drone, events];
  }
  // Once stopped, force slow descent to ground
  drone = { ...drone, speed: 0 };
  const descentRate = 40.0; // ft/s — slow controlled descent
  const newAlt = Math.max(0, drone.altitude - descentRate * tickRate);
  drone = { ...drone, altitude: newAlt };
  if (newAlt <= 0) {
    drone = {
      ...drone,
      neutralized: true,
      dtid_phase: 'defeated',
      altitude: 0,
      speed: 0,
      shenobi_cm_time_remaining: 0,
    };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — HOLD COMPLETE — FORCED LANDING`,
    });
  }
  return [drone, events];
}

/** LAND NOW: Forced controlled descent at ~100 ft/s. */
function applyLandNow(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, NexusEvent[]] {
  const events: NexusEvent[] = [];
  const descentRate = 100.0; // feet per second
  const newAlt = Math.max(0, drone.altitude - descentRate * tickRate);
  const newSpeed = Math.max(0, drone.speed * 0.9); // Also decelerating
  drone = { ...drone, altitude: newAlt, speed: newSpeed };

  if (newAlt <= 0) {
    drone = {
      ...drone,
      neutralized: true,
      dtid_phase: 'defeated',
      altitude: 0,
      speed: 0,
      shenobi_cm_time_remaining: 0,
    };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — FORCED LANDING COMPLETE (grounded)`,
    });
  }
  return [drone, events];
}

/**
 * DEAFEN: Sever control link — drone enters failsafe.
 *
 * Failsafe behavior depends on drone type:
 *   - Commercial quads / micro: hover -> slow descent -> land
 *   - Fixed-wing / swarm: continue last heading -> eventually leave area
 */
function applyDeafen(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, NexusEvent[]] {
  const events: NexusEvent[] = [];

  if (
    drone.drone_type === ('commercial_quad' as DroneType) ||
    drone.drone_type === ('micro' as DroneType)
  ) {
    // Failsafe: hover then descend
    const newSpeed = Math.max(0, drone.speed * 0.8);
    const newAlt = Math.max(0, drone.altitude - 30 * tickRate);
    const trail = [...drone.trail, [Math.round(drone.x * 1000) / 1000, Math.round(drone.y * 1000) / 1000]];
    if (trail.length > 20) {
      trail.splice(0, trail.length - 20);
    }
    drone = { ...drone, speed: newSpeed, altitude: newAlt, trail };

    if (newAlt <= 0) {
      drone = {
        ...drone,
        neutralized: true,
        dtid_phase: 'defeated',
        altitude: 0,
        speed: 0,
        shenobi_cm_time_remaining: 0,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — LINK LOST — FAILSAFE LANDING`,
      });
    }
  } else {
    // Fixed-wing / swarm: continue on last heading (no corrections)
    const headingRad = (drone.heading * Math.PI) / 180;
    const speedKms = drone.speed * KTS_TO_KMS;
    const newX = drone.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = drone.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = [...drone.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]];
    if (trail.length > 20) {
      trail.splice(0, trail.length - 20);
    }
    drone = { ...drone, x: newX, y: newY, trail };

    // Leave area check
    if (Math.sqrt(newX ** 2 + newY ** 2) > 10.0) {
      drone = {
        ...drone,
        neutralized: true,
        dtid_phase: 'defeated',
        shenobi_cm_time_remaining: 0,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Shenobi: ${(drone.display_label || drone.id).toUpperCase()} — LINK LOST — LEFT AREA`,
      });
    }
  }

  return [drone, events];
}
