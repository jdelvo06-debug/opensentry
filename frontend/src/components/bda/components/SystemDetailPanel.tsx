import type { PlacedSystem } from "../types";
import {
  COLORS,
  ALTITUDE_BANDS,
  getAltitudeBand,
  getAltitudeBandLabel,
} from "../constants";

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 2,
        color: COLORS.accent,
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {title}
    </div>
  );
}

function isNarrowFov(fovDeg: number): boolean {
  return fovDeg < 360;
}

interface Props {
  systems: PlacedSystem[];
  selectedSystem: PlacedSystem | null;
  onSelectSystem: (uid: string | null) => void;
  onAltitudeChange: (uid: string, alt: number) => void;
  onRotate: (uid: string, deltaDeg: number) => void;
  onToggleVisibility: (uid: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onDelete: (uid: string) => void;
  onRecalculate: (uid: string) => void;
}

export default function SystemDetailPanel({
  systems,
  selectedSystem,
  onSelectSystem,
  onAltitudeChange,
  onRotate,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  onDelete,
  onRecalculate,
}: Props) {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: `1px solid ${COLORS.border}`,
        background: COLORS.card,
        overflowY: "auto",
      }}
    >
      {/* System list with visibility toggles */}
      <div style={{ padding: "14px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <SectionHeader title="PLACED SYSTEMS" />
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={onShowAll}
              style={{
                padding: "3px 6px",
                fontSize: 9,
                fontWeight: 600,
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 3,
                color: COLORS.muted,
                cursor: "pointer",
              }}
            >
              SHOW ALL
            </button>
            <button
              onClick={onHideAll}
              style={{
                padding: "3px 6px",
                fontSize: 9,
                fontWeight: 600,
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 3,
                color: COLORS.muted,
                cursor: "pointer",
              }}
            >
              HIDE ALL
            </button>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {systems.length === 0 ? (
            <div
              style={{
                fontSize: 10,
                color: COLORS.muted,
                textAlign: "center",
                padding: 12,
              }}
            >
              No systems placed
            </div>
          ) : (
            systems.map((sys) => (
              <div
                key={sys.uid}
                onClick={() => onSelectSystem(sys.uid)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  background:
                    selectedSystem?.uid === sys.uid
                      ? `${COLORS.accent}18`
                      : "transparent",
                  border: `1px solid ${
                    selectedSystem?.uid === sys.uid ? COLORS.accent : COLORS.border
                  }`,
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={sys.visible}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(sys.uid);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ accentColor: COLORS.accent, width: 14, height: 14 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: COLORS.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {sys.def.name}
                  </div>
                  <div style={{ fontSize: 9, color: COLORS.muted }}>
                    {sys.def.type} &bull; {sys.altitude}m
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(sys.uid);
                  }}
                  style={{
                    padding: "2px 6px",
                    fontSize: 12,
                    background: "transparent",
                    border: `1px solid ${COLORS.danger}40`,
                    borderRadius: 3,
                    color: COLORS.danger,
                    cursor: "pointer",
                  }}
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Selected system detail */}
      {selectedSystem && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {/* Header info */}
          <div style={{ padding: "14px 14px 12px" }}>
            <SectionHeader title={selectedSystem.def.category.toUpperCase()} />
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.text,
                marginBottom: 6,
              }}
            >
              {selectedSystem.def.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: COLORS.text,
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 4,
              }}
            >
              {selectedSystem.lat.toFixed(6)}, {selectedSystem.lng.toFixed(6)}
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted }}>
              Height AGL: {selectedSystem.altitude}m
            </div>
          </div>

          {/* Altitude slider + band presets */}
          <div style={{ padding: "0 14px 14px" }}>
            {/* Altitude legend */}
            {(() => {
              const band = getAltitudeBand(selectedSystem.altitude);
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 8,
                    padding: "5px 8px",
                    background: `${band.color}18`,
                    border: `1px solid ${band.color}44`,
                    borderRadius: 5,
                  }}
                >
                  <span style={{ fontSize: 13 }}>{band.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: band.color,
                        letterSpacing: 0.5,
                      }}
                    >
                      {band.label} BAND &mdash; {selectedSystem.altitude}m AGL
                    </div>
                    <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 1 }}>
                      {getAltitudeBandLabel(selectedSystem.altitude)}
                    </div>
                  </div>
                </div>
              );
            })()}

            <input
              type="range"
              min={2}
              max={2000}
              value={selectedSystem.altitude}
              onChange={(e) =>
                onAltitudeChange(selectedSystem.uid, parseInt(e.target.value))
              }
              style={{
                width: "100%",
                accentColor: COLORS.accent,
                marginBottom: 10,
              }}
            />

            {/* Band preset rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ALTITUDE_BANDS.map((band) => (
                <div key={band.label}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 10 }}>{band.icon}</span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: band.color,
                        letterSpacing: 1,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {band.label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 1,
                        background: `${band.color}33`,
                        marginLeft: 2,
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {band.presets.map((preset) => {
                      const isActive = selectedSystem.altitude === preset.value;
                      return (
                        <button
                          key={preset.value}
                          onClick={() =>
                            onAltitudeChange(selectedSystem.uid, preset.value)
                          }
                          style={{
                            flex: 1,
                            padding: "5px 4px",
                            fontSize: 10,
                            fontWeight: 600,
                            border: `1px solid ${
                              isActive ? band.color : COLORS.border
                            }`,
                            borderRadius: 4,
                            background: isActive
                              ? `${band.color}22`
                              : "transparent",
                            color: isActive ? band.color : COLORS.muted,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "all 0.1s",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FOV rotation controls */}
          {isNarrowFov(selectedSystem.def.fov_deg) && (
            <div
              style={{
                padding: "14px",
                borderTop: `1px solid ${COLORS.border}`,
              }}
            >
              <SectionHeader title="FACING" />
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 10,
                }}
              >
                {selectedSystem.facing_deg}&deg; ({selectedSystem.def.fov_deg}&deg;
                FOV)
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[-15, -5, 5, 15].map((delta) => (
                  <button
                    key={delta}
                    onClick={() => onRotate(selectedSystem.uid, delta)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1,
                      background: COLORS.bg,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 5,
                      color: COLORS.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {delta > 0 ? "+" : ""}
                    {delta}&deg;
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Viewshed section */}
          {selectedSystem.def.requires_los && (
            <div
              style={{
                padding: "14px",
                borderTop: `1px solid ${COLORS.border}`,
              }}
            >
              <SectionHeader title="VIEWSHED" />
              {selectedSystem.viewshedLoading ? (
                <div
                  style={{
                    fontSize: 11,
                    color: COLORS.warning,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      border: `2px solid ${COLORS.warning}40`,
                      borderTop: `2px solid ${COLORS.warning}`,
                      borderRadius: "50%",
                      animation: "bda-spin 0.8s linear infinite",
                    }}
                  />
                  Computing viewshed...
                </div>
              ) : (
                <>
                  <div style={{ textAlign: "center", marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: 36,
                        fontWeight: 700,
                        color: COLORS.accent,
                        fontFamily: "'JetBrains Mono', monospace",
                        lineHeight: 1,
                      }}
                    >
                      {selectedSystem.viewshedStats
                        ? `${selectedSystem.viewshedStats.coveragePercent.toFixed(1)}%`
                        : "\u2014"}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: COLORS.muted,
                        marginTop: 4,
                      }}
                    >
                      Coverage
                    </div>
                  </div>

                  {selectedSystem.viewshedStats && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "6px 12px",
                        marginBottom: 12,
                        fontSize: 10,
                      }}
                    >
                      <div style={{ color: COLORS.muted }}>Total cells</div>
                      <div
                        style={{
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          color: COLORS.text,
                          fontWeight: 600,
                        }}
                      >
                        {selectedSystem.viewshedStats.totalCells}
                      </div>
                      <div style={{ color: COLORS.muted }}>Visible</div>
                      <div
                        style={{
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          color: COLORS.success,
                          fontWeight: 600,
                        }}
                      >
                        {selectedSystem.viewshedStats.visibleCells}
                      </div>
                      <div style={{ color: COLORS.muted }}>Blocked</div>
                      <div
                        style={{
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          color: COLORS.danger,
                          fontWeight: 600,
                        }}
                      >
                        {selectedSystem.viewshedStats.blockedCells}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => onRecalculate(selectedSystem.uid)}
                    style={{
                      width: "100%",
                      padding: "8px 0",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1,
                      background: COLORS.bg,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 5,
                      color: COLORS.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    RECALCULATE
                  </button>
                </>
              )}
            </div>
          )}

          {/* Terrain info */}
          {selectedSystem.viewshedStats && (
            <div
              style={{
                padding: "14px",
                borderTop: `1px solid ${COLORS.border}`,
              }}
            >
              <SectionHeader title="TERRAIN INFO" />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "6px 12px",
                  fontSize: 10,
                }}
              >
                <div style={{ color: COLORS.muted }}>Sensor elev</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.text,
                    fontWeight: 600,
                  }}
                >
                  {Math.round(selectedSystem.viewshedStats.sensorElevation)}m
                </div>
                <div style={{ color: COLORS.muted }}>Min elev</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.text,
                    fontWeight: 600,
                  }}
                >
                  {Math.round(selectedSystem.viewshedStats.minElevation)}m
                </div>
                <div style={{ color: COLORS.muted }}>Max elev</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.text,
                    fontWeight: 600,
                  }}
                >
                  {Math.round(selectedSystem.viewshedStats.maxElevation)}m
                </div>
                <div style={{ color: COLORS.muted }}>Relief</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.text,
                    fontWeight: 600,
                  }}
                >
                  {Math.round(
                    selectedSystem.viewshedStats.maxElevation -
                      selectedSystem.viewshedStats.minElevation,
                  )}
                  m
                </div>
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: COLORS.muted,
                  marginTop: 10,
                  opacity: 0.6,
                }}
              >
                SRTM 30m via Open-Elevation
              </div>
            </div>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Delete button */}
          <div
            style={{
              padding: "10px 14px",
              borderTop: `1px solid ${COLORS.border}`,
            }}
          >
            <button
              onClick={() => onDelete(selectedSystem.uid)}
              style={{
                width: "100%",
                padding: "8px 0",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
                background: `${COLORS.danger}18`,
                border: `1px solid ${COLORS.danger}50`,
                borderRadius: 5,
                color: COLORS.danger,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              DELETE SYSTEM
            </button>
          </div>
        </div>
      )}

      {/* Spinner animation */}
      <style>{`
        @keyframes bda-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
