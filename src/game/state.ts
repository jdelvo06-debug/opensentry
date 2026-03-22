/**
 * SKYSHIELD game state types — ported from models.py + game_state.py
 */

// --- Enums (string unions for JSON compatibility) ---

export type DTIDPhase = 'detected' | 'tracked' | 'identified' | 'defeated';
export type Affiliation = 'unknown' | 'hostile' | 'friendly' | 'neutral';

export type DroneType =
  | 'commercial_quad' | 'fixed_wing' | 'micro' | 'swarm'
  | 'bird' | 'passenger_aircraft' | 'military_jet'
  | 'weather_balloon' | 'jackal' | 'shahed' | 'improvised';

export type ThreatClassification =
  | 'commercial_quad' | 'fixed_wing' | 'micro' | 'bird'
  | 'weather_balloon' | 'improvised' | 'passenger_aircraft'
  | 'jackal' | 'shahed' | 'military_jet';

export type SensorType = 'radar' | 'rf' | 'eoir' | 'acoustic';
export type EffectorType = 'rf_jam' | 'electronic' | 'kinetic' | 'net_interceptor' | 'directed_energy' | 'shinobi_pm';
export type EffectorStatus = 'ready' | 'recharging' | 'offline' | 'depleted';
export type ShinobiCMType = 'shinobi_hold' | 'shinobi_land_now' | 'shinobi_deafen';
export type ShinobiCMState = 'pending' | '1/2' | '2/2';
export type GamePhase = 'waiting' | 'running' | 'debrief';

// --- Core game state interfaces ---

export interface DroneState {
  id: string;
  drone_type: DroneType;
  x: number;
  y: number;
  altitude: number;
  speed: number;
  heading: number;
  detected: boolean;
  classified: boolean;
  classification: ThreatClassification | null;
  neutralized: boolean;
  dtid_phase: DTIDPhase;
  affiliation: Affiliation;
  confidence: number;
  trail: number[][];
  sensors_detecting: string[];
  rf_emitting: boolean;
  coasting: boolean;
  coast_start_time: number;
  last_known_heading: number;
  last_known_speed: number;
  hold_fire: boolean;
  wave_number: number;
  is_ambient: boolean;
  jammed: boolean;
  jammed_behavior: string | null;
  jammed_time_remaining: number;
  pnt_jammed: boolean;
  pnt_drift_magnitude: number;
  pnt_jammed_time_remaining: number;
  is_interceptor: boolean;
  interceptor_target: string | null;
  intercept_phase: string | null;
  spinup_remaining: number;
  intercept_attempts: number;
  frequency_band: string | null;
  uplink_detected: boolean;
  downlink_detected: boolean;
  shinobi_cm_active: string | null;
  shinobi_cm_state: string | null;
  shinobi_cm_time_remaining: number;
  shinobi_cm_initial_duration: number;
  display_label: string;
}

export function createDefaultDrone(overrides: Partial<DroneState> & Pick<DroneState, 'id' | 'drone_type' | 'x' | 'y' | 'altitude' | 'speed' | 'heading'>): DroneState {
  return {
    detected: false,
    classified: false,
    classification: null,
    neutralized: false,
    dtid_phase: 'detected',
    affiliation: 'unknown',
    confidence: 0,
    trail: [],
    sensors_detecting: [],
    rf_emitting: true,
    coasting: false,
    coast_start_time: 0,
    last_known_heading: 0,
    last_known_speed: 0,
    hold_fire: false,
    wave_number: 1,
    is_ambient: false,
    jammed: false,
    jammed_behavior: null,
    jammed_time_remaining: 0,
    pnt_jammed: false,
    pnt_drift_magnitude: 0,
    pnt_jammed_time_remaining: 0,
    is_interceptor: false,
    interceptor_target: null,
    intercept_phase: null,
    spinup_remaining: 0,
    intercept_attempts: 0,
    frequency_band: null,
    uplink_detected: false,
    downlink_detected: false,
    shinobi_cm_active: null,
    shinobi_cm_state: null,
    shinobi_cm_time_remaining: 0,
    shinobi_cm_initial_duration: 0,
    display_label: '',
    ...overrides,
  };
}

/** Clone a DroneState with partial updates (replaces Pydantic model_copy) */
export function updateDrone(drone: DroneState, updates: Partial<DroneState>): DroneState {
  return { ...drone, ...updates };
}

export interface SensorConfig {
  id: string;
  name: string;
  type: SensorType;
  range_km: number;
  status: string;
  x: number;
  y: number;
  fov_deg: number;
  facing_deg: number;
  requires_los: boolean;
}

export interface EffectorConfig {
  id: string;
  name: string;
  type: EffectorType;
  range_km: number;
  status: string;
  recharge_seconds: number;
  x: number;
  y: number;
  fov_deg: number;
  facing_deg: number;
  requires_los: boolean;
  single_use: boolean;
  ammo_count: number | null;
  ammo_remaining: number | null;
}

export interface EngagementZones {
  detection_range_km: number;
  identification_range_km: number;
  engagement_range_km: number;
}

export interface SpawnVariance {
  x_range: [number, number];
  y_range: [number, number];
  heading_variance: number;
  speed_variance: number;
}

export interface DroneStartConfig {
  id: string;
  drone_type: DroneType;
  start_x: number;
  start_y: number;
  altitude: number;
  speed: number;
  heading: number;
  behavior: string;
  rf_emitting: boolean;
  spawn_delay: number;
  orbit_center?: number[] | null;
  orbit_radius?: number | null;
  waypoints?: number[][] | null;
  correct_classification?: string | null;
  correct_affiliation?: string | null;
  optimal_effectors?: string[] | null;
  acceptable_effectors?: string[] | null;
  roe_violations?: string[] | null;
  should_engage: boolean;
  spawn_variance?: SpawnVariance | null;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  difficulty: string;
  duration_seconds: number;
  drones: DroneStartConfig[];
  base_radius_km: number;
  engagement_zones: EngagementZones;
  sensors: SensorConfig[];
  effectors: EffectorConfig[];
  correct_classification: ThreatClassification;
  correct_affiliation: Affiliation;
  optimal_effectors: string[];
  acceptable_effectors: string[];
  roe_violations: string[];
  tutorial: boolean;
  tutorial_prompts: Array<{ trigger: string; message: string }> | null;
  no_ambient: boolean;
}

export interface PlayerAction {
  action: string;
  target_id: string;
  classification?: string | null;
  affiliation?: string | null;
  effector?: string | null;
  timestamp: number;
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

// --- Phase 2: Base Defense Planner ---

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
  ammo_count?: number | null;
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
}

// --- Effector runtime state (mutable dict in Python) ---

export interface EffectorRuntimeState {
  id: string;
  name: string;
  type: string;
  range_km: number;
  status: string;
  recharge_seconds: number;
  recharge_remaining: number;
  x: number;
  y: number;
  fov_deg: number;
  facing_deg: number;
  requires_los: boolean;
  single_use: boolean;
  ammo_count: number | null;
  ammo_remaining: number | null;
  jammer_active?: boolean;
}

export interface SensorRuntimeState {
  id: string;
  status: string;
  detecting: string[];
}

// --- GameState (ported from game_state.py) ---

export interface GameState {
  scenario: ScenarioConfig;
  sensor_configs: SensorConfig[];
  effector_configs: EffectorConfig[];
  placement_config: PlacementConfig | null;
  base_template: BaseTemplate | null;

  drones: DroneState[];
  behaviors: Map<string, string>;
  drone_configs: Map<string, DroneStartConfig>;
  pending_spawns: DroneStartConfig[];

  effector_states: EffectorRuntimeState[];
  sensor_runtime: SensorRuntimeState[];
  terrain: TerrainFeature[];

  phase: GamePhase;
  start_time: number;
  tick_rate: number;
  max_duration: number;

  current_wave: number;
  wave_drone_counter: number;
  wave_all_neutralized_time: number | null;
  wave_pause_seconds: number;

  ambient_counter: number;
  track_counter: number;
  next_ambient_times: Map<string, number>;

  actions: PlayerAction[];
  drone_reached_base: boolean;

  detection_times: Map<string, number>;
  confirm_times: Map<string, number>;
  identify_times: Map<string, number>;
  engage_times: Map<string, number>;
  classification_given: Map<string, string>;
  affiliation_given: Map<string, string>;
  effector_used: Map<string, string>;
  confidence_at_identify: Map<string, number>;

  previously_detected: Map<string, Set<string>>;

  coast_sensor_loss_time: Map<string, number>;
  coast_delay: number;
  coast_drop_time: number;

  hold_fire_tracks: Set<string>;

  protected_area_center: [number, number];
  protected_area_radius: number;
  warning_area_radius: number;

  jam_resist_notified: Set<string>;

  ambient_suppressed_until: number;

  tutorial_prompts_sent: Set<string>;
  tutorial_step: number;
  tutorial_camera_slewed: boolean;

  paused: boolean;
  pause_start_time: number;
  total_paused_seconds: number;
}

export function createGameState(
  scenario: ScenarioConfig,
  sensor_configs: SensorConfig[],
  effector_configs: EffectorConfig[],
  placement_config: PlacementConfig | null,
  base_template: BaseTemplate | null,
  terrain: TerrainFeature[],
): GameState {
  return {
    scenario,
    sensor_configs,
    effector_configs,
    placement_config,
    base_template,
    drones: [],
    behaviors: new Map(),
    drone_configs: new Map(),
    pending_spawns: [],
    effector_states: [],
    sensor_runtime: [],
    terrain,
    phase: 'running',
    start_time: Date.now() / 1000,
    tick_rate: 0.1,
    max_duration: scenario.duration_seconds ?? 1800,
    current_wave: 1,
    wave_drone_counter: 0,
    wave_all_neutralized_time: null,
    wave_pause_seconds: 30 + Math.random() * 30,
    ambient_counter: 0,
    track_counter: 0,
    next_ambient_times: new Map(),
    actions: [],
    drone_reached_base: false,
    detection_times: new Map(),
    confirm_times: new Map(),
    identify_times: new Map(),
    engage_times: new Map(),
    classification_given: new Map(),
    affiliation_given: new Map(),
    effector_used: new Map(),
    confidence_at_identify: new Map(),
    previously_detected: new Map(),
    coast_sensor_loss_time: new Map(),
    coast_delay: 2.0,
    coast_drop_time: 24.0,
    hold_fire_tracks: new Set(),
    protected_area_center: [0, 0],
    protected_area_radius: 0.3,
    warning_area_radius: 0.45,
    jam_resist_notified: new Set(),
    ambient_suppressed_until: 0,
    tutorial_prompts_sent: new Set(),
    tutorial_step: 0,
    tutorial_camera_slewed: false,
    paused: false,
    pause_start_time: 0,
    total_paused_seconds: 0,
  };
}
