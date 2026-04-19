import { describe, expect, it } from "vitest";
import { getTrackEffectState } from "../utils/trackEffects";

describe("track effect state", () => {
  it("treats PNT-only degradation as an active effect", () => {
    expect(
      getTrackEffectState({
        neutralized: false,
        shenobi_cm_active: null,
        jammed: false,
        pnt_jammed: true,
      }),
    ).toBe("pnt");
  });

  it("prioritizes RF jam over PNT when both are active", () => {
    expect(
      getTrackEffectState({
        neutralized: false,
        shenobi_cm_active: null,
        jammed: true,
        pnt_jammed: true,
      }),
    ).toBe("jammed");
  });

  it("hides active-effect state once the track is neutralized", () => {
    expect(
      getTrackEffectState({
        neutralized: true,
        shenobi_cm_active: "shenobi_hold",
        jammed: true,
        pnt_jammed: true,
      }),
    ).toBe("none");
  });
});
