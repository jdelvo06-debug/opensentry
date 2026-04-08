"""JACKAL interceptor lifecycle — launch, midcourse, terminal,
intercept, and self-destruct phases."""

from __future__ import annotations

import math
import random

from app.config import KTS_TO_KMS
from app.models import DroneState, DTIDPhase


def update_jackal(
    jackal: DroneState,
    drones: list[DroneState],
    tick_rate: float,
    elapsed: float,
) -> tuple[DroneState, list[DroneState], list[dict], list[dict]]:
    """Advance a JACKAL interceptor by one tick.

    Parameters
    ----------
    jackal : DroneState
        The interceptor drone.
    drones : list[DroneState]
        Full drone list (needed to find the target and mark it neutralized).
    tick_rate : float
        Seconds per tick.
    elapsed : float
        Seconds since mission start.

    Returns
    -------
    tuple of (updated_jackal, drone_mutations, events, engagement_results)
        - updated_jackal: the new Jackal state
        - drone_mutations: list of (index, updated_drone) pairs applied to
          *other* drones (e.g. the target being neutralized).  The caller
          should apply these to the master list.
        - events: list of event dicts to broadcast
        - engagement_results: list of engagement_result dicts to send
    """
    events: list[dict] = []
    engagement_results: list[dict] = []
    drone_mutations: list[DroneState] = []

    phase = jackal.intercept_phase

    # --- Spinup phase (10-15s warmup before launch) ---
    if phase == "spinup":
        spinup_remaining = jackal.spinup_remaining - tick_rate
        if spinup_remaining <= 0:
            jackal = jackal.model_copy(update={
                "intercept_phase": "launch",
                "spinup_remaining": 0.0,
            })
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"{jackal.id.upper()} — LAUNCH SEQUENCE COMPLETE — AWAY",
            })
        else:
            countdown = int(spinup_remaining) + 1
            if int(spinup_remaining * 10) % 20 == 0:  # every 2s
                events.append({
                    "type": "event",
                    "timestamp": round(elapsed, 1),
                    "message": f"{jackal.id.upper()} — SPINUP T-{countdown}s",
                })
            jackal = jackal.model_copy(update={"spinup_remaining": spinup_remaining})
        return jackal, drone_mutations, events, engagement_results

    # --- Self-destruct phase ---
    if phase == "self_destruct":
        if jackal.altitude < 328:
            new_alt = min(328, jackal.altitude + 200 * tick_rate)
            trail = _append_trail(jackal)
            jackal = jackal.model_copy(update={
                "altitude": new_alt, "trail": trail,
            })
        else:
            jackal = jackal.model_copy(update={"neutralized": True})
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"{jackal.id.upper()} SELF-DESTRUCT AT {round(jackal.altitude)}ft",
            })
        return jackal, drone_mutations, events, engagement_results

    # --- Find target ---
    target_drone = None
    target_idx = None
    for idx, td in enumerate(drones):
        if td.id == jackal.interceptor_target:
            target_drone = td
            target_idx = idx
            break

    if target_drone is None or target_drone.neutralized:
        jackal = jackal.model_copy(update={"intercept_phase": "self_destruct"})
        events.append({
            "type": "event",
            "timestamp": round(elapsed, 1),
            "message": f"{jackal.id.upper()} — TARGET LOST, ENTERING SELF-DESTRUCT",
        })
        return jackal, drone_mutations, events, engagement_results

    # --- Geometry ---
    dx = target_drone.x - jackal.x
    dy = target_drone.y - jackal.y
    dist_to_target = math.sqrt(dx * dx + dy * dy)
    heading_to_target = math.degrees(math.atan2(dx, dy)) % 360

    # --- Launch phase ---
    if phase == "launch":
        new_alt = min(300, jackal.altitude + 250 * tick_rate)
        new_speed = min(150, jackal.speed + 50 * tick_rate)
        speed_kms = new_speed * KTS_TO_KMS
        heading_rad = math.radians(heading_to_target)
        new_x = jackal.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = jackal.y + math.cos(heading_rad) * speed_kms * tick_rate
        trail = _append_trail(jackal, new_x, new_y)
        next_phase = "midcourse" if new_alt >= 300 else "launch"
        jackal = jackal.model_copy(update={
            "x": new_x, "y": new_y, "altitude": new_alt,
            "speed": new_speed, "heading": heading_to_target,
            "trail": trail, "intercept_phase": next_phase,
        })
        return jackal, drone_mutations, events, engagement_results

    # --- Midcourse phase ---
    if phase == "midcourse":
        speed = 150.0
        speed_kms = speed * KTS_TO_KMS
        heading_rad = math.radians(heading_to_target)
        new_x = jackal.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = jackal.y + math.cos(heading_rad) * speed_kms * tick_rate
        trail = _append_trail(jackal, new_x, new_y)

        if int(elapsed * 10) % 20 == 0:
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"Ku-FC GUIDING {jackal.id.upper()} — RANGE: {dist_to_target:.1f}km",
            })

        next_phase = "terminal" if dist_to_target < 0.3 else "midcourse"
        updates: dict = {
            "x": new_x, "y": new_y, "speed": speed,
            "heading": heading_to_target, "trail": trail,
            "intercept_phase": next_phase,
        }
        if next_phase == "terminal":
            events.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"{jackal.id.upper()} TERMINAL — SEEKER ACQUIRED",
            })
        jackal = jackal.model_copy(update=updates)
        return jackal, drone_mutations, events, engagement_results

    # --- Terminal phase ---
    if phase == "terminal":
        speed = 200.0
        speed_kms = speed * KTS_TO_KMS
        heading_rad = math.radians(heading_to_target)
        new_x = jackal.x + math.sin(heading_rad) * speed_kms * tick_rate
        new_y = jackal.y + math.cos(heading_rad) * speed_kms * tick_rate
        trail = _append_trail(jackal, new_x, new_y)
        jackal = jackal.model_copy(update={
            "x": new_x, "y": new_y, "speed": speed,
            "heading": heading_to_target, "trail": trail,
        })

        # Check intercept distance after movement
        dx2 = target_drone.x - new_x
        dy2 = target_drone.y - new_y
        dist_after = math.sqrt(dx2 * dx2 + dy2 * dy2)

        if dist_after < 0.05:
            attempts = jackal.intercept_attempts + 1
            if random.random() < 0.85:
                # Success — neutralize target
                killed_target = target_drone.model_copy(update={
                    "neutralized": True,
                    "dtid_phase": DTIDPhase.DEFEATED,
                })
                drone_mutations.append(killed_target)
                jackal = jackal.model_copy(update={
                    "neutralized": True,
                    "intercept_attempts": attempts,
                })
                events.append({
                    "type": "event",
                    "timestamp": round(elapsed, 1),
                    "message": f"{jackal.id.upper()} INTERCEPT SUCCESSFUL — TARGET DESTROYED",
                })
                engagement_results.append({
                    "type": "engagement_result",
                    "target_id": jackal.interceptor_target,
                    "effector": jackal.id,
                    "effective": True,
                    "effectiveness": 1.0,
                })
            else:
                # Miss
                if attempts >= 2:
                    jackal = jackal.model_copy(update={
                        "intercept_phase": "self_destruct",
                        "intercept_attempts": attempts,
                    })
                    events.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": f"{jackal.id.upper()} MISSED — MAX ATTEMPTS, SELF-DESTRUCT",
                    })
                else:
                    jackal = jackal.model_copy(update={
                        "intercept_phase": "midcourse",
                        "intercept_attempts": attempts,
                    })
                    events.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": f"{jackal.id.upper()} MISSED — RE-ENGAGING",
                    })

    return jackal, drone_mutations, events, engagement_results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _append_trail(
    drone: DroneState,
    new_x: float | None = None,
    new_y: float | None = None,
    max_length: int = 20,
) -> list[list[float]]:
    """Return a new trail list with the latest position appended."""
    trail = list(drone.trail)
    x = round(new_x, 3) if new_x is not None else round(drone.x, 3)
    y = round(new_y, 3) if new_y is not None else round(drone.y, 3)
    trail.append([x, y])
    if len(trail) > max_length:
        trail = trail[-max_length:]
    return trail
