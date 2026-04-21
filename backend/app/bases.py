"""Base template and equipment catalog loaders."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.models import BaseTemplate, EquipmentCatalog

BASES_DIR = Path(__file__).parent.parent / "bases"
EQUIPMENT_DIR = Path(__file__).parent.parent / "equipment"

GENERIC_TEMPLATE_IDS = {"small_fob", "medium_airbase", "large_installation"}


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


def get_preset_base_ids() -> list[str]:
    """Return all preset base IDs from disk, excluding generic templates."""
    return [
        path.stem
        for path in sorted(BASES_DIR.glob("*.json"))
        if path.stem not in GENERIC_TEMPLATE_IDS
    ]


def save_base_polygon(
    base_id: str,
    boundary: list,
    center_lat: float | None,
    center_lng: float | None,
) -> None:
    """Write a new boundary polygon back to the preset JSON file.

    Creates the file from medium_airbase.json if it doesn't exist yet (custom location).
    Always writes a .bak copy before modifying an existing file.
    """
    path = BASES_DIR / f"{base_id}.json"
    if path.exists():
        shutil.copy2(path, path.with_suffix(".bak"))
        with open(path) as f:
            data = json.load(f)
    else:
        template_path = BASES_DIR / "medium_airbase.json"
        with open(template_path) as f:
            data = json.load(f)
        data["id"] = base_id
        data["name"] = base_id.replace("_", " ").title()

    data["boundary"] = boundary
    if center_lat is not None:
        data["center_lat"] = center_lat
    if center_lng is not None:
        data["center_lng"] = center_lng

    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_equipment_catalog() -> EquipmentCatalog:
    path = EQUIPMENT_DIR / "catalog.json"
    if not path.exists():
        raise FileNotFoundError("Equipment catalog not found")
    with open(path) as f:
        data = json.load(f)
    return EquipmentCatalog(**data)
