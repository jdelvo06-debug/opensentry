"""Multi-sensor detection simulation for C-UAS DTID kill chain."""

from __future__ import annotations

import math
import random

from app.models import DroneState, SensorConfig, SensorType, TerrainFeature


def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def _bearing_between(x1: float, y1: float, x2: float, y2: float) -> float:
    """Bearing in degrees from (x1,y1) to (x2,y2), 0=north, clockwise."""
    dx = x2 - x1
    dy = y2 - y1
    return math.degrees(math.atan2(dx, dy)) % 360


def _angle_diff(a: float, b: float) -> float:
    """Smallest signed angle difference between two angles in degrees."""
    diff = (b - a + 180) % 360 - 180
    return abs(diff)


def _in_fov(sensor: SensorConfig, bearing_to_target: float) -> bool:
    """Check if a bearing falls within the sensor's field of view."""
    if sensor.fov_deg >= 360:
        return True
    half_fov = sensor.fov_deg / 2.0
    return _angle_diff(sensor.facing_deg, bearing_to_target) <= half_fov


def _segments_intersect(
    ax: float, ay: float, bx: float, by: float,
    cx: float, cy: float, dx: float, dy: float,
) -> bool:
    """Check if line segment AB intersects line segment CD."""
    def cross(o_x: float, o_y: float, a_x: float, a_y: float, b_x: float, b_y: float) -> float:
        return (a_x - o_x) * (b_y - o_y) - (a_y - o_y) * (b_x - o_x)

    d1 = cross(cx, cy, dx, dy, ax, ay)
    d2 = cross(cx, cy, dx, dy, bx, by)
    d3 = cross(ax, ay, bx, by, cx, cy)
    d4 = cross(ax, ay, bx, by, dx, dy)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def _los_blocked(
    sx: float, sy: float, tx: float, ty: float,
    terrain: list[TerrainFeature],
) -> bool:
    """Check if line of sight from sensor to target is blocked by terrain."""
    for feature in terrain:
        if not feature.blocks_los:
            continue
        poly = feature.polygon
        n = len(poly)
        for i in range(n):
            px1, py1 = poly[i]
            px2, py2 = poly[(i + 1) % n]
            if _segments_intersect(sx, sy, tx, ty, px1, py1, px2, py2):
                return True
    return False


class SensorSimulator:
    """Simulates multi-sensor detection of drone targets."""

    def __init__(self, terrain: list[TerrainFeature] | None = None):
        self.terrain = terrain or []

    def detect_radar(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """Radar: detects based on range. Provides range, altitude, speed, heading."""
        dist = _distance(sensor.x, sensor.y, drone.x, drone.y)
        if dist > sensor.range_km:
            return None

        # Check FOV
        bearing = _bearing_between(sensor.x, sensor.y, drone.x, drone.y)
        if not _in_fov(sensor, bearing):
            return None

        # High reliability within range, slight falloff at edge
        ratio = dist / sensor.range_km
        if ratio > 0.9:
            detect_prob = 1.0 - (ratio - 0.9) * 5.0
        else:
            detect_prob = 1.0

        if random.random() > detect_prob:
            return None

        noise_factor = dist * 0.02
        return {
            "sensor_id": sensor.id,
            "range_km": round(max(0, dist + random.gauss(0, noise_factor)), 2),
            "altitude_ft": round(max(0, drone.altitude + random.gauss(0, 5))),
            "speed_kts": round(max(0, drone.speed + random.gauss(0, 2))),
            "heading_deg": round(drone.heading + random.gauss(0, 3), 1) % 360,
        }

    def detect_rf(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """RF Detection: detects RF-emitting drones only. Provides bearing.

        NEXUS RF sensors additionally return frequency band, signal metrics,
        and uplink/downlink detection flags.
        """
        if not drone.rf_emitting:
            return None

        dist = _distance(sensor.x, sensor.y, drone.x, drone.y)
        if dist > sensor.range_km:
            return None

        bearing = _bearing_between(sensor.x, sensor.y, drone.x, drone.y)
        if not _in_fov(sensor, bearing):
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.7 else 1.0 - (ratio - 0.7) * 3.0
        if random.random() > max(0, detect_prob):
            return None

        noise_factor = dist * 0.03
        result = {
            "sensor_id": sensor.id,
            "bearing_deg": round(bearing + random.gauss(0, noise_factor * 5), 1) % 360,
        }

        # NEXUS RF sensor provides extra protocol-level data
        is_nexus = "nexus" in sensor.id.lower() or "nexus" in sensor.name.lower()
        if is_nexus:
            # Assign frequency band based on drone type
            band_map = {
                "commercial_quad": "2.4GHz",
                "micro": "5.8GHz",
                "fixed_wing": "900MHz",
                "swarm": "2.4GHz",
            }
            freq = band_map.get(drone.drone_type.value, "2.4GHz")
            # Downlink (drone → controller) always detected first
            downlink = True
            # Uplink (controller → drone) detected at closer range
            uplink = ratio < 0.6
            # Signal strength (RSSI) — stronger when closer
            rssi_dbm = round(-30 - (ratio * 60) + random.gauss(0, 3))
            result.update({
                "frequency_band": freq,
                "downlink_detected": downlink,
                "uplink_detected": uplink,
                "rssi_dbm": rssi_dbm,
                "is_nexus": True,
            })

        return result

    def detect_eoir(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """EO/IR Camera: close range detection with visual classification hint. LOS required."""
        dist = _distance(sensor.x, sensor.y, drone.x, drone.y)
        if dist > sensor.range_km:
            return None

        bearing = _bearing_between(sensor.x, sensor.y, drone.x, drone.y)
        if not _in_fov(sensor, bearing):
            return None

        # LOS check for EO/IR
        if self.terrain and _los_blocked(sensor.x, sensor.y, drone.x, drone.y, self.terrain):
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.6 else 1.0 - (ratio - 0.6) * 2.5
        if random.random() > max(0, detect_prob):
            return None

        classification_hints = {
            "commercial_quad": "multi-rotor silhouette",
            "fixed_wing": "fixed-wing silhouette",
            "micro": "small rotary silhouette",
            "swarm": "multiple small contacts",
        }
        hint = classification_hints.get(drone.drone_type.value, "unknown silhouette")

        return {
            "sensor_id": sensor.id,
            "classification_hint": hint,
            "altitude_ft": round(max(0, drone.altitude + random.gauss(0, 3))),
        }

    def detect_acoustic(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """Acoustic: very short range, detects all drones. Provides bearing."""
        dist = _distance(sensor.x, sensor.y, drone.x, drone.y)
        if dist > sensor.range_km:
            return None

        bearing = _bearing_between(sensor.x, sensor.y, drone.x, drone.y)
        if not _in_fov(sensor, bearing):
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.5 else 1.0 - (ratio - 0.5) * 2.0
        if random.random() > max(0, detect_prob):
            return None

        return {
            "sensor_id": sensor.id,
            "bearing_deg": round(bearing + random.gauss(0, 5), 1) % 360,
        }

    def detect(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """Dispatch to the appropriate sensor detection method."""
        if sensor.status != "active":
            return None

        sensor_methods = {
            SensorType.RADAR: self.detect_radar,
            SensorType.RF: self.detect_rf,
            SensorType.EOIR: self.detect_eoir,
            SensorType.ACOUSTIC: self.detect_acoustic,
        }
        method = sensor_methods.get(sensor.type)
        if method is None:
            return None
        return method(drone, sensor)


def update_sensors(
    drone: DroneState,
    sensors: list[SensorConfig],
    terrain: list[TerrainFeature] | None = None,
) -> tuple[list[str], list[dict]]:
    """Run all sensors against a drone. Returns (detecting_sensor_ids, sensor_data_list)."""
    simulator = SensorSimulator(terrain=terrain)
    detecting: list[str] = []
    readings: list[dict] = []

    for sensor in sensors:
        result = simulator.detect(drone, sensor)
        if result is not None:
            detecting.append(sensor.id)
            readings.append(result)

    return detecting, readings


def calculate_confidence(sensors_detecting: list[str], range_km: float) -> float:
    """Calculate confidence 0-1 based on number of sensors and range."""
    if not sensors_detecting:
        return 0.0

    sensor_count = len(sensors_detecting)
    if sensor_count >= 4:
        base_confidence = 0.95
    elif sensor_count == 3:
        base_confidence = 0.85
    elif sensor_count == 2:
        base_confidence = 0.7
    else:
        base_confidence = 0.5

    if range_km < 1.0:
        range_modifier = 1.0
    elif range_km < 2.0:
        range_modifier = 0.95
    elif range_km < 3.0:
        range_modifier = 0.85
    else:
        range_modifier = 0.7

    confidence = base_confidence * range_modifier
    return round(min(1.0, max(0.0, confidence)), 2)
