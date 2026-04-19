import type { TrackData } from "../types";

export type TrackEffectState = "none" | "shenobi" | "jammed" | "pnt";

export function getTrackEffectState(
  track: Pick<TrackData, "neutralized" | "shenobi_cm_active" | "jammed" | "pnt_jammed">,
): TrackEffectState {
  if (track.neutralized) return "none";
  if (track.shenobi_cm_active) return "shenobi";
  if (track.jammed) return "jammed";
  if (track.pnt_jammed) return "pnt";
  return "none";
}
