"""Tests for Pydantic model validation."""

import pytest
from pydantic import ValidationError

from app.models import (
    Affiliation,
    BaseTemplate,
    DTIDPhase,
    DroneStartConfig,
    DroneState,
    DroneType,
    EffectorConfig,
    EffectorType,
    EngagementZones,
    PlacedEquipment,
    PlacementConfig,
    PlayerAction,
    ScenarioConfig,
    ScoreBreakdown,
    SensorConfig,
    SensorType,
    ThreatClassification,
)


# ===== Enum validation =====


class TestEnums:
    def test_dtid_phases(self):
        assert DTIDPhase.DETECTED.value == "detected"
        assert DTIDPhase.TRACKED.value == "tracked"
        assert DTIDPhase.IDENTIFIED.value == "identified"
        assert DTIDPhase.DEFEATED.value == "defeated"

    def test_affiliation_values(self):
        assert Affiliation.UNKNOWN.value == "unknown"
        assert Affiliation.HOSTILE.value == "hostile"
        assert Affiliation.FRIENDLY.value == "friendly"
        assert Affiliation.NEUTRAL.value == "neutral"

    def test_drone_types(self):
        all_types = [e.value for e in DroneType]
        assert "commercial_quad" in all_types
        assert "fixed_wing" in all_types
        assert "bird" in all_types
        assert "jackal" in all_types

    def test_sensor_types(self):
        all_types = [e.value for e in SensorType]
        assert "radar" in all_types
        assert "rf" in all_types
        assert "eoir" in all_types
        assert "acoustic" in all_types

    def test_effector_types(self):
        all_types = [e.value for e in EffectorType]
        assert "rf_jam" in all_types
        assert "kinetic" in all_types


# ===== DroneState =====


class TestDroneState:
    def test_minimal_creation(self):
        drone = DroneState(
            id="D1", drone_type=DroneType.COMMERCIAL_QUAD,
            x=0, y=0, altitude=100, speed=20, heading=0,
        )
        assert drone.detected is False
        assert drone.neutralized is False
        assert drone.dtid_phase == DTIDPhase.DETECTED
        assert drone.affiliation == Affiliation.UNKNOWN
        assert drone.confidence == 0.0
        assert drone.trail == []
        assert drone.coasting is False
        assert drone.hold_fire is False
        assert drone.is_interceptor is False
        assert drone.jammed is False

    def test_jackal_interceptor_fields(self):
        jackal = DroneState(
            id="JKIL-01", drone_type=DroneType.JACKAL,
            x=0, y=0, altitude=100, speed=150, heading=45,
            is_interceptor=True,
            interceptor_target="BOGEY-1",
            intercept_phase="midcourse",
            intercept_attempts=1,
        )
        assert jackal.is_interceptor is True
        assert jackal.interceptor_target == "BOGEY-1"
        assert jackal.intercept_phase == "midcourse"
        assert jackal.intercept_attempts == 1

    def test_model_copy_preserves_fields(self):
        drone = DroneState(
            id="D1", drone_type=DroneType.COMMERCIAL_QUAD,
            x=5, y=5, altitude=200, speed=30, heading=225,
            rf_emitting=True, wave_number=2,
        )
        updated = drone.model_copy(update={"x": 4.0, "y": 4.0})
        assert updated.x == 4.0
        assert updated.y == 4.0
        assert updated.speed == 30  # preserved
        assert updated.wave_number == 2  # preserved

    def test_missing_required_fields_raises(self):
        with pytest.raises(ValidationError):
            DroneState(id="D1")  # missing drone_type, x, y, altitude, speed, heading


# ===== SensorConfig =====


class TestSensorConfig:
    def test_defaults(self):
        sensor = SensorConfig(
            id="S1", name="Test", type=SensorType.RADAR, range_km=10,
        )
        assert sensor.status == "active"
        assert sensor.x == 0.0
        assert sensor.y == 0.0
        assert sensor.fov_deg == 360.0
        assert sensor.facing_deg == 0.0
        assert sensor.requires_los is False

    def test_eoir_with_los(self):
        sensor = SensorConfig(
            id="CAM", name="EO/IR Camera", type=SensorType.EOIR, range_km=8,
            fov_deg=45, facing_deg=90, requires_los=True,
        )
        assert sensor.requires_los is True
        assert sensor.fov_deg == 45


# ===== EffectorConfig =====


class TestEffectorConfig:
    def test_defaults(self):
        eff = EffectorConfig(
            id="E1", name="Jammer", type=EffectorType.RF_JAM, range_km=3,
        )
        assert eff.status == "ready"
        assert eff.single_use is False
        assert eff.ammo_count is None
        assert eff.ammo_remaining is None

    def test_jackal_with_ammo(self):
        jackal = EffectorConfig(
            id="JACKAL-1", name="JACKAL Pallet", type=EffectorType.KINETIC,
            range_km=5, single_use=True, ammo_count=4, ammo_remaining=4,
        )
        assert jackal.ammo_count == 4
        assert jackal.single_use is True


# ===== PlayerAction =====


class TestPlayerAction:
    def test_confirm_action(self):
        action = PlayerAction(action="confirm", target_id="BOGEY-1", timestamp=5.0)
        assert action.classification is None
        assert action.effector is None

    def test_engage_action(self):
        action = PlayerAction(
            action="engage", target_id="BOGEY-1",
            effector="rf_jam", timestamp=15.0,
        )
        assert action.effector == "rf_jam"


# ===== ScoreBreakdown =====


class TestScoreBreakdown:
    def test_full_score(self):
        score = ScoreBreakdown(
            detection_response_score=100,
            tracking_score=100,
            identification_score=100,
            defeat_score=100,
            roe_score=100,
            total_score=100,
            grade="S",
            details={"summary": "Perfect"},
        )
        assert score.grade == "S"
        assert score.placement_score is None

    def test_with_placement(self):
        score = ScoreBreakdown(
            detection_response_score=80,
            tracking_score=70,
            identification_score=60,
            defeat_score=50,
            roe_score=100,
            total_score=68,
            grade="C",
            details={},
            placement_score=75.0,
            placement_details={"coverage": "3/4 corridors covered"},
        )
        assert score.placement_score == 75.0


# ===== ScenarioConfig =====


class TestScenarioConfig:
    def test_minimal_scenario(self, lone_wolf_scenario):
        assert lone_wolf_scenario.id == "lone_wolf"
        assert len(lone_wolf_scenario.drones) == 1
        assert lone_wolf_scenario.correct_classification == ThreatClassification.COMMERCIAL_QUAD
        assert lone_wolf_scenario.correct_affiliation == Affiliation.HOSTILE

    def test_tutorial_fields(self):
        scenario = ScenarioConfig(
            id="tut", name="Tutorial", description="Learn",
            difficulty="easy", duration_seconds=120,
            drones=[DroneStartConfig(
                id="D1", drone_type=DroneType.COMMERCIAL_QUAD,
                start_x=3, start_y=3, altitude=100, speed=20, heading=0,
                behavior="direct_approach",
            )],
            engagement_zones=EngagementZones(
                detection_range_km=10, identification_range_km=5, engagement_range_km=5,
            ),
            sensors=[], effectors=[],
            correct_classification=ThreatClassification.COMMERCIAL_QUAD,
            tutorial=True,
            tutorial_prompts=[{"trigger": "detected", "message": "Click to confirm!"}],
        )
        assert scenario.tutorial is True
        assert len(scenario.tutorial_prompts) == 1


# ===== DroneStartConfig =====


class TestDroneStartConfig:
    def test_per_drone_scoring_overrides(self):
        config = DroneStartConfig(
            id="BIRD-1", drone_type=DroneType.BIRD,
            start_x=3, start_y=2, altitude=80, speed=15, heading=180,
            behavior="waypoint_path",
            correct_classification="bird",
            correct_affiliation="neutral",
            should_engage=False,
            roe_violations=["kinetic"],
        )
        assert config.should_engage is False
        assert config.correct_classification == "bird"
        assert "kinetic" in config.roe_violations

    def test_defaults(self):
        config = DroneStartConfig(
            id="D1", drone_type=DroneType.COMMERCIAL_QUAD,
            start_x=0, start_y=0, altitude=100, speed=20, heading=0,
            behavior="direct_approach",
        )
        assert config.spawn_delay == 0.0
        assert config.rf_emitting is True
        assert config.should_engage is True
        assert config.optimal_effectors is None
        assert config.waypoints is None


# ===== PlacementConfig =====


class TestPlacementConfig:
    def test_placement(self):
        placement = PlacementConfig(
            base_id="test_base",
            sensors=[
                PlacedEquipment(catalog_id="tpq51", x=0.0, y=0.5),
                PlacedEquipment(catalog_id="eoir_camera", x=1.0, y=0.0, facing_deg=45),
            ],
            effectors=[
                PlacedEquipment(catalog_id="rf_jammer", x=0.0, y=0.0),
            ],
        )
        assert len(placement.sensors) == 2
        assert len(placement.effectors) == 1
        assert placement.sensors[1].facing_deg == 45
