// frontend/src/components/bda/BdaEquipmentSelection.tsx
import React, { useState, useEffect, useMemo } from "react";
import type { EquipmentCatalog } from "../../types";
import type { SelectedEquipment } from "./types";
import { COLORS } from "./constants";
import BdaEquipmentCard from "./components/BdaEquipmentCard";

type FilterTab = "all" | "sensor" | "effector" | "combined";

interface Props {
  selectedEquipment: SelectedEquipment;
  onUpdateEquipment: (equipment: SelectedEquipment) => void;
  onBack: () => void;
  onNext: () => void;
}

const TABS: { key: FilterTab; label: string; color: string }[] = [
  { key: "all", label: "ALL", color: COLORS.accent },
  { key: "sensor", label: "SENSORS", color: "#388bfd" },
  { key: "effector", label: "EFFECTORS", color: "#f85149" },
  { key: "combined", label: "COMBINED", color: "#bc8cff" },
];

function getQty(
  equipment: SelectedEquipment,
  category: "sensor" | "effector" | "combined",
  catalogId: string
): number {
  const list =
    category === "sensor"
      ? equipment.sensors
      : category === "effector"
      ? equipment.effectors
      : equipment.combined;
  return list.find((e) => e.catalogId === catalogId)?.qty ?? 0;
}

function setQty(
  equipment: SelectedEquipment,
  category: "sensor" | "effector" | "combined",
  catalogId: string,
  newQty: number
): SelectedEquipment {
  const clampedQty = Math.max(0, newQty);

  function updateList(
    list: { catalogId: string; qty: number }[]
  ): { catalogId: string; qty: number }[] {
    const existing = list.find((e) => e.catalogId === catalogId);
    if (existing) {
      if (clampedQty === 0) return list.filter((e) => e.catalogId !== catalogId);
      return list.map((e) => (e.catalogId === catalogId ? { ...e, qty: clampedQty } : e));
    }
    if (clampedQty === 0) return list;
    return [...list, { catalogId, qty: clampedQty }];
  }

  if (category === "sensor") return { ...equipment, sensors: updateList(equipment.sensors) };
  if (category === "effector") return { ...equipment, effectors: updateList(equipment.effectors) };
  return { ...equipment, combined: updateList(equipment.combined) };
}

function totalCount(list: { catalogId: string; qty: number }[]): number {
  return list.reduce((sum, e) => sum + e.qty, 0);
}

export default function BdaEquipmentSelection({
  selectedEquipment,
  onUpdateEquipment,
  onBack,
  onNext,
}: Props) {
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  // ─── Load catalog ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/equipment/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EquipmentCatalog>;
      })
      .then((data) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // ─── Derived limit counters ───────────────────────────────────────────────



  const totalSelected = useMemo(
    () =>
      totalCount(selectedEquipment.sensors) +
      totalCount(selectedEquipment.effectors) +
      totalCount(selectedEquipment.combined),
    [selectedEquipment]
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleIncrement(
    category: "sensor" | "effector" | "combined",
    catalogId: string
  ) {
    const current = getQty(selectedEquipment, category, catalogId);
    onUpdateEquipment(setQty(selectedEquipment, category, catalogId, current + 1));
  }

  function handleDecrement(
    category: "sensor" | "effector" | "combined",
    catalogId: string
  ) {
    const current = getQty(selectedEquipment, category, catalogId);
    onUpdateEquipment(setQty(selectedEquipment, category, catalogId, current - 1));
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "'Inter', 'Roboto Mono', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 24px 0",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: COLORS.text }}>
              Select Equipment
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.muted }}>
              Choose sensors and effectors for your defensive layout
            </p>
          </div>


        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive ? `2px solid ${tab.color}` : "2px solid transparent",
                  color: isActive ? tab.color : COLORS.muted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: 0.8,
                  padding: "8px 16px",
                  textTransform: "uppercase",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Equipment grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && (
          <div style={{ color: COLORS.muted, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Loading catalog...
          </div>
        )}
        {error && (
          <div style={{ color: COLORS.danger, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Failed to load catalog: {error}
          </div>
        )}
        {catalog && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
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
                  qty={getQty(selectedEquipment, "sensor", s.catalog_id)}
                  maxReached={false}
                  onIncrement={() => handleIncrement("sensor", s.catalog_id)}
                  onDecrement={() => handleDecrement("sensor", s.catalog_id)}
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
                  qty={getQty(selectedEquipment, "effector", e.catalog_id)}
                  maxReached={false}
                  onIncrement={() => handleIncrement("effector", e.catalog_id)}
                  onDecrement={() => handleDecrement("effector", e.catalog_id)}
                />
              ))}

            {/* Combined */}
            {(activeTab === "all" || activeTab === "combined") &&
              (catalog.combined ?? []).map((c) => (
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
                  qty={getQty(selectedEquipment, "combined", c.catalog_id)}
                  maxReached={false}
                  onIncrement={() => handleIncrement("combined", c.catalog_id)}
                  onDecrement={() => handleDecrement("combined", c.catalog_id)}
                />
              ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.card,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.muted,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
            padding: "8px 18px",
          }}
        >
          ← BACK
        </button>

        <div style={{ color: COLORS.muted, fontSize: 13 }}>
          {totalSelected === 0 ? (
            <span>No systems selected</span>
          ) : (
            <span style={{ color: COLORS.text }}>
              <strong style={{ color: COLORS.accent }}>{totalSelected}</strong>{" "}
              {totalSelected === 1 ? "system" : "systems"} selected
            </span>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={totalSelected === 0}
          style={{
            background: totalSelected > 0 ? COLORS.accent : COLORS.border,
            border: "none",
            borderRadius: 6,
            color: totalSelected > 0 ? COLORS.bg : COLORS.muted,
            cursor: totalSelected > 0 ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            padding: "8px 18px",
          }}
        >
          PLACE SYSTEMS →
        </button>
      </div>
    </div>
  );
}
