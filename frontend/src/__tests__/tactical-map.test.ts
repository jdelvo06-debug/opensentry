import { describe, expect, it } from "vitest";
import { resolveNearbySelectionIntent, type SelectableItem } from "../components/SelectionList";
import { getActiveCameraSensor, getSensorDisplayLabel } from "../components/tactical-map-sensors";
import type { SensorStatus } from "../types";

function makeSensor(overrides: Partial<SensorStatus> = {}): SensorStatus {
  return {
    id: "sensor-1",
    name: "EO/IR Camera",
    type: "eoir",
    status: "active",
    detecting: [],
    x: 0,
    y: 0,
    ...overrides,
  };
}

const trackItem: SelectableItem = {
  id: "track-1",
  type: "track",
  label: "TRACK-1",
  status: "DETECTED",
  color: "#d29922",
  icon: "■",
};

const sensorItem: SelectableItem = {
  id: "sensor-1",
  type: "sensor",
  label: "RADAR-1",
  status: "ACTIVE",
  color: "#58a6ff",
  icon: "◎",
};

describe("TacticalMap nearby selection intent", () => {
  it("selects a single nearby track on left-click instead of treating it as empty map", () => {
    expect(resolveNearbySelectionIntent([trackItem], false)).toEqual({
      type: "select-track",
      trackId: "track-1",
    });
  });

  it("opens the action wheel for a single nearby track on right-click", () => {
    expect(resolveNearbySelectionIntent([trackItem], true)).toEqual({
      type: "open-track-wheel",
      trackId: "track-1",
    });
  });

  it("keeps the disambiguation list for overlapping nearby objects", () => {
    expect(resolveNearbySelectionIntent([trackItem, sensorItem], false)).toEqual({
      type: "show-list",
      items: [trackItem, sensorItem],
    });
  });
});
describe("TacticalMap helpers", () => {
  it("uses the selected camera id for the active camera cone", () => {
    const sensors = [
      makeSensor({ id: "camera-1", x: -0.3, y: 0.15 }),
      makeSensor({ id: "camera-2", x: 0.4, y: -0.2 }),
    ];

    expect(getActiveCameraSensor(sensors, "camera-2")?.id).toBe("camera-2");
  });

  it("falls back to the first EO/IR sensor when no selected camera id is set", () => {
    const sensors = [
      makeSensor({ id: "camera-1" }),
      makeSensor({ id: "camera-2" }),
    ];

    expect(getActiveCameraSensor(sensors, null)?.id).toBe("camera-1");
  });

  it("numbers duplicate sensor labels for map markers", () => {
    const sensors = [
      makeSensor({ id: "camera-1", name: "EO/IR Camera" }),
      makeSensor({ id: "camera-2", name: "EO/IR Camera" }),
    ];

    expect(getSensorDisplayLabel(sensors[0], sensors)).toBe("EO/IR Camera #1");
    expect(getSensorDisplayLabel(sensors[1], sensors)).toBe("EO/IR Camera #2");
  });
});
