"""GameState — a plain dataclass that bundles all mutable per-session state
so the game loop doesn't need dozens of loose variables."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

from app.models import (
    BaseTemplate,
    DroneStartConfig,
    DroneState,
    EffectorConfig,
    GamePhase,
    PlacementConfig,
    PlayerAction,
    ScenarioConfig,
    SensorConfig,
)


@dataclass
class GameState:
    """All mutable state for a single game session."""

    scenario: ScenarioConfig
    sensor_configs: list[SensorConfig]
    effector_configs: list[EffectorConfig]

    # Optional placement / base
    placement_config: PlacementConfig | None = None
    base_template: BaseTemplate | None = None

    # Runtime drone state
    drones: list[DroneState] = field(default_factory=list)
    behaviors: dict[str, str] = field(default_factory=dict)
    drone_configs: dict[str, DroneStartConfig] = field(default_factory=dict)
    pending_spawns: list[DroneStartConfig] = field(default_factory=list)

    # Effector runtime (mutable dicts)
    effector_states: list[dict] = field(default_factory=list)

    # Sensor runtime
    sensor_runtime: list[dict] = field(default_factory=list)

    # Terrain (for LOS checks)
    terrain: list = field(default_factory=list)

    # Phase & timing
    phase: GamePhase = GamePhase.RUNNING
    start_time: float = field(default_factory=time.time)
    tick_rate: float = 0.1
    max_duration: float = 1800.0  # 30 minutes

    # Wave system
    current_wave: int = 1
    wave_drone_counter: int = 0
    wave_all_neutralized_time: float | None = None
    wave_pause_seconds: float = field(default_factory=lambda: random.uniform(30.0, 60.0))

    # Ambient traffic
    ambient_counter: int = 0
    next_ambient_times: dict[str, float] = field(default_factory=dict)

    # Player action log
    actions: list[PlayerAction] = field(default_factory=list)
    drone_reached_base: bool = False

    # DTID timestamps per drone
    detection_times: dict[str, float] = field(default_factory=dict)
    confirm_times: dict[str, float] = field(default_factory=dict)
    identify_times: dict[str, float] = field(default_factory=dict)
    engage_times: dict[str, float] = field(default_factory=dict)
    classification_given: dict[str, str] = field(default_factory=dict)
    affiliation_given: dict[str, str] = field(default_factory=dict)
    effector_used: dict[str, str] = field(default_factory=dict)
    confidence_at_identify: dict[str, float] = field(default_factory=dict)

    # Sensor tracking
    previously_detected: dict[str, set[str]] = field(default_factory=dict)

    # Track coasting
    coast_sensor_loss_time: dict[str, float] = field(default_factory=dict)
    coast_delay: float = 2.0
    coast_drop_time: float = 24.0

    # Hold fire
    hold_fire_tracks: set[str] = field(default_factory=set)

    # Protected area
    protected_area_center: tuple[float, float] = (0.0, 0.0)
    protected_area_radius: float = 0.3
    warning_area_radius: float = 0.45

    # Passive jamming — track which drones have already had resist notification
    jam_resist_notified: set[str] = field(default_factory=set)

    # Ambient suppression (CLEAR AIRSPACE)
    ambient_suppressed_until: float = 0.0

    # Tutorial
    tutorial_prompts_sent: set[str] = field(default_factory=set)
    tutorial_step: int = 0  # 0=waiting for detect, 1=DETECT, 2=TRACK, 3=SLEW, 4=IDENTIFY, 5=DEFEAT, 6=DEBRIEF
    tutorial_camera_slewed: bool = False  # True once player slews camera in tutorial

    # Pause
    paused: bool = False
    pause_start_time: float = 0.0  # wall-clock time when pause began
    total_paused_seconds: float = 0.0  # accumulated paused time
