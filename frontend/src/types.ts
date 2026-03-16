export type GamePhase = "waiting" | "running" | "debrief";
export type DTIDPhase = "detected" | "tracked" | "identified" | "defeated";
export type Affiliation = "unknown" | "hostile" | "friendly" | "neutral";
export type ThreatLevel = "green" | "yellow" | "orange" | "red";

export interface TrackData {
  id: string;
  dtid_phase: DTIDPhase;
  affiliation: Affiliation;
  x: number;
  y: number;
  altitude_ft: number;
  speed_kts: number;
  heading_deg: number;
  confidence: number;
  classification: string | null;
  trail: [number, number][];
  sensors_detecting: string[];
  neutralized: boolean;
}

export interface SensorStatus {
  id: string;
  name?: string;
  type?: string;
  range_km?: number;
  status: string;
  detecting: string[];
}

export interface EffectorStatus {
  id: string;
  name?: string;
  type?: string;
  range_km?: number;
  status: string;
  recharge_seconds?: number;
}

export interface EngagementZones {
  detection_range_km: number;
  identification_range_km: number;
  engagement_range_km: number;
}

export interface EventEntry {
  timestamp: number;
  message: string;
}

export interface ScoreBreakdown {
  detection_response_score: number;
  tracking_score: number;
  identification_score: number;
  defeat_score: number;
  roe_score: number;
  total_score: number;
  grade: string;
  details: Record<string, string>;
}

// Server messages
export interface GameStartMsg {
  type: "game_start";
  scenario: { name: string; description: string; difficulty: string };
  sensors: SensorStatus[];
  effectors: EffectorStatus[];
  engagement_zones: EngagementZones;
}

export interface StateMsg {
  type: "state";
  elapsed: number;
  time_remaining: number;
  threat_level: ThreatLevel;
  tracks: TrackData[];
  sensors: SensorStatus[];
  effectors: EffectorStatus[];
}

export interface EventMsg {
  type: "event";
  timestamp: number;
  message: string;
}

export interface EngagementResultMsg {
  type: "engagement_result";
  target_id: string;
  effector: string;
  effective: boolean;
  effectiveness: number;
}

export interface DebriefMsg {
  type: "debrief";
  score: ScoreBreakdown;
  drone_reached_base: boolean;
}

export type ServerMessage =
  | GameStartMsg
  | StateMsg
  | EventMsg
  | EngagementResultMsg
  | DebriefMsg;
