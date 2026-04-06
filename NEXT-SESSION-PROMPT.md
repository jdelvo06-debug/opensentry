# Claude Code Session Prompt — Base Defense Architect v2

Copy-paste this into Claude Code when you're ready to continue.

---

## The Prompt

```
Read CLAUDE.md for full project context. I'm continuing work on the Base Defense Architect v2.

## Current State
Branch: claude/loving-visvesvaraya (PR pending)
Worktree: .claude/worktrees/loving-visvesvaraya/

### What's done:
- Viewshed 10m caching bug fixed + elevation API retry with backoff
- Base template selection dropdown (Small FOB, Medium Airbase, Large Installation)
- Custom location search via Nominatim geocoding
- Editable boundary polygon (drag vertices, insert midpoints, right-click delete)
- Terrain features, protected assets, approach corridors rendered on map
- Viewshed for ALL systems except JACKAL (jammers + Shenobi included)
- Shared map components: components/map/ (BoundaryEditor, TerrainOverlay, AssetMarkers, CorridorLines, LocationSearch, mapConstants, mapGeometry)
- PlacementScreen refactored to consume shared components (-292 lines)
- 38/38 tests passing, build clean

### Known bugs:
- Viewshed sampling inconsistency: co-located systems show slightly different terrain shadows (different elevation API sample points per fetch)
- Elevation API rate limiting can cause fallback circles when placing many systems quickly

### What to build next (in priority order):

1. FINISH TESTING current build — test base templates, location search, boundary editing, all system types

2. PLACEMENT UX POLISH
   - Equipment count limits from base template (max_sensors, max_effectors) — show in UI, warn when exceeded
   - Loadout summary panel showing placed equipment counts by category
   - Support placing multiple of the same equipment type
   - Equipment list in sidebar showing all placed systems with click-to-select

3. EXPORT TO MISSION (the big feature)
   - Wire the EXPORT TO MISSION button to generate a PlacementConfig
   - PlacementConfig built from: placed systems (lat/lng -> game XY), boundary vertices, asset positions
   - Launch scenario select with the pre-loaded placement
   - Pass PlacementConfig through to useGameEngine.connect() — same path as custom mission flow
   - The architect design becomes a real playable mission

4. VIEWSHED CONSISTENCY FIX
   - Cache elevation data per location (lat/lng grid) so all systems at the same spot share identical terrain samples
   - This fixes the visual inconsistency where co-located systems show slightly different shadows

5. SAVE/LOAD DESIGNS
   - Save architect designs to localStorage or JSON file export
   - Load previous designs back into the architect
   - Share designs between users (JSON import/export)

### Key files:
- frontend/src/components/BaseDefenseArchitect.tsx — main component (~2000 lines)
- frontend/src/components/map/ — shared map components (6 files)
- frontend/src/components/PlacementScreen.tsx — already uses shared components
- frontend/src/types.ts — BaseTemplate, PlacementConfig, PlacedEquipment types
- frontend/src/utils/coordinates.ts — gameXYToLatLng, latLngToGameXY
- frontend/public/data/bases/ — base template JSON files
- frontend/public/data/equipment/catalog.json — equipment definitions

### Design docs:
- docs/superpowers/specs/2026-04-05-base-defense-architect-improvements-design.md
- docs/superpowers/plans/2026-04-05-base-defense-architect-improvements.md
```

---

*This file is committed to the repo. After cloning or switching to the worktree, open it and paste the prompt section into Claude Code.*
