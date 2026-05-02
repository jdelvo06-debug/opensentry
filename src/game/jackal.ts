/**
 * JACKAL interceptor lifecycle — launch, midcourse, terminal,
 * intercept, and self-destruct phases.
 *
 * Direct port of backend/app/jackal.py to TypeScript.
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
}

type JackalResult = [DroneState, DroneState[], EventDict[], EventDict[]];

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
 * Advance a JACKAL interceptor by one tick.
 *
 * @param jackal     The interceptor drone.
 * @param drones     Full drone list (needed to find the target and mark it neutralized).
 * @param tickRate   Seconds per tick.
 * @param elapsed    Seconds since mission start.
 *
 * @returns [updatedJackal, droneMutations, events, engagementResults]
 *   - updatedJackal: the new Jackal state
 *   - droneMutations: list of updated drones applied to *other* drones
 *     (e.g. the target being neutralized). The caller should apply these
 *     to the master list.
 *   - events: list of event dicts to broadcast
 *   - engagementResults: list of engagement_result dicts to send
 */
export function updateJackal(
  jackal: DroneState,
  drones: DroneState[],
  tickRate: number,
  elapsed: number,
): JackalResult {
  const events: EventDict[] = [];
  const engagementResults: EventDict[] = [];
  const droneMutations: DroneState[] = [];

  const phase = jackal.intercept_phase;

  // --- Spinup phase (10-15s warmup before launch) ---
  if (phase === 'spinup') {
    const spinupRemaining = jackal.spinup_remaining - tickRate;
    if (spinupRemaining <= 0) {
      jackal = {
        ...jackal,
        intercept_phase: 'launch',
        spinup_remaining: 0,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(jackal.display_label || jackal.id).toUpperCase()} — LAUNCH SEQUENCE COMPLETE — AWAY`,
      });
    } else {
      const countdown = Math.floor(spinupRemaining) + 1;
      if (Math.floor(spinupRemaining * 10) % 20 === 0) {
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(jackal.display_label || jackal.id).toUpperCase()} — SPINUP T-${countdown}s`,
        });
      }
      jackal = { ...jackal, spinup_remaining: spinupRemaining };
    }
    return [jackal, droneMutations, events, engagementResults];
  }

  // --- Self-destruct phase ---
  if (phase === 'self_destruct') {
    if (jackal.altitude < 328) {
      const newAlt = Math.min(328, jackal.altitude + 200 * tickRate);
      const trail = appendTrail(jackal);
      jackal = { ...jackal, altitude: newAlt, trail };
    } else {
      jackal = { ...jackal, neutralized: true, remove_at: elapsed };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(jackal.display_label || jackal.id).toUpperCase()} SELF-DESTRUCT AT ${Math.round(jackal.altitude)}ft`,
      });
    }
    return [jackal, droneMutations, events, engagementResults];
  }

  // --- Find target ---
  let targetDrone: DroneState | null = null;
  for (const td of drones) {
    if (td.id === jackal.interceptor_target) {
      targetDrone = td;
      break;
    }
  }

  if (targetDrone === null || targetDrone.neutralized) {
    jackal = { ...jackal, intercept_phase: 'self_destruct' };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `${(jackal.display_label || jackal.id).toUpperCase()} — TARGET LOST, ENTERING SELF-DESTRUCT`,
    });
    return [jackal, droneMutations, events, engagementResults];
  }

  // --- Geometry ---
  const dx = targetDrone.x - jackal.x;
  const dy = targetDrone.y - jackal.y;
  const distToTarget = Math.sqrt(dx * dx + dy * dy);
  const headingToTarget =
    ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

  // --- Launch phase ---
  if (phase === 'launch') {
    const newAlt = Math.min(300, jackal.altitude + 250 * tickRate);
    const newSpeed = Math.min(220, jackal.speed + 80 * tickRate);
    const speedKms = newSpeed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = jackal.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = jackal.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(jackal, newX, newY);
    const nextPhase = newAlt >= 300 ? 'midcourse' : 'launch';
    jackal = {
      ...jackal,
      x: newX,
      y: newY,
      altitude: newAlt,
      speed: newSpeed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [jackal, droneMutations, events, engagementResults];
  }

  // --- Midcourse phase ---
  if (phase === 'midcourse') {
    const speed = 220.0;  // Coyote Block 2+ cruise ~220 kts
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = jackal.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = jackal.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(jackal, newX, newY);

    if (Math.floor(elapsed * 10) % 20 === 0) {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `Ku-FC GUIDING ${(jackal.display_label || jackal.id).toUpperCase()} — RANGE: ${distToTarget.toFixed(1)}km`,
      });
    }

    const nextPhase = distToTarget < 0.3 ? 'terminal' : 'midcourse';
    if (nextPhase === 'terminal') {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(jackal.display_label || jackal.id).toUpperCase()} TERMINAL — SEEKER ACQUIRED`,
      });
    }
    jackal = {
      ...jackal,
      x: newX,
      y: newY,
      speed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [jackal, droneMutations, events, engagementResults];
  }

  // --- Terminal phase ---
  if (phase === 'terminal') {
    const speed = 280.0;  // Coyote Block 2+ terminal sprint ~280 kts
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = jackal.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = jackal.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(jackal, newX, newY);
    jackal = {
      ...jackal,
      x: newX,
      y: newY,
      speed,
      heading: headingToTarget,
      trail,
    };

    // Check intercept distance after movement
    const dx2 = targetDrone.x - newX;
    const dy2 = targetDrone.y - newY;
    const distAfter = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (distAfter < 0.05) {
      const attempts = jackal.intercept_attempts + 1;
      if (Math.random() < 0.85) {
        // Success — neutralize target
        const killedTarget = markDroneNeutralized(targetDrone, elapsed);
        droneMutations.push(killedTarget);
        jackal = {
          ...jackal,
          neutralized: true,
          remove_at: elapsed,
          intercept_attempts: attempts,
        };
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(jackal.display_label || jackal.id).toUpperCase()} INTERCEPT SUCCESSFUL — TARGET DESTROYED`,
        });
        engagementResults.push({
          type: 'engagement_result',
          target_id: jackal.interceptor_target!,
          effector: jackal.id,
          effective: true,
          effectiveness: 1.0,
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(jackal.display_label || jackal.id).toUpperCase()} INTERCEPT SUCCESSFUL — TARGET DESTROYED`,
        });
      } else {
        // Miss
        if (attempts >= 2) {
          jackal = {
            ...jackal,
            intercept_phase: 'self_destruct',
            intercept_attempts: attempts,
          };
          events.push({
            type: 'event',
            timestamp: Math.round(elapsed * 10) / 10,
            message: `${(jackal.display_label || jackal.id).toUpperCase()} MISSED — MAX ATTEMPTS, SELF-DESTRUCT`,
          });
        } else {
          jackal = {
            ...jackal,
            intercept_phase: 'midcourse',
            intercept_attempts: attempts,
          };
          events.push({
            type: 'event',
            timestamp: Math.round(elapsed * 10) / 10,
            message: `${(jackal.display_label || jackal.id).toUpperCase()} MISSED — RE-ENGAGING`,
          });
        }
      }
    }
  }

  return [jackal, droneMutations, events, engagementResults];
}
