"""Wave generation and ambient air traffic spawning."""

from __future__ import annotations

import math
import random

from app.models import DroneStartConfig, DroneType

# ---------------------------------------------------------------------------
# Wave drone templates
# ---------------------------------------------------------------------------

_WAVE_DRONE_TEMPLATES: list[dict] = [
    {
        "drone_type": "commercial_quad", "altitude": 150, "speed": 35,
        "behavior": "direct_approach", "rf_emitting": True,
        "correct_classification": "commercial_quad", "correct_affiliation": "hostile",
        "optimal_effectors": ["electronic"],
        "acceptable_effectors": ["electronic", "kinetic"],
        "roe_violations": [],
    },
    {
        "drone_type": "commercial_quad", "altitude": 120, "speed": 40,
        "behavior": "evasive", "rf_emitting": True,
        "correct_classification": "commercial_quad", "correct_affiliation": "hostile",
        "optimal_effectors": ["electronic"],
        "acceptable_effectors": ["electronic", "kinetic"],
        "roe_violations": [],
    },
    {
        "drone_type": "fixed_wing", "altitude": 300, "speed": 60,
        "behavior": "direct_approach", "rf_emitting": False,
        "correct_classification": "fixed_wing", "correct_affiliation": "hostile",
        "optimal_effectors": ["kinetic"],
        "acceptable_effectors": ["kinetic", "electronic"],
        "roe_violations": [],
    },
    {
        "drone_type": "micro", "altitude": 80, "speed": 25,
        "behavior": "evasive", "rf_emitting": True,
        "correct_classification": "micro", "correct_affiliation": "hostile",
        "optimal_effectors": ["electronic", "kinetic"],
        "acceptable_effectors": ["electronic", "kinetic"],
        "roe_violations": [],
    },
]


def generate_wave_drones(
    wave_number: int, wave_drone_counter: int
) -> tuple[list[DroneStartConfig], int]:
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
            spawn_delay=i * random.uniform(2.0, 5.0),
            correct_classification=template["correct_classification"],
            correct_affiliation=template["correct_affiliation"],
            optimal_effectors=template["optimal_effectors"],
            acceptable_effectors=template["acceptable_effectors"],
            roe_violations=template["roe_violations"],
            should_engage=True,
        )
        configs.append(cfg)

    return configs, wave_drone_counter


# ---------------------------------------------------------------------------
# Ambient air traffic
# ---------------------------------------------------------------------------

_COMMERCIAL_CALLSIGNS = [
    "QR-412", "EK-771", "BA-209", "LH-442", "AF-381", "SQ-026",
    "UA-857", "DL-134", "AA-291", "JL-006", "CX-888", "TK-517",
]
_MILITARY_CALLSIGNS = [
    "VIPER-01", "RAPTOR-22", "EAGLE-11", "FALCON-03", "HAWK-07",
    "COBRA-14", "THUNDER-05", "SHADOW-09", "STORM-16", "GHOST-21",
]

# Interval ranges (seconds) between ambient spawns per type
AMBIENT_INTERVALS: dict[str, tuple[float, float]] = {
    "commercial_aircraft": (90.0, 150.0),
    "military_jet": (180.0, 300.0),
    "bird": (90.0, 150.0),
    "weather_balloon": (240.0, 420.0),
}


def initial_ambient_schedule() -> dict[str, float]:
    """Return a fresh next-spawn-time dict for ambient traffic."""
    return {
        amb_type: random.uniform(*interval)
        for amb_type, interval in AMBIENT_INTERVALS.items()
    }


def generate_ambient_object(
    ambient_counter: int,
    obj_type: str,
    elapsed: float,
) -> tuple[DroneStartConfig, int]:
    """Generate a single ambient air traffic object."""
    ambient_counter += 1
    amb_id = f"AMB-{ambient_counter:03d}"

    _ALL_ROE_VIOLATIONS = [
        "electronic", "kinetic", "rf_jam", "de_laser", "de_hpm", "net_interceptor"
    ]

    if obj_type == "commercial_aircraft":
        callsign = random.choice(_COMMERCIAL_CALLSIGNS)
        amb_id = callsign
        angle = random.uniform(0, 2 * math.pi)
        start_x = 8.0 * math.cos(angle)
        start_y = 8.0 * math.sin(angle)
        exit_angle = angle + math.pi + random.uniform(-0.3, 0.3)
        exit_x = 15.0 * math.cos(exit_angle)
        exit_y = 15.0 * math.sin(exit_angle)
        heading = math.degrees(math.atan2(exit_y - start_y, exit_x - start_x)) % 360

        cfg = DroneStartConfig(
            id=amb_id,
            drone_type=DroneType.PASSENGER_AIRCRAFT,
            start_x=round(start_x, 2), start_y=round(start_y, 2),
            altitude=random.randint(15000, 35000),
            speed=random.randint(400, 500),
            heading=heading,
            behavior="waypoint_path",
            rf_emitting=True,
            spawn_delay=0.0,
            waypoints=[[round(exit_x, 2), round(exit_y, 2)]],
            correct_classification="passenger_aircraft",
            correct_affiliation="friendly",
            optimal_effectors=[], acceptable_effectors=[],
            roe_violations=_ALL_ROE_VIOLATIONS,
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
            start_x=round(start_x, 2), start_y=round(start_y, 2),
            altitude=random.randint(5000, 15000),
            speed=random.randint(500, 600),
            heading=heading,
            behavior="orbit",
            rf_emitting=True,
            spawn_delay=0.0,
            orbit_center=[
                round(orbit_dist * math.cos(angle + 0.5), 2),
                round(orbit_dist * math.sin(angle + 0.5), 2),
            ],
            orbit_radius=random.uniform(2.0, 4.0),
            correct_classification="fixed_wing",
            correct_affiliation="friendly",
            optimal_effectors=[], acceptable_effectors=[],
            roe_violations=_ALL_ROE_VIOLATIONS,
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
            start_x=round(start_x, 2), start_y=round(start_y, 2),
            altitude=random.randint(50, 500),
            speed=random.randint(20, 40),
            heading=heading,
            behavior="evasive",
            rf_emitting=False,
            spawn_delay=0.0,
            correct_classification="bird",
            correct_affiliation="neutral",
            optimal_effectors=[], acceptable_effectors=[],
            roe_violations=_ALL_ROE_VIOLATIONS,
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
            start_x=round(start_x, 2), start_y=round(start_y, 2),
            altitude=random.randint(500, 2000),
            speed=random.randint(0, 5),
            heading=random.uniform(0, 360),
            behavior="waypoint_path",
            rf_emitting=False,
            spawn_delay=0.0,
            waypoints=[[
                round(start_x + random.uniform(-0.5, 0.5), 2),
                round(start_y + random.uniform(-0.5, 0.5), 2),
            ]],
            correct_classification="weather_balloon",
            correct_affiliation="neutral",
            optimal_effectors=[], acceptable_effectors=[],
            roe_violations=_ALL_ROE_VIOLATIONS,
            should_engage=False,
        )
    else:
        raise ValueError(f"Unknown ambient type: {obj_type}")

    return cfg, ambient_counter
