import type { EffectorStatus, ThreatLevel } from "../types";

interface Props {
  elapsed: number;
  timeRemaining: number;
  threatLevel: ThreatLevel;
  scenarioName: string;
  muted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
  alertCount?: number;
  waveNumber?: number;
  onEndMission?: () => void;
  onJamAll?: () => void;
  onClearAirspace?: () => void;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  effectors?: EffectorStatus[];
  ambientSuppressedUntil?: number;
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
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  alertCount = 0,
  waveNumber = 1,
  onEndMission,
  onJamAll,
  onClearAirspace,
  isPaused = false,
  onPause,
  onResume,
  effectors = [],
  ambientSuppressedUntil = 0,
}: Props) {
  const threatColor = THREAT_COLORS[threatLevel];
  const allJammersActive = effectors.filter(
    (e) => e.type === "rf_jam" || e.type === "electronic"
  ).length > 0 && effectors.filter(
    (e) => (e.type === "rf_jam" || e.type === "electronic") && !e.jammer_active
  ).length === 0;
  const airspaceClear = elapsed < ambientSuppressedUntil;
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

      {/* Center: Mission clock + wave */}
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
            padding: "2px 10px",
            borderRadius: 10,
            background: "rgba(88, 166, 255, 0.15)",
            border: "1px solid rgba(88, 166, 255, 0.4)",
            color: "#58a6ff",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 1,
          }}
        >
          WAVE {waveNumber}
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

      {/* Right: Volume + Threat level + time remaining */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 340, justifyContent: "flex-end" }}>
        {/* Volume controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={onToggleMute}
            title={muted ? "Unmute (M)" : "Mute (M)"}
            style={{
              background: "none",
              border: "1px solid #30363d",
              borderRadius: 4,
              color: muted ? "#484f58" : "#8b949e",
              cursor: "pointer",
              padding: "2px 6px",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 24,
            }}
          >
            {muted ? "\u2022\u2022" : "\u266A"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            title={`Volume: ${Math.round(volume * 100)}%`}
            style={{
              width: 56,
              height: 4,
              accentColor: "#58a6ff",
              cursor: "pointer",
              opacity: muted ? 0.3 : 0.7,
            }}
          />
        </div>

        {/* Alert Count Badge */}
        {alertCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#f85149", letterSpacing: 1, fontWeight: 600 }}>ALERTS</span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 10,
                background: "rgba(248, 81, 73, 0.2)",
                border: "1px solid rgba(248, 81, 73, 0.5)",
                color: "#f85149",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                animation: "track-blink 1s ease-in-out infinite",
              }}
            >
              {alertCount}
            </span>
          </div>
        )}

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
          <span style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1 }}>MISSION</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              fontWeight: 600,
              color: "#e6edf3",
            }}
          >
            {mins}:{secs.toString().padStart(2, "0")}
          </span>
        </div>

        {/* JAM ALL button */}
        {onJamAll && (
          <button
            onClick={onJamAll}
            disabled={allJammersActive}
            style={{
              padding: "4px 12px",
              background: allJammersActive
                ? "rgba(210, 153, 34, 0.08)"
                : "rgba(210, 153, 34, 0.15)",
              border: `1px solid rgba(210, 153, 34, ${allJammersActive ? "0.2" : "0.4"})`,
              borderRadius: 4,
              color: allJammersActive ? "#8b7a3a" : "#d29922",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: allJammersActive ? "default" : "pointer",
              transition: "all 0.15s",
              opacity: allJammersActive ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!allJammersActive)
                (e.currentTarget as HTMLElement).style.background = "rgba(210, 153, 34, 0.3)";
            }}
            onMouseLeave={(e) => {
              if (!allJammersActive)
                (e.currentTarget as HTMLElement).style.background = "rgba(210, 153, 34, 0.15)";
            }}
          >
            {allJammersActive ? "JAMMERS ACTIVE" : "JAM ALL"}
          </button>
        )}

        {/* CLEAR AIRSPACE button */}
        {onClearAirspace && (
          <button
            onClick={onClearAirspace}
            disabled={airspaceClear}
            style={{
              padding: "4px 12px",
              background: airspaceClear
                ? "rgba(88, 166, 255, 0.08)"
                : "rgba(88, 166, 255, 0.15)",
              border: `1px solid rgba(88, 166, 255, ${airspaceClear ? "0.2" : "0.4"})`,
              borderRadius: 4,
              color: airspaceClear ? "#3a6a9e" : "#58a6ff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: airspaceClear ? "default" : "pointer",
              transition: "all 0.15s",
              opacity: airspaceClear ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!airspaceClear)
                (e.currentTarget as HTMLElement).style.background = "rgba(88, 166, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              if (!airspaceClear)
                (e.currentTarget as HTMLElement).style.background = "rgba(88, 166, 255, 0.15)";
            }}
          >
            {airspaceClear ? "AIRSPACE CLEAR" : "CLEAR AIRSPACE"}
          </button>
        )}

        {/* PAUSE / RESUME button */}
        {(onPause || onResume) && (
          <button
            onClick={isPaused ? onResume : onPause}
            style={{
              padding: "4px 12px",
              background: isPaused
                ? "rgba(63, 185, 80, 0.15)"
                : "rgba(210, 153, 34, 0.15)",
              border: `1px solid ${isPaused ? "rgba(63, 185, 80, 0.4)" : "rgba(210, 153, 34, 0.4)"}`,
              borderRadius: 4,
              color: isPaused ? "#3fb950" : "#d29922",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = isPaused
                ? "rgba(63, 185, 80, 0.3)"
                : "rgba(210, 153, 34, 0.3)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = isPaused
                ? "rgba(63, 185, 80, 0.15)"
                : "rgba(210, 153, 34, 0.15)";
            }}
          >
            {isPaused ? "\u25B6 RESUME" : "\u23F8 PAUSE"}
          </button>
        )}

        {/* END MISSION button */}
        {onEndMission && (
          <button
            onClick={onEndMission}
            style={{
              padding: "4px 12px",
              background: "rgba(248, 81, 73, 0.15)",
              border: "1px solid rgba(248, 81, 73, 0.4)",
              borderRadius: 4,
              color: "#f85149",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(248, 81, 73, 0.3)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(248, 81, 73, 0.15)";
            }}
          >
            END MISSION
          </button>
        )}
      </div>
    </div>
  );
}
