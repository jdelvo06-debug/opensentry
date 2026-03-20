"""EW (Electronic Warfare) jamming logic — jam behaviour selection and
jammed-drone movement updates."""

from __future__ import annotations

import math
import random

from app.config import KTS_TO_KMS
from app.models import DroneState, DroneType


# Per-type RF jam resistance probability (chance that RF link disruption has NO effect)
JAM_RESIST: dict[DroneType, float] = {
    DroneType.COMMERCIAL_QUAD: 0.0,   # Fully jammable — GPS + RF dependent
    DroneType.MICRO: 0.10,            # Mostly jammable — small GPS receiver
    DroneType.FIXED_WING: 0.40,       # Partial — may have basic autopilot
    DroneType.IMPROVISED: 0.50,       # Unknown RF dependency — coin flip
    DroneType.SHAHED: 1.0,            # RF-immune — autonomous INS nav, no RF link
}
# Default for any type not listed (e.g. bird, swarm)
_DEFAULT_JAM_RESIST = 0.50

# Per-type PNT vulnerability (drift magnitude in km/s applied when PNT-jammed)
# 0.0 = immune (INS navigation). Higher = GPS-dependent, larger drift.
PNT_VULNERABILITY: dict[DroneType, float] = {
    DroneType.COMMERCIAL_QUAD: 0.008,  # Heavy GPS reliance — significant drift
    DroneType.MICRO: 0.006,            # Small GPS receiver — moderate drift
    DroneType.FIXED_WING: 0.004,       # May have basic autopilot — light drift
    DroneType.IMPROVISED: 0.005,       # Unknown GPS dependency — moderate drift
    DroneType.SHAHED: 0.003,           # INS-primary but still GPS-aided — minor drift
}
# Default for unlisted types (ambient traffic, birds, etc.)
_DEFAULT_PNT_VULNERABILITY = 0.0  # Don't jam ambient/non-threat types


def pick_jam_behavior(drone_type: DroneType) -> str | None:
    """Pick a jammed behavior for the drone.

    Returns ``None`` if the jam fails based on per-type resistance.
    SHAHED always returns None (autonomous INS navigation, no RF link).
    """
    resist = JAM_RESIST.get(drone_type, _DEFAULT_JAM_RESIST)
    if random.random() < resist:
        return None  # Jam fails
    return random.choice(["loss_of_control", "rth", "forced_landing", "gps_spoof"])


def apply_pnt_jamming(drone_type: DroneType) -> tuple[bool, float]:
    """Determine PNT jamming effect for a drone type.

    Returns ``(effective, drift_magnitude)`` where *drift_magnitude* is the
    km/s of random nav error injected per tick.  SHAHED receives minor drift
    (GPS-aided INS), all other non-listed types are immune (drift = 0.0).
    """
    drift = PNT_VULNERABILITY.get(drone_type, _DEFAULT_PNT_VULNERABILITY)
    if drift <= 0.0:
        return False, 0.0
    # Add ±20% jitter to drift magnitude so each jam event feels distinct
    jitter = random.uniform(0.8, 1.2)
    return True, round(drift * jitter, 5)


def update_pnt_jammed_drone(
    drone: DroneState,
    tick_rate: float,
    elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """Advance a PNT-jammed drone by one tick.

    Applies random navigation drift (heading perturbation) and decrements
    the PNT jam timer.  Does NOT neutralize the drone — PNT jamming degrades
    accuracy, it doesn't defeat the drone outright.

    Returns the updated ``DroneState`` and a (possibly empty) list of event dicts.
    """
    events: list[dict] = []

    remaining = drone.pnt_jammed_time_remaining - tick_rate
    if remaining <= 0:
        # PNT effect expired — clear state
        drone = drone.model_copy(update={
            "pnt_jammed": False,
            "pnt_drift_magnitude": 0.0,
            "pnt_jammed_time_remaining": 0.0,
        })
        events.append({
            "type": "event",
            "timestamp": round(elapsed, 1),
            "message": f"PNT: {drone.id.upper()} — NAV DEGRADATION CLEARED",
        })
        return drone, events

    # Apply drift: random heading perturbation proportional to drift magnitude
    drift_km = drone.pnt_drift_magnitude
    # Random direction for this tick's nav error
    drift_angle = random.uniform(0, 2 * math.pi)
    from app.config import KTS_TO_KMS  # avoid circular at module level
    new_x = drone.x + math.cos(drift_angle) * drift_km * tick_rate
    new_y = drone.y + math.sin(drift_angle) * drift_km * tick_rate

    trail = list(drone.trail)
    trail.append([round(new_x, 3), round(new_y, 3)])
    if len(trail) > 20:
        trail = trail[-20:]

    drone = drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "trail": trail,
        "pnt_jammed_time_remaining": remaining,
    })
    return drone, events


def update_jammed_drone(
    drone: DroneState,
    tick_rate: float,
    elapsed: float,
) -> tuple[DroneState, list[dict]]:
    """Advance a jammed drone by one tick.

    Returns the updated ``DroneState`` and a (possibly empty) list of event
    dicts to broadcast.
    """
    events: list[dict] = []

    # Decrement jam timer
    drone = drone.model_copy(update={
        "jammed_time_remaining": drone.jammed_time_remaining - tick_rate,
    })

    jb = drone.jammed_behavior

    if jb == "loss_of_control":
        speed_kms = drone.speed * KTS_TO_KMS * 0.5  # half-speed drift
        heading_rad = math.radians(drone.heading)
        new_x = drone.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = drone.y + math.cos(heading_rad) * speed_kms * tick_rate
        new_alt = max(0, drone.altitude - 15 * tick_rate)
        trail = list(drone.trail)
        trail.append([round(new_x, 3), round(new_y, 3)])
        if len(trail) > 20:
            trail = trail[-20:]
        drone = drone.model_copy(update={
            "x": new_x, "y": new_y, "altitude": new_alt,
            "speed": drone.speed * 0.95, "trail": trail,
        })
        if new_alt <= 0 or drone.jammed_time_remaining <= 0:
            drone = drone.model_copy(update={
                "neutralized": True, "jammed_time_remaining": 0, "altitude": 0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone.id.upper()} — CRASHED (loss of control)",
            })

    elif jb == "rth":
        away_angle = math.atan2(drone.y, drone.x)
        speed_kms = drone.speed * KTS_TO_KMS
        new_x = drone.x + math.cos(away_angle) * speed_kms * tick_rate
        new_y = drone.y + math.sin(away_angle) * speed_kms * tick_rate
        heading_deg = math.degrees(away_angle) % 360
        trail = list(drone.trail)
        trail.append([round(new_x, 3), round(new_y, 3)])
        if len(trail) > 20:
            trail = trail[-20:]
        drone = drone.model_copy(update={
            "x": new_x, "y": new_y, "heading": heading_deg, "trail": trail,
        })
        if math.sqrt(new_x ** 2 + new_y ** 2) > 10.0:
            drone = drone.model_copy(update={
                "neutralized": True, "jammed_time_remaining": 0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone.id.upper()} — RTH (left area)",
            })

    elif jb == "forced_landing":
        new_alt = max(0, drone.altitude - 50 * tick_rate)
        drone = drone.model_copy(update={
            "altitude": new_alt,
            "speed": max(0, drone.speed - 5 * tick_rate),
        })
        if new_alt <= 0:
            drone = drone.model_copy(update={
                "neutralized": True, "jammed_time_remaining": 0,
                "altitude": 0, "speed": 0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone.id.upper()} — FORCED LANDING (grounded)",
            })

    elif jb == "gps_spoof":
        spoof_heading = (
            drone.heading + random.uniform(90, 180) * random.choice([-1, 1])
        ) % 360
        heading_rad = math.radians(spoof_heading)
        speed_kms = drone.speed * KTS_TO_KMS
        new_x = drone.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = drone.y + math.cos(heading_rad) * speed_kms * tick_rate
        trail = list(drone.trail)
        trail.append([round(new_x, 3), round(new_y, 3)])
        if len(trail) > 20:
            trail = trail[-20:]
        drone = drone.model_copy(update={
            "x": new_x, "y": new_y, "heading": spoof_heading, "trail": trail,
        })
        if math.sqrt(new_x ** 2 + new_y ** 2) > 10.0:
            drone = drone.model_copy(update={
                "neutralized": True, "jammed_time_remaining": 0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone.id.upper()} — GPS SPOOFED (left area)",
            })

    return drone, events
