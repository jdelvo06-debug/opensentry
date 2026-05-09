import type { TrackData } from "../types";

const ATC_EXEMPT_FALSE_ALARM_TYPES = new Set(["bird", "weather_balloon"]);

export function requiresAtcDeconfliction(track: TrackData | undefined): boolean {
  if (!track || track.iff_status !== "unknown" || track.atc_response_received) return false;
  if (track.drone_type && ATC_EXEMPT_FALSE_ALARM_TYPES.has(track.drone_type)) return false;
  return true;
}
