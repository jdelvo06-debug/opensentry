import { useEffect, useRef } from "react";
import type { EventEntry, TrackData } from "../types";

interface Props {
  events: EventEntry[];
  hookedTracks?: TrackData[];
  onUnhook?: (id: string) => void;
}

function getEventColor(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("engag") || lower.includes("neutraliz") || lower.includes("defeat") || lower.includes("missed") || lower.includes("effective")) return "#f85149";
  if (lower.includes("warning") || lower.includes("caution") || lower.includes("unknown") || lower.includes("lost")) return "#d29922";
  if (lower.includes("detect") || lower.includes("track") || lower.includes("sensor") || lower.includes("identif")) return "#58a6ff";
  return "#8b949e";
}

const AFF_COLOR: Record<string, string> = {
  hostile: "#f85149",
  unknown: "#d29922",
  neutral: "#3fb950",
  friendly: "#58a6ff",
};

function HookCard({ track, onUnhook }: { track: TrackData; onUnhook: () => void }) {
  const color = AFF_COLOR[track.affiliation] ?? "#8b949e";
  return (
    <div style={{
      width: 168,
      flexShrink: 0,
      height: "100%",
      borderRight: "1px solid #21262d",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'JetBrains Mono', monospace",
      padding: "6px 8px 4px",
      gap: 3,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
        <span style={{
          fontSize: 8,
          fontWeight: 700,
          color: "#0c1015",
          background: color,
          padding: "1px 5px",
          borderRadius: 2,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          flexShrink: 0,
        }}>
          {track.affiliation.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {track.display_label || track.id}
        </span>
        <span
          onClick={onUnhook}
          title="Unhook"
          style={{ fontSize: 9, color: "#484f58", cursor: "pointer", padding: "1px 4px", border: "1px solid #30363d", borderRadius: 2, flexShrink: 0, lineHeight: 1.4 }}
        >
          ×
        </span>
      </div>

      {/* Data grid — 2 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 6px", flex: 1 }}>
        <Field label="SPD" value={track.speed_kts != null ? `${Math.round(track.speed_kts)}kt` : "---"} />
        <Field label="ALT" value={track.altitude_ft != null ? `${Math.round(track.altitude_ft)}ft` : "---"} />
        <Field label="HDG" value={track.heading_deg != null ? `${Math.round(track.heading_deg)}°` : "---"} />
        <Field label="ETA" value={track.eta_protected != null ? `${Math.round(track.eta_protected)}s` : "---"} color={
          track.eta_protected != null && track.eta_protected < 45 ? "#f85149" :
          track.eta_protected != null && track.eta_protected < 120 ? "#d29922" : undefined
        } />
        <Field label="RNG" value={track.x != null && track.y != null ? `${Math.sqrt(track.x * track.x + track.y * track.y).toFixed(1)}km` : "---"} />
        <Field label="DTID" value={track.dtid_phase ?? "---"} color={color} />
        <Field label="TYPE" value={track.drone_type ?? "---"} />
        <Field label="RF" value={track.frequency_band ?? "---"} />
      </div>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <span style={{ fontSize: 8, color: "#484f58", textTransform: "uppercase", letterSpacing: 0.5, lineHeight: 1.2 }}>{label}</span>
      <span style={{ fontSize: 10, color: color ?? "#e6edf3", fontWeight: 600, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

export default function EventLog({ events, hookedTracks = [], onUnhook }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div style={{
      gridColumn: "1 / -1",
      height: 120,
      background: "#0c1015",
      borderTop: "1px solid #30363d",
      display: "flex",
      flexDirection: "row",
      overflow: "hidden",
    }}>
      {/* Left: Event Log — slim strip */}
      <div style={{
        width: 280,
        flexShrink: 0,
        borderRight: "1px solid #21262d",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "5px 10px", borderBottom: "1px solid #1c2333", flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "#8b949e", letterSpacing: 1.5 }}>EVENT LOG</span>
          <span style={{ marginLeft: 6, fontSize: 8, color: "#484f58", fontFamily: "'JetBrains Mono', monospace" }}>{events.length}</span>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "3px 10px" }}>
          {events.length === 0 && (
            <div style={{ color: "#484f58", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "3px 0" }}>Awaiting events...</div>
          )}
          {events.map((evt, i) => {
            const color = getEventColor(evt.message);
            return (
              <div key={i} style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ color: "#484f58" }}>[T+{evt.timestamp.toFixed(1)}s]</span>{" "}{evt.message}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Hook Bubble row — scrollable cards */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "5px 10px", borderBottom: "1px solid #1c2333", flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "#8b949e", letterSpacing: 1.5 }}>HOOK PANEL</span>
          {hookedTracks.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: 8, color: "#484f58", fontFamily: "'JetBrains Mono', monospace" }}>{hookedTracks.length} hooked</span>
          )}
          <span style={{ marginLeft: 8, fontSize: 8, color: "#30363d", fontFamily: "'JetBrains Mono', monospace" }}>click track to hook</span>
        </div>

        {/* Cards row */}
        <div ref={cardsScrollRef} style={{ flex: 1, display: "flex", flexDirection: "row", overflowX: "auto", overflowY: "hidden" }}>
          {hookedTracks.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#30363d", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>NO TRACKS HOOKED — click a bogey on the map</span>
            </div>
          ) : (
            hookedTracks.map((t) => (
              <HookCard key={t.id} track={t} onUnhook={() => onUnhook?.(t.id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
