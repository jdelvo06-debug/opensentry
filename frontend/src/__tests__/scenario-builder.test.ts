import { describe, it, expect } from "vitest";
import {
  asDroneType,
  buildScenarioDrones,
  computeScenarioDuration,
  headingTowardOrigin,
  normalizeWave,
  normalizeWaves,
  sectorToBearing,
} from "../utils/scenarioBuilderUtils";
import type { WaveDef } from "../components/WaveComposer";
import {
  createNewWave,
  nextThreatGroupId,
  nextWaveId,
  resetWaveIdCounter,
} from "../components/WaveComposer";

function makeWave(overrides: Partial<WaveDef> = {}): WaveDef {
  return {
    id: "w1",
    startSeconds: 60,
    threatGroups: [
      {
        id: "g1",
        droneType: "commercial_quad",
        count: 2,
        bearingDeg: 90,
        spawnOffsetSeconds: 0,
        staggerSeconds: 5,
        altitude: 150,
        speed: 35,
        behavior: "direct_approach",
      },
    ],
    ...overrides,
  };
}

describe("sectorToBearing", () => {
  it("converts cardinal directions to bearings", () => {
    expect(sectorToBearing("N", 0)).toBe(90);
    expect(sectorToBearing("NE", 0)).toBe(45);
    expect(sectorToBearing("E", 0)).toBe(0);
    expect(sectorToBearing("SE", 0)).toBe(315);
    expect(sectorToBearing("S", 0)).toBe(270);
    expect(sectorToBearing("SW", 0)).toBe(225);
    expect(sectorToBearing("W", 0)).toBe(180);
    expect(sectorToBearing("NW", 0)).toBe(135);
  });

  it("handles lowercase names, numeric strings, and fallback values", () => {
    expect(sectorToBearing("north", 0)).toBe(90);
    expect(sectorToBearing("southwest", 0)).toBe(225);
    expect(sectorToBearing("45", 0)).toBe(45);
    expect(sectorToBearing("unknown", 42)).toBe(42);
    expect(sectorToBearing(180, 0)).toBe(180);
  });
});

describe("headingTowardOrigin", () => {
  it("points from the spawn point back toward base center", () => {
    expect(headingTowardOrigin(5, 0)).toBe(180);
    expect(Math.round(headingTowardOrigin(0, 5))).toBe(270);
  });

  it("returns a normalized heading", () => {
    for (let i = 0; i < 100; i++) {
      const heading = headingTowardOrigin(Math.random() * 10 - 5, Math.random() * 10 - 5);
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }
  });
});

describe("asDroneType", () => {
  it("returns valid drone types unchanged", () => {
    expect(asDroneType("shahed")).toBe("shahed");
    expect(asDroneType("commercial_quad")).toBe("commercial_quad");
    expect(asDroneType("fixed_wing")).toBe("fixed_wing");
  });

  it("falls back to commercial_quad for invalid types", () => {
    expect(asDroneType("drone")).toBe("commercial_quad");
    expect(asDroneType(123)).toBe("commercial_quad");
    expect(asDroneType(null)).toBe("commercial_quad");
  });
});

describe("normalizeWave", () => {
  it("preserves a multi-threat wave shape", () => {
    const normalized = normalizeWave(makeWave({
      threatGroups: [
        {
          id: "g1",
          droneType: "micro",
          count: 3,
          bearingDeg: 45,
          spawnOffsetSeconds: 20,
          staggerSeconds: 8,
          altitude: 80,
          speed: 25,
          behavior: "evasive",
        },
      ],
    }));

    expect(normalized.startSeconds).toBe(60);
    expect(normalized.threatGroups[0]).toMatchObject({
      droneType: "micro",
      count: 3,
      bearingDeg: 45,
      spawnOffsetSeconds: 20,
      behavior: "evasive",
    });
  });

  it("normalizes legacy one-threat waves", () => {
    const normalized = normalizeWave({
      id: "legacy",
      droneType: "fixed_wing",
      count: 2,
      spawnSector: "W",
      delaySeconds: 120,
      staggerSeconds: 12,
      altitude: 300,
      speed: 60,
      behavior: "waypoint_path",
    });

    expect(normalized.startSeconds).toBe(120);
    expect(normalized.threatGroups).toHaveLength(1);
    expect(normalized.threatGroups[0]).toMatchObject({
      droneType: "fixed_wing",
      count: 2,
      bearingDeg: 180,
      spawnOffsetSeconds: 0,
      staggerSeconds: 12,
      behavior: "waypoint_path",
    });
  });

  it("normalizes invalid group values to playable defaults", () => {
    const normalized = normalizeWave(makeWave({
      threatGroups: [
        {
          id: "bad",
          droneType: "not_a_drone",
          count: -3,
          bearingDeg: -90,
          spawnOffsetSeconds: -10,
          staggerSeconds: -5,
          altitude: -1,
          speed: 0,
          behavior: "direct_approach",
        },
      ],
    }));

    expect(normalized.threatGroups[0]).toMatchObject({
      droneType: "commercial_quad",
      count: 1,
      bearingDeg: 270,
      spawnOffsetSeconds: 0,
      staggerSeconds: 0,
      altitude: 10,
      speed: 5,
    });
  });

  it("normalizes waves with fallback IDs", () => {
    const [normalized] = normalizeWaves([{ id: "", threatGroups: [] }]);

    expect(normalized.id).toBe("wave-1");
    expect(normalized.threatGroups[0].id).toBe("group-1");
  });
});

describe("computeScenarioDuration", () => {
  it("returns at least 360 seconds for empty or early waves", () => {
    expect(computeScenarioDuration([])).toBe(360);
    expect(computeScenarioDuration([makeWave({ startSeconds: 30 })])).toBe(360);
  });

  it("computes duration from latest threat group end time", () => {
    const waves: WaveDef[] = [
      makeWave({
        id: "w1",
        startSeconds: 500,
        threatGroups: [
          {
            id: "g1",
            droneType: "commercial_quad",
            count: 1,
            bearingDeg: 90,
            spawnOffsetSeconds: 0,
            staggerSeconds: 5,
            altitude: 150,
            speed: 35,
            behavior: "direct_approach",
          },
          {
            id: "g2",
            droneType: "shahed",
            count: 2,
            bearingDeg: 180,
            spawnOffsetSeconds: 80,
            staggerSeconds: 10,
            altitude: 300,
            speed: 100,
            behavior: "direct_approach",
          },
        ],
      }),
    ];

    expect(computeScenarioDuration(waves)).toBe(690);
  });

  it("keeps legacy duration behavior readable", () => {
    expect(computeScenarioDuration([{
      id: "legacy",
      droneType: "commercial_quad",
      count: 1,
      spawnSector: "N",
      delaySeconds: 500,
      staggerSeconds: 5,
      altitude: 150,
      speed: 35,
      behavior: "direct_approach",
    }])).toBe(600);
  });
});

describe("buildScenarioDrones", () => {
  it("returns empty array for empty waves", () => {
    expect(buildScenarioDrones([])).toEqual([]);
  });

  it("generates drones from multiple threat groups in one wave", () => {
    const drones = buildScenarioDrones([
      makeWave({
        startSeconds: 100,
        threatGroups: [
          {
            id: "g1",
            droneType: "commercial_quad",
            count: 2,
            bearingDeg: 90,
            spawnOffsetSeconds: 0,
            staggerSeconds: 5,
            altitude: 150,
            speed: 35,
            behavior: "direct_approach",
          },
          {
            id: "g2",
            droneType: "shahed",
            count: 1,
            bearingDeg: 180,
            spawnOffsetSeconds: 45,
            staggerSeconds: 0,
            altitude: 300,
            speed: 100,
            behavior: "evasive",
          },
        ],
      }),
    ]);

    expect(drones).toHaveLength(3);
    expect(drones.map((d) => d.id)).toEqual([
      "wave-1-group-1-1",
      "wave-1-group-1-2",
      "wave-1-group-2-1",
    ]);
    expect(drones.map((d) => d.spawn_delay)).toEqual([100, 105, 145]);
    expect(drones[2]).toMatchObject({ drone_type: "shahed", behavior: "evasive" });
  });

  it("applies per-group stagger after wave start and group offset", () => {
    const drones = buildScenarioDrones([
      makeWave({
        startSeconds: 40,
        threatGroups: [
          {
            id: "g1",
            droneType: "micro",
            count: 3,
            bearingDeg: 90,
            spawnOffsetSeconds: 25,
            staggerSeconds: 7,
            altitude: 80,
            speed: 25,
            behavior: "direct_approach",
          },
        ],
      }),
    ]);

    expect(drones.map((drone) => drone.spawn_delay)).toEqual([65, 72, 79]);
  });

  it("still builds legacy one-threat waves", () => {
    const drones = buildScenarioDrones([{
      id: "legacy",
      droneType: "fixed_wing",
      count: 2,
      spawnSector: "S",
      delaySeconds: 90,
      staggerSeconds: 15,
      altitude: 300,
      speed: 60,
      behavior: "direct_approach",
    }]);

    expect(drones).toHaveLength(2);
    expect(drones.map((drone) => drone.id)).toEqual(["wave-1-group-1-1", "wave-1-group-1-2"]);
    expect(drones.map((drone) => drone.spawn_delay)).toEqual([90, 105]);
  });

  it("uses each threat group's bearing for spawn position and heading", () => {
    const [east, west] = buildScenarioDrones([
      makeWave({
        threatGroups: [
          {
            id: "east",
            droneType: "commercial_quad",
            count: 1,
            bearingDeg: 0,
            spawnOffsetSeconds: 0,
            staggerSeconds: 0,
            altitude: 150,
            speed: 35,
            behavior: "direct_approach",
          },
          {
            id: "west",
            droneType: "micro",
            count: 1,
            bearingDeg: 180,
            spawnOffsetSeconds: 10,
            staggerSeconds: 0,
            altitude: 80,
            speed: 25,
            behavior: "direct_approach",
          },
        ],
      }),
    ]);

    expect(east.start_x as number).toBeGreaterThan(0);
    expect(west.start_x as number).toBeLessThan(0);
    expect(east.heading).toBe(180);
    expect(west.heading).toBe(0);
  });

  it("adds waypoints for waypoint_path groups", () => {
    const drones = buildScenarioDrones([
      makeWave({
        threatGroups: [
          {
            id: "g1",
            droneType: "fixed_wing",
            count: 1,
            bearingDeg: 0,
            spawnOffsetSeconds: 0,
            staggerSeconds: 0,
            altitude: 300,
            speed: 60,
            behavior: "waypoint_path",
          },
        ],
      }),
    ]);

    expect(drones[0].waypoints).toBeDefined();
    expect((drones[0].waypoints as unknown[])).toHaveLength(2);
  });

  it("sets rf_emitting and effectors from drone templates", () => {
    const drones = buildScenarioDrones([
      makeWave({
        threatGroups: [
          {
            id: "g1",
            droneType: "shahed",
            count: 1,
            bearingDeg: 270,
            spawnOffsetSeconds: 0,
            staggerSeconds: 0,
            altitude: 350,
            speed: 110,
            behavior: "direct_approach",
          },
        ],
      }),
    ]);

    expect(drones[0].rf_emitting).toBe(false);
    expect(drones[0].optimal_effectors).toEqual(["kinetic"]);
    expect(drones[0].acceptable_effectors).toEqual(["kinetic", "de_laser"]);
  });
});

describe("wave and threat group ID uniqueness", () => {
  it("generates unique wave IDs", () => {
    resetWaveIdCounter(0);
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(nextWaveId());
    expect(ids.size).toBe(100);
  });

  it("generates unique threat group IDs", () => {
    resetWaveIdCounter(0);
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(nextThreatGroupId());
    expect(ids.size).toBe(100);
  });

  it("createNewWave uses normalized wave and group IDs", () => {
    resetWaveIdCounter(0);
    const waves = normalizeWaves([createNewWave(), createNewWave()]);

    expect(waves[0].id).not.toBe(waves[1].id);
    expect(waves[0].threatGroups[0].id).not.toBe(waves[1].threatGroups[0].id);
  });

  it("createNewWave creates an editable multi-threat wave container", () => {
    resetWaveIdCounter(0);
    const [wave] = normalizeWaves([createNewWave()]);

    expect(wave.startSeconds).toBe(30);
    expect(wave.threatGroups).toHaveLength(1);
    expect(wave.threatGroups[0]).toMatchObject({
      droneType: "commercial_quad",
      count: 1,
      bearingDeg: 90,
      spawnOffsetSeconds: 0,
    });
  });
});
