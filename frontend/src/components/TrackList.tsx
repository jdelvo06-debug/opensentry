import type { TrackData } from "../types";

interface Props {
  tracks: TrackData[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
}

const AFFILIATION_COLORS: Record<string, string> = {
  hostile: "#f85149",
  friendly: "#58a6ff",
  unknown: "#d29922",
  neutral: "#3fb950",
};

const PHASE_BADGE: Record<string, { label: string; color: string }> = {
  detected: { label: "D", color: "#d29922" },
  tracked: { label: "T", color: "#58a6ff" },
  identified: { label: "I", color: "#3fb950" },
  defeated: { label: "X", color: "#f85149" },
};

export default function TrackList({ tracks, selectedTrackId, onSelectTrack }: Props) {
  return (
    <div
      style={{
        padding: "12px 12px 8px",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: 1.5,
          marginBottom: 10,
        }}
      >
        TRACKS
      </div>
      {tracks.length === 0 ? (
        <div
          style={{
            fontSize: 10,
            color: "#484f58",
            letterSpacing: 1,
            padding: "4px 4px",
          }}
        >
          NO CONTACTS
        </div>
      ) : (
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {tracks.map((track) => {
            const affColor = AFFILIATION_COLORS[track.affiliation] || "#484f58";
            const badge = PHASE_BADGE[track.dtid_phase] || PHASE_BADGE.detected;
            const selected = track.id === selectedTrackId;

            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 28,
                  padding: "0 4px",
                  borderRadius: 4,
                  marginBottom: 1,
                  cursor: "pointer",
                  background: selected ? "#1f2937" : "transparent",
                }}
              >
                {/* Affiliation dot */}
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: affColor,
                    boxShadow: `0 0 4px ${affColor}66`,
                    flexShrink: 0,
                  }}
                />
                {/* Track ID */}
                <div
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 500,
                    color: "#e6edf3",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {track.display_label || track.id}
                </div>
                {/* DTID phase badge */}
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: badge.color,
                    background: `${badge.color}18`,
                    borderRadius: 3,
                    padding: "1px 4px",
                    letterSpacing: 0.5,
                    flexShrink: 0,
                  }}
                >
                  {badge.label}
                </div>
                {/* Speed / Alt */}
                <div
                  style={{
                    fontSize: 9,
                    color: "#484f58",
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {Math.round(track.speed_kts)}kt {Math.round(track.altitude_ft)}ft
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
