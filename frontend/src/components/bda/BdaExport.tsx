// frontend/src/components/bda/BdaExport.tsx
import React, { useState, useEffect, useCallback } from "react";
import type { BaseTemplate, PlacementConfig, ScenarioInfo } from "../../types";
import type { PlacedSystem } from "./types";
import { COLORS } from "./constants";
import { latLngToGameXY } from "../../utils/coordinates";

interface Props {
  baseTemplate: BaseTemplate;
  systems: PlacedSystem[];
  onExportToMission?: (placement: PlacementConfig, scenarioId: string, baseId: string, baseTemplate: BaseTemplate) => void;
  onBack: () => void;
  onBackToMenu: () => void;
}

// Category colors for the placed-systems summary dots
const CAT_COLORS: Record<string, string> = {
  sensor: "#388bfd",
  effector: "#f85149",
  combined: "#bc8cff",
};

// ─── Coverage status helpers ──────────────────────────────────────────────────

type CoverageStatus = "COVERED" | "PARTIAL" | "GAP";

interface CorridorCoverage {
  name: string;
  bearing_deg: number;
  coveringCount: number;
  status: CoverageStatus;
}

function bearingInFov(
  systemFacing: number,
  fovDeg: number,
  corridorBearing: number,
): boolean {
  const half = fovDeg / 2;
  // Normalise difference to [-180, 180]
  let diff = ((corridorBearing - systemFacing + 540) % 360) - 180;
  return Math.abs(diff) <= half;
}

function analyzeCoverage(
  corridors: BaseTemplate["approach_corridors"],
  systems: PlacedSystem[],
): CorridorCoverage[] {
  return corridors.map((corridor) => {
    let count = 0;
    for (const sys of systems) {
      const isActive = sys.def.category === "sensor" || sys.def.category === "combined";
      if (!isActive) continue;

      if (sys.def.fov_deg >= 360) {
        // 360° sensors always cover
        count++;
      } else {
        if (bearingInFov(sys.facing_deg, sys.def.fov_deg, corridor.bearing_deg)) {
          count++;
        }
      }
    }

    let status: CoverageStatus;
    if (count === 0) status = "GAP";
    else if (count === 1) status = "PARTIAL";
    else status = "COVERED";

    return { name: corridor.name, bearing_deg: corridor.bearing_deg, coveringCount: count, status };
  });
}

// ─── PlacementConfig builder ──────────────────────────────────────────────────

function buildPlacement(baseTemplate: BaseTemplate, systems: PlacedSystem[]): PlacementConfig {
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
    else placement.combined.push(item);
  }

  return placement;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CoverageStatus }) {
  const colors: Record<CoverageStatus, string> = {
    COVERED: COLORS.success,
    PARTIAL: COLORS.warning,
    GAP: COLORS.danger,
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        color: colors[status],
        minWidth: 58,
        textAlign: "right",
      }}
    >
      {status}
    </span>
  );
}

function ProgressBar({ status, count }: { status: CoverageStatus; count: number }) {
  const maxVisual = 4;
  const fill = Math.min(count, maxVisual) / maxVisual;
  const barColors: Record<CoverageStatus, string> = {
    COVERED: COLORS.success,
    PARTIAL: COLORS.warning,
    GAP: COLORS.danger,
  };
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: "#1a2235",
        overflow: "hidden",
        flex: 1,
        margin: "0 10px",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${fill * 100}%`,
          background: barColors[status],
          borderRadius: 3,
          transition: "width 0.3s ease",
          minWidth: count > 0 ? 6 : 0,
        }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BdaExport({
  baseTemplate,
  systems,
  onExportToMission,
  onBack,
  onBackToMenu,
}: Props) {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("free_play");
  const [downloadDone, setDownloadDone] = useState(false);

  // ─── Load scenario index ────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/scenarios/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ScenarioInfo[]>;
      })
      .then((data) => {
        const filtered = data.filter((s) => s.id !== "tutorial");
        setScenarios(filtered);
        // Default to free_play if present, otherwise first
        const hasFreePlay = filtered.some((s) => s.id === "free_play");
        setSelectedScenarioId(hasFreePlay ? "free_play" : (filtered[0]?.id ?? "free_play"));
        setScenariosLoading(false);
      })
      .catch(() => setScenariosLoading(false));
  }, []);

  // ─── Coverage analysis ──────────────────────────────────────────────────────

  const corridorCoverage = baseTemplate.approach_corridors?.length
    ? analyzeCoverage(baseTemplate.approach_corridors, systems)
    : [];

  const hasGap = corridorCoverage.some((c) => c.status === "GAP");

  // ─── Systems summary (group by def.id) ─────────────────────────────────────

  const systemGroups: { id: string; name: string; category: string; count: number }[] = [];
  const seen = new Map<string, number>();
  for (const sys of systems) {
    const key = sys.def.id;
    if (seen.has(key)) {
      seen.set(key, seen.get(key)! + 1);
    } else {
      seen.set(key, 1);
      systemGroups.push({
        id: key,
        name: sys.def.name,
        category: sys.def.category,
        count: 0,
      });
    }
  }
  for (const g of systemGroups) {
    g.count = seen.get(g.id) ?? 0;
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleLaunch = useCallback(() => {
    if (!onExportToMission) return;
    const placement = buildPlacement(baseTemplate, systems);
    onExportToMission(placement, selectedScenarioId, baseTemplate.id, baseTemplate);
  }, [onExportToMission, baseTemplate, systems, selectedScenarioId]);

  const handleDownload = useCallback(() => {
    const placement = buildPlacement(baseTemplate, systems);
    const json = JSON.stringify(placement, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const timestamp = Date.now();
    const a = document.createElement("a");
    a.href = url;
    a.download = `bda-${baseTemplate.id}-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadDone(true);
    setTimeout(() => setDownloadDone(false), 2500);
  }, [baseTemplate, systems]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px" }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          {/* ── Left panel: Coverage Summary ────────────────────────────────── */}
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Systems placed */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  color: COLORS.muted,
                  textTransform: "uppercase",
                  marginBottom: 12,
                }}
              >
                Systems placed
              </div>

              {systems.length === 0 ? (
                <p style={{ color: COLORS.muted, fontSize: 13, margin: 0 }}>No systems placed.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {systemGroups.map((g) => (
                    <div
                      key={g.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: CAT_COLORS[g.category] ?? COLORS.muted,
                          flexShrink: 0,
                          display: "inline-block",
                        }}
                      />
                      <span style={{ color: COLORS.text }}>
                        {g.name}{" "}
                        <span style={{ color: COLORS.muted }}>×{g.count}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Approach corridor coverage */}
            {corridorCoverage.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    color: COLORS.muted,
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  Approach corridor coverage
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {corridorCoverage.map((c) => (
                    <div key={c.name}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 4,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: COLORS.text }}>
                          {c.name}
                          <span style={{ color: COLORS.muted, marginLeft: 6 }}>
                            {c.bearing_deg}°
                          </span>
                        </span>
                        <StatusBadge status={c.status} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: COLORS.muted, minWidth: 30 }}>
                          {c.coveringCount}
                        </span>
                        <ProgressBar status={c.status} count={c.coveringCount} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gap warning */}
            {hasGap && (
              <div
                style={{
                  background: "rgba(248, 81, 73, 0.12)",
                  border: `1px solid ${COLORS.danger}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 700, color: COLORS.danger, marginBottom: 3 }}
                  >
                    Coverage Gap Detected
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.text, opacity: 0.8 }}>
                    One or more approach corridors have no sensor coverage. Consider adding sensors
                    or adjusting facing angles before launching.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel: Export Actions ──────────────────────────────────── */}
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Scenario picker (only if launch is available) */}
            {onExportToMission && (
              <div>
                <label
                  htmlFor="bda-scenario-select"
                  style={{
                    display: "block",
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    color: COLORS.muted,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Scenario
                </label>
                <select
                  id="bda-scenario-select"
                  value={selectedScenarioId}
                  disabled={scenariosLoading}
                  onChange={(e) => setSelectedScenarioId(e.target.value)}
                  style={{
                    width: "100%",
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 6,
                    color: COLORS.text,
                    padding: "8px 12px",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: scenariosLoading ? "not-allowed" : "pointer",
                    outline: "none",
                  }}
                >
                  {scenariosLoading ? (
                    <option value="">Loading…</option>
                  ) : (
                    scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.difficulty ? ` — ${s.difficulty}` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* LAUNCH MISSION button */}
            {onExportToMission && (
              <button
                type="button"
                onClick={handleLaunch}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  background: COLORS.accent,
                  border: "none",
                  borderRadius: 6,
                  color: "#0a0e1a",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                LAUNCH MISSION
              </button>
            )}

            {/* OR divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
              <span style={{ fontSize: 11, color: COLORS.muted, letterSpacing: "0.1em" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
            </div>

            {/* DOWNLOAD JSON button */}
            <button
              type="button"
              onClick={handleDownload}
              style={{
                width: "100%",
                padding: "14px 0",
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                color: downloadDone ? COLORS.success : COLORS.text,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.1em",
                fontFamily: "inherit",
                cursor: "pointer",
                textTransform: "uppercase",
                transition: "color 0.2s ease",
              }}
            >
              {downloadDone ? "DOWNLOADED ✓" : "DOWNLOAD JSON"}
            </button>

            {/* Helper text */}
            <p style={{ fontSize: 12, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>
              The downloaded JSON can be loaded by the PlacementScreen on a future session or
              shared with other operators.
            </p>
          </div>
        </div>
      </div>

      {/* ── Fixed bottom bar ────────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: `1px solid ${COLORS.border}`,
          padding: "12px 24px",
          background: COLORS.bg,
          display: "flex",
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.text,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            fontFamily: "inherit",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          ← BACK TO PLACEMENT
        </button>

        <button
          type="button"
          onClick={onBackToMenu}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            fontFamily: "inherit",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          BACK TO MENU
        </button>
      </div>
    </div>
  );
}
