import type { SystemDef } from "../types";
import { COLORS, TYPE_COLORS } from "../constants";

export interface PaletteItem {
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
  const totalCount = items.length;
  const placedCount = items.filter((it) => it.placedQty >= it.totalQty).length;
  const allPlaced = placedCount === totalCount && totalCount > 0;

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${COLORS.border}`,
        background: COLORS.card,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 12px 10px",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            color: COLORS.accent,
            marginBottom: 4,
          }}
        >
          EQUIPMENT PALETTE
        </div>
        <div style={{ fontSize: 10, color: COLORS.muted }}>
          {placedCount}/{totalCount} placed
        </div>
      </div>

      {/* Items list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {items.map((item, idx) => {
          const isPlaced = item.placedQty >= item.totalQty;
          const isActive = activeDef?.id === item.def.id && !isPlaced;
          const typeColor = TYPE_COLORS[item.def.type] || COLORS.muted;

          return (
            <button
              key={`${item.def.id}-${idx}`}
              onClick={() => {
                if (isPlaced) return;
                onSelectDef(isActive ? null : item.def);
              }}
              disabled={isPlaced}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "10px",
                background: isPlaced
                  ? `${COLORS.success}08`
                  : isActive
                    ? `${item.def.color}18`
                    : COLORS.bg,
                border: `1px solid ${
                  isPlaced
                    ? `${COLORS.success}40`
                    : isActive
                      ? item.def.color
                      : COLORS.border
                }`,
                borderRadius: 6,
                cursor: isPlaced ? "default" : "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                transition: "all 0.1s",
                width: "100%",
                opacity: isPlaced ? 0.5 : 1,
              }}
            >
              {/* Name + type tag */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isActive ? item.def.color : COLORS.text,
                    letterSpacing: 0.3,
                  }}
                >
                  {item.instanceLabel}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: typeColor,
                    background: `${typeColor}1a`,
                    padding: "1px 6px",
                    borderRadius: 3,
                    border: `1px solid ${typeColor}33`,
                  }}
                >
                  {item.def.type}
                </span>
              </div>

              {/* Stats row */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: COLORS.muted,
                }}
              >
                {item.def.category === "combined" ? (
                  <>
                    <span>
                      DET{" "}
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>
                        {item.def.sensor_range_km}km
                      </span>
                    </span>
                    <span>
                      DEF{" "}
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>
                        {item.def.effector_range_km}km
                      </span>
                    </span>
                  </>
                ) : (
                  <span>
                    RNG{" "}
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>
                      {item.def.range_km}km
                    </span>
                  </span>
                )}
                {item.def.fov_deg < 360 && (
                  <span>
                    FOV{" "}
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>
                      {item.def.fov_deg}&deg;
                    </span>
                  </span>
                )}
              </div>

              {/* Status */}
              {isPlaced && (
                <div style={{ fontSize: 9, fontWeight: 600, color: COLORS.success }}>
                  Placed
                </div>
              )}
              {isActive && (
                <div style={{ fontSize: 9, fontWeight: 600, color: item.def.color }}>
                  Click map to place
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {allPlaced && (
        <div
          style={{
            padding: "10px 12px",
            borderTop: `1px solid ${COLORS.border}`,
            fontSize: 10,
            fontWeight: 600,
            color: COLORS.success,
            textAlign: "center",
          }}
        >
          All systems placed
        </div>
      )}
    </div>
  );
}
