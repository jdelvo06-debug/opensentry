import type { DEBeamAnimationData } from "../components/TacticalMap";
import type { EffectorStatus, TrackData } from "../types";

export interface ParsedDeFiringEvent {
  effectorName: string;
  targetLabel: string;
}

export function parseDeFiringEvent(message: string): ParsedDeFiringEvent | null {
  const match = message.match(/^ENGAGEMENT:\s+(.+?)\s+FIRING\s+—\s+(.+?)\s+\(/);
  if (!match) return null;
  return {
    effectorName: match[1],
    targetLabel: match[2],
  };
}

export function buildDeBeamFromFiringEvent(
  message: string,
  effectors: EffectorStatus[],
  tracks: TrackData[],
  startTime: number,
): DEBeamAnimationData | null {
  const parsed = parseDeFiringEvent(message);
  if (!parsed) return null;

  const effector = effectors.find((eff) => eff.name === parsed.effectorName);
  const target = tracks.find((track) => (track.display_label || track.id).toUpperCase() === parsed.targetLabel.toUpperCase());
  if (!effector || effector.x == null || effector.y == null || !target) return null;

  const beamType: "laser" | "hpm" = effector.type === "de_hpm" ? "hpm" : "laser";
  const duration = beamType === "hpm" ? 3200 : 2600;

  return {
    id: `de-beam-${startTime}-${effector.id}-${target.id}`,
    effectorId: effector.id,
    targetId: target.id,
    startX: effector.x,
    startY: effector.y,
    targetX: target.x,
    targetY: target.y,
    effective: false,
    resolved: false,
    beamType,
    startTime,
    duration,
  };
}
