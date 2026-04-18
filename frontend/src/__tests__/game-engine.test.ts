/**
 * Game engine unit tests — covers detection math, confidence calculation,
 * drone movement, jamming behavior, and scoring fundamentals.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SensorSimulator,
  calculateConfidence,
  segmentsIntersect,
} from '@opensentry/game/detection';
import { createDefaultDrone, createGameState } from '@opensentry/game/state';
import type { DroneState, EffectorConfig, EffectorRuntimeState, SensorConfig, ScenarioConfig } from '@opensentry/game/state';
import { createDroneFromConfig, moveDrone, distanceToBase } from '@opensentry/game/drone';
import { pickJamBehavior, updatePntJammedDrone } from '@opensentry/game/jamming';
import { KTS_TO_KMS, calculateDirectedEnergySlewSeconds } from '@opensentry/game/helpers';
import { handleEngage } from '@opensentry/game/actions';
import { calculateScore } from '@opensentry/game/scoring';
import { tickPendingDirectedEnergyEngagements } from '@opensentry/game/loop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSensor(overrides: Partial<SensorConfig> = {}): SensorConfig {
  return {
    id: 'radar_1',
    name: 'Test Radar',
    type: 'radar',
    range_km: 10,
    status: 'active',
    x: 0,
    y: 0,
    fov_deg: 360,
    facing_deg: 0,
    requires_los: false,
    ...overrides,
  };
}

function makeDrone(overrides: Partial<DroneState> = {}): DroneState {
  return createDefaultDrone({
    id: 'drone_1',
    drone_type: 'commercial_quad',
    x: 3,
    y: 0,
    altitude: 200,
    speed: 40,
    heading: 180,
    ...overrides,
  });
}

function makeScenario(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    id: 'test',
    name: 'Test',
    description: 'Test scenario',
    difficulty: 'easy',
    duration_seconds: 300,
    drones: [],
    base_radius_km: 1,
    engagement_zones: {
      detection_range_km: 10,
      identification_range_km: 5,
      engagement_range_km: 3,
    },
    sensors: [],
    effectors: [],
    correct_classification: 'commercial_quad',
    correct_affiliation: 'hostile',
    optimal_effectors: [],
    acceptable_effectors: [],
    roe_violations: [],
    tutorial: false,
    tutorial_prompts: null,
    no_ambient: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Detection tests
// ---------------------------------------------------------------------------

describe('SensorSimulator', () => {
  let sim: SensorSimulator;

  beforeEach(() => {
    sim = new SensorSimulator([]);
  });

  describe('detect_radar', () => {
    it('detects drone within range', () => {
      const sensor = makeSensor({ range_km: 10 });
      const drone = makeDrone({ x: 3, y: 0 }); // 3km away
      // Run many times to account for probability
      let detected = 0;
      for (let i = 0; i < 100; i++) {
        if (sim.detect_radar(drone, sensor) !== null) detected++;
      }
      // At 3km out of 10km range (ratio 0.3), detectProb = 1.0
      expect(detected).toBe(100);
    });

    it('never detects drone beyond range', () => {
      const sensor = makeSensor({ range_km: 5 });
      const drone = makeDrone({ x: 6, y: 0 }); // 6km away, beyond 5km range
      for (let i = 0; i < 100; i++) {
        expect(sim.detect_radar(drone, sensor)).toBeNull();
      }
    });

    it('respects FOV constraints', () => {
      const sensor = makeSensor({ fov_deg: 30, facing_deg: 0 }); // narrow FOV facing north
      const drone = makeDrone({ x: 5, y: 0 }); // due east (bearing ~90)
      for (let i = 0; i < 50; i++) {
        expect(sim.detect_radar(drone, sensor)).toBeNull();
      }
    });

    it('returns valid reading structure', () => {
      const sensor = makeSensor({ range_km: 10 });
      const drone = makeDrone({ x: 2, y: 0 });
      const reading = sim.detect_radar(drone, sensor);
      expect(reading).not.toBeNull();
      expect(reading!.sensor_id).toBe('radar_1');
      expect(reading!.range_km).toBeGreaterThan(0);
      expect(reading!.altitude_ft).toBeGreaterThan(0);
      expect(reading!.speed_kts).toBeGreaterThan(0);
      expect(reading!.heading_deg).toBeGreaterThanOrEqual(0);
      expect(reading!.heading_deg).toBeLessThan(360);
    });
  });

  describe('detect_rf', () => {
    it('does not detect drone with rf_emitting=false', () => {
      const sensor = makeSensor({ type: 'rf', range_km: 10 });
      const drone = makeDrone({ rf_emitting: false });
      for (let i = 0; i < 50; i++) {
        expect(sim.detect_rf(drone, sensor)).toBeNull();
      }
    });

    it('detects RF-emitting drone in range', () => {
      const sensor = makeSensor({ type: 'rf', range_km: 10 });
      const drone = makeDrone({ x: 2, y: 0, rf_emitting: true });
      let detected = 0;
      for (let i = 0; i < 100; i++) {
        if (sim.detect_rf(drone, sensor) !== null) detected++;
      }
      expect(detected).toBeGreaterThan(90); // ratio 0.2, should be ~100%
    });
  });

  describe('detect_eoir', () => {
    it('detects drone with LOS clear', () => {
      const sensor = makeSensor({ type: 'eoir', range_km: 8 });
      const drone = makeDrone({ x: 2, y: 0 });
      let detected = 0;
      for (let i = 0; i < 100; i++) {
        if (sim.detect_eoir(drone, sensor) !== null) detected++;
      }
      expect(detected).toBeGreaterThan(90);
    });

    it('blocks detection with terrain LOS', () => {
      const terrain = [{
        id: 'wall', type: 'building', name: 'Wall',
        polygon: [[1, -1], [1, 1], [1.1, 1], [1.1, -1]],
        blocks_los: true,
        height_m: 50,
      }];
      const simWithTerrain = new SensorSimulator(terrain);
      const sensor = makeSensor({ type: 'eoir', range_km: 8, x: 0, y: 0 });
      const drone = makeDrone({ x: 3, y: 0 }); // behind wall
      for (let i = 0; i < 50; i++) {
        expect(simWithTerrain.detect_eoir(drone, sensor)).toBeNull();
      }
    });
  });

  describe('inactive sensor', () => {
    it('returns null when sensor status is not active', () => {
      const sensor = makeSensor({ status: 'offline' });
      const drone = makeDrone({ x: 2, y: 0 });
      expect(sim.detect(drone, sensor)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Detection probability edge case (bug fix validation)
// ---------------------------------------------------------------------------

describe('radar detection probability at edge of range', () => {
  it('never returns negative probability (ratio > 1.0 guard)', () => {
    const sim = new SensorSimulator([]);
    const sensor = makeSensor({ range_km: 5 });
    // Drone at exactly range boundary — ratio = 1.0
    // Before fix, ratio > 0.9 could yield negative detectProb
    // After fix, Math.max(0, ...) prevents it
    const drone = makeDrone({ x: 4.8, y: 0 }); // ratio ≈ 0.96
    // This should not crash and detection prob should be >= 0
    let nullCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (sim.detect_radar(drone, sensor) === null) nullCount++;
    }
    // At ratio 0.96, detectProb = max(0, 1 - 0.06*5) = max(0, 0.7) = 0.7
    // So ~30% should be null
    expect(nullCount).toBeGreaterThan(100);
    expect(nullCount).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Confidence calculation
// ---------------------------------------------------------------------------

describe('calculateConfidence', () => {
  it('returns 0 with no sensors detecting', () => {
    expect(calculateConfidence([], 5)).toBe(0);
  });

  it('returns higher confidence with more sensors', () => {
    const conf1 = calculateConfidence(['s1'], 2);
    const conf2 = calculateConfidence(['s1', 's2'], 2);
    const conf3 = calculateConfidence(['s1', 's2', 's3'], 2);
    expect(conf2).toBeGreaterThan(conf1);
    expect(conf3).toBeGreaterThan(conf2);
  });

  it('returns higher confidence at closer range', () => {
    const close = calculateConfidence(['s1', 's2'], 0.5);
    const far = calculateConfidence(['s1', 's2'], 5);
    expect(close).toBeGreaterThan(far);
  });

  it('clamps between 0 and 1', () => {
    const conf = calculateConfidence(['s1', 's2', 's3', 's4', 's5'], 0.1);
    expect(conf).toBeLessThanOrEqual(1);
    expect(conf).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Geometry: segmentsIntersect
// ---------------------------------------------------------------------------

describe('segmentsIntersect', () => {
  it('detects crossing segments', () => {
    expect(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0)).toBe(true);
  });

  it('returns false for non-crossing segments', () => {
    expect(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false);
  });

  it('returns false for parallel segments', () => {
    expect(segmentsIntersect(0, 0, 2, 0, 0, 1, 2, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drone movement
// ---------------------------------------------------------------------------

describe('createDroneFromConfig', () => {
  it('creates drone with correct initial state', () => {
    const drone = createDroneFromConfig({
      id: 'test_1',
      drone_type: 'commercial_quad',
      start_x: 5,
      start_y: 3,
      altitude: 300,
      speed: 50,
      heading: 90,
      behavior: 'direct_approach',
      rf_emitting: true,
      spawn_delay: 0,
      should_engage: true,
    });
    expect(drone.id).toBe('test_1');
    expect(drone.x).toBe(5);
    expect(drone.y).toBe(3);
    expect(drone.altitude).toBe(300);
    expect(drone.neutralized).toBe(false);
    expect(drone.dtid_phase).toBe('detected');
    expect(drone.trail).toEqual([[5, 3]]);
  });
});

describe('distanceToBase', () => {
  it('calculates distance from origin', () => {
    const drone = makeDrone({ x: 3, y: 4 });
    expect(distanceToBase(drone)).toBeCloseTo(5, 5);
  });

  it('returns 0 at origin', () => {
    const drone = makeDrone({ x: 0, y: 0 });
    expect(distanceToBase(drone)).toBe(0);
  });
});

describe('moveDrone', () => {
  it('moves drone toward base on direct_approach', () => {
    const drone = makeDrone({ x: 5, y: 0, heading: 180, speed: 100 });
    const evasiveStates = new Map();
    const moved = moveDrone(drone, 0.1, 'direct_approach', { evasive_states: evasiveStates });
    // Should move closer to origin
    expect(moved.x).toBeLessThan(5);
  });

  it('preserves trail within max length', () => {
    let drone = makeDrone({ x: 5, y: 0, speed: 100, heading: 180 });
    const evasiveStates = new Map();
    // Move 30 times — trail should never exceed 20
    for (let i = 0; i < 30; i++) {
      drone = moveDrone(drone, 0.1, 'direct_approach', { evasive_states: evasiveStates });
    }
    expect(drone.trail.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// Jamming
// ---------------------------------------------------------------------------

describe('pickJamBehavior', () => {
  it('returns a valid behavior string', () => {
    const validBehaviors = ['loss_of_control', 'rth', 'forced_landing', 'atti_mode', 'gps_spoof'];
    const seen = new Set<string | null>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickJamBehavior('commercial_quad'));
    }
    const nonNullBehaviors = [...seen].filter((behavior): behavior is string => behavior !== null);
    expect(nonNullBehaviors.length).toBeGreaterThan(0);
    expect(nonNullBehaviors.every((behavior) => validBehaviors.includes(behavior))).toBe(true);
  });

  it('returns null for RF-immune types', () => {
    const behavior = pickJamBehavior('shahed');
    expect(behavior).toBeNull();
  });

  it('birds use default 50% resistance (immunity handled via rf_emitting elsewhere)', () => {
    let nullCount = 0;
    for (let i = 0; i < 200; i++) {
      if (pickJamBehavior('bird') === null) nullCount++;
    }
    // Default resistance is 50% — expect roughly half to resist
    expect(nullCount).toBeGreaterThan(50);
    expect(nullCount).toBeLessThan(150);
  });
});

describe('updatePntJammedDrone', () => {
  it('applies drift to drone position', () => {
    const drone = makeDrone({
      x: 3, y: 0,
      pnt_jammed: true,
      pnt_drift_magnitude: 0.008,
      pnt_jammed_time_remaining: 10,
    });
    const [updated, events] = updatePntJammedDrone(drone, 0.1, 5.0);
    // Position should change due to drift
    const driftApplied = updated.x !== 3 || updated.y !== 0;
    expect(driftApplied).toBe(true);
    // Timer should decrease
    expect(updated.pnt_jammed_time_remaining).toBeLessThan(10);
  });

  it('clears PNT jam when timer expires', () => {
    const drone = makeDrone({
      x: 3, y: 0,
      pnt_jammed: true,
      pnt_drift_magnitude: 0.008,
      pnt_jammed_time_remaining: 0.05,
    });
    const [updated, events] = updatePntJammedDrone(drone, 0.1, 5.0);
    expect(updated.pnt_jammed).toBe(false);
    expect(updated.pnt_jammed_time_remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GameState factory
// ---------------------------------------------------------------------------

describe('createGameState', () => {
  it('creates initial game state with correct defaults', () => {
    const scenario: ScenarioConfig = {
      id: 'test',
      name: 'Test',
      description: 'Test scenario',
      difficulty: 'easy',
      duration_seconds: 300,
      drones: [],
      base_radius_km: 1,
      engagement_zones: { detection_range_km: 10, identification_range_km: 5, engagement_range_km: 3 },
      sensors: [],
      effectors: [],
      correct_classification: 'commercial_quad',
      correct_affiliation: 'hostile',
      optimal_effectors: [],
      acceptable_effectors: [],
      roe_violations: [],
      tutorial: false,
      tutorial_prompts: null,
      no_ambient: false,
    };
    const gs = createGameState(scenario, [], [], null, null, []);
    expect(gs.phase).toBe('running');
    expect(gs.drones).toEqual([]);
    expect(gs.current_wave).toBe(1);
    expect(gs.paused).toBe(false);
    expect(gs.max_duration).toBe(300);
  });
});

describe('directed energy engagements', () => {
  it('blocks DE-LASER when terrain blocks line of sight', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 5,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 360,
      facing_deg: 0,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const terrain = [{
      id: 'wall',
      type: 'building',
      name: 'Wall',
      polygon: [[1, -1], [1, 1], [1.1, 1], [1.1, -1]],
      blocks_los: true,
      height_m: 50,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, terrain);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 3,
      y: 0,
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    const msgs = handleEngage(gs, 'bogey-1', 'de_laser', 10);

    expect(msgs.some((msg) => String(msg.message ?? '').includes('NO LINE OF SIGHT'))).toBe(true);
    expect(gs.drones[0].neutralized).toBe(false);
    expect(gs.effector_states[0].status).toBe('ready');
  });

  it('applies DE-HPM to clustered drones and emits effector metadata', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_hpm',
      name: 'DE-HPM-3km',
      type: 'de_hpm',
      range_km: 5,
      status: 'ready',
      recharge_seconds: 30,
      x: 0,
      y: 0,
      fov_deg: 360,
      facing_deg: 0,
      requires_los: false,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(
      makeDrone({
        id: 'bogey-1',
        display_label: 'TRN-001',
        x: 1.0,
        y: 0.0,
        drone_type: 'micro',
        dtid_phase: 'identified',
        classification: 'micro',
        classified: true,
        affiliation: 'hostile',
      }),
      makeDrone({
        id: 'bogey-2',
        display_label: 'TRN-002',
        x: 1.35,
        y: 0.2,
        drone_type: 'commercial_quad',
        dtid_phase: 'identified',
        classification: 'commercial_quad',
        classified: true,
        affiliation: 'hostile',
      }),
      makeDrone({
        id: 'bogey-3',
        display_label: 'TRN-003',
        x: 3.0,
        y: 0.0,
        drone_type: 'commercial_quad',
        dtid_phase: 'identified',
        classification: 'commercial_quad',
        classified: true,
        affiliation: 'hostile',
      }),
    );

    const msgs = handleEngage(gs, 'bogey-1', 'de_hpm', 10);
    expect(msgs.some((msg) => String(msg.message ?? '').includes('SLEWING'))).toBe(true);

    const fireMsgs = tickPendingDirectedEnergyEngagements(gs, 20);
    const results = fireMsgs.filter((msg) => msg.type === 'engagement_result');

    expect(results).toHaveLength(2);
    expect(results.every((msg) => msg.effector_type === 'de_hpm')).toBe(true);
    expect(results.every((msg) => msg.effector_name === 'DE-HPM-3km')).toBe(true);
    expect(gs.drones[0].neutralized).toBe(true);
    expect(gs.drones[1].neutralized).toBe(true);
    expect(gs.drones[2].neutralized).toBe(false);
    expect(gs.effector_states[0].status).toBe('recharging');
  });

  it('queues DE-LASER slew when target is outside current FOV but in range', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 5,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 180,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 2.5,
      y: 0,
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    const msgs = handleEngage(gs, 'bogey-1', 'de_laser', 10);

    expect(msgs.some((msg) => String(msg.message ?? '').includes('SLEWING'))).toBe(true);
    expect(gs.effector_states[0].status).toBe('slewing');
    expect(gs.effector_states[0].facing_deg).toBe(180);
    expect(gs.drones[0].neutralized).toBe(false);
    expect(gs.pending_directed_energy_engagements).toHaveLength(1);
    expect(gs.pending_directed_energy_engagements[0].mode).toBe('engage');
  });

  it('pre-slews DE-LASER when target is outside range', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 3,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 180,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 4.0,
      y: 0,
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    const msgs = handleEngage(gs, 'bogey-1', 'de_laser', 10);

    expect(msgs.some((msg) => String(msg.message ?? '').includes('target out of range'))).toBe(true);
    expect(gs.effector_states[0].status).toBe('slewing');
    expect(gs.pending_directed_energy_engagements).toHaveLength(1);
    expect(gs.pending_directed_energy_engagements[0].mode).toBe('slew');
  });

  it('progressively slews DE-LASER cone before firing', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 5,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 180,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 2.5,
      y: 0,
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    handleEngage(gs, 'bogey-1', 'de_laser', 10);
    tickPendingDirectedEnergyEngagements(gs, 10.5);

    expect(gs.effector_states[0].status).toBe('slewing');
    expect(gs.effector_states[0].facing_deg).toBeGreaterThan(90);
    expect(gs.effector_states[0].facing_deg).toBeLessThan(180);
  });

  it('fires queued DE-LASER after slew time elapses', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 5,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 180,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 2.5,
      y: 0,
      drone_type: 'commercial_quad',
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    handleEngage(gs, 'bogey-1', 'de_laser', 10);
    const fireMsgs = tickPendingDirectedEnergyEngagements(gs, 20);

    expect(fireMsgs.some((msg) => msg.type === 'engagement_result')).toBe(true);
    expect(gs.effector_states[0].status).toBe('recharging');
    expect(gs.drones[0].neutralized).toBe(true);
    expect(gs.pending_directed_energy_engagements).toHaveLength(0);
  });

  it('returns DE-LASER to ready after an out-of-range pre-slew completes', () => {
    const effectors: EffectorConfig[] = [{
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 3,
      status: 'ready',
      recharge_seconds: 15,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 180,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    }];
    const gs = createGameState(makeScenario({ effectors }), [], effectors, null, null, []);
    gs.effector_states.push({
      ...effectors[0],
      recharge_remaining: 0,
    });
    gs.drones.push(makeDrone({
      id: 'bogey-1',
      display_label: 'TRN-001',
      x: 4.0,
      y: 0,
      dtid_phase: 'identified',
      classification: 'commercial_quad',
      classified: true,
      affiliation: 'hostile',
    }));

    handleEngage(gs, 'bogey-1', 'de_laser', 10);
    const slewMsgs = tickPendingDirectedEnergyEngagements(gs, 20);

    expect(slewMsgs.some((msg) => String(msg.message ?? '').includes('awaiting range'))).toBe(true);
    expect(slewMsgs.some((msg) => msg.type === 'engagement_result')).toBe(false);
    expect(gs.effector_states[0].status).toBe('ready');
    expect(gs.effector_states[0].facing_deg).toBe(90);
    expect(gs.drones[0].neutralized).toBe(false);
    expect(gs.pending_directed_energy_engagements).toHaveLength(0);
  });
});

describe('calculateDirectedEnergySlewSeconds', () => {
  it('increases slew time for larger angle changes and crossing targets', () => {
    const baseEffector: EffectorRuntimeState = {
      id: 'de_laser',
      name: 'DE-LASER-3km',
      type: 'de_laser',
      range_km: 3,
      status: 'ready',
      recharge_seconds: 15,
      recharge_remaining: 0,
      x: 0,
      y: 0,
      fov_deg: 10,
      facing_deg: 0,
      requires_los: true,
      single_use: false,
      ammo_count: null,
      ammo_remaining: null,
    };

    const lowSlew = calculateDirectedEnergySlewSeconds(
      baseEffector,
      makeDrone({ x: 0, y: 2, heading: 180, speed: 15 }),
    );
    const highSlew = calculateDirectedEnergySlewSeconds(
      baseEffector,
      makeDrone({ x: 2, y: 0, heading: 0, speed: 80 }),
    );

    expect(highSlew).toBeGreaterThan(lowSlew);
    expect(lowSlew).toBeGreaterThan(0);
  });
});

describe('directed energy scoring', () => {
  it('normalizes placement effector ids for ROE scoring', () => {
    const scenario = makeScenario({
      correct_classification: 'commercial_quad',
      correct_affiliation: 'hostile',
      acceptable_effectors: ['de_hpm'],
      roe_violations: ['de_hpm'],
    });
    const score = calculateScore(
      scenario,
      [{ action: 'engage', target_id: 'bogey-1', effector: 'effector_0_de_hpm_3k', timestamp: 12 }],
      0,
      4,
      8,
      12,
      'commercial_quad',
      'hostile',
      'de_hpm',
      false,
      0.9,
      2,
      20,
    );

    expect(score.roe_score).toBe(0);
    expect(score.details.roe).toContain('de_hpm');
    expect(score.details.defeat).toContain('collateral risk');
  });
});
