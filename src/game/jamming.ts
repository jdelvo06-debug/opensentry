/**
 * OpenSentry jamming logic — direct port of backend/app/jamming.py
 */

import { markDroneNeutralized } from './state';
import type { DroneState } from './state';
import { KTS_TO_KMS } from './helpers';

// ---------------------------------------------------------------------------
// Jam resistance per drone type (0.0 = fully jammable, 1.0 = jam-immune)
// ---------------------------------------------------------------------------

export const JAM_RESIST: Record<string, number> = {
  commercial_quad: 0.15,
  micro: 0.20,
  fixed_wing: 0.40,
  improvised: 0.50,
  improvised_hardened: 0.70,
  shahed: 1.0,
};
const _DEFAULT_JAM_RESIST = 0.50;

// ---------------------------------------------------------------------------
// PNT vulnerability per drone type (drift magnitude per tick when jammed)
// ---------------------------------------------------------------------------

export const PNT_VULNERABILITY: Record<string, number> = {
  commercial_quad: 0.008,
  micro: 0.006,
  fixed_wing: 0.004,
  improvised: 0.005,
  improvised_hardened: 0.001,
  shahed: 0.0, // INS-primary — fully immune to PNT/GPS jamming
};
const _DEFAULT_PNT_VULNERABILITY = 0.0;

// ---------------------------------------------------------------------------
// Event interface returned by update functions
// ---------------------------------------------------------------------------

interface JamEvent {
  type: string;
  timestamp: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Roll against jam resistance for the given drone type.
 * Returns null if the drone resists, otherwise a random jam behavior string.
 */
export function pickJamBehavior(droneType: string): string | null {
  const resist = JAM_RESIST[droneType] ?? _DEFAULT_JAM_RESIST;
  if (Math.random() < resist) return null;
  // Commercial quads and micros predominantly enter ATTI mode (weighted 2x)
  const behaviors = (droneType === 'commercial_quad' || droneType === 'micro')
    ? ['rth', 'atti_mode', 'atti_mode', 'gps_spoof']
    : ['loss_of_control', 'rth', 'forced_landing', 'gps_spoof'];
  return behaviors[Math.floor(Math.random() * behaviors.length)];
}

/**
 * Determine PNT jamming drift for the given drone type.
 * Returns [affected, driftMagnitude].
 */
export function applyPntJamming(droneType: string): [boolean, number] {
  const drift = PNT_VULNERABILITY[droneType] ?? _DEFAULT_PNT_VULNERABILITY;
  if (drift <= 0.0) return [false, 0.0];
  const jitter = 0.8 + Math.random() * 0.4; // uniform(0.8, 1.2)
  return [true, Math.round(drift * jitter * 100000) / 100000];
}

/**
 * Tick update for a PNT-jammed drone: apply random nav drift, decrement timer.
 */
export function updatePntJammedDrone(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, JamEvent[]] {
  const events: JamEvent[] = [];
  const remaining = drone.pnt_jammed_time_remaining - tickRate;

  if (remaining <= 0) {
    const updated: DroneState = {
      ...drone,
      pnt_jammed: false,
      pnt_drift_magnitude: 0.0,
      pnt_jammed_time_remaining: 0.0,
    };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `PNT: ${(drone.display_label || drone.id).toUpperCase()} \u2014 NAV DEGRADATION CLEARED`,
    });
    return [updated, events];
  }

  const driftKm = drone.pnt_drift_magnitude;
  const driftAngle = Math.random() * 2 * Math.PI;
  const newX = drone.x + Math.cos(driftAngle) * driftKm * tickRate;
  const newY = drone.y + Math.sin(driftAngle) * driftKm * tickRate;

  const trail = [...drone.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]].slice(-20);

  const updated: DroneState = {
    ...drone,
    x: newX,
    y: newY,
    trail,
    pnt_jammed_time_remaining: remaining,
  };
  return [updated, events];
}

/**
 * Tick update for an RF-jammed drone. Applies the assigned jammed_behavior
 * (loss_of_control, rth, forced_landing, gps_spoof) until neutralized or timer expires.
 */
export function updateJammedDrone(
  drone: DroneState,
  tickRate: number,
  elapsed: number,
): [DroneState, JamEvent[]] {
  const events: JamEvent[] = [];
  let d: DroneState = {
    ...drone,
    jammed_time_remaining: drone.jammed_time_remaining - tickRate,
  };
  const jb = d.jammed_behavior;

  // Guard: if jammed=true but no behavior assigned, clear the jam state
  if (jb === null || jb === undefined) {
    const cleared: DroneState = {
      ...d,
      jammed: false,
      jammed_time_remaining: 0,
    };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `TRACK: ${(d.display_label || d.id).toUpperCase()} — JAM STATE CLEARED (no behavior assigned)`,
    });
    return [cleared, events];
  }

  if (jb === 'loss_of_control') {
    const speedKms = d.speed * KTS_TO_KMS * 0.5;
    const headingRad = (d.heading * Math.PI) / 180;
    const newX = d.x + Math.cos(headingRad) * speedKms * tickRate;
    const newY = d.y + Math.sin(headingRad) * speedKms * tickRate;
    const newAlt = Math.max(0, d.altitude - 15 * tickRate);
    const trail = [...d.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]].slice(-20);
    d = { ...d, x: newX, y: newY, altitude: newAlt, speed: d.speed * 0.95, trail };
    if (newAlt <= 0 || d.jammed_time_remaining <= 0) {
      d = markDroneNeutralized(d, elapsed, { jammed_time_remaining: 0, altitude: 0 });
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${(d.display_label || d.id).toUpperCase()} \u2014 CRASHED (loss of control)`,
      });
    }
  } else if (jb === 'rth') {
    const awayAngle = Math.atan2(d.y, d.x);
    const speedKms = d.speed * KTS_TO_KMS;
    const newX = d.x + Math.cos(awayAngle) * speedKms * tickRate;
    const newY = d.y + Math.sin(awayAngle) * speedKms * tickRate;
    const headingDeg = ((awayAngle * 180) / Math.PI + 360) % 360;
    const trail = [...d.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]].slice(-20);
    d = { ...d, x: newX, y: newY, heading: headingDeg, trail };
    if (Math.sqrt(newX ** 2 + newY ** 2) > 10.0 || d.jammed_time_remaining <= 0) {
      d = markDroneNeutralized(d, elapsed, { jammed_time_remaining: 0 });
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${(d.display_label || d.id).toUpperCase()} \u2014 RTH (left area)`,
      });
    }
  } else if (jb === 'forced_landing') {
    const newAlt = Math.max(0, d.altitude - 50 * tickRate);
    d = { ...d, altitude: newAlt, speed: Math.max(0, d.speed - 5 * tickRate) };
    if (newAlt <= 0) {
      d = markDroneNeutralized(d, elapsed, { jammed_time_remaining: 0, altitude: 0, speed: 0 });
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${(d.display_label || d.id).toUpperCase()} \u2014 FORCED LANDING (grounded)`,
      });
    }
  } else if (jb === 'atti_mode') {
    // ATTI mode: drone maintains heading/speed with small random lateral drift
    const speedKms = d.speed * KTS_TO_KMS;
    const headingRad = (d.heading * Math.PI) / 180;
    const newX = d.x + Math.cos(headingRad) * speedKms * tickRate + (Math.random() - 0.5) * 0.004;
    const newY = d.y + Math.sin(headingRad) * speedKms * tickRate + (Math.random() - 0.5) * 0.004;
    const trail = [...d.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]].slice(-20);
    d = { ...d, x: newX, y: newY, trail };
    // ATTI mode does NOT neutralize — clears when timer expires
    // jam_cooldown prevents tickPassiveJamming from immediately re-jamming
    if (d.jammed_time_remaining <= 0) {
      d = { ...d, jammed: false, jammed_behavior: null, jammed_time_remaining: 0, jam_cooldown: 15.0 };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `EW: ${(d.display_label || d.id).toUpperCase()} \u2014 ATTI MODE CLEARED, RESUMING AUTONOMOUS NAVIGATION`,
      });
    }
  } else if (jb === 'gps_spoof') {
    const sign = Math.random() < 0.5 ? -1 : 1;
    const spoofHeading = (d.heading + (90 + Math.random() * 90) * sign + 360) % 360;
    const headingRad = (spoofHeading * Math.PI) / 180;
    const speedKms = d.speed * KTS_TO_KMS;
    const newX = d.x + Math.cos(headingRad) * speedKms * tickRate;
    const newY = d.y + Math.sin(headingRad) * speedKms * tickRate;
    const trail = [...d.trail, [Math.round(newX * 1000) / 1000, Math.round(newY * 1000) / 1000]].slice(-20);
    d = { ...d, x: newX, y: newY, heading: spoofHeading, trail };
    if (Math.sqrt(newX ** 2 + newY ** 2) > 10.0 || d.jammed_time_remaining <= 0) {
      d = markDroneNeutralized(d, elapsed, { jammed_time_remaining: 0 });
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `TRACK: ${(d.display_label || d.id).toUpperCase()} \u2014 GPS SPOOFED (left area)`,
      });
    }
  }

  return [d, events];
}
