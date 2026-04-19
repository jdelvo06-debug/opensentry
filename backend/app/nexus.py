"""NEXUS Protocol Manipulation — countermeasure logic and
drone behavior updates for NEXUS defeats.

Countermeasure types:
  - HOLD:     Freeze drone in place (hover lock)
  - LAND NOW: Forced descent to ground
  - DEAFEN:   Sever control link (drone enters failsafe behavior)

CM state progression:
  - 1/2 (downlink only): Partial effect — drone responds sluggishly
  - 2/2 (uplink acquired): Full protocol control — immediate effect
"""

from __future__ import annotations

import math
import random
from typing import TYPE_CHECKING

from app.config import KTS_TO_KMS
from app.models import DroneState, DroneType, DTIDPhase

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Frequency band assignment (library-based detection)
# ---------------------------------------------------------------------------

DRONE_FREQUENCY_MAP: dict[str, str] = {
    "commercial_quad": "2.4GHz",
    "micro": "5.8GHz",
    "fixed_wing": "900MHz",
    "swarm": "2.4GHz",
}

# Drones that NEXUS cannot affect (no RF control link in library)
NEXUS_IMMUNE_TYPES = {DroneType.BIRD, DroneType.WEATHER_BALLOON, DroneType.PASSENGER_AIRCRAFT, DroneType.MILITARY_JET}
NEXUS_SUPPORTED_TYPES = {DroneType.COMMERCIAL_QUAD, DroneType.MICRO}


def is_nexus_vulnerable(drone: DroneState) -> bool:
    """Check if a drone can be affected by NEXUS protocol manipulation."""
    if drone.drone_type in NEXUS_IMMUNE_TYPES:
        return False
    if not drone.rf_emitting:
        return False
    return drone.drone_type in NEXUS_SUPPORTED_TYPES


def pick_nexus_cm_effectiveness(drone: DroneState, cm_type: str) -> bool:
    """Determine if a NEXUS countermeasure succeeds on this drone.

    Supported NEXUS library matches are reliably affected.
    """
    return True


# ---------------------------------------------------------------------------
# Update NEXUS-affected drones (called each tick from game loop)
# ---------------------------------------------------------------------------


def update_nexus_drone(
    drone: DroneState,
    tick_rate: float,
    elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """Advance a drone under NEXUS countermeasure effect by one tick.

    Returns the updated DroneState and a list of event dicts.
    """
    events: list[dict] = []
    cm = drone.nexus_cm_active
    cm_state = drone.nexus_cm_state

    # Decrement CM timer
    prev_remaining = drone.nexus_cm_time_remaining
    remaining = max(0.0, prev_remaining - tick_rate)
    drone = drone.model_copy(update={"nexus_cm_time_remaining": remaining})

    # Track how long CM has been active (initial duration - remaining)
    cm_elapsed = drone.nexus_cm_initial_duration - remaining

    # --- State progression: pending → 1/2 → 2/2 ---
    if cm_state == "pending":
        # After ~1 second, acquire downlink (1/2)
        if cm_elapsed >= 1.0 or remaining <= 0:
            drone = drone.model_copy(update={
                "nexus_cm_state": "1/2",
                "downlink_detected": True,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"NEXUS: {drone.id.upper()} — Downlink acquired (1/2)",
            })
        return drone, events

    if cm_state == "1/2":
        # After ~2 more seconds, acquire uplink if close enough (2/2)
        if drone.uplink_detected:
            # Reset timer to full duration when full control is established
            import random as _random
            new_duration = _random.uniform(20.0, 40.0)
            drone = drone.model_copy(update={
                "nexus_cm_state": "2/2",
                "nexus_cm_time_remaining": new_duration,
                "nexus_cm_initial_duration": new_duration,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"NEXUS: {drone.id.upper()} — Uplink acquired (2/2) — FULL CONTROL",
            })
        # 1/2 state: partial effect (reduced speed/responsiveness)
        elif cm == "nexus_hold":
            # Partial hold — drone slows significantly
            new_speed = max(5, drone.speed * 0.85)
            drone = drone.model_copy(update={"speed": new_speed})
        elif cm == "nexus_land_now":
            # Partial land — slow descent
            new_alt = max(0, drone.altitude - 10 * tick_rate)
            drone = drone.model_copy(update={"altitude": new_alt})
        elif cm == "nexus_deafen":
            # Partial deafen — intermittent link disruption (speed jitter)
            new_speed = drone.speed * random.uniform(0.7, 1.0)
            drone = drone.model_copy(update={"speed": max(0, new_speed)})
        return drone, events

    # --- 2/2 state: full protocol control ---
    if cm_state == "2/2":
        if cm == "nexus_hold":
            drone, hold_events = _apply_hold(drone, tick_rate, elapsed)
            events.extend(hold_events)
        elif cm == "nexus_land_now":
            drone, land_events = _apply_land_now(drone, tick_rate, elapsed)
            events.extend(land_events)
        elif cm == "nexus_deafen":
            drone, deafen_events = _apply_deafen(drone, tick_rate, elapsed)
            events.extend(deafen_events)

    # Check if CM effect has expired
    if remaining <= 0 and not drone.neutralized:
        drone = drone.model_copy(update={
            "nexus_cm_active": None,
            "nexus_cm_state": None,
            "nexus_cm_time_remaining": 0.0,
        })
        events.append({
            "type": "event",
            "timestamp": round(elapsed, 1),
            "message": f"NEXUS: {drone.id.upper()} — CM effect expired",
        })

    return drone, events


# ---------------------------------------------------------------------------
# Individual CM behavior implementations
# ---------------------------------------------------------------------------


def _apply_hold(
    drone: DroneState, tick_rate: float, elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """HOLD: Freeze drone in place — zero out speed, maintain altitude."""
    events: list[dict] = []
    if drone.speed > 1:
        # Rapid deceleration to hover
        new_speed = max(0, drone.speed - 20 * tick_rate)
        drone = drone.model_copy(update={"speed": new_speed})
    else:
        # Hovering in place
        drone = drone.model_copy(update={"speed": 0})
    return drone, events


def _apply_land_now(
    drone: DroneState, tick_rate: float, elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """LAND NOW: Forced controlled descent at ~100 ft/s."""
    events: list[dict] = []
    descent_rate = 100.0  # feet per second
    new_alt = max(0, drone.altitude - descent_rate * tick_rate)
    new_speed = max(0, drone.speed * 0.9)  # Also decelerating
    drone = drone.model_copy(update={
        "altitude": new_alt,
        "speed": new_speed,
    })
    if new_alt <= 0:
        drone = drone.model_copy(update={
            "neutralized": True,
            "altitude": 0,
            "speed": 0,
            "nexus_cm_time_remaining": 0.0,
        })
        events.append({
            "type": "event",
            "timestamp": round(elapsed, 1),
            "message": f"NEXUS: {drone.id.upper()} — FORCED LANDING COMPLETE (grounded)",
        })
    return drone, events


def _apply_deafen(
    drone: DroneState, tick_rate: float, elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """DEAFEN: Sever control link — drone enters failsafe.

    Failsafe behavior depends on drone type:
    - Commercial quads: hover → slow descent → land
    - Fixed-wing: continue last heading → eventually crash or leave area
    - Micro: erratic drift → crash
    """
    events: list[dict] = []

    if drone.drone_type in (DroneType.COMMERCIAL_QUAD, DroneType.MICRO):
        # Failsafe: hover then descend
        new_speed = max(0, drone.speed * 0.8)
        new_alt = max(0, drone.altitude - 30 * tick_rate)
        trail = list(drone.trail)
        trail.append([round(drone.x, 3), round(drone.y, 3)])
        if len(trail) > 20:
            trail = trail[-20:]
        drone = drone.model_copy(update={
            "speed": new_speed,
            "altitude": new_alt,
            "trail": trail,
        })
        if new_alt <= 0:
            drone = drone.model_copy(update={
                "neutralized": True,
                "altitude": 0,
                "speed": 0,
                "nexus_cm_time_remaining": 0.0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"NEXUS: {drone.id.upper()} — LINK LOST — FAILSAFE LANDING",
            })
    else:
        # Fixed-wing / swarm: continue on last heading (no corrections)
        heading_rad = math.radians(drone.heading)
        speed_kms = drone.speed * KTS_TO_KMS
        new_x = drone.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = drone.y + math.cos(heading_rad) * speed_kms * tick_rate
        trail = list(drone.trail)
        trail.append([round(new_x, 3), round(new_y, 3)])
        if len(trail) > 20:
            trail = trail[-20:]
        drone = drone.model_copy(update={
            "x": new_x,
            "y": new_y,
            "trail": trail,
        })
        # Leave area check
        if math.sqrt(new_x ** 2 + new_y ** 2) > 10.0:
            drone = drone.model_copy(update={
                "neutralized": True,
                "nexus_cm_time_remaining": 0.0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"NEXUS: {drone.id.upper()} — LINK LOST — LEFT AREA",
            })

    return drone, events
