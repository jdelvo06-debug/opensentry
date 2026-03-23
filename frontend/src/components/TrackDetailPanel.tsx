import type { DTIDPhase, TrackData } from "../types";

interface Props {
  track: TrackData | null;
}

const DTID_PHASES: DTIDPhase[] = ["detected", "tracked", "identified", "defeated"];
const DTID_LABELS: Record<DTIDPhase, string> = {
  detected: "DETECT",
  tracked: "TRACK",
  identified: "IDENTIFY",
  defeated: "DEFEAT",
};

const AFFILIATION_COLORS: Record<string, string> = {
  unknown: "#d29922",
  hostile: "#f85149",
  friendly: "#58a6ff",
  neutral: "#3fb950",
};

function phaseIndex(phase: DTIDPhase): number {
  return DTID_PHASES.indexOf(phase);
}

export default function TrackDetailPanel({ track }: Props) {
  if (!track) {
    return (
      <div
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#484f58",
          fontSize: 12,
          letterSpacing: 1,
          flex: 1,
          borderBottom: "1px solid #30363d",
        }}
      >
        NO TRACK SELECTED
      </div>
    );
  }

  const range = Math.sqrt(track.x ** 2 + track.y ** 2);
  const bearing = ((Math.atan2(track.x, track.y) * 180) / Math.PI + 360) % 360;
  const currentPhaseIdx = phaseIndex(track.dtid_phase);
  const isIdentified = track.dtid_phase === "identified" || track.dtid_phase === "defeated";
  const affColor = AFFILIATION_COLORS[track.affiliation] || "#8b949e";

  const confidenceColor =
    track.confidence >= 0.7
      ? "#3fb950"
      : track.confidence >= 0.4
        ? "#d29922"
        : "#f85149";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid #30363d",
        overflow: "auto",
        flex: 1,
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: 1.5,
          marginBottom: 8,
        }}
      >
        TRACK DETAIL
      </div>

      {/* Track ID */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "#e6edf3",
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: 10,
        }}
      >
        {(track.display_label || track.id).toUpperCase()}
      </div>

      {/* DTID Phase Stepper */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 14,
        }}
      >
        {DTID_PHASES.map((phase, idx) => {
          const isCompleted = idx < currentPhaseIdx;
          const isCurrent = idx === currentPhaseIdx;
          const bg = isCompleted
            ? "#58a6ff"
            : isCurrent
              ? "#58a6ff"
              : "#1c2333";
          const textColor = isCompleted || isCurrent ? "#fff" : "#484f58";

          return (
            <div
              key={phase}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "4px 0",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: 0.5,
                color: textColor,
                background: bg,
                borderRadius: 3,
                opacity: isCompleted ? 0.6 : 1,
              }}
            >
              {DTID_LABELS[phase]}
            </div>
          );
        })}
      </div>

      {/* Affiliation badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 3,
            background: `${affColor}22`,
            border: `1px solid ${affColor}55`,
            color: affColor,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          {track.affiliation.toUpperCase()}
        </span>
        {track.classification && (
          <span
            style={{
              fontSize: 10,
              color: "#e6edf3",
              fontWeight: 500,
            }}
          >
            {track.classification.replace(/_/g, " ").toUpperCase()}
          </span>
        )}
      </div>

      {/* Jammed indicator */}
      {track.jammed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
            padding: "4px 8px",
            background: "rgba(210, 153, 34, 0.15)",
            border: "1px solid rgba(210, 153, 34, 0.4)",
            borderRadius: 4,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "#d29922", letterSpacing: 1 }}>
            JAMMED
          </span>
          {track.jammed_behavior && (
            <span style={{ fontSize: 9, color: "#d29922", opacity: 0.8 }}>
              {track.jammed_behavior.replace(/_/g, " ").toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* Ambient indicator */}
      {track.is_ambient && (
        <div
          style={{
            marginBottom: 8,
            padding: "2px 8px",
            background: "rgba(139, 148, 158, 0.1)",
            border: "1px solid rgba(139, 148, 158, 0.3)",
            borderRadius: 3,
            fontSize: 9,
            color: "#8b949e",
            letterSpacing: 1,
            fontWeight: 600,
          }}
        >
          AMBIENT TRAFFIC
        </div>
      )}

      {/* Data grid */}
      <div style={{ marginTop: 10 }}>
        <DataRow
          label="TYPE"
          value={
            isIdentified && track.classification
              ? track.classification.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              : "\u2014"
          }
        />
        <DataRow
          label="AFFILIATION"
          value={isIdentified ? track.affiliation.toUpperCase() : "\u2014"}
          valueColor={isIdentified ? affColor : undefined}
        />
        <DataRow label="RANGE" value={`${range.toFixed(2)} km`} />
        <DataRow label="BEARING" value={`${bearing.toFixed(0)}\u00B0`} />
        <DataRow label="ALTITUDE" value={`${track.altitude_ft.toFixed(0)} ft`} />
        <DataRow label="SPEED" value={`${track.speed_kts.toFixed(0)} kts`} />
        <DataRow label="HEADING" value={`${track.heading_deg.toFixed(0)}\u00B0`} />
        <DataRow
          label="CONFIDENCE"
          value={`${Math.round(track.confidence * 100)}%`}
          valueColor={confidenceColor}
        />
      </div>

      {/* Sensors detecting */}
      {track.sensors_detecting && track.sensors_detecting.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 9,
              color: "#8b949e",
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            SENSORS DETECTING
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {track.sensors_detecting.map((s) => (
              <span
                key={s}
                style={{
                  fontSize: 9,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: "#1c2333",
                  color: "#58a6ff",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {s.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DataRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "3px 0",
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "#8b949e",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 500,
          color: valueColor || "#e6edf3",
        }}
      >
        {value}
      </span>
    </div>
  );
}
