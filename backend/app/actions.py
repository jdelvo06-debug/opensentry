"""Player action handlers — process confirm, identify, engage, hold_fire,
release_hold_fire, and end_mission actions.

Each handler mutates ``GameState`` in place and returns a list of messages
(event / engagement_result dicts) to send to the client.
"""

from __future__ import annotations

import math
import random
from typing import TYPE_CHECKING

from app.helpers import (
    check_effector_in_range,
    check_kurz_fcs_tracking,
    check_shinobi_rf_tracking,
    effector_effectiveness,
    find_effector_config,
)
from app.jamming import apply_pnt_jamming, pick_jam_behavior
from app.shinobi import is_shinobi_vulnerable, pick_shinobi_cm_effectiveness, DRONE_FREQUENCY_MAP
from app.models import (
    Affiliation,
    DroneState,
    DroneType,
    DTIDPhase,
    GamePhase,
    PlayerAction,
    ThreatClassification,
)

if TYPE_CHECKING:
    from app.game_state import GameState


# ---------------------------------------------------------------------------
# Public API — one function per action
# ---------------------------------------------------------------------------


def handle_confirm_track(gs: GameState, target_id: str, elapsed: float) -> list[dict]:
    """Promote a DETECTED track to TRACKED."""
    msgs: list[dict] = []
    for j, d in enumerate(gs.drones):
        if d.id == target_id and d.dtid_phase == DTIDPhase.DETECTED:
            gs.drones[j] = d.model_copy(update={"dtid_phase": DTIDPhase.TRACKED})
            gs.confirm_times[target_id] = elapsed
            gs.actions.append(PlayerAction(
                action="confirm_track", target_id=target_id, timestamp=elapsed,
            ))
            msgs.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"OPERATOR: Track {target_id.upper()} confirmed",
            })
    return msgs


def handle_identify(
    gs: GameState,
    target_id: str,
    classification: str | None,
    affiliation_str: str,
    elapsed: float,
) -> list[dict]:
    """Classify and set affiliation for a TRACKED drone."""
    msgs: list[dict] = []
    for j, d in enumerate(gs.drones):
        if d.id == target_id and d.dtid_phase == DTIDPhase.TRACKED:
            new_affil = Affiliation(affiliation_str)
            try:
                cls_enum = ThreatClassification(classification)
            except (ValueError, KeyError):
                cls_enum = classification
            gs.drones[j] = d.model_copy(update={
                "dtid_phase": DTIDPhase.IDENTIFIED,
                "classification": cls_enum,
                "classified": True,
                "affiliation": new_affil,
            })
            gs.identify_times[target_id] = elapsed
            gs.classification_given[target_id] = classification
            gs.affiliation_given[target_id] = affiliation_str
            gs.confidence_at_identify[target_id] = d.confidence
            gs.actions.append(PlayerAction(
                action="identify", target_id=target_id,
                classification=classification, affiliation=affiliation_str,
                timestamp=elapsed,
            ))
            msgs.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": (
                    f"OPERATOR: {target_id.upper()} identified as "
                    f"{classification} ({affiliation_str})"
                ),
            })
    return msgs


def handle_hold_fire(gs: GameState, target_id: str, elapsed: float) -> list[dict]:
    """Activate hold-fire on *target_id*, self-destructing any active JACKALs
    aimed at it."""
    msgs: list[dict] = []
    for j, d in enumerate(gs.drones):
        if d.id == target_id:
            gs.hold_fire_tracks.add(target_id)
            gs.actions.append(PlayerAction(
                action="hold_fire", target_id=target_id, timestamp=elapsed,
            ))
            msgs.append({
                "type": "event",
                "timestamp": round(elapsed, 1),
                "message": f"OPERATOR: HOLD FIRE on {target_id.upper()}",
            })
            # Self-destruct JACKALs targeting this track
            for ci, cd in enumerate(gs.drones):
                if (cd.is_interceptor and not cd.neutralized
                        and cd.interceptor_target == target_id
                        and cd.intercept_phase != "self_destruct"):
                    gs.drones[ci] = cd.model_copy(update={
                        "intercept_phase": "self_destruct",
                    })
                    msgs.append({
                        "type": "event",
                        "timestamp": round(elapsed, 1),
                        "message": f"HOLD FIRE \u2014 {cd.id.upper()} ENTERING SELF-DESTRUCT",
                    })
            break
    return msgs


def handle_release_hold_fire(
    gs: GameState, target_id: str, elapsed: float,
) -> list[dict]:
    """Release hold-fire on *target_id*."""
    msgs: list[dict] = []
    if target_id in gs.hold_fire_tracks:
        gs.hold_fire_tracks.discard(target_id)
        gs.actions.append(PlayerAction(
            action="release_hold_fire", target_id=target_id, timestamp=elapsed,
        ))
        msgs.append({
            "type": "event",
            "timestamp": round(elapsed, 1),
            "message": f"OPERATOR: Hold fire RELEASED on {target_id.upper()}",
        })
    return msgs


def handle_engage(
    gs: GameState,
    target_id: str,
    effector_id: str,
    elapsed: float,
    shinobi_cm: str | None = None,
) -> list[dict]:
    """Attempt to engage *target_id* with *effector_id*.

    For SHINOBI Protocol Manipulation, *shinobi_cm* specifies the countermeasure
    type: ``"shinobi_hold"``, ``"shinobi_land_now"``, or ``"shinobi_deafen"``.

    Returns a list of event / engagement_result messages.
    """
    msgs: list[dict] = []

    # Hold fire check
    if target_id in gs.hold_fire_tracks:
        msgs.append(_event(elapsed,
            f"ENGAGEMENT: BLOCKED — Hold fire active on {target_id.upper()}"))
        return msgs

    eff_state = find_effector_config(gs.effector_states, effector_id)
    if not eff_state or eff_state["status"] != "ready":
        return msgs

    # Ammo check
    if (eff_state.get("ammo_remaining") is not None
            and eff_state["ammo_remaining"] <= 0):
        msgs.append(_event(elapsed,
            f"ENGAGEMENT: {eff_state['name']} — DEPLETED (no ammo remaining)"))
        return msgs

    for j, d in enumerate(gs.drones):
        if d.id != target_id:
            continue

        # Block engaging friendly interceptors
        if d.is_interceptor:
            msgs.append(_event(elapsed,
                f"ENGAGEMENT: BLOCKED — {d.id.upper()} is a friendly interceptor"))
            break

        is_jammer = eff_state["type"] in ("rf_jam", "electronic")
        is_shinobi = eff_state["type"] == "shinobi_pm"

        # Range check (jammers can activate regardless; SHINOBI checked separately)
        if not is_jammer and not is_shinobi and not check_effector_in_range(eff_state, d):
            msgs.append(_event(elapsed,
                f"ENGAGEMENT: {eff_state['name']} — Target out of range"))
            break

        # JACKAL requires Ku-Band FCS
        if (eff_state.get("ammo_count") is not None
                and eff_state["type"] == "kinetic"):
            if not check_kurz_fcs_tracking(gs.sensor_configs, d):
                msgs.append(_event(elapsed,
                    "ENGAGEMENT: NO Ku-FC TRACK \u2014 CANNOT GUIDE INTERCEPTOR"))
                break

        effectiveness = effector_effectiveness(
            eff_state["type"], d.drone_type.value
        )

        # --- SHINOBI Protocol Manipulation path ---
        if is_shinobi:
            cm_type = shinobi_cm or "shinobi_hold"
            msgs += _engage_shinobi(gs, j, d, eff_state, effector_id,
                                    target_id, cm_type, effectiveness, elapsed)
        # --- EW Jammer path ---
        elif is_jammer:
            msgs += _engage_jammer(gs, j, d, eff_state, effector_id,
                                   target_id, effectiveness, elapsed)
        # --- JACKAL pallet path ---
        elif (eff_state.get("ammo_count") is not None
              and eff_state["type"] == "kinetic"):
            msgs += _engage_jackal(gs, d, eff_state, effector_id,
                                   target_id, elapsed)
        # --- Direct-effect path (directed energy, etc.) ---
        else:
            msgs += _engage_direct(gs, j, d, eff_state, effector_id,
                                   target_id, effectiveness, elapsed)

        # Handle effector status (recharge / ammo)
        _update_effector_status(eff_state)
        break

    return msgs


def handle_jammer_toggle(
    gs: GameState,
    effector_id: str,
    elapsed: float,
) -> list[dict]:
    """Toggle a jammer effector between active and inactive."""
    msgs: list[dict] = []
    for eff_state in gs.effector_states:
        if eff_state["id"] != effector_id:
            continue
        if eff_state.get("type") not in ("rf_jam", "electronic"):
            msgs.append(_event(elapsed,
                f"JAMMER: {eff_state['name']} is not a jammer effector"))
            break
        currently_active = eff_state.get("jammer_active", False)
        eff_state["jammer_active"] = not currently_active
        if eff_state["jammer_active"]:
            msgs.append(_event(elapsed,
                f"RF JAMMER: {eff_state['name']} ACTIVATED — area suppression active"))
        else:
            msgs.append(_event(elapsed,
                f"RF JAMMER: {eff_state['name']} DEACTIVATED"))
        break
    return msgs


def handle_jam_all(gs: GameState, elapsed: float) -> list[dict]:
    """Activate all jammer effectors at once."""
    msgs: list[dict] = []
    activated = 0
    for eff_state in gs.effector_states:
        if eff_state.get("type") in ("rf_jam", "electronic"):
            if not eff_state.get("jammer_active", False):
                eff_state["jammer_active"] = True
                activated += 1
    if activated > 0:
        msgs.append(_event(elapsed, "RF JAMMERS: ALL SYSTEMS ACTIVE"))
    else:
        msgs.append(_event(elapsed, "RF JAMMERS: All systems already active"))
    return msgs


def handle_cease_jam(gs: GameState, elapsed: float) -> list[dict]:
    """Deactivate all jammer effectors at once."""
    msgs: list[dict] = []
    deactivated = 0
    for eff_state in gs.effector_states:
        if eff_state.get("type") in ("rf_jam", "electronic"):
            if eff_state.get("jammer_active", False):
                eff_state["jammer_active"] = False
                deactivated += 1
    if deactivated > 0:
        msgs.append(_event(elapsed, "RF JAMMERS: ALL SYSTEMS OFFLINE"))
    else:
        msgs.append(_event(elapsed, "RF JAMMERS: No active systems to cease"))
    return msgs


_ATC_CLEARABLE = {DroneType.PASSENGER_AIRCRAFT, DroneType.MILITARY_JET}

def handle_clear_airspace(gs: GameState, elapsed: float) -> list[dict]:
    """Reroute friendly aircraft away from base airspace. Birds and balloons are unaffected."""
    import math as _math
    msgs: list[dict] = []
    rerouted = 0
    for i, drone in enumerate(gs.drones):
        if not (drone.is_ambient and drone.drone_type in _ATC_CLEARABLE):
            continue
        # Redirect drone to exit the area — point it away from base at high speed
        angle = _math.atan2(drone.y, drone.x)  # bearing from base to drone
        # Waypoint 12km out in the same direction — exits the radar picture quickly
        exit_x = round(12.0 * _math.cos(angle), 2)
        exit_y = round(12.0 * _math.sin(angle), 2)
        heading = _math.degrees(angle) % 360
        cfg = gs.drone_configs.get(drone.id)
        if cfg:
            gs.drone_configs[drone.id] = cfg.model_copy(update={
                "waypoints": [[exit_x, exit_y]],
                "behavior": "waypoint_path",
            })
        gs.behaviors[drone.id] = "waypoint_path"
        gs.drones[i] = drone.model_copy(update={"heading": heading})
        rerouted += 1
    gs.ambient_suppressed_until = elapsed + 120.0
    msgs.append(_event(elapsed,
        f"AIRSPACE: CLEARED \u2014 ATC notified, {rerouted} aircraft rerouting away from base"))
    return msgs


def handle_pause_mission(gs: GameState, elapsed: float) -> list[dict]:
    """Pause the game — freeze all simulation updates."""
    if gs.paused:
        return []
    gs.paused = True
    import time
    gs.pause_start_time = time.time()
    return [_event(elapsed, "MISSION PAUSED")]


def handle_resume_mission(gs: GameState, elapsed: float) -> list[dict]:
    """Resume the game from pause."""
    if not gs.paused:
        return []
    import time
    paused_duration = time.time() - gs.pause_start_time
    gs.total_paused_seconds += paused_duration
    gs.paused = False
    gs.pause_start_time = 0.0
    return [_event(elapsed, "MISSION RESUMED")]


def handle_end_mission(gs: GameState) -> list[dict]:
    """Signal the game loop to transition to debrief."""
    gs.phase = GamePhase.DEBRIEF
    return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _event(elapsed: float, message: str) -> dict:
    return {"type": "event", "timestamp": round(elapsed, 1), "message": message}


def _engage_jammer(
    gs: GameState,
    drone_idx: int,
    d: DroneState,
    eff_state: dict,
    effector_id: str,
    target_id: str,
    effectiveness: float,
    elapsed: float,
) -> list[dict]:
    msgs: list[dict] = []
    in_jam_range = check_effector_in_range(eff_state, d)
    radiating_msg = f"EW: {eff_state['name']} RADIATING"
    if not in_jam_range:
        radiating_msg += f" — target {d.id.upper()} outside effective range"
    msgs.append(_event(elapsed, radiating_msg))

    if not in_jam_range:
        return msgs

    # --- RF link jamming ---
    jam_behavior = pick_jam_behavior(d.drone_type)

    # --- PNT jamming (runs independently of RF result) ---
    pnt_effective, pnt_drift = apply_pnt_jamming(d.drone_type)
    pnt_duration = random.uniform(15.0, 25.0) if pnt_effective else 0.0

    if jam_behavior is None and not pnt_effective:
        # Fully immune to both RF and PNT jamming
        msgs.append(_event(elapsed,
            f"JAM INEFFECTIVE — AUTONOMOUS NAVIGATION ({d.id.upper()})"))
        msgs.append({
            "type": "engagement_result",
            "target_id": target_id, "effector": effector_id,
            "effective": False, "effectiveness": 0.0,
        })
    else:
        update_fields: dict = {}
        engagement_result: dict = {
            "type": "engagement_result",
            "target_id": target_id, "effector": effector_id,
            "effective": True, "effectiveness": round(effectiveness, 2),
        }

        if jam_behavior is not None:
            jam_duration = random.uniform(5.0, 10.0)
            update_fields.update({
                "dtid_phase": DTIDPhase.DEFEATED,
                "jammed": True,
                "jammed_behavior": jam_behavior,
                "jammed_time_remaining": jam_duration,
            })
            behavior_label = jam_behavior.replace("_", " ").upper()
            msgs.append(_event(elapsed, f"EW: {d.id.upper()} JAMMED — {behavior_label}"))
            engagement_result["jammed"] = True
            engagement_result["jammed_behavior"] = jam_behavior

        if pnt_effective:
            update_fields.update({
                "pnt_jammed": True,
                "pnt_drift_magnitude": pnt_drift,
                "pnt_jammed_time_remaining": pnt_duration,
            })
            if jam_behavior is None:
                # PNT-only effect (e.g. Shahed) — different message tone
                msgs.append(_event(elapsed,
                    f"PNT: {d.id.upper()} — NAVIGATION DEGRADED ({pnt_duration:.0f}s)"))
                engagement_result["pnt_jammed"] = True
                engagement_result["effective"] = True
                engagement_result["effectiveness"] = round(pnt_drift * 100, 2)
            else:
                msgs.append(_event(elapsed,
                    f"PNT: {d.id.upper()} — GPS DEGRADED (compounding RF jam)"))
                engagement_result["pnt_jammed"] = True

        gs.drones[drone_idx] = d.model_copy(update=update_fields)
        gs.engage_times[target_id] = elapsed
        gs.effector_used[target_id] = eff_state["type"]
        gs.actions.append(PlayerAction(
            action="engage", target_id=target_id,
            effector=effector_id, timestamp=elapsed,
        ))
        msgs.append(engagement_result)
    return msgs


def _engage_jackal(
    gs: GameState,
    d: DroneState,
    eff_state: dict,
    effector_id: str,
    target_id: str,
    elapsed: float,
) -> list[dict]:
    msgs: list[dict] = []
    jackal_count = sum(1 for dd in gs.drones if dd.is_interceptor)
    jackal_id = f"JKIL-{jackal_count + 1:02d}"
    eff_x = eff_state.get("x", 0.0)
    eff_y = eff_state.get("y", 0.0)
    dx_tgt = d.x - eff_x
    dy_tgt = d.y - eff_y
    heading_to = math.degrees(math.atan2(dx_tgt, dy_tgt)) % 360

    spinup_duration = random.uniform(10.0, 15.0)
    jackal_drone = DroneState(
        id=jackal_id, drone_type=DroneType.JACKAL,
        x=eff_x, y=eff_y, altitude=50, speed=0,
        heading=heading_to, detected=True, classified=True,
        classification=ThreatClassification.JACKAL,
        dtid_phase=DTIDPhase.IDENTIFIED, affiliation=Affiliation.FRIENDLY,
        confidence=1.0, is_interceptor=True,
        interceptor_target=target_id, intercept_phase="spinup",
        spinup_remaining=spinup_duration,
    )
    gs.drones.append(jackal_drone)
    gs.engage_times[target_id] = elapsed
    gs.effector_used[target_id] = eff_state["type"]
    gs.actions.append(PlayerAction(
        action="engage", target_id=target_id,
        effector=effector_id, timestamp=elapsed,
    ))
    msgs.append(_event(elapsed,
        f"JACKAL ENGAGE \u2014 {jackal_id} SPINUP INITIATED ({round(spinup_duration)}s TO LAUNCH)"))
    return msgs


def _engage_direct(
    gs: GameState,
    drone_idx: int,
    d: DroneState,
    eff_state: dict,
    effector_id: str,
    target_id: str,
    effectiveness: float,
    elapsed: float,
) -> list[dict]:
    msgs: list[dict] = []
    neutralized = effectiveness > 0.5
    gs.drones[drone_idx] = d.model_copy(update={
        "dtid_phase": DTIDPhase.DEFEATED,
        "neutralized": neutralized,
    })
    gs.engage_times[target_id] = elapsed
    gs.effector_used[target_id] = eff_state["type"]
    gs.actions.append(PlayerAction(
        action="engage", target_id=target_id,
        effector=effector_id, timestamp=elapsed,
    ))
    msgs.append({
        "type": "engagement_result",
        "target_id": target_id, "effector": effector_id,
        "effective": neutralized, "effectiveness": round(effectiveness, 2),
    })
    result_str = "NEUTRALIZED" if neutralized else "INEFFECTIVE"
    msgs.append(_event(elapsed,
        f"ENGAGEMENT: {eff_state['name']} vs {target_id.upper()} \u2014 {result_str}"))
    return msgs


def _engage_shinobi(
    gs: GameState,
    drone_idx: int,
    d: DroneState,
    eff_state: dict,
    effector_id: str,
    target_id: str,
    cm_type: str,
    effectiveness: float,
    elapsed: float,
) -> list[dict]:
    """SHINOBI Protocol Manipulation engagement."""
    msgs: list[dict] = []

    # SHINOBI requires its own RF sensor to have the target
    if not check_shinobi_rf_tracking(gs.sensor_configs, d):
        msgs.append(_event(elapsed,
            f"SHINOBI: NO RF TRACK — {target_id.upper()} not detected by SHINOBI sensor"))
        return msgs

    # Range check — defeat range is shorter than detect range
    if not check_effector_in_range(eff_state, d):
        msgs.append(_event(elapsed,
            f"SHINOBI: {target_id.upper()} outside defeat range (6km)"))
        return msgs

    # Check if target is vulnerable to SHINOBI
    if not is_shinobi_vulnerable(d):
        msgs.append(_event(elapsed,
            f"SHINOBI: {target_id.upper()} — NO PROTOCOL MATCH (not in library)"))
        msgs.append({
            "type": "engagement_result",
            "target_id": target_id, "effector": effector_id,
            "effective": False, "effectiveness": 0.0,
        })
        return msgs

    # Check CM success (fixed-wing can resist)
    if not pick_shinobi_cm_effectiveness(d, cm_type):
        msgs.append(_event(elapsed,
            f"SHINOBI: {cm_type.replace('shinobi_', '').upper()} INEFFECTIVE — "
            f"autonomous navigation ({target_id.upper()})"))
        msgs.append({
            "type": "engagement_result",
            "target_id": target_id, "effector": effector_id,
            "effective": False, "effectiveness": 0.0,
            "shinobi_cm": cm_type,
        })
        return msgs

    # Apply SHINOBI countermeasure
    freq = DRONE_FREQUENCY_MAP.get(d.drone_type.value, "2.4GHz")
    cm_duration = random.uniform(15.0, 30.0)  # SHINOBI effects last longer than broadband jam
    cm_label = cm_type.replace("shinobi_", "").replace("_", " ").upper()

    gs.drones[drone_idx] = d.model_copy(update={
        "dtid_phase": DTIDPhase.DEFEATED,
        "shinobi_cm_active": cm_type,
        "shinobi_cm_state": "pending",
        "shinobi_cm_time_remaining": cm_duration,
        "shinobi_cm_initial_duration": cm_duration,
        "frequency_band": freq,
        "downlink_detected": True,
    })
    gs.engage_times[target_id] = elapsed
    gs.effector_used[target_id] = eff_state["type"]
    gs.actions.append(PlayerAction(
        action="engage", target_id=target_id,
        effector=effector_id, timestamp=elapsed,
    ))
    msgs.append(_event(elapsed,
        f"SHINOBI: {cm_label} command sent to {target_id.upper()} on {freq}"))
    msgs.append({
        "type": "engagement_result",
        "target_id": target_id, "effector": effector_id,
        "effective": True, "effectiveness": round(effectiveness, 2),
        "shinobi_cm": cm_type, "shinobi_cm_state": "pending",
    })
    return msgs


def _update_effector_status(eff_state: dict) -> None:
    """Update the effector's runtime status after firing."""
    # Jammers run indefinitely — no recharge
    if eff_state.get("type") in ("rf_jam", "electronic"):
        return
    if eff_state.get("ammo_remaining") is not None:
        eff_state["ammo_remaining"] -= 1
        if eff_state["ammo_remaining"] <= 0:
            eff_state["status"] = "depleted"
    elif eff_state.get("single_use") or eff_state["recharge_seconds"] == 0:
        eff_state["status"] = "offline"
    elif eff_state["recharge_seconds"] > 0:
        eff_state["status"] = "recharging"
        eff_state["recharge_remaining"] = float(eff_state["recharge_seconds"])
