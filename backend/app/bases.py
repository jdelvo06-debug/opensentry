"""Base template and equipment catalog loaders."""

from __future__ import annotations

import json
from pathlib import Path

from app.models import BaseTemplate, EquipmentCatalog

BASES_DIR = Path(__file__).parent.parent / "bases"
EQUIPMENT_DIR = Path(__file__).parent.parent / "equipment"


def load_base(base_id: str) -> BaseTemplate:
    path = BASES_DIR / f"{base_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Base template not found: {base_id}")
    with open(path) as f:
        data = json.load(f)
    return BaseTemplate(**data)


def list_bases() -> list[dict]:
    bases = []
    for path in sorted(BASES_DIR.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        bases.append({
            "id": data["id"],
            "name": data["name"],
            "description": data["description"],
            "size": data["size"],
            "max_sensors": data["max_sensors"],
            "max_effectors": data["max_effectors"],
        })
    return bases


def load_equipment_catalog() -> EquipmentCatalog:
    path = EQUIPMENT_DIR / "catalog.json"
    if not path.exists():
        raise FileNotFoundError("Equipment catalog not found")
    with open(path) as f:
        data = json.load(f)
    return EquipmentCatalog(**data)
