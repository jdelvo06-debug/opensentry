import type { ScoreBreakdown } from "../types";

interface Props {
  score: ScoreBreakdown;
  droneReachedBase: boolean;
  scenarioName: string;
  onRestart: () => void;
}

const GRADE_COLORS: Record<string, string> = {
  S: "#d29922",
  A: "#3fb950",
  B: "#58a6ff",
  C: "#d29922",
  F: "#f85149",
};

interface BarProps {
  label: string;
  score: number;
  detail: string;
}

function ScoreBar({ label, score, detail }: BarProps) {
  const color =
    score >= 80 ? "#3fb950" : score >= 50 ? "#d29922" : "#f85149";

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          fontSize: 12,
        }}
      >
        <span style={{ color: "#e6edf3", letterSpacing: 0.5, fontWeight: 500 }}>
          {label}
        </span>
        <span
          style={{
            color,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {score.toFixed(0)}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "#1c2333",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(score, 100)}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            boxShadow: `0 0 8px ${color}44`,
            transition: "width 1s ease-out",
          }}
        />
      </div>
      {detail && (
        <div
          style={{
            fontSize: 10,
            color: "#8b949e",
            marginTop: 3,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

export default function DebriefScreen({
  score,
  droneReachedBase,
  scenarioName,
  onRestart,
}: Props) {
  const gradeColor = GRADE_COLORS[score.grade] || "#8b949e";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13, 17, 23, 0.94)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: 32,
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              fontSize: 10,
              color: "#8b949e",
              letterSpacing: 2,
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            MISSION DEBRIEF
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#e6edf3",
              marginBottom: 16,
              fontWeight: 500,
            }}
          >
            {scenarioName}
          </div>

          {droneReachedBase && (
            <div
              style={{
                color: "#f85149",
                fontSize: 12,
                fontWeight: 700,
                padding: "8px 16px",
                border: "1px solid #f8514944",
                borderRadius: 6,
                background: "#f8514911",
                marginBottom: 16,
                letterSpacing: 1,
              }}
            >
              BASE COMPROMISED
            </div>
          )}

          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: gradeColor,
              lineHeight: 1,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {score.grade}
          </div>
          <div
            style={{
              fontSize: 22,
              color: gradeColor,
              marginTop: 4,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
            }}
          >
            {score.total_score.toFixed(0)} / 100
          </div>
        </div>

        <ScoreBar
          label="DETECTION RESPONSE (20%)"
          score={score.detection_response_score}
          detail={score.details.detection_response || ""}
        />
        <ScoreBar
          label="TRACKING (15%)"
          score={score.tracking_score}
          detail={score.details.tracking || ""}
        />
        <ScoreBar
          label="IDENTIFICATION (25%)"
          score={score.identification_score}
          detail={score.details.identification || ""}
        />
        <ScoreBar
          label="DEFEAT METHOD (25%)"
          score={score.defeat_score}
          detail={score.details.defeat || ""}
        />
        <ScoreBar
          label="ROE COMPLIANCE (15%)"
          score={score.roe_score}
          detail={score.details.roe || ""}
        />

        <button
          onClick={onRestart}
          style={{
            width: "100%",
            marginTop: 20,
            padding: 14,
            background: "#58a6ff18",
            border: "1px solid #58a6ff55",
            borderRadius: 6,
            color: "#58a6ff",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#58a6ff30";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#58a6ff18";
          }}
        >
          RESTART MISSION
        </button>
      </div>
    </div>
  );
}
