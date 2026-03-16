"""Multi-sensor detection simulation for C-UAS DTID kill chain."""

from __future__ import annotations

import math
import random

from app.models import DroneState, SensorConfig, SensorType


class SensorSimulator:
    """Simulates multi-sensor detection of drone targets."""

    def detect_radar(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """Radar: detects based on range. Provides range, altitude, speed, heading."""
        dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
        if dist > sensor.range_km:
            return None

        # High reliability within range, slight falloff at edge
        ratio = dist / sensor.range_km
        if ratio > 0.9:
            detect_prob = 1.0 - (ratio - 0.9) * 5.0  # falloff at edge
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
        """RF Detection: detects RF-emitting drones only. Provides bearing."""
        if not drone.rf_emitting:
            return None

        dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
        if dist > sensor.range_km:
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.7 else 1.0 - (ratio - 0.7) * 3.0
        if random.random() > max(0, detect_prob):
            return None

        bearing = math.degrees(math.atan2(drone.x, drone.y)) % 360
        noise_factor = dist * 0.03
        return {
            "sensor_id": sensor.id,
            "bearing_deg": round(bearing + random.gauss(0, noise_factor * 5), 1) % 360,
        }

    def detect_eoir(
        self, drone: DroneState, sensor: SensorConfig
    ) -> dict | None:
        """EO/IR Camera: close range detection with visual classification hint."""
        dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
        if dist > sensor.range_km:
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.6 else 1.0 - (ratio - 0.6) * 2.5
        if random.random() > max(0, detect_prob):
            return None

        # Classification hint based on drone type
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
        dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
        if dist > sensor.range_km:
            return None

        ratio = dist / sensor.range_km
        detect_prob = 1.0 if ratio < 0.5 else 1.0 - (ratio - 0.5) * 2.0
        if random.random() > max(0, detect_prob):
            return None

        bearing = math.degrees(math.atan2(drone.x, drone.y)) % 360
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
    drone: DroneState, sensors: list[SensorConfig]
) -> tuple[list[str], list[dict]]:
    """Run all sensors against a drone. Returns (detecting_sensor_ids, sensor_data_list)."""
    simulator = SensorSimulator()
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

    # Base confidence from sensor count
    sensor_count = len(sensors_detecting)
    if sensor_count >= 4:
        base_confidence = 0.95
    elif sensor_count == 3:
        base_confidence = 0.85
    elif sensor_count == 2:
        base_confidence = 0.7
    else:
        base_confidence = 0.5

    # Range modifier: closer = higher confidence
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
