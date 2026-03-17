export type GamePhase = "waiting" | "scenario_select" | "equip" | "plan" | "running" | "debrief";
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
  coasting?: boolean;
  hold_fire?: boolean;
  eta_protected?: number | null;
}

export interface SensorStatus {
  id: string;
  name?: string;
  type?: string;
  range_km?: number;
  status: string;
  detecting: string[];
  x?: number;
  y?: number;
  fov_deg?: number;
  facing_deg?: number;
}

export interface EffectorStatus {
  id: string;
  name?: string;
  type?: string;
  range_km?: number;
  status: string;
  recharge_seconds?: number;
  x?: number;
  y?: number;
  fov_deg?: number;
  facing_deg?: number;
  ammo_count?: number;
  ammo_remaining?: number;
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
  placement_score: number | null;
  placement_details: Record<string, string> | null;
}

// Server messages
export interface TutorialPrompt {
  trigger: string;
  message: string;
}

export interface TutorialMsg {
  type: "tutorial";
  message: string;
}

export interface ProtectedAreaInfo {
  center_x: number;
  center_y: number;
  radius_km: number;
  warning_radius_km: number;
}

export interface GameStartMsg {
  type: "game_start";
  scenario: { name: string; description: string; difficulty: string };
  sensors: SensorStatus[];
  effectors: EffectorStatus[];
  engagement_zones: EngagementZones;
  tutorial?: boolean;
  tutorial_prompts?: TutorialPrompt[];
  protected_area?: ProtectedAreaInfo;
  base?: {
    id: string;
    name: string;
    boundary: number[][];
    protected_assets: ProtectedAsset[];
    terrain: TerrainFeature[];
  };
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
  | DebriefMsg
  | TutorialMsg;

// Phase 2: Base Defense Planner types

export interface ProtectedAsset {
  id: string;
  name: string;
  x: number;
  y: number;
  priority: number;
}

export interface TerrainFeature {
  id: string;
  type: string;
  name: string;
  polygon: number[][];
  blocks_los: boolean;
  height_m: number;
}

export interface ApproachCorridor {
  name: string;
  bearing_deg: number;
  width_deg: number;
}

export interface BaseTemplate {
  id: string;
  name: string;
  description: string;
  size: string;
  center_lat?: number;
  center_lng?: number;
  default_zoom?: number;
  boundary: number[][];
  protected_assets: ProtectedAsset[];
  terrain: TerrainFeature[];
  approach_corridors: ApproachCorridor[];
  max_sensors: number;
  max_effectors: number;
  placement_bounds_km: number;
}

export interface CatalogSensor {
  catalog_id: string;
  name: string;
  type: string;
  range_km: number;
  fov_deg: number;
  description: string;
  pros: string[];
  cons: string[];
  requires_los: boolean;
}

export interface CatalogEffector {
  catalog_id: string;
  name: string;
  type: string;
  range_km: number;
  fov_deg: number;
  recharge_seconds: number;
  single_use: boolean;
  description: string;
  pros: string[];
  cons: string[];
  requires_los: boolean;
  collateral_risk: string;
  ammo_count?: number;
}

export interface EquipmentCatalog {
  sensors: CatalogSensor[];
  effectors: CatalogEffector[];
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  difficulty: string;
}

export interface BaseInfo {
  id: string;
  name: string;
  description: string;
  size: string;
  max_sensors: number;
  max_effectors: number;
}

export interface PlacedEquipment {
  catalog_id: string;
  x: number;
  y: number;
  facing_deg: number;
}

export interface PlacementConfig {
  base_id: string;
  sensors: PlacedEquipment[];
  effectors: PlacedEquipment[];
}
