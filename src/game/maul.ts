/**
 * MAUL interceptor lifecycle — coffin launch, midcourse, terminal,
 * ram, and self-destruct phases.
 *
 * MAUL is a heavy quadcopter interceptor that launches vertically
 * from a coffin-shaped container. Unlike JACKAL (which requires
 * Ku-Band FCS radar guidance), MAUL uses autonomous onboard
 * computer vision and AI for terminal guidance — no external
 * fire-control radar required.
 *
 * Key differences from JACKAL:
 *   - Autonomous guidance (no Ku-Band FCS dependency)
 *   - Slower speeds: 120 kts cruise / 150 kts terminal (vs 220/280)
 *   - Shorter range: 4 km (vs 10 km)
 *   - Reusable airframe: up to 3 ram attempts before self-destruct
 *   - Physical impact kill — no warhead, no proximity fuse
 *   - Best vs commercial_quad and micro; poor vs shahed
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

type MaulResult = [DroneState, DroneState[], EventDict[], EventDict[]];

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
 * Advance a MAUL interceptor by one tick.
 *
 * @param maul       The MAUL interceptor drone.
 * @param drones     Full drone list (needed to find target and mark neutralized).
 * @param tickRate   Seconds per tick.
 * @param elapsed    Seconds since mission start.
 *
 * @returns [updatedMaul, droneMutations, events, engagementResults]
 */
export function updateMaul(
  maul: DroneState,
  drones: DroneState[],
  tickRate: number,
  elapsed: number,
): MaulResult {
  const events: EventDict[] = [];
  const engagementResults: EventDict[] = [];
  const droneMutations: DroneState[] = [];

  const phase = maul.intercept_phase;

  // --- Spinup phase (5-8s coffin prep before launch) ---
  if (phase === 'spinup') {
    const spinupRemaining = maul.spinup_remaining - tickRate;
    if (spinupRemaining <= 0) {
      maul = {
        ...maul,
        intercept_phase: 'launch',
        spinup_remaining: 0,
      };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(maul.display_label || maul.id).toUpperCase()} — COFFIN OPEN, LAUNCHING`,
      });
    } else {
      const countdown = Math.floor(spinupRemaining) + 1;
      if (Math.floor(spinupRemaining * 10) % 20 === 0) {
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(maul.display_label || maul.id).toUpperCase()} — SPINUP T-${countdown}s`,
        });
      }
      maul = { ...maul, spinup_remaining: spinupRemaining };
    }
    return [maul, droneMutations, events, engagementResults];
  }

  // --- Self-destruct phase ---
  if (phase === 'self_destruct') {
    if (maul.altitude < 328) {
      const newAlt = Math.min(328, maul.altitude + 200 * tickRate);
      const trail = appendTrail(maul);
      maul = { ...maul, altitude: newAlt, trail };
    } else {
      maul = { ...maul, neutralized: true, remove_at: elapsed };
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(maul.display_label || maul.id).toUpperCase()} SELF-DESTRUCT AT ${Math.round(maul.altitude)}ft`,
      });
    }
    return [maul, droneMutations, events, engagementResults];
  }

  // --- Find target ---
  let targetDrone: DroneState | null = null;
  for (const td of drones) {
    if (td.id === maul.interceptor_target) {
      targetDrone = td;
      break;
    }
  }

  if (targetDrone === null || targetDrone.neutralized) {
    maul = { ...maul, intercept_phase: 'self_destruct' };
    events.push({
      type: 'event',
      timestamp: Math.round(elapsed * 10) / 10,
      message: `${(maul.display_label || maul.id).toUpperCase()} — TARGET LOST, ENTERING SELF-DESTRUCT`,
    });
    return [maul, droneMutations, events, engagementResults];
  }

  // --- Geometry ---
  const dx = targetDrone.x - maul.x;
  const dy = targetDrone.y - maul.y;
  const distToTarget = Math.sqrt(dx * dx + dy * dy);
  const headingToTarget =
    ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

  // --- Launch phase (vertical coffin launch, rapid climb toward target altitude) ---
  if (phase === 'launch') {
    const targetAlt = targetDrone.altitude;
    const newAlt = Math.min(targetAlt, maul.altitude + 180 * tickRate);
    const newSpeed = Math.min(100, maul.speed + 70 * tickRate);
    const speedKms = newSpeed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = maul.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = maul.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(maul, newX, newY);
    const nextPhase = newAlt >= targetAlt ? 'midcourse' : 'launch';
    maul = {
      ...maul,
      x: newX,
      y: newY,
      altitude: newAlt,
      speed: newSpeed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [maul, droneMutations, events, engagementResults];
  }

  // --- Midcourse phase (autonomous cruise at ~120 kts, climbing to target altitude) ---
  if (phase === 'midcourse') {
    const speed = 120.0;  // Heavy quadcopter cruise ~120 kts
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = maul.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = maul.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(maul, newX, newY);

    // Climb/descend toward target altitude at 50 ft/s
    const targetAlt = targetDrone.altitude;
    const altDiff = targetAlt - maul.altitude;
    const altStep = Math.sign(altDiff) * Math.min(Math.abs(altDiff), 50 * tickRate);
    const newAlt = maul.altitude + altStep;

    if (Math.floor(elapsed * 10) % 20 === 0) {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `MAUL ${(maul.display_label || maul.id).toUpperCase()} AUTONOMOUS GUIDANCE — RANGE: ${distToTarget.toFixed(1)}km`,
      });
    }

    const nextPhase = distToTarget < 0.3 ? 'terminal' : 'midcourse';
    if (nextPhase === 'terminal') {
      events.push({
        type: 'event',
        timestamp: Math.round(elapsed * 10) / 10,
        message: `${(maul.display_label || maul.id).toUpperCase()} TERMINAL — TARGET ACQUIRED`,
      });
    }
    maul = {
      ...maul,
      x: newX,
      y: newY,
      altitude: newAlt,
      speed,
      heading: headingToTarget,
      trail,
      intercept_phase: nextPhase,
    };
    return [maul, droneMutations, events, engagementResults];
  }

  // --- Terminal phase (sprint at ~150 kts, physical ram, maintain target altitude) ---
  if (phase === 'terminal') {
    const speed = 150.0;  // Terminal sprint ~150 kts
    const speedKms = speed * KTS_TO_KMS;
    const headingRad = (headingToTarget * Math.PI) / 180;
    const newX = maul.x + Math.sin(headingRad) * speedKms * tickRate;
    const newY = maul.y + Math.cos(headingRad) * speedKms * tickRate;
    const trail = appendTrail(maul, newX, newY);

    // Fine-tune altitude toward target
    const targetAlt = targetDrone.altitude;
    const altDiff = targetAlt - maul.altitude;
    const altStep = Math.sign(altDiff) * Math.min(Math.abs(altDiff), 75 * tickRate);
    const newAlt = maul.altitude + altStep;

    maul = {
      ...maul,
      x: newX,
      y: newY,
      altitude: newAlt,
      speed,
      heading: headingToTarget,
      trail,
    };

    // Check intercept distance after movement
    const dx2 = targetDrone.x - newX;
    const dy2 = targetDrone.y - newY;
    const distAfter = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (distAfter < 0.05) {
      const attempts = maul.intercept_attempts + 1;
      // MAUL is a physical rammer — higher Pk vs slow targets
      const pk = maul.effectiveness || 0.85;

      if (Math.random() < pk) {
        // Success — physical ram neutralizes target
        const killedTarget = markDroneNeutralized(targetDrone, elapsed);
        droneMutations.push(killedTarget);
        maul = {
          ...maul,
          neutralized: true,
          remove_at: elapsed,
          intercept_attempts: attempts,
        };
        events.push({
          type: 'event',
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(maul.display_label || maul.id).toUpperCase()} RAM SUCCESSFUL — TARGET DESTROYED BY IMPACT`,
        });
        engagementResults.push({
          type: 'engagement_result',
          target_id: maul.interceptor_target!,
          effector: maul.id,
          effective: true,
          effectiveness: 1.0,
          timestamp: Math.round(elapsed * 10) / 10,
          message: `${(maul.display_label || maul.id).toUpperCase()} RAM SUCCESSFUL — TARGET DESTROYED BY IMPACT`,
        });
      } else {
        // Miss — MAUL can re-engage (up to 3 total attempts)
        if (attempts >= 3) {
          maul = {
            ...maul,
            intercept_phase: 'self_destruct',
            intercept_attempts: attempts,
          };
          events.push({
            type: 'event',
            timestamp: Math.round(elapsed * 10) / 10,
            message: `${(maul.display_label || maul.id).toUpperCase()} MISSED — MAX ATTEMPTS, SELF-DESTRUCT`,
          });
        } else {
          maul = {
            ...maul,
            intercept_phase: 'midcourse',
            intercept_attempts: attempts,
          };
          events.push({
            type: 'event',
            timestamp: Math.round(elapsed * 10) / 10,
            message: `${(maul.display_label || maul.id).toUpperCase()} MISSED — RE-ENGAGING (ATTEMPT ${attempts + 1}/3)`,
          });
        }
      }
    }
  }

  return [maul, droneMutations, events, engagementResults];
}
