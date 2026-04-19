import { describe, expect, it } from "vitest";
import { buildDeBeamFromFiringEvent, parseDeFiringEvent } from "../utils/deEngagement";

describe("DE engagement visuals", () => {
  it("parses DE firing events from the operator log", () => {
    expect(parseDeFiringEvent("ENGAGEMENT: DE-LASER-3km FIRING — TRN-001 (1.0s dwell)")).toEqual({
      effectorName: "DE-LASER-3km",
      targetLabel: "TRN-001",
    });
  });

  it("builds a beam animation from a firing event before impact resolves", () => {
    const beam = buildDeBeamFromFiringEvent(
      "ENGAGEMENT: DE-HPM-3km FIRING — TRN-002 (1.0s dwell)",
      [{
        id: "de_hpm",
        name: "DE-HPM-3km",
        type: "de_hpm",
        status: "slewing",
        x: 0,
        y: 0,
      }],
      [{
        id: "bogey-2",
        display_label: "TRN-002",
        dtid_phase: "identified",
        affiliation: "hostile",
        x: 1.2,
        y: 0.4,
        altitude_ft: 150,
        speed_kts: 40,
        heading_deg: 90,
        confidence: 0.9,
        classification: "commercial_quad",
        drone_type: "commercial_quad",
        trail: [[1.2, 0.4]],
        sensors_detecting: ["radar_1"],
        neutralized: false,
      }],
      12345,
    );

    expect(beam).toMatchObject({
      effectorId: "de_hpm",
      targetId: "bogey-2",
      beamType: "hpm",
      startX: 0,
      startY: 0,
      targetX: 1.2,
      targetY: 0.4,
      startTime: 12345,
      duration: 3200,
      effective: false,
      resolved: false,
    });
  });
});
