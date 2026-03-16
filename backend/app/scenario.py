"""Scenario engine -- loads and manages JSON scenario files."""

from __future__ import annotations

import json
from pathlib import Path

from app.models import ScenarioConfig

SCENARIOS_DIR = Path(__file__).parent.parent / "scenarios"


def load_scenario(scenario_id: str) -> ScenarioConfig:
    path = SCENARIOS_DIR / f"{scenario_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Scenario not found: {scenario_id}")

    with open(path) as f:
        data = json.load(f)

    return ScenarioConfig(**data)


def list_scenarios() -> list[dict]:
    scenarios = []
    for path in SCENARIOS_DIR.glob("*.json"):
        with open(path) as f:
            data = json.load(f)
        scenarios.append({
            "id": data["id"],
            "name": data["name"],
            "description": data["description"],
            "difficulty": data["difficulty"],
        })
    return scenarios
