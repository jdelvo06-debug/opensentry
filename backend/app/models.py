from __future__ import annotations

from enum import Enum
from pydantic import BaseModel


class DTIDPhase(str, Enum):
    DETECTED = "detected"
    TRACKED = "tracked"
    IDENTIFIED = "identified"
    DEFEATED = "defeated"


class Affiliation(str, Enum):
    UNKNOWN = "unknown"
    HOSTILE = "hostile"
    FRIENDLY = "friendly"
    NEUTRAL = "neutral"


class DroneType(str, Enum):
    COMMERCIAL_QUAD = "commercial_quad"
    FIXED_WING = "fixed_wing"
    MICRO = "micro"
    SWARM = "swarm"
    BIRD = "bird"
    PASSENGER_AIRCRAFT = "passenger_aircraft"
    MILITARY_JET = "military_jet"
    WEATHER_BALLOON = "weather_balloon"
    JACKAL = "jackal"
    SHAHED = "shahed"
    IMPROVISED = "improvised"


class ThreatClassification(str, Enum):
    COMMERCIAL_QUAD = "commercial_quad"
    FIXED_WING = "fixed_wing"
    MICRO = "micro"
    BIRD = "bird"
    WEATHER_BALLOON = "weather_balloon"
    IMPROVISED = "improvised"
    PASSENGER_AIRCRAFT = "passenger_aircraft"
    JACKAL = "jackal"
    SHAHED = "shahed"


class SensorType(str, Enum):
    RADAR = "radar"
    RF = "rf"
    EOIR = "eoir"
    ACOUSTIC = "acoustic"


class EffectorType(str, Enum):
    RF_JAM = "rf_jam"
    ELECTRONIC = "electronic"
    KINETIC = "kinetic"
    NET_INTERCEPTOR = "net_interceptor"
    DIRECTED_ENERGY = "directed_energy"
    SHINOBI_PM = "shinobi_pm"  # SHINOBI Protocol Manipulation


class EffectorStatus(str, Enum):
    READY = "ready"
    RECHARGING = "recharging"
    OFFLINE = "offline"


class ShinobiCMType(str, Enum):
    """SHINOBI Protocol Manipulation countermeasure types."""
    HOLD = "shinobi_hold"          # Freeze drone in place
    LAND_NOW = "shinobi_land_now"  # Forced descent to ground
    DEAFEN = "shinobi_deafen"      # Sever control link (failsafe behavior)


class ShinobiCMState(str, Enum):
    """SHINOBI countermeasure effect state progression."""
    PENDING = "pending"      # CM command sent, waiting for effect
    HALF = "1/2"             # Downlink acquired only
    FULL = "2/2"             # Uplink active, full control


class Countermeasure(str, Enum):
    CONFIRM_TRACK = "confirm_track"
    IDENTIFY = "identify"
    ENGAGE = "engage"
    RF_JAM = "rf_jam"
    KINETIC = "kinetic"
    NET_INTERCEPTOR = "net_interceptor"
    DIRECTED_ENERGY = "directed_energy"
    SHINOBI_HOLD = "shinobi_hold"
    SHINOBI_LAND_NOW = "shinobi_land_now"
    SHINOBI_DEAFEN = "shinobi_deafen"
    OBSERVE = "observe"
    NO_ACTION = "no_action"


class GamePhase(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    DEBRIEF = "debrief"


# --- Core game state models ---


class DroneState(BaseModel):
    id: str
    drone_type: DroneType
    x: float  # km from base
    y: float  # km from base
    altitude: float  # feet
    speed: float  # knots
    heading: float  # degrees
    detected: bool = False
    classified: bool = False
    classification: ThreatClassification | None = None
    neutralized: bool = False
    dtid_phase: DTIDPhase = DTIDPhase.DETECTED
    affiliation: Affiliation = Affiliation.UNKNOWN
    confidence: float = 0.0
    trail: list[list[float]] = []
    sensors_detecting: list[str] = []
    rf_emitting: bool = True
    # Track coasting: when sensors lose contact, extrapolate position
    coasting: bool = False
    coast_start_time: float = 0.0  # elapsed seconds when coasting began
    last_known_heading: float = 0.0  # heading at time of sensor loss
    last_known_speed: float = 0.0  # speed at time of sensor loss
    # Hold fire
    hold_fire: bool = False
    # Wave system
    wave_number: int = 1
    is_ambient: bool = False
    # EW jamming state
    jammed: bool = False
    jammed_behavior: str | None = None  # loss_of_control, rth, forced_landing, gps_spoof
    jammed_time_remaining: float = 0.0  # seconds until jam effect resolves
    # JACKAL interceptor fields
    is_interceptor: bool = False
    interceptor_target: str | None = None
    intercept_phase: str | None = None  # spinup, launch, midcourse, terminal, self_destruct
    spinup_remaining: float = 0.0  # seconds remaining in spinup phase
    intercept_attempts: int = 0  # track retry count for terminal intercept
    # SHINOBI RF track properties
    frequency_band: str | None = None  # "2.4GHz", "5.8GHz", "430MHz", "900MHz"
    uplink_detected: bool = False   # True when SHINOBI acquires uplink (enables full CM)
    downlink_detected: bool = False  # True when SHINOBI acquires downlink
    shinobi_cm_active: str | None = None  # Active SHINOBI countermeasure type
    shinobi_cm_state: str | None = None  # "pending", "1/2", "2/2"
    shinobi_cm_time_remaining: float = 0.0  # Seconds remaining in CM effect
    shinobi_cm_initial_duration: float = 0.0  # Original CM duration (for elapsed calc)


class SensorConfig(BaseModel):
    id: str
    name: str
    type: SensorType
    range_km: float
    status: str = "active"
    # Phase 2: placement position & FOV
    x: float = 0.0
    y: float = 0.0
    fov_deg: float = 360.0
    facing_deg: float = 0.0  # direction camera faces (for limited FOV)
    requires_los: bool = False


class EffectorConfig(BaseModel):
    id: str
    name: str
    type: EffectorType
    range_km: float
    status: str = "ready"
    recharge_seconds: int = 0
    # Phase 2: placement position & FOV
    x: float = 0.0
    y: float = 0.0
    fov_deg: float = 360.0
    facing_deg: float = 0.0
    requires_los: bool = False
    single_use: bool = False
    # Ammo management (e.g. JACKAL pallets with 4 interceptors)
    ammo_count: int | None = None
    ammo_remaining: int | None = None


class EngagementZones(BaseModel):
    detection_range_km: float
    identification_range_km: float
    engagement_range_km: float


class DroneStartConfig(BaseModel):
    id: str
    drone_type: DroneType
    start_x: float
    start_y: float
    altitude: float
    speed: float
    heading: float
    behavior: str  # "direct_approach", "orbit", "waypoint_path", "evasive"
    rf_emitting: bool = True
    spawn_delay: float = 0.0  # seconds after scenario start before drone appears
    # Orbit behavior params
    orbit_center: list[float] | None = None  # [x, y] center point
    orbit_radius: float | None = None  # km
    # Waypoint behavior params
    waypoints: list[list[float]] | None = None  # [[x,y], [x,y], ...]
    # Per-drone scoring overrides (for multi-track scenarios)
    correct_classification: str | None = None
    correct_affiliation: str | None = None
    optimal_effectors: list[str] | None = None
    acceptable_effectors: list[str] | None = None
    roe_violations: list[str] | None = None
    should_engage: bool = True  # False for birds/false positives


class ScenarioConfig(BaseModel):
    id: str
    name: str
    description: str
    difficulty: str
    duration_seconds: int
    drones: list[DroneStartConfig]
    base_radius_km: float = 0.1
    engagement_zones: EngagementZones
    sensors: list[SensorConfig]
    effectors: list[EffectorConfig]
    correct_classification: ThreatClassification
    correct_affiliation: Affiliation = Affiliation.HOSTILE
    optimal_effectors: list[str] = []
    acceptable_effectors: list[str] = []
    roe_violations: list[str] = []
    tutorial: bool = False
    tutorial_prompts: list[dict[str, str]] | None = None  # [{"trigger": "...", "message": "..."}]
    no_ambient: bool = False  # If True, suppress all ambient traffic (birds, aircraft, balloons)


class PlayerAction(BaseModel):
    action: str
    target_id: str
    classification: str | None = None
    affiliation: str | None = None
    effector: str | None = None
    timestamp: float = 0.0


class GameState(BaseModel):
    phase: GamePhase
    elapsed_seconds: float
    drones: list[DroneState]
    player_actions: list[PlayerAction]
    scenario_name: str
    time_remaining: float


class ScoreBreakdown(BaseModel):
    detection_response_score: float
    tracking_score: float
    identification_score: float
    defeat_score: float
    roe_score: float
    total_score: float
    grade: str
    details: dict[str, str]
    # Phase 2: optional placement scores
    placement_score: float | None = None
    placement_details: dict[str, str] | None = None


# --- Phase 2: Base Defense Planner models ---


class ProtectedAsset(BaseModel):
    id: str
    name: str
    x: float
    y: float
    priority: int


class TerrainFeature(BaseModel):
    id: str
    type: str  # building, tower, berm, treeline, runway
    name: str
    polygon: list[list[float]]
    blocks_los: bool
    height_m: float


class ApproachCorridor(BaseModel):
    name: str
    bearing_deg: float
    width_deg: float


class BaseTemplate(BaseModel):
    id: str
    name: str
    description: str
    size: str  # small, medium, large
    boundary: list[list[float]]
    protected_assets: list[ProtectedAsset]
    terrain: list[TerrainFeature]
    approach_corridors: list[ApproachCorridor]
    max_sensors: int
    max_effectors: int
    placement_bounds_km: float


class CatalogSensor(BaseModel):
    catalog_id: str
    name: str
    type: str
    range_km: float
    fov_deg: float
    description: str
    pros: list[str]
    cons: list[str]
    requires_los: bool


class CatalogEffector(BaseModel):
    catalog_id: str
    name: str
    type: str
    range_km: float
    fov_deg: float
    recharge_seconds: int
    single_use: bool
    description: str
    pros: list[str]
    cons: list[str]
    requires_los: bool
    collateral_risk: str
    ammo_count: int | None = None


class CatalogCombined(BaseModel):
    """A combined sensor+effector system (e.g. SHINOBI)."""
    catalog_id: str
    name: str
    description: str
    sensor_type: str       # e.g. "rf"
    sensor_range_km: float
    effector_type: str     # e.g. "shinobi_pm"
    effector_range_km: float
    fov_deg: float
    recharge_seconds: int = 0
    single_use: bool = False
    requires_los: bool = False
    collateral_risk: str = "none"
    pros: list[str] = []
    cons: list[str] = []


class EquipmentCatalog(BaseModel):
    sensors: list[CatalogSensor]
    effectors: list[CatalogEffector]
    combined: list[CatalogCombined] = []


class PlacedEquipment(BaseModel):
    catalog_id: str
    x: float
    y: float
    facing_deg: float = 0.0


class PlacementConfig(BaseModel):
    base_id: str
    sensors: list[PlacedEquipment]
    effectors: list[PlacedEquipment]
    combined: list[PlacedEquipment] = []
