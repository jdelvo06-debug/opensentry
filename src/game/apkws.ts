/**
 * APKWS rocket lifecycle — launch, midcourse, terminal, impact.
 *
 * Unlike JACKAL (which has a spinup phase and spawns a visible interceptor entity
 * that persists through multiple phases), APKWS is a simpler flight model:
 *   - No spinup: fire immediately
 *   - Faster flight: ~4 seconds to target at 5 km
 *   - Single pass: one effectiveness roll at impact, no re-engagement
 *   - Self-destruct on miss (no second attempt)
 *
 * The rocket flies from launcher position to target position using the same
 * geometry system as JACKAL, but with higher speed and simpler phase transitions.
 */

import { markDroneNeutralized } from './state';
import type { DroneState } from './state';
import { KTS_TO_KMS } from './helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventDict {
  type: string;
  timestamp: number;
  message: string;
  target_id?: string;
  effector?: string;
  effective?: boolean;
  effectiveness?: number;
  effector_type?: string;
  effector_name?: string;
}

type ApkwsResult = [DroneState, DroneState[], EventDict[], EventDict[]];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendTrail(
  drone: DroneState,
  newX?: number,
  newY?: number,
  maxLength: number = 20,
): number[][] {
  const trail = [...drone.trail];
  const x = Math.round((newX ?? drone.x) * 1000) / 1000;
  const y = Math.round((newY ?? drone.y) * 1000) / 1000;
  trail.push([x, y]);
  if (trail.length > maxLength) {
    return trail.slice(-maxLength);
  }
  return trail;
}

// ---------------------------------------------------------------------------
// Main update
// ---------------------------------------------------------------------------

/**
 * Advance an APKWS rocket by one tick.
 *
 * @param rocket     The APKWS rocket drone.
 * @param drones     Full drone list (needed to find target and mark neutralized).
 * @param tickRate   Seconds per tick.
 * @param elapsed    Seconds since mission start.
 *
 * @returns [updatedRocket, droneMutations, events, engagementResults]
 */
export function updateApkws(
  rocket: DroneState,
  drones: DroneState[],
  tickRate: number,
  elapsed: number,
): ApkwsResult {
  const events: EventDict[] = [];
  const engagementResults: EventDict[] = [];
  const droneMutations: DroneState[] = [];

  const phase = rocket.intercept_phase;

  // --- Self-destruct phase (post-miss or post-hit cleanup) ---
  if (phase === 'self_destruct') {
    rocket = { ...rocket, neutralized: true, remove_at: elapsed };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `${(rocket.display_label || rocket.id).toUpperCase()} SELF-DESTRUCT`,
    });
    return [rocket, droneMutations, events, engagementResults];
  }

  // --- Find target ---
  let targetDrone: DroneState | null = null;
  for (const td of drones) {
    if (td.id === rocket.interceptor_target) {
      targetDrone = td;
      break;
    }
  }

  if (targetDrone === null || targetDrone.neutralized) {
    rocket = { ...rocket, intercept_phase: 'self_destruct' };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `${(rocket.display_label || rocket.id).toUpperCase()} — TARGET LOST, SELF-DESTRUCT`,
    });
    return [rocket, droneMutations, events, engagementResults];
  }

  // --- Geometry ---
  const dx = targetDrone.x - rocket.x;
  const dy = targetDrone.y - rocket.y;
  const distToTarget = Math.sqrt(dx * dx + dy * dy);
  const headingToTarget =
    ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

  // --- Launch phase (rapid climb + acceleration, ~1 sec) ---
  if (phase === 'launch') {
    // APKWS accelerates very fast — approximate Mach 2+ rocket flight in game scale.
    const newAlt = Math.min(200, rocket.altitude + 400 * tickRate);  // Fast climb
    const newSpeed = Math.min(1800, rocket.speed + 1800 * tickRate); // ~0.93 km/s cruise
    const speedKms = newSpeed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = rocket.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = rocket.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(rocket, newX, newY);
    const nextPhase = newAlt >= 200 ? 'midcourse' : 'launch';
    rocket = {
      ...rocket,
      x: newX, y: newY,
      altitude: newAlt,
      speed: newSpeed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [rocket, droneMutations, events, engagementResults];
  }

  // --- Midcourse phase (~Mach 2+ guided rocket cruise) ---
  if (phase === 'midcourse') {
    const speed = 1800.0;  // ~0.93 km/s, ~5 km shot in ~5-6 sec
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = rocket.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = rocket.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(rocket, newX, newY);

    // Guidance callouts every ~2 sec
    if (Math.floor(elapsed * 10) % 20 === 0) {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} GUIDING — RANGE: ${distToTarget.toFixed(1)}km`,
      });
    }

    const nextPhase = distToTarget <= speedKms * tickRate + 0.15 ? 'terminal' : 'midcourse';
    if (nextPhase === 'terminal') {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} TERMINAL — SEEKER LOCK`,
      });
    }
    rocket = {
      ...rocket,
      x: newX, y: newY,
      speed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [rocket, droneMutations, events, engagementResults];
  }

  // --- Terminal phase (final approach, faster, effectiveness roll at impact) ---
  if (phase === 'terminal') {
    const speed = 2000.0;  // Terminal sprint, ~1.03 km/s
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = rocket.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = rocket.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(rocket, newX, newY);
    rocket = {
      ...rocket,
      x: newX, y: newY,
      speed,
      heading: headingToTarget,
      trail,
    };

    // Check intercept distance after movement
    const dx2 = targetDrone.x - newX;
    const dy2 = targetDrone.y - newY;
    const distAfter = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (distToTarget <= speedKms * tickRate || distAfter < 0.05) {
      // Impact! Apply the pre-rolled result from launch so UI animation can know outcome up front.
      const hit = rocket.impact_effective ?? (Math.random() < rocket.effectiveness);
      const label = targetDrone.display_label || targetDrone.id;

      if (hit) {
        const killedTarget = markDroneNeutralized(targetDrone, elapsed);
        droneMutations.push(killedTarget);
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} HIT — ${label.toUpperCase()} NEUTRALIZED`,
        });
        engagementResults.push({
          type: 'engagement_result',
          target_id: rocket.interceptor_target!,
          effector: rocket.launcher_id || rocket.id,
          effective: true,
          effectiveness: Math.round(rocket.effectiveness * 100) / 100,
          effector_type: 'apkws',
          effector_name: rocket.display_label || rocket.id,
          timestamp: Math.round(elapsed * 10) / 10,
          message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} HIT — ${label.toUpperCase()} NEUTRALIZED`,
        });
      } else {
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} MISS — ${label.toUpperCase()} still active`,
        });
        engagementResults.push({
          type: 'engagement_result',
          target_id: rocket.interceptor_target!,
          effector: rocket.launcher_id || rocket.id,
          effective: false,
          effectiveness: Math.round(rocket.effectiveness * 100) / 100,
          effector_type: 'apkws',
          effector_name: rocket.display_label || rocket.id,
          timestamp: Math.round(elapsed * 10) / 10,
          message: `APKWS ${(rocket.display_label || rocket.id).toUpperCase()} MISS — ${label.toUpperCase()} still active`,
        });
      }
      // Rocket self-destructs after impact regardless of hit/miss
      rocket = { ...rocket, intercept_phase: 'self_destruct' };
    }
  }

  return [rocket, droneMutations, events, engagementResults];
}