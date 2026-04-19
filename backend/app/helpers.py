"""Small utility functions shared across the game loop modules."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import DroneState, SensorConfig

# ---------------------------------------------------------------------------
# Effector-vs-drone effectiveness matrix
# ---------------------------------------------------------------------------

_EFFECTIVENESS_MATRIX: dict[str, dict[str, float]] = {
    "rf_jam": {
        "commercial_quad": 0.9,
        "fixed_wing": 0.4,
        "micro": 0.7,
        "swarm": 0.6,
        "shahed": 0.0,
    },
    "electronic": {
        "commercial_quad": 0.9,
        "fixed_wing": 0.4,
        "micro": 0.7,
        "swarm": 0.6,
        "shahed": 0.0,
    },
    "kinetic": {
        "commercial_quad": 0.95,
        "fixed_wing": 0.8,
        "micro": 0.5,
        "swarm": 0.3,
        "shahed": 0.85,
    },
    "net_interceptor": {
        "commercial_quad": 0.85,
        "fixed_wing": 0.6,
        "micro": 0.9,
        "swarm": 0.4,
    },
    "de_laser": {
        "commercial_quad": 0.9,
        "fixed_wing": 0.85,
        "micro": 0.95,
        "swarm": 0.4,   # Single-target beam — poor vs swarms
        "shahed": 0.0,
    },
    "de_hpm": {
        "commercial_quad": 0.7,   # Disrupts, may not destroy
        "fixed_wing": 0.6,   # Hardened avionics
        "micro": 0.85,
        "swarm": 0.9,   # Area effect excels vs swarms
        "shahed": 0.0,
    },
    "nexus_pm": {
        "commercial_quad": 0.95,
        "fixed_wing": 0.3,   # Many fixed-wing use autonomous nav
        "micro": 0.9,
        "swarm": 0.7,
        "shahed": 0.0,
    },
}


def effector_effectiveness(effector_type: str, drone_type: str) -> float:
    """Return effectiveness score 0-1 based on effector type vs drone type."""
    return _EFFECTIVENESS_MATRIX.get(effector_type, {}).get(drone_type, 0.5)


# ---------------------------------------------------------------------------
# Threat level
# ---------------------------------------------------------------------------


def threat_level(drones: list[DroneState]) -> str:
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


# ---------------------------------------------------------------------------
# Effector look-ups
# ---------------------------------------------------------------------------


def find_effector_config(
    effectors: list[dict], effector_id: str
) -> dict | None:
    """Find an effector state dict by its id."""
    for e in effectors:
        if e["id"] == effector_id:
            return e
    return None


def check_effector_in_range(eff_state: dict, drone: DroneState) -> bool:
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


def check_ku_fcs_tracking(sensor_configs: list[SensorConfig], drone: DroneState) -> bool:
    """Check if any Ku-Band FCS radar has the drone in range."""
    for s in sensor_configs:
        if "kufcs" not in s.id.lower() and "kufcs" not in s.name.lower():
            continue
        dist = math.sqrt((drone.x - s.x) ** 2 + (drone.y - s.y) ** 2)
        if dist <= s.range_km:
            return True
    return False


def check_nexus_rf_tracking(sensor_configs: list[SensorConfig], drone: DroneState) -> bool:
    """Check if any NEXUS RF sensor has the drone in detection range and
    the drone is RF-emitting (library match required)."""
    if not drone.rf_emitting:
        return False
    from app.models import SensorType
    for s in sensor_configs:
        if s.type != SensorType.RF:
            continue
        if "nexus" not in s.id.lower() and "nexus" not in s.name.lower():
            continue
        dist = math.sqrt((drone.x - s.x) ** 2 + (drone.y - s.y) ** 2)
        if dist <= s.range_km:
            return True
    return False


# ---------------------------------------------------------------------------
# Build sensors / effectors from player placement
# ---------------------------------------------------------------------------


def build_sensors_from_placement(placement, catalog_sensors, catalog_combined=None):
    """Build SensorConfig list from player's placement choices.

    Also generates sensor configs from combined placements (e.g. NEXUS).
    """
    from app.models import SensorConfig, SensorType

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

    # Combined systems (e.g. NEXUS) — auto-create sensor at same position
    if catalog_combined:
        for i, placed in enumerate(placement.combined):
            cat = catalog_combined.get(placed.catalog_id)
            if cat is None:
                continue
            sensor_type = SensorType(cat.sensor_type)
            sensors.append(SensorConfig(
                id=f"combined_sensor_{i}_{placed.catalog_id}",
                name=f"{cat.name} RF",
                type=sensor_type,
                range_km=cat.sensor_range_km,
                status="active",
                x=placed.x,
                y=placed.y,
                fov_deg=cat.fov_deg,
                facing_deg=placed.facing_deg,
                requires_los=cat.requires_los,
            ))

    return sensors


def build_effectors_from_placement(placement, catalog_effectors, catalog_combined=None):
    """Build EffectorConfig list from player's placement choices.

    Also generates effector configs from combined placements (e.g. NEXUS).
    """
    from app.models import EffectorConfig, EffectorType

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

    # Combined systems (e.g. NEXUS) — auto-create effector at same position
    if catalog_combined:
        for i, placed in enumerate(placement.combined):
            cat = catalog_combined.get(placed.catalog_id)
            if cat is None:
                continue
            eff_type = EffectorType(cat.effector_type)
            effectors.append(EffectorConfig(
                id=f"combined_effector_{i}_{placed.catalog_id}",
                name=f"{cat.name} PM",
                type=eff_type,
                range_km=cat.effector_range_km,
                status="ready",
                recharge_seconds=cat.recharge_seconds,
                x=placed.x,
                y=placed.y,
                fov_deg=cat.fov_deg,
                facing_deg=placed.facing_deg,
                requires_los=cat.requires_los,
                single_use=cat.single_use,
            ))

    return effectors
