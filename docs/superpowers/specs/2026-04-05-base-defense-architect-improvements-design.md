# Base Defense Architect Improvements — Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Scope:** Fix viewshed bug, add base template selection + location search, render base overlays

---

## Context

The Base Defense Architect (BDA) is a standalone beta tool for planning sensor/effector placement on a satellite map with terrain-aware viewshed analysis. Currently hardcoded to Shaw AFB with no base template integration, no location search, and a viewshed caching bug at 10m altitude.

The main mission flow (ScenarioSelect + PlacementScreen) already supports base template selection, custom location search via Nominatim, editable boundary polygons, terrain features, protected assets, and approach corridors. The BDA has none of this.

**Goal:** Bring the BDA to parity with the main mission flow's base/placement features so that Architect designs can eventually be exported into actual missions.

---

## 1. Viewshed Bug Fix

### Problem

When a system is placed, altitude defaults to `10` (line 594 of BaseDefenseArchitect.tsx). A viewshed fetch fires immediately. If the elevation API call fails or races during state initialization, the `.catch` fallback creates a circular polygon (no terrain masking) and caches it at key `lat,lng,10,rangeKm`.

Later, selecting the "10m Mast" preset calls `handleAltitudeChange`, which does NOT clear the cache before re-fetching. `fetchViewshedForSystem` finds the cached fallback circle and returns it — the user sees a full range ring with no terrain shadows at 10m, while 2m and 30m work correctly (different cache keys, fresh API calls).

### Fix

1. **Cache invalidation in `handleAltitudeChange`:** Delete the OLD cache entry (at the previous altitude) before setting `viewshedLoading` and calling `fetchViewshedForSystem`. Mirror the pattern already used in `handleRecalculate`.

2. **Never cache fallback results:** In the `.catch` handler (lines 660-685), do NOT call `viewshedCache.set()`. Only cache successful `computeViewshed` results from the `.then` path.

3. **Guard initial fetch timing:** After `setSystems()` in `handlePlace`, use a microtask (`queueMicrotask` or move the fetch into a `useEffect` triggered by system addition) to ensure state is settled before the first viewshed fetch.

---

## 2. Base Template Selection + Location Search

### Current State

Map hardcoded to Shaw AFB (33.9722N, 80.4756W), zoom 14. No way to change location or load base data.

### Design

Replace the static header with a **top bar** containing:

#### 2a. Base Template Dropdown

- Fetches `data/bases/index.json` on mount (same source as ScenarioSelect)
- Dropdown lists available bases: Small FOB, Medium Airbase, Large Installation
- Selecting a base:
  - Fetches `data/bases/{baseId}.json`
  - Flies the map to `center_lat`/`center_lng` at `default_zoom`
  - Loads boundary, terrain, protected assets, approach corridors into component state
  - Sets equipment limit indicators (informational, not enforced in beta)
- Default: no base selected (free placement mode, current behavior)
- Switching base or location clears all placed equipment and resets the map (with a confirmation prompt if systems are placed)

#### 2b. Location Search Bar (Nominatim Geocoding)

- Text input with debounced search (300ms)
- Queries Nominatim OpenStreetMap API: `https://nominatim.openstreetmap.org/search?format=json&q={query}`
- Dropdown shows autocomplete results (name, country)
- Selecting a result:
  - Flies the map to the result coordinates
  - Creates a synthetic base using `small_fob` defaults at the custom coordinates (same pattern as App.tsx `handleScenarioSelect` for custom locations)
  - Clears any previously loaded base template overlays

#### 2c. Coordinate Display

- Shows current map center lat/lng (existing behavior, keep as-is)

### Data Flow

```
User selects base template
  -> fetch data/bases/{id}.json
  -> parse as BaseTemplate (same type used by game engine)
  -> store in component state: baseTemplate
  -> derive: boundary vertices, terrain features, assets, corridors
  -> render overlays on map

User searches custom location
  -> Nominatim geocoding
  -> fly map to coordinates
  -> create synthetic BaseTemplate with small_fob defaults
  -> same overlay rendering path
```

---

## 3. Base Overlays on the Architect Map

Port PlacementScreen's map overlays into the Architect, extracted as shared components.

### 3a. Editable Boundary Polygon

- Orange dashed perimeter line with semi-transparent orange fill
- Draggable vertex handles (orange circles, ~10px radius)
- Right-click vertex to delete (minimum 3 vertices enforced)
- Click midpoint handles (smaller circles between vertices) to insert new vertex
- Centroid label: vertex count + area in km² (shoelace formula)
- Coordinates stored in game XY (km from base center), converted to lat/lng via `gameXYToLatLng()` from `utils/coordinates.ts`
- Changes update local state (not persisted until future export feature)

### 3b. Terrain Features

- Rendered from `baseTemplate.terrain[]` as Leaflet polygons
- Type-specific colors:
  - `building` -> gray (#6e7681)
  - `berm` -> brown (#8b6914)
  - `treeline` -> green (#2ea043)
  - `runway` -> dark gray (#484f58)
  - `tower` -> light gray (#8b949e)
- Features with `blocks_los: true` get a dashed red outline
- Labels at polygon centroid (feature name)

### 3c. Protected Assets

- Star/diamond markers colored by priority:
  - Priority 1 (critical): red (#f85149)
  - Priority 2 (important): orange (#d29922)
  - Priority 3 (standard): green (#2ea043)
- Draggable to adjust positions
- Tooltip on hover showing asset name + priority level
- Position changes tracked in state for future PlacementConfig export

### 3d. Approach Corridors

- Dashed lines radiating from base center at corridor bearing
- Length = `placement_bounds_km` or max sensor range, whichever is larger
- Labeled with corridor name + bearing in degrees
- Semi-transparent wedge showing corridor `width_deg` (if defined in base template)
- Color: muted gray (#484f58) to avoid visual competition with sensor coverage

---

## 4. Shared Component Extraction

To manage file size (BaseDefenseArchitect.tsx is 1,898 lines) and enable reuse between PlacementScreen and BDA:

| New Module | Contents | Consumers |
|-----------|----------|-----------|
| `components/map/BoundaryEditor.tsx` | Editable polygon with vertex handles, midpoint insertion, area calc | PlacementScreen, BDA |
| `components/map/TerrainOverlay.tsx` | Terrain feature polygon rendering with type colors + LOS indicators | PlacementScreen, BDA |
| `components/map/AssetMarkers.tsx` | Draggable priority-colored asset markers | PlacementScreen, BDA |
| `components/map/CorridorLines.tsx` | Approach corridor radial lines with labels | PlacementScreen, BDA |
| `components/map/LocationSearch.tsx` | Nominatim search bar with autocomplete dropdown | ScenarioSelect, BDA |

PlacementScreen will be refactored to consume these shared components instead of its current inline implementations. This is a targeted improvement that directly serves the current goal (code sharing), not unrelated cleanup.

---

## 5. Data Structure Compatibility

All state in the Architect uses the same types as the game engine:

- `BaseTemplate` for loaded base data
- `PlacedEquipment` for sensor/effector positions (already used)
- `PlacementConfig` for the eventual export payload
- Game XY coordinate system (km from base center) for boundary/assets
- `gameXYToLatLng()` / `latLngToGameXY()` for map rendering

This ensures that when the export feature is built (future scope), the Architect's output is directly consumable by `useGameEngine.connect()`.

---

## 6. Out of Scope

- Export/save button (future iteration)
- Placement scoring / coverage analysis against corridors (future)
- Equipment limits enforcement (informational only for now)
- PlacementScreen refactoring beyond extracting the shared components listed above
- New base templates or base JSON changes
