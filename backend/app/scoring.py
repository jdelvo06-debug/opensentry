"""DTID scoring engine -- grades player performance after scenario ends."""

from __future__ import annotations

import math

from app.models import (
    BaseTemplate,
    DroneStartConfig,
    PlacementConfig,
    PlayerAction,
    ScenarioConfig,
    ScoreBreakdown,
)


def _normalize_effector_for_scoring(effector: str | None) -> str | None:
    if not effector:
        return None

    lower = effector.lower()
    if lower == "rf_jam" or "rf_jammer" in lower or "jammer" in lower:
        return "electronic"
    if lower == "kinetic" or "jackal" in lower:
        return "kinetic"
    if lower == "de_laser" or "de_laser" in lower or "de-laser" in lower:
        return "de_laser"
    if lower == "de_hpm" or "de_hpm" in lower or "de-hpm" in lower or "hpm" in lower:
        return "de_hpm"
    if lower == "shenobi_pm" or "shenobi" in lower:
        return "shenobi_pm"
    return effector


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
    placement_config: PlacementConfig | None = None,
    base_template: BaseTemplate | None = None,
) -> ScoreBreakdown:
    """Score a single-drone scenario (backward compatible)."""
    return _score_single_drone(
        correct_class=scenario.correct_classification.value,
        correct_affil=scenario.correct_affiliation.value,
        optimal_effectors=scenario.optimal_effectors,
        acceptable_effectors=scenario.acceptable_effectors,
        roe_violations=scenario.roe_violations,
        actions=actions,
        detection_time=detection_time,
        confirm_time=confirm_time,
        identify_time=identify_time,
        engage_time=engage_time,
        classification_given=classification_given,
        affiliation_given=affiliation_given,
        effector_used=effector_used,
        drone_reached_base=drone_reached_base,
        confidence_at_identify=confidence_at_identify,
        placement_config=placement_config,
        base_template=base_template,
    )


def calculate_score_multi(
    scenario: ScenarioConfig,
    drone_configs: list[DroneStartConfig],
    actions: list[PlayerAction],
    detection_times: dict[str, float],
    confirm_times: dict[str, float],
    identify_times: dict[str, float],
    engage_times: dict[str, float],
    classifications_given: dict[str, str],
    affiliations_given: dict[str, str],
    effectors_used: dict[str, str],
    drones_reached_base: set[str],
    confidence_at_identify: dict[str, float],
    placement_config: PlacementConfig | None = None,
    base_template: BaseTemplate | None = None,
) -> ScoreBreakdown:
    """Score a multi-drone scenario. Each drone scored independently, then weighted average."""
    if len(drone_configs) <= 1:
        cfg = drone_configs[0] if drone_configs else None
        drone_id = cfg.id if cfg else ""
        return _score_single_drone(
            correct_class=(cfg.correct_classification or scenario.correct_classification.value) if cfg else scenario.correct_classification.value,
            correct_affil=(cfg.correct_affiliation or scenario.correct_affiliation.value) if cfg else scenario.correct_affiliation.value,
            optimal_effectors=cfg.optimal_effectors if cfg and cfg.optimal_effectors is not None else scenario.optimal_effectors,
            acceptable_effectors=cfg.acceptable_effectors if cfg and cfg.acceptable_effectors is not None else scenario.acceptable_effectors,
            roe_violations=cfg.roe_violations if cfg and cfg.roe_violations is not None else scenario.roe_violations,
            actions=[a for a in actions if a.target_id == drone_id],
            detection_time=detection_times.get(drone_id, 0.0),
            confirm_time=confirm_times.get(drone_id),
            identify_time=identify_times.get(drone_id),
            engage_time=engage_times.get(drone_id),
            classification_given=classifications_given.get(drone_id),
            affiliation_given=affiliations_given.get(drone_id),
            effector_used=effectors_used.get(drone_id),
            drone_reached_base=drone_id in drones_reached_base,
            confidence_at_identify=confidence_at_identify.get(drone_id, 0.0),
            placement_config=placement_config,
            base_template=base_template,
        )

    # Score each drone independently
    per_drone_scores: list[dict[str, float]] = []
    per_drone_details: list[dict[str, str]] = []

    for cfg in drone_configs:
        drone_id = cfg.id
        correct_class = cfg.correct_classification or scenario.correct_classification.value
        correct_affil = cfg.correct_affiliation or scenario.correct_affiliation.value
        optimal = cfg.optimal_effectors if cfg.optimal_effectors is not None else scenario.optimal_effectors
        acceptable = cfg.acceptable_effectors if cfg.acceptable_effectors is not None else scenario.acceptable_effectors
        roe = cfg.roe_violations if cfg.roe_violations is not None else scenario.roe_violations
        drone_actions = [a for a in actions if a.target_id == drone_id]

        scores, details = _score_drone_components(
            correct_class=correct_class,
            correct_affil=correct_affil,
            optimal_effectors=optimal,
            acceptable_effectors=acceptable,
            roe_violations=roe,
            should_engage=cfg.should_engage,
            actions=drone_actions,
            detection_time=detection_times.get(drone_id, 0.0),
            confirm_time=confirm_times.get(drone_id),
            identify_time=identify_times.get(drone_id),
            classification_given=classifications_given.get(drone_id),
            affiliation_given=affiliations_given.get(drone_id),
            effector_used=effectors_used.get(drone_id),
            drone_reached_base=drone_id in drones_reached_base,
            confidence_at_identify=confidence_at_identify.get(drone_id, 0.0),
        )
        per_drone_scores.append(scores)
        per_drone_details.append(details)

    # Weighted average across all drones
    n = len(per_drone_scores)
    avg_detection = sum(s["detection_response"] for s in per_drone_scores) / n
    avg_tracking = sum(s["tracking"] for s in per_drone_scores) / n
    avg_identification = sum(s["identification"] for s in per_drone_scores) / n
    avg_defeat = sum(s["defeat"] for s in per_drone_scores) / n
    avg_roe = sum(s["roe"] for s in per_drone_scores) / n

    total = (
        avg_detection * 0.20
        + avg_tracking * 0.15
        + avg_identification * 0.25
        + avg_defeat * 0.25
        + avg_roe * 0.15
    )

    # Build combined details
    details: dict[str, str] = {}
    for i, cfg in enumerate(drone_configs):
        d = per_drone_details[i]
        prefix = cfg.id.upper()
        for key, val in d.items():
            details[f"{prefix}_{key}"] = val
    details["summary"] = f"Scored {n} tracks (weighted average)"

    grade = _total_to_grade(total)

    # Placement scoring
    placement_score_val = None
    placement_details_val = None
    if placement_config is not None and base_template is not None:
        placement_score_val, placement_details_val = calculate_placement_score(
            placement_config, base_template
        )

    return ScoreBreakdown(
        detection_response_score=round(avg_detection, 1),
        tracking_score=round(avg_tracking, 1),
        identification_score=round(avg_identification, 1),
        defeat_score=round(avg_defeat, 1),
        roe_score=round(avg_roe, 1),
        total_score=round(total, 1),
        grade=grade,
        details=details,
        placement_score=placement_score_val,
        placement_details=placement_details_val,
    )


def _score_drone_components(
    correct_class: str,
    correct_affil: str,
    optimal_effectors: list[str],
    acceptable_effectors: list[str],
    roe_violations: list[str],
    should_engage: bool,
    actions: list[PlayerAction],
    detection_time: float,
    confirm_time: float | None,
    identify_time: float | None,
    classification_given: str | None,
    affiliation_given: str | None,
    effector_used: str | None,
    drone_reached_base: bool,
    confidence_at_identify: float,
) -> tuple[dict[str, float], dict[str, str]]:
    """Score individual components for a single drone."""
    scores: dict[str, float] = {}
    details: dict[str, str] = {}

    # --- Detection Response (20%) ---
    if confirm_time is not None and detection_time is not None:
        response_delay = confirm_time - detection_time
        if response_delay <= 5.0:
            scores["detection_response"] = 100.0
            details["detection_response"] = f"Confirmed within {response_delay:.1f}s"
        elif response_delay <= 10.0:
            scores["detection_response"] = 80.0
            details["detection_response"] = f"Confirmed in {response_delay:.1f}s (slightly slow)"
        elif response_delay <= 20.0:
            scores["detection_response"] = 50.0
            details["detection_response"] = f"Confirmed in {response_delay:.1f}s (slow)"
        else:
            scores["detection_response"] = 20.0
            details["detection_response"] = f"Confirmed in {response_delay:.1f}s (very slow)"
    else:
        scores["detection_response"] = 0.0
        details["detection_response"] = "Track was never confirmed"

    if drone_reached_base and should_engage:
        scores["detection_response"] = max(0, scores["detection_response"] - 30)
        details["detection_response"] += " -- DRONE REACHED BASE"

    # --- Tracking (15%) ---
    if identify_time is not None and confirm_time is not None:
        tracking_duration = identify_time - confirm_time
        if confidence_at_identify >= 0.7 and tracking_duration >= 3.0:
            scores["tracking"] = 100.0
            details["tracking"] = "Good sensor correlation before identification"
        elif confidence_at_identify >= 0.5:
            scores["tracking"] = 70.0
            details["tracking"] = "Adequate sensor data before identification"
        elif tracking_duration < 2.0:
            scores["tracking"] = 30.0
            details["tracking"] = "Rushed identification"
        else:
            scores["tracking"] = 50.0
            details["tracking"] = "Limited sensor confidence at identification"
    elif confirm_time is not None:
        scores["tracking"] = 20.0
        details["tracking"] = "Track confirmed but never identified"
    else:
        scores["tracking"] = 0.0
        details["tracking"] = "No tracking performed"

    # --- Identification (25%) ---
    if classification_given is not None and affiliation_given is not None:
        class_correct = classification_given == correct_class
        affil_correct = affiliation_given == correct_affil

        if class_correct and affil_correct:
            scores["identification"] = 100.0
            details["identification"] = f"Correctly identified as {classification_given}"
        elif class_correct:
            scores["identification"] = 60.0
            details["identification"] = f"Correct classification, wrong affiliation ({affiliation_given})"
        elif affil_correct:
            scores["identification"] = 40.0
            details["identification"] = f"Correct affiliation, wrong classification ({classification_given})"
        else:
            scores["identification"] = 0.0
            details["identification"] = f"Misidentified as {classification_given}/{affiliation_given}"
    elif classification_given is not None:
        scores["identification"] = 30.0
        details["identification"] = "Classified but affiliation not set"
    else:
        scores["identification"] = 0.0
        details["identification"] = "Threat was not identified"

    # --- Defeat Method (25%) ---
    if not should_engage:
        engage_actions = [a for a in actions if a.action == "engage"]
        if not engage_actions:
            scores["defeat"] = 100.0
            details["defeat"] = "Correctly did not engage (non-threat)"
        else:
            scores["defeat"] = 0.0
            details["defeat"] = "Engaged a non-threat target"
    elif effector_used is not None:
        if effector_used in optimal_effectors:
            scores["defeat"] = 100.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was optimal response"
        elif effector_used in acceptable_effectors:
            scores["defeat"] = 70.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was acceptable but not optimal"
        else:
            scores["defeat"] = 30.0
            effector_label = effector_used.replace("_", " ").title()
            details["defeat"] = f"{effector_label} was a poor choice"

        # Collateral risk modifier.
        # HPM gets the largest penalty because broad EM effects can impact friendly
        # systems in the beam path. Kinetic remains risky but more localized.
        # Laser and electronic are treated as lower-collateral options here.
        collateral_map = {"de_hpm": 15, "kinetic": 10, "de_laser": 0, "electronic": 0, "shenobi_pm": 5}
        collateral_penalty = collateral_map.get(effector_used, 0)
        if collateral_penalty > 0:
            scores["defeat"] = max(0, scores["defeat"] - collateral_penalty)
            details["defeat"] += f" (collateral risk: -{collateral_penalty})"
    else:
        if drone_reached_base:
            scores["defeat"] = 0.0
            details["defeat"] = "No engagement -- base compromised"
        else:
            scores["defeat"] = 10.0
            details["defeat"] = "No engagement attempted"

    # --- ROE Compliance (15%) ---
    engage_actions = [a for a in actions if a.action == "engage"]
    roe_violations_found = []
    for a in engage_actions:
        normalized_effector = _normalize_effector_for_scoring(a.effector)
        if normalized_effector and normalized_effector in roe_violations:
            roe_violations_found.append(normalized_effector)
    if not should_engage and engage_actions:
        roe_violations_found.append("engaged_non_threat")

    if not roe_violations_found:
        scores["roe"] = 100.0
        details["roe"] = "All actions within ROE"
    else:
        scores["roe"] = 0.0
        violated = ", ".join(roe_violations_found)
        details["roe"] = f"ROE violation: {violated}"

    return scores, details


def _score_single_drone(
    correct_class: str,
    correct_affil: str,
    optimal_effectors: list[str],
    acceptable_effectors: list[str],
    roe_violations: list[str],
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
    placement_config: PlacementConfig | None = None,
    base_template: BaseTemplate | None = None,
) -> ScoreBreakdown:
    """Score a single-drone scenario."""
    scores, details = _score_drone_components(
        correct_class=correct_class,
        correct_affil=correct_affil,
        optimal_effectors=optimal_effectors,
        acceptable_effectors=acceptable_effectors,
        roe_violations=roe_violations,
        should_engage=correct_affil == "hostile",
        actions=actions,
        detection_time=detection_time,
        confirm_time=confirm_time,
        identify_time=identify_time,
        classification_given=classification_given,
        affiliation_given=affiliation_given,
        effector_used=effector_used,
        drone_reached_base=drone_reached_base,
        confidence_at_identify=confidence_at_identify,
    )

    total = (
        scores["detection_response"] * 0.20
        + scores["tracking"] * 0.15
        + scores["identification"] * 0.25
        + scores["defeat"] * 0.25
        + scores["roe"] * 0.15
    )

    grade = _total_to_grade(total)

    placement_score_val = None
    placement_details_val = None
    if placement_config is not None and base_template is not None:
        placement_score_val, placement_details_val = calculate_placement_score(
            placement_config, base_template
        )

    return ScoreBreakdown(
        detection_response_score=round(scores["detection_response"], 1),
        tracking_score=round(scores["tracking"], 1),
        identification_score=round(scores["identification"], 1),
        defeat_score=round(scores["defeat"], 1),
        roe_score=round(scores["roe"], 1),
        total_score=round(total, 1),
        grade=grade,
        details=details,
        placement_score=placement_score_val,
        placement_details=placement_details_val,
    )


def calculate_placement_score(
    placement: PlacementConfig,
    base: BaseTemplate,
) -> tuple[float, dict[str, str]]:
    """Score the player's sensor/effector placement quality."""
    details: dict[str, str] = {}
    from app.bases import load_equipment_catalog

    catalog = load_equipment_catalog()
    sensor_catalog = {s.catalog_id: s for s in catalog.sensors}
    effector_catalog = {e.catalog_id: e for e in catalog.effectors}

    # 1. Coverage completeness (40%)
    total_corridors = len(base.approach_corridors)
    covered_corridors = 0
    for corridor in base.approach_corridors:
        bearing_rad = math.radians(corridor.bearing_deg)
        sample_x = 3.0 * math.sin(bearing_rad)
        sample_y = 3.0 * math.cos(bearing_rad)

        for placed in placement.sensors:
            cat = sensor_catalog.get(placed.catalog_id)
            if cat is None:
                continue
            dist = math.sqrt((sample_x - placed.x) ** 2 + (sample_y - placed.y) ** 2)
            if dist <= cat.range_km:
                covered_corridors += 1
                break

    coverage_pct = covered_corridors / max(1, total_corridors)
    coverage_score = coverage_pct * 100
    details["coverage"] = f"{covered_corridors}/{total_corridors} approach corridors covered"

    # 2. Sensor overlap quality (25%)
    overlap_corridors = 0
    for corridor in base.approach_corridors:
        bearing_rad = math.radians(corridor.bearing_deg)
        sample_x = 2.0 * math.sin(bearing_rad)
        sample_y = 2.0 * math.cos(bearing_rad)

        sensor_count = 0
        for placed in placement.sensors:
            cat = sensor_catalog.get(placed.catalog_id)
            if cat is None:
                continue
            dist = math.sqrt((sample_x - placed.x) ** 2 + (sample_y - placed.y) ** 2)
            if dist <= cat.range_km:
                sensor_count += 1
        if sensor_count >= 2:
            overlap_corridors += 1

    overlap_pct = overlap_corridors / max(1, total_corridors)
    overlap_score = overlap_pct * 100
    details["overlap"] = f"{overlap_corridors}/{total_corridors} corridors with multi-sensor coverage"

    # 3. Effector positioning (25%)
    corridors_with_effector = 0
    for corridor in base.approach_corridors:
        bearing_rad = math.radians(corridor.bearing_deg)
        sample_x = 1.5 * math.sin(bearing_rad)
        sample_y = 1.5 * math.cos(bearing_rad)

        for placed in placement.effectors:
            cat = effector_catalog.get(placed.catalog_id)
            if cat is None:
                continue
            dist = math.sqrt((sample_x - placed.x) ** 2 + (sample_y - placed.y) ** 2)
            if dist <= cat.range_km:
                corridors_with_effector += 1
                break

    eff_pct = corridors_with_effector / max(1, total_corridors)
    effector_score = eff_pct * 100
    details["effector_reach"] = f"{corridors_with_effector}/{total_corridors} corridors within effector range"

    # 4. LOS management (10%)
    los_sensors = [p for p in placement.sensors if sensor_catalog.get(p.catalog_id, None) and sensor_catalog[p.catalog_id].requires_los]
    if los_sensors:
        unblocked = 0
        checks = 0
        for placed in los_sensors:
            for corridor in base.approach_corridors:
                checks += 1
                bearing_rad = math.radians(corridor.bearing_deg)
                sample_x = 1.5 * math.sin(bearing_rad)
                sample_y = 1.5 * math.cos(bearing_rad)
                blocked = False
                for terrain in base.terrain:
                    if not terrain.blocks_los:
                        continue
                    poly = terrain.polygon
                    n = len(poly)
                    for i in range(n):
                        px1, py1 = poly[i]
                        px2, py2 = poly[(i + 1) % n]
                        from app.detection import _segments_intersect
                        if _segments_intersect(placed.x, placed.y, sample_x, sample_y, px1, py1, px2, py2):
                            blocked = True
                            break
                    if blocked:
                        break
                if not blocked:
                    unblocked += 1

        los_pct = unblocked / max(1, checks)
        los_score = los_pct * 100
        details["los"] = f"{round(los_pct * 100)}% of LOS sensor sightlines unblocked"
    else:
        los_score = 100.0
        details["los"] = "No LOS-dependent sensors placed"

    # Weighted total
    total = (
        coverage_score * 0.40
        + overlap_score * 0.25
        + effector_score * 0.25
        + los_score * 0.10
    )

    return round(total, 1), details


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
