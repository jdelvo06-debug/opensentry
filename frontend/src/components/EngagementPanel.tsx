import type { EffectorStatus, TrackData } from "../types";

interface Props {
  track: TrackData | null;
  effectors: EffectorStatus[];
  onConfirmTrack: (trackId: string) => void;
  onIdentify: (trackId: string, classification: string, affiliation: string) => void;
  onEngage: (trackId: string, effectorId: string) => void;
  onSlewCamera?: (trackId: string) => void;
}

const CLASSIFICATIONS = [
  { value: "commercial_quad", label: "COMMERCIAL QUAD", affiliation: "hostile" },
  { value: "fixed_wing", label: "FIXED-WING UAS", affiliation: "hostile" },
  { value: "micro", label: "MICRO UAS", affiliation: "hostile" },
  { value: "improvised", label: "IMPROVISED UAS", affiliation: "hostile" },
  { value: "passenger_aircraft", label: "PASSENGER AIRCRAFT (FRIENDLY)", affiliation: "friendly" },
  { value: "fixed_wing", label: "MILITARY JET (FRIENDLY)", affiliation: "friendly" },
  { value: "bird", label: "BIRD (FALSE ALARM)", affiliation: "neutral" },
  { value: "weather_balloon", label: "WEATHER BALLOON (FALSE ALARM)", affiliation: "neutral" },
];

const EFFECTOR_COLORS: Record<string, string> = {
  jammer: "#58a6ff",
  rf_jam: "#58a6ff",
  electronic: "#58a6ff",
  kinetic: "#f85149",
  interceptor: "#3fb950",
  net_interceptor: "#3fb950",
  de_weapon: "#bc8cff",
  directed_energy: "#bc8cff",
};


export default function EngagementPanel({
  track,
  effectors,
  onConfirmTrack,
  onIdentify,
  onEngage,
  onSlewCamera,
}: Props) {
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
          minHeight: 120,
        }}
      >
        SELECT A TRACK
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 14px", minHeight: 120 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: 1.5,
          marginBottom: 10,
        }}
      >
        ENGAGEMENT
      </div>

      {track.dtid_phase === "detected" && (
        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
            Confirm track for continuous monitoring
          </div>
          <button
            onClick={() => onConfirmTrack(track.id)}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: "#58a6ff18",
              border: "1px solid #58a6ff55",
              borderRadius: 6,
              color: "#58a6ff",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
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
            CONFIRM TRACK
          </button>
          <button
            onClick={() => onSlewCamera(track.id)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "8px 16px",
              background: "#d2992218",
              border: "1px solid #d2992255",
              borderRadius: 6,
              color: "#d29922",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#d2992230";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#d2992218";
            }}
          >
            SLEW CAMERA
          </button>
        </div>
      )}

      {track.dtid_phase === "tracked" && (
        <div>
          {/* SLEW CAMERA button — always visible */}
          {onSlewCamera && (
            <button
              onClick={() => onSlewCamera(track.id)}
              style={{
                width: "100%",
                padding: "9px 12px",
                marginBottom: 8,
                background: "#d2992218",
                border: "1px solid #d2992244",
                borderRadius: 5,
                color: "#d29922",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#d2992230";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#d2992218";
              }}
            >
              SLEW CAMERA
            </button>
          )}

          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
            Classify the contact
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {CLASSIFICATIONS.map((cls, idx) => {
              const clsColor = cls.affiliation === "hostile" ? "#f85149"
                : cls.affiliation === "friendly" ? "#58a6ff" : "#3fb950";
              return (
                <button
                  key={`${cls.value}-${cls.affiliation}-${idx}`}
                  onClick={() => onIdentify(track.id, cls.value, cls.affiliation)}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    background: `${clsColor}11`,
                    border: `1px solid ${clsColor}33`,
                    borderRadius: 4,
                    color: clsColor,
                    fontSize: 10,
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    letterSpacing: 0.5,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${clsColor}25`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${clsColor}11`;
                  }}
                >
                  {cls.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {track.dtid_phase === "identified" && (
        <div>
          {/* SLEW CAMERA in identified phase too — always visible */}
          {onSlewCamera && (
            <button
              onClick={() => onSlewCamera(track.id)}
              style={{
                width: "100%",
                padding: "9px 12px",
                marginBottom: 8,
                background: "#d2992218",
                border: "1px solid #d2992244",
                borderRadius: 5,
                color: "#d29922",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#d2992230";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#d2992218";
              }}
            >
              SLEW CAMERA
            </button>
          )}
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
            Select effector to engage
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {effectors.map((eff) => {
              const color =
                EFFECTOR_COLORS[eff.id] ||
                EFFECTOR_COLORS[eff.type || ""] ||
                "#58a6ff";
              const name = eff.name || eff.id.toUpperCase();
              const isDepleted = eff.ammo_remaining != null && eff.ammo_remaining <= 0;
              const isReady = eff.status === "ready" && !isDepleted;

              return (
                <button
                  key={eff.id}
                  onClick={() => isReady && onEngage(track.id, eff.id)}
                  disabled={!isReady}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: isReady ? `${color}15` : "#161b22",
                    border: `1px solid ${isReady ? `${color}44` : "#30363d"}`,
                    borderRadius: 5,
                    color: isReady ? color : "#484f58",
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: "'Inter', sans-serif",
                    letterSpacing: 0.5,
                    cursor: isReady ? "pointer" : "not-allowed",
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    transition: "all 0.15s",
                    opacity: isReady ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (isReady)
                      (e.currentTarget as HTMLElement).style.background = `${color}28`;
                  }}
                  onMouseLeave={(e) => {
                    if (isReady)
                      (e.currentTarget as HTMLElement).style.background = `${color}15`;
                  }}
                >
                  <span>{name}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 500,
                      opacity: 0.7,
                    }}
                  >
                    {isDepleted
                      ? "DEPLETED"
                      : eff.ammo_remaining != null
                        ? `${eff.ammo_remaining}/${eff.ammo_count} — ${eff.status.toUpperCase()}`
                        : eff.status.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {track.dtid_phase === "defeated" && (
        <div
          style={{
            textAlign: "center",
            padding: "16px 0",
          }}
        >
          {track.jammed && !track.neutralized ? (
            <>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#d29922",
                  letterSpacing: 1,
                  marginBottom: 4,
                  animation: "track-blink 1.5s ease-in-out infinite",
                }}
              >
                JAMMED
              </div>
              <div style={{ fontSize: 11, color: "#d29922", opacity: 0.8 }}>
                {track.jammed_behavior?.replace(/_/g, " ").toUpperCase() || "EW EFFECT ACTIVE"}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: track.neutralized ? "#3fb950" : "#f85149",
                  letterSpacing: 1,
                  marginBottom: 4,
                }}
              >
                {track.neutralized ? "NEUTRALIZED" : "MISSED"}
              </div>
              <div style={{ fontSize: 11, color: "#8b949e" }}>
                {track.neutralized
                  ? "Target has been neutralized"
                  : "Engagement was not effective"}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
