import type { ThreatLevel } from "../types";

interface Props {
  elapsed: number;
  timeRemaining: number;
  threatLevel: ThreatLevel;
  scenarioName: string;
}

const THREAT_COLORS: Record<ThreatLevel, string> = {
  green: "#3fb950",
  yellow: "#d29922",
  orange: "#db6d28",
  red: "#f85149",
};

export default function HeaderBar({
  elapsed,
  timeRemaining,
  threatLevel,
  scenarioName,
}: Props) {
  const threatColor = THREAT_COLORS[threatLevel];
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.floor(timeRemaining % 60);

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        height: 48,
        background: "#161b22",
        borderBottom: "1px solid #30363d",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        gap: 16,
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220 }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#e6edf3",
            letterSpacing: 2,
          }}
        >
          SKYSHIELD
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#8b949e",
            letterSpacing: 1.5,
            fontWeight: 500,
          }}
        >
          C-UAS TRAINING SIMULATOR
        </span>
      </div>

      {/* Center: Mission clock */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, flex: 1, justifyContent: "center" }}>
        <span
          style={{
            fontSize: 11,
            color: "#8b949e",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {scenarioName}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 22,
            fontWeight: 700,
            color: "#e6edf3",
            letterSpacing: 1,
          }}
        >
          T+{elapsed.toFixed(1)}s
        </span>
      </div>

      {/* Right: Threat level + time remaining */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 280, justifyContent: "flex-end" }}>
        {/* Threat Level Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1 }}>THREAT</span>
          <span
            style={{
              padding: "2px 10px",
              borderRadius: 10,
              background: `${threatColor}22`,
              border: `1px solid ${threatColor}66`,
              color: threatColor,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: 1,
            }}
          >
            {threatLevel.toUpperCase()}
          </span>
        </div>

        {/* Time Remaining */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1 }}>REMAINING</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              fontWeight: 600,
              color: timeRemaining < 30 ? "#f85149" : "#e6edf3",
            }}
          >
            {mins}:{secs.toString().padStart(2, "0")}
          </span>
        </div>
      </div>
    </div>
  );
}
