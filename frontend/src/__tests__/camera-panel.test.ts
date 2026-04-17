import { describe, expect, it } from "vitest";
import {
  calcBearing,
  calcElevation,
  calcRangeFromCamera,
  findBestCameraForTrack,
} from "../components/CameraPanel";
import type { SensorStatus, TrackData } from "../types";

function makeTrack(overrides: Partial<TrackData> = {}): TrackData {
  return {
    id: "track-1",
    display_label: "Track 1",
    dtid_phase: "tracked",
    affiliation: "hostile",
    x: 5,
    y: 5,
    altitude_ft: 1000,
    speed_kts: 80,
    heading_deg: 90,
    confidence: 1,
    classification: "quadcopter",
    drone_type: "commercial_quad",
    trail: [],
    sensors_detecting: [],
    neutralized: false,
    ...overrides,
  };
}

function makeSensor(overrides: Partial<SensorStatus> = {}): SensorStatus {
  return {
    id: "sensor-1",
    name: "EO/IR 1",
    type: "eoir",
    status: "active",
    detecting: [],
    x: 0,
    y: 0,
    ...overrides,
  };
}

describe("CameraPanel helpers", () => {
  it("selects the closest EO/IR camera for a track", () => {
    const track = makeTrack({ x: 10, y: 0 });
    const sensors = [
      makeSensor({ id: "camera-far", x: 0, y: 0 }),
      makeSensor({ id: "camera-near", x: 9, y: 0 }),
      makeSensor({ id: "radar-1", type: "radar", x: 10, y: 0 }),
    ];

    const bestCamera = findBestCameraForTrack(track, sensors);

    expect(bestCamera?.id).toBe("camera-near");
  });

  it("returns null when no EO/IR camera is available", () => {
    const bestCamera = findBestCameraForTrack(makeTrack(), [
      makeSensor({ id: "radar-1", type: "radar" }),
    ]);

    expect(bestCamera).toBeNull();
  });

  it("calculates bearing and range relative to the selected camera position", () => {
    expect(calcRangeFromCamera(10, 0, 9, 0)).toBeCloseTo(1);
    expect(calcBearing(10, 0, 9, 0)).toBeCloseTo(90);
    expect(calcBearing(0, 0, 0, 10)).toBeCloseTo(0);
  });

  it("calculates elevation from the selected camera instead of the origin", () => {
    const fromOrigin = calcElevation(1000, 10, 0, 0, 0);
    const fromNearbyCamera = calcElevation(1000, 10, 0, 9, 0);

    expect(fromNearbyCamera).toBeGreaterThan(fromOrigin);
    expect(fromNearbyCamera).toBeCloseTo(16.951, 2);
  });
});
