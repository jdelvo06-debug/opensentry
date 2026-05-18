import { describe, expect, it } from "vitest";
import {
  analyzeBdaCoverage,
  bearingInFov,
  type BdaCoverageSummary,
} from "../utils/bdaCoverageAnalysis";
import type { ApproachCorridor } from "../types";
import type { PlacedSystem, SystemDef } from "../components/bda/types";

const corridors: ApproachCorridor[] = [
  { name: "North Approach", bearing_deg: 0, width_deg: 30 },
  { name: "East Approach", bearing_deg: 90, width_deg: 30 },
];

function def(overrides: Partial<SystemDef>): SystemDef {
  return {
    id: "sys",
    name: "System",
    category: "sensor",
    type: "radar",
    range_km: 10,
    fov_deg: 360,
    color: "#fff",
    letter: "S",
    description: "Test system",
    requires_los: false,
    ...overrides,
  };
}

function placed(overrides: Partial<PlacedSystem>): PlacedSystem {
  return {
    uid: "p1",
    def: def({}),
    lat: 0,
    lng: 0,
    altitude: 10,
    facing_deg: 0,
    viewshed: null,
    blockedSectors: null,
    viewshedLoading: false,
    viewshedArea: null,
    viewshedStats: null,
    visible: true,
    ...overrides,
  };
}

function expectHeadline(summary: BdaCoverageSummary, text: string) {
  expect(summary.headline).toContain(text);
}

describe("bearingInFov", () => {
  it("handles wraparound around north", () => {
    expect(bearingInFov(350, 30, 5)).toBe(true);
    expect(bearingInFov(350, 20, 25)).toBe(false);
  });

  it("treats boundary bearings as covered", () => {
    expect(bearingInFov(90, 30, 105)).toBe(true);
    expect(bearingInFov(90, 30, 106)).toBe(false);
  });
});

describe("analyzeBdaCoverage", () => {
  it("reports high risk when corridors have no systems", () => {
    const summary = analyzeBdaCoverage(corridors, []);

    expect(summary.readiness).toBe("HIGH RISK");
    expect(summary.sensorGapCount).toBe(2);
    expect(summary.effectorGapCount).toBe(2);
    expect(summary.corridors[0].status).toBe("GAP");
    expect(summary.recommendations[0]).toContain("add both detection and defeat coverage");
  });

  it("requires both sensor and effector layers for full corridor coverage", () => {
    const summary = analyzeBdaCoverage(corridors, [
      placed({ uid: "sensor-1", def: def({ category: "sensor", name: "L-Band Radar" }) }),
    ]);

    expect(summary.readiness).toBe("HIGH RISK");
    expect(summary.sensorGapCount).toBe(0);
    expect(summary.effectorGapCount).toBe(2);
    expect(summary.corridors[0].recommendation).toContain("defeat option");
  });

  it("marks single sensor and single effector coverage as partial", () => {
    const summary = analyzeBdaCoverage(corridors, [
      placed({ uid: "sensor-1", def: def({ category: "sensor", name: "L-Band Radar" }) }),
      placed({ uid: "effector-1", def: def({ category: "effector", name: "RF Jammer" }) }),
    ]);

    expect(summary.readiness).toBe("CAUTION");
    expect(summary.partialCount).toBe(2);
    expect(summary.corridors[0].status).toBe("PARTIAL");
    expect(summary.corridors[0].recommendation).toContain("single-threaded");
  });

  it("marks overlapping sensor and effector layers as covered", () => {
    const summary = analyzeBdaCoverage(corridors, [
      placed({ uid: "sensor-1", def: def({ category: "sensor", name: "L-Band Radar" }) }),
      placed({ uid: "sensor-2", def: def({ category: "sensor", name: "Ku-Band FCS" }) }),
      placed({ uid: "effector-1", def: def({ category: "effector", name: "RF Jammer" }) }),
      placed({ uid: "effector-2", def: def({ category: "effector", name: "APKWS Launcher" }) }),
    ]);

    expect(summary.readiness).toBe("GOOD");
    expect(summary.coveredCount).toBe(2);
    expect(summary.recommendations).toHaveLength(0);
    expectHeadline(summary, "layered detect-and-defeat coverage");
  });

  it("honors narrow FOV facing when checking corridor coverage", () => {
    const summary = analyzeBdaCoverage(corridors, [
      placed({ uid: "sensor-1", facing_deg: 0, def: def({ category: "sensor", name: "EO/IR", fov_deg: 20 }) }),
      placed({ uid: "effector-1", facing_deg: 0, def: def({ category: "effector", name: "Laser", fov_deg: 20 }) }),
    ]);

    expect(summary.corridors[0].sensor.count).toBe(1);
    expect(summary.corridors[0].effector.count).toBe(1);
    expect(summary.corridors[1].sensor.count).toBe(0);
    expect(summary.corridors[1].effector.count).toBe(0);
  });

  it("counts combined systems as both sensor and effector coverage", () => {
    const summary = analyzeBdaCoverage(corridors, [
      placed({ uid: "combined-1", def: def({ category: "combined", name: "Shenobi" }) }),
    ]);

    expect(summary.corridors[0].sensor.count).toBe(1);
    expect(summary.corridors[0].effector.count).toBe(1);
    expect(summary.corridors[0].status).toBe("PARTIAL");
  });
});
