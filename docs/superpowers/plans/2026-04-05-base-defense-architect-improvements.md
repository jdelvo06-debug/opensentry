# Base Defense Architect Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the viewshed 10m caching bug, add base template selection with location search, and render base overlays (boundary, terrain, assets, corridors) in the Base Defense Architect.

**Architecture:** Extract shared map overlay components from PlacementScreen into reusable modules under `components/map/`. Integrate these into BaseDefenseArchitect alongside a new LocationSearch component and base template loading. Fix viewshed caching by invalidating stale entries and never caching fallback results.

**Tech Stack:** React 19, TypeScript, Leaflet.js, Nominatim OSM geocoding API, Vite

**Spec:** `docs/superpowers/specs/2026-04-05-base-defense-architect-improvements-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/components/map/BoundaryEditor.tsx` | Editable polygon with draggable vertices, midpoint insertion, area label |
| Create | `frontend/src/components/map/TerrainOverlay.tsx` | Terrain feature polygons with type colors and LOS indicators |
| Create | `frontend/src/components/map/AssetMarkers.tsx` | Draggable priority-colored protected asset markers |
| Create | `frontend/src/components/map/CorridorLines.tsx` | Approach corridor radial lines with labels |
| Create | `frontend/src/components/map/LocationSearch.tsx` | Nominatim geocoding search bar with autocomplete |
| Create | `frontend/src/components/map/mapConstants.ts` | Shared constants (terrain styles, priority colors, icon factories) |
| Modify | `frontend/src/components/BaseDefenseArchitect.tsx` | Fix viewshed bug, add base template state, integrate all new components |
| Modify | `frontend/src/components/PlacementScreen.tsx` | Refactor to consume shared map components |
| Create | `frontend/src/__tests__/map-components.test.ts` | Unit tests for shared constants and coordinate-dependent logic |

---

## Task 1: Fix Viewshed 10m Caching Bug

**Files:**
- Modify: `frontend/src/components/BaseDefenseArchitect.tsx` (lines 617-685, 692-716)

This is the highest-priority fix. Three changes: cache invalidation in `handleAltitudeChange`, never cache fallback results, and guard initial fetch timing.

- [ ] **Step 1: Add cache invalidation to handleAltitudeChange**

In `BaseDefenseArchitect.tsx`, find `handleAltitudeChange` (line 692). Add cache deletion of the OLD altitude entry before the state update, matching the pattern already used in `handleRecalculate` (line 725):

```typescript
  const handleAltitudeChange = useCallback(
    (uid: string, newAlt: number) => {
      const sys = systems.find((s) => s.uid === uid);
      if (!sys) return;
      const { lat, lng } = sys;
      // Delete stale cache entry at the OLD altitude
      const oldKey = cacheKey(lat, lng, sys.altitude, sys.def.range_km);
      viewshedCache.delete(oldKey);
      setSystems((prev) =>
        prev.map((s) =>
          s.uid === uid
            ? {
                ...s,
                altitude: newAlt,
                viewshed: null,
                blockedSectors: null,
                viewshedArea: null,
                viewshedStats: null,
                viewshedLoading: sys.def.requires_los,
              }
            : s,
        ),
      );
      if (sys.def.requires_los && sys.def.range_km) {
        fetchViewshedForSystem(uid, lat, lng, newAlt, sys.def.range_km);
      }
    },
    [systems, fetchViewshedForSystem],
  );
```

- [ ] **Step 2: Remove cache write from the fallback handler**

In `fetchViewshedForSystem` (line 617), the `.catch` block (lines 660-685) currently runs after the `.then` which calls `viewshedCache.set()`. The catch handler does NOT currently cache — but verify this. The real issue is that if the initial fetch at altitude 10 fails and creates a fallback, then the `.then` path doesn't run, so no cache is set. However, if it *succeeds* but with bad data during a race condition, it DOES cache.

Add a `isFallback` flag to the result to prevent stale successful results from being cached when the component is mid-state-update. Simpler approach: just delete the cache entry after setting fallback state:

```typescript
        .catch((err) => {
          console.warn("Viewshed fetch failed:", err);
          // Ensure no stale cache entry exists for this position/altitude
          viewshedCache.delete(key);
          const fallbackPoly: [number, number][] = [];
          for (let i = 0; i <= NUM_RAYS; i++) {
            const bearing = (i / NUM_RAYS) * 2 * Math.PI;
            fallbackPoly.push(offsetLatLng(lat, lng, rangeKm, bearing));
          }
          const area = Math.PI * rangeKm * rangeKm;
          setSystems((prev) =>
            prev.map((s) =>
              s.uid === uid
                ? {
                    ...s,
                    viewshed: fallbackPoly,
                    blockedSectors: [],
                    viewshedArea: area,
                    viewshedStats: null,
                    viewshedLoading: false,
                  }
                : s,
            ),
          );
        });
```

- [ ] **Step 3: Guard initial fetch timing in handlePlace**

In `handlePlace` (line 585), the viewshed fetch fires synchronously after `setSystems`. Move it to a microtask so React has time to flush the state update:

```typescript
  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (!placingDef) return;
      const uid = `sys_${++uidCounter.current}`;
      const newSystem: PlacedSystem = {
        uid,
        def: placingDef,
        lat,
        lng,
        altitude: 10,
        facing_deg: 0,
        viewshed: null,
        blockedSectors: null,
        viewshedLoading: false,
        viewshedArea: null,
        viewshedStats: null,
      };
      setSystems((prev) => [...prev, newSystem]);
      setSelectedUid(uid);
      setPlacingDef(null);

      // Defer viewshed fetch to next microtask so state is settled
      if (placingDef.requires_los && placingDef.range_km) {
        const range = placingDef.range_km;
        queueMicrotask(() => {
          fetchViewshedForSystem(uid, lat, lng, 10, range);
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placingDef],
  );
```

- [ ] **Step 4: Test manually**

Run: `cd frontend && npm run dev`

1. Open Base Defense Architect
2. Place an L-Band radar
3. Default altitude is 10m — verify viewshed shows terrain shadows (not a full circle)
4. Switch to 2m — verify viewshed updates with terrain
5. Switch to 30m — verify viewshed updates with terrain
6. Switch back to 10m — verify viewshed shows terrain shadows (not full circle)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BaseDefenseArchitect.tsx
git commit -m "fix: viewshed caching bug at 10m — invalidate cache on altitude change, never cache fallbacks"
```

---

## Task 2: Extract Shared Map Constants

**Files:**
- Create: `frontend/src/components/map/mapConstants.ts`

Extract constants used by both PlacementScreen and BDA into a shared module.

- [ ] **Step 1: Create mapConstants.ts**

```typescript
// frontend/src/components/map/mapConstants.ts
import L from "leaflet";

// ─── Terrain type styles ────────────────────────────────────────────────────

export const TERRAIN_STYLES: Record<
  string,
  { fill: string; stroke: string; label: string }
> = {
  building: { fill: "#6e7681", stroke: "#484f58", label: "Building" },
  tower: { fill: "#8b949e", stroke: "#6e7681", label: "Tower" },
  berm: { fill: "#8b6914", stroke: "#6e4b0a", label: "Berm" },
  treeline: { fill: "#2ea043", stroke: "#1a7f37", label: "Treeline" },
  runway: { fill: "#484f58", stroke: "#30363d", label: "Runway" },
};

// ─── Asset priority colors ──────────────────────────────────────────────────

export const PRIORITY_COLORS: Record<number, string> = {
  1: "#f85149",
  2: "#d29922",
  3: "#2ea043",
};

// ─── Icon factories ─────────────────────────────────────────────────────────

export function createTerrainLabel(name: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      font-size:10px;
      color:#c9d1d9;
      text-shadow:0 0 3px #0a0e1a,0 0 6px #0a0e1a;
      white-space:nowrap;
      text-align:center;
      pointer-events:none;
    ">${name}</div>`,
    iconSize: [80, 16],
    iconAnchor: [40, 8],
  });
}

export function createAssetIcon(priority: number, name: string): L.DivIcon {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS[3];
  return L.divIcon({
    className: "",
    html: `<div style="text-align:center;">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <polygon points="10,0 13,7 20,7 14,12 16,20 10,15 4,20 6,12 0,7 7,7"
          fill="${color}" stroke="#fff" stroke-width="1"/>
      </svg>
      <div style="font-size:9px;color:${color};text-shadow:0 0 3px #0a0e1a;white-space:nowrap;margin-top:-2px;">
        P${priority} ${name}
      </div>
    </div>`,
    iconSize: [80, 32],
    iconAnchor: [40, 10],
  });
}

export function createCornerHandle(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:#d29922;border:2px solid #fff;
      cursor:grab;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function createMidpointHandle(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:8px;height:8px;border-radius:50%;
      background:#d29922;opacity:0.5;border:1px solid #fff;
      cursor:pointer;
    "></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

/** Shoelace formula for polygon area in km² (game XY coordinates) */
export function shoelaceArea(vertices: { x: number; y: number }[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

/** Centroid of a polygon in game XY */
export function verticesCentroid(
  vertices: { x: number; y: number }[],
): { x: number; y: number } {
  const n = vertices.length;
  let cx = 0;
  let cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / n, y: cy / n };
}

/** Centroid of a polygon defined as number[][] */
export function polygonCentroid(polygon: number[][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  const n = polygon.length;
  return [cx / n, cy / n];
}

/** Convert degrees to radians */
export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/map/mapConstants.ts
git commit -m "feat: extract shared map constants — terrain styles, priority colors, icon factories, geometry helpers"
```

---

## Task 3: Create BoundaryEditor Component

**Files:**
- Create: `frontend/src/components/map/BoundaryEditor.tsx`

Extracts the editable polygon from PlacementScreen into a reusable component.

- [ ] **Step 1: Create BoundaryEditor.tsx**

```typescript
// frontend/src/components/map/BoundaryEditor.tsx
import { Polygon, Marker, Tooltip } from "react-leaflet";
import { gameXYToLatLng } from "../../utils/coordinates";
import {
  createCornerHandle,
  createMidpointHandle,
  shoelaceArea,
  verticesCentroid,
} from "./mapConstants";
import L from "leaflet";

interface BoundaryEditorProps {
  vertices: { x: number; y: number }[];
  baseLat: number;
  baseLng: number;
  onChange: (vertices: { x: number; y: number }[]) => void;
}

export default function BoundaryEditor({
  vertices,
  baseLat,
  baseLng,
  onChange,
}: BoundaryEditorProps) {
  const positions = vertices.map((v) =>
    gameXYToLatLng(v.x, v.y, baseLat, baseLng),
  );

  const centroid = verticesCentroid(vertices);
  const centroidLatLng = gameXYToLatLng(centroid.x, centroid.y, baseLat, baseLng);
  const area = shoelaceArea(vertices);

  const handleVertexDrag = (index: number, e: L.LeafletEvent) => {
    const latlng = (e.target as L.Marker).getLatLng();
    // Convert back to game XY
    const kmPerDegLat = 111.32;
    const kmPerDegLng = 111.32 * Math.cos((baseLat * Math.PI) / 180);
    const x = (latlng.lng - baseLng) * kmPerDegLng;
    const y = (latlng.lat - baseLat) * kmPerDegLat;
    const updated = [...vertices];
    updated[index] = { x, y };
    onChange(updated);
  };

  const handleVertexDelete = (index: number) => {
    if (vertices.length <= 3) return;
    const updated = vertices.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleMidpointInsert = (afterIndex: number) => {
    const a = vertices[afterIndex];
    const b = vertices[(afterIndex + 1) % vertices.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const updated = [...vertices];
    updated.splice(afterIndex + 1, 0, mid);
    onChange(updated);
  };

  return (
    <>
      {/* Boundary polygon fill */}
      <Polygon
        positions={positions}
        pathOptions={{
          color: "#d29922",
          weight: 2,
          dashArray: "8,4",
          fillColor: "#d29922",
          fillOpacity: 0.06,
        }}
      />

      {/* Vertex drag handles */}
      {vertices.map((_, i) => (
        <Marker
          key={`vertex-${i}`}
          position={positions[i]}
          icon={createCornerHandle()}
          draggable
          eventHandlers={{
            dragend: (e) => handleVertexDrag(i, e),
            contextmenu: (e) => {
              L.DomEvent.preventDefault(e);
              handleVertexDelete(i);
            },
          }}
        />
      ))}

      {/* Midpoint insertion handles */}
      {vertices.map((_, i) => {
        const next = (i + 1) % vertices.length;
        const midLat = (positions[i][0] + positions[next][0]) / 2;
        const midLng = (positions[i][1] + positions[next][1]) / 2;
        return (
          <Marker
            key={`mid-${i}`}
            position={[midLat, midLng]}
            icon={createMidpointHandle()}
            eventHandlers={{
              click: () => handleMidpointInsert(i),
            }}
          />
        );
      })}

      {/* Centroid label */}
      <Marker
        position={centroidLatLng}
        icon={L.divIcon({
          className: "",
          html: `<div style="
            font-size:11px;color:#d29922;
            text-shadow:0 0 4px #0a0e1a;
            white-space:nowrap;text-align:center;
            pointer-events:none;
          ">${vertices.length} vertices | ${area.toFixed(3)} km&sup2;</div>`,
          iconSize: [120, 16],
          iconAnchor: [60, 8],
        })}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/map/BoundaryEditor.tsx
git commit -m "feat: create BoundaryEditor shared component — editable polygon with vertex handles"
```

---

## Task 4: Create TerrainOverlay, AssetMarkers, CorridorLines Components

**Files:**
- Create: `frontend/src/components/map/TerrainOverlay.tsx`
- Create: `frontend/src/components/map/AssetMarkers.tsx`
- Create: `frontend/src/components/map/CorridorLines.tsx`

- [ ] **Step 1: Create TerrainOverlay.tsx**

```typescript
// frontend/src/components/map/TerrainOverlay.tsx
import { useMemo } from "react";
import { Polygon, Marker } from "react-leaflet";
import { gamePolygonToLatLng, gameXYToLatLng } from "../../utils/coordinates";
import {
  TERRAIN_STYLES,
  createTerrainLabel,
  polygonCentroid,
} from "./mapConstants";
import type { TerrainFeature } from "../../types";

interface TerrainOverlayProps {
  terrain: TerrainFeature[];
  baseLat: number;
  baseLng: number;
}

export default function TerrainOverlay({
  terrain,
  baseLat,
  baseLng,
}: TerrainOverlayProps) {
  const terrainPolygons = useMemo(
    () =>
      terrain.map((t) => ({
        terrain: t,
        positions: gamePolygonToLatLng(t.polygon, baseLat, baseLng),
        centroid: gameXYToLatLng(
          ...polygonCentroid(t.polygon),
          baseLat,
          baseLng,
        ),
      })),
    [terrain, baseLat, baseLng],
  );

  return (
    <>
      {terrainPolygons.map(({ terrain: t, positions, centroid }) => {
        const style = TERRAIN_STYLES[t.type] || TERRAIN_STYLES.building;
        return (
          <span key={t.id}>
            <Polygon
              positions={positions}
              pathOptions={{
                color: t.blocks_los ? "#f85149" : style.stroke,
                weight: t.blocks_los ? 2 : 1,
                dashArray: t.blocks_los ? "4,3" : undefined,
                fillColor: style.fill,
                fillOpacity: 0.35,
              }}
            />
            <Marker position={centroid} icon={createTerrainLabel(t.name)} />
          </span>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Create AssetMarkers.tsx**

```typescript
// frontend/src/components/map/AssetMarkers.tsx
import { Marker } from "react-leaflet";
import { gameXYToLatLng, latLngToGameXY } from "../../utils/coordinates";
import { createAssetIcon } from "./mapConstants";
import type { ProtectedAsset } from "../../types";
import L from "leaflet";

interface AssetMarkersProps {
  assets: ProtectedAsset[];
  /** Overridden positions keyed by asset id */
  positions: Record<string, { x: number; y: number }>;
  baseLat: number;
  baseLng: number;
  onMove: (assetId: string, x: number, y: number) => void;
}

export default function AssetMarkers({
  assets,
  positions,
  baseLat,
  baseLng,
  onMove,
}: AssetMarkersProps) {
  return (
    <>
      {assets.map((asset) => {
        const pos = positions[asset.id] || { x: asset.x, y: asset.y };
        const latLng = gameXYToLatLng(pos.x, pos.y, baseLat, baseLng);
        return (
          <Marker
            key={asset.id}
            position={latLng}
            icon={createAssetIcon(asset.priority, asset.name)}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                const { x, y } = latLngToGameXY(ll.lat, ll.lng, baseLat, baseLng);
                onMove(asset.id, x, y);
              },
            }}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Create CorridorLines.tsx**

```typescript
// frontend/src/components/map/CorridorLines.tsx
import { useMemo } from "react";
import { Polyline, Marker } from "react-leaflet";
import { gameXYToLatLng } from "../../utils/coordinates";
import { createTerrainLabel, degToRad } from "./mapConstants";
import type { ApproachCorridor } from "../../types";

interface CorridorLinesProps {
  corridors: ApproachCorridor[];
  baseLat: number;
  baseLng: number;
  boundsKm: number;
}

export default function CorridorLines({
  corridors,
  baseLat,
  baseLng,
  boundsKm,
}: CorridorLinesProps) {
  const baseCenter = gameXYToLatLng(0, 0, baseLat, baseLng);

  const corridorData = useMemo(() => {
    const extendedBounds = boundsKm * 1.2;
    return corridors.map((corridor) => {
      const bearingRad = degToRad(90 - corridor.bearing_deg);
      const endX = Math.cos(bearingRad) * extendedBounds;
      const endY = Math.sin(bearingRad) * extendedBounds;
      const end = gameXYToLatLng(endX, endY, baseLat, baseLng);
      const labelDist = extendedBounds * 0.85;
      const labelX = Math.cos(bearingRad) * labelDist;
      const labelY = Math.sin(bearingRad) * labelDist;
      const labelPos = gameXYToLatLng(labelX, labelY, baseLat, baseLng);
      return { corridor, end, labelPos };
    });
  }, [corridors, baseLat, baseLng, boundsKm]);

  return (
    <>
      {corridorData.map(({ corridor, end, labelPos }) => (
        <span key={corridor.name}>
          <Polyline
            positions={[baseCenter, end]}
            pathOptions={{
              color: "#484f58",
              weight: 1,
              dashArray: "6,4",
              opacity: 0.7,
            }}
          />
          <Marker
            position={labelPos}
            icon={createTerrainLabel(
              `${corridor.name} (${corridor.bearing_deg}\u00B0)`,
            )}
          />
        </span>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/map/TerrainOverlay.tsx frontend/src/components/map/AssetMarkers.tsx frontend/src/components/map/CorridorLines.tsx
git commit -m "feat: create TerrainOverlay, AssetMarkers, CorridorLines shared map components"
```

---

## Task 5: Create LocationSearch Component

**Files:**
- Create: `frontend/src/components/map/LocationSearch.tsx`

Extracts the Nominatim search pattern from ScenarioSelect into a reusable component.

- [ ] **Step 1: Create LocationSearch.tsx**

```typescript
// frontend/src/components/map/LocationSearch.tsx
import { useState, useCallback, useRef } from "react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationSearchProps {
  onSelect: (lat: number, lng: number, name: string) => void;
  placeholder?: string;
}

const COLORS = {
  bg: "#0a0e1a",
  surface: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  textMuted: "#8b949e",
  accent: "#00d4ff",
};

export default function LocationSearch({
  onSelect,
  placeholder = "Search location...",
}: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchLocation = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
        { headers: { "User-Agent": "OpenSentry-Training-Sim/1.0" } },
      );
      const data: NominatimResult[] = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocation(value), 300);
  };

  const handleSelect = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const name = result.display_name.split(",")[0];
    onSelect(lat, lng, name);
    setQuery(name);
    setResults([]);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "220px",
          padding: "6px 10px",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "4px",
          color: COLORS.text,
          fontSize: "13px",
          outline: "none",
        }}
      />
      {searching && (
        <span
          style={{
            position: "absolute",
            right: "8px",
            top: "7px",
            fontSize: "11px",
            color: COLORS.textMuted,
          }}
        >
          ...
        </span>
      )}
      {results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            width: "320px",
            maxHeight: "200px",
            overflowY: "auto",
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "4px",
            zIndex: 1000,
            marginTop: "2px",
          }}
        >
          {results.map((r) => (
            <div
              key={r.place_id}
              onClick={() => handleSelect(r)}
              style={{
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: "12px",
                color: COLORS.text,
                borderBottom: `1px solid ${COLORS.border}`,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#1c2333")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/map/LocationSearch.tsx
git commit -m "feat: create LocationSearch component — Nominatim geocoding with autocomplete"
```

---

## Task 6: Integrate Base Template Selection into BaseDefenseArchitect

**Files:**
- Modify: `frontend/src/components/BaseDefenseArchitect.tsx`

Add state for base template, base index loading, template fetching, and the top bar UI with base dropdown + location search.

- [ ] **Step 1: Add imports and state**

At the top of `BaseDefenseArchitect.tsx`, add imports:

```typescript
import LocationSearch from "./map/LocationSearch";
import BoundaryEditor from "./map/BoundaryEditor";
import TerrainOverlay from "./map/TerrainOverlay";
import AssetMarkers from "./map/AssetMarkers";
import CorridorLines from "./map/CorridorLines";
import { gameXYToLatLng, latLngToGameXY, getBaseCenter } from "../utils/coordinates";
import type { BaseTemplate } from "../types";
```

Add state declarations inside the component function, near the existing `useState` calls:

```typescript
  // ─── Base template state ────────────────────────────────────────────────
  const [baseIndex, setBaseIndex] = useState<
    { id: string; name: string; description: string; size: string }[]
  >([]);
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);
  const [selectedBaseId, setSelectedBaseId] = useState<string>("");
  const [perimVertices, setPerimVertices] = useState<{ x: number; y: number }[]>([]);
  const [assetPositions, setAssetPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
```

- [ ] **Step 2: Add base index fetch on mount**

Add a `useEffect` to load the base index:

```typescript
  // ─── Load base index ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bases/index.json`)
      .then((r) => r.json())
      .then((data) => setBaseIndex(data))
      .catch((err) => console.warn("Failed to load base index:", err));
  }, []);
```

- [ ] **Step 3: Add base template loading handler**

```typescript
  // ─── Load base template ───────────────────────────────────────────────
  const handleBaseSelect = useCallback(
    (baseId: string) => {
      if (systems.length > 0) {
        const confirmed = window.confirm(
          "Switching base will clear all placed equipment. Continue?",
        );
        if (!confirmed) return;
      }
      setSelectedBaseId(baseId);
      setSystems([]);
      setSelectedUid(null);

      if (!baseId) {
        setBaseTemplate(null);
        setPerimVertices([]);
        setAssetPositions({});
        return;
      }

      fetch(`${import.meta.env.BASE_URL}data/bases/${baseId}.json`)
        .then((r) => r.json())
        .then((base: BaseTemplate) => {
          setBaseTemplate(base);
          // Initialize boundary vertices from base template
          setPerimVertices(
            base.boundary.map(([x, y]) => ({ x, y })),
          );
          // Initialize asset positions
          const positions: Record<string, { x: number; y: number }> = {};
          for (const asset of base.protected_assets) {
            positions[asset.id] = { x: asset.x, y: asset.y };
          }
          setAssetPositions(positions);
          // Fly map to base center
          if (mapRef.current && base.center_lat && base.center_lng) {
            mapRef.current.flyTo(
              [base.center_lat, base.center_lng],
              base.default_zoom || 15,
            );
          }
        })
        .catch((err) => console.warn("Failed to load base template:", err));
    },
    [systems.length],
  );
```

- [ ] **Step 4: Add custom location handler**

```typescript
  // ─── Handle custom location search ────────────────────────────────────
  const handleLocationSelect = useCallback(
    (lat: number, lng: number, name: string) => {
      if (systems.length > 0) {
        const confirmed = window.confirm(
          "Switching location will clear all placed equipment. Continue?",
        );
        if (!confirmed) return;
      }
      setSelectedBaseId("");
      setSystems([]);
      setSelectedUid(null);
      // Create a synthetic base template at the custom location
      setBaseTemplate({
        id: "custom_location",
        name,
        description: `Custom location: ${name}`,
        size: "small",
        center_lat: lat,
        center_lng: lng,
        default_zoom: 15,
        boundary: [
          [-0.3, -0.3],
          [-0.3, 0.3],
          [0.3, 0.3],
          [0.3, -0.3],
        ],
        protected_assets: [],
        terrain: [],
        approach_corridors: [],
        max_sensors: 3,
        max_effectors: 2,
        placement_bounds_km: 0.35,
      });
      setPerimVertices([
        { x: -0.3, y: -0.3 },
        { x: -0.3, y: 0.3 },
        { x: 0.3, y: 0.3 },
        { x: 0.3, y: -0.3 },
      ]);
      setAssetPositions({});
      if (mapRef.current) {
        mapRef.current.flyTo([lat, lng], 15);
      }
    },
    [systems.length],
  );
```

- [ ] **Step 5: Add mapRef**

Near the existing refs at the top of the component, add:

```typescript
  const mapRef = useRef<L.Map | null>(null);
```

And in the `MapContainer` component, add the `ref` prop. Find the existing `<MapContainer` and add:

```typescript
  <MapContainer
    ref={mapRef}
    center={
      baseTemplate?.center_lat && baseTemplate?.center_lng
        ? [baseTemplate.center_lat, baseTemplate.center_lng]
        : [33.9722, -80.4756]
    }
    zoom={baseTemplate?.default_zoom || 14}
    // ... rest of existing props
  >
```

- [ ] **Step 6: Add the top bar UI**

Replace the existing header section (the `div` with "BASE DEFENSE ARCHITECT" title) with a top bar that includes the base dropdown and location search. Find the header and replace it with:

```typescript
        {/* ─── Top Bar ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "8px 16px",
            background: COLORS.surface,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              padding: "4px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            BACK
          </button>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: COLORS.accent,
              letterSpacing: "0.05em",
            }}
          >
            BASE DEFENSE ARCHITECT
          </span>
          <span
            style={{
              fontSize: "10px",
              background: "#d29922",
              color: "#000",
              padding: "1px 6px",
              borderRadius: "3px",
              fontWeight: 700,
            }}
          >
            BETA
          </span>

          <div style={{ width: "1px", height: "20px", background: COLORS.border }} />

          {/* Base template dropdown */}
          <select
            value={selectedBaseId}
            onChange={(e) => handleBaseSelect(e.target.value)}
            style={{
              padding: "6px 10px",
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "4px",
              color: COLORS.text,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="">Free Placement</option>
            {baseIndex.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.size})
              </option>
            ))}
          </select>

          <div style={{ width: "1px", height: "20px", background: COLORS.border }} />

          {/* Location search */}
          <LocationSearch onSelect={handleLocationSelect} />

          {/* Placement mode indicator (keep existing) */}
          {placingDef && (
            <span style={{ marginLeft: "auto", fontSize: "12px", color: COLORS.accent }}>
              Click map to place {placingDef.name}
            </span>
          )}
        </div>
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BaseDefenseArchitect.tsx
git commit -m "feat: add base template selection and location search to Base Defense Architect"
```

---

## Task 7: Render Base Overlays in BaseDefenseArchitect

**Files:**
- Modify: `frontend/src/components/BaseDefenseArchitect.tsx`

Add the boundary editor, terrain overlay, asset markers, and corridor lines to the map.

- [ ] **Step 1: Add overlay components inside the MapContainer**

Find the closing `</MapContainer>` tag. Before it, after the existing system markers and range rings, add the base overlay components:

```typescript
            {/* ─── Base overlays ──────────────────────────────────── */}
            {baseTemplate && perimVertices.length >= 3 && (
              <BoundaryEditor
                vertices={perimVertices}
                baseLat={baseTemplate.center_lat ?? 33.9722}
                baseLng={baseTemplate.center_lng ?? -80.4756}
                onChange={setPerimVertices}
              />
            )}

            {baseTemplate && baseTemplate.terrain.length > 0 && (
              <TerrainOverlay
                terrain={baseTemplate.terrain}
                baseLat={baseTemplate.center_lat ?? 33.9722}
                baseLng={baseTemplate.center_lng ?? -80.4756}
              />
            )}

            {baseTemplate && baseTemplate.protected_assets.length > 0 && (
              <AssetMarkers
                assets={baseTemplate.protected_assets}
                positions={assetPositions}
                baseLat={baseTemplate.center_lat ?? 33.9722}
                baseLng={baseTemplate.center_lng ?? -80.4756}
                onMove={(id, x, y) =>
                  setAssetPositions((prev) => ({
                    ...prev,
                    [id]: { x, y },
                  }))
                }
              />
            )}

            {baseTemplate && baseTemplate.approach_corridors.length > 0 && (
              <CorridorLines
                corridors={baseTemplate.approach_corridors}
                baseLat={baseTemplate.center_lat ?? 33.9722}
                baseLng={baseTemplate.center_lng ?? -80.4756}
                boundsKm={baseTemplate.placement_bounds_km}
              />
            )}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/BaseDefenseArchitect.tsx
git commit -m "feat: render boundary, terrain, assets, corridors on Architect map"
```

---

## Task 8: Refactor PlacementScreen to Use Shared Components

**Files:**
- Modify: `frontend/src/components/PlacementScreen.tsx`

Replace the inline boundary/terrain/asset/corridor rendering with the shared components.

- [ ] **Step 1: Add imports for shared components**

At the top of `PlacementScreen.tsx`, add:

```typescript
import BoundaryEditor from "./map/BoundaryEditor";
import TerrainOverlay from "./map/TerrainOverlay";
import AssetMarkers from "./map/AssetMarkers";
import CorridorLines from "./map/CorridorLines";
import {
  TERRAIN_STYLES,
  PRIORITY_COLORS,
  createTerrainLabel,
  createAssetIcon,
  createCornerHandle,
  createMidpointHandle,
  shoelaceArea,
  verticesCentroid,
  polygonCentroid,
  degToRad,
} from "./map/mapConstants";
```

- [ ] **Step 2: Remove duplicated constants and functions**

Remove from PlacementScreen.tsx:
- `TERRAIN_STYLES` constant (around line 101-107)
- `PRIORITY_COLORS` constant (around line 109-113)
- `createTerrainLabel` function (around line 211-219)
- `createAssetIcon` function (around line 190-208)
- `createCornerHandle` function (around line 222-232)
- `createMidpointHandle` function (around line 235-245)
- `shoelaceArea` function (around line 259-268)
- `verticesCentroid` function (around line 271-279)
- `polygonCentroid` helper (if present as standalone)
- `degToRad` helper (if present as standalone)

These are now imported from `./map/mapConstants`.

- [ ] **Step 3: Replace inline boundary polygon rendering with BoundaryEditor**

Find the boundary polygon rendering section (lines ~1448-1513) and replace with:

```typescript
            <BoundaryEditor
              vertices={perimVertices}
              baseLat={baseLat}
              baseLng={baseLng}
              onChange={setPerimVertices}
            />
```

- [ ] **Step 4: Replace inline terrain rendering with TerrainOverlay**

Find the terrain rendering section (lines ~1515-1537) and replace with:

```typescript
            <TerrainOverlay
              terrain={baseTemplate.terrain}
              baseLat={baseLat}
              baseLng={baseLng}
            />
```

- [ ] **Step 5: Replace inline asset rendering with AssetMarkers**

Find the asset rendering section (lines ~1539-1561) and replace with:

```typescript
            <AssetMarkers
              assets={baseTemplate.protected_assets}
              positions={assetPositions}
              baseLat={baseLat}
              baseLng={baseLng}
              onMove={(id, x, y) =>
                setAssetPositions((prev) => ({
                  ...prev,
                  [id]: { x, y },
                }))
              }
            />
```

- [ ] **Step 6: Replace inline corridor rendering with CorridorLines**

Find the corridor rendering section (lines ~1563-1580) and replace with:

```typescript
            <CorridorLines
              corridors={baseTemplate.approach_corridors}
              baseLat={baseLat}
              baseLng={baseLng}
              boundsKm={baseTemplate.placement_bounds_km}
            />
```

- [ ] **Step 7: Remove now-unused memos**

Remove the `terrainPolygons` and `corridorLines` useMemo blocks (around lines 792-821) since the shared components handle their own memoization.

- [ ] **Step 8: Build and test**

Run: `cd frontend && npx tsc --noEmit && npm run build`

Verify no type errors or build failures.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/PlacementScreen.tsx
git commit -m "refactor: PlacementScreen uses shared map components — BoundaryEditor, TerrainOverlay, AssetMarkers, CorridorLines"
```

---

## Task 9: Write Unit Tests

**Files:**
- Create: `frontend/src/__tests__/map-components.test.ts`

Test the pure logic in mapConstants (geometry helpers, no DOM/React rendering).

- [ ] **Step 1: Create test file**

```typescript
// frontend/src/__tests__/map-components.test.ts
import { describe, it, expect } from "vitest";
import {
  shoelaceArea,
  verticesCentroid,
  polygonCentroid,
  degToRad,
} from "../components/map/mapConstants";

describe("shoelaceArea", () => {
  it("calculates area of a 1x1 km square", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(1.0, 5);
  });

  it("calculates area of a 0.6x0.6 km square (small_fob default)", () => {
    const vertices = [
      { x: -0.3, y: -0.3 },
      { x: -0.3, y: 0.3 },
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: -0.3 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(0.36, 5);
  });

  it("calculates area of a triangle", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(1.0, 5);
  });
});

describe("verticesCentroid", () => {
  it("returns center of a symmetric square", () => {
    const vertices = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const c = verticesCentroid(vertices);
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeCloseTo(0, 5);
  });

  it("returns offset centroid for non-symmetric polygon", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const c = verticesCentroid(vertices);
    expect(c.x).toBeCloseTo(4 / 3, 4);
    expect(c.y).toBeCloseTo(2 / 3, 4);
  });
});

describe("polygonCentroid", () => {
  it("returns centroid of number[][] polygon", () => {
    const polygon = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const [cx, cy] = polygonCentroid(polygon);
    expect(cx).toBeCloseTo(2, 5);
    expect(cy).toBeCloseTo(2, 5);
  });
});

describe("degToRad", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(degToRad(0)).toBe(0);
  });

  it("converts 180 degrees to PI", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
  });

  it("converts 90 degrees to PI/2", () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("converts 360 degrees to 2*PI", () => {
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI, 10);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd frontend && npm test`

Expected: All new tests pass alongside the existing 28 game engine tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/__tests__/map-components.test.ts
git commit -m "test: add unit tests for shared map component geometry helpers"
```

---

## Task 10: Build Verification and Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Run full type check**

Run: `cd frontend && npx tsc --noEmit`

Expected: 0 errors

- [ ] **Step 2: Run full test suite**

Run: `cd frontend && npm test`

Expected: All tests pass (28 existing + new map component tests)

- [ ] **Step 3: Run production build**

Run: `cd frontend && npm run build`

Expected: Build succeeds, no warnings about missing imports

- [ ] **Step 4: Manual smoke test**

Run: `cd frontend && npm run dev`

Test the following:

1. **Main menu** -> Click "BASE DEFENSE ARCHITECT BETA"
2. **Top bar visible** with base dropdown, location search, BACK button
3. **Free placement** (no base selected): Place a radar, verify viewshed at 10m shows terrain shadows
4. **Select "Small FOB"**: Map flies to small_fob coordinates, boundary polygon appears (orange dashed), terrain features visible, protected assets with star markers
5. **Edit boundary**: Drag a vertex, click a midpoint to add vertex, right-click to delete vertex
6. **Drag an asset**: Move a protected asset marker
7. **Search location**: Type "Ramstein" in search bar, select result, map flies there, boundary resets to default square
8. **Switch back to "Medium Airbase"**: Confirm prompt appears (if equipment placed), map flies to new base
9. **PlacementScreen still works**: Start a Custom Mission, go through scenario select -> equip -> placement, verify boundary/terrain/assets render correctly

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: address smoke test issues"
```
