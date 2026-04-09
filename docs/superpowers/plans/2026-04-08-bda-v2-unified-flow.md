# BDA v2 — Unified Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor BaseDefenseArchitect from a 2830-line monolith into a 4-step flow (Base → Equip → Place → Export) that mirrors Custom Mission's UX pattern.

**Architecture:** The current `BaseDefenseArchitect.tsx` becomes a thin stepper shell (~150 lines) that manages shared state and renders one of four step components. Viewshed computation, coordinate utils, and system placement logic are extracted into the `bda/` subdirectory. The stepper shell holds all state so back-navigation preserves work.

**Tech Stack:** React 19, TypeScript, Leaflet.js, Vite, existing Open-Elevation API for viewshed

**Spec:** `docs/superpowers/specs/2026-04-08-bda-v2-unified-flow-design.md`

---

## File Structure

```
frontend/src/components/
  BaseDefenseArchitect.tsx           ← REWRITE: stepper shell (~150 lines)
  bda/
    types.ts                         ← CREATE: shared BDA types (SystemDef, PlacedSystem, etc.)
    constants.ts                     ← CREATE: shared colors, altitude bands
    viewshed.ts                      ← CREATE: viewshed computation (extracted from monolith)
    BdaStepIndicator.tsx             ← CREATE: step bar UI
    BdaBaseSelection.tsx             ← CREATE: step 1
    BdaEquipmentSelection.tsx        ← CREATE: step 2
    BdaPlacement.tsx                 ← CREATE: step 3 (bulk of current logic)
    BdaExport.tsx                    ← CREATE: step 4
    components/
      BdaEquipmentCard.tsx           ← CREATE: enriched equipment card
      SystemDetailPanel.tsx          ← CREATE: altitude/facing/visibility controls
      EquipmentPalette.tsx           ← CREATE: left sidebar for placement step
      DraggableSystemMarker.tsx      ← CREATE: extracted from monolith
      MapClickHandler.tsx            ← CREATE: extracted from monolith
```

---

### Task 1: Create BDA Types and Constants

Extract shared types and constants from the monolith into dedicated files so all step components can import them.

**Files:**
- Create: `frontend/src/components/bda/types.ts`
- Create: `frontend/src/components/bda/constants.ts`

- [ ] **Step 1: Create bda directory**

Run: `mkdir -p frontend/src/components/bda/components`

- [ ] **Step 2: Create types.ts**

```typescript
// frontend/src/components/bda/types.ts
import type { BaseTemplate, EquipmentCatalog, PlacementConfig, BaseInfo, ScenarioInfo } from "../../types";

export interface SystemDef {
  id: string;
  name: string;
  category: "sensor" | "effector" | "combined";
  type: string;
  range_km: number;
  sensor_range_km?: number;
  effector_range_km?: number;
  fov_deg: number;
  color: string;
  letter: string;
  description: string;
  requires_los: boolean;
}

export interface ViewshedStats {
  totalCells: number;
  visibleCells: number;
  blockedCells: number;
  coveragePercent: number;
  sensorElevation: number;
  minElevation: number;
  maxElevation: number;
}

export interface ViewshedResult {
  polygon: [number, number][];
  blockedSectors: [number, number][][];
  area: number;
  stats: ViewshedStats;
}

export interface PlacedSystem {
  uid: string;
  def: SystemDef;
  lat: number;
  lng: number;
  altitude: number;
  facing_deg: number;
  viewshed: [number, number][] | null;
  blockedSectors: [number, number][][] | null;
  viewshedLoading: boolean;
  viewshedArea: number | null;
  viewshedStats: ViewshedStats | null;
  visible: boolean;
}

export interface SelectedEquipment {
  sensors: { catalogId: string; qty: number }[];
  effectors: { catalogId: string; qty: number }[];
  combined: { catalogId: string; qty: number }[];
}

export type BdaStep = 1 | 2 | 3 | 4;
```

- [ ] **Step 3: Create constants.ts**

```typescript
// frontend/src/components/bda/constants.ts
export const SHAW_AFB = { lat: 33.9722, lng: -80.4756 };
export const DEFAULT_ZOOM = 14;

export const COLORS = {
  bg: "#0a0e1a",
  card: "#0f1520",
  border: "#1a2235",
  text: "#e6edf3",
  muted: "#6b7b8d",
  accent: "#00d4ff",
  danger: "#ff4d4d",
  warning: "#d29922",
  success: "#3fb950",
  purple: "#a371f7",
};

export const TYPE_COLORS: Record<string, string> = {
  radar: "#388bfd",
  eoir: "#e3b341",
  electronic: "#00bfbf",
  kinetic: "#f85149",
  rf: "#bc8cff",
  shenobi_pm: "#bc8cff",
};

export interface AltitudeBand {
  label: string;
  color: string;
  icon: string;
  presets: { value: number; label: string }[];
}

export const ALTITUDE_BANDS: AltitudeBand[] = [
  {
    label: "LOW",
    color: "#3fb950",
    icon: "🟢",
    presets: [
      { value: 10, label: "10m" },
      { value: 25, label: "25m" },
      { value: 50, label: "50m" },
    ],
  },
  {
    label: "MED",
    color: "#d29922",
    icon: "🟡",
    presets: [
      { value: 100, label: "100m" },
      { value: 200, label: "200m" },
      { value: 300, label: "300m" },
    ],
  },
  {
    label: "HIGH",
    color: "#f85149",
    icon: "🔴",
    presets: [
      { value: 500, label: "500m" },
      { value: 1000, label: "1km" },
      { value: 2000, label: "2km" },
    ],
  },
];

export function getAltitudeBand(altM: number): AltitudeBand {
  if (altM <= 50) return ALTITUDE_BANDS[0];
  if (altM <= 300) return ALTITUDE_BANDS[1];
  return ALTITUDE_BANDS[2];
}

export function getAltitudeBandLabel(altM: number): string {
  const band = getAltitudeBand(altM);
  if (band.label === "LOW") return "Ground vehicles / low drones";
  if (band.label === "MED") return "Tactical drones / helicopters";
  return "Fixed-wing / high-altitude";
}

export function buildSystemDefs(catalog: import("../../types").EquipmentCatalog): import("./types").SystemDef[] {
  const defs: import("./types").SystemDef[] = [];

  for (const s of catalog.sensors) {
    defs.push({
      id: s.catalog_id,
      name: s.name,
      category: "sensor",
      type: s.type,
      range_km: s.range_km,
      fov_deg: s.fov_deg,
      color: TYPE_COLORS[s.type] || COLORS.muted,
      letter: s.catalog_id === "tpq51" ? "L" : s.catalog_id === "kufcs" ? "K" : "E",
      description: s.description,
      requires_los: s.requires_los,
    });
  }

  for (const e of catalog.effectors) {
    defs.push({
      id: e.catalog_id,
      name: e.name,
      category: "effector",
      type: e.type,
      range_km: e.range_km,
      fov_deg: e.fov_deg,
      color: TYPE_COLORS[e.type] || COLORS.muted,
      letter: e.catalog_id === "rf_jammer" ? "R" : "J",
      description: e.description,
      requires_los: e.requires_los,
    });
  }

  for (const c of catalog.combined || []) {
    defs.push({
      id: c.catalog_id,
      name: c.name,
      category: "combined",
      type: c.sensor_type,
      range_km: c.sensor_range_km,
      sensor_range_km: c.sensor_range_km,
      effector_range_km: c.effector_range_km,
      fov_deg: c.fov_deg,
      color: TYPE_COLORS[c.sensor_type] || "#bc8cff",
      letter: "S",
      description: c.description,
      requires_los: c.requires_los,
    });
  }

  return defs;
}
```

- [ ] **Step 4: Verify imports compile**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to the new files (they aren't imported yet, so no errors expected).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bda/types.ts frontend/src/components/bda/constants.ts
git commit -m "refactor(bda): extract shared types and constants into bda/ directory"
```

---

### Task 2: Extract Viewshed Computation

Move the viewshed computation logic out of the monolith into its own module. This is pure logic — no React dependencies.

**Files:**
- Create: `frontend/src/components/bda/viewshed.ts`

- [ ] **Step 1: Create viewshed.ts**

Extract these functions from `BaseDefenseArchitect.tsx` (lines 201–500 approximately):
- `viewshedCache` (module-level Map)
- `cacheKey()`
- `NUM_RAYS`, `MAX_RANGE_KM`, `STEP_KM`, `EARTH_RADIUS_KM`
- `degToRad()`, `radToDeg()`
- `offsetLatLng()`
- `fetchElevations()`
- `computeViewshed()`

```typescript
// frontend/src/components/bda/viewshed.ts
import type { ViewshedResult, ViewshedStats } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

export const NUM_RAYS = 72;
export const MAX_RANGE_KM = 15;
export const STEP_KM = 0.15;
const EARTH_RADIUS_KM = 6371;

// ─── Viewshed cache ────────────────────────────────────────────────────────

export const viewshedCache = new Map<string, ViewshedResult>();

export function cacheKey(lat: number, lng: number, alt: number, rangeKm?: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)},${alt}${rangeKm != null ? `,${rangeKm}` : ""}`;
}

// ─── Math helpers ──────────────────────────────────────────────────────────

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function offsetLatLng(
  lat: number,
  lng: number,
  distKm: number,
  bearingRad: number,
): [number, number] {
  const angDist = distKm / EARTH_RADIUS_KM;
  const latR = degToRad(lat);
  const lngR = degToRad(lng);
  const newLat = Math.asin(
    Math.sin(latR) * Math.cos(angDist) +
      Math.cos(latR) * Math.sin(angDist) * Math.cos(bearingRad),
  );
  const newLng =
    lngR +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latR),
      Math.cos(angDist) - Math.sin(latR) * Math.sin(newLat),
    );
  return [radToDeg(newLat), radToDeg(newLng)];
}

// ─── Elevation API ─────────────────────────────────────────────────────────

export async function fetchElevations(
  points: { latitude: number; longitude: number }[],
): Promise<number[]> {
  const BATCH = 200;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    let retries = 0;
    let resp: Response | null = null;
    let lastError: string | null = null;
    while (retries < 3) {
      try {
        resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: batch }),
        });
        if (resp.ok) break;
        lastError = `HTTP ${resp.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      retries++;
      if (retries < 3) {
        await new Promise((r) => setTimeout(r, 500 * retries));
      }
    }
    if (!resp || !resp.ok) {
      console.error(`[BDA] Elevation API failed after ${retries} retries: ${lastError}`);
      throw new Error(`Elevation API error: ${lastError || "no response"}`);
    }
    const data = await resp.json();
    for (const r of data.results) {
      results.push(r.elevation);
    }
  }
  return results;
}

// ─── Viewshed computation ──────────────────────────────────────────────────
// Copy the full computeViewshed function from BaseDefenseArchitect.tsx lines ~290-500.
// It returns Promise<ViewshedResult>.
// This is a direct extraction — the function signature and logic are identical.
// The function uses: NUM_RAYS, STEP_KM, degToRad, offsetLatLng, fetchElevations.
// Import ViewshedResult and ViewshedStats from ./types.
```

**Important:** Copy `computeViewshed` verbatim from `BaseDefenseArchitect.tsx` lines 290–500. The function is self-contained and uses only the helpers defined above. The return type is `Promise<ViewshedResult>`.

- [ ] **Step 2: Verify the file compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/viewshed.ts
git commit -m "refactor(bda): extract viewshed computation into standalone module"
```

---

### Task 3: Create BdaStepIndicator Component

A simple step bar that shows progress through the 4 phases.

**Files:**
- Create: `frontend/src/components/bda/BdaStepIndicator.tsx`

- [ ] **Step 1: Create BdaStepIndicator.tsx**

```tsx
// frontend/src/components/bda/BdaStepIndicator.tsx
import React from "react";
import type { BdaStep } from "./types";
import { COLORS } from "./constants";

const STEPS = [
  { num: 1 as BdaStep, label: "BASE" },
  { num: 2 as BdaStep, label: "EQUIP" },
  { num: 3 as BdaStep, label: "PLACE" },
  { num: 4 as BdaStep, label: "EXPORT" },
];

interface Props {
  currentStep: BdaStep;
  completedSteps: Set<BdaStep>;
  onStepClick: (step: BdaStep) => void;
}

export default function BdaStepIndicator({ currentStep, completedSteps, onStepClick }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: "12px 16px",
        background: COLORS.card,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {STEPS.map((step, i) => {
        const isActive = step.num === currentStep;
        const isCompleted = completedSteps.has(step.num);
        const isClickable = isCompleted && step.num !== currentStep;

        return (
          <React.Fragment key={step.num}>
            {i > 0 && (
              <div
                style={{
                  width: 40,
                  height: 2,
                  background: completedSteps.has(STEPS[i - 1].num) ? COLORS.accent : COLORS.border,
                  margin: "0 4px",
                }}
              />
            )}
            <button
              onClick={() => isClickable && onStepClick(step.num)}
              disabled={!isClickable}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                cursor: isClickable ? "pointer" : "default",
                padding: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: isActive || isCompleted ? COLORS.accent : COLORS.border,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  color: isActive || isCompleted ? COLORS.bg : COLORS.muted,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {isCompleted && !isActive ? "✓" : step.num}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? COLORS.accent : isCompleted ? COLORS.accent : COLORS.muted,
                  letterSpacing: 0.5,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {step.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/BdaStepIndicator.tsx
git commit -m "feat(bda): add step indicator component for 4-phase flow"
```

---

### Task 4: Create BdaBaseSelection Component (Step 1)

The first step: pick a base template or search a custom location. Extracted from the current BDA's base dropdown + geo search.

**Files:**
- Create: `frontend/src/components/bda/BdaBaseSelection.tsx`

- [ ] **Step 1: Create BdaBaseSelection.tsx**

```tsx
// frontend/src/components/bda/BdaBaseSelection.tsx
import React, { useState, useEffect, useCallback } from "react";
import type { BaseInfo, BaseTemplate } from "../../types";
import { COLORS } from "./constants";

interface Props {
  selectedBaseId: string | null;
  onSelectBase: (baseId: string, template: BaseTemplate) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function BdaBaseSelection({ selectedBaseId, onSelectBase, onBack, onNext }: Props) {
  const [bases, setBases] = useState<BaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Load base index
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bases/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: BaseInfo[]) => {
        setBases(data);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Failed to load base index:", err);
        setLoading(false);
      });
  }, []);

  const handleSelectTemplate = useCallback(
    (baseId: string) => {
      fetch(`${import.meta.env.BASE_URL}data/bases/${baseId}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((template: BaseTemplate) => {
          onSelectBase(baseId, template);
        })
        .catch((err) => console.warn("Failed to load base template:", err));
    },
    [onSelectBase],
  );

  const handleGeocodeSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { "Accept-Language": "en", "User-Agent": "OpenSentry-BDA/1.0" } },
    )
      .then((res) => res.json())
      .then((data) => {
        setSearchResults(
          data.map((r: { display_name: string; lat: string; lon: string }) => ({
            name: r.display_name.split(",").slice(0, 2).join(","),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          })),
        );
        setSearchLoading(false);
      })
      .catch(() => {
        setSearchResults([]);
        setSearchLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted }}>
        LOADING BASES...
      </div>
    );
  }

  const SIZE_COLORS: Record<string, string> = {
    small: COLORS.success,
    medium: COLORS.warning,
    large: COLORS.danger,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: COLORS.text, fontFamily: "'Inter', sans-serif" }}>
          Select Base
        </h2>
        <p style={{ margin: "4px 0 16px", fontSize: 13, color: COLORS.muted }}>
          Choose a base template or search for a custom location
        </p>
      </div>

      {/* Base template cards */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {bases.map((base) => {
            const isSelected = base.id === selectedBaseId;
            return (
              <button
                key={base.id}
                onClick={() => handleSelectTemplate(base.id)}
                style={{
                  background: isSelected ? `${COLORS.accent}15` : COLORS.card,
                  border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
                  borderRadius: 8,
                  padding: 16,
                  cursor: "pointer",
                  textAlign: "left",
                  color: COLORS.text,
                  fontFamily: "'Inter', sans-serif",
                  transition: "border-color 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{base.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: `${SIZE_COLORS[base.size] || COLORS.muted}20`,
                      color: SIZE_COLORS[base.size] || COLORS.muted,
                      textTransform: "uppercase",
                    }}
                  >
                    {base.size}
                  </span>
                </div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: COLORS.muted, lineHeight: 1.4 }}>
                  {base.description}
                </p>
                <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                  <div>
                    <span style={{ color: COLORS.muted }}>Max Sensors: </span>
                    <span style={{ color: "#388bfd", fontWeight: 600 }}>{base.max_sensors}</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.muted }}>Max Effectors: </span>
                    <span style={{ color: "#f85149", fontWeight: 600 }}>{base.max_effectors}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Geo search section */}
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, color: COLORS.text, margin: "0 0 8px" }}>
            Or search custom location
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleGeocodeSearch(e.target.value)}
              placeholder="Search city, base, or coordinates..."
              style={{
                flex: 1,
                padding: "10px 12px",
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                color: COLORS.text,
                fontSize: 13,
                fontFamily: "'Inter', sans-serif",
                outline: "none",
              }}
            />
          </div>
          {searchLoading && (
            <div style={{ fontSize: 12, color: COLORS.muted, padding: "8px 0" }}>Searching...</div>
          )}
          {searchResults.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    // When custom location selected, use medium_airbase as default template
                    // but override center coordinates
                    setSearchQuery(r.name);
                    setSearchResults([]);
                    fetch(`${import.meta.env.BASE_URL}data/bases/medium_airbase.json`)
                      .then((res) => res.json())
                      .then((template: BaseTemplate) => {
                        const customTemplate: BaseTemplate = {
                          ...template,
                          id: "custom",
                          name: `Custom (${r.name})`,
                          center_lat: r.lat,
                          center_lng: r.lng,
                        };
                        onSelectBase("custom", customTemplate);
                      });
                  }}
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: COLORS.text,
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {r.name} <span style={{ color: COLORS.muted }}>({r.lat.toFixed(3)}, {r.lng.toFixed(3)})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          padding: "12px 24px",
          borderTop: `1px solid ${COLORS.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          ← BACK TO MENU
        </button>
        <button
          onClick={onNext}
          disabled={!selectedBaseId}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 700,
            background: selectedBaseId ? COLORS.accent : `${COLORS.accent}40`,
            border: `1px solid ${selectedBaseId ? COLORS.accent : COLORS.border}`,
            borderRadius: 6,
            color: selectedBaseId ? COLORS.bg : COLORS.muted,
            cursor: selectedBaseId ? "pointer" : "not-allowed",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          SELECT EQUIPMENT →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/BdaBaseSelection.tsx
git commit -m "feat(bda): add base selection step with template cards and geo search"
```

---

### Task 5: Create BdaEquipmentCard Component

The enriched equipment card used in Step 2. Shows LOS badge, range, FOV, +/- quantity controls.

**Files:**
- Create: `frontend/src/components/bda/components/BdaEquipmentCard.tsx`

- [ ] **Step 1: Create BdaEquipmentCard.tsx**

```tsx
// frontend/src/components/bda/components/BdaEquipmentCard.tsx
import React from "react";
import { COLORS, TYPE_COLORS } from "../constants";

interface Props {
  catalogId: string;
  name: string;
  category: "sensor" | "effector" | "combined";
  type: string;
  rangeKm: number;
  sensorRangeKm?: number;
  effectorRangeKm?: number;
  fovDeg: number;
  requiresLos: boolean;
  qty: number;
  maxReached: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  sensor: "#388bfd",
  effector: "#f85149",
  combined: "#bc8cff",
};

export default function BdaEquipmentCard({
  name,
  category,
  type,
  rangeKm,
  sensorRangeKm,
  effectorRangeKm,
  fovDeg,
  requiresLos,
  qty,
  maxReached,
  onIncrement,
  onDecrement,
}: Props) {
  const borderColor = CATEGORY_COLORS[category] || COLORS.border;
  const isCombined = category === "combined";

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${qty > 0 ? borderColor : COLORS.border}`,
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {/* Name + LOS badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, color: COLORS.text, fontSize: 14 }}>{name}</span>
            {requiresLos && (
              <span
                style={{
                  background: `${COLORS.success}30`,
                  color: COLORS.success,
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 9,
                  fontWeight: 600,
                }}
              >
                LOS
              </span>
            )}
          </div>

          {/* Category tag */}
          <span
            style={{
              display: "inline-block",
              background: `${borderColor}20`,
              color: borderColor,
              padding: "1px 6px",
              borderRadius: 3,
              fontSize: 10,
              marginTop: 3,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {category}
          </span>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {isCombined ? (
              <>
                <div>
                  <div style={{ color: COLORS.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>Detect</div>
                  <div style={{ color: "#388bfd", fontSize: 13, fontWeight: 600 }}>{sensorRangeKm}km</div>
                </div>
                <div>
                  <div style={{ color: COLORS.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>Defeat</div>
                  <div style={{ color: "#f85149", fontSize: 13, fontWeight: 600 }}>{effectorRangeKm}km</div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div style={{ color: COLORS.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>Range</div>
                  <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>{rangeKm}km</div>
                </div>
                <div>
                  <div style={{ color: COLORS.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>FOV</div>
                  <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>{fovDeg}°</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Qty controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={onDecrement}
            disabled={qty === 0}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: COLORS.border,
              border: `1px solid ${COLORS.muted}50`,
              color: qty === 0 ? COLORS.muted : COLORS.text,
              cursor: qty === 0 ? "not-allowed" : "pointer",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            −
          </button>
          <span
            style={{
              color: qty > 0 ? COLORS.text : COLORS.muted,
              fontWeight: 700,
              fontSize: 16,
              minWidth: 20,
              textAlign: "center",
            }}
          >
            {qty}
          </span>
          <button
            onClick={onIncrement}
            disabled={maxReached && qty === 0}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: maxReached && qty === 0 ? COLORS.border : COLORS.accent,
              border: "none",
              color: maxReached && qty === 0 ? COLORS.muted : COLORS.bg,
              cursor: maxReached && qty === 0 ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/components/BdaEquipmentCard.tsx
git commit -m "feat(bda): add enriched equipment card with LOS badge, range, FOV stats"
```

---

### Task 6: Create BdaEquipmentSelection Component (Step 2)

Full-screen equipment catalog with enriched cards, +/- quantity buttons, filter tabs, and limit enforcement.

**Files:**
- Create: `frontend/src/components/bda/BdaEquipmentSelection.tsx`

- [ ] **Step 1: Create BdaEquipmentSelection.tsx**

```tsx
// frontend/src/components/bda/BdaEquipmentSelection.tsx
import React, { useState, useEffect, useMemo } from "react";
import type { EquipmentCatalog } from "../../types";
import type { SelectedEquipment } from "./types";
import { COLORS } from "./constants";
import BdaEquipmentCard from "./components/BdaEquipmentCard";

type FilterTab = "all" | "sensor" | "effector" | "combined";

interface Props {
  maxSensors: number;
  maxEffectors: number;
  selectedEquipment: SelectedEquipment;
  onUpdateEquipment: (equipment: SelectedEquipment) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function BdaEquipmentSelection({
  maxSensors,
  maxEffectors,
  selectedEquipment,
  onUpdateEquipment,
  onBack,
  onNext,
}: Props) {
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/equipment/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: EquipmentCatalog) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Compute totals
  const totalCombined = selectedEquipment.combined.reduce((sum, e) => sum + e.qty, 0);
  const totalSensors = selectedEquipment.sensors.reduce((sum, e) => sum + e.qty, 0) + totalCombined;
  const totalEffectors = selectedEquipment.effectors.reduce((sum, e) => sum + e.qty, 0) + totalCombined;
  const totalSystems = totalSensors + totalEffectors - totalCombined; // combined counted once

  const sensorMaxReached = totalSensors >= maxSensors;
  const effectorMaxReached = totalEffectors >= maxEffectors;

  const getQty = (category: "sensors" | "effectors" | "combined", catalogId: string): number => {
    const entry = selectedEquipment[category].find((e) => e.catalogId === catalogId);
    return entry?.qty ?? 0;
  };

  const setQty = (category: "sensors" | "effectors" | "combined", catalogId: string, newQty: number) => {
    const updated = { ...selectedEquipment };
    const list = [...updated[category]];
    const idx = list.findIndex((e) => e.catalogId === catalogId);
    if (idx >= 0) {
      if (newQty <= 0) {
        list.splice(idx, 1);
      } else {
        list[idx] = { ...list[idx], qty: newQty };
      }
    } else if (newQty > 0) {
      list.push({ catalogId, qty: newQty });
    }
    updated[category] = list;
    onUpdateEquipment(updated);
  };

  const canProceed = totalSystems > 0;

  if (loading || !catalog) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted }}>
        LOADING CATALOG...
      </div>
    );
  }

  const TABS: { key: FilterTab; label: string; color: string }[] = [
    { key: "all", label: "ALL", color: COLORS.accent },
    { key: "sensor", label: "SENSORS", color: "#388bfd" },
    { key: "effector", label: "EFFECTORS", color: "#f85149" },
    { key: "combined", label: "COMBINED", color: "#bc8cff" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header with limits */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: COLORS.text, fontFamily: "'Inter', sans-serif" }}>Select Equipment</h2>
          <span style={{ fontSize: 13, color: COLORS.muted }}>Choose sensors and effectors for your defense</span>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#388bfd", fontSize: 20, fontWeight: 700 }}>
              {totalSensors}<span style={{ color: COLORS.muted, fontSize: 14 }}>/{maxSensors}</span>
            </div>
            <div style={{ color: COLORS.muted, fontSize: 11 }}>SENSORS</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#f85149", fontSize: 20, fontWeight: 700 }}>
              {totalEffectors}<span style={{ color: COLORS.muted, fontSize: 14 }}>/{maxEffectors}</span>
            </div>
            <div style={{ color: COLORS.muted, fontSize: 11 }}>EFFECTORS</div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "12px 24px",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
              color: activeTab === tab.key ? tab.color : COLORS.muted,
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 700 : 500,
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Equipment grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {/* Sensors */}
          {(activeTab === "all" || activeTab === "sensor") &&
            catalog.sensors.map((s) => (
              <BdaEquipmentCard
                key={s.catalog_id}
                catalogId={s.catalog_id}
                name={s.name}
                category="sensor"
                type={s.type}
                rangeKm={s.range_km}
                fovDeg={s.fov_deg}
                requiresLos={s.requires_los}
                qty={getQty("sensors", s.catalog_id)}
                maxReached={sensorMaxReached}
                onIncrement={() => {
                  if (!sensorMaxReached) setQty("sensors", s.catalog_id, getQty("sensors", s.catalog_id) + 1);
                }}
                onDecrement={() => setQty("sensors", s.catalog_id, getQty("sensors", s.catalog_id) - 1)}
              />
            ))}

          {/* Effectors */}
          {(activeTab === "all" || activeTab === "effector") &&
            catalog.effectors.map((e) => (
              <BdaEquipmentCard
                key={e.catalog_id}
                catalogId={e.catalog_id}
                name={e.name}
                category="effector"
                type={e.type}
                rangeKm={e.range_km}
                fovDeg={e.fov_deg}
                requiresLos={e.requires_los}
                qty={getQty("effectors", e.catalog_id)}
                maxReached={effectorMaxReached}
                onIncrement={() => {
                  if (!effectorMaxReached) setQty("effectors", e.catalog_id, getQty("effectors", e.catalog_id) + 1);
                }}
                onDecrement={() => setQty("effectors", e.catalog_id, getQty("effectors", e.catalog_id) - 1)}
              />
            ))}

          {/* Combined */}
          {(activeTab === "all" || activeTab === "combined") &&
            (catalog.combined || []).map((c) => (
              <BdaEquipmentCard
                key={c.catalog_id}
                catalogId={c.catalog_id}
                name={c.name}
                category="combined"
                type={c.sensor_type}
                rangeKm={c.sensor_range_km}
                sensorRangeKm={c.sensor_range_km}
                effectorRangeKm={c.effector_range_km}
                fovDeg={c.fov_deg}
                requiresLos={c.requires_los}
                qty={getQty("combined", c.catalog_id)}
                maxReached={sensorMaxReached || effectorMaxReached}
                onIncrement={() => {
                  if (!sensorMaxReached && !effectorMaxReached) setQty("combined", c.catalog_id, getQty("combined", c.catalog_id) + 1);
                }}
                onDecrement={() => setQty("combined", c.catalog_id, getQty("combined", c.catalog_id) - 1)}
              />
            ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          padding: "12px 24px",
          borderTop: `1px solid ${COLORS.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          ← BACK
        </button>
        <span style={{ fontSize: 13, color: COLORS.muted }}>{totalSystems} system{totalSystems !== 1 ? "s" : ""} selected</span>
        <button
          onClick={onNext}
          disabled={!canProceed}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 700,
            background: canProceed ? COLORS.accent : `${COLORS.accent}40`,
            border: `1px solid ${canProceed ? COLORS.accent : COLORS.border}`,
            borderRadius: 6,
            color: canProceed ? COLORS.bg : COLORS.muted,
            cursor: canProceed ? "pointer" : "not-allowed",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          PLACE SYSTEMS →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/BdaEquipmentSelection.tsx
git commit -m "feat(bda): add equipment selection step with enriched cards and limit enforcement"
```

---

### Task 7: Create BdaPlacement Component (Step 3)

This is the largest component — the map-based placement view with viewshed visualization. It inherits most of the current BDA monolith's map rendering, system placement, altitude/facing controls, and per-system coverage toggle.

**Files:**
- Create: `frontend/src/components/bda/BdaPlacement.tsx`
- Create: `frontend/src/components/bda/components/DraggableSystemMarker.tsx`
- Create: `frontend/src/components/bda/components/MapClickHandler.tsx`
- Create: `frontend/src/components/bda/components/SystemDetailPanel.tsx`
- Create: `frontend/src/components/bda/components/EquipmentPalette.tsx`

- [ ] **Step 1: Create MapClickHandler.tsx**

Extract the `MapClickHandler` inner component from `BaseDefenseArchitect.tsx` (lines ~509-538).

```tsx
// frontend/src/components/bda/components/MapClickHandler.tsx
import { useMapEvents } from "react-leaflet";

interface Props {
  active: boolean;
  onMapClick: (lat: number, lng: number) => void;
}

export default function MapClickHandler({ active, onMapClick }: Props) {
  useMapEvents({
    click(e) {
      if (active) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}
```

- [ ] **Step 2: Create DraggableSystemMarker.tsx**

Extract the `DraggableSystemMarker` component from `BaseDefenseArchitect.tsx` (lines ~540-700). This component renders a Leaflet marker with a custom icon (circle/diamond/hexagon based on category), handles drag events, and shows selection state.

Copy the component verbatim — it uses Leaflet's `L.divIcon` to create SVG-based markers. The key props are:
- `system: PlacedSystem` — the placed system data
- `isSelected: boolean` — whether this system is currently selected
- `onClick: () => void` — selection handler
- `onDragEnd: (lat: number, lng: number) => void` — drag completion handler

Import `PlacedSystem` from `../types` and `COLORS`, `TYPE_COLORS` from `../constants`.

- [ ] **Step 3: Create EquipmentPalette.tsx**

The left sidebar showing selected equipment as clickable cards for placement mode.

```tsx
// frontend/src/components/bda/components/EquipmentPalette.tsx
import React from "react";
import type { SystemDef, PlacedSystem } from "../types";
import { COLORS } from "../constants";

interface PaletteItem {
  def: SystemDef;
  totalQty: number;
  placedQty: number;
  instanceLabel: string;
}

interface Props {
  items: PaletteItem[];
  activeDef: SystemDef | null;
  onSelectDef: (def: SystemDef | null) => void;
}

export default function EquipmentPalette({ items, activeDef, onSelectDef }: Props) {
  const allPlaced = items.every((item) => item.placedQty >= item.totalQty);

  return (
    <div
      style={{
        width: 240,
        background: COLORS.card,
        borderRight: `1px solid ${COLORS.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 }}>
          EQUIPMENT PALETTE
        </div>
        <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
          {items.filter((i) => i.placedQty >= i.totalQty).length}/{items.length} placed
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {items.map((item, i) => {
          const isPlaced = item.placedQty >= item.totalQty;
          const isActive = activeDef?.id === item.def.id && !isPlaced;
          return (
            <button
              key={`${item.def.id}-${i}`}
              onClick={() => {
                if (isPlaced) return;
                onSelectDef(isActive ? null : item.def);
              }}
              disabled={isPlaced}
              style={{
                width: "100%",
                padding: "8px 10px",
                marginBottom: 4,
                background: isActive ? `${item.def.color}20` : "transparent",
                border: `1px solid ${isActive ? item.def.color : isPlaced ? COLORS.border : COLORS.border}`,
                borderRadius: 6,
                cursor: isPlaced ? "default" : "pointer",
                textAlign: "left",
                opacity: isPlaced ? 0.5 : 1,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: isPlaced ? COLORS.muted : COLORS.text }}>
                {item.instanceLabel}
              </div>
              <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
                {isPlaced ? "✓ Placed" : isActive ? "Click map to place" : `${item.def.range_km}km range`}
              </div>
            </button>
          );
        })}
      </div>

      {allPlaced && (
        <div style={{ padding: "8px 14px", borderTop: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.success, textAlign: "center" }}>
          All systems placed ✓
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create SystemDetailPanel.tsx**

Extract the right-panel system detail view from `BaseDefenseArchitect.tsx` (lines ~2200-2825). This includes:
- System name, category, lat/lng display
- Altitude slider + altitude band presets (LOW/MED/HIGH)
- Altitude band legend with color indicator
- Facing controls (±5°, ±15°) for narrow-FOV systems
- Per-system visibility toggle checkbox
- Viewshed stats display (coverage %, elevation relief)
- SHOW ALL / HIDE ALL bulk visibility toggles
- System list with checkboxes
- Delete button

Props:
```typescript
interface Props {
  systems: PlacedSystem[];
  selectedSystem: PlacedSystem | null;
  onSelectSystem: (uid: string | null) => void;
  onAltitudeChange: (uid: string, alt: number) => void;
  onRotate: (uid: string, deltaDeg: number) => void;
  onToggleVisibility: (uid: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onDelete: (uid: string) => void;
  onRecalculate: (uid: string) => void;
}
```

Copy the rendering logic from the monolith's right panel section. Import `COLORS`, `ALTITUDE_BANDS`, `getAltitudeBand`, `getAltitudeBandLabel` from `../constants`.

- [ ] **Step 5: Create BdaPlacement.tsx**

This is the main placement step. It assembles the map, palette, markers, viewshed overlays, and detail panel.

The component receives:
```typescript
interface Props {
  baseTemplate: BaseTemplate;
  selectedEquipment: SelectedEquipment;
  systems: PlacedSystem[];
  onSystemsChange: (systems: PlacedSystem[]) => void;
  onBack: () => void;
  onNext: () => void;
}
```

This component contains:
- The Leaflet `MapContainer` with tile layer, base boundary polygon, terrain overlays
- Viewshed polygon rendering (green visible, red blocked) — filtered by `sys.visible`
- Range ring rendering for non-LOS systems
- FOV wedge rendering for narrow-FOV systems
- `MapClickHandler` for placement mode
- `DraggableSystemMarker` for each placed system
- `EquipmentPalette` sidebar (left)
- `SystemDetailPanel` sidebar (right)
- All placement callbacks: `handlePlace`, `handleDragEnd`, `handleAltitudeChange`, `handleRotate`, `handleDelete`, `handleToggleVisibility`, `fetchViewshedForSystem`

**Critical:** Copy the viewshed rendering, range ring rendering, FOV wedge rendering, and fly-to logic from the current `BaseDefenseArchitect.tsx` render section (lines ~1800-2100). These are Leaflet `<Polygon>` and `<Circle>` components that must be preserved exactly.

Import `computeViewshed`, `viewshedCache`, `cacheKey`, `offsetLatLng`, `NUM_RAYS` from `../viewshed`.

The `onNext` button should be disabled until all selected equipment items have been placed on the map. Build a `paletteItems` list from `selectedEquipment` and check that each item's `placedQty >= totalQty`.

- [ ] **Step 6: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/bda/BdaPlacement.tsx frontend/src/components/bda/components/
git commit -m "feat(bda): add placement step with map, viewshed, palette, and detail panel"
```

---

### Task 8: Create BdaExport Component (Step 4)

The export step with coverage summary, scenario picker, and launch/download actions.

**Files:**
- Create: `frontend/src/components/bda/BdaExport.tsx`

- [ ] **Step 1: Create BdaExport.tsx**

```tsx
// frontend/src/components/bda/BdaExport.tsx
import React, { useState, useEffect, useMemo } from "react";
import type { BaseTemplate, PlacementConfig, ScenarioInfo } from "../../types";
import type { PlacedSystem } from "./types";
import { COLORS } from "./constants";
import { latLngToGameXY } from "../../utils/coordinates";

interface Props {
  baseTemplate: BaseTemplate;
  systems: PlacedSystem[];
  onExportToMission?: (placement: PlacementConfig, scenarioId: string, baseId: string) => void;
  onBack: () => void;
  onBackToMenu: () => void;
}

export default function BdaExport({ baseTemplate, systems, onExportToMission, onBack, onBackToMenu }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("free_play");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/scenarios/index.json`)
      .then((res) => res.json())
      .then((data: ScenarioInfo[]) => {
        // Filter out tutorial for BDA export
        setScenarios(data.filter((s) => s.id !== "tutorial"));
      })
      .catch(() => {});
  }, []);

  // Build coverage summary
  const systemsByCategory = useMemo(() => {
    const counts: Record<string, { name: string; count: number; color: string }> = {};
    for (const sys of systems) {
      const key = sys.def.id;
      if (!counts[key]) {
        const color = sys.def.category === "sensor" ? "#388bfd" : sys.def.category === "effector" ? "#f85149" : "#bc8cff";
        counts[key] = { name: sys.def.name, count: 0, color };
      }
      counts[key].count++;
    }
    return Object.values(counts);
  }, [systems]);

  // Approach corridor coverage analysis
  const corridorCoverage = useMemo(() => {
    if (!baseTemplate.approach_corridors?.length) return [];
    const baseLat = baseTemplate.center_lat ?? 32.5;
    const baseLng = baseTemplate.center_lng ?? 45.5;

    return baseTemplate.approach_corridors.map((corridor) => {
      // Check which sensors can cover this corridor bearing
      const coveringSystems = systems.filter((sys) => {
        if (sys.def.category === "effector") return false;
        // For 360° systems, they cover all corridors
        if (sys.def.fov_deg >= 360) return true;
        // For narrow FOV, check if corridor bearing falls within FOV arc
        const halfFov = sys.def.fov_deg / 2;
        const facingRad = sys.facing_deg;
        let diff = Math.abs(corridor.bearing_deg - facingRad);
        if (diff > 180) diff = 360 - diff;
        return diff <= halfFov;
      });

      const coverage = coveringSystems.length > 0 ? (coveringSystems.length >= 2 ? 1.0 : 0.6) : 0;
      const status = coverage >= 1.0 ? "COVERED" : coverage > 0 ? "PARTIAL" : "GAP";
      const statusColor = status === "COVERED" ? COLORS.success : status === "PARTIAL" ? COLORS.warning : COLORS.danger;

      return { name: corridor.name, bearing: corridor.bearing_deg, coverage, status, statusColor };
    });
  }, [baseTemplate, systems]);

  const gaps = corridorCoverage.filter((c) => c.status === "GAP");

  const buildPlacementConfig = (): PlacementConfig => {
    const baseLat = baseTemplate.center_lat ?? 32.5;
    const baseLng = baseTemplate.center_lng ?? 45.5;

    const placement: PlacementConfig = {
      base_id: baseTemplate.id,
      sensors: [],
      effectors: [],
      combined: [],
      boundary: baseTemplate.boundary,
      placement_bounds_km: baseTemplate.placement_bounds_km,
    };

    for (const sys of systems) {
      const { x, y } = latLngToGameXY(sys.lat, sys.lng, baseLat, baseLng);
      const item = { catalog_id: sys.def.id, x, y, facing_deg: sys.facing_deg };
      if (sys.def.category === "sensor") placement.sensors.push(item);
      else if (sys.def.category === "effector") placement.effectors.push(item);
      else if (sys.def.category === "combined") placement.combined.push(item);
    }

    return placement;
  };

  const handleLaunch = () => {
    if (!onExportToMission) return;
    const placement = buildPlacementConfig();
    onExportToMission(placement, selectedScenarioId, baseTemplate.id);
  };

  const handleDownload = () => {
    const placement = buildPlacementConfig();
    const blob = new Blob([JSON.stringify(placement, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bda-${baseTemplate.id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 900, margin: "0 auto" }}>
          {/* Left: Coverage Summary */}
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, color: COLORS.text, fontFamily: "'Inter', sans-serif" }}>
              Coverage Summary
            </h3>

            {/* Systems placed */}
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <div style={{ color: COLORS.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Systems Placed
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {systemsByCategory.map((s) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                    <span style={{ color: COLORS.text, fontSize: 13 }}>
                      {s.name} ×{s.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Corridor coverage */}
            {corridorCoverage.length > 0 && (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
                <div style={{ color: COLORS.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Approach Corridor Coverage
                </div>
                {corridorCoverage.map((c) => (
                  <div key={c.name} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: COLORS.text, fontSize: 13 }}>{c.name} ({c.bearing}°)</span>
                      <span style={{ color: c.statusColor, fontSize: 13, fontWeight: 600 }}>{c.status}</span>
                    </div>
                    <div style={{ height: 4, background: COLORS.border, borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${c.coverage * 100}%`, background: c.statusColor, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Gap warning */}
            {gaps.length > 0 && (
              <div
                style={{
                  background: `${COLORS.danger}10`,
                  border: `1px solid ${COLORS.danger}40`,
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <span style={{ color: COLORS.danger, fontSize: 16 }}>⚠</span>
                <div>
                  <div style={{ color: COLORS.danger, fontSize: 13, fontWeight: 600 }}>Coverage Gap Detected</div>
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>
                    {gaps.map((g) => g.name).join(", ")} corridor{gaps.length > 1 ? "s have" : " has"} limited sensor coverage.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Export Actions */}
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, color: COLORS.text, fontFamily: "'Inter', sans-serif" }}>
              Launch Mission
            </h3>

            {/* Scenario picker */}
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <div style={{ color: COLORS.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Select Scenario
              </div>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                style={{
                  width: "100%",
                  background: COLORS.bg,
                  color: COLORS.text,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.description.slice(0, 60)}...
                  </option>
                ))}
              </select>
            </div>

            {/* Launch button */}
            {onExportToMission && (
              <button
                onClick={handleLaunch}
                style={{
                  width: "100%",
                  background: COLORS.accent,
                  border: "none",
                  color: COLORS.bg,
                  padding: 16,
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: "pointer",
                  marginBottom: 12,
                  letterSpacing: 0.5,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                ▶ LAUNCH MISSION
              </button>
            )}

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
              <span style={{ color: COLORS.muted, fontSize: 12 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
            </div>

            <h3 style={{ color: COLORS.text, fontSize: 16, fontFamily: "'Inter', sans-serif" }}>Save Design</h3>
            <button
              onClick={handleDownload}
              style={{
                width: "100%",
                background: "none",
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                padding: 14,
                borderRadius: 8,
                fontSize: 14,
                cursor: "pointer",
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              ↓ DOWNLOAD JSON
            </button>
            <div style={{ color: COLORS.muted, fontSize: 12, textAlign: "center" }}>
              Save placement config to file — load later or share with your unit
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          padding: "12px 24px",
          borderTop: `1px solid ${COLORS.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          ← BACK TO PLACEMENT
        </button>
        <button
          onClick={onBackToMenu}
          style={{
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          BACK TO MENU
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bda/BdaExport.tsx
git commit -m "feat(bda): add export step with coverage summary, scenario picker, and launch/download"
```

---

### Task 9: Rewrite BaseDefenseArchitect as Stepper Shell

Replace the 2830-line monolith with a thin stepper shell that holds shared state and renders the active step component.

**Files:**
- Modify: `frontend/src/components/BaseDefenseArchitect.tsx` (full rewrite)

- [ ] **Step 1: Rewrite BaseDefenseArchitect.tsx**

```tsx
// frontend/src/components/BaseDefenseArchitect.tsx
import React, { useState, useCallback, useMemo } from "react";
import type { BaseTemplate, PlacementConfig } from "../types";
import type { BdaStep, PlacedSystem, SelectedEquipment } from "./bda/types";
import { COLORS } from "./bda/constants";
import BdaStepIndicator from "./bda/BdaStepIndicator";
import BdaBaseSelection from "./bda/BdaBaseSelection";
import BdaEquipmentSelection from "./bda/BdaEquipmentSelection";
import BdaPlacement from "./bda/BdaPlacement";
import BdaExport from "./bda/BdaExport";

interface Props {
  onBack: () => void;
  onExportToMission?: (placement: PlacementConfig, scenarioId: string, baseId: string) => void;
}

export default function BaseDefenseArchitect({ onBack, onExportToMission }: Props) {
  // ─── Stepper state ──────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<BdaStep>(1);

  // ─── Step 1 state ───────────────────────────────────────────────────────
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [baseTemplate, setBaseTemplate] = useState<BaseTemplate | null>(null);

  // ─── Step 2 state ───────────────────────────────────────────────────────
  const [selectedEquipment, setSelectedEquipment] = useState<SelectedEquipment>({
    sensors: [],
    effectors: [],
    combined: [],
  });

  // ─── Step 3 state ───────────────────────────────────────────────────────
  const [systems, setSystems] = useState<PlacedSystem[]>([]);

  // ─── Completed steps tracking ───────────────────────────────────────────
  const completedSteps = useMemo(() => {
    const completed = new Set<BdaStep>();
    if (selectedBaseId && baseTemplate) completed.add(1);
    const totalEquipment =
      selectedEquipment.sensors.reduce((s, e) => s + e.qty, 0) +
      selectedEquipment.effectors.reduce((s, e) => s + e.qty, 0) +
      selectedEquipment.combined.reduce((s, e) => s + e.qty, 0);
    if (totalEquipment > 0) completed.add(2);
    if (systems.length > 0) completed.add(3);
    return completed;
  }, [selectedBaseId, baseTemplate, selectedEquipment, systems]);

  // ─── Navigation handlers ────────────────────────────────────────────────
  const goToStep = useCallback((step: BdaStep) => {
    setCurrentStep(step);
  }, []);

  const handleBaseSelect = useCallback((baseId: string, template: BaseTemplate) => {
    // Warn if changing base and selected equipment exceeds new limits
    const totalCombined = selectedEquipment.combined.reduce((s, e) => s + e.qty, 0);
    const totalSensors = selectedEquipment.sensors.reduce((s, e) => s + e.qty, 0) + totalCombined;
    const totalEffectors = selectedEquipment.effectors.reduce((s, e) => s + e.qty, 0) + totalCombined;
    if (
      (totalSensors > template.max_sensors || totalEffectors > template.max_effectors) &&
      !window.confirm(
        `This base allows max ${template.max_sensors} sensors and ${template.max_effectors} effectors. ` +
        `You have ${totalSensors} sensors and ${totalEffectors} effectors selected. ` +
        `Change base anyway? You'll need to reduce equipment in step 2.`
      )
    ) {
      return;
    }
    setSelectedBaseId(baseId);
    setBaseTemplate(template);
  }, [selectedEquipment]);

  const handleEquipmentChange = useCallback((equipment: SelectedEquipment) => {
    setSelectedEquipment(equipment);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', 'JetBrains Mono', monospace",
        overflow: "hidden",
      }}
    >
      <BdaStepIndicator
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={goToStep}
      />

      {currentStep === 1 && (
        <BdaBaseSelection
          selectedBaseId={selectedBaseId}
          onSelectBase={handleBaseSelect}
          onBack={onBack}
          onNext={() => setCurrentStep(2)}
        />
      )}

      {currentStep === 2 && baseTemplate && (
        <BdaEquipmentSelection
          maxSensors={baseTemplate.max_sensors}
          maxEffectors={baseTemplate.max_effectors}
          selectedEquipment={selectedEquipment}
          onUpdateEquipment={handleEquipmentChange}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      )}

      {currentStep === 3 && baseTemplate && (
        <BdaPlacement
          baseTemplate={baseTemplate}
          selectedEquipment={selectedEquipment}
          systems={systems}
          onSystemsChange={setSystems}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
        />
      )}

      {currentStep === 4 && baseTemplate && (
        <BdaExport
          baseTemplate={baseTemplate}
          systems={systems}
          onExportToMission={onExportToMission}
          onBack={() => setCurrentStep(3)}
          onBackToMenu={onBack}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. If there are type errors, fix them before proceeding.

- [ ] **Step 3: Verify the dev server starts**

Run: `cd frontend && npm run dev -- --host 0.0.0.0 &` then check http://localhost:5173 loads.
Navigate to Base Defense Architect from the main menu and verify all 4 steps render.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BaseDefenseArchitect.tsx
git commit -m "refactor(bda): rewrite monolith as thin stepper shell with 4-step flow"
```

---

### Task 10: Integration Testing and Polish

Manually test the full flow end-to-end and fix any issues.

**Files:**
- Modify: Various files as needed for bug fixes

- [ ] **Step 1: Test Step 1 → Step 2 transition**

1. Open BDA from main menu
2. Click a base template card (e.g., Medium Airbase)
3. Verify card highlights with accent border
4. Verify "SELECT EQUIPMENT →" button enables
5. Click it — verify step 2 renders with correct max limits in header

- [ ] **Step 2: Test Step 2 → Step 3 transition**

1. Add equipment using +/- buttons
2. Verify limit counters update (e.g., "2/4 sensors")
3. Verify limit enforcement (can't add beyond max)
4. Click "PLACE SYSTEMS →"
5. Verify step 3 renders with map and equipment palette

- [ ] **Step 3: Test Step 3 placement flow**

1. Click an equipment card in the palette
2. Click on the map to place it
3. Verify marker appears at click location
4. Verify viewshed loads for LOS systems (green/red polygons)
5. Drag a marker and verify viewshed updates
6. Adjust altitude slider and verify viewshed recalculates
7. Toggle per-system visibility checkboxes
8. Verify palette shows placement progress

- [ ] **Step 4: Test Step 4 export**

1. Place all equipment
2. Click "REVIEW & EXPORT →"
3. Verify coverage summary shows placed systems
4. Verify corridor coverage analysis (if base has corridors)
5. Select a scenario
6. Click "LAUNCH MISSION" — verify game starts
7. Test "DOWNLOAD JSON" — verify file downloads

- [ ] **Step 5: Test back navigation**

1. From step 3, click BACK — verify equipment selection is preserved
2. From step 2, click BACK — verify base selection is preserved
3. From step 3 with systems placed, go back to step 1 and return — verify placed systems still exist

- [ ] **Step 6: Fix any issues found during testing**

Address any bugs discovered in steps 1-5.

- [ ] **Step 7: Commit fixes**

```bash
git add -u
git commit -m "fix(bda): integration fixes for stepper flow"
```

---

### Task 11: Clean Up Old Monolith Code

Delete any dead code that was replaced by the new step components.

**Files:**
- Verify: No dead imports or unused code in `BaseDefenseArchitect.tsx`

- [ ] **Step 1: Verify no dead code remains**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Clean build.

- [ ] **Step 2: Run existing tests**

Run: `cd frontend && npm test`
Expected: All 28 game engine tests pass. BDA has no tests yet (out of scope — game engine tests should be unaffected).

- [ ] **Step 3: Commit and verify**

```bash
git add -u
git commit -m "chore(bda): remove dead monolith code after stepper refactor"
```
