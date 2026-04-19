"""Tests for NEXUS/Shenobi protocol-manipulation eligibility."""

from app.models import DroneState, DroneType
from app.nexus import is_nexus_vulnerable, pick_nexus_cm_effectiveness


class TestNexusEligibility:
    def test_fixed_wing_is_not_in_supported_library_even_when_rf_emitting(self):
        drone = DroneState(
            id="FW-1",
            drone_type=DroneType.FIXED_WING,
            x=3.0,
            y=0.0,
            altitude=300,
            speed=60,
            heading=180,
            rf_emitting=True,
            trail=[[3.0, 0.0]],
        )

        assert is_nexus_vulnerable(drone) is False

    def test_micro_remains_supported(self):
        drone = DroneState(
            id="MICRO-1",
            drone_type=DroneType.MICRO,
            x=2.0,
            y=1.0,
            altitude=120,
            speed=25,
            heading=90,
            rf_emitting=True,
            trail=[[2.0, 1.0]],
        )

        assert is_nexus_vulnerable(drone) is True
        assert pick_nexus_cm_effectiveness(drone, "nexus_hold") is True
