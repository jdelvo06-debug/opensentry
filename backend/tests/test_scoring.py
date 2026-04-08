"""Tests for the DTID scoring engine."""

import pytest

from app.models import PlayerAction, PlacedEquipment, PlacementConfig
from app.scoring import (
    _score_drone_components,
    _total_to_grade,
    calculate_score,
    calculate_score_multi,
    calculate_placement_score,
)


# ===== Grade thresholds =====


class TestGrading:
    """Test the total-score-to-letter-grade mapping."""

    def test_grade_s(self):
        assert _total_to_grade(95) == "S"
        assert _total_to_grade(100) == "S"

    def test_grade_a(self):
        assert _total_to_grade(85) == "A"
        assert _total_to_grade(94.9) == "A"

    def test_grade_b(self):
        assert _total_to_grade(70) == "B"
        assert _total_to_grade(84.9) == "B"

    def test_grade_c(self):
        assert _total_to_grade(50) == "C"
        assert _total_to_grade(69.9) == "C"

    def test_grade_f(self):
        assert _total_to_grade(49.9) == "F"
        assert _total_to_grade(0) == "F"


# ===== Detection Response scoring =====


class TestDetectionResponse:
    """Test the detection_response component (20% weight)."""

    def _score(self, detection_time=0.0, confirm_time=None, drone_reached_base=False, **kw):
        """Helper: score only detection_response component."""
        scores, details = _score_drone_components(
            correct_class="commercial_quad",
            correct_affil="hostile",
            optimal_effectors=["rf_jam"],
            acceptable_effectors=["rf_jam", "kinetic"],
            roe_violations=[],
            should_engage=True,
            actions=[],
            detection_time=detection_time,
            confirm_time=confirm_time,
            identify_time=kw.get("identify_time"),
            classification_given=kw.get("classification_given"),
            affiliation_given=kw.get("affiliation_given"),
            effector_used=kw.get("effector_used"),
            drone_reached_base=drone_reached_base,
            confidence_at_identify=kw.get("confidence_at_identify", 0.0),
        )
        return scores["detection_response"], details["detection_response"]

    def test_fast_confirm_gets_100(self):
        score, detail = self._score(detection_time=10.0, confirm_time=13.0)
        assert score == 100.0
        assert "3.0s" in detail

    def test_medium_confirm_gets_80(self):
        score, _ = self._score(detection_time=10.0, confirm_time=18.0)
        assert score == 80.0

    def test_slow_confirm_gets_50(self):
        score, _ = self._score(detection_time=10.0, confirm_time=25.0)
        assert score == 50.0

    def test_very_slow_confirm_gets_20(self):
        score, _ = self._score(detection_time=10.0, confirm_time=35.0)
        assert score == 20.0

    def test_never_confirmed_gets_0(self):
        score, detail = self._score(detection_time=10.0, confirm_time=None)
        assert score == 0.0
        assert "never confirmed" in detail.lower()

    def test_drone_reached_base_penalty(self):
        score, detail = self._score(
            detection_time=10.0, confirm_time=13.0, drone_reached_base=True
        )
        # 100 - 30 = 70
        assert score == 70.0
        assert "DRONE REACHED BASE" in detail


# ===== Tracking scoring =====


class TestTracking:
    """Test the tracking component (15% weight)."""

    def _score(self, confirm_time=None, identify_time=None, confidence=0.0):
        scores, details = _score_drone_components(
            correct_class="commercial_quad",
            correct_affil="hostile",
            optimal_effectors=["rf_jam"],
            acceptable_effectors=["rf_jam"],
            roe_violations=[],
            should_engage=True,
            actions=[],
            detection_time=0.0,
            confirm_time=confirm_time,
            identify_time=identify_time,
            classification_given="commercial_quad",
            affiliation_given="hostile",
            effector_used="rf_jam",
            drone_reached_base=False,
            confidence_at_identify=confidence,
        )
        return scores["tracking"], details["tracking"]

    def test_good_tracking_high_confidence(self):
        # 5s tracking with 0.8 confidence -> 100
        score, _ = self._score(confirm_time=10.0, identify_time=15.0, confidence=0.8)
        assert score == 100.0

    def test_adequate_tracking(self):
        # medium confidence
        score, _ = self._score(confirm_time=10.0, identify_time=15.0, confidence=0.6)
        assert score == 70.0

    def test_rushed_identification(self):
        # less than 2s between confirm and identify
        score, detail = self._score(confirm_time=10.0, identify_time=11.0, confidence=0.3)
        assert score == 30.0
        assert "rushed" in detail.lower()

    def test_confirmed_but_never_identified(self):
        score, _ = self._score(confirm_time=10.0, identify_time=None, confidence=0.0)
        assert score == 20.0

    def test_no_tracking_at_all(self):
        score, _ = self._score(confirm_time=None, identify_time=None, confidence=0.0)
        assert score == 0.0


# ===== Identification scoring =====


class TestIdentification:
    """Test the identification component (25% weight)."""

    def _score(self, classification_given=None, affiliation_given=None):
        scores, _ = _score_drone_components(
            correct_class="commercial_quad",
            correct_affil="hostile",
            optimal_effectors=["rf_jam"],
            acceptable_effectors=["rf_jam"],
            roe_violations=[],
            should_engage=True,
            actions=[],
            detection_time=0.0,
            confirm_time=5.0,
            identify_time=10.0,
            classification_given=classification_given,
            affiliation_given=affiliation_given,
            effector_used="rf_jam",
            drone_reached_base=False,
            confidence_at_identify=0.8,
        )
        return scores["identification"]

    def test_correct_classification_and_affiliation(self):
        assert self._score("commercial_quad", "hostile") == 100.0

    def test_correct_class_wrong_affiliation(self):
        assert self._score("commercial_quad", "friendly") == 60.0

    def test_wrong_class_correct_affiliation(self):
        assert self._score("fixed_wing", "hostile") == 40.0

    def test_both_wrong(self):
        assert self._score("bird", "neutral") == 0.0

    def test_classification_only_no_affiliation(self):
        assert self._score("commercial_quad", None) == 30.0

    def test_nothing_identified(self):
        assert self._score(None, None) == 0.0


# ===== Defeat Method scoring =====


class TestDefeatMethod:
    """Test the defeat component (25% weight)."""

    def _score(self, effector_used=None, should_engage=True, actions=None, drone_reached_base=False):
        scores, _ = _score_drone_components(
            correct_class="commercial_quad",
            correct_affil="hostile",
            optimal_effectors=["rf_jam"],
            acceptable_effectors=["rf_jam", "kinetic"],
            roe_violations=[],
            should_engage=should_engage,
            actions=actions or [],
            detection_time=0.0,
            confirm_time=5.0,
            identify_time=10.0,
            classification_given="commercial_quad",
            affiliation_given="hostile",
            effector_used=effector_used,
            drone_reached_base=drone_reached_base,
            confidence_at_identify=0.8,
        )
        return scores["defeat"]

    def test_optimal_effector(self):
        assert self._score("rf_jam") == 100.0

    def test_acceptable_effector(self):
        assert self._score("kinetic") == 70.0

    def test_poor_effector_choice(self):
        assert self._score("directed_energy") == 30.0

    def test_no_engagement_base_compromised(self):
        assert self._score(None, drone_reached_base=True) == 0.0

    def test_no_engagement_drone_still_out(self):
        assert self._score(None) == 10.0

    def test_non_threat_not_engaged_is_perfect(self):
        assert self._score(None, should_engage=False) == 100.0

    def test_non_threat_engaged_is_zero(self):
        actions = [PlayerAction(action="engage", target_id="X", effector="kinetic", timestamp=15.0)]
        assert self._score(None, should_engage=False, actions=actions) == 0.0


# ===== ROE Compliance scoring =====


class TestROECompliance:
    """Test the ROE component (15% weight)."""

    def _score(self, actions, roe_violations=None, should_engage=True):
        scores, details = _score_drone_components(
            correct_class="commercial_quad",
            correct_affil="hostile",
            optimal_effectors=["rf_jam"],
            acceptable_effectors=["rf_jam"],
            roe_violations=roe_violations or [],
            should_engage=should_engage,
            actions=actions,
            detection_time=0.0,
            confirm_time=5.0,
            identify_time=10.0,
            classification_given="commercial_quad",
            affiliation_given="hostile",
            effector_used="rf_jam",
            drone_reached_base=False,
            confidence_at_identify=0.8,
        )
        return scores["roe"], details["roe"]

    def test_no_violations(self):
        actions = [PlayerAction(action="engage", target_id="X", effector="rf_jam", timestamp=15.0)]
        score, detail = self._score(actions)
        assert score == 100.0
        assert "within roe" in detail.lower()

    def test_roe_violation_effector(self):
        actions = [PlayerAction(action="engage", target_id="X", effector="kinetic", timestamp=15.0)]
        score, detail = self._score(actions, roe_violations=["kinetic"])
        assert score == 0.0
        assert "kinetic" in detail.lower()

    def test_engaging_non_threat_is_violation(self):
        actions = [PlayerAction(action="engage", target_id="X", effector="rf_jam", timestamp=15.0)]
        score, detail = self._score(actions, should_engage=False)
        assert score == 0.0
        assert "engaged_non_threat" in detail.lower()

    def test_no_engage_actions_is_clean(self):
        actions = [PlayerAction(action="confirm", target_id="X", timestamp=5.0)]
        score, _ = self._score(actions)
        assert score == 100.0


# ===== Full single-drone scoring (calculate_score) =====


class TestCalculateScore:
    """Test the full single-drone scoring pipeline."""

    def test_perfect_run(self, lone_wolf_scenario):
        result = calculate_score(
            scenario=lone_wolf_scenario,
            actions=[
                PlayerAction(action="confirm", target_id="DRONE-1", timestamp=3.0),
                PlayerAction(action="identify", target_id="DRONE-1", timestamp=10.0),
                PlayerAction(action="engage", target_id="DRONE-1", effector="rf_jam", timestamp=12.0),
            ],
            detection_time=1.0,
            confirm_time=3.0,
            identify_time=10.0,
            engage_time=12.0,
            classification_given="commercial_quad",
            affiliation_given="hostile",
            effector_used="rf_jam",
            drone_reached_base=False,
            confidence_at_identify=0.85,
        )
        assert result.grade in ("S", "A")
        assert result.total_score >= 85.0
        assert result.detection_response_score == 100.0
        assert result.identification_score == 100.0
        assert result.defeat_score == 100.0
        assert result.roe_score == 100.0

    def test_total_failure(self, lone_wolf_scenario):
        result = calculate_score(
            scenario=lone_wolf_scenario,
            actions=[],
            detection_time=0.0,
            confirm_time=None,
            identify_time=None,
            engage_time=None,
            classification_given=None,
            affiliation_given=None,
            effector_used=None,
            drone_reached_base=True,
            confidence_at_identify=0.0,
        )
        assert result.grade == "F"
        assert result.total_score < 20.0

    def test_weighted_total_is_correct(self, lone_wolf_scenario):
        result = calculate_score(
            scenario=lone_wolf_scenario,
            actions=[
                PlayerAction(action="confirm", target_id="DRONE-1", timestamp=3.0),
                PlayerAction(action="identify", target_id="DRONE-1", timestamp=10.0),
                PlayerAction(action="engage", target_id="DRONE-1", effector="rf_jam", timestamp=12.0),
            ],
            detection_time=1.0,
            confirm_time=3.0,
            identify_time=10.0,
            engage_time=12.0,
            classification_given="commercial_quad",
            affiliation_given="hostile",
            effector_used="rf_jam",
            drone_reached_base=False,
            confidence_at_identify=0.85,
        )
        # Verify weighted formula: 20% detect + 15% track + 25% id + 25% defeat + 15% roe
        expected = (
            result.detection_response_score * 0.20
            + result.tracking_score * 0.15
            + result.identification_score * 0.25
            + result.defeat_score * 0.25
            + result.roe_score * 0.15
        )
        assert abs(result.total_score - round(expected, 1)) < 0.2


# ===== Multi-drone scoring =====


class TestCalculateScoreMulti:
    """Test multi-drone scoring with weighted averaging."""

    def test_multi_drone_averaging(self, multi_drone_scenario):
        drone_configs = multi_drone_scenario.drones
        result = calculate_score_multi(
            scenario=multi_drone_scenario,
            drone_configs=drone_configs,
            actions=[
                PlayerAction(action="confirm", target_id="DRONE-A", timestamp=3.0),
                PlayerAction(action="identify", target_id="DRONE-A", timestamp=10.0),
                PlayerAction(action="engage", target_id="DRONE-A", effector="rf_jam", timestamp=12.0),
                PlayerAction(action="confirm", target_id="DRONE-B", timestamp=4.0),
                PlayerAction(action="identify", target_id="DRONE-B", timestamp=11.0),
            ],
            detection_times={"DRONE-A": 1.0, "DRONE-B": 2.0},
            confirm_times={"DRONE-A": 3.0, "DRONE-B": 4.0},
            identify_times={"DRONE-A": 10.0, "DRONE-B": 11.0},
            engage_times={"DRONE-A": 12.0},
            classifications_given={"DRONE-A": "commercial_quad", "DRONE-B": "bird"},
            affiliations_given={"DRONE-A": "hostile", "DRONE-B": "neutral"},
            effectors_used={"DRONE-A": "rf_jam"},
            drones_reached_base=set(),
            confidence_at_identify={"DRONE-A": 0.85, "DRONE-B": 0.75},
        )
        assert result.grade in ("S", "A", "B")
        assert result.total_score > 50.0
        # Details should contain per-drone entries
        assert "DRONE-A" in str(result.details) or "summary" in result.details

    def test_single_drone_falls_through(self, multi_drone_scenario):
        """When only 1 drone config, should use single-drone path."""
        one_config = [multi_drone_scenario.drones[0]]
        result = calculate_score_multi(
            scenario=multi_drone_scenario,
            drone_configs=one_config,
            actions=[],
            detection_times={"DRONE-A": 1.0},
            confirm_times={},
            identify_times={},
            engage_times={},
            classifications_given={},
            affiliations_given={},
            effectors_used={},
            drones_reached_base=set(),
            confidence_at_identify={},
        )
        assert result.grade == "F"
