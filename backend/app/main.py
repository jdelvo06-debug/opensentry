"""SKYSHIELD backend -- FastAPI + WebSocket real-time C-UAS DTID simulator."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.config import KTS_TO_KMS
from app.security import (
    ConnectionTracker,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    WSRateChecker,
    connection_tracker,
)
from app.actions import (
    handle_clear_airspace,
    handle_confirm_track,
    handle_end_mission,
    handle_engage,
    handle_hold_fire,
    handle_identify,
    handle_jam_all, handle_cease_jam,
    handle_jammer_toggle,
    handle_pause_mission,
    handle_release_hold_fire,
    handle_resume_mission,
)
from app.bases import list_bases, load_base, load_equipment_catalog
from app.jackal import update_jackal
from app.detection import calculate_confidence, update_sensors
from app.drone import create_drone, distance_to_base, update_drone
from app.game_state import GameState
from app.helpers import (
    build_effectors_from_placement,
    build_sensors_from_placement,
    threat_level,
)
from app.jamming import apply_pnt_jamming, pick_jam_behavior, update_jammed_drone, update_pnt_jammed_drone
from app.shinobi import update_shinobi_drone
from app.models import (
    Affiliation,
    BaseTemplate,
    DTIDPhase,
    DroneType,
    GamePhase,
    PlacedEquipment,
    PlacementConfig,
    SensorConfig,
    ThreatClassification,
)
from app.scenario import list_scenarios, load_scenario
from app.scoring import calculate_score, calculate_score_multi
from app.waves import (
    generate_ambient_object,
    generate_wave_drones,
    initial_ambient_schedule,
    AMBIENT_INTERVALS,
)

logger = logging.getLogger("skyshield")

# Valid IDs (prevent path traversal)
VALID_SCENARIO_IDS = {"lone_wolf", "swarm_attack", "recon_probe", "tutorial"}
VALID_BASE_IDS = {"small_fob", "medium_airbase", "large_installation"}
VALID_ACTION_NAMES = {
    "confirm_track", "identify", "engage", "hold_fire",
    "release_hold_fire", "end_mission", "slew_camera",
    "shinobi_hold", "shinobi_land_now", "shinobi_deafen",
    "jammer_toggle", "jam_all", "cease_jam", "clear_airspace",
    "pause_mission", "resume_mission",
}
VALID_MSG_TYPES = {"action", "restart"}

app = FastAPI(title="SKYSHIELD", version="0.3.0")

# --- Middleware stack (order matters: last added = first executed) ---
# 1. CORS — restrict to configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
# 2. Security headers (X-Content-Type-Options, CSP, etc.)
app.add_middleware(SecurityHeadersMiddleware)
# 3. HTTP rate limiting (per-IP, sliding window)
app.add_middleware(RateLimitMiddleware)


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@app.get("/")
async def root():
    return {"name": "SKYSHIELD", "version": "0.3.0"}


@app.get("/scenarios")
async def get_scenarios():
    try:
        return list_scenarios()
    except Exception as e:
        logger.error("Failed to list scenarios: %s", e)
        return {"error": "Failed to load scenarios"}


@app.get("/bases")
async def get_bases():
    try:
        return list_bases()
    except Exception as e:
        logger.error("Failed to list bases: %s", e)
        return {"error": "Failed to load bases"}


@app.get("/bases/{base_id}")
async def get_base(base_id: str):
    if base_id not in VALID_BASE_IDS:
        return {"error": f"Unknown base: {base_id}"}
    try:
        base = load_base(base_id)
    except FileNotFoundError:
        return {"error": f"Base not found: {base_id}"}
    except Exception as e:
        logger.error("Failed to load base %s: %s", base_id, e)
        return {"error": f"Failed to load base: {base_id}"}
    return base.model_dump()


@app.get("/equipment")
async def get_equipment():
    catalog = load_equipment_catalog()
    return catalog.model_dump()


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------


async def _send_error(ws: WebSocket, message: str, code: str = "error") -> None:
    """Send an error event to the client."""
    try:
        await ws.send_json({"type": "error", "code": code, "message": message})
    except Exception:
        pass  # Connection may already be closed


async def _send_msgs(ws: WebSocket, msgs: list[dict]) -> None:
    """Send a batch of messages to the client."""
    for m in msgs:
        await ws.send_json(m)


# ---------------------------------------------------------------------------
# WebSocket — initialisation helpers
# ---------------------------------------------------------------------------


async def _receive_init(ws: WebSocket) -> dict | None:
    """Wait for the init message; return it or None on failure."""
    try:
        return await asyncio.wait_for(ws.receive_json(), timeout=30.0)
    except asyncio.TimeoutError:
        await _send_error(ws, "Timed out waiting for scenario selection", "init_timeout")
        await ws.close(1000)
    except json.JSONDecodeError as e:
        await _send_error(ws, f"Invalid JSON in init message: {e}", "invalid_json")
        await ws.close(1000)
    except Exception as e:
        logger.error("Failed to receive init message: %s", e)
        await ws.close(1011)
    return None


def _init_game_state(
    scenario,
    sensor_configs,
    effector_configs_list,
    placement_config,
    base_template,
    terrain,
) -> GameState:
    """Build the initial GameState from config objects."""
    gs = GameState(
        scenario=scenario,
        sensor_configs=sensor_configs,
        effector_configs=effector_configs_list,
        placement_config=placement_config,
        base_template=base_template,
        terrain=terrain,
    )

    # Spawn initial drones
    for drone_cfg in scenario.drones:
        gs.drone_configs[drone_cfg.id] = drone_cfg
        if drone_cfg.spawn_delay <= 0:
            gs.drones.append(create_drone(drone_cfg))
            gs.behaviors[drone_cfg.id] = drone_cfg.behavior
        else:
            gs.pending_spawns.append(drone_cfg)

    # Init effector runtime state
    for eff in effector_configs_list:
        is_jammer = eff.type.value in ("rf_jam", "electronic")
        gs.effector_states.append({
            "id": eff.id, "name": eff.name, "type": eff.type.value,
            "range_km": eff.range_km, "status": eff.status,
            "recharge_seconds": eff.recharge_seconds, "recharge_remaining": 0.0,
            "x": eff.x, "y": eff.y, "fov_deg": eff.fov_deg,
            "facing_deg": eff.facing_deg, "requires_los": eff.requires_los,
            "single_use": eff.single_use, "ammo_count": eff.ammo_count,
            "ammo_remaining": eff.ammo_remaining,
            **({"jammer_active": False} if is_jammer else {}),
        })

    # Init sensor runtime
    for s in sensor_configs:
        gs.sensor_runtime.append({"id": s.id, "status": s.status, "detecting": []})

    # Ambient traffic schedule
    gs.next_ambient_times = initial_ambient_schedule()

    # Protected area
    if base_template and base_template.protected_assets:
        assets = base_template.protected_assets
        cx = sum(a.x for a in assets) / len(assets)
        cy = sum(a.y for a in assets) / len(assets)
        gs.protected_area_center = (cx, cy)
        max_dist = max(
            math.sqrt((a.x - cx) ** 2 + (a.y - cy) ** 2) for a in assets
        )
        gs.protected_area_radius = max(max_dist + 0.15, 0.2)
    gs.warning_area_radius = gs.protected_area_radius * 1.5

    return gs


def _build_game_start_msg(gs: GameState) -> dict:
    """Build the ``game_start`` message dict."""
    msg: dict = {
        "type": "game_start",
        "scenario": {
            "name": gs.scenario.name,
            "description": gs.scenario.description,
            "difficulty": gs.scenario.difficulty,
        },
        "sensors": [
            {
                "id": s.id, "name": s.name, "type": s.type.value,
                "range_km": s.range_km, "status": s.status,
                "x": s.x, "y": s.y, "fov_deg": s.fov_deg, "facing_deg": s.facing_deg,
            }
            for s in gs.sensor_configs
        ],
        "effectors": [
            {
                "id": e.id, "name": e.name, "type": e.type.value,
                "range_km": e.range_km, "status": e.status,
                "recharge_seconds": e.recharge_seconds,
                "x": e.x, "y": e.y, "fov_deg": e.fov_deg, "facing_deg": e.facing_deg,
                **({"ammo_count": e.ammo_count} if e.ammo_count is not None else {}),
                **({"ammo_remaining": e.ammo_remaining} if e.ammo_remaining is not None else {}),
            }
            for e in gs.effector_configs
        ],
        "engagement_zones": gs.scenario.engagement_zones.model_dump(),
        "tutorial": gs.scenario.tutorial,
        "tutorial_prompts": gs.scenario.tutorial_prompts or [],
        "protected_area": {
            "center_x": gs.protected_area_center[0],
            "center_y": gs.protected_area_center[1],
            "radius_km": round(gs.protected_area_radius, 3),
            "warning_radius_km": round(gs.warning_area_radius, 3),
        },
    }

    if gs.base_template:
        msg["base"] = {
            "id": gs.base_template.id,
            "name": gs.base_template.name,
            "boundary": gs.base_template.boundary,
            "protected_assets": [a.model_dump() for a in gs.base_template.protected_assets],
            "terrain": [t.model_dump() for t in gs.base_template.terrain],
        }

    return msg


# ---------------------------------------------------------------------------
# Game tick helpers
# ---------------------------------------------------------------------------


def _tick_spawns(gs: GameState, elapsed: float) -> list[dict]:
    """Spawn delayed drones and ambient traffic. Returns events."""
    events: list[dict] = []

    # Delayed scenario drones
    newly_spawned = []
    for cfg in gs.pending_spawns:
        if elapsed >= cfg.spawn_delay:
            new_drone = create_drone(cfg)
            new_drone = new_drone.model_copy(update={"wave_number": gs.current_wave})
            gs.drones.append(new_drone)
            gs.behaviors[cfg.id] = cfg.behavior
            newly_spawned.append(cfg)
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": f"RADAR: New contact emerging — {cfg.id.upper()}",
            })
    for cfg in newly_spawned:
        gs.pending_spawns.remove(cfg)

    _ATC_CLEARABLE_AMB = {"commercial_aircraft", "military_jet"}
    # Ambient traffic — suppressed entirely if scenario sets no_ambient (e.g. tutorial)
    if gs.scenario.no_ambient:
        return events
    # Aircraft suppressed after CLEAR AIRSPACE, birds/balloons unaffected
    for amb_type, next_time in list(gs.next_ambient_times.items()):
        if elapsed < gs.ambient_suppressed_until and amb_type in _ATC_CLEARABLE_AMB:
            continue
        if elapsed >= next_time:
            amb_cfg, gs.ambient_counter = generate_ambient_object(
                gs.ambient_counter, amb_type, elapsed
            )
            while amb_cfg.id in gs.drone_configs:
                gs.ambient_counter += 1
                amb_cfg, gs.ambient_counter = generate_ambient_object(
                    gs.ambient_counter, amb_type, elapsed
                )
            gs.drone_configs[amb_cfg.id] = amb_cfg
            amb_drone = create_drone(amb_cfg)
            amb_drone = amb_drone.model_copy(update={"is_ambient": True, "wave_number": 0})
            if amb_type in ("commercial_aircraft", "military_jet"):
                amb_drone = amb_drone.model_copy(update={
                    "affiliation": Affiliation.FRIENDLY,
                    "classified": True,
                    "dtid_phase": DTIDPhase.IDENTIFIED,
                    "classification": (
                        ThreatClassification.PASSENGER_AIRCRAFT
                        if amb_type == "commercial_aircraft"
                        else ThreatClassification.FIXED_WING
                    ),
                })
            gs.drones.append(amb_drone)
            gs.behaviors[amb_cfg.id] = amb_cfg.behavior
            lo, hi = AMBIENT_INTERVALS[amb_type]
            gs.next_ambient_times[amb_type] = elapsed + random.uniform(lo, hi)

    return events


def _tick_waves(gs: GameState, elapsed: float) -> list[dict]:
    """Check wave completion and spawn next wave. Returns events."""
    events: list[dict] = []
    threat_drones = [d for d in gs.drones if not d.is_ambient]
    if (not gs.pending_spawns and threat_drones
            and all(d.neutralized for d in threat_drones)):
        if gs.wave_all_neutralized_time is None:
            gs.wave_all_neutralized_time = elapsed
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": "ALL THREATS NEUTRALIZED — MAINTAINING WATCH",
            })
        elif elapsed - gs.wave_all_neutralized_time >= gs.wave_pause_seconds:
            gs.current_wave += 1
            gs.wave_all_neutralized_time = None
            gs.wave_pause_seconds = random.uniform(30.0, 60.0)
            new_cfgs, gs.wave_drone_counter = generate_wave_drones(
                gs.current_wave, gs.wave_drone_counter
            )
            for wcfg in new_cfgs:
                gs.drone_configs[wcfg.id] = wcfg
                adjusted = wcfg.model_copy(update={
                    "spawn_delay": elapsed + wcfg.spawn_delay,
                })
                gs.pending_spawns.append(adjusted)
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": f"WARNING: WAVE {gs.current_wave} — NEW CONTACTS INBOUND",
            })
    else:
        gs.wave_all_neutralized_time = None
    return events


def _tick_effector_recharge(gs: GameState, elapsed: float) -> list[dict]:
    """Advance effector recharge timers. Returns events."""
    events: list[dict] = []
    for eff_state in gs.effector_states:
        # Jammers run indefinitely — skip recharge
        if eff_state.get("type") in ("rf_jam", "electronic"):
            continue
        if eff_state["status"] == "recharging":
            eff_state["recharge_remaining"] -= gs.tick_rate
            if eff_state["recharge_remaining"] <= 0:
                eff_state["status"] = "ready"
                eff_state["recharge_remaining"] = 0.0
                events.append({
                    "type": "event", "timestamp": round(elapsed, 1),
                    "message": f"{eff_state['name']}: Ready",
                })
    return events


def _tick_passive_jamming(gs: GameState, elapsed: float) -> list[dict]:
    """Passive area jamming — any active jammer auto-affects drones in range."""
    events: list[dict] = []
    for eff_state in gs.effector_states:
        if eff_state.get("type") not in ("rf_jam", "electronic"):
            continue
        if not eff_state.get("jammer_active", False):
            continue
        if eff_state.get("recharge_remaining", 0) > 0:
            continue

        eff_x = eff_state.get("x", 0)
        eff_y = eff_state.get("y", 0)
        range_km = eff_state.get("range_km", 3.0)

        for i, drone in enumerate(gs.drones):
            if drone.neutralized or drone.is_interceptor:
                continue
            if drone.shinobi_cm_active:
                continue
            dist = math.sqrt((drone.x - eff_x) ** 2 + (drone.y - eff_y) ** 2)
            if dist > range_km:
                continue

            update_fields: dict = {}
            rf_applied = False
            pnt_applied = False

            # --- RF jamming (skip if already jammed) ---
            if not drone.jammed:
                behavior = pick_jam_behavior(drone.drone_type)
                if behavior is None:
                    if drone.id not in gs.jam_resist_notified:
                        gs.jam_resist_notified.add(drone.id)
                        events.append({
                            "type": "event", "timestamp": round(elapsed, 1),
                            "message": f"RF JAM: {drone.id.upper()} — RESISTANT (no effect)",
                        })
                else:
                    jam_duration = random.uniform(5.0, 10.0)
                    update_fields.update({
                        "dtid_phase": DTIDPhase.DEFEATED,
                        "jammed": True,
                        "jammed_behavior": behavior,
                        "jammed_time_remaining": jam_duration,
                    })
                    gs.engage_times.setdefault(drone.id, elapsed)
                    gs.effector_used.setdefault(drone.id, eff_state["type"])
                    events.append({
                        "type": "event", "timestamp": round(elapsed, 1),
                        "message": f"RF JAM: {drone.id.upper()} — {behavior.replace('_', ' ').upper()}",
                    })
                    rf_applied = True

            # --- PNT jamming (skip if already PNT-jammed) ---
            if not drone.pnt_jammed:
                pnt_effective, pnt_drift = apply_pnt_jamming(drone.drone_type)
                if pnt_effective:
                    pnt_duration = random.uniform(15.0, 25.0)
                    update_fields.update({
                        "pnt_jammed": True,
                        "pnt_drift_magnitude": pnt_drift,
                        "pnt_jammed_time_remaining": pnt_duration,
                    })
                    pnt_applied = True
                    if not rf_applied:
                        # PNT-only hit (e.g. Shahed)
                        pnt_key = f"pnt_{drone.id}"
                        if pnt_key not in gs.jam_resist_notified:
                            gs.jam_resist_notified.add(pnt_key)
                            events.append({
                                "type": "event", "timestamp": round(elapsed, 1),
                                "message": f"PNT: {drone.id.upper()} — NAVIGATION DEGRADED ({pnt_duration:.0f}s)",
                            })
                        gs.engage_times.setdefault(drone.id, elapsed)
                        gs.effector_used.setdefault(drone.id, eff_state["type"])

            if update_fields:
                gs.drones[i] = drone.model_copy(update=update_fields)
    return events


def _tick_drones(gs: GameState, elapsed: float) -> list[dict]:
    """Move drones, run sensors, update detection/coasting. Returns events."""
    events: list[dict] = []

    for i, drone in enumerate(gs.drones):
        if drone.neutralized:
            # Still run sensor bookkeeping for neutralized drones
            _update_sensor_runtime(gs, i)
            continue

        # --- JACKAL interceptor ---
        if drone.is_interceptor:
            updated, mutations, cevents, eng_results = update_jackal(
                drone, gs.drones, gs.tick_rate, elapsed
            )
            gs.drones[i] = updated
            events.extend(cevents)
            events.extend(eng_results)  # engagement_results also sent as messages
            for mutated in mutations:
                for mi, md in enumerate(gs.drones):
                    if md.id == mutated.id:
                        gs.drones[mi] = mutated
                        break
            continue

        # --- Jammed drone (RF) ---
        if drone.jammed:
            updated, jevents = update_jammed_drone(drone, gs.tick_rate, elapsed)
            gs.drones[i] = updated
            events.extend(jevents)
            continue

        # --- PNT-jammed drone (not RF-jammed — applies drift during normal movement) ---
        if drone.pnt_jammed:
            updated, pevents = update_pnt_jammed_drone(drone, gs.tick_rate, elapsed)
            gs.drones[i] = updated
            events.extend(pevents)
            # Fall through — PNT-jammed drone still moves normally (below),
            # but position was already perturbed by update_pnt_jammed_drone.
            drone = gs.drones[i]

        # --- SHINOBI countermeasure active ---
        if drone.shinobi_cm_active:
            updated, nevents = update_shinobi_drone(drone, gs.tick_rate, elapsed)
            gs.drones[i] = updated
            events.extend(nevents)
            continue

        # --- Tutorial gate: freeze drone until operator completes step ---
        if gs.scenario.tutorial and not drone.is_ambient and _tutorial_gate_active(gs, drone):
            # Don't move — drone holds position
            pass
        else:
            # --- Normal movement ---
            cfg = gs.drone_configs[drone.id]
            gs.drones[i] = update_drone(
                drone, gs.tick_rate, gs.behaviors[drone.id],
                waypoints=cfg.waypoints,
                orbit_radius=cfg.orbit_radius or 1.5,
                orbit_center=cfg.orbit_center,
                detected_by_player=drone.detected,
            )

        # Base proximity check
        if not gs.drones[i].is_ambient and distance_to_base(gs.drones[i]) < gs.scenario.base_radius_km:
            gs.drone_reached_base = True

        # Remove ambient objects that leave the map
        if gs.drones[i].is_ambient:
            dist = math.sqrt(gs.drones[i].x ** 2 + gs.drones[i].y ** 2)
            if dist > 12.0:
                gs.drones[i] = gs.drones[i].model_copy(update={"neutralized": True})

        # --- Sensor detection ---
        if not gs.drones[i].neutralized and not gs.drones[i].is_interceptor:
            events.extend(_run_sensors_for_drone(gs, i, elapsed))

    return events


def _run_sensors_for_drone(gs: GameState, i: int, elapsed: float) -> list[dict]:
    """Run sensor detection and coasting logic for drone at index *i*."""
    events: list[dict] = []
    drone = gs.drones[i]
    detecting_ids, readings = update_sensors(drone, gs.sensor_configs, terrain=gs.terrain)
    dist = distance_to_base(drone)
    confidence = calculate_confidence(detecting_ids, dist)

    # Propagate SHINOBI RF data to drone state
    shinobi_updates: dict = {}
    for reading in readings:
        if reading.get("is_shinobi"):
            shinobi_updates["frequency_band"] = reading.get("frequency_band")
            shinobi_updates["downlink_detected"] = reading.get("downlink_detected", False)
            shinobi_updates["uplink_detected"] = reading.get("uplink_detected", False)
    if shinobi_updates:
        gs.drones[i] = gs.drones[i].model_copy(update=shinobi_updates)
        drone = gs.drones[i]

    # First detection time
    if detecting_ids and drone.id not in gs.detection_times:
        gs.detection_times[drone.id] = elapsed

    # Sensor acquisition / loss events
    prev = gs.previously_detected.get(drone.id, set())
    new_sensors = set(detecting_ids) - prev
    if not prev and detecting_ids:
        # Determine if SHINOBI detected it (use "RF" label) vs radar
        has_shinobi = any(r.get("is_shinobi") for r in readings)
        detect_label = "SHINOBI RF" if has_shinobi and not any(
            "radar" in sid.lower() or "tpq" in sid.lower() or "kurz" in sid.lower()
            for sid in detecting_ids if not ("shinobi" in sid.lower())
        ) else "RADAR"
        events.append({
            "type": "event", "timestamp": round(elapsed, 1),
            "message": f"{detect_label}: New contact detected \u2014 {drone.id.upper()}",
        })
    else:
        for sid in new_sensors:
            sensor_name = sid.upper().replace("_", " ")
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": f"{sensor_name}: Acquiring {drone.id.upper()}",
            })
    for sid in (prev - set(detecting_ids)):
        sensor_name = sid.upper().replace("_", " ")
        events.append({
            "type": "event", "timestamp": round(elapsed, 1),
            "message": f"{sensor_name}: Lost contact \u2014 {drone.id.upper()}",
        })
    gs.previously_detected[drone.id] = set(detecting_ids)

    # --- Track coasting ---
    drone_id = drone.id
    was_detected = drone.detected
    now_detecting = len(detecting_ids) > 0

    if now_detecting:
        gs.coast_sensor_loss_time.pop(drone_id, None)
        if drone.coasting:
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone_id.upper()} — Sensor contact reacquired",
            })
        gs.drones[i] = drone.model_copy(update={
            "detected": True, "sensors_detecting": detecting_ids,
            "confidence": confidence, "coasting": False, "coast_start_time": 0.0,
        })
    elif was_detected or drone.coasting:
        if drone_id not in gs.coast_sensor_loss_time:
            gs.coast_sensor_loss_time[drone_id] = elapsed
            gs.drones[i] = gs.drones[i].model_copy(update={
                "last_known_heading": drone.heading,
                "last_known_speed": drone.speed,
            })

        time_without = elapsed - gs.coast_sensor_loss_time[drone_id]

        if time_without >= gs.coast_drop_time:
            gs.drones[i] = gs.drones[i].model_copy(update={
                "detected": False, "coasting": False,
                "sensors_detecting": [], "confidence": 0.0,
            })
            gs.coast_sensor_loss_time.pop(drone_id, None)
            events.append({
                "type": "event", "timestamp": round(elapsed, 1),
                "message": f"TRACK: {drone_id.upper()} — Track dropped (coast timeout)",
            })
        elif time_without >= gs.coast_delay:
            if not drone.coasting:
                events.append({
                    "type": "event", "timestamp": round(elapsed, 1),
                    "message": f"TRACK: {drone_id.upper()} — Coasting (extrapolating)",
                })
            heading_rad = math.radians(gs.drones[i].last_known_heading)
            speed_kms = gs.drones[i].last_known_speed * KTS_TO_KMS
            # Math convention: heading 0°=+X, 90°=+Y (same as drone.py atan2 output)
            new_x = gs.drones[i].x + math.cos(heading_rad) * speed_kms * gs.tick_rate
            new_y = gs.drones[i].y + math.sin(heading_rad) * speed_kms * gs.tick_rate
            new_trail = list(gs.drones[i].trail)
            new_trail.append([round(new_x, 3), round(new_y, 3)])
            if len(new_trail) > 20:
                new_trail = new_trail[-20:]
            gs.drones[i] = gs.drones[i].model_copy(update={
                "detected": True, "coasting": True,
                "coast_start_time": gs.coast_sensor_loss_time[drone_id],
                "sensors_detecting": [], "confidence": max(0.0, confidence - 0.1),
                "x": new_x, "y": new_y, "trail": new_trail,
            })
        else:
            gs.drones[i] = gs.drones[i].model_copy(update={
                "detected": True, "sensors_detecting": detecting_ids,
                "confidence": confidence,
            })
    else:
        gs.drones[i] = gs.drones[i].model_copy(update={
            "detected": False, "sensors_detecting": detecting_ids,
            "confidence": confidence,
        })

    _update_sensor_runtime(gs, i)
    return events


def _update_sensor_runtime(gs: GameState, drone_idx: int) -> None:
    """Keep sensor_runtime detecting lists in sync."""
    drone = gs.drones[drone_idx]
    for sr in gs.sensor_runtime:
        if drone.id in sr["detecting"]:
            sr["detecting"].remove(drone.id)
        if sr["id"] in (drone.sensors_detecting or []):
            sr["detecting"].append(drone.id)


def _build_state_msg(gs: GameState, elapsed: float, time_remaining: float) -> dict:
    """Build the per-tick ``state`` message."""
    tracks = []
    for drone in gs.drones:
        if drone.detected or drone.neutralized:
            eta_seconds: float | None = None
            if not drone.neutralized and drone.speed > 0:
                dx = drone.x - gs.protected_area_center[0]
                dy = drone.y - gs.protected_area_center[1]
                dist_to_center = math.sqrt(dx * dx + dy * dy)
                dist_to_edge = max(0.0, dist_to_center - gs.protected_area_radius)
                speed_kms = drone.speed * KTS_TO_KMS
                if speed_kms > 0:
                    eta_seconds = dist_to_edge / speed_kms

            tracks.append({
                "id": drone.id,
                "dtid_phase": drone.dtid_phase.value,
                "affiliation": drone.affiliation.value,
                "x": round(drone.x, 3), "y": round(drone.y, 3),
                "altitude_ft": round(drone.altitude),
                "speed_kts": round(drone.speed),
                "heading_deg": round(drone.heading, 1),
                "confidence": drone.confidence,
                "classification": (
                    drone.classification.value
                    if hasattr(drone.classification, "value")
                    else drone.classification
                ) if drone.classification else None,
                "trail": drone.trail,
                "sensors_detecting": drone.sensors_detecting,
                "neutralized": drone.neutralized,
                "coasting": drone.coasting,
                "hold_fire": drone.id in gs.hold_fire_tracks,
                "eta_protected": round(eta_seconds, 1) if eta_seconds is not None else None,
                "wave_number": drone.wave_number,
                "is_ambient": drone.is_ambient,
                "jammed": drone.jammed,
                "jammed_behavior": drone.jammed_behavior,
                "pnt_jammed": drone.pnt_jammed,
                "is_interceptor": drone.is_interceptor,
                "interceptor_target": drone.interceptor_target,
                "intercept_phase": drone.intercept_phase,
                "frequency_band": drone.frequency_band,
                "uplink_detected": drone.uplink_detected,
                "downlink_detected": drone.downlink_detected,
                "shinobi_cm_active": drone.shinobi_cm_active,
                "shinobi_cm_state": drone.shinobi_cm_state,
                "drone_type": drone.drone_type.value if hasattr(drone.drone_type, "value") else drone.drone_type,
                "spinup_remaining": round(drone.spinup_remaining, 1),
            })

    return {
        "type": "state",
        "elapsed": round(elapsed, 1),
        "time_remaining": round(time_remaining, 1),
        "threat_level": threat_level(gs.drones),
        "wave_number": gs.current_wave,
        "tracks": tracks,
        "sensors": [
            {"id": sr["id"], "status": sr["status"], "detecting": sr["detecting"]}
            for sr in gs.sensor_runtime
        ],
        "effectors": [
            {
                "id": es["id"], "name": es.get("name", ""), "type": es.get("type", ""),
                "status": es["status"],
                **({"ammo_count": es["ammo_count"]} if es.get("ammo_count") is not None else {}),
                **({"ammo_remaining": es["ammo_remaining"]} if es.get("ammo_remaining") is not None else {}),
                **({"jammer_active": es["jammer_active"]} if "jammer_active" in es else {}),
            }
            for es in gs.effector_states
        ],
        "ambient_suppressed_until": round(gs.ambient_suppressed_until, 1),
        "paused": gs.paused,
        **({"tutorial_step": gs.tutorial_step} if gs.scenario.tutorial else {}),
    }


def _tutorial_gate_active(gs: GameState, drone: DroneState) -> bool:
    """Return True if the tutorial drone should be frozen (gate active).

    Drone moves freely at all times — no gates on movement.
    Tutorial steps auto-advance based on player actions, not drone position.
    The only thing that triggers step advancement is the player completing each action.
    """
    # Auto-advance step 0 → 1 when drone is first detected (purely informational)
    if gs.tutorial_step == 0 and drone.detected:
        gs.tutorial_step = 1
    return False  # Never freeze the drone


def _advance_tutorial_step(gs: GameState, action_name: str, target_id: str,
                           effector_id: str | None = None) -> list[dict]:
    """Check if a player action should advance the tutorial step.
    Returns tutorial feedback messages (wrong-choice warnings, etc.)."""
    if not gs.scenario.tutorial:
        return []
    msgs: list[dict] = []
    step = gs.tutorial_step

    if step == 1 and action_name == "confirm_track":
        gs.tutorial_step = 2
        msgs.append({"type": "tutorial",
                      "message": "Track confirmed. Now slew the EO/IR Camera to get a visual on the target. "
                                 "Use the Radial Action Wheel (right-click the track) → SLEW CAMERA, "
                                 "or use the button in the Engagement Panel."})
    elif step == 2 and action_name == "slew_camera":
        gs.tutorial_step = 3
        gs.tutorial_camera_slewed = True
        msgs.append({"type": "tutorial",
                      "message": "Camera is locked on. Study the silhouette — this determines your "
                                 "classification. When ready, proceed to IDENTIFY."})
    elif action_name == "identify" and step in (2, 3):
        # Accept identify at step 2 (skipped slew) or step 3 (normal flow)
        if step == 2:
            gs.tutorial_step = 3  # auto-advance slew step
            gs.tutorial_camera_slewed = True
        gs.tutorial_step = 4
        # Check for incorrect classification
        drone = next((d for d in gs.drones if d.id == target_id), None)
        if drone:
            cfg = gs.drone_configs.get(target_id)
            given_cls = gs.classification_given.get(target_id)
            correct_cls = cfg.correct_classification if cfg else gs.scenario.correct_classification.value
            if given_cls and given_cls != correct_cls:
                msgs.append({"type": "tutorial_feedback",
                             "message": "Incorrect classification. Check the camera feed — look at the silhouette shape.",
                             "severity": "warning"})
        msgs.append({"type": "tutorial",
                      "message": "Threat identified! Now select an effector to engage. RF/PNT Jammer is the "
                                 "optimal choice for a commercial quad — it has low collateral risk."})
    elif step == 4 and action_name == "engage":
        # Check for suboptimal effector choice
        eff_state = None
        for es in gs.effector_states:
            if es["id"] == effector_id:
                eff_state = es
                break
        if eff_state and eff_state.get("type") == "kinetic":
            # Kinetic on a commercial quad — suboptimal
            drone = next((d for d in gs.drones if d.id == target_id), None)
            if drone and drone.drone_type.value == "commercial_quad":
                msgs.append({"type": "tutorial_feedback",
                             "message": "JACKAL is overkill for a commercial quad — high collateral risk. "
                                        "Jammer is the optimal choice.",
                             "severity": "warning"})
        gs.tutorial_step = 5

    return msgs


def _check_tutorial_prompts(gs: GameState) -> list[dict]:
    """Check tutorial prompt triggers. Returns messages to send."""
    if not gs.scenario.tutorial or not gs.scenario.tutorial_prompts:
        return []
    msgs: list[dict] = []
    for tp in gs.scenario.tutorial_prompts:
        trigger = tp["trigger"]
        if trigger in gs.tutorial_prompts_sent:
            continue
        should_send = False
        if trigger == "detected":
            should_send = any(d.detected for d in gs.drones) and gs.tutorial_step >= 1
        elif trigger == "tracked":
            should_send = gs.tutorial_step >= 2
        elif trigger == "identify_ready":
            # Replaced by gated camera step — skip this trigger in gated mode
            continue
        elif trigger == "identified":
            should_send = gs.tutorial_step >= 4
        elif trigger == "defeated":
            should_send = gs.tutorial_step >= 5
            if should_send:
                gs.tutorial_step = 6  # DEBRIEF step
        if should_send:
            msgs.append({"type": "tutorial", "message": tp["message"]})
            gs.tutorial_prompts_sent.add(trigger)
    return msgs


# ---------------------------------------------------------------------------
# Debrief
# ---------------------------------------------------------------------------


def _build_debrief(gs: GameState) -> dict:
    """Compute scores and build the debrief message."""
    # Filter out ambient drones from scoring
    threat_drone_cfgs = [
        cfg for cfg in gs.drone_configs.values()
        if cfg.drone_type not in (
            DroneType.PASSENGER_AIRCRAFT, DroneType.MILITARY_JET,
            DroneType.WEATHER_BALLOON,
        )
        and not (cfg.drone_type == DroneType.BIRD and cfg.correct_affiliation == "neutral")
    ]
    # Include ambient objects that were engaged (ROE violations)
    for a in gs.actions:
        if a.action == "engage":
            cfg = gs.drone_configs.get(a.target_id)
            if cfg and not cfg.should_engage and cfg not in threat_drone_cfgs:
                threat_drone_cfgs.append(cfg)

    scorable_cfgs = threat_drone_cfgs if threat_drone_cfgs else list(gs.drone_configs.values())

    if len(scorable_cfgs) <= 1:
        primary_cfg = scorable_cfgs[0] if scorable_cfgs else None
        pid = primary_cfg.id if primary_cfg else ""
        score = calculate_score(
            scenario=gs.scenario, actions=gs.actions,
            detection_time=gs.detection_times.get(pid, 0.0),
            confirm_time=gs.confirm_times.get(pid),
            identify_time=gs.identify_times.get(pid),
            engage_time=gs.engage_times.get(pid),
            classification_given=gs.classification_given.get(pid),
            affiliation_given=gs.affiliation_given.get(pid),
            effector_used=gs.effector_used.get(pid),
            drone_reached_base=gs.drone_reached_base,
            confidence_at_identify=gs.confidence_at_identify.get(pid, 0.0),
            placement_config=gs.placement_config,
            base_template=gs.base_template,
        )
    else:
        drones_reached = {
            d.id for d in gs.drones
            if not d.is_ambient and distance_to_base(d) < gs.scenario.base_radius_km
        }
        score = calculate_score_multi(
            scenario=gs.scenario, drone_configs=scorable_cfgs,
            actions=gs.actions,
            detection_times=gs.detection_times,
            confirm_times=gs.confirm_times,
            identify_times=gs.identify_times,
            engage_times=gs.engage_times,
            classifications_given=gs.classification_given,
            affiliations_given=gs.affiliation_given,
            effectors_used=gs.effector_used,
            drones_reached_base=drones_reached,
            confidence_at_identify=gs.confidence_at_identify,
            placement_config=gs.placement_config,
            base_template=gs.base_template,
        )

    return {
        "type": "debrief",
        "score": score.model_dump(),
        "drone_reached_base": gs.drone_reached_base,
        "waves_completed": gs.current_wave,
    }


# ---------------------------------------------------------------------------
# WebSocket game endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/game")
async def game_websocket(ws: WebSocket):
    # --- Connection limit check ---
    conn_id = f"{ws.client.host}:{ws.client.port}" if ws.client else f"unknown-{id(ws)}"
    if not connection_tracker.try_connect(conn_id):
        await ws.accept()
        await _send_error(ws, "Server at capacity — try again later", "at_capacity")
        await ws.close(1013)  # 1013 = Try Again Later
        return

    await ws.accept()
    rate_checker = WSRateChecker()

    try:
        # --- Init ---
        init_msg = await _receive_init(ws)
        if init_msg is None:
            return

        scenario_id = init_msg.get("scenario_id", "lone_wolf")
        if scenario_id not in VALID_SCENARIO_IDS:
            await _send_error(ws,
                f"Unknown scenario: {scenario_id}. Valid: {', '.join(sorted(VALID_SCENARIO_IDS))}",
                "invalid_scenario")
            await ws.close(1000)
            return

        try:
            scenario = load_scenario(scenario_id)
        except FileNotFoundError:
            await _send_error(ws, f"Scenario file not found: {scenario_id}", "scenario_not_found")
            await ws.close(1000)
            return
        except Exception as e:
            logger.error("Failed to load scenario %s: %s", scenario_id, e)
            await _send_error(ws, f"Failed to load scenario: {scenario_id}", "scenario_load_error")
            await ws.close(1000)
            return

        # Placement config
        placement_config = None
        base_template = None
        base_id = init_msg.get("base_id")

        if base_id and "placement" in init_msg:
            if base_id not in VALID_BASE_IDS:
                await _send_error(ws,
                    f"Unknown base: {base_id}. Valid: {', '.join(sorted(VALID_BASE_IDS))}",
                    "invalid_base")
                await ws.close(1000)
                return
            try:
                base_template = load_base(base_id)
            except FileNotFoundError:
                await _send_error(ws, f"Base template not found: {base_id}", "base_not_found")
                await ws.close(1000)
                return
            except Exception as e:
                logger.error("Failed to load base %s: %s", base_id, e)
                await _send_error(ws, f"Failed to load base: {base_id}", "base_load_error")
                await ws.close(1000)
                return

            pd = None
            try:
                pd = init_msg["placement"]
                placement_config = PlacementConfig(
                    base_id=base_id,
                    sensors=[PlacedEquipment(**s) for s in pd.get("sensors", [])],
                    effectors=[PlacedEquipment(**e) for e in pd.get("effectors", [])],
                    combined=[PlacedEquipment(**c) for c in pd.get("combined", [])],
                )
                # Apply client-provided perimeter overrides
                if "boundary" in pd and isinstance(pd["boundary"], list):
                    base_template.boundary = pd["boundary"]
                    # Derive base_radius_km from perimeter half-diagonal so threat-reach matches visual box
                    import math as _math
                    pts = pd["boundary"]
                    if len(pts) >= 2:
                        xs = [p[0] for p in pts]
                        ys = [p[1] for p in pts]
                        w = max(xs) - min(xs)
                        h = max(ys) - min(ys)
                        half_diag = _math.sqrt(w**2 + h**2) / 2.0
                        scenario.base_radius_km = max(half_diag, 0.2)
                if "placement_bounds_km" in pd and isinstance(pd["placement_bounds_km"], (int, float)):
                    base_template.placement_bounds_km = float(pd["placement_bounds_km"])
            except (TypeError, ValueError, KeyError) as e:
                logger.warning("Invalid placement config: %s", e)
                await _send_error(ws, f"Invalid placement configuration: {e}", "invalid_placement")
                await ws.close(1000)
                return

            catalog = load_equipment_catalog()
            cat_sensors = {s.catalog_id: s for s in catalog.sensors}
            cat_effectors = {e.catalog_id: e for e in catalog.effectors}
            cat_combined = {c.catalog_id: c for c in catalog.combined}
            sensor_configs = build_sensors_from_placement(
                placement_config, cat_sensors, cat_combined)
            effector_configs_list = build_effectors_from_placement(
                placement_config, cat_effectors, cat_combined)
        else:
            sensor_configs = list(scenario.sensors)
            effector_configs_list = list(scenario.effectors)

        terrain = base_template.terrain if base_template else []

        gs = _init_game_state(
            scenario, sensor_configs, effector_configs_list,
            placement_config, base_template, terrain,
        )

        # Override protected/warning radii when a custom perimeter boundary was provided
        if pd and "boundary" in pd and isinstance(pd["boundary"], list):
            import math as _math
            pts = pd["boundary"]
            if len(pts) >= 2:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                w = max(xs) - min(xs)
                h = max(ys) - min(ys)
                half_diag = _math.sqrt(w**2 + h**2) / 2.0
                gs.protected_area_radius = max(half_diag, 0.2)
                gs.warning_area_radius = gs.protected_area_radius * 1.5

        # Send game_start
        await ws.send_json(_build_game_start_msg(gs))

        # Tutorial start prompt
        if scenario.tutorial and scenario.tutorial_prompts:
            for tp in scenario.tutorial_prompts:
                if tp["trigger"] == "start":
                    await ws.send_json({"type": "tutorial", "message": tp["message"]})
                    gs.tutorial_prompts_sent.add("start")

        # --- Main game loop ---
        while gs.phase == GamePhase.RUNNING:
            tick_start = time.time()

            # Subtract accumulated paused time (and current pause if active)
            wall_elapsed = tick_start - gs.start_time
            paused_now = (tick_start - gs.pause_start_time) if gs.paused else 0.0
            elapsed = wall_elapsed - gs.total_paused_seconds - paused_now
            time_remaining = max(0, gs.max_duration - elapsed)
            events: list[dict] = []

            if not gs.paused:
                events.extend(_tick_spawns(gs, elapsed))
                events.extend(_tick_waves(gs, elapsed))
                events.extend(_tick_effector_recharge(gs, elapsed))
                events.extend(_tick_passive_jamming(gs, elapsed))
                events.extend(_tick_drones(gs, elapsed))

            # Send state
            await ws.send_json(_build_state_msg(gs, elapsed, time_remaining))

            # Send events
            await _send_msgs(ws, events)

            # Tutorial prompts
            await _send_msgs(ws, _check_tutorial_prompts(gs))

            # Timeout
            if time_remaining <= 0:
                gs.phase = GamePhase.DEBRIEF
                break

            # --- Player input (non-blocking, use remaining tick budget) ---
            tick_elapsed = time.time() - tick_start
            receive_timeout = max(0.01, gs.tick_rate - tick_elapsed)
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=receive_timeout)

                # Message size check
                if len(raw) > config.MAX_WS_MESSAGE_BYTES:
                    logger.warning("Oversized WS message (%d bytes) from client", len(raw))
                    await _send_error(ws, "Message too large", "msg_too_large")
                    continue

                # Per-connection rate check
                if not rate_checker.check():
                    await _send_error(ws, "Slow down — too many messages", "rate_limited")
                    continue

                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type not in VALID_MSG_TYPES:
                    if msg_type is not None:
                        logger.warning("Unknown message type from client: %s", msg_type)
                        await _send_error(ws, f"Unknown message type: {msg_type}", "invalid_msg_type")

                elif msg_type == "action":
                    action_name = msg.get("action", "")
                    target_id = msg.get("target_id", gs.drones[0].id if gs.drones else "")

                    if action_name not in VALID_ACTION_NAMES:
                        logger.warning("Unknown action from client: %s", action_name)
                        await _send_error(ws, f"Unknown action: {action_name}", "invalid_action")
                    elif action_name == "confirm_track":
                        await _send_msgs(ws, handle_confirm_track(gs, target_id, elapsed))
                        await _send_msgs(ws, _advance_tutorial_step(gs, "confirm_track", target_id))
                    elif action_name == "identify":
                        await _send_msgs(ws, handle_identify(
                            gs, target_id, msg.get("classification"),
                            msg.get("affiliation", "unknown"), elapsed,
                        ))
                        await _send_msgs(ws, _advance_tutorial_step(gs, "identify", target_id))
                    elif action_name == "slew_camera":
                        # Tutorial-aware camera slew — advance tutorial step
                        await _send_msgs(ws, _advance_tutorial_step(gs, "slew_camera", target_id))
                    elif action_name == "hold_fire":
                        await _send_msgs(ws, handle_hold_fire(gs, target_id, elapsed))
                    elif action_name == "release_hold_fire":
                        await _send_msgs(ws, handle_release_hold_fire(gs, target_id, elapsed))
                    elif action_name == "engage":
                        effector_id = msg.get("effector", "")
                        await _send_msgs(ws, handle_engage(
                            gs, target_id, effector_id, elapsed,
                            shinobi_cm=msg.get("shinobi_cm"),
                        ))
                        await _send_msgs(ws, _advance_tutorial_step(
                            gs, "engage", target_id, effector_id=effector_id))
                    elif action_name in ("shinobi_hold", "shinobi_land_now", "shinobi_deafen"):
                        await _send_msgs(ws, handle_engage(
                            gs, target_id, msg.get("effector", ""), elapsed,
                            shinobi_cm=action_name,
                        ))
                    elif action_name == "jammer_toggle":
                        await _send_msgs(ws, handle_jammer_toggle(
                            gs, msg.get("effector_id", ""), elapsed,
                        ))
                    elif action_name == "jam_all":
                        await _send_msgs(ws, handle_jam_all(gs, elapsed))
                    elif action_name == "cease_jam":
                        await _send_msgs(ws, handle_cease_jam(gs, elapsed))
                    elif action_name == "clear_airspace":
                        await _send_msgs(ws, handle_clear_airspace(gs, elapsed))
                    elif action_name == "pause_mission":
                        await _send_msgs(ws, handle_pause_mission(gs, elapsed))
                        _tr = max(0, gs.max_duration - elapsed)
                        await _send_msgs(ws, [_build_state_msg(gs, elapsed, _tr)])
                    elif action_name == "resume_mission":
                        await _send_msgs(ws, handle_resume_mission(gs, elapsed))
                        _tr = max(0, gs.max_duration - elapsed)
                        await _send_msgs(ws, [_build_state_msg(gs, elapsed, _tr)])
                    elif action_name == "end_mission":
                        handle_end_mission(gs)

                elif msg_type == "restart":
                    break

            except asyncio.TimeoutError:
                pass
            except json.JSONDecodeError as e:
                logger.warning("Invalid JSON from client: %s", e)
                await _send_error(ws, "Invalid JSON message", "invalid_json")
            except WebSocketDisconnect:
                logger.info("Client disconnected during game loop")
                return
            except Exception as e:
                logger.error("Unexpected error processing player input: %s", e, exc_info=True)
                await _send_error(ws, "Internal error processing your action", "internal_error")

        # --- Debrief ---
        await ws.send_json(_build_debrief(gs))

        # Keep connection open for client to read debrief or restart
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "restart":
                    break
        except WebSocketDisconnect:
            pass

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error("Unexpected error in game session: %s", e, exc_info=True)
        try:
            await _send_error(ws, "Server error — session ended", "server_error")
            await ws.close(1011)
        except Exception:
            pass
    finally:
        connection_tracker.disconnect(conn_id)
