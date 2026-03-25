import { useState } from "react";
import type { EffectorStatus, TrackData } from "../types";

interface AtcMessage {
  direction: "out" | "in";
  text: string;
}

interface Props {
  track: TrackData | null;
  effectors: EffectorStatus[];
  onConfirmTrack: (trackId: string) => void;
  onIdentify: (trackId: string, classification: string, affiliation: string) => void;
  onEngage: (trackId: string, effectorId: string, nexusCm?: string) => void;
  onSlewCamera?: (trackId: string) => void;
  onCallATC?: (trackId: string) => void;
  atcMessages?: AtcMessage[];
  tutorialStep?: number;
}

const CLASSIFICATIONS = [
  { value: "commercial_quad", label: "COMMERCIAL QUAD", affiliation: "hostile" },
  { value: "fixed_wing", label: "FIXED-WING UAS", affiliation: "hostile" },
  { value: "micro", label: "MICRO UAS", affiliation: "hostile" },
  { value: "improvised", label: "IMPROVISED UAS", affiliation: "hostile" },
  { value: "shahed", label: "SHAHED-136 (AUTONOMOUS)", affiliation: "hostile" },
  { value: "passenger_aircraft", label: "PASSENGER AIRCRAFT (FRIENDLY)", affiliation: "friendly" },
  { value: "military_jet", label: "MILITARY JET (FRIENDLY)", affiliation: "friendly" },
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
  nexus_pm: "#a371f7",
};

const NEXUS_CM_OPTIONS = [
  { id: "nexus_hold", label: "HOLD", desc: "Freeze in place", color: "#a371f7" },
  { id: "nexus_land_now", label: "LAND NOW", desc: "Forced descent", color: "#f0883e" },
  { id: "nexus_deafen", label: "DEAFEN", desc: "Sever control link", color: "#f85149" },
];

const CM_STATE_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "ACQUIRING...", color: "#d29922" },
  "1/2": { label: "DOWNLINK 1/2", color: "#f0883e" },
  "2/2": { label: "FULL CONTROL 2/2", color: "#3fb950" },
};


export default function EngagementPanel({
  track,
  effectors,
  onConfirmTrack,
  onIdentify,
  onEngage,
  onSlewCamera,
  onCallATC,
  atcMessages = [],
  tutorialStep,
}: Props) {
  const [nexusSubMenu, setNexusSubMenu] = useState<string | null>(null);

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
            className={tutorialStep === 2 ? "tutorial-pulse" : undefined}
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
            className={tutorialStep === 3 ? "tutorial-pulse" : undefined}
            onClick={() => onSlewCamera?.(track.id)}
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
          {/* CALL ATC button — only for UNKNOWN IFF tracks */}
          {(track.iff_status === "unknown" || track.affiliation?.toLowerCase() === "unknown") && onCallATC && (
            <button
              onClick={() => !track.atc_called && onCallATC(track.id)}
              disabled={!!track.atc_called}
              style={{
                width: "100%",
                marginTop: 6,
                padding: "8px 16px",
                background: track.atc_called ? "#1a2a2a" : "rgba(34, 211, 238, 0.12)",
                border: `1px solid ${track.atc_called ? "#30363d" : "#22d3ee55"}`,
                borderRadius: 6,
                color: track.atc_called ? "#484f58" : "#22d3ee",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: 1,
                cursor: track.atc_called ? "default" : "pointer",
                transition: "all 0.15s",
              }}
            >
              {track.atc_response_pending ? "ATC PENDING..." : track.atc_called ? "ATC CALLED" : "📞 CALL ATC"}
            </button>
          )}
          {/* ATC comms log — inline, shows after call is made */}
          {atcMessages.length > 0 && (
            <div style={{
              marginTop: 6,
              background: "#0a1a1a",
              border: "1px solid #22d3ee33",
              borderRadius: 5,
              padding: "6px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}>
              <div style={{ fontSize: 8, fontWeight: 600, color: "#22d3ee99", letterSpacing: 1.5, marginBottom: 2 }}>ATC COMMS</div>
              {atcMessages.map((msg, i) => (
                <div key={i} style={{
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: msg.direction === "in" ? "#22d3ee" : "#8b949e",
                  textAlign: msg.direction === "in" ? "left" : "right",
                  lineHeight: 1.4,
                }}>
                  <span style={{ color: msg.direction === "in" ? "#22d3ee66" : "#484f58", marginRight: 4 }}>
                    {msg.direction === "in" ? "ATC›" : "OPS›"}
                  </span>
                  {msg.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {track.dtid_phase === "tracked" && (
        <div>
          {/* SLEW CAMERA button — always visible */}
          {onSlewCamera && (
            <button
              className={tutorialStep === 3 ? "tutorial-pulse" : undefined}
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
                  className={tutorialStep === 4 ? "tutorial-pulse" : undefined}
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

          {/* NEXUS CM submenu — selecting countermeasure type */}
          {nexusSubMenu && (() => {
            const nexusEff = effectors.find((e) => e.id === nexusSubMenu);
            const nexusName = nexusEff?.name || "NEXUS";
            return (
              <div>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 11, color: "#a371f7", fontWeight: 600, letterSpacing: 0.5 }}>
                    {nexusName} — SELECT CM
                  </div>
                  <button
                    onClick={() => setNexusSubMenu(null)}
                    style={{
                      background: "none", border: "1px solid #30363d", borderRadius: 4,
                      color: "#8b949e", fontSize: 9, padding: "2px 8px", cursor: "pointer",
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    BACK
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {NEXUS_CM_OPTIONS.map((cm) => (
                    <button
                      key={cm.id}
                      onClick={() => {
                        onEngage(track.id, nexusSubMenu, cm.id);
                        setNexusSubMenu(null);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: `${cm.color}12`,
                        border: `1px solid ${cm.color}44`,
                        borderRadius: 5,
                        color: cm.color,
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: 1,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = `${cm.color}28`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = `${cm.color}12`;
                      }}
                    >
                      <span>{cm.label}</span>
                      <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7, fontFamily: "'Inter', sans-serif" }}>
                        {cm.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Main effector list (hidden when NEXUS submenu is open) */}
          {!nexusSubMenu && (
            <>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
                Select effector to engage
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {effectors.map((eff) => {
                  const isNexus = eff.type === "nexus_pm";
                  const color =
                    EFFECTOR_COLORS[eff.type || ""] ||
                    EFFECTOR_COLORS[eff.id] ||
                    "#58a6ff";
                  const name = eff.name || eff.id.toUpperCase();
                  const isDepleted = eff.ammo_remaining != null && eff.ammo_remaining <= 0;
                  const isReady = eff.status === "ready" && !isDepleted;

                  return (
                    <button
                      className={tutorialStep === 5 && isReady ? "tutorial-pulse" : undefined}
                      key={eff.id}
                      onClick={() => {
                        if (!isReady) return;
                        if (isNexus) {
                          setNexusSubMenu(eff.id);
                        } else {
                          onEngage(track.id, eff.id);
                        }
                      }}
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
                      <span>
                        {name}
                        {isNexus && isReady && (
                          <span style={{ fontSize: 9, marginLeft: 6, opacity: 0.7 }}>▸ CM</span>
                        )}
                      </span>
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
            </>
          )}
        </div>
      )}

      {track.dtid_phase === "defeated" && (
        <div
          style={{
            textAlign: "center",
            padding: "16px 0",
          }}
        >
          {/* NEXUS Protocol Manipulation active */}
          {track.nexus_cm_active && !track.neutralized ? (() => {
            const cmLabel = track.nexus_cm_active.replace("nexus_", "").replace("_", " ").toUpperCase();
            const stateInfo = CM_STATE_LABELS[track.nexus_cm_state || "pending"] || CM_STATE_LABELS.pending;
            return (
              <>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#a371f7",
                    letterSpacing: 1.5,
                    marginBottom: 6,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  NEXUS PROTOCOL MANIPULATION
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#a371f7",
                    letterSpacing: 1,
                    marginBottom: 8,
                  }}
                >
                  {cmLabel}
                </div>

                {/* CM state progress bar */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 6, marginBottom: 10,
                }}>
                  <div style={{
                    width: 100, height: 4, background: "#30363d", borderRadius: 2,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: track.nexus_cm_state === "2/2" ? "100%"
                        : track.nexus_cm_state === "1/2" ? "50%" : "15%",
                      height: "100%",
                      background: stateInfo.color,
                      borderRadius: 2,
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: stateInfo.color,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5,
                    animation: track.nexus_cm_state !== "2/2" ? "track-blink 1.5s ease-in-out infinite" : undefined,
                  }}>
                    {stateInfo.label}
                  </span>
                </div>

                {/* Frequency band info */}
                {track.frequency_band && (
                  <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>
                    RF: <span style={{ color: "#a371f7", fontWeight: 600 }}>{track.frequency_band}</span>
                    {track.downlink_detected && (
                      <span style={{ color: "#3fb950", marginLeft: 8 }}>DL</span>
                    )}
                    {track.uplink_detected && (
                      <span style={{ color: "#3fb950", marginLeft: 4 }}>UL</span>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 10, color: "#8b949e", marginTop: 4 }}>
                  {track.nexus_cm_state === "2/2"
                    ? "Full protocol control established"
                    : track.nexus_cm_state === "1/2"
                      ? "Partial effect — acquiring uplink..."
                      : "Initiating protocol manipulation..."}
                </div>
              </>
            );
          })() : track.jammed && !track.neutralized ? (
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
          ) : track.pnt_jammed && !track.neutralized ? (
            <>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#e3b341",
                  letterSpacing: 1,
                  marginBottom: 4,
                  animation: "track-blink 2s ease-in-out infinite",
                }}
              >
                PNT DEGRADED
              </div>
              <div style={{ fontSize: 11, color: "#e3b341", opacity: 0.8 }}>
                NAVIGATION ACCURACY REDUCED
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
