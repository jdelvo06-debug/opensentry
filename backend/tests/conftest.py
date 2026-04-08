"""Shared fixtures for OpenSentry backend tests."""

import pytest

from app.models import (
    Affiliation,
    ApproachCorridor,
    BaseTemplate,
    DroneStartConfig,
    DroneState,
    DroneType,
    EffectorConfig,
    EffectorType,
    EngagementZones,
    PlacedEquipment,
    PlacementConfig,
    PlayerAction,
    ProtectedAsset,
    ScenarioConfig,
    SensorConfig,
    SensorType,
    TerrainFeature,
    ThreatClassification,
)


# ---------------------------------------------------------------------------
# Drone fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def commercial_quad() -> DroneState:
    """A standard commercial quadcopter approaching from the north-east."""
    return DroneState(
        id="BOGEY-1",
        drone_type=DroneType.COMMERCIAL_QUAD,
        x=5.0,
        y=5.0,
        altitude=200,
        speed=30,
        heading=225,
        rf_emitting=True,
        trail=[[5.0, 5.0]],
    )


@pytest.fixture
def fixed_wing_drone() -> DroneState:
    """A fixed-wing UAS at higher altitude and speed."""
    return DroneState(
        id="BOGEY-2",
        drone_type=DroneType.FIXED_WING,
        x=8.0,
        y=0.0,
        altitude=400,
        speed=80,
        heading=270,
        rf_emitting=False,
        trail=[[8.0, 0.0]],
    )


@pytest.fixture
def bird_target() -> DroneState:
    """A bird (non-threat) at close range."""
    return DroneState(
        id="BOGEY-3",
        drone_type=DroneType.BIRD,
        x=1.0,
        y=1.0,
        altitude=100,
        speed=15,
        heading=180,
        rf_emitting=False,
        trail=[[1.0, 1.0]],
    )


@pytest.fixture
def neutralized_drone() -> DroneState:
    """A drone that has already been neutralized."""
    return DroneState(
        id="BOGEY-N",
        drone_type=DroneType.COMMERCIAL_QUAD,
        x=2.0,
        y=2.0,
        altitude=150,
        speed=0,
        heading=0,
        neutralized=True,
        trail=[[2.0, 2.0]],
    )


# ---------------------------------------------------------------------------
# Sensor fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def radar_sensor() -> SensorConfig:
    """L-Band MMR style 360-degree radar at base center."""
    return SensorConfig(
        id="RADAR-1",
        name="TPQ-51",
        type=SensorType.RADAR,
        range_km=10.0,
        x=0.0,
        y=0.0,
        fov_deg=360.0,
        facing_deg=0.0,
    )


@pytest.fixture
def rf_sensor() -> SensorConfig:
    """RF detection sensor at base center."""
    return SensorConfig(
        id="RF-1",
        name="RF Detector",
        type=SensorType.RF,
        range_km=8.0,
        x=0.0,
        y=0.0,
        fov_deg=360.0,
        facing_deg=0.0,
    )


@pytest.fixture
def eoir_sensor() -> SensorConfig:
    """EO/IR Camera sensor at base center."""
    return SensorConfig(
        id="EOIR-1",
        name="EO/IR Camera",
        type=SensorType.EOIR,
        range_km=8.0,
        x=0.0,
        y=0.0,
        fov_deg=45.0,
        facing_deg=45.0,
        requires_los=True,
    )


@pytest.fixture
def inactive_sensor() -> SensorConfig:
    """A sensor that is offline."""
    return SensorConfig(
        id="RADAR-OFF",
        name="Offline Radar",
        type=SensorType.RADAR,
        range_km=10.0,
        status="offline",
    )


# ---------------------------------------------------------------------------
# Scenario fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def lone_wolf_scenario() -> ScenarioConfig:
    """Simple single-drone hostile scenario."""
    return ScenarioConfig(
        id="lone_wolf",
        name="Lone Wolf",
        description="Single hostile commercial quad approaching the base.",
        difficulty="easy",
        duration_seconds=300,
        drones=[
            DroneStartConfig(
                id="DRONE-1",
                drone_type=DroneType.COMMERCIAL_QUAD,
                start_x=5.0,
                start_y=5.0,
                altitude=200,
                speed=30,
                heading=225,
                behavior="direct_approach",
            )
        ],
        engagement_zones=EngagementZones(
            detection_range_km=10.0,
            identification_range_km=5.0,
            engagement_range_km=5.0,
        ),
        sensors=[
            SensorConfig(
                id="RADAR-1",
                name="TPQ-51",
                type=SensorType.RADAR,
                range_km=10.0,
            ),
        ],
        effectors=[
            EffectorConfig(
                id="JAMMER-1",
                name="RF Jammer",
                type=EffectorType.RF_JAM,
                range_km=3.0,
            ),
        ],
        correct_classification=ThreatClassification.COMMERCIAL_QUAD,
        correct_affiliation=Affiliation.HOSTILE,
        optimal_effectors=["rf_jam"],
        acceptable_effectors=["rf_jam", "kinetic"],
        roe_violations=["kinetic_on_friendly"],
    )


@pytest.fixture
def multi_drone_scenario() -> ScenarioConfig:
    """Multi-drone scenario with a bird (non-threat) mixed in."""
    return ScenarioConfig(
        id="recon_probe",
        name="Recon Probe",
        description="Mixed threats including a bird.",
        difficulty="medium",
        duration_seconds=600,
        drones=[
            DroneStartConfig(
                id="DRONE-A",
                drone_type=DroneType.COMMERCIAL_QUAD,
                start_x=5.0,
                start_y=5.0,
                altitude=200,
                speed=30,
                heading=225,
                behavior="direct_approach",
                correct_classification="commercial_quad",
                correct_affiliation="hostile",
                optimal_effectors=["rf_jam"],
                acceptable_effectors=["rf_jam", "kinetic"],
                roe_violations=[],
                should_engage=True,
            ),
            DroneStartConfig(
                id="DRONE-B",
                drone_type=DroneType.BIRD,
                start_x=3.0,
                start_y=2.0,
                altitude=80,
                speed=15,
                heading=180,
                behavior="waypoint_path",
                waypoints=[[1.0, 1.0], [0.0, 0.0]],
                correct_classification="bird",
                correct_affiliation="neutral",
                optimal_effectors=[],
                acceptable_effectors=[],
                roe_violations=["kinetic", "rf_jam"],
                should_engage=False,
            ),
        ],
        engagement_zones=EngagementZones(
            detection_range_km=10.0,
            identification_range_km=5.0,
            engagement_range_km=5.0,
        ),
        sensors=[
            SensorConfig(
                id="RADAR-1",
                name="TPQ-51",
                type=SensorType.RADAR,
                range_km=10.0,
            ),
        ],
        effectors=[
            EffectorConfig(
                id="JAMMER-1",
                name="RF Jammer",
                type=EffectorType.RF_JAM,
                range_km=3.0,
            ),
        ],
        correct_classification=ThreatClassification.COMMERCIAL_QUAD,
        correct_affiliation=Affiliation.HOSTILE,
        optimal_effectors=["rf_jam"],
        acceptable_effectors=["rf_jam", "kinetic"],
        roe_violations=[],
    )


# ---------------------------------------------------------------------------
# Base template fixture (for placement scoring)
# ---------------------------------------------------------------------------

@pytest.fixture
def simple_base() -> BaseTemplate:
    """A simple base with 4 approach corridors, no terrain."""
    return BaseTemplate(
        id="test_base",
        name="Test Base",
        description="Minimal base for testing.",
        size="small",
        boundary=[[-2, -2], [2, -2], [2, 2], [-2, 2]],
        protected_assets=[
            ProtectedAsset(id="HQ", name="Headquarters", x=0.0, y=0.0, priority=1),
        ],
        terrain=[],
        approach_corridors=[
            ApproachCorridor(name="North", bearing_deg=0, width_deg=30),
            ApproachCorridor(name="East", bearing_deg=90, width_deg=30),
            ApproachCorridor(name="South", bearing_deg=180, width_deg=30),
            ApproachCorridor(name="West", bearing_deg=270, width_deg=30),
        ],
        max_sensors=4,
        max_effectors=4,
        placement_bounds_km=5.0,
    )


@pytest.fixture
def base_with_terrain() -> BaseTemplate:
    """A base with LOS-blocking terrain."""
    return BaseTemplate(
        id="terrain_base",
        name="Terrain Base",
        description="Base with a building that blocks LOS.",
        size="medium",
        boundary=[[-3, -3], [3, -3], [3, 3], [-3, 3]],
        protected_assets=[
            ProtectedAsset(id="HQ", name="Headquarters", x=0.0, y=0.0, priority=1),
        ],
        terrain=[
            TerrainFeature(
                id="BLDG-1",
                type="building",
                name="Hangar",
                polygon=[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]],
                blocks_los=True,
                height_m=10.0,
            ),
        ],
        approach_corridors=[
            ApproachCorridor(name="North", bearing_deg=0, width_deg=30),
            ApproachCorridor(name="East", bearing_deg=90, width_deg=30),
        ],
        max_sensors=4,
        max_effectors=4,
        placement_bounds_km=5.0,
    )
