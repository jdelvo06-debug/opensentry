"""SKYSHIELD backend -- FastAPI + WebSocket real-time C-UAS DTID simulator."""

from __future__ import annotations

import asyncio
import math
import random
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.bases import list_bases, load_base, load_equipment_catalog
from app.drone import create_drone, update_drone, distance_to_base
from app.detection import update_sensors, calculate_confidence
from app.models import (
    BaseTemplate,
    CatalogEffector,
    CatalogSensor,
    DroneStartConfig,
    DroneType,
    DTIDPhase,
    Affiliation,
    DroneState,
    EffectorConfig,
    EffectorStatus,
    EffectorType,
    GamePhase,
    PlacedEquipment,
    PlacementConfig,
    PlayerAction,
    SensorConfig,
    SensorType,
    ThreatClassification,
)
from app.scenario import list_scenarios, load_scenario
from app.scoring import calculate_score, calculate_score_multi

app = FastAPI(title="SKYSHIELD", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"name": "SKYSHIELD", "version": "0.3.0"}


@app.get("/scenarios")
async def get_scenarios():
    return list_scenarios()


@app.get("/bases")
async def get_bases():
    return list_bases()


@app.get("/bases/{base_id}")
async def get_base(base_id: str):
    base = load_base(base_id)
    return base.model_dump()


@app.get("/equipment")
async def get_equipment():
    catalog = load_equipment_catalog()
    return catalog.model_dump()


def _effector_effectiveness(effector_type: str, drone_type: str) -> float:
    """Return effectiveness score 0-1 based on effector type vs drone type."""
    matrix: dict[str, dict[str, float]] = {
        "rf_jam": {
            "commercial_quad": 0.9,
            "fixed_wing": 0.4,
            "micro": 0.7,
            "swarm": 0.6,
        },
        "electronic": {
            "commercial_quad": 0.9,
            "fixed_wing": 0.4,
            "micro": 0.7,
            "swarm": 0.6,
        },
        "kinetic": {
            "commercial_quad": 0.95,
            "fixed_wing": 0.8,
            "micro": 0.5,
            "swarm": 0.3,
        },
        "net_interceptor": {
            "commercial_quad": 0.85,
            "fixed_wing": 0.6,
            "micro": 0.9,
            "swarm": 0.4,
        },
        "directed_energy": {
            "commercial_quad": 0.9,
            "fixed_wing": 0.9,
            "micro": 0.95,
            "swarm": 0.8,
        },
    }
    return matrix.get(effector_type, {}).get(drone_type, 0.5)


def _check_kurfs_tracking(sensor_configs: list[SensorConfig], drone: "DroneState") -> bool:
    """Check if any KURFS radar has the drone in range."""
    for s in sensor_configs:
        # Match KURFS by name (it's a 360° fire-control radar)
        if "kurfs" not in s.id.lower() and "kurfs" not in s.name.lower():
            continue
        # Check range
        dist = math.sqrt((drone.x - s.x) ** 2 + (drone.y - s.y) ** 2)
        if dist <= s.range_km:
            return True
    return False


def _threat_level(drones: list[DroneState]) -> str:
    """Calculate threat level based on closest non-neutralized hostile track range."""
    min_range = float("inf")
    for drone in drones:
        if not drone.neutralized and drone.detected and not drone.is_ambient:
            dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
            min_range = min(min_range, dist)

    if min_range == float("inf"):
        return "green"
    if min_range < 1.0:
        return "red"
    if min_range < 2.0:
        return "orange"
    if min_range < 3.0:
        return "yellow"
    return "green"


def _find_effector_config(
    effectors: list[dict], effector_id: str
) -> dict | None:
    for e in effectors:
        if e["id"] == effector_id:
            return e
    return None


def _build_sensors_from_placement(
    placement: PlacementConfig,
    catalog_sensors: dict[str, CatalogSensor],
) -> list[SensorConfig]:
    """Build SensorConfig list from player's placement choices."""
    sensors = []
    for i, placed in enumerate(placement.sensors):
        cat = catalog_sensors.get(placed.catalog_id)
        if cat is None:
            continue
        sensor_type = SensorType(cat.type)
        sensors.append(SensorConfig(
            id=f"sensor_{i}_{placed.catalog_id}",
            name=cat.name,
            type=sensor_type,
            range_km=cat.range_km,
            status="active",
            x=placed.x,
            y=placed.y,
            fov_deg=cat.fov_deg,
            facing_deg=placed.facing_deg,
            requires_los=cat.requires_los,
        ))
    return sensors


def _build_effectors_from_placement(
    placement: PlacementConfig,
    catalog_effectors: dict[str, CatalogEffector],
) -> list[EffectorConfig]:
    """Build EffectorConfig list from player's placement choices."""
    effectors = []
    for i, placed in enumerate(placement.effectors):
        cat = catalog_effectors.get(placed.catalog_id)
        if cat is None:
            continue
        eff_type = EffectorType(cat.type)
        effectors.append(EffectorConfig(
            id=f"effector_{i}_{placed.catalog_id}",
            name=cat.name,
            type=eff_type,
            range_km=cat.range_km,
            status="ready",
            recharge_seconds=cat.recharge_seconds,
            x=placed.x,
            y=placed.y,
            fov_deg=cat.fov_deg,
            facing_deg=placed.facing_deg,
            requires_los=cat.requires_los,
            single_use=cat.single_use,
            ammo_count=cat.ammo_count,
            ammo_remaining=cat.ammo_count,
        ))
    return effectors


# --- Wave generation ---

_WAVE_DRONE_TEMPLATES: list[dict] = [
    {"drone_type": "commercial_quad", "altitude": 150, "speed": 35, "behavior": "direct_approach", "rf_emitting": True,
     "correct_classification": "commercial_quad", "correct_affiliation": "hostile",
     "optimal_effectors": ["electronic"], "acceptable_effectors": ["electronic", "kinetic"], "roe_violations": []},
    {"drone_type": "commercial_quad", "altitude": 120, "speed": 40, "behavior": "evasive", "rf_emitting": True,
     "correct_classification": "commercial_quad", "correct_affiliation": "hostile",
     "optimal_effectors": ["electronic"], "acceptable_effectors": ["electronic", "kinetic"], "roe_violations": []},
    {"drone_type": "fixed_wing", "altitude": 300, "speed": 60, "behavior": "direct_approach", "rf_emitting": False,
     "correct_classification": "fixed_wing", "correct_affiliation": "hostile",
     "optimal_effectors": ["kinetic"], "acceptable_effectors": ["kinetic", "electronic"], "roe_violations": []},
    {"drone_type": "micro", "altitude": 80, "speed": 25, "behavior": "evasive", "rf_emitting": True,
     "correct_classification": "micro", "correct_affiliation": "hostile",
     "optimal_effectors": ["electronic", "kinetic"], "acceptable_effectors": ["electronic", "kinetic"], "roe_violations": []},
]


def _generate_wave_drones(wave_number: int, wave_drone_counter: int) -> tuple[list[DroneStartConfig], int]:
    """Generate drones for a wave. Returns (configs, updated_counter)."""
    if wave_number == 1:
        return [], wave_drone_counter  # Wave 1 uses scenario drones

    if wave_number == 2:
        count = random.randint(2, 3)
    else:
        count = random.randint(4, 5)

    configs = []
    for i in range(count):
        wave_drone_counter += 1
        template = random.choice(_WAVE_DRONE_TEMPLATES)
        # Random spawn position on map edge (3-5 km from base)
        angle = random.uniform(0, 2 * math.pi)
        dist = random.uniform(3.5, 5.0)
        start_x = dist * math.cos(angle)
        start_y = dist * math.sin(angle)
        heading = math.degrees(math.atan2(-start_y, -start_x)) % 360

        cfg = DroneStartConfig(
            id=f"wave{wave_number}-{wave_drone_counter}",
            drone_type=DroneType(template["drone_type"]),
            start_x=round(start_x, 2),
            start_y=round(start_y, 2),
            altitude=template["altitude"] + random.randint(-30, 30),
            speed=template["speed"] + random.randint(-5, 5),
            heading=heading,
            behavior=template["behavior"],
            rf_emitting=template["rf_emitting"],
            spawn_delay=i * random.uniform(2.0, 5.0),  # Stagger spawns
            correct_classification=template["correct_classification"],
            correct_affiliation=template["correct_affiliation"],
            optimal_effectors=template["optimal_effectors"],
            acceptable_effectors=template["acceptable_effectors"],
            roe_violations=template["roe_violations"],
            should_engage=True,
        )
        configs.append(cfg)

    return configs, wave_drone_counter


# --- Ambient air traffic ---

_COMMERCIAL_CALLSIGNS = [
    "QR-412", "EK-771", "BA-209", "LH-442", "AF-381", "SQ-026",
    "UA-857", "DL-134", "AA-291", "JL-006", "CX-888", "TK-517",
]
_MILITARY_CALLSIGNS = [
    "VIPER-01", "RAPTOR-22", "EAGLE-11", "FALCON-03", "HAWK-07",
    "COBRA-14", "THUNDER-05", "SHADOW-09", "STORM-16", "GHOST-21",
]


def _generate_ambient_object(
    ambient_counter: int,
    obj_type: str,
    elapsed: float,
) -> tuple[DroneStartConfig, int]:
    """Generate a single ambient air traffic object."""
    ambient_counter += 1
    amb_id = f"AMB-{ambient_counter:03d}"

    if obj_type == "commercial_aircraft":
        callsign = random.choice(_COMMERCIAL_CALLSIGNS)
        amb_id = callsign
        # High altitude, fast, straight line across map
        angle = random.uniform(0, 2 * math.pi)
        start_x = 8.0 * math.cos(angle)
        start_y = 8.0 * math.sin(angle)
        # Fly across to the other side
        exit_angle = angle + math.pi + random.uniform(-0.3, 0.3)
        exit_x = 8.0 * math.cos(exit_angle)
        exit_y = 8.0 * math.sin(exit_angle)
        heading = math.degrees(math.atan2(exit_y - start_y, exit_x - start_x)) % 360

        cfg = DroneStartConfig(
            id=amb_id,
            drone_type=DroneType.PASSENGER_AIRCRAFT,
            start_x=round(start_x, 2),
            start_y=round(start_y, 2),
            altitude=random.randint(15000, 35000),
            speed=random.randint(400, 500),
            heading=heading,
            behavior="waypoint_path",
            rf_emitting=True,
            spawn_delay=0.0,
            waypoints=[[round(exit_x, 2), round(exit_y, 2)]],
            correct_classification="passenger_aircraft",
            correct_affiliation="friendly",
            optimal_effectors=[],
            acceptable_effectors=[],
            roe_violations=["electronic", "kinetic", "rf_jam", "directed_energy", "net_interceptor"],
            should_engage=False,
        )
    elif obj_type == "military_jet":
        callsign = random.choice(_MILITARY_CALLSIGNS)
        amb_id = callsign
        angle = random.uniform(0, 2 * math.pi)
        orbit_dist = random.uniform(3.0, 6.0)
        start_x = 7.0 * math.cos(angle)
        start_y = 7.0 * math.sin(angle)
        heading = math.degrees(math.atan2(-start_y, -start_x)) % 360

        cfg = DroneStartConfig(
            id=amb_id,
            drone_type=DroneType.MILITARY_JET,
            start_x=round(start_x, 2),
            start_y=round(start_y, 2),
            altitude=random.randint(5000, 15000),
            speed=random.randint(500, 600),
            heading=heading,
            behavior="orbit",
            rf_emitting=True,
            spawn_delay=0.0,
            orbit_center=[round(orbit_dist * math.cos(angle + 0.5), 2),
                          round(orbit_dist * math.sin(angle + 0.5), 2)],
            orbit_radius=random.uniform(2.0, 4.0),
            correct_classification="fixed_wing",
            correct_affiliation="friendly",
            optimal_effectors=[],
            acceptable_effectors=[],
            roe_violations=["electronic", "kinetic", "rf_jam", "directed_energy", "net_interceptor"],
            should_engage=False,
        )
    elif obj_type == "bird":
        amb_id = f"AMB-{ambient_counter:03d}"
        angle = random.uniform(0, 2 * math.pi)
        start_dist = random.uniform(2.0, 5.0)
        start_x = start_dist * math.cos(angle)
        start_y = start_dist * math.sin(angle)
        heading = random.uniform(0, 360)

        cfg = DroneStartConfig(
            id=amb_id,
            drone_type=DroneType.BIRD,
            start_x=round(start_x, 2),
            start_y=round(start_y, 2),
            altitude=random.randint(50, 500),
            speed=random.randint(20, 40),
            heading=heading,
            behavior="evasive",
            rf_emitting=False,
            spawn_delay=0.0,
            correct_classification="bird",
            correct_affiliation="neutral",
            optimal_effectors=[],
            acceptable_effectors=[],
            roe_violations=["electronic", "kinetic", "rf_jam", "directed_energy", "net_interceptor"],
            should_engage=False,
        )
    elif obj_type == "weather_balloon":
        amb_id = f"AMB-{ambient_counter:03d}"
        angle = random.uniform(0, 2 * math.pi)
        start_dist = random.uniform(1.5, 4.0)
        start_x = start_dist * math.cos(angle)
        start_y = start_dist * math.sin(angle)

        cfg = DroneStartConfig(
            id=amb_id,
            drone_type=DroneType.WEATHER_BALLOON,
            start_x=round(start_x, 2),
            start_y=round(start_y, 2),
            altitude=random.randint(500, 2000),
            speed=random.randint(0, 5),
            heading=random.uniform(0, 360),
            behavior="waypoint_path",
            rf_emitting=False,
            spawn_delay=0.0,
            waypoints=[[round(start_x + random.uniform(-0.5, 0.5), 2),
                        round(start_y + random.uniform(-0.5, 0.5), 2)]],
            correct_classification="weather_balloon",
            correct_affiliation="neutral",
            optimal_effectors=[],
            acceptable_effectors=[],
            roe_violations=["electronic", "kinetic", "rf_jam", "directed_energy", "net_interceptor"],
            should_engage=False,
        )
    else:
        raise ValueError(f"Unknown ambient type: {obj_type}")

    return cfg, ambient_counter


# --- EW Jamming behavior ---

def _pick_jam_behavior(drone_type: DroneType) -> str | None:
    """Pick a jammed behavior for the drone. Returns None if jam fails (autonomous nav)."""
    # Fixed-wing UAS with autonomous nav may resist (30% chance jam fails)
    if drone_type == DroneType.FIXED_WING:
        if random.random() < 0.3:
            return None  # Jam fails

    return random.choice(["loss_of_control", "rth", "forced_landing", "gps_spoof"])


def _check_effector_in_range(eff_state: dict, drone: DroneState) -> bool:
    """Check if drone is within effector range and FOV."""
    ex = eff_state.get("x", 0.0)
    ey = eff_state.get("y", 0.0)
    dist = math.sqrt((drone.x - ex) ** 2 + (drone.y - ey) ** 2)
    if dist > eff_state.get("range_km", 999):
        return False
    fov = eff_state.get("fov_deg", 360)
    if fov < 360:
        dx = drone.x - ex
        dy = drone.y - ey
        bearing = math.degrees(math.atan2(dx, dy)) % 360
        facing = eff_state.get("facing_deg", 0)
        diff = abs(((bearing - facing) + 180) % 360 - 180)
        if diff > fov / 2:
            return False
    return True


@app.websocket("/ws/game")
async def game_websocket(ws: WebSocket):
    await ws.accept()

    try:
        # Wait for scenario selection — now includes optional base_id and placement
        init_msg = await ws.receive_json()
        scenario_id = init_msg.get("scenario_id", "lone_wolf")
        scenario = load_scenario(scenario_id)

        # Phase 2: Check for placement config
        placement_config: PlacementConfig | None = None
        base_template: BaseTemplate | None = None
        base_id = init_msg.get("base_id")

        if base_id and "placement" in init_msg:
            base_template = load_base(base_id)
            placement_data = init_msg["placement"]
            placement_config = PlacementConfig(
                base_id=base_id,
                sensors=[PlacedEquipment(**s) for s in placement_data.get("sensors", [])],
                effectors=[PlacedEquipment(**e) for e in placement_data.get("effectors", [])],
            )

            # Build sensors/effectors from placement
            catalog = load_equipment_catalog()
            cat_sensors = {s.catalog_id: s for s in catalog.sensors}
            cat_effectors = {e.catalog_id: e for e in catalog.effectors}

            sensor_configs: list[SensorConfig] = _build_sensors_from_placement(
                placement_config, cat_sensors
            )
            effector_configs_list: list[EffectorConfig] = _build_effectors_from_placement(
                placement_config, cat_effectors
            )
        else:
            # Legacy mode: use scenario-defined sensors/effectors at base (0,0)
            sensor_configs = list(scenario.sensors)
            effector_configs_list = list(scenario.effectors)

        # Initialize drones (respecting spawn_delay)
        drones: list[DroneState] = []
        behaviors: dict[str, str] = {}
        drone_configs: dict[str, DroneStartConfig] = {}
        pending_spawns: list[DroneStartConfig] = []
        for drone_cfg in scenario.drones:
            drone_configs[drone_cfg.id] = drone_cfg
            if drone_cfg.spawn_delay <= 0:
                drones.append(create_drone(drone_cfg))
                behaviors[drone_cfg.id] = drone_cfg.behavior
            else:
                pending_spawns.append(drone_cfg)

        # Initialize effector state (mutable runtime state)
        effector_states: list[dict] = []
        for eff in effector_configs_list:
            effector_states.append({
                "id": eff.id,
                "name": eff.name,
                "type": eff.type.value,
                "range_km": eff.range_km,
                "status": eff.status,
                "recharge_seconds": eff.recharge_seconds,
                "recharge_remaining": 0.0,
                "x": eff.x,
                "y": eff.y,
                "fov_deg": eff.fov_deg,
                "facing_deg": eff.facing_deg,
                "requires_los": eff.requires_los,
                "single_use": eff.single_use,
                "ammo_count": eff.ammo_count,
                "ammo_remaining": eff.ammo_remaining,
            })

        # Sensor runtime state (for detecting lists)
        sensor_runtime: list[dict] = []
        for s in sensor_configs:
            sensor_runtime.append({
                "id": s.id,
                "status": s.status,
                "detecting": [],
            })

        # Get terrain for LOS checks
        terrain = base_template.terrain if base_template else []

        phase = GamePhase.RUNNING
        actions: list[PlayerAction] = []
        start_time = time.time()
        drone_reached_base = False
        tick_rate = 0.1  # 10Hz
        MAX_DURATION = 1800  # 30 minutes max

        # Wave system
        current_wave = 1
        wave_drone_counter = 0
        wave_all_neutralized_time: float | None = None  # when all threats in wave were neutralized
        WAVE_PAUSE_SECONDS = random.uniform(30.0, 60.0)

        # Ambient traffic system
        ambient_counter = 0
        next_ambient_times: dict[str, float] = {
            "commercial_aircraft": elapsed if (elapsed := 0) == 0 else random.uniform(60.0, 90.0),
            "military_jet": random.uniform(120.0, 180.0),
            "bird": random.uniform(45.0, 60.0),
            "weather_balloon": random.uniform(180.0, 300.0),
        }
        # Reset — elapsed is computed in loop
        next_ambient_times = {
            "commercial_aircraft": random.uniform(60.0, 90.0),
            "military_jet": random.uniform(120.0, 180.0),
            "bird": random.uniform(45.0, 60.0),
            "weather_balloon": random.uniform(180.0, 300.0),
        }

        # DTID tracking timestamps per drone
        detection_times: dict[str, float] = {}
        confirm_times: dict[str, float] = {}
        identify_times: dict[str, float] = {}
        engage_times: dict[str, float] = {}
        classification_given: dict[str, str] = {}
        affiliation_given: dict[str, str] = {}
        effector_used: dict[str, str] = {}
        confidence_at_identify: dict[str, float] = {}

        # Previously detected set (for event tracking)
        previously_detected: dict[str, set[str]] = {}

        # Track coasting state: {drone_id: elapsed_time_when_sensors_lost}
        coast_sensor_loss_time: dict[str, float] = {}
        COAST_DELAY = 2.0  # seconds without sensor contact before coasting starts
        COAST_DROP_TIME = 24.0  # seconds of coasting before track is dropped

        # Hold fire state
        hold_fire_tracks: set[str] = set()

        # Send game_start
        game_start_msg: dict = {
            "type": "game_start",
            "scenario": {
                "name": scenario.name,
                "description": scenario.description,
                "difficulty": scenario.difficulty,
            },
            "sensors": [
                {
                    "id": s.id,
                    "name": s.name,
                    "type": s.type.value,
                    "range_km": s.range_km,
                    "status": s.status,
                    "x": s.x,
                    "y": s.y,
                    "fov_deg": s.fov_deg,
                    "facing_deg": s.facing_deg,
                }
                for s in sensor_configs
            ],
            "effectors": [
                {
                    "id": e.id,
                    "name": e.name,
                    "type": e.type.value,
                    "range_km": e.range_km,
                    "status": e.status,
                    "recharge_seconds": e.recharge_seconds,
                    "x": e.x,
                    "y": e.y,
                    "fov_deg": e.fov_deg,
                    "facing_deg": e.facing_deg,
                    **({"ammo_count": e.ammo_count} if e.ammo_count is not None else {}),
                    **({"ammo_remaining": e.ammo_remaining} if e.ammo_remaining is not None else {}),
                }
                for e in effector_configs_list
            ],
            "engagement_zones": scenario.engagement_zones.model_dump(),
            "tutorial": scenario.tutorial,
            "tutorial_prompts": scenario.tutorial_prompts or [],
        }

        # Compute protected area from base template assets
        protected_area_center: tuple[float, float] = (0.0, 0.0)
        protected_area_radius: float = 0.3  # default 300m
        if base_template and base_template.protected_assets:
            assets = base_template.protected_assets
            cx = sum(a.x for a in assets) / len(assets)
            cy = sum(a.y for a in assets) / len(assets)
            protected_area_center = (cx, cy)
            max_dist = max(
                math.sqrt((a.x - cx) ** 2 + (a.y - cy) ** 2) for a in assets
            )
            protected_area_radius = max_dist + 0.15  # 150m buffer around outermost asset
            protected_area_radius = max(protected_area_radius, 0.2)  # minimum 200m

        warning_area_radius = protected_area_radius * 1.5

        # Include base template info if present
        if base_template:
            game_start_msg["base"] = {
                "id": base_template.id,
                "name": base_template.name,
                "boundary": base_template.boundary,
                "protected_assets": [a.model_dump() for a in base_template.protected_assets],
                "terrain": [t.model_dump() for t in base_template.terrain],
            }

        # Always include protected/warning area info
        game_start_msg["protected_area"] = {
            "center_x": protected_area_center[0],
            "center_y": protected_area_center[1],
            "radius_km": round(protected_area_radius, 3),
            "warning_radius_km": round(warning_area_radius, 3),
        }

        await ws.send_json(game_start_msg)

        # Tutorial prompt tracking
        tutorial_prompts_sent: set[str] = set()
        if scenario.tutorial and scenario.tutorial_prompts:
            # Send the "start" prompt immediately
            for tp in scenario.tutorial_prompts:
                if tp["trigger"] == "start":
                    await ws.send_json({
                        "type": "tutorial",
                        "message": tp["message"],
                    })
                    tutorial_prompts_sent.add("start")

        while phase == GamePhase.RUNNING:
            elapsed = time.time() - start_time
            time_remaining = max(0, MAX_DURATION - elapsed)

            events: list[dict] = []

            # Spawn delayed drones
            newly_spawned = []
            for cfg in pending_spawns:
                if elapsed >= cfg.spawn_delay:
                    new_drone = create_drone(cfg)
                    # Tag with wave number
                    new_drone = new_drone.model_copy(update={"wave_number": current_wave})
                    drones.append(new_drone)
                    behaviors[cfg.id] = cfg.behavior
                    newly_spawned.append(cfg)
                    events.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": f"RADAR: New contact emerging — {cfg.id.upper()}",
                    })
            for cfg in newly_spawned:
                pending_spawns.remove(cfg)

            # --- Ambient traffic spawning ---
            for amb_type, next_time in list(next_ambient_times.items()):
                if elapsed >= next_time:
                    amb_cfg, ambient_counter = _generate_ambient_object(
                        ambient_counter, amb_type, elapsed
                    )
                    # Avoid ID collisions
                    while amb_cfg.id in drone_configs:
                        ambient_counter += 1
                        amb_cfg, ambient_counter = _generate_ambient_object(
                            ambient_counter, amb_type, elapsed
                        )
                    drone_configs[amb_cfg.id] = amb_cfg
                    amb_drone = create_drone(amb_cfg)
                    amb_drone = amb_drone.model_copy(update={
                        "is_ambient": True,
                        "wave_number": 0,
                    })
                    # Pre-identify friendlies (commercial aircraft, military jets)
                    if amb_type in ("commercial_aircraft", "military_jet"):
                        amb_drone = amb_drone.model_copy(update={
                            "affiliation": Affiliation.FRIENDLY,
                            "classified": True,
                            "dtid_phase": DTIDPhase.IDENTIFIED,
                            "classification": ThreatClassification.PASSENGER_AIRCRAFT if amb_type == "commercial_aircraft" else ThreatClassification.FIXED_WING,
                        })
                    drones.append(amb_drone)
                    behaviors[amb_cfg.id] = amb_cfg.behavior

                    # Schedule next spawn
                    if amb_type == "commercial_aircraft":
                        next_ambient_times[amb_type] = elapsed + random.uniform(60.0, 90.0)
                    elif amb_type == "military_jet":
                        next_ambient_times[amb_type] = elapsed + random.uniform(120.0, 180.0)
                    elif amb_type == "bird":
                        next_ambient_times[amb_type] = elapsed + random.uniform(45.0, 60.0)
                    elif amb_type == "weather_balloon":
                        next_ambient_times[amb_type] = elapsed + random.uniform(180.0, 300.0)

            # --- Wave system: check if all threat drones neutralized ---
            threat_drones = [d for d in drones if not d.is_ambient]
            if (not pending_spawns and threat_drones
                    and all(d.neutralized for d in threat_drones)):
                if wave_all_neutralized_time is None:
                    wave_all_neutralized_time = elapsed
                    events.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": "ALL THREATS NEUTRALIZED — MAINTAINING WATCH",
                    })
                elif elapsed - wave_all_neutralized_time >= WAVE_PAUSE_SECONDS:
                    # Spawn next wave
                    current_wave += 1
                    wave_all_neutralized_time = None
                    WAVE_PAUSE_SECONDS = random.uniform(30.0, 60.0)
                    new_wave_cfgs, wave_drone_counter = _generate_wave_drones(
                        current_wave, wave_drone_counter
                    )
                    for wcfg in new_wave_cfgs:
                        drone_configs[wcfg.id] = wcfg
                        # Adjust spawn_delay relative to current elapsed
                        adjusted_cfg = wcfg.model_copy(update={
                            "spawn_delay": elapsed + wcfg.spawn_delay,
                        })
                        pending_spawns.append(adjusted_cfg)
                    events.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": f"WARNING: WAVE {current_wave} — NEW CONTACTS INBOUND",
                    })
            else:
                wave_all_neutralized_time = None

            # Update effector recharge timers
            for eff_state in effector_states:
                if eff_state["status"] == "recharging":
                    eff_state["recharge_remaining"] -= tick_rate
                    if eff_state["recharge_remaining"] <= 0:
                        eff_state["status"] = "ready"
                        eff_state["recharge_remaining"] = 0.0
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"{eff_state['name']}: Ready",
                        })

            # Update drones and run sensors
            for i, drone in enumerate(drones):
                if not drone.neutralized:
                    # --- EW Jamming behavior update ---
                    if drone.jammed:
                        drones[i] = drones[i].model_copy(update={
                            "jammed_time_remaining": drone.jammed_time_remaining - tick_rate,
                        })
                        jb = drone.jammed_behavior
                        if jb == "loss_of_control":
                            # Drift in last heading, slowly descend
                            speed_kms = drone.speed * 0.000514 * 0.5  # Half speed drift
                            heading_rad = math.radians(drone.heading)
                            new_x = drone.x + math.sin(heading_rad) * speed_kms * tick_rate
                            new_y = drone.y + math.cos(heading_rad) * speed_kms * tick_rate
                            new_alt = max(0, drone.altitude - 15 * tick_rate)  # Descend ~15 ft/s
                            trail = list(drone.trail)
                            trail.append([round(new_x, 3), round(new_y, 3)])
                            if len(trail) > 20:
                                trail = trail[-20:]
                            drones[i] = drones[i].model_copy(update={
                                "x": new_x, "y": new_y, "altitude": new_alt,
                                "speed": drone.speed * 0.95,  # Slow down
                                "trail": trail,
                            })
                            if new_alt <= 0 or drones[i].jammed_time_remaining <= 0:
                                drones[i] = drones[i].model_copy(update={
                                    "neutralized": True, "jammed_time_remaining": 0,
                                    "altitude": 0,
                                })
                                events.append({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"TRACK: {drone.id.upper()} — CRASHED (loss of control)",
                                })
                        elif jb == "rth":
                            # Turn around and fly away
                            away_angle = math.atan2(drone.y, drone.x)
                            speed_kms = drone.speed * 0.000514
                            new_x = drone.x + math.cos(away_angle) * speed_kms * tick_rate
                            new_y = drone.y + math.sin(away_angle) * speed_kms * tick_rate
                            heading_deg = math.degrees(away_angle) % 360
                            trail = list(drone.trail)
                            trail.append([round(new_x, 3), round(new_y, 3)])
                            if len(trail) > 20:
                                trail = trail[-20:]
                            drones[i] = drones[i].model_copy(update={
                                "x": new_x, "y": new_y, "heading": heading_deg,
                                "trail": trail,
                            })
                            # Leaves map = defeated
                            if math.sqrt(new_x**2 + new_y**2) > 10.0:
                                drones[i] = drones[i].model_copy(update={
                                    "neutralized": True, "jammed_time_remaining": 0,
                                })
                                events.append({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"TRACK: {drone.id.upper()} — RTH (left area)",
                                })
                        elif jb == "forced_landing":
                            # Descend straight down
                            new_alt = max(0, drone.altitude - 50 * tick_rate)  # ~50 ft/s
                            drones[i] = drones[i].model_copy(update={
                                "altitude": new_alt, "speed": max(0, drone.speed - 5 * tick_rate),
                            })
                            if new_alt <= 0:
                                drones[i] = drones[i].model_copy(update={
                                    "neutralized": True, "jammed_time_remaining": 0,
                                    "altitude": 0, "speed": 0,
                                })
                                events.append({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"TRACK: {drone.id.upper()} — FORCED LANDING (grounded)",
                                })
                        elif jb == "gps_spoof":
                            # Veer off course dramatically
                            spoof_heading = (drone.heading + random.uniform(90, 180) * random.choice([-1, 1])) % 360
                            heading_rad = math.radians(spoof_heading)
                            speed_kms = drone.speed * 0.000514
                            new_x = drone.x + math.sin(heading_rad) * speed_kms * tick_rate
                            new_y = drone.y + math.cos(heading_rad) * speed_kms * tick_rate
                            trail = list(drone.trail)
                            trail.append([round(new_x, 3), round(new_y, 3)])
                            if len(trail) > 20:
                                trail = trail[-20:]
                            drones[i] = drones[i].model_copy(update={
                                "x": new_x, "y": new_y, "heading": spoof_heading,
                                "trail": trail,
                            })
                            if math.sqrt(new_x**2 + new_y**2) > 10.0:
                                drones[i] = drones[i].model_copy(update={
                                    "neutralized": True, "jammed_time_remaining": 0,
                                })
                                events.append({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"TRACK: {drone.id.upper()} — GPS SPOOFED (left area)",
                                })
                        continue  # Skip normal movement for jammed drones

                    cfg = drone_configs[drone.id]
                    drones[i] = update_drone(
                        drone,
                        tick_rate,
                        behaviors[drone.id],
                        waypoints=cfg.waypoints,
                        orbit_radius=cfg.orbit_radius or 1.5,
                        orbit_center=cfg.orbit_center,
                        detected_by_player=drone.detected,
                    )

                    # Check if drone reached base (only for non-ambient threats)
                    if not drones[i].is_ambient and distance_to_base(drones[i]) < scenario.base_radius_km:
                        drone_reached_base = True

                    # Remove ambient objects that leave the map
                    if drones[i].is_ambient:
                        dist = math.sqrt(drones[i].x**2 + drones[i].y**2)
                        if dist > 12.0:
                            drones[i] = drones[i].model_copy(update={"neutralized": True})

                # Run sensors for this drone
                if not drones[i].neutralized:
                    detecting_ids, _ = update_sensors(
                        drones[i], sensor_configs, terrain=terrain
                    )
                    dist = distance_to_base(drones[i])
                    confidence = calculate_confidence(detecting_ids, dist)

                    # Track first detection time
                    if detecting_ids and drones[i].id not in detection_times:
                        detection_times[drones[i].id] = elapsed

                    # Generate events for new sensor acquisitions
                    prev = previously_detected.get(drones[i].id, set())
                    new_sensors = set(detecting_ids) - prev

                    if not prev and detecting_ids:
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"RADAR: New contact detected \u2014 {drones[i].id.upper()}",
                        })
                    else:
                        for sid in new_sensors:
                            sensor_name = sid.upper().replace("_", " ")
                            events.append({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"{sensor_name}: Acquiring {drones[i].id.upper()}",
                            })

                    # Track sensor loss
                    lost_sensors = prev - set(detecting_ids)
                    for sid in lost_sensors:
                        sensor_name = sid.upper().replace("_", " ")
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"{sensor_name}: Lost contact \u2014 {drones[i].id.upper()}",
                        })

                    previously_detected[drones[i].id] = set(detecting_ids)

                    # --- Track coasting logic ---
                    drone_id = drones[i].id
                    was_detected = drones[i].detected
                    now_detecting = len(detecting_ids) > 0

                    if now_detecting:
                        # Sensors have contact — clear any coasting state
                        coast_sensor_loss_time.pop(drone_id, None)
                        if drones[i].coasting:
                            events.append({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"TRACK: {drone_id.upper()} — Sensor contact reacquired",
                            })
                        drones[i] = drones[i].model_copy(update={
                            "detected": True,
                            "sensors_detecting": detecting_ids,
                            "confidence": confidence,
                            "coasting": False,
                            "coast_start_time": 0.0,
                        })
                    elif was_detected or drones[i].coasting:
                        # Was previously detected but now no sensors — start/continue coasting
                        if drone_id not in coast_sensor_loss_time:
                            coast_sensor_loss_time[drone_id] = elapsed
                            # Store last known heading/speed for extrapolation
                            drones[i] = drones[i].model_copy(update={
                                "last_known_heading": drones[i].heading,
                                "last_known_speed": drones[i].speed,
                            })

                        time_without_sensors = elapsed - coast_sensor_loss_time[drone_id]

                        if time_without_sensors >= COAST_DROP_TIME:
                            # Drop the track entirely after 24s
                            drones[i] = drones[i].model_copy(update={
                                "detected": False,
                                "coasting": False,
                                "sensors_detecting": [],
                                "confidence": 0.0,
                            })
                            coast_sensor_loss_time.pop(drone_id, None)
                            events.append({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"TRACK: {drone_id.upper()} — Track dropped (coast timeout)",
                            })
                        elif time_without_sensors >= COAST_DELAY:
                            # Coasting: extrapolate position
                            if not drones[i].coasting:
                                events.append({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"TRACK: {drone_id.upper()} — Coasting (extrapolating)",
                                })

                            # Extrapolate position based on last known heading and speed
                            heading_rad = math.radians(drones[i].last_known_heading)
                            speed_kms = drones[i].last_known_speed * 0.000514  # knots to km/s
                            ext_dx = math.sin(heading_rad) * speed_kms * tick_rate
                            ext_dy = math.cos(heading_rad) * speed_kms * tick_rate
                            new_x = drones[i].x + ext_dx
                            new_y = drones[i].y + ext_dy

                            # Update trail for extrapolated position
                            new_trail = list(drones[i].trail)
                            new_trail.append([round(new_x, 3), round(new_y, 3)])
                            if len(new_trail) > 20:
                                new_trail = new_trail[-20:]

                            drones[i] = drones[i].model_copy(update={
                                "detected": True,
                                "coasting": True,
                                "coast_start_time": coast_sensor_loss_time[drone_id],
                                "sensors_detecting": [],
                                "confidence": max(0.0, confidence - 0.1),
                                "x": new_x,
                                "y": new_y,
                                "trail": new_trail,
                            })
                        else:
                            # Brief gap — keep detected state but no sensors
                            drones[i] = drones[i].model_copy(update={
                                "detected": True,
                                "sensors_detecting": detecting_ids,
                                "confidence": confidence,
                            })
                    else:
                        # Never detected — keep as is
                        drones[i] = drones[i].model_copy(update={
                            "detected": False,
                            "sensors_detecting": detecting_ids,
                            "confidence": confidence,
                        })

                    # Update sensor runtime detecting lists
                    for sr in sensor_runtime:
                        if drones[i].id in sr["detecting"]:
                            sr["detecting"].remove(drones[i].id)
                        if sr["id"] in detecting_ids:
                            sr["detecting"].append(drones[i].id)

            # Build state message
            tracks = []
            for drone in drones:
                if drone.detected or drone.neutralized:
                    # Calculate ETA to protected area edge
                    eta_seconds: float | None = None
                    if not drone.neutralized and drone.speed > 0:
                        dx = drone.x - protected_area_center[0]
                        dy = drone.y - protected_area_center[1]
                        dist_to_center = math.sqrt(dx * dx + dy * dy)
                        dist_to_edge = max(0.0, dist_to_center - protected_area_radius)
                        speed_kms = drone.speed * 0.000514444  # knots to km/s
                        if speed_kms > 0:
                            eta_seconds = dist_to_edge / speed_kms

                    tracks.append({
                        "id": drone.id,
                        "dtid_phase": drone.dtid_phase.value,
                        "affiliation": drone.affiliation.value,
                        "x": round(drone.x, 3),
                        "y": round(drone.y, 3),
                        "altitude_ft": round(drone.altitude),
                        "speed_kts": round(drone.speed),
                        "heading_deg": round(drone.heading, 1),
                        "confidence": drone.confidence,
                        "classification": (drone.classification.value if hasattr(drone.classification, 'value') else drone.classification) if drone.classification else None,
                        "trail": drone.trail,
                        "sensors_detecting": drone.sensors_detecting,
                        "neutralized": drone.neutralized,
                        "coasting": drone.coasting,
                        "hold_fire": drone.id in hold_fire_tracks,
                        "eta_protected": round(eta_seconds, 1) if eta_seconds is not None else None,
                        "wave_number": drone.wave_number,
                        "is_ambient": drone.is_ambient,
                        "jammed": drone.jammed,
                        "jammed_behavior": drone.jammed_behavior,
                    })

            state_msg = {
                "type": "state",
                "elapsed": round(elapsed, 1),
                "time_remaining": round(time_remaining, 1),
                "threat_level": _threat_level(drones),
                "wave_number": current_wave,
                "tracks": tracks,
                "sensors": [
                    {
                        "id": sr["id"],
                        "status": sr["status"],
                        "detecting": sr["detecting"],
                    }
                    for sr in sensor_runtime
                ],
                "effectors": [
                    {
                        "id": es["id"],
                        "status": es["status"],
                        **({"ammo_count": es["ammo_count"]} if es.get("ammo_count") is not None else {}),
                        **({"ammo_remaining": es["ammo_remaining"]} if es.get("ammo_remaining") is not None else {}),
                    }
                    for es in effector_states
                ],
            }
            await ws.send_json(state_msg)

            # Send events
            for event in events:
                await ws.send_json(event)

            # Tutorial prompt triggers
            if scenario.tutorial and scenario.tutorial_prompts:
                for tp in scenario.tutorial_prompts:
                    trigger = tp["trigger"]
                    if trigger in tutorial_prompts_sent:
                        continue
                    should_send = False
                    if trigger == "detected":
                        should_send = any(d.detected for d in drones)
                    elif trigger == "tracked":
                        should_send = any(d.dtid_phase == DTIDPhase.TRACKED for d in drones)
                    elif trigger == "identify_ready":
                        should_send = any(
                            d.dtid_phase == DTIDPhase.TRACKED and d.confidence >= 0.4
                            for d in drones
                        )
                    elif trigger == "identified":
                        should_send = any(d.dtid_phase == DTIDPhase.IDENTIFIED for d in drones)
                    elif trigger == "defeated":
                        should_send = any(d.dtid_phase == DTIDPhase.DEFEATED for d in drones)
                    if should_send:
                        await ws.send_json({
                            "type": "tutorial",
                            "message": tp["message"],
                        })
                        tutorial_prompts_sent.add(trigger)

            # Check timeout (30 min max)
            if time_remaining <= 0:
                phase = GamePhase.DEBRIEF
                break

            # Check for player input (non-blocking)
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=tick_rate)
                msg_type = msg.get("type")

                if msg_type == "action":
                    action_name = msg.get("action", "")
                    target_id = msg.get("target_id", drones[0].id if drones else "")

                    if action_name == "confirm_track":
                        for j, d in enumerate(drones):
                            if d.id == target_id and d.dtid_phase == DTIDPhase.DETECTED:
                                drones[j] = d.model_copy(update={
                                    "dtid_phase": DTIDPhase.TRACKED,
                                })
                                confirm_times[target_id] = elapsed
                                actions.append(PlayerAction(
                                    action="confirm_track",
                                    target_id=target_id,
                                    timestamp=elapsed,
                                ))
                                await ws.send_json({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"OPERATOR: Track {target_id.upper()} confirmed",
                                })

                    elif action_name == "identify":
                        classification = msg.get("classification")
                        affiliation = msg.get("affiliation", "unknown")

                        for j, d in enumerate(drones):
                            if d.id == target_id and d.dtid_phase == DTIDPhase.TRACKED:
                                new_affil = Affiliation(affiliation)
                                try:
                                    cls_enum = ThreatClassification(classification)
                                except (ValueError, KeyError):
                                    cls_enum = classification
                                drones[j] = d.model_copy(update={
                                    "dtid_phase": DTIDPhase.IDENTIFIED,
                                    "classification": cls_enum,
                                    "classified": True,
                                    "affiliation": new_affil,
                                })
                                identify_times[target_id] = elapsed
                                classification_given[target_id] = classification
                                affiliation_given[target_id] = affiliation
                                confidence_at_identify[target_id] = d.confidence
                                actions.append(PlayerAction(
                                    action="identify",
                                    target_id=target_id,
                                    classification=classification,
                                    affiliation=affiliation,
                                    timestamp=elapsed,
                                ))
                                await ws.send_json({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"OPERATOR: {target_id.upper()} identified as {classification} ({affiliation})",
                                })

                    elif action_name == "hold_fire":
                        for j, d in enumerate(drones):
                            if d.id == target_id:
                                hold_fire_tracks.add(target_id)
                                actions.append(PlayerAction(
                                    action="hold_fire",
                                    target_id=target_id,
                                    timestamp=elapsed,
                                ))
                                await ws.send_json({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"OPERATOR: HOLD FIRE on {target_id.upper()}",
                                })
                                break

                    elif action_name == "release_hold_fire":
                        if target_id in hold_fire_tracks:
                            hold_fire_tracks.discard(target_id)
                            actions.append(PlayerAction(
                                action="release_hold_fire",
                                target_id=target_id,
                                timestamp=elapsed,
                            ))
                            await ws.send_json({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"OPERATOR: Hold fire RELEASED on {target_id.upper()}",
                            })

                    elif action_name == "engage":
                        # Block engagement if hold fire is active
                        if target_id in hold_fire_tracks:
                            await ws.send_json({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"ENGAGEMENT: BLOCKED — Hold fire active on {target_id.upper()}",
                            })
                        else:
                            effector_id = msg.get("effector", "")
                            eff_state = _find_effector_config(effector_states, effector_id)

                            if eff_state and eff_state["status"] == "ready":
                              # Check ammo for pallet-based effectors
                              if eff_state.get("ammo_remaining") is not None and eff_state["ammo_remaining"] <= 0:
                                  await ws.send_json({
                                      "type": "event",
                                      "timestamp": round(elapsed, 1),
                                      "message": f"ENGAGEMENT: {eff_state['name']} — DEPLETED (no ammo remaining)",
                                  })
                              else:
                               for j, d in enumerate(drones):
                                if d.id == target_id:
                                    is_jammer = eff_state["type"] in ("rf_jam", "electronic")

                                    # Check range — jammers can activate regardless (they radiate omnidirectionally)
                                    if not is_jammer and not _check_effector_in_range(eff_state, d):
                                        await ws.send_json({
                                            "type": "event",
                                            "timestamp": round(elapsed, 1),
                                            "message": f"ENGAGEMENT: {eff_state['name']} — Target out of range",
                                        })
                                        break

                                    # Coyote requires KURFS radar tracking
                                    if eff_state.get("ammo_count") is not None and eff_state["type"] == "kinetic":
                                        if not _check_kurfs_tracking(sensor_configs, d):
                                            await ws.send_json({
                                                "type": "event",
                                                "timestamp": round(elapsed, 1),
                                                "message": "ENGAGEMENT: NO KURFS TRACK \u2014 CANNOT GUIDE INTERCEPTOR",
                                            })
                                            break

                                    effectiveness = _effector_effectiveness(
                                        eff_state["type"], d.drone_type.value
                                    )

                                    # --- EW Jamming: RF jammers don't instantly defeat ---
                                    # (is_jammer already set above)
                                    if is_jammer:
                                        # Jammer activates (radiates) regardless, but effect depends on range
                                        in_jam_range = _check_effector_in_range(eff_state, d)
                                        await ws.send_json({
                                            "type": "event",
                                            "timestamp": round(elapsed, 1),
                                            "message": f"EW: {eff_state['name']} RADIATING" + ("" if in_jam_range else f" — target {d.id.upper()} outside effective range"),
                                        })
                                        if not in_jam_range:
                                            # Jammer is on but drone not in range yet — no effect
                                            break
                                        jam_behavior = _pick_jam_behavior(d.drone_type)
                                        if jam_behavior is None:
                                            # Jam failed — autonomous navigation
                                            await ws.send_json({
                                                "type": "event",
                                                "timestamp": round(elapsed, 1),
                                                "message": f"JAM INEFFECTIVE — AUTONOMOUS NAVIGATION ({d.id.upper()})",
                                            })
                                            await ws.send_json({
                                                "type": "engagement_result",
                                                "target_id": target_id,
                                                "effector": effector_id,
                                                "effective": False,
                                                "effectiveness": 0.0,
                                            })
                                        else:
                                            # Jam takes effect — drone enters jammed state
                                            jam_duration = random.uniform(5.0, 10.0)
                                            drones[j] = d.model_copy(update={
                                                "dtid_phase": DTIDPhase.DEFEATED,
                                                "jammed": True,
                                                "jammed_behavior": jam_behavior,
                                                "jammed_time_remaining": jam_duration,
                                            })
                                            engage_times[target_id] = elapsed
                                            effector_used[target_id] = eff_state["type"]
                                            actions.append(PlayerAction(
                                                action="engage",
                                                target_id=target_id,
                                                effector=effector_id,
                                                timestamp=elapsed,
                                            ))
                                            behavior_label = jam_behavior.replace("_", " ").upper()
                                            await ws.send_json({
                                                "type": "event",
                                                "timestamp": round(elapsed, 1),
                                                "message": f"EW: {d.id.upper()} JAMMED — {behavior_label}",
                                            })
                                            await ws.send_json({
                                                "type": "engagement_result",
                                                "target_id": target_id,
                                                "effector": effector_id,
                                                "effective": True,
                                                "effectiveness": round(effectiveness, 2),
                                                "jammed": True,
                                                "jammed_behavior": jam_behavior,
                                            })
                                    else:
                                        # Non-jammer effectors: instant effect (kinetic, directed energy, etc.)
                                        neutralized = effectiveness > 0.5
                                        drones[j] = d.model_copy(update={
                                            "dtid_phase": DTIDPhase.DEFEATED,
                                            "neutralized": neutralized,
                                        })
                                        engage_times[target_id] = elapsed
                                        effector_used[target_id] = eff_state["type"]
                                        actions.append(PlayerAction(
                                            action="engage",
                                            target_id=target_id,
                                            effector=effector_id,
                                            timestamp=elapsed,
                                        ))

                                        await ws.send_json({
                                            "type": "engagement_result",
                                            "target_id": target_id,
                                            "effector": effector_id,
                                            "effective": neutralized,
                                            "effectiveness": round(effectiveness, 2),
                                        })

                                        result_str = "NEUTRALIZED" if neutralized else "INEFFECTIVE"
                                        await ws.send_json({
                                            "type": "event",
                                            "timestamp": round(elapsed, 1),
                                            "message": f"ENGAGEMENT: {eff_state['name']} vs {target_id.upper()} \u2014 {result_str}",
                                        })

                                    # Handle effector status (recharge/ammo) for all types
                                    if eff_state.get("ammo_remaining") is not None:
                                        eff_state["ammo_remaining"] -= 1
                                        if eff_state["ammo_remaining"] <= 0:
                                            eff_state["status"] = "depleted"
                                    elif eff_state.get("single_use") or eff_state["recharge_seconds"] == 0:
                                        eff_state["status"] = "offline"
                                    elif eff_state["recharge_seconds"] > 0:
                                        eff_state["status"] = "recharging"
                                        eff_state["recharge_remaining"] = float(
                                            eff_state["recharge_seconds"]
                                        )
                                    break

                    elif action_name == "end_mission":
                        phase = GamePhase.DEBRIEF

                elif msg_type == "restart":
                    break

            except asyncio.TimeoutError:
                pass

        # -- Debrief --
        # Filter out ambient drones from scoring
        threat_drone_cfgs = [cfg for cfg in drone_configs.values()
                             if cfg.drone_type not in (DroneType.PASSENGER_AIRCRAFT, DroneType.MILITARY_JET, DroneType.WEATHER_BALLOON)
                             and not (cfg.drone_type == DroneType.BIRD and cfg.correct_affiliation == "neutral")]
        # Include ambient birds/balloons that were engaged (ROE violations)
        ambient_ids_engaged = set()
        for a in actions:
            if a.action == "engage":
                cfg = drone_configs.get(a.target_id)
                if cfg and not cfg.should_engage:
                    ambient_ids_engaged.add(a.target_id)
                    if cfg not in threat_drone_cfgs:
                        threat_drone_cfgs.append(cfg)

        # If no threat drones at all (shouldn't happen), use all
        scorable_cfgs = threat_drone_cfgs if threat_drone_cfgs else list(drone_configs.values())

        if len(scorable_cfgs) <= 1:
            # Single-drone: use legacy scoring path
            primary_cfg = scorable_cfgs[0] if scorable_cfgs else None
            primary_drone_id = primary_cfg.id if primary_cfg else ""
            score = calculate_score(
                scenario=scenario,
                actions=actions,
                detection_time=detection_times.get(primary_drone_id, 0.0),
                confirm_time=confirm_times.get(primary_drone_id),
                identify_time=identify_times.get(primary_drone_id),
                engage_time=engage_times.get(primary_drone_id),
                classification_given=classification_given.get(primary_drone_id),
                affiliation_given=affiliation_given.get(primary_drone_id),
                effector_used=effector_used.get(primary_drone_id),
                drone_reached_base=drone_reached_base,
                confidence_at_identify=confidence_at_identify.get(primary_drone_id, 0.0),
                placement_config=placement_config,
                base_template=base_template,
            )
        else:
            # Multi-drone: score each independently and average
            drones_reached = {d.id for d in drones if not d.is_ambient and distance_to_base(d) < scenario.base_radius_km}
            score = calculate_score_multi(
                scenario=scenario,
                drone_configs=scorable_cfgs,
                actions=actions,
                detection_times=detection_times,
                confirm_times=confirm_times,
                identify_times=identify_times,
                engage_times=engage_times,
                classifications_given=classification_given,
                affiliations_given=affiliation_given,
                effectors_used=effector_used,
                drones_reached_base=drones_reached,
                confidence_at_identify=confidence_at_identify,
                placement_config=placement_config,
                base_template=base_template,
            )

        await ws.send_json({
            "type": "debrief",
            "score": score.model_dump(),
            "drone_reached_base": drone_reached_base,
            "waves_completed": current_wave,
        })

        # Keep connection open for client to read debrief or restart
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "restart":
                    break
        except WebSocketDisconnect:
            pass

    except WebSocketDisconnect:
        pass
