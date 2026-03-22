export type GamePhase = "waiting" | "scenario_select" | "equip" | "plan" | "running" | "debrief";
export type DTIDPhase = "detected" | "tracked" | "identified" | "defeated";
export type Affiliation = "unknown" | "hostile" | "friendly" | "neutral";
export type ThreatLevel = "green" | "yellow" | "orange" | "red";

export interface TrackData {
  id: string;
  display_label: string;
  dtid_phase: DTIDPhase;
  affiliation: Affiliation;
  x: number;
  y: number;
  altitude_ft: number;
  speed_kts: number;
  heading_deg: number;
  confidence: number;
  classification: string | null;
  drone_type: string | null;
  spinup_remaining?: number;
  trail: [number, number][];
  sensors_detecting: string[];
  neutralized: boolean;
  coasting?: boolean;
  hold_fire?: boolean;
  eta_protected?: number | null;
  wave_number?: number;
  is_ambient?: boolean;
  jammed?: boolean;
  jammed_behavior?: string | null;
  pnt_jammed?: boolean;
  is_interceptor?: boolean;
  interceptor_target?: string | null;
  intercept_phase?: string | null;
  // SHINOBI RF track properties
  frequency_band?: string | null;
  uplink_detected?: boolean;
  downlink_detected?: boolean;
  shinobi_cm_active?: string | null;
  shinobi_cm_state?: string | null;  // "pending", "1/2", "2/2"
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
  jammer_active?: boolean;
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
  completion_multiplier: number;
  time_bonus_detail: string;
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

export interface TutorialFeedbackMsg {
  type: "tutorial_feedback";
  message: string;
  severity: "warning" | "error";
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
  wave_number?: number;
  tracks: TrackData[];
  sensors: SensorStatus[];
  effectors: EffectorStatus[];
  ambient_suppressed_until?: number;
  paused?: boolean;
  tutorial_step?: number;
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
  jammed?: boolean;
  jammed_behavior?: string;
  pnt_jammed?: boolean;
  shinobi_cm?: string;
  shinobi_cm_state?: string;
}

export interface DebriefMsg {
  type: "debrief";
  score: ScoreBreakdown;
  drone_reached_base: boolean;
  waves_completed?: number;
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | GameStartMsg
  | StateMsg
  | EventMsg
  | EngagementResultMsg
  | DebriefMsg
  | TutorialMsg
  | TutorialFeedbackMsg
  | ErrorMsg;

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

export interface CatalogCombined {
  catalog_id: string;
  name: string;
  description: string;
  sensor_type: string;
  sensor_range_km: number;
  effector_type: string;
  effector_range_km: number;
  fov_deg: number;
  recharge_seconds: number;
  single_use: boolean;
  requires_los: boolean;
  collateral_risk: string;
  pros: string[];
  cons: string[];
}

export interface EquipmentCatalog {
  sensors: CatalogSensor[];
  effectors: CatalogEffector[];
  combined: CatalogCombined[];
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
  combined: PlacedEquipment[];
  boundary?: number[][];
  placement_bounds_km?: number;
}
