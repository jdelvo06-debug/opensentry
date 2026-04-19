/**
 * Player action handlers — ported from actions.py
 */

import {
  markDroneNeutralized,
} from './state.js';
import type { DroneState, GameState, PlayerAction, EffectorRuntimeState } from './state.js';
import {
  bearingToTargetDegrees,
  calculateDirectedEnergySlewSeconds,
  checkEffectorInRange,
  checkEffectorRangeOnly,
  checkKuFcsTracking,
  checkNexusRfTracking,
  effectorEffectiveness,
  findEffectorConfig,
} from './helpers.js';
import { applyPntJamming, pickJamBehavior } from './jamming.js';
import { isShenobiVulnerable, pickShenobiCmEffectiveness, DRONE_FREQUENCY_MAP } from './shenobi.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HPM_SPLASH_RADIUS_KM = 0.75;

function _event(elapsed: number, message: string): Record<string, unknown> {
  return { type: 'event', timestamp: Math.round(elapsed * 10) / 10, message };
}

function _randUniform(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function _randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _label(gs: GameState, droneId: string): string {
  const d = gs.drones.find(d => d.id === droneId);
  return d?.display_label || droneId;
}

function _recordFirstClick(gs: GameState, targetId: string, elapsed: number): void {
  if (!gs.first_click_times.has(targetId)) {
    gs.first_click_times.set(targetId, elapsed);
  }
}

function _segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  function cross(ox: number, oy: number, ax2: number, ay2: number, bx2: number, by2: number): number {
    return (ax2 - ox) * (by2 - oy) - (ay2 - oy) * (bx2 - ox);
  }

  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);

  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function _losBlocked(gs: GameState, sx: number, sy: number, tx: number, ty: number): boolean {
  for (const feature of gs.terrain) {
    if (!feature.blocks_los) continue;
    const poly = feature.polygon;
    for (let i = 0; i < poly.length; i++) {
      const [px1, py1] = poly[i];
      const [px2, py2] = poly[(i + 1) % poly.length];
      if (_segmentsIntersect(sx, sy, tx, ty, px1, py1, px2, py2)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function handleConfirmTrack(gs: GameState, targetId: string, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  for (let j = 0; j < gs.drones.length; j++) {
    const d = gs.drones[j];
    if (d.id === targetId && d.dtid_phase === 'detected') {
      _recordFirstClick(gs, targetId, elapsed);
      gs.drones[j] = { ...d, dtid_phase: 'tracked' };
      gs.confirm_times.set(targetId, elapsed);
      gs.actions.push({ action: 'confirm_track', target_id: targetId, timestamp: elapsed });
      const label = gs.drones[j].display_label || targetId;
      msgs.push(_event(elapsed, `OPERATOR: Track ${label.toUpperCase()} confirmed`));
    }
  }
  return msgs;
}

export function handleIdentify(
  gs: GameState,
  targetId: string,
  classification: string | null | undefined,
  affiliationStr: string,
  elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  for (let j = 0; j < gs.drones.length; j++) {
    const d = gs.drones[j];
    if (d.id === targetId && (d.dtid_phase === 'tracked' || d.dtid_phase === 'identified')) {
      _recordFirstClick(gs, targetId, elapsed);
      const isReset = classification === 'unknown';
      gs.drones[j] = {
        ...d,
        dtid_phase: isReset ? 'tracked' : 'identified',
        classification: isReset ? null : ((classification as DroneState['classification']) ?? null),
        classified: !isReset,
        affiliation: isReset ? 'unknown' as DroneState['affiliation'] : affiliationStr as DroneState['affiliation'],
      };
      gs.identify_times.set(targetId, elapsed);
      gs.classification_given.set(targetId, classification ?? '');
      gs.affiliation_given.set(targetId, affiliationStr);
      gs.confidence_at_identify.set(targetId, d.confidence);
      gs.actions.push({
        action: 'identify',
        target_id: targetId,
        classification: classification ?? undefined,
        affiliation: affiliationStr,
        timestamp: elapsed,
      });
      const label = gs.drones[j].display_label || targetId;
      msgs.push(_event(elapsed, `OPERATOR: ${label.toUpperCase()} identified as ${classification} (${affiliationStr})`));
    }
  }
  return msgs;
}

export function handleDeclareAffiliation(
  gs: GameState,
  targetId: string,
  affiliation: string,
  elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  for (let j = 0; j < gs.drones.length; j++) {
    const d = gs.drones[j];
    if (d.id === targetId && (d.dtid_phase === 'identified' || d.dtid_phase === 'tracked')) {
      gs.drones[j] = {
        ...d,
        affiliation: affiliation as DroneState['affiliation'],
        dtid_phase: 'identified',
      };
      gs.affiliation_given.set(targetId, affiliation);
      const label = gs.drones[j].display_label || targetId;
      msgs.push(_event(elapsed, `OPERATOR: ${label.toUpperCase()} affiliation declared — ${affiliation.toUpperCase()}`));
    }
  }
  return msgs;
}

export function handleHoldFire(gs: GameState, targetId: string, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  for (let j = 0; j < gs.drones.length; j++) {
    const d = gs.drones[j];
    if (d.id === targetId) {
      _recordFirstClick(gs, targetId, elapsed);
      gs.hold_fire_tracks.add(targetId);
      gs.actions.push({ action: 'hold_fire', target_id: targetId, timestamp: elapsed });
      msgs.push(_event(elapsed, `OPERATOR: HOLD FIRE on ${_label(gs, targetId).toUpperCase()}`));
      // Self-destruct JACKALs targeting this track
      for (let ci = 0; ci < gs.drones.length; ci++) {
        const cd = gs.drones[ci];
        if (cd.is_interceptor && !cd.neutralized && cd.interceptor_target === targetId && cd.intercept_phase !== 'self_destruct') {
          gs.drones[ci] = { ...cd, intercept_phase: 'self_destruct' };
          msgs.push(_event(elapsed, `HOLD FIRE \u2014 ${(cd.display_label || cd.id).toUpperCase()} ENTERING SELF-DESTRUCT`));
        }
      }
      break;
    }
  }
  return msgs;
}

export function handleReleaseHoldFire(gs: GameState, targetId: string, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  if (gs.hold_fire_tracks.has(targetId)) {
    gs.hold_fire_tracks.delete(targetId);
    gs.actions.push({ action: 'release_hold_fire', target_id: targetId, timestamp: elapsed });
    msgs.push(_event(elapsed, `OPERATOR: Hold fire RELEASED on ${_label(gs, targetId).toUpperCase()}`));
  }
  return msgs;
}

export function handleEngage(
  gs: GameState,
  targetId: string,
  effectorId: string,
  elapsed: number,
  shenobiCm?: string | null,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];

  // Hold fire check
  if (gs.hold_fire_tracks.has(targetId)) {
    msgs.push(_event(elapsed, `ENGAGEMENT: BLOCKED \u2014 Hold fire active on ${_label(gs, targetId).toUpperCase()}`));
    return msgs;
  }

  const effState = findEffectorConfig(gs.effector_states, effectorId);
  if (!effState || effState.status !== 'ready') return msgs;

  // Ammo check
  if (effState.ammo_remaining !== null && effState.ammo_remaining !== undefined && effState.ammo_remaining <= 0) {
    msgs.push(_event(elapsed, `ENGAGEMENT: ${effState.name} \u2014 DEPLETED (no ammo remaining)`));
    return msgs;
  }

  for (let j = 0; j < gs.drones.length; j++) {
    const d = gs.drones[j];
    if (d.id !== targetId) continue;
    _recordFirstClick(gs, targetId, elapsed);

    // Block engaging friendly interceptors
    if (d.is_interceptor) {
      msgs.push(_event(elapsed, `ENGAGEMENT: BLOCKED \u2014 ${(d.display_label || d.id).toUpperCase()} is a friendly interceptor`));
      break;
    }

    const isJammer = effState.type === 'rf_jam' || effState.type === 'electronic';
    const isShenobi = effState.type === 'shenobi_pm';
    const isDirectedEnergy = effState.type === 'de_laser' || effState.type === 'de_hpm';

    // Range check
    const inWeaponEnvelope = isDirectedEnergy
      ? checkEffectorRangeOnly(effState, d)
      : checkEffectorInRange(effState, d);
    if (isDirectedEnergy && !inWeaponEnvelope) {
      msgs.push(..._queueDirectedEnergyEngagement(gs, d, effState, effectorId, targetId, elapsed, 'slew'));
      break;
    }

    if (!isJammer && !isShenobi && !inWeaponEnvelope) {
      msgs.push(_event(elapsed, `ENGAGEMENT: ${effState.name} \u2014 Target out of range`));
      break;
    }

    const enforceTerrainLos = gs.placement_config != null;
    if (effState.requires_los && enforceTerrainLos && !isJammer && !isShenobi) {
      const ex = effState.x ?? 0;
      const ey = effState.y ?? 0;
      if (gs.terrain.length > 0 && _losBlocked(gs, ex, ey, d.x, d.y)) {
        msgs.push(_event(elapsed, `ENGAGEMENT: ${effState.name} — NO LINE OF SIGHT (terrain blocked)`));
        break;
      }
    }

    // JACKAL requires Ku-Band FCS
    if (effState.ammo_count !== null && effState.ammo_count !== undefined && effState.type === 'kinetic') {
      if (!checkKuFcsTracking(gs.sensor_configs, d)) {
        msgs.push(_event(elapsed, 'ENGAGEMENT: NO Ku-FC TRACK \u2014 CANNOT GUIDE INTERCEPTOR'));
        break;
      }
    }

    const effectiveness = effectorEffectiveness(effState.type, d.drone_type);

    // Dispatch by explicit effector type to avoid ordering ambiguity
    if (effState.type === 'kinetic') {
      msgs.push(..._engageJackal(gs, d, effState, effectorId, targetId, elapsed));
    } else if (effState.type === 'de_laser' || effState.type === 'de_hpm') {
      msgs.push(..._queueDirectedEnergyEngagement(gs, d, effState, effectorId, targetId, elapsed, 'engage'));
    } else if (isShenobi) {
      const cmType = shenobiCm || 'shenobi_hold';
      msgs.push(..._engageNexus(gs, j, d, effState, effectorId, targetId, cmType, effectiveness, elapsed));
    } else if (isJammer) {
      msgs.push(..._engageJammer(gs, j, d, effState, effectorId, targetId, effectiveness, elapsed));
    } else {
      msgs.push(..._engageDirect(gs, j, d, effState, effectorId, targetId, effectiveness, elapsed));
    }

    if (!isDirectedEnergy) {
      _updateEffectorStatus(effState);
    }
    break;
  }

  return msgs;
}

export function handleJammerToggle(gs: GameState, effectorId: string, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  for (const effState of gs.effector_states) {
    if (effState.id !== effectorId) continue;
    if (effState.type !== 'rf_jam' && effState.type !== 'electronic') {
      msgs.push(_event(elapsed, `JAMMER: ${effState.name} is not a jammer effector`));
      break;
    }
    const currentlyActive = effState.jammer_active ?? false;
    effState.jammer_active = !currentlyActive;
    if (effState.jammer_active) {
      msgs.push(_event(elapsed, `RF JAMMER: ${effState.name} ACTIVATED \u2014 area suppression active`));
    } else {
      msgs.push(_event(elapsed, `RF JAMMER: ${effState.name} DEACTIVATED`));
    }
    break;
  }
  return msgs;
}

export function handleJamAll(gs: GameState, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  let activated = 0;
  for (const effState of gs.effector_states) {
    if (effState.type === 'rf_jam' || effState.type === 'electronic') {
      if (!effState.jammer_active) {
        effState.jammer_active = true;
        activated++;
      }
    }
  }
  if (activated > 0) {
    msgs.push(_event(elapsed, 'RF JAMMERS: ALL SYSTEMS ACTIVE'));
  } else {
    msgs.push(_event(elapsed, 'RF JAMMERS: All systems already active'));
  }
  return msgs;
}

export function handleCeaseJam(gs: GameState, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  let deactivated = 0;
  for (const effState of gs.effector_states) {
    if (effState.type === 'rf_jam' || effState.type === 'electronic') {
      if (effState.jammer_active) {
        effState.jammer_active = false;
        deactivated++;
      }
    }
  }
  if (deactivated > 0) {
    msgs.push(_event(elapsed, 'RF JAMMERS: ALL SYSTEMS OFFLINE'));
  } else {
    msgs.push(_event(elapsed, 'RF JAMMERS: No active systems to cease'));
  }
  return msgs;
}

const ATC_CLEARABLE = new Set(['passenger_aircraft', 'military_jet']);

export function handleClearAirspace(gs: GameState, elapsed: number): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  let rerouted = 0;
  for (let i = 0; i < gs.drones.length; i++) {
    const drone = gs.drones[i];
    if (!(drone.is_ambient && ATC_CLEARABLE.has(drone.drone_type))) continue;
    const angle = Math.atan2(drone.y, drone.x);
    const exitX = Math.round(12.0 * Math.cos(angle) * 100) / 100;
    const exitY = Math.round(12.0 * Math.sin(angle) * 100) / 100;
    const heading = ((Math.atan2(drone.y, drone.x) * 180 / Math.PI) % 360 + 360) % 360;
    const cfg = gs.drone_configs.get(drone.id);
    if (cfg) {
      gs.drone_configs.set(drone.id, { ...cfg, waypoints: [[exitX, exitY]], behavior: 'waypoint_path' });
    }
    gs.behaviors.set(drone.id, 'waypoint_path');
    gs.drones[i] = { ...drone, heading };
    rerouted++;
  }
  gs.ambient_suppressed_until = elapsed + 120.0;
  msgs.push(_event(elapsed, `AIRSPACE: CLEARED \u2014 ATC notified, ${rerouted} aircraft rerouting away from base`));
  return msgs;
}

export function handlePauseMission(gs: GameState, elapsed: number): Record<string, unknown>[] {
  if (gs.paused) return [];
  gs.paused = true;
  gs.pause_start_time = Date.now() / 1000;
  return [_event(elapsed, 'MISSION PAUSED')];
}

export function handleResumeMission(gs: GameState, elapsed: number): Record<string, unknown>[] {
  if (!gs.paused) return [];
  const pausedDuration = Date.now() / 1000 - gs.pause_start_time;
  gs.total_paused_seconds += pausedDuration;
  gs.paused = false;
  gs.pause_start_time = 0;
  return [_event(elapsed, 'MISSION RESUMED')];
}

export function handleEndMission(gs: GameState): Record<string, unknown>[] {
  gs.phase = 'debrief';
  return [];
}

// ---------------------------------------------------------------------------
// Internal engagement helpers
// ---------------------------------------------------------------------------

function _engageJammer(
  gs: GameState, droneIdx: number, d: DroneState, effState: EffectorRuntimeState,
  effectorId: string, targetId: string, effectiveness: number, elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  const inJamRange = checkEffectorInRange(effState, d);
  let radiatingMsg = `EW: ${effState.name} RADIATING`;
  if (!inJamRange) radiatingMsg += ` \u2014 target ${(d.display_label || d.id).toUpperCase()} outside effective range`;
  msgs.push(_event(elapsed, radiatingMsg));
  if (!inJamRange) return msgs;

  // FHSS mechanic: improvised_hardened auto-resists first jam attempt (30s cooldown)
  if (d.drone_type === 'improvised_hardened') {
    if (d.last_jam_attempt_ts === undefined || (elapsed - d.last_jam_attempt_ts) > 30) {
      gs.drones[droneIdx] = { ...d, last_jam_attempt_ts: elapsed };
      msgs.push(_event(elapsed, `EW: ${(d.display_label || d.id).toUpperCase()} \u2014 FREQUENCY HOP DETECTED, JAM INEFFECTIVE \u2014 FHSS ACTIVE`));
      msgs.push({
        type: 'engagement_result',
        target_id: targetId,
        effector: effectorId,
        effective: false,
        effectiveness: 0,
        effector_type: effState.type,
        effector_name: effState.name,
      });
      return msgs;
    }
  }

  const jamBehavior = d.rf_emitting ? pickJamBehavior(d.drone_type) : null;
  const [pntEffective, pntDrift] = applyPntJamming(d.drone_type);
  const pntDuration = pntEffective ? _randUniform(15.0, 25.0) : 0;

  if (jamBehavior === null && !pntEffective) {
    msgs.push(_event(elapsed, `JAM INEFFECTIVE \u2014 AUTONOMOUS NAVIGATION (${(d.display_label || d.id).toUpperCase()})`));
    msgs.push({
      type: 'engagement_result',
      target_id: targetId,
      effector: effectorId,
      effective: false,
      effectiveness: 0,
      effector_type: effState.type,
      effector_name: effState.name,
    });
  } else {
    const updateFields: Partial<DroneState> = {};
    const engagementResult: Record<string, unknown> = {
      type: 'engagement_result', target_id: targetId, effector: effectorId,
      effective: true, effectiveness: Math.round(effectiveness * 100) / 100,
      effector_type: effState.type,
      effector_name: effState.name,
    };

    if (jamBehavior !== null) {
      const jamDuration = jamBehavior === 'atti_mode'
        ? _randUniform(20.0, 40.0)
        : _randUniform(5.0, 10.0);
      updateFields.jammed = true;
      updateFields.jammed_behavior = jamBehavior;
      updateFields.jammed_time_remaining = jamDuration;
      const behaviorLabel = jamBehavior.replace(/_/g, ' ').toUpperCase();
      if (jamBehavior === 'atti_mode') {
        msgs.push(_event(elapsed, `EW: ${(d.display_label || d.id).toUpperCase()} \u2014 JAMMED (ATTI MODE) \u2014 POSITIONAL HOLD LOST, TRACK STILL ACTIVE`));
      } else {
        msgs.push(_event(elapsed, `EW: ${(d.display_label || d.id).toUpperCase()} JAMMED \u2014 ${behaviorLabel}`));
      }
      engagementResult.jammed = true;
      engagementResult.jammed_behavior = jamBehavior;
    }

    if (pntEffective) {
      updateFields.pnt_jammed = true;
      updateFields.pnt_drift_magnitude = pntDrift;
      updateFields.pnt_jammed_time_remaining = pntDuration;
      if (jamBehavior === null) {
        msgs.push(_event(elapsed, `PNT: ${(d.display_label || d.id).toUpperCase()} \u2014 NAVIGATION DEGRADED (${Math.round(pntDuration)}s)`));
        engagementResult.pnt_jammed = true;
        engagementResult.effective = true;
        engagementResult.effectiveness = Math.round(pntDrift * 10000) / 100;
      } else {
        msgs.push(_event(elapsed, `PNT: ${(d.display_label || d.id).toUpperCase()} \u2014 GPS DEGRADED (compounding RF jam)`));
        engagementResult.pnt_jammed = true;
      }
    }

    gs.drones[droneIdx] = { ...d, ...updateFields };
    gs.engage_times.set(targetId, elapsed);
    gs.effector_used.set(targetId, effState.type);
    gs.actions.push({ action: 'engage', target_id: targetId, effector: effectorId, timestamp: elapsed });
    msgs.push(engagementResult);
  }
  return msgs;
}

function _engageJackal(
  gs: GameState, d: DroneState, effState: EffectorRuntimeState,
  effectorId: string, targetId: string, elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];

  // Prevent launching multiple interceptors at the same target
  const existingJackal = gs.drones.find(
    dd => dd.is_interceptor && !dd.neutralized && dd.interceptor_target === targetId && dd.intercept_phase !== 'self_destruct',
  );
  if (existingJackal) {
    msgs.push(_event(elapsed, `JACKAL: BLOCKED — ${(existingJackal.display_label || existingJackal.id).toUpperCase()} already engaging ${_label(gs, targetId).toUpperCase()}`));
    return msgs;
  }

  const jackalCount = gs.drones.filter(dd => dd.is_interceptor).length;
  const jackalId = `JKIL-${String(jackalCount + 1).padStart(2, '0')}`;
  const effX = effState.x ?? 0;
  const effY = effState.y ?? 0;
  const dxTgt = d.x - effX;
  const dyTgt = d.y - effY;
  const headingTo = ((Math.atan2(dxTgt, dyTgt) * 180 / Math.PI) % 360 + 360) % 360;
  const spinupDuration = _randUniform(10.0, 15.0);

  const jackalDrone: DroneState = {
    id: jackalId, drone_type: 'jackal',
    x: effX, y: effY, altitude: 50, speed: 0,
    heading: headingTo, detected: true, classified: true,
    classification: 'jackal', dtid_phase: 'identified', affiliation: 'friendly',
    confidence: 1.0, is_interceptor: true,
    interceptor_target: targetId, intercept_phase: 'spinup',
    spinup_remaining: spinupDuration,
    trail: [], sensors_detecting: [], rf_emitting: true,
    coasting: false, coast_start_time: 0, last_known_heading: 0, last_known_speed: 0,
    hold_fire: false, wave_number: 0, is_ambient: false,
    jammed: false, jammed_behavior: null, jammed_time_remaining: 0,
    pnt_jammed: false, pnt_drift_magnitude: 0, pnt_jammed_time_remaining: 0,
    intercept_attempts: 0, frequency_band: null,
    uplink_detected: false, downlink_detected: false,
    shenobi_cm_active: null, shenobi_cm_state: null,
    shenobi_cm_time_remaining: 0, shenobi_cm_initial_duration: 0,
    neutralized: false,
    display_label: jackalId,
    jam_cooldown: 0,
    remove_at: null,
  };

  gs.drones.push(jackalDrone);
  gs.engage_times.set(targetId, elapsed);
  gs.effector_used.set(targetId, effState.type);
  gs.actions.push({ action: 'engage', target_id: targetId, effector: effectorId, timestamp: elapsed });
  msgs.push(_event(elapsed, `JACKAL ENGAGE \u2014 ${jackalId} SPINUP INITIATED (${Math.round(spinupDuration)}s TO LAUNCH)`));
  return msgs;
}

function _engageDirect(
  gs: GameState, droneIdx: number, d: DroneState, effState: EffectorRuntimeState,
  effectorId: string, targetId: string, effectiveness: number, elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  const neutralized = effectiveness > 0.5;
  gs.drones[droneIdx] = neutralized
    ? markDroneNeutralized(d, elapsed)
    : d;
  gs.engage_times.set(targetId, elapsed);
  gs.effector_used.set(targetId, effState.type);
  gs.actions.push({ action: 'engage', target_id: targetId, effector: effectorId, timestamp: elapsed });
  msgs.push({
    type: 'engagement_result', target_id: targetId, effector: effectorId,
    effective: neutralized, effectiveness: Math.round(effectiveness * 100) / 100,
    effector_type: effState.type,
    effector_name: effState.name,
  });
  const resultStr = neutralized ? 'NEUTRALIZED' : 'INEFFECTIVE';
  msgs.push(_event(elapsed, `ENGAGEMENT: ${effState.name} vs ${_label(gs, targetId).toUpperCase()} \u2014 ${resultStr}`));
  return msgs;
}

function _queueDirectedEnergyEngagement(
  gs: GameState,
  d: DroneState,
  effState: EffectorRuntimeState,
  effectorId: string,
  targetId: string,
  elapsed: number,
  mode: 'slew' | 'engage' | 'fire',
): Record<string, unknown>[] {
  const ex = effState.x ?? 0;
  const ey = effState.y ?? 0;
  const targetBearing = bearingToTargetDegrees(ex, ey, d.x, d.y);
  const slewSeconds = calculateDirectedEnergySlewSeconds(effState, d);
  const initialFacing = effState.facing_deg ?? targetBearing;

  effState.status = 'slewing';
  effState.recharge_remaining = slewSeconds;
  gs.pending_directed_energy_engagements.push({
    effector_id: effectorId,
    target_id: targetId,
    execute_at: elapsed + slewSeconds,
    queued_at: elapsed,
    initial_facing_deg: initialFacing,
    mode,
  });

  return [
    _event(
      elapsed,
      mode === 'engage'
        ? `ENGAGEMENT: ${effState.name} SLEWING \u2014 ${(d.display_label || d.id).toUpperCase()} (${slewSeconds.toFixed(1)}s aim time)`
        : `ENGAGEMENT: ${effState.name} SLEWING \u2014 ${(d.display_label || d.id).toUpperCase()} (${slewSeconds.toFixed(1)}s to orient, target out of range)`,
    ),
  ];
}

export function handleDirectedEnergyResolution(
  gs: GameState,
  targetId: string,
  effectorId: string,
  elapsed: number,
  mode: 'slew' | 'engage' | 'fire' = 'engage',
): Record<string, unknown>[] {
  const effState = findEffectorConfig(gs.effector_states, effectorId);
  if (!effState) return [];

  const droneIdx = gs.drones.findIndex((d) => d.id === targetId);
  if (droneIdx === -1) {
    effState.status = 'ready';
    effState.recharge_remaining = 0;
    return [_event(elapsed, `ENGAGEMENT: ${effState.name} — target lost during slew`)];
  }

  const targetDrone = gs.drones[droneIdx];
  if (targetDrone.neutralized) {
    effState.status = 'ready';
    effState.recharge_remaining = 0;
    return [_event(elapsed, `ENGAGEMENT: ${effState.name} — ${(targetDrone.display_label || targetDrone.id).toUpperCase()} already neutralized`)];
  }

  if (mode === 'slew') {
    effState.status = 'ready';
    effState.recharge_remaining = 0;
    return [_event(elapsed, `ENGAGEMENT: ${effState.name} on target \u2014 awaiting range on ${(targetDrone.display_label || targetDrone.id).toUpperCase()}`)];
  }

  if (!checkEffectorRangeOnly(effState, targetDrone)) {
    effState.status = 'ready';
    effState.recharge_remaining = 0;
    return [_event(elapsed, `ENGAGEMENT: ${effState.name} — Target moved out of range during slew`)];
  }

  if (mode === 'engage') {
    const effX = effState.x ?? 0;
    const effY = effState.y ?? 0;
    effState.facing_deg = bearingToTargetDegrees(effX, effY, targetDrone.x, targetDrone.y);
    effState.status = 'slewing';
    effState.recharge_remaining = 1.0;
    gs.pending_directed_energy_engagements.push({
      effector_id: effectorId,
      target_id: targetId,
      execute_at: elapsed + 1.0,
      queued_at: elapsed,
      initial_facing_deg: effState.facing_deg,
      mode: 'fire',
    });
    return [_event(elapsed, `ENGAGEMENT: ${effState.name} FIRING — ${(targetDrone.display_label || targetDrone.id).toUpperCase()} (1.0s dwell)` )];
  }

  const effectiveness = effectorEffectiveness(effState.type, targetDrone.drone_type);
  const msgs = effState.type === 'de_hpm'
    ? _engageHpm(gs, targetDrone, effState, effectorId, targetId, elapsed)
    : _engageDirect(gs, droneIdx, targetDrone, effState, effectorId, targetId, effectiveness, elapsed);

  _updateEffectorStatus(effState);
  return msgs;
}

function _engageHpm(
  gs: GameState, targetDrone: DroneState, effState: EffectorRuntimeState,
  effectorId: string, targetId: string, elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  const impactedIds: string[] = [];
  let neutralizedCount = 0;

  for (let i = 0; i < gs.drones.length; i++) {
    const candidate = gs.drones[i];
    if (candidate.is_interceptor || candidate.neutralized) continue;

    const distFromAimPoint = Math.hypot(candidate.x - targetDrone.x, candidate.y - targetDrone.y);
    if (candidate.id !== targetId && distFromAimPoint > HPM_SPLASH_RADIUS_KM) continue;
    if (!checkEffectorRangeOnly(effState, candidate)) continue;

    const effectiveness = effectorEffectiveness(effState.type, candidate.drone_type);
    const neutralized = effectiveness > 0.5;
    gs.drones[i] = neutralized
      ? markDroneNeutralized(candidate, elapsed)
      : candidate;
    gs.engage_times.set(candidate.id, elapsed);
    gs.effector_used.set(candidate.id, effState.type);
    gs.actions.push({ action: 'engage', target_id: candidate.id, effector: effectorId, timestamp: elapsed });
    impactedIds.push(candidate.display_label || candidate.id);
    if (neutralized) neutralizedCount++;
    msgs.push({
      type: 'engagement_result',
      target_id: candidate.id,
      effector: effectorId,
      effective: neutralized,
      effectiveness: Math.round(effectiveness * 100) / 100,
      effector_type: effState.type,
      effector_name: effState.name,
    });
  }

  if (impactedIds.length === 0) {
    msgs.push(_event(elapsed, `ENGAGEMENT: ${effState.name} pulse dissipated without effect`));
    return msgs;
  }

  msgs.push(
    _event(
      elapsed,
      `ENGAGEMENT: ${effState.name} pulse affected ${impactedIds.length} track(s) — ${neutralizedCount} neutralized`,
    ),
  );
  return msgs;
}

function _engageNexus(
  gs: GameState, droneIdx: number, d: DroneState, effState: EffectorRuntimeState,
  effectorId: string, targetId: string, cmType: string, effectiveness: number, elapsed: number,
): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];

  if (!checkNexusRfTracking(gs.sensor_configs, d)) {
    msgs.push(_event(elapsed, `Shenobi: NO RF TRACK \u2014 ${_label(gs, targetId).toUpperCase()} not detected by Shenobi sensor`));
    return msgs;
  }

  if (!checkEffectorInRange(effState, d)) {
    msgs.push(_event(elapsed, `Shenobi: ${_label(gs, targetId).toUpperCase()} outside defeat range (6km)`));
    return msgs;
  }

  if (!isShenobiVulnerable(d)) {
    msgs.push(_event(elapsed, `Shenobi: ${_label(gs, targetId).toUpperCase()} \u2014 NO PROTOCOL MATCH (not in library)`));
    msgs.push({
      type: 'engagement_result',
      target_id: targetId,
      effector: effectorId,
      effective: false,
      effectiveness: 0,
      effector_type: effState.type,
      effector_name: effState.name,
    });
    return msgs;
  }

  if (!pickShenobiCmEffectiveness(d, cmType)) {
    const cmLabel = cmType.replace('shenobi_', '').toUpperCase();
    msgs.push(_event(elapsed, `Shenobi: ${cmLabel} INEFFECTIVE \u2014 autonomous navigation (${_label(gs, targetId).toUpperCase()})`));
    msgs.push({
      type: 'engagement_result',
      target_id: targetId,
      effector: effectorId,
      effective: false,
      effectiveness: 0,
      shenobi_cm: cmType,
      effector_type: effState.type,
      effector_name: effState.name,
    });
    return msgs;
  }

  const freq = DRONE_FREQUENCY_MAP[d.drone_type] ?? '2.4GHz';
  const cmDuration = _randUniform(15.0, 30.0);
  const cmLabel = cmType.replace('shenobi_', '').replace(/_/g, ' ').toUpperCase();

  // Do NOT set dtid_phase: 'defeated' here — drone is still active.
  // defeated is set by shenobi.ts when neutralized=true is resolved.
  gs.drones[droneIdx] = {
    ...d,
    shenobi_cm_active: cmType,
    shenobi_cm_state: 'pending',
    shenobi_cm_time_remaining: cmDuration,
    shenobi_cm_initial_duration: cmDuration,
    frequency_band: freq,
    downlink_detected: true,
  };
  gs.engage_times.set(targetId, elapsed);
  gs.effector_used.set(targetId, effState.type);
  gs.actions.push({ action: 'engage', target_id: targetId, effector: effectorId, timestamp: elapsed });
  msgs.push(_event(elapsed, `Shenobi: ${cmLabel} command sent to ${_label(gs, targetId).toUpperCase()} on ${freq}`));
  msgs.push({
    type: 'engagement_result', target_id: targetId, effector: effectorId,
    effective: true, effectiveness: Math.round(effectiveness * 100) / 100,
    shenobi_cm: cmType, shenobi_cm_state: 'pending',
    effector_type: effState.type,
    effector_name: effState.name,
  });
  return msgs;
}

function _updateEffectorStatus(effState: EffectorRuntimeState): void {
  if (effState.type === 'rf_jam' || effState.type === 'electronic') return;
  if (effState.ammo_remaining !== null && effState.ammo_remaining !== undefined) {
    effState.ammo_remaining -= 1;
    if (effState.ammo_remaining <= 0) {
      effState.status = 'depleted';
    }
  } else if (effState.single_use || effState.recharge_seconds === 0) {
    effState.status = 'offline';
  } else if (effState.recharge_seconds > 0) {
    effState.status = 'recharging';
    effState.recharge_remaining = effState.recharge_seconds;
  }
}
