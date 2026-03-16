"""SKYSHIELD backend -- FastAPI + WebSocket real-time C-UAS DTID simulator."""

from __future__ import annotations

import asyncio
import math
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.drone import create_drone, update_drone, distance_to_base
from app.detection import update_sensors, calculate_confidence
from app.models import (
    DTIDPhase,
    Affiliation,
    DroneState,
    EffectorConfig,
    EffectorStatus,
    GamePhase,
    PlayerAction,
    SensorConfig,
)
from app.scenario import list_scenarios, load_scenario
from app.scoring import calculate_score

app = FastAPI(title="SKYSHIELD", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"name": "SKYSHIELD", "version": "0.2.0"}


@app.get("/scenarios")
async def get_scenarios():
    return list_scenarios()


def _effector_effectiveness(effector_type: str, drone_type: str) -> float:
    """Return effectiveness score 0-1 based on effector type vs drone type."""
    matrix: dict[str, dict[str, float]] = {
        "rf_jam": {
            "commercial_quad": 0.9,
            "fixed_wing": 0.4,
            "micro": 0.7,
            "swarm": 0.6,
        },
        "kinetic": {
            "commercial_quad": 0.95,
            "fixed_wing": 0.8,
            "micro": 0.5,
            "swarm": 0.3,
        },
        "net_interceptor": {
            "commercial_quad": 0.85,
            "fixed_wing": 0.6,
            "micro": 0.9,
            "swarm": 0.4,
        },
        "directed_energy": {
            "commercial_quad": 0.9,
            "fixed_wing": 0.9,
            "micro": 0.95,
            "swarm": 0.8,
        },
    }
    return matrix.get(effector_type, {}).get(drone_type, 0.5)


def _threat_level(drones: list[DroneState]) -> str:
    """Calculate threat level based on closest non-neutralized track range."""
    min_range = float("inf")
    for drone in drones:
        if not drone.neutralized and drone.detected:
            dist = math.sqrt(drone.x ** 2 + drone.y ** 2)
            min_range = min(min_range, dist)

    if min_range == float("inf"):
        return "green"
    if min_range < 1.0:
        return "red"
    if min_range < 2.0:
        return "orange"
    if min_range < 3.0:
        return "yellow"
    return "green"


def _find_effector_config(
    effectors: list[dict], effector_id: str
) -> dict | None:
    for e in effectors:
        if e["id"] == effector_id:
            return e
    return None


@app.websocket("/ws/game")
async def game_websocket(ws: WebSocket):
    await ws.accept()

    try:
        # Wait for scenario selection
        init_msg = await ws.receive_json()
        scenario_id = init_msg.get("scenario_id", "lone_wolf")
        scenario = load_scenario(scenario_id)

        # Initialize drones
        drones: list[DroneState] = []
        behaviors: dict[str, str] = {}
        for drone_cfg in scenario.drones:
            drones.append(create_drone(drone_cfg))
            behaviors[drone_cfg.id] = drone_cfg.behavior

        # Initialize sensor configs
        sensor_configs: list[SensorConfig] = list(scenario.sensors)

        # Initialize effector state (mutable runtime state)
        effector_states: list[dict] = []
        for eff in scenario.effectors:
            effector_states.append({
                "id": eff.id,
                "name": eff.name,
                "type": eff.type.value,
                "range_km": eff.range_km,
                "status": eff.status,
                "recharge_seconds": eff.recharge_seconds,
                "recharge_remaining": 0.0,
            })

        # Sensor runtime state (for detecting lists)
        sensor_runtime: list[dict] = []
        for s in sensor_configs:
            sensor_runtime.append({
                "id": s.id,
                "status": s.status,
                "detecting": [],
            })

        phase = GamePhase.RUNNING
        actions: list[PlayerAction] = []
        start_time = time.time()
        drone_reached_base = False
        tick_rate = 0.1  # 10Hz

        # DTID tracking timestamps per drone
        detection_times: dict[str, float] = {}
        confirm_times: dict[str, float] = {}
        identify_times: dict[str, float] = {}
        engage_times: dict[str, float] = {}
        classification_given: dict[str, str] = {}
        affiliation_given: dict[str, str] = {}
        effector_used: dict[str, str] = {}
        confidence_at_identify: dict[str, float] = {}

        # Previously detected set (for event tracking)
        previously_detected: dict[str, set[str]] = {}  # drone_id -> set of sensor_ids

        # Send game_start
        await ws.send_json({
            "type": "game_start",
            "scenario": {
                "name": scenario.name,
                "description": scenario.description,
                "difficulty": scenario.difficulty,
            },
            "sensors": [
                {
                    "id": s.id,
                    "name": s.name,
                    "type": s.type.value,
                    "range_km": s.range_km,
                    "status": s.status,
                }
                for s in sensor_configs
            ],
            "effectors": [
                {
                    "id": e.id,
                    "name": e.name,
                    "type": e.type.value,
                    "range_km": e.range_km,
                    "status": e.status,
                    "recharge_seconds": e.recharge_seconds,
                }
                for e in scenario.effectors
            ],
            "engagement_zones": scenario.engagement_zones.model_dump(),
        })

        while phase == GamePhase.RUNNING:
            elapsed = time.time() - start_time
            time_remaining = max(0, scenario.duration_seconds - elapsed)

            events: list[dict] = []

            # Update effector recharge timers
            for eff_state in effector_states:
                if eff_state["status"] == "recharging":
                    eff_state["recharge_remaining"] -= tick_rate
                    if eff_state["recharge_remaining"] <= 0:
                        eff_state["status"] = "ready"
                        eff_state["recharge_remaining"] = 0.0
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"{eff_state['name']}: Ready",
                        })

            # Update drones and run sensors
            for i, drone in enumerate(drones):
                if not drone.neutralized:
                    drones[i] = update_drone(drone, tick_rate, behaviors[drone.id])

                    # Check if drone reached base
                    if distance_to_base(drones[i]) < scenario.base_radius_km:
                        drone_reached_base = True
                        phase = GamePhase.DEBRIEF

                # Run sensors for this drone
                if not drones[i].neutralized:
                    detecting_ids, _ = update_sensors(drones[i], sensor_configs)
                    dist = distance_to_base(drones[i])
                    confidence = calculate_confidence(detecting_ids, dist)

                    # Track first detection time
                    if detecting_ids and drones[i].id not in detection_times:
                        detection_times[drones[i].id] = elapsed

                    # Generate events for new sensor acquisitions
                    prev = previously_detected.get(drones[i].id, set())
                    new_sensors = set(detecting_ids) - prev

                    if not prev and detecting_ids:
                        # First detection of this drone
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"RADAR: New contact detected \u2014 {drones[i].id.upper()}",
                        })
                    else:
                        for sid in new_sensors:
                            sensor_name = sid.upper().replace("_", " ")
                            events.append({
                                "type": "event",
                                "timestamp": round(elapsed, 1),
                                "message": f"{sensor_name}: Acquiring {drones[i].id.upper()}",
                            })

                    # Track sensor loss
                    lost_sensors = prev - set(detecting_ids)
                    for sid in lost_sensors:
                        sensor_name = sid.upper().replace("_", " ")
                        events.append({
                            "type": "event",
                            "timestamp": round(elapsed, 1),
                            "message": f"{sensor_name}: Lost contact \u2014 {drones[i].id.upper()}",
                        })

                    previously_detected[drones[i].id] = set(detecting_ids)

                    # Update drone state
                    detected = len(detecting_ids) > 0
                    drones[i] = drones[i].model_copy(update={
                        "detected": detected,
                        "sensors_detecting": detecting_ids,
                        "confidence": confidence,
                    })

                    # Update sensor runtime detecting lists
                    for sr in sensor_runtime:
                        if drones[i].id in sr["detecting"]:
                            sr["detecting"].remove(drones[i].id)
                        if sr["id"] in detecting_ids:
                            sr["detecting"].append(drones[i].id)

            # Build state message
            tracks = []
            for drone in drones:
                if drone.detected or drone.neutralized:
                    tracks.append({
                        "id": drone.id,
                        "dtid_phase": drone.dtid_phase.value,
                        "affiliation": drone.affiliation.value,
                        "x": round(drone.x, 3),
                        "y": round(drone.y, 3),
                        "altitude_ft": round(drone.altitude),
                        "speed_kts": round(drone.speed),
                        "heading_deg": round(drone.heading, 1),
                        "confidence": drone.confidence,
                        "classification": drone.classification.value if drone.classification else None,
                        "trail": drone.trail,
                        "sensors_detecting": drone.sensors_detecting,
                        "neutralized": drone.neutralized,
                    })

            state_msg = {
                "type": "state",
                "elapsed": round(elapsed, 1),
                "time_remaining": round(time_remaining, 1),
                "threat_level": _threat_level(drones),
                "tracks": tracks,
                "sensors": [
                    {
                        "id": sr["id"],
                        "status": sr["status"],
                        "detecting": sr["detecting"],
                    }
                    for sr in sensor_runtime
                ],
                "effectors": [
                    {
                        "id": es["id"],
                        "status": es["status"],
                    }
                    for es in effector_states
                ],
            }
            await ws.send_json(state_msg)

            # Send events
            for event in events:
                await ws.send_json(event)

            # Check timeout
            if time_remaining <= 0:
                phase = GamePhase.DEBRIEF
                break

            # Check all drones defeated
            if all(d.neutralized for d in drones):
                phase = GamePhase.DEBRIEF
                break

            # Check for player input (non-blocking)
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=tick_rate)
                msg_type = msg.get("type")

                if msg_type == "action":
                    action_name = msg.get("action", "")
                    target_id = msg.get("target_id", drones[0].id if drones else "")

                    if action_name == "confirm_track":
                        # Transition DETECTED -> TRACKED
                        for j, d in enumerate(drones):
                            if d.id == target_id and d.dtid_phase == DTIDPhase.DETECTED:
                                drones[j] = d.model_copy(update={
                                    "dtid_phase": DTIDPhase.TRACKED,
                                })
                                confirm_times[target_id] = elapsed
                                actions.append(PlayerAction(
                                    action="confirm_track",
                                    target_id=target_id,
                                    timestamp=elapsed,
                                ))
                                await ws.send_json({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"OPERATOR: Track {target_id.upper()} confirmed",
                                })

                    elif action_name == "identify":
                        # Transition TRACKED -> IDENTIFIED
                        classification = msg.get("classification")
                        affiliation = msg.get("affiliation", "unknown")

                        for j, d in enumerate(drones):
                            if d.id == target_id and d.dtid_phase == DTIDPhase.TRACKED:
                                new_affil = Affiliation(affiliation)
                                drones[j] = d.model_copy(update={
                                    "dtid_phase": DTIDPhase.IDENTIFIED,
                                    "classification": classification,
                                    "classified": True,
                                    "affiliation": new_affil,
                                })
                                identify_times[target_id] = elapsed
                                classification_given[target_id] = classification
                                affiliation_given[target_id] = affiliation
                                confidence_at_identify[target_id] = d.confidence
                                actions.append(PlayerAction(
                                    action="identify",
                                    target_id=target_id,
                                    classification=classification,
                                    affiliation=affiliation,
                                    timestamp=elapsed,
                                ))
                                await ws.send_json({
                                    "type": "event",
                                    "timestamp": round(elapsed, 1),
                                    "message": f"OPERATOR: {target_id.upper()} identified as {classification} ({affiliation})",
                                })

                    elif action_name == "engage":
                        # Engage target with effector
                        effector_id = msg.get("effector", "")
                        eff_state = _find_effector_config(effector_states, effector_id)

                        if eff_state and eff_state["status"] == "ready":
                            for j, d in enumerate(drones):
                                if d.id == target_id:
                                    effectiveness = _effector_effectiveness(
                                        eff_state["type"], d.drone_type.value
                                    )
                                    neutralized = effectiveness > 0.5
                                    drones[j] = d.model_copy(update={
                                        "dtid_phase": DTIDPhase.DEFEATED,
                                        "neutralized": neutralized,
                                    })
                                    engage_times[target_id] = elapsed
                                    effector_used[target_id] = eff_state["type"]
                                    actions.append(PlayerAction(
                                        action="engage",
                                        target_id=target_id,
                                        effector=effector_id,
                                        timestamp=elapsed,
                                    ))

                                    # Handle effector recharge
                                    if eff_state["recharge_seconds"] > 0:
                                        eff_state["status"] = "recharging"
                                        eff_state["recharge_remaining"] = float(
                                            eff_state["recharge_seconds"]
                                        )
                                    else:
                                        # Single use (kinetic, interceptor)
                                        eff_state["status"] = "offline"

                                    # Send engagement result
                                    await ws.send_json({
                                        "type": "engagement_result",
                                        "target_id": target_id,
                                        "effector": effector_id,
                                        "effective": neutralized,
                                        "effectiveness": round(effectiveness, 2),
                                    })

                                    result_str = "NEUTRALIZED" if neutralized else "INEFFECTIVE"
                                    await ws.send_json({
                                        "type": "event",
                                        "timestamp": round(elapsed, 1),
                                        "message": f"ENGAGEMENT: {eff_state['name']} vs {target_id.upper()} \u2014 {result_str}",
                                    })
                                    break

                elif msg_type == "restart":
                    break

            except asyncio.TimeoutError:
                pass

        # -- Debrief --
        # Score per drone (use first drone for now)
        primary_drone_id = drones[0].id if drones else ""
        score = calculate_score(
            scenario=scenario,
            actions=actions,
            detection_time=detection_times.get(primary_drone_id, 0.0),
            confirm_time=confirm_times.get(primary_drone_id),
            identify_time=identify_times.get(primary_drone_id),
            engage_time=engage_times.get(primary_drone_id),
            classification_given=classification_given.get(primary_drone_id),
            affiliation_given=affiliation_given.get(primary_drone_id),
            effector_used=effector_used.get(primary_drone_id),
            drone_reached_base=drone_reached_base,
            confidence_at_identify=confidence_at_identify.get(primary_drone_id, 0.0),
        )

        await ws.send_json({
            "type": "debrief",
            "score": score.model_dump(),
            "drone_reached_base": drone_reached_base,
        })

        # Keep connection open for client to read debrief or restart
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "restart":
                    break
        except WebSocketDisconnect:
            pass

    except WebSocketDisconnect:
        pass
