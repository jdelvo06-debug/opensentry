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


class ThreatClassification(str, Enum):
    COMMERCIAL_QUAD = "commercial_quad"
    FIXED_WING = "fixed_wing"
    MICRO = "micro"
    BIRD = "bird"
    WEATHER_BALLOON = "weather_balloon"
    IMPROVISED = "improvised"


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


class SensorConfig(BaseModel):
    id: str
    name: str
    type: SensorType
    range_km: float
    status: str = "active"


class EffectorConfig(BaseModel):
    id: str
    name: str
    type: EffectorType
    range_km: float
    status: str = "ready"
    recharge_seconds: int = 0


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
    behavior: str  # "direct_approach", "orbit", "coordinated"
    rf_emitting: bool = True


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
