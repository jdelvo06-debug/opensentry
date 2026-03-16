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


class ThreatClassification(str, Enum):
    COMMERCIAL_QUAD = "commercial_quad"
    FIXED_WING = "fixed_wing"
    MICRO = "micro"
    BIRD = "bird"
    WEATHER_BALLOON = "weather_balloon"
    IMPROVISED = "improvised"
    PASSENGER_AIRCRAFT = "passenger_aircraft"


class SensorType(str, Enum):
    RADAR = "radar"
    RF = "rf"
    EOIR = "eoir"
    ACOUSTIC = "acoustic"


class EffectorType(str, Enum):
    RF_JAM = "rf_jam"
    KINETIC = "kinetic"
    NET_INTERCEPTOR = "net_interceptor"
    DIRECTED_ENERGY = "directed_energy"


class EffectorStatus(str, Enum):
    READY = "ready"
    RECHARGING = "recharging"
    OFFLINE = "offline"


class Countermeasure(str, Enum):
    CONFIRM_TRACK = "confirm_track"
    IDENTIFY = "identify"
    ENGAGE = "engage"
    RF_JAM = "rf_jam"
    KINETIC = "kinetic"
    NET_INTERCEPTOR = "net_interceptor"
    DIRECTED_ENERGY = "directed_energy"
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


class EquipmentCatalog(BaseModel):
    sensors: list[CatalogSensor]
    effectors: list[CatalogEffector]


class PlacedEquipment(BaseModel):
    catalog_id: str
    x: float
    y: float
    facing_deg: float = 0.0


class PlacementConfig(BaseModel):
    base_id: str
    sensors: list[PlacedEquipment]
    effectors: list[PlacedEquipment]
