"""Tests for drone movement behaviors."""

import math

import pytest

from app.drone import (
    MAX_TRAIL_LENGTH,
    _direct_approach,
    _orbit,
    _update_trail,
    _waypoint_path,
    create_drone,
    distance_to_base,
    update_drone,
)
from app.models import DroneStartConfig, DroneState, DroneType


# ===== create_drone =====


class TestCreateDrone:
    def test_basic_creation(self):
        config = DroneStartConfig(
            id="TEST-1",
            drone_type=DroneType.COMMERCIAL_QUAD,
            start_x=5.0,
            start_y=5.0,
            altitude=200,
            speed=30,
            heading=225,
            behavior="direct_approach",
        )
        drone = create_drone(config)
        assert drone.id == "TEST-1"
        assert drone.x == 5.0
        assert drone.y == 5.0
        assert drone.altitude == 200
        assert drone.speed == 30
        assert drone.trail == [[5.0, 5.0]]
        assert drone.neutralized is False

    def test_rf_emitting_default_true(self):
        config = DroneStartConfig(
            id="RF-1", drone_type=DroneType.COMMERCIAL_QUAD,
            start_x=0, start_y=0, altitude=100, speed=20, heading=0,
            behavior="direct_approach",
        )
        drone = create_drone(config)
        assert drone.rf_emitting is True

    def test_rf_emitting_can_be_false(self):
        config = DroneStartConfig(
            id="STEALTH", drone_type=DroneType.FIXED_WING,
            start_x=0, start_y=0, altitude=300, speed=80, heading=0,
            behavior="direct_approach", rf_emitting=False,
        )
        drone = create_drone(config)
        assert drone.rf_emitting is False


# ===== distance_to_base =====


class TestDistanceToBase:
    def test_at_origin(self):
        drone = DroneState(
            id="D", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0, y=0, altitude=100, speed=0, heading=0, trail=[],
        )
        assert distance_to_base(drone) == 0.0

    def test_known_distance(self, commercial_quad):
        dist = distance_to_base(commercial_quad)
        expected = math.sqrt(5.0**2 + 5.0**2)
        assert abs(dist - expected) < 1e-9


# ===== Trail management =====


class TestTrail:
    def test_trail_appends(self):
        trail = [[0, 0], [1, 1]]
        new = _update_trail(trail, 2.0, 2.0)
        assert len(new) == 3
        assert new[-1] == [2.0, 2.0]

    def test_trail_caps_at_max(self):
        trail = [[float(i), float(i)] for i in range(MAX_TRAIL_LENGTH)]
        new = _update_trail(trail, 999.0, 999.0)
        assert len(new) == MAX_TRAIL_LENGTH
        assert new[-1] == [999.0, 999.0]
        assert new[0] == [1.0, 1.0]  # oldest entry was dropped

    def test_trail_rounds_values(self):
        trail = []
        new = _update_trail(trail, 1.23456789, 9.87654321)
        assert new[-1] == [1.235, 9.877]


# ===== Direct approach behavior =====


class TestDirectApproach:
    def test_moves_toward_base(self, commercial_quad):
        initial_dist = distance_to_base(commercial_quad)
        moved = _direct_approach(commercial_quad, dt=1.0)
        new_dist = distance_to_base(moved)
        assert new_dist < initial_dist

    def test_stops_at_base(self):
        # Drone already at the base
        drone = DroneState(
            id="AT-BASE", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0.005, y=0.005, altitude=100, speed=30, heading=0,
            trail=[[0.005, 0.005]],
        )
        moved = _direct_approach(drone, dt=1.0)
        # Should be at or very near origin
        assert distance_to_base(moved) < 0.02

    def test_neutralized_drone_doesnt_move(self, neutralized_drone):
        moved = update_drone(neutralized_drone, dt=1.0, behavior="direct_approach")
        assert moved.x == neutralized_drone.x
        assert moved.y == neutralized_drone.y

    def test_trail_updated(self, commercial_quad):
        moved = _direct_approach(commercial_quad, dt=1.0)
        assert len(moved.trail) == len(commercial_quad.trail) + 1


# ===== Orbit behavior =====


class TestOrbit:
    def test_orbit_maintains_approximate_radius(self):
        drone = DroneState(
            id="ORB", drone_type=DroneType.COMMERCIAL_QUAD,
            x=1.5, y=0.0, altitude=200, speed=30, heading=0,
            trail=[[1.5, 0.0]],
        )
        radius = 1.5
        center = [0.0, 0.0]

        # Run for several steps to let orbit stabilize
        current = drone
        for _ in range(100):
            current = _orbit(current, dt=0.1, radius=radius, center=center)

        dist = math.sqrt(current.x**2 + current.y**2)
        assert abs(dist - radius) < 0.3  # Allow some drift

    def test_orbit_from_center_starts_east(self):
        drone = DroneState(
            id="ORB", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0.0, y=0.0, altitude=200, speed=30, heading=0,
            trail=[[0.0, 0.0]],
        )
        moved = _orbit(drone, dt=0.1, radius=2.0, center=[0.0, 0.0])
        # Should jump to radius east of center
        assert abs(moved.x - 2.0) < 0.01


# ===== Waypoint path behavior =====


class TestWaypointPath:
    def test_moves_toward_first_waypoint(self):
        drone = DroneState(
            id="WP", drone_type=DroneType.COMMERCIAL_QUAD,
            x=5.0, y=0.0, altitude=200, speed=30, heading=0,
            trail=[[5.0, 0.0]],
        )
        waypoints = [[3.0, 0.0], [0.0, 0.0]]
        moved = _waypoint_path(drone, dt=1.0, waypoints=waypoints)
        assert moved.x < drone.x  # Moved left toward waypoint

    def test_empty_waypoints_falls_back_to_direct(self):
        drone = DroneState(
            id="WP", drone_type=DroneType.COMMERCIAL_QUAD,
            x=5.0, y=5.0, altitude=200, speed=30, heading=0,
            trail=[[5.0, 5.0]],
        )
        moved = _waypoint_path(drone, dt=1.0, waypoints=[])
        # Falls back to direct_approach — should move toward origin
        assert distance_to_base(moved) < distance_to_base(drone)

    def test_doesnt_overshoot_waypoint(self):
        # Drone very close to waypoint with high speed
        drone = DroneState(
            id="WP", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0.01, y=0.0, altitude=200, speed=200, heading=0,
            trail=[[0.01, 0.0]],
        )
        moved = _waypoint_path(drone, dt=1.0, waypoints=[[0.0, 0.0]])
        # Should snap to waypoint, not overshoot
        assert abs(moved.x) < 0.02
        assert abs(moved.y) < 0.02


# ===== update_drone dispatcher =====


class TestUpdateDrone:
    def test_dispatches_direct_approach(self, commercial_quad):
        moved = update_drone(commercial_quad, dt=1.0, behavior="direct_approach")
        assert distance_to_base(moved) < distance_to_base(commercial_quad)

    def test_dispatches_orbit(self, commercial_quad):
        moved = update_drone(
            commercial_quad, dt=0.1, behavior="orbit",
            orbit_radius=2.0, orbit_center=[0.0, 0.0],
        )
        # Just verify it runs without error and position changed
        assert (moved.x != commercial_quad.x) or (moved.y != commercial_quad.y)

    def test_dispatches_waypoint(self, commercial_quad):
        moved = update_drone(
            commercial_quad, dt=1.0, behavior="waypoint_path",
            waypoints=[[3.0, 3.0], [0.0, 0.0]],
        )
        assert distance_to_base(moved) < distance_to_base(commercial_quad)

    def test_unknown_behavior_defaults_to_direct(self, commercial_quad):
        moved = update_drone(commercial_quad, dt=1.0, behavior="unknown_behavior")
        assert distance_to_base(moved) < distance_to_base(commercial_quad)

    def test_neutralized_returns_same(self, neutralized_drone):
        moved = update_drone(neutralized_drone, dt=1.0, behavior="direct_approach")
        assert moved.x == neutralized_drone.x
        assert moved.y == neutralized_drone.y


# ===== Speed conversion sanity =====


class TestSpeedConversion:
    def test_knots_to_kms_conversion(self):
        """Verify the speed conversion factor: 1 knot = 0.000514 km/s."""
        speed_kts = 30
        speed_kms = speed_kts * 0.000514
        # 30 knots ≈ 15.42 m/s ≈ 0.01542 km/s
        assert abs(speed_kms - 0.01542) < 0.001

    def test_drone_moves_expected_distance(self):
        """A 30-knot drone should move ~15.4 meters in 1 second."""
        drone = DroneState(
            id="SPEED", drone_type=DroneType.COMMERCIAL_QUAD,
            x=10.0, y=0.0, altitude=200, speed=30, heading=270,
            trail=[[10.0, 0.0]],
        )
        moved = _direct_approach(drone, dt=1.0)
        dist_moved = math.sqrt((moved.x - drone.x)**2 + (moved.y - drone.y)**2)
        expected_km = 30 * 0.000514  # ~0.01542 km
        assert abs(dist_moved - expected_km) < 0.002
