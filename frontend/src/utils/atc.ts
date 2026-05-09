import type { TrackData } from "../types";

const ATC_DECONFLICTION_TYPES = new Set(["passenger_aircraft", "military_jet"]);

function isAtcDeconflictionType(track: TrackData): boolean {
  const classification = track.classification?.toLowerCase() ?? "";
  const droneType = track.drone_type?.toLowerCase() ?? "";
  return ATC_DECONFLICTION_TYPES.has(classification) || ATC_DECONFLICTION_TYPES.has(droneType);
}

export function trackHasAtcRequirement(track: TrackData | undefined): boolean {
  if (!track || track.neutralized || track.is_interceptor) return false;
  if (typeof track.atc_required === "boolean") return track.atc_required;
  return isAtcDeconflictionType(track);
}

export function shouldOfferAtc(track: TrackData | undefined): boolean {
  if (!track || track.atc_called || track.atc_response_received) return false;
  return trackHasAtcRequirement(track);
}

export function requiresAtcDeconfliction(track: TrackData | undefined): boolean {
  if (!trackHasAtcRequirement(track)) return false;
  return track?.iff_status === "unknown" && !track.atc_response_received;
}
