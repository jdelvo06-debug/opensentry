# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Current: Base Defense Architect v2 — Unified with Custom Mission Flow

### The Vision

**Base Defense Architect should mirror the Custom Mission setup exactly:**

1. **Equipment Selection** — Pick your sensors and effectors from the catalog (same as Custom Mission)
2. **Base Perimeter** — Drag to define the defended area on the map (same as Custom Mission)
3. **The Key Difference:** See **actual radar coverage** based on altitude and terrain (viewshed visualization)
4. **Export** — Save your design directly into a playable Custom Mission

### Why This Approach

- **Single UX pattern** — Users learn one interface, use it for both quick missions and detailed planning
- **Immediate feedback** — See coverage gaps BEFORE you play, fix them in the architect
- **Terrain matters** — Buildings, hills, and trees block LOS; place systems to cover actual approach corridors
- **Reusable designs** — Save good setups, share with unit, load for training scenarios

### What's Already Built (from original PR #60)

- ✅ Viewshed 10m caching bug fixed + elevation API retry with backoff
- ✅ Base template selection (Small FOB, Medium Airbase, Large Installation)
- ✅ Custom location search via Nominatim geocoding
- ✅ Editable boundary polygon with vertex handles
- ✅ Terrain features, protected assets, approach corridors on map
- ✅ Viewshed for all systems except JACKAL (jammers + Shenobi included)
- ✅ Shared map components extracted (BoundaryEditor, TerrainOverlay, AssetMarkers, etc.)
- ✅ PlacementScreen refactored to use shared components

### What's Next

**Priority 1: Unify with Custom Mission Setup**
- Port Custom Mission's equipment selection UI into BaseDefenseArchitect
- Replace current equipment sidebar with the familiar catalog picker
- Keep the terrain-aware viewshed as the "killer feature" differentiator

**CRITICAL: Per-System Coverage Toggle**
- When placing a system, show **that system's coverage only** at its specific altitude
- Toggle individual systems on/off to compare coverage patterns
- Allow "show all" but default to isolating the active system
- This lets operators analyze gaps: "What does TPQ-50 at 50m cover? What about Shenobi at 30m? Where's the overlap?"

**Priority 2: Export to Mission**
- Wire "EXPORT TO MISSION" button to generate PlacementConfig
- Build PlacementConfig from: selected equipment, placed positions (lat/lng → game XY), boundary vertices
- Launch into Custom Mission with pre-loaded placement
- Use existing useGameEngine.connect() path

**Priority 3: Save/Load Designs**
- JSON export/import for architect designs
- Share designs between users
- Load previous designs to iterate

**Priority 4: Polish**
- Equipment count limits from base template
- Loadout summary panel
- Coverage analysis vs. approach corridors

### Key Files

- `frontend/src/components/BaseDefenseArchitect.tsx` — main architect component
- `frontend/src/components/CustomMissionScreen.tsx` — reference for equipment selection UI
- `frontend/src/components/PlacementScreen.tsx` — uses shared components, export target
- `frontend/src/types.ts` — BaseTemplate, PlacementConfig, PlacedEquipment types
- `frontend/public/data/equipment/catalog.json` — equipment definitions
- `frontend/public/data/bases/` — base template JSON files

### Reference: Custom Mission Flow

```
Custom Mission:
1. Select Equipment → 2. Drag Base Perimeter → 3. Play Mission

Base Defense Architect (new):
1. Select Equipment → 2. Drag Base Perimeter → 3. See Viewshed Coverage → 4. Export to Mission
```

The difference is step 3: terrain-aware coverage visualization before you commit to playing.

---

## The Prompt

```
Read CLAUDE.md for full project context.

I'm working on Base Defense Architect v2. The goal is to unify it with the Custom Mission flow:

Current Custom Mission:
1. Select equipment from catalog
2. Drag base perimeter on map
3. Play

New Base Defense Architect:
1. Select equipment from catalog (SAME as Custom Mission)
2. Drag base perimeter on map (SAME as Custom Mission)
3. See terrain-aware viewshed coverage (THE DIFFERENTIATOR)
4. Export to playable mission

Start by studying CustomMissionScreen.tsx to understand the equipment selection pattern, then port/adapt that UI into BaseDefenseArchitect.tsx. Keep the viewshed visualization that's already built.

Focus on making the UX feel consistent between Custom Mission and Base Defense Architect.

**Important:** Implement per-system coverage toggle from the start. When a user places a sensor/effector, show only that system's coverage at its altitude. Add checkboxes/toggles to show/hide individual systems. This is the core analysis feature.
```

---

*This file documents the unified vision for BDA v2. Updated 2026-04-08.*
