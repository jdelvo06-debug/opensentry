"""Tests for the multi-sensor detection simulation."""

import math
import random

import pytest

from app.detection import (
    SensorSimulator,
    _angle_diff,
    _bearing_between,
    _distance,
    _in_fov,
    _los_blocked,
    _segments_intersect,
    calculate_confidence,
    update_sensors,
)
from app.models import DroneState, DroneType, SensorConfig, SensorType, TerrainFeature


# ===== Geometry helpers =====


class TestDistance:
    def test_zero_distance(self):
        assert _distance(0, 0, 0, 0) == 0.0

    def test_unit_distance(self):
        assert abs(_distance(0, 0, 1, 0) - 1.0) < 1e-9

    def test_diagonal(self):
        assert abs(_distance(0, 0, 3, 4) - 5.0) < 1e-9

    def test_negative_coords(self):
        assert abs(_distance(-1, -1, 2, 3) - 5.0) < 1e-9


class TestBearing:
    def test_due_north(self):
        bearing = _bearing_between(0, 0, 0, 5)
        assert abs(bearing - 0.0) < 1.0  # ~0 degrees

    def test_due_east(self):
        bearing = _bearing_between(0, 0, 5, 0)
        assert abs(bearing - 90.0) < 1.0

    def test_due_south(self):
        bearing = _bearing_between(0, 0, 0, -5)
        assert abs(bearing - 180.0) < 1.0

    def test_due_west(self):
        bearing = _bearing_between(0, 0, -5, 0)
        assert abs(bearing - 270.0) < 1.0


class TestAngleDiff:
    def test_same_angle(self):
        assert _angle_diff(90, 90) == 0.0

    def test_opposite_angles(self):
        assert abs(_angle_diff(0, 180) - 180.0) < 1e-9

    def test_wraparound(self):
        assert abs(_angle_diff(350, 10) - 20.0) < 1e-9

    def test_negative_result_is_absolute(self):
        assert _angle_diff(10, 350) == pytest.approx(20.0, abs=1e-9)


class TestFieldOfView:
    def test_360_fov_always_in(self):
        sensor = SensorConfig(
            id="S1", name="S", type=SensorType.RADAR, range_km=10,
            fov_deg=360, facing_deg=0,
        )
        assert _in_fov(sensor, 0)
        assert _in_fov(sensor, 180)
        assert _in_fov(sensor, 359)

    def test_narrow_fov_center_in(self):
        sensor = SensorConfig(
            id="S1", name="S", type=SensorType.EOIR, range_km=5,
            fov_deg=30, facing_deg=90,
        )
        assert _in_fov(sensor, 90)

    def test_narrow_fov_edge_out(self):
        sensor = SensorConfig(
            id="S1", name="S", type=SensorType.EOIR, range_km=5,
            fov_deg=30, facing_deg=90,
        )
        # 90 + 20 = 110, which is outside ±15 degrees of 90
        assert not _in_fov(sensor, 130)

    def test_narrow_fov_wraparound(self):
        sensor = SensorConfig(
            id="S1", name="S", type=SensorType.EOIR, range_km=5,
            fov_deg=60, facing_deg=350,
        )
        # 350 ± 30 => 320 to 20 (wraps around)
        assert _in_fov(sensor, 5)
        assert _in_fov(sensor, 340)
        assert not _in_fov(sensor, 200)


class TestSegmentsIntersect:
    def test_crossing_segments(self):
        assert _segments_intersect(0, 0, 2, 2, 0, 2, 2, 0) is True

    def test_parallel_segments(self):
        assert _segments_intersect(0, 0, 2, 0, 0, 1, 2, 1) is False

    def test_non_intersecting(self):
        assert _segments_intersect(0, 0, 1, 0, 2, 0, 3, 0) is False


class TestLOSBlocked:
    def test_no_terrain(self):
        assert _los_blocked(0, 0, 5, 5, []) is False

    def test_blocked_by_building(self):
        building = TerrainFeature(
            id="B1", type="building", name="Hangar",
            polygon=[[2, -1], [3, -1], [3, 1], [2, 1]],
            blocks_los=True, height_m=10,
        )
        # Sensor at origin, target at (5, 0) — LOS passes through building
        assert _los_blocked(0, 0, 5, 0, [building]) is True

    def test_not_blocked_around_building(self):
        building = TerrainFeature(
            id="B1", type="building", name="Hangar",
            polygon=[[2, 2], [3, 2], [3, 3], [2, 3]],
            blocks_los=True, height_m=10,
        )
        # Sensor at origin, target at (5, 0) — building is above the LOS line
        assert _los_blocked(0, 0, 5, 0, [building]) is False

    def test_non_blocking_terrain_ignored(self):
        treeline = TerrainFeature(
            id="T1", type="treeline", name="Trees",
            polygon=[[2, -1], [3, -1], [3, 1], [2, 1]],
            blocks_los=False, height_m=5,
        )
        assert _los_blocked(0, 0, 5, 0, [treeline]) is False


# ===== Sensor detection =====


class TestRadarDetection:
    def test_in_range_detects(self, commercial_quad, radar_sensor):
        random.seed(42)
        sim = SensorSimulator()
        result = sim.detect_radar(commercial_quad, radar_sensor)
        # Drone is at (5, 5) = ~7.07km, within 10km radar range
        assert result is not None
        assert result["sensor_id"] == "RADAR-1"
        assert "range_km" in result
        assert "altitude_ft" in result

    def test_out_of_range_no_detect(self, radar_sensor):
        far_drone = DroneState(
            id="FAR", drone_type=DroneType.COMMERCIAL_QUAD,
            x=20.0, y=20.0, altitude=200, speed=30, heading=0,
            trail=[[20, 20]],
        )
        sim = SensorSimulator()
        result = sim.detect_radar(far_drone, radar_sensor)
        assert result is None

    def test_inactive_sensor_no_detect(self, commercial_quad, inactive_sensor):
        sim = SensorSimulator()
        result = sim.detect(commercial_quad, inactive_sensor)
        assert result is None


class TestRFDetection:
    def test_rf_emitting_drone_detected(self, rf_sensor):
        random.seed(42)
        # Place drone well within RF range to avoid edge-of-range probability miss
        close_drone = DroneState(
            id="CLOSE-RF", drone_type=DroneType.COMMERCIAL_QUAD,
            x=3.0, y=3.0, altitude=200, speed=30, heading=225,
            rf_emitting=True, trail=[[3, 3]],
        )
        sim = SensorSimulator()
        result = sim.detect_rf(close_drone, rf_sensor)
        # Drone at ~4.24km, well within 8km RF range, and is rf_emitting
        assert result is not None
        assert "bearing_deg" in result

    def test_non_rf_emitting_not_detected(self, fixed_wing_drone, rf_sensor):
        sim = SensorSimulator()
        result = sim.detect_rf(fixed_wing_drone, rf_sensor)
        assert result is None


class TestEOIRDetection:
    def test_in_fov_detects(self, eoir_sensor):
        random.seed(42)
        # Place drone in the sensor's FOV (facing 45°, FOV 45°, so 22.5-67.5)
        drone = DroneState(
            id="CLOSE", drone_type=DroneType.COMMERCIAL_QUAD,
            x=2.0, y=2.0, altitude=150, speed=20, heading=0,
            trail=[[2, 2]],
        )
        sim = SensorSimulator()
        result = sim.detect_eoir(drone, eoir_sensor)
        # Bearing to (2,2) is 45°, which is within the 45° ± 22.5° FOV
        assert result is not None
        assert result["classification_hint"] == "multi-rotor silhouette"

    def test_out_of_fov_no_detect(self, eoir_sensor):
        # Drone directly south — bearing ~180°, not in 45° ± 22.5° FOV
        drone = DroneState(
            id="SOUTH", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0.0, y=-3.0, altitude=150, speed=20, heading=0,
            trail=[[0, -3]],
        )
        sim = SensorSimulator()
        result = sim.detect_eoir(drone, eoir_sensor)
        assert result is None

    def test_los_blocked_no_detect(self, eoir_sensor):
        # Building sits squarely across the LOS from (0,0) to (3,3)
        building = TerrainFeature(
            id="B1", type="building", name="Wall",
            polygon=[[1.0, 0.5], [2.0, 0.5], [2.0, 2.0], [1.0, 2.0]],
            blocks_los=True, height_m=10,
        )
        # Place drone in the sensor FOV (facing 45°) but behind the building
        drone = DroneState(
            id="BLOCKED", drone_type=DroneType.COMMERCIAL_QUAD,
            x=3.0, y=3.0, altitude=150, speed=20, heading=0,
            trail=[[3, 3]],
        )
        sim = SensorSimulator(terrain=[building])
        result = sim.detect_eoir(drone, eoir_sensor)
        assert result is None


# ===== Sensor dispatch =====


class TestSensorDispatch:
    def test_dispatch_routes_radar(self, commercial_quad, radar_sensor):
        random.seed(42)
        sim = SensorSimulator()
        result = sim.detect(commercial_quad, radar_sensor)
        assert result is not None

    def test_dispatch_routes_rf(self, rf_sensor):
        random.seed(42)
        close_drone = DroneState(
            id="CLOSE-RF", drone_type=DroneType.COMMERCIAL_QUAD,
            x=3.0, y=3.0, altitude=200, speed=30, heading=225,
            rf_emitting=True, trail=[[3, 3]],
        )
        sim = SensorSimulator()
        result = sim.detect(close_drone, rf_sensor)
        assert result is not None

    def test_dispatch_inactive_returns_none(self, commercial_quad, inactive_sensor):
        sim = SensorSimulator()
        result = sim.detect(commercial_quad, inactive_sensor)
        assert result is None


# ===== update_sensors =====


class TestUpdateSensors:
    def test_returns_detecting_ids(self, commercial_quad, radar_sensor, rf_sensor):
        random.seed(42)
        detecting, readings = update_sensors(
            commercial_quad, [radar_sensor, rf_sensor]
        )
        # Drone is RF-emitting and within range of both sensors
        assert len(detecting) >= 1
        assert all(sid in ["RADAR-1", "RF-1"] for sid in detecting)

    def test_no_detections_when_out_of_range(self, radar_sensor):
        far_drone = DroneState(
            id="FAR", drone_type=DroneType.COMMERCIAL_QUAD,
            x=50.0, y=50.0, altitude=200, speed=30, heading=0,
            trail=[[50, 50]],
        )
        detecting, readings = update_sensors(far_drone, [radar_sensor])
        assert len(detecting) == 0
        assert len(readings) == 0


# ===== Confidence calculation =====


class TestConfidence:
    def test_no_sensors_zero_confidence(self):
        assert calculate_confidence([], 5.0) == 0.0

    def test_one_sensor_base_50(self):
        conf = calculate_confidence(["RADAR-1"], 0.5)
        assert conf == 0.5  # 0.5 * 1.0 (close range)

    def test_two_sensors_base_70(self):
        conf = calculate_confidence(["RADAR-1", "RF-1"], 0.5)
        assert conf == 0.7

    def test_three_sensors_base_85(self):
        conf = calculate_confidence(["A", "B", "C"], 0.5)
        assert conf == 0.85

    def test_four_sensors_base_95(self):
        conf = calculate_confidence(["A", "B", "C", "D"], 0.5)
        assert conf == 0.95

    def test_range_modifier_far(self):
        conf = calculate_confidence(["RADAR-1"], 5.0)
        # 0.5 * 0.7 = 0.35
        assert conf == 0.35

    def test_range_modifier_medium(self):
        conf = calculate_confidence(["RADAR-1", "RF-1"], 2.5)
        # 0.7 * 0.85 = 0.595, rounded to 0.59
        assert conf == 0.59

    def test_confidence_capped_at_1(self):
        conf = calculate_confidence(["A", "B", "C", "D", "E"], 0.1)
        assert conf <= 1.0
