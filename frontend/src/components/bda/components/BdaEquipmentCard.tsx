import React from "react";
import { COLORS } from "../constants";

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
  name, category, type, rangeKm, sensorRangeKm, effectorRangeKm,
  fovDeg, requiresLos, qty, maxReached, onIncrement, onDecrement,
}: Props) {
  const borderColor = CATEGORY_COLORS[category] || COLORS.border;
  const isCombined = category === "combined";

  return (
    <div style={{
      background: COLORS.card,
      border: `1px solid ${qty > 0 ? borderColor : COLORS.border}`,
      borderRadius: 8,
      padding: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {/* Name + LOS badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, color: COLORS.text, fontSize: 14 }}>{name}</span>
            {requiresLos && (
              <span style={{
                background: `${COLORS.success}30`, color: COLORS.success,
                padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600,
              }}>LOS</span>
            )}
          </div>

          {/* Category tag */}
          <span style={{
            display: "inline-block", background: `${borderColor}20`, color: borderColor,
            padding: "1px 6px", borderRadius: 3, fontSize: 10, marginTop: 3,
            textTransform: "uppercase", fontWeight: 600,
          }}>{category}</span>

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
          <button onClick={onDecrement} disabled={qty === 0} style={{
            width: 24, height: 24, borderRadius: "50%", background: COLORS.border,
            border: `1px solid ${COLORS.muted}50`, color: qty === 0 ? COLORS.muted : COLORS.text,
            cursor: qty === 0 ? "not-allowed" : "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Inter', sans-serif",
          }}>−</button>
          <span style={{
            color: qty > 0 ? COLORS.text : COLORS.muted,
            fontWeight: 700, fontSize: 16, minWidth: 20, textAlign: "center",
          }}>{qty}</span>
          <button onClick={onIncrement} disabled={maxReached && qty === 0} style={{
            width: 24, height: 24, borderRadius: "50%",
            background: maxReached && qty === 0 ? COLORS.border : COLORS.accent,
            border: "none", color: maxReached && qty === 0 ? COLORS.muted : COLORS.bg,
            cursor: maxReached && qty === 0 ? "not-allowed" : "pointer",
            fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Inter', sans-serif",
          }}>+</button>
        </div>
      </div>
    </div>
  );
}
