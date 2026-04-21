"""Base template and equipment catalog loaders."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.models import BaseTemplate, EquipmentCatalog

BASES_DIR = Path(__file__).parent.parent / "bases"
EQUIPMENT_DIR = Path(__file__).parent.parent / "equipment"
# Frontend preset directory — this is where the app loads presets from at runtime
FRONTEND_BASES_DIR = Path(__file__).parent.parent.parent / "frontend" / "public" / "data" / "bases"

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
    """Return all preset base IDs from the frontend preset directory, excluding generic templates."""
    scan_dir = FRONTEND_BASES_DIR if FRONTEND_BASES_DIR.exists() else BASES_DIR
    return [
        path.stem
        for path in sorted(scan_dir.glob("*.json"))
        if path.stem not in GENERIC_TEMPLATE_IDS and path.stem not in ("index", "preset-aliases")
    ]


def save_base_polygon(
    base_id: str,
    boundary: list,
    center_lat: float | None,
    center_lng: float | None,
    base_name: str | None = None,
    base_size: str | None = None,
    location_name: str | None = None,
    protected_assets: list | None = None,
    terrain: list | None = None,
) -> None:
    """Write a new boundary polygon back to the frontend preset JSON file.

    Writes to the frontend preset directory (the one the app loads at runtime).
    Always writes a .bak copy before modifying an existing file.
    For new bases (no existing file), creates from medium_airbase template.
    """
    write_dir = FRONTEND_BASES_DIR if FRONTEND_BASES_DIR.exists() else BASES_DIR
    path = write_dir / f"{base_id}.json"
    if path.exists():
        shutil.copy2(path, path.with_suffix(".bak"))
        with open(path) as f:
            data = json.load(f)
    else:
        # New preset — scaffold from the generic medium_airbase template
        template_path = write_dir / "medium_airbase.json"
        with open(template_path) as f:
            data = json.load(f)
        data["id"] = base_id
        data["name"] = base_name or base_id.replace("_", " ").title()
        if base_size:
            data["size"] = base_size

    data["boundary"] = boundary
    if center_lat is not None:
        data["center_lat"] = center_lat
    if center_lng is not None:
        data["center_lng"] = center_lng
    if location_name is not None:
        data["location_name"] = location_name
    if isinstance(protected_assets, list):
        data["protected_assets"] = protected_assets
    if isinstance(terrain, list):
        data["terrain"] = terrain

    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_equipment_catalog() -> EquipmentCatalog:
    path = EQUIPMENT_DIR / "catalog.json"
    if not path.exists():
        raise FileNotFoundError("Equipment catalog not found")
    with open(path) as f:
        data = json.load(f)
    return EquipmentCatalog(**data)
