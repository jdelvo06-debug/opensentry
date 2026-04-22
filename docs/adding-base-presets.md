# Adding Curated Base Presets to BDA

This guide explains how to add a new real-world installation preset to the Base Defense Architect (BDA) location search.

## Overview

When a user searches for a location in BDA, the search results are checked against a preset alias index. If a match is found, a **"Preset boundary available"** badge is shown in search.

Curated presets and user-saved custom presets now follow separate rules:
- Curated library presets live at `frontend/public/data/bases/<base_id>.json`
- On GitHub Pages, ad hoc user saves are stored in browser local storage and are **not shared**
- Local/backend-only save flows may serialize `custom_<slug>.json`, but those are draft artifacts, not the shared source of truth
- Shared presets must never overwrite the curated preset library

Adding a new shared base normally requires only two repo files plus an optional import step for traced polygons.

## Files to Know

| File | Purpose |
|------|---------|
| `frontend/public/data/bases/preset-aliases.json` | Maps search aliases to preset IDs |
| `frontend/public/data/bases/<base_id>.json` | Curated base template with boundary polygon |
| `scripts/import_geojson_preset.py` | Imports a traced GeoJSON polygon into a curated preset |
| `frontend/src/components/bda/BdaBaseSelection.tsx` | Search + preset loading logic (do not modify unless fixing a bug) |

## Authoritative Workflow (Use This)

This is the current default for new curated presets:

1. Start from a **real aerodrome boundary**.
   Sources: OSM aerodrome way/relation or a manual trace in `geojson.io`.
2. Convert that outline into the preset format.
   Preferred: import a traced GeoJSON via `scripts/import_geojson_preset.py`.
3. Simplify carefully.
   Preserve the distinctive installation shape and corners; do not over-round it.
4. Make only minimal local edits.
   Small nudges are fine if existing runway/support geometry clips outside the outline.
5. Verify in-app.
   Pages/local smoke test is the final authority, not the raw source data.

### Deprecated Workflow (Do Not Use As Default)

Do **not** author new curated presets by:

- taking a runway midpoint and applying a blanket margin/buffer around it
- generating a symmetric oval around dual runways
- merging output from `wip/preset-generation-script` without a visual traced pass

Those methods produced many of the "big circle around the runway" presets we had to clean up.

## Step 1 — Add Aliases

Edit `frontend/public/data/bases/preset-aliases.json` and add an entry:

```json
{
  "id": "aviano_ab",
  "aliases": ["Aviano", "Aviano AB", "Aviano Air Base", "LIPA", "Aviano Italy"],
  "baseFile": "aviano_ab"
}
```

- `id` and `baseFile` should both match the curated template filename (without `.json`)
- Aliases are case-insensitive matched against the search text
- Include: full name, abbreviations, ICAO/IATA codes, common variants

## Step 2 — Create the Template

Create `frontend/public/data/bases/<base_id>.json` matching the existing template structure (see `osan_ab.json` or `aviano_ab.json` as reference).

### Key fields

```json
{
  "id": "aviano_ab",
  "name": "Aviano Air Base",
  "size": "medium",
  "description": "...",
  "center_lat": 46.032,
  "center_lng": 12.597,
  "default_zoom": 14,
  "placement_bounds_km": 2.5,
  "boundary": [[x_km, y_km], ...],
  ...
}
```

- `boundary` is an array of `[x, y]` offsets **in kilometers from the center point**
- `placement_bounds_km` should be ~5% larger than the max boundary extent
- `size`: `"small"`, `"medium"`, or `"large"` (affects equipment slot limits)

### Polygon quality bar

- **Source preference**: OSM aerodrome way/relation or a hand trace in `geojson.io`
- **Simplify**: aim for ~18–30 vertices when needed; preserve key shape, runway axis, and corners
- **Not a runway bubble**: the polygon should follow the installation footprint, not just the runway envelope
- **Assets/terrain**: keep broad and believable — do not fake precise coordinates
- **Runway**: include a basic runway polygon if useful; use public reference data

### Easiest tracing workflow: `geojson.io`

If you want a better manual tool than hand-editing boundary numbers, the easiest path is:

1. Open [geojson.io](https://geojson.io/)
2. Zoom to the base on the satellite layer
3. Trace the installation perimeter as a single polygon
4. Save/export the GeoJSON
5. Import it into the preset with:

```bash
python3 scripts/import_geojson_preset.py \
  --preset <base_id> \
  --geojson /absolute/path/to/<base_id>.geojson
```

What the importer does:
- derives a new `center_lat` / `center_lng` from the traced polygon
- converts the traced polygon into local `[x_km, y_km]` boundary coordinates
- rebases existing `protected_assets` and `terrain` so they stay in the same real-world place
- recalculates `placement_bounds_km`

This is currently the easiest "better tool" to integrate into the repo because it needs no paid software and no custom app changes. It is now the preferred path for any base where the old OSM/buffered preset looks too oval or generic.

### Higher-fidelity options

- **QGIS**: best serious option for tracing + inspection, but more setup
- **Google Earth Pro**: good for manual tracing, but less repo-friendly than GeoJSON
- **OSM / Overpass**: useful as a starting footprint, but often too broad or messy by itself

### Source lookup helpers

```bash
curl -s 'https://overpass-api.de/api/interpreter' \
  -d 'data=[out:json];way(<south>,<west>,<north>,<east>)[aeroway=aerodrome];out geom;'
```

Replace the bounding box with approximate coords around the target base.

If Overpass times out, use the standard OSM API once you know the way/relation ID:

```bash
curl -s "https://www.openstreetmap.org/api/0.6/way/<WAY_ID>/full.json"
curl -s "https://www.openstreetmap.org/api/0.6/relation/<RELATION_ID>/full.json"
```

Use these as source geometry for tracing/simplification, not as a justification to skip the in-app visual pass.

## Step 3 — Verify

```bash
cd frontend
npm test          # must pass 62/62
npx vite build    # must succeed
```

Also do a quick in-app smoke test:
1. Open BDA
2. Search for the base by name and by ICAO code
3. Confirm the preset badge appears
4. Select it — verify the curated polygon loads and looks correct
5. Edit a vertex — confirm editing still works
6. Launch mission — confirm polygon carries through to mission map

For custom search saves, verify separately:
1. Search a location that is not already in the curated library
2. Confirm it starts from a generic editable polygon
3. Save the perimeter
4. Refresh and re-search it in Custom Mission and BDA
5. Confirm the saved boundary reloads
   On GitHub Pages, this is browser-local only and should not be treated as a shared preset

## Step 4 — Commit and PR

```bash
git add frontend/public/data/bases/<base_id>.json \
        frontend/public/data/bases/preset-aliases.json
git commit -m "Add curated <Base Name> preset"
git push -u origin feature/bda-preset-<base_id>
gh pr create --base main --head feature/bda-preset-<base_id> \
  --title "Add curated <Base Name> preset" \
  --body "..."
gh pr merge <pr_number> --merge --delete-branch
gh issue close <issue_number> --comment "..."
```

## Notes

- Preset polygons are training approximations, not survey-grade perimeters
- Sources used should be noted in the template JSON under a `"source"` field if desired
- Additional bases can be added independently; each is a self-contained PR
- Runtime-generated custom presets should not be committed unless you are intentionally promoting them into a curated workflow
- GitHub Pages browser saves are local only; the shared source of truth is always the curated JSON committed to the repo
- No code changes to `BdaBaseSelection.tsx` are needed for new curated presets
