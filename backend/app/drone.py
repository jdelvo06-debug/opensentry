"""Drone behavior model -- 2D movement behaviors with trail tracking."""

from __future__ import annotations

import math
import random

from app.config import KTS_TO_KMS
from app.models import DroneState, DroneStartConfig


MAX_TRAIL_LENGTH = 20


def create_drone(config: DroneStartConfig) -> DroneState:
    return DroneState(
        id=config.id,
        drone_type=config.drone_type,
        x=config.start_x,
        y=config.start_y,
        altitude=config.altitude,
        speed=config.speed,
        heading=config.heading,
        rf_emitting=config.rf_emitting,
        trail=[[config.start_x, config.start_y]],
    )


def update_drone(
    drone: DroneState,
    dt: float,
    behavior: str,
    *,
    waypoints: list[list[float]] | None = None,
    orbit_radius: float = 1.5,
    orbit_center: list[float] | None = None,
    detected_by_player: bool = False,
) -> DroneState:
    """Advance drone position by dt seconds based on its behavior."""
    if drone.neutralized:
        return drone

    if behavior == "direct_approach":
        return _direct_approach(drone, dt)
    elif behavior == "orbit":
        center = orbit_center or [0.0, 0.0]
        return _orbit(drone, dt, orbit_radius, center)
    elif behavior == "waypoint_path":
        return _waypoint_path(drone, dt, waypoints or [])
    elif behavior == "evasive":
        return _evasive(drone, dt, detected_by_player)
    return _direct_approach(drone, dt)


def _direct_approach(drone: DroneState, dt: float) -> DroneState:
    """Move drone directly toward the base at (0, 0)."""
    dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
    if dist < 0.01:
        return drone

    angle = math.atan2(-drone.y, -drone.x)
    speed_kms = drone.speed * KTS_TO_KMS

    dx = math.cos(angle) * speed_kms * dt
    dy = math.sin(angle) * speed_kms * dt

    new_x = drone.x + dx
    new_y = drone.y + dy

    new_dist = math.sqrt(new_x ** 2 + new_y ** 2)
    if new_dist > dist:
        new_x = 0.0
        new_y = 0.0

    heading_deg = math.degrees(angle) % 360
    trail = _update_trail(drone.trail, new_x, new_y)

    return drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "heading": heading_deg,
        "trail": trail,
    })


def _orbit(
    drone: DroneState,
    dt: float,
    radius: float,
    center: list[float],
) -> DroneState:
    """Circle around a center point at the given orbit radius."""
    cx, cy = center
    rel_x = drone.x - cx
    rel_y = drone.y - cy
    dist = math.sqrt(rel_x ** 2 + rel_y ** 2)

    speed_kms = drone.speed * KTS_TO_KMS

    if dist < 0.01:
        # Start the orbit from directly east of center
        new_x = cx + radius
        new_y = cy
        heading_deg = 0.0
    elif abs(dist - radius) > 0.05:
        # Not yet at orbit radius — spiral in/out toward it
        target_angle = math.atan2(rel_y, rel_x)
        # Blend tangential + radial movement
        if dist > radius:
            radial_angle = target_angle + math.pi  # inward
        else:
            radial_angle = target_angle  # outward
        tangent_angle = target_angle + math.pi / 2  # clockwise
        blend = 0.5
        move_angle = math.atan2(
            blend * math.sin(radial_angle) + (1 - blend) * math.sin(tangent_angle),
            blend * math.cos(radial_angle) + (1 - blend) * math.cos(tangent_angle),
        )
        dx = math.cos(move_angle) * speed_kms * dt
        dy = math.sin(move_angle) * speed_kms * dt
        new_x = drone.x + dx
        new_y = drone.y + dy
        heading_deg = math.degrees(move_angle) % 360
    else:
        # On orbit — move tangentially (clockwise)
        current_angle = math.atan2(rel_y, rel_x)
        angular_speed = speed_kms / radius
        new_angle = current_angle + angular_speed * dt
        new_x = cx + radius * math.cos(new_angle)
        new_y = cy + radius * math.sin(new_angle)
        heading_deg = math.degrees(new_angle + math.pi / 2) % 360

    trail = _update_trail(drone.trail, new_x, new_y)

    return drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "heading": heading_deg,
        "trail": trail,
    })


def _waypoint_path(
    drone: DroneState,
    dt: float,
    waypoints: list[list[float]],
) -> DroneState:
    """Follow a list of [x,y] waypoints in order, then hold at last one."""
    if not waypoints:
        return _direct_approach(drone, dt)

    # Find current target waypoint (first one we haven't reached)
    target_wp = waypoints[-1]
    for wp in waypoints:
        dx_wp = wp[0] - drone.x
        dy_wp = wp[1] - drone.y
        dist_to_wp = math.sqrt(dx_wp ** 2 + dy_wp ** 2)
        if dist_to_wp > 0.05:
            target_wp = wp
            break

    tx, ty = target_wp
    dx = tx - drone.x
    dy = ty - drone.y
    dist = math.sqrt(dx ** 2 + dy ** 2)

    if dist < 0.01:
        return drone

    angle = math.atan2(dy, dx)
    speed_kms = drone.speed * KTS_TO_KMS

    move_x = math.cos(angle) * speed_kms * dt
    move_y = math.sin(angle) * speed_kms * dt

    new_x = drone.x + move_x
    new_y = drone.y + move_y

    # Don't overshoot waypoint
    if math.sqrt((new_x - tx) ** 2 + (new_y - ty) ** 2) > dist:
        new_x = tx
        new_y = ty

    heading_deg = math.degrees(angle) % 360
    trail = _update_trail(drone.trail, new_x, new_y)

    return drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "heading": heading_deg,
        "trail": trail,
    })


# Per-drone evasive jink state: {drone_id: {"offset_rad": float, "alt_offset": float, "next_jink": float}}
_evasive_state: dict[str, dict] = {}


def _evasive(drone: DroneState, dt: float, detected_by_player: bool) -> DroneState:
    """Direct approach until detected, then jinks heading ±30-60° and altitude ±50m every 2-4s."""
    if not detected_by_player:
        return _direct_approach(drone, dt)

    # Initialize jink state for this drone
    if drone.id not in _evasive_state:
        _evasive_state[drone.id] = {
            "offset_rad": 0.0,
            "alt_offset": 0.0,
            "next_jink": 0.0,
            "tick_counter": 0.0,
        }

    state = _evasive_state[drone.id]
    state["tick_counter"] += dt

    # Jink every 2-4 seconds
    if state["tick_counter"] >= state["next_jink"]:
        offset_deg = random.uniform(30, 60) * random.choice([-1, 1])
        state["offset_rad"] = math.radians(offset_deg)
        state["alt_offset"] = random.uniform(25, 50) * random.choice([-1, 1])
        state["next_jink"] = state["tick_counter"] + random.uniform(2.0, 4.0)

    speed_kms = drone.speed * KTS_TO_KMS
    base_angle = math.atan2(-drone.y, -drone.x)
    angle = base_angle + state["offset_rad"]

    dx = math.cos(angle) * speed_kms * dt
    dy = math.sin(angle) * speed_kms * dt

    new_x = drone.x + dx
    new_y = drone.y + dy
    new_alt = max(30, min(500, drone.altitude + state["alt_offset"] * dt))

    heading_deg = math.degrees(angle) % 360
    trail = _update_trail(drone.trail, new_x, new_y)

    return drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "altitude": new_alt,
        "heading": heading_deg,
        "trail": trail,
    })


def _update_trail(trail: list[list[float]], x: float, y: float) -> list[list[float]]:
    new_trail = list(trail)
    new_trail.append([round(x, 3), round(y, 3)])
    if len(new_trail) > MAX_TRAIL_LENGTH:
        new_trail = new_trail[-MAX_TRAIL_LENGTH:]
    return new_trail


def distance_to_base(drone: DroneState) -> float:
    return math.sqrt(drone.x ** 2 + drone.y ** 2)
