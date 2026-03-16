"""Drone behavior model -- simple 2D movement toward base with trail tracking."""

from __future__ import annotations

import math

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


def update_drone(drone: DroneState, dt: float, behavior: str) -> DroneState:
    """Advance drone position by dt seconds based on its behavior."""
    if drone.neutralized:
        return drone

    if behavior == "direct_approach":
        return _direct_approach(drone, dt)
    # Future: orbit, coordinated, etc.
    return _direct_approach(drone, dt)


def _direct_approach(drone: DroneState, dt: float) -> DroneState:
    """Move drone directly toward the base at (0, 0)."""
    dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
    if dist < 0.01:  # already at base
        return drone

    # Heading toward origin
    angle = math.atan2(-drone.y, -drone.x)

    # Convert speed from knots to km/s (1 knot = 0.000514 km/s)
    speed_kms = drone.speed * 0.000514

    dx = math.cos(angle) * speed_kms * dt
    dy = math.sin(angle) * speed_kms * dt

    new_x = drone.x + dx
    new_y = drone.y + dy

    # Don't overshoot the origin
    new_dist = math.sqrt(new_x ** 2 + new_y ** 2)
    if new_dist > dist:
        new_x = 0.0
        new_y = 0.0

    heading_deg = math.degrees(angle) % 360

    # Update trail
    trail = list(drone.trail)
    trail.append([round(new_x, 3), round(new_y, 3)])
    if len(trail) > MAX_TRAIL_LENGTH:
        trail = trail[-MAX_TRAIL_LENGTH:]

    return drone.model_copy(update={
        "x": new_x,
        "y": new_y,
        "heading": heading_deg,
        "trail": trail,
    })


def distance_to_base(drone: DroneState) -> float:
    return math.sqrt(drone.x ** 2 + drone.y ** 2)
