import type { EffectorStatus } from "../types";

interface Props {
  effectors: EffectorStatus[];
}

const STATUS_COLORS: Record<string, string> = {
  ready: "#3fb950",
  recharging: "#d29922",
  offline: "#f85149",
  depleted: "#f85149",
};

export default function EffectorPanel({ effectors }: Props) {
  return (
    <div style={{ padding: "12px 12px 8px" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: 1.5,
          marginBottom: 10,
        }}
      >
        EFFECTORS
      </div>
      {effectors.map((eff) => {
        const isDepleted = eff.ammo_remaining != null && eff.ammo_remaining <= 0;
        const effectiveStatus = isDepleted ? "depleted" : eff.status;
        const color = STATUS_COLORS[effectiveStatus] || "#484f58";
        const displayName = eff.name || eff.id.toUpperCase();

        return (
          <div
            key={eff.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              padding: "4px 4px",
              borderRadius: 4,
              marginBottom: 2,
            }}
          >
            {/* Status dot */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                boxShadow: effectiveStatus === "ready" ? `0 0 6px ${color}88` : "none",
                flexShrink: 0,
              }}
            />
            {/* Name + ammo */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#e6edf3",
                  letterSpacing: 0.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </div>
              {/* Ammo bar for items with ammo_count */}
              {eff.ammo_count != null && eff.ammo_remaining != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <div style={{
                    display: "flex",
                    gap: 2,
                  }}>
                    {Array.from({ length: eff.ammo_count }).map((_, idx) => (
                      <div
                        key={idx}
                        style={{
                          width: 8,
                          height: 12,
                          borderRadius: 2,
                          background: idx < eff.ammo_remaining!
                            ? "#3fb950"
                            : "#21262d",
                          border: `1px solid ${idx < eff.ammo_remaining! ? "#3fb95066" : "#30363d"}`,
                        }}
                      />
                    ))}
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: isDepleted ? "#f85149" : "#8b949e",
                    whiteSpace: "nowrap",
                  }}>
                    {isDepleted ? "DEPLETED" : `${eff.ammo_remaining}/${eff.ammo_count}`}
                  </span>
                </div>
              )}
            </div>
            {/* Range */}
            {eff.range_km != null && (
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#8b949e",
                  whiteSpace: "nowrap",
                }}
              >
                {eff.range_km}km
              </div>
            )}
            {/* Status label */}
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: color,
                letterSpacing: 0.5,
                whiteSpace: "nowrap",
              }}
            >
              {isDepleted ? "DEPLETED" : eff.status.toUpperCase()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
