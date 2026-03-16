"""DTID scoring engine -- grades player performance after scenario ends."""

from __future__ import annotations

from app.models import (
    PlayerAction,
    ScenarioConfig,
    ScoreBreakdown,
)


def calculate_score(
    scenario: ScenarioConfig,
    actions: list[PlayerAction],
    detection_time: float,
    confirm_time: float | None,
    identify_time: float | None,
    engage_time: float | None,
    classification_given: str | None,
    affiliation_given: str | None,
    effector_used: str | None,
    drone_reached_base: bool,
    confidence_at_identify: float,
) -> ScoreBreakdown:
    details: dict[str, str] = {}

    # --- Detection Response (20%) ---
    # How quickly player confirmed track after auto-detection
    if confirm_time is not None and detection_time is not None:
        response_delay = confirm_time - detection_time
        if response_delay <= 5.0:
            detection_response_score = 100.0
            details["detection_response"] = f"Confirmed track within {response_delay:.1f}s of detection"
        elif response_delay <= 10.0:
            detection_response_score = 80.0
            details["detection_response"] = f"Confirmed track in {response_delay:.1f}s (slightly slow)"
        elif response_delay <= 20.0:
            detection_response_score = 50.0
            details["detection_response"] = f"Confirmed track in {response_delay:.1f}s (slow)"
        else:
            detection_response_score = 20.0
            details["detection_response"] = f"Confirmed track in {response_delay:.1f}s (very slow)"
    else:
        detection_response_score = 0.0
        details["detection_response"] = "Track was never confirmed"

    if drone_reached_base:
        detection_response_score = max(0, detection_response_score - 30)
        details["detection_response"] += " -- DRONE REACHED BASE"

    # --- Tracking (15%) ---
    # Did player let sensors build confidence before identifying? Penalize rushing.
    if identify_time is not None and confirm_time is not None:
        tracking_duration = identify_time - confirm_time
        if confidence_at_identify >= 0.7 and tracking_duration >= 3.0:
            tracking_score = 100.0
            details["tracking"] = "Good sensor correlation before identification"
        elif confidence_at_identify >= 0.5:
            tracking_score = 70.0
            details["tracking"] = "Adequate sensor data before identification"
        elif tracking_duration < 2.0:
            tracking_score = 30.0
            details["tracking"] = "Rushed identification without adequate sensor correlation"
        else:
            tracking_score = 50.0
            details["tracking"] = "Limited sensor confidence at time of identification"
    elif confirm_time is not None:
        tracking_score = 20.0
        details["tracking"] = "Track confirmed but never identified"
    else:
        tracking_score = 0.0
        details["tracking"] = "No tracking performed"

    # --- Identification (25%) ---
    # Correct classification AND correct affiliation
    correct_class = scenario.correct_classification.value
    correct_affil = scenario.correct_affiliation.value

    if classification_given is not None and affiliation_given is not None:
        class_correct = classification_given == correct_class
        affil_correct = affiliation_given == correct_affil

        if class_correct and affil_correct:
            identification_score = 100.0
            details["identification"] = f"Correctly identified as {classification_given}"
        elif class_correct:
            identification_score = 60.0
            details["identification"] = f"Correct classification but wrong affiliation ({affiliation_given})"
        elif affil_correct:
            identification_score = 40.0
            details["identification"] = f"Correct affiliation but wrong classification ({classification_given})"
        else:
            identification_score = 0.0
            details["identification"] = f"Misidentified as {classification_given}/{affiliation_given}"
    elif classification_given is not None:
        identification_score = 30.0
        details["identification"] = "Classified but affiliation not set"
    else:
        identification_score = 0.0
        details["identification"] = "Threat was not identified"

    # --- Defeat Method (25%) ---
    if effector_used is not None:
        if effector_used in scenario.optimal_effectors:
            defeat_score = 100.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was optimal response"
        elif effector_used in scenario.acceptable_effectors:
            defeat_score = 70.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was acceptable but not optimal"
        else:
            defeat_score = 30.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was a poor choice"
    else:
        if drone_reached_base:
            defeat_score = 0.0
            details["defeat"] = "No engagement -- base compromised"
        else:
            defeat_score = 10.0
            details["defeat"] = "No engagement attempted"

    # --- ROE Compliance (15%) ---
    engage_actions = [a for a in actions if a.action == "engage"]
    roe_violations_found = []
    for a in engage_actions:
        if a.effector and a.effector in scenario.roe_violations:
            roe_violations_found.append(a.effector)

    if not roe_violations_found:
        roe_score = 100.0
        details["roe"] = "All actions within ROE"
    else:
        roe_score = 0.0
        violated = ", ".join(roe_violations_found)
        details["roe"] = f"ROE violation: {violated}"

    # --- Total ---
    total = (
        detection_response_score * 0.20
        + tracking_score * 0.15
        + identification_score * 0.25
        + defeat_score * 0.25
        + roe_score * 0.15
    )

    grade = _total_to_grade(total)

    return ScoreBreakdown(
        detection_response_score=round(detection_response_score, 1),
        tracking_score=round(tracking_score, 1),
        identification_score=round(identification_score, 1),
        defeat_score=round(defeat_score, 1),
        roe_score=round(roe_score, 1),
        total_score=round(total, 1),
        grade=grade,
        details=details,
    )


def _total_to_grade(total: float) -> str:
    if total >= 95:
        return "S"
    if total >= 85:
        return "A"
    if total >= 70:
        return "B"
    if total >= 50:
        return "C"
    return "F"
