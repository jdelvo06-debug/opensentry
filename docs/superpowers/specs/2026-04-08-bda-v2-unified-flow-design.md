# BDA v2 — Unified with Custom Mission Flow

**Date:** 2026-04-08
**Status:** Approved
**Branch:** feat/bda-placement-ux

## Goal

Refactor Base Defense Architect from a 2830-line monolith into a step-based flow that mirrors Custom Mission's UX pattern: Base → Equip → Place → Export. Keep the terrain-aware viewshed visualization as BDA's differentiator.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Stepper refactor (Approach A) | UX parity with Custom Mission + decompose monolith (two problems, one refactor) |
| Step order | Base → Equip → Place → Export | Base first so equipment selection can enforce base limits |
| Equipment selection | LoadoutScreen-style qty counters with enriched BDA cards | Same +/- pattern users learn in Custom Mission, but cards show LOS, range, FOV |
| Scenario selection | Picker at export time | Keeps BDA focused on placement design; scenario is a launch-time concern |
| Equipment card design | Enriched over LoadoutScreen | BDA is the planning tool — operators need range/FOV/LOS info during selection |

## Step Flow

### Step 1: Base Selection
- Base template cards: Small FOB, Medium Airbase, Large Installation
- Custom location search via Nominatim geocoding (existing)
- Shows base info: max sensors, max effectors, boundary preview
- **Output:** `baseTemplate: BaseTemplate`, `mapCenter: [lat, lng]`
- **Next enabled:** when base selected

### Step 2: Equipment Selection
- Full-screen catalog view (like LoadoutScreen)
- Enriched cards: name, type tag (SENSOR/EFFECTOR/COMBINED), LOS badge, range, FOV stats
- +/- quantity buttons per equipment type
- Enforces `baseTemplate.max_sensors` and `baseTemplate.max_effectors`
- Filter tabs: ALL | SENSORS | EFFECTORS | COMBINED
- Header shows live limit counters ("2/4 sensors, 1/4 effectors")
- Color-coded card borders: blue (sensor), red (effector), purple (combined)
- Combined systems (Shenobi) show dual stats: detect range (blue) + defeat range (red)
- **Output:** `selectedSensors[]`, `selectedEffectors[]`, `selectedCombined[]`
- **Next enabled:** when ≥1 equipment selected

### Step 3: Placement & Viewshed
- Full map view with base boundary overlay
- Left sidebar: equipment palette (selected equipment as clickable cards, click → placement mode)
- Instance labels for duplicates: "L-Band Radar #1", "L-Band Radar #2"
- Click map to place system at lat/lng
- Draggable system markers (existing DraggableSystemMarker)
- Right panel: selected system detail
  - Altitude slider + presets (LOW/MED/HIGH bands)
  - Facing controls for narrow-FOV systems (±5°, ±15°)
  - Per-system coverage visibility toggle (existing)
  - SHOW ALL / HIDE ALL bulk toggles
- Viewshed visualization for LOS systems (existing: 72 rays × 0.15km, Open-Elevation API, LRU cache)
- Range rings for non-LOS systems
- FOV wedges for narrow-FOV systems (EO/IR Camera)
- Placement count header: "X/Y placed"
- **Output:** `PlacedSystem[]` with uid, lat/lng, altitude, facing, visible
- **Next enabled:** when all selected equipment is placed on the map (every item from step 2 must have a position)

### Step 4: Export
- **Left panel — Coverage Summary:**
  - Systems placed (count by type, color-coded dots)
  - Approach corridor coverage analysis per corridor (COVERED / PARTIAL / GAP with progress bars)
  - Coverage gap warnings with actionable text
- **Right panel — Export Actions:**
  - Scenario picker dropdown (Lone Wolf, Swarm Attack, Recon Probe, Free Play)
  - LAUNCH MISSION button → builds PlacementConfig → `onExportToMission` → phase="running"
  - DOWNLOAD JSON button → saves design as reusable file
- **Back to Placement** and **Back to Menu** buttons

## Navigation Rules

- **Forward:** only when current step's output is valid
- **Back:** always allowed, state preserved (placed systems survive going back to base selection)
- **Direct step click:** only to completed steps (can revisit earlier steps)
- **Changing base:** warns if selected equipment exceeds new base's limits

## Component Architecture

```
frontend/src/components/
  BaseDefenseArchitect.tsx        ← stepper shell (~150 lines)
  bda/
    BdaStepIndicator.tsx          ← step bar UI (~80 lines)
    BdaBaseSelection.tsx          ← step 1 (~200 lines)
    BdaEquipmentSelection.tsx     ← step 2 (~300 lines)
    BdaPlacement.tsx              ← step 3, bulk of logic (~1500 lines)
    BdaExport.tsx                 ← step 4 (~250 lines)
    components/
      BdaEquipmentCard.tsx        ← enriched card with LOS/range/FOV
      SystemDetailPanel.tsx       ← altitude, facing, visibility controls
      EquipmentPalette.tsx        ← left sidebar palette for step 3
      ViewshedOverlay.tsx         ← green/red LOS polygons
      RangeRingOverlay.tsx        ← circles/arcs for non-LOS
      CoverageSummary.tsx         ← corridor coverage analysis
      ScenarioPicker.tsx          ← dropdown for export step
```

## State Management

State lives in the `BaseDefenseArchitect` stepper shell, passed to steps as props:

```typescript
interface BdaState {
  currentStep: 1 | 2 | 3 | 4;
  baseTemplate: BaseTemplate | null;
  mapCenter: [number, number];
  selectedEquipment: {
    sensors: { catalogId: string; qty: number }[];
    effectors: { catalogId: string; qty: number }[];
    combined: { catalogId: string; qty: number }[];
  };
  placedSystems: PlacedSystem[];
  viewshedCache: Map<string, ViewshedResult>;
}
```

Viewshed cache persists across back/forward navigation since it lives in the shell.

## Data Flow: Export to Mission

1. BdaExport builds `PlacementConfig` from `placedSystems`:
   - Convert each system's lat/lng → game XY using `latLngToGameXY()`
   - Group into `sensors[]`, `effectors[]`, `combined[]` arrays of `PlacedEquipment`
   - Include boundary from `baseTemplate.boundary`
   - Include `placement_bounds_km` from base template
2. User selects scenario from dropdown
3. LAUNCH MISSION → calls `onExportToMission(placementConfig, scenarioId, baseId)`
4. App.tsx receives callback → sets phase to "running" → game starts with pre-loaded placement

## What Stays Unchanged

- Viewshed computation logic (72 rays, elevation API, LRU cache)
- Per-system coverage visibility toggle (`PlacedSystem.visible`)
- DraggableSystemMarker component
- System icon factories (circle/diamond/hexagon)
- Altitude slider + presets + altitude band legend
- Facing controls for narrow-FOV systems
- Coordinate conversion utilities (`latLngToGameXY`, `gameXYToLatLng`)
- `PlacementConfig` type and `onExportToMission` callback in App.tsx

## What Gets Deleted

- BDA's inline equipment sidebar (replaced by step 2)
- BDA's inline base selection dropdown (replaced by step 1)
- BDA's inline export buttons (replaced by step 4)
- Redundant state management that's replaced by the stepper shell

## Out of Scope

- Save/load designs (Priority 3 — separate future work)
- Sharing designs between users
- Equipment count limits beyond base template maximums
- Boundary polygon editing in BDA (exists in PlacementScreen, not ported)
- Mobile/responsive layout optimization
