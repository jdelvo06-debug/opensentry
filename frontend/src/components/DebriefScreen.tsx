import type { DebriefStats } from "../types";

interface Props {
  stats: DebriefStats;
  onMainMenu: () => void;
  onReplay: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function computeRating(stats: DebriefStats): { score: number; grade: string } {
  let score = 0;
  const detectionRate = stats.tracksSpawned > 0 ? stats.tracksDetected / stats.tracksSpawned : 0;
  const neutralizationRate = stats.tracksSpawned > 0 ? stats.tracksDefeated / stats.tracksSpawned : 0;
  if (detectionRate >= 0.8) score += 25;
  if (neutralizationRate >= 0.8) score += 25;
  if (stats.blueOnBlueCount === 0) score += 25;
  if (stats.roeViolations.length === 0) score += 25;
  let grade: string;
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else grade = "F";
  return { score, grade };
}

const GRADE_COLORS: Record<string, string> = {
  A: "#3fb950",
  B: "#58a6ff",
  C: "#d29922",
  D: "#f0883e",
  F: "#f85149",
};

export default function DebriefScreen({ stats, onMainMenu, onReplay }: Props) {
  const detectionRate = stats.tracksSpawned > 0 ? stats.tracksDetected / stats.tracksSpawned : 0;
  const neutralizationRate = stats.tracksSpawned > 0 ? stats.tracksDefeated / stats.tracksSpawned : 0;
  const { score, grade } = computeRating(stats);
  const gradeColor = GRADE_COLORS[grade] || "#8b949e";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: 32,
          maxWidth: 600,
          width: "90%",
          margin: "32px auto",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        }}
      >
        {/* Header */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 24,
            fontSize: 16,
            fontWeight: 700,
            color: "#22d3ee",
            letterSpacing: 2,
          }}
        >
          MISSION DEBRIEF
        </div>

        {/* Mission Summary */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: "1px solid #30363d",
          }}
        >
          <div style={{ fontSize: 14, color: "#e6edf3", fontWeight: 600, marginBottom: 8 }}>
            {stats.scenarioName}
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 12 }}>
            Duration: {formatDuration(stats.durationSeconds)}
          </div>
          <div
            style={{
              display: "inline-block",
              padding: "6px 16px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: stats.success ? "#3fb950" : "#f85149",
              background: stats.success ? "#3fb95015" : "#f8514915",
              border: `1px solid ${stats.success ? "#3fb95044" : "#f8514944"}`,
            }}
          >
            {stats.success ? "MISSION SUCCESS" : "MISSION FAILED"}
          </div>
        </div>

        {/* Performance Metrics */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 10,
              color: "#8b949e",
              letterSpacing: 1.5,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            PERFORMANCE METRICS
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 24px",
            }}
          >
            <MetricRow label="Tracks Detected" value={stats.tracksDetected} />
            <MetricRow label="Tracks Confirmed" value={stats.tracksConfirmed} />
            <MetricRow label="Tracks Identified" value={stats.tracksIdentified} />
            <MetricRow label="Tracks Defeated" value={stats.tracksDefeated} />
            <MetricRow label="Detection Rate" value={`${(detectionRate * 100).toFixed(0)}%`} />
            <MetricRow label="Neutralization Rate" value={`${(neutralizationRate * 100).toFixed(0)}%`} />
            <MetricRow
              label="Blue-on-Blue Incidents"
              value={stats.blueOnBlueCount}
              highlight={stats.blueOnBlueCount > 0 ? "#f85149" : undefined}
            />
            <MetricRow label="ATC Calls Made" value={stats.atcCallsMade} />
          </div>
        </div>

        {/* ROE Violations */}
        {stats.roeViolations.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 10,
                color: "#f85149",
                letterSpacing: 1.5,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              ROE VIOLATIONS
            </div>
            {stats.roeViolations.map((v, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  color: "#f85149",
                  padding: "4px 0",
                  borderBottom: i < stats.roeViolations.length - 1 ? "1px solid #30363d" : undefined,
                }}
              >
                {v}
              </div>
            ))}
          </div>
        )}

        {/* ATC Call Log */}
        {stats.atcCallLog.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 10,
                color: "#8b949e",
                letterSpacing: 1.5,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              ATC CALL LOG
            </div>
            {stats.atcCallLog.map((entry, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  padding: "4px 0",
                  borderBottom: i < stats.atcCallLog.length - 1 ? "1px solid #30363d" : undefined,
                }}
              >
                <span style={{ color: "#22d3ee" }}>{entry.trackId}</span>
                <span style={{ color: "#8b949e" }}> — {entry.response}</span>
              </div>
            ))}
          </div>
        )}

        {/* Performance Rating */}
        <div
          style={{
            textAlign: "center",
            paddingTop: 20,
            borderTop: "1px solid #30363d",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#8b949e",
              letterSpacing: 1.5,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            PERFORMANCE RATING
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: gradeColor,
              lineHeight: 1,
            }}
          >
            {grade}
          </div>
          <div
            style={{
              fontSize: 18,
              color: gradeColor,
              marginTop: 4,
              fontWeight: 600,
            }}
          >
            {score} / 100
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onMainMenu}
            style={{
              flex: 1,
              padding: 14,
              background: "transparent",
              border: "1px solid #22d3ee",
              borderRadius: 6,
              color: "#22d3ee",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#22d3ee18";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            RETURN TO MAIN MENU
          </button>
          {!stats.isTutorial && (
            <button
              onClick={onReplay}
              style={{
                flex: 1,
                padding: 14,
                background: "transparent",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#8b949e",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#8b949e";
                (e.currentTarget as HTMLElement).style.color = "#e6edf3";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#30363d";
                (e.currentTarget as HTMLElement).style.color = "#8b949e";
              }}
            >
              REPLAY SCENARIO
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ fontSize: 11, color: "#8b949e" }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: highlight || "#e6edf3",
        }}
      >
        {value}
      </span>
    </div>
  );
}
