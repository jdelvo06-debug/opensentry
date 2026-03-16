import type { EffectorStatus } from "../types";

interface Props {
  effectors: EffectorStatus[];
}

const STATUS_COLORS: Record<string, string> = {
  ready: "#3fb950",
  recharging: "#d29922",
  offline: "#f85149",
};

const EFFECTOR_NAMES: Record<string, string> = {
  jammer: "RF JAMMER",
  kinetic: "KINETIC",
  interceptor: "INTERCEPTOR DRONE",
  directed_energy: "DIRECTED ENERGY",
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
        const color = STATUS_COLORS[eff.status] || "#484f58";
        const displayName =
          eff.name || EFFECTOR_NAMES[eff.type || ""] || eff.id.toUpperCase();

        return (
          <div
            key={eff.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 4px",
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
                boxShadow: eff.status === "ready" ? `0 0 6px ${color}88` : "none",
                flexShrink: 0,
              }}
            />
            {/* Name */}
            <div
              style={{
                flex: 1,
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
              {eff.status.toUpperCase()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
