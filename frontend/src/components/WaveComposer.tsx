// frontend/src/components/WaveComposer.tsx
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { COLORS } from "./bda/constants";

export interface WaveDef {
  id: string;
  droneType: string;
  count: number;
  spawnSector: string;
  delaySeconds: number;
  staggerSeconds: number;
  altitude: number;
  speed: number;
  behavior: string;
}

interface Props {
  waves: WaveDef[];
  onWavesChange: (waves: WaveDef[]) => void;
  onBack: () => void;
  onNext: () => void;
}

const DRONE_TYPES = [
  "commercial_quad",
  "micro",
  "fixed_wing",
  "improvised",
  "improvised_hardened",
  "shahed",
];

const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const BEHAVIORS = ["direct_approach", "evasive", "orbit", "waypoint_path"];

const WAVE_COLORS = [
  COLORS.accent,
  COLORS.success,
  COLORS.warning,
  COLORS.purple,
  "#388bfd",
  "#f85149",
  "#ff6a00",
  "#00bfbf",
];

export function createNewWave(index: number): WaveDef {
  return {
    id: "wave-" + index,
    droneType: "commercial_quad",
    count: 1,
    spawnSector: "N",
    delaySeconds: 30,
    staggerSeconds: 5,
    altitude: 150,
    speed: 35,
    behavior: "direct_approach",
  };
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export default function WaveComposer({ waves, onWavesChange, onBack, onNext }: Props) {
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(waves[0]?.id ?? null);

  useEffect(() => {
    if (waves.length === 0) {
      setSelectedWaveId(null);
      return;
    }
    if (!selectedWaveId || !waves.some((wave) => wave.id === selectedWaveId)) {
      setSelectedWaveId(waves[0].id);
    }
  }, [waves, selectedWaveId]);

  const selectedIndex = waves.findIndex((wave) => wave.id === selectedWaveId);
  const selectedWave = selectedIndex >= 0 ? waves[selectedIndex] : null;

  const timelineMaxSeconds = useMemo(() => {
    const lastWaveEnd = waves.reduce((max, wave) => {
      const duration = wave.count * wave.staggerSeconds + 30;
      return Math.max(max, wave.delaySeconds + duration);
    }, 300);
    return Math.max(300, Math.ceil(lastWaveEnd / 30) * 30);
  }, [waves]);

  function handleAddWave() {
    const nextWave = createNewWave(waves.length + 1);
    onWavesChange([...waves, nextWave]);
    setSelectedWaveId(nextWave.id);
  }

  function handleDeleteWave(id: string) {
    const nextWaves = waves.filter((wave) => wave.id !== id);
    onWavesChange(nextWaves);
    if (selectedWaveId === id) {
      setSelectedWaveId(nextWaves[0]?.id ?? null);
    }
  }

  function updateSelectedWave(patch: Partial<WaveDef>) {
    if (!selectedWave) return;
    onWavesChange(
      waves.map((wave) => (wave.id === selectedWave.id ? { ...wave, ...patch } : wave))
    );
  }

  function inputStyle(): CSSProperties {
    return {
      width: "100%",
      boxSizing: "border-box",
      background: "#0b111c",
      border: `1px solid ${COLORS.border}`,
      borderRadius: 8,
      color: COLORS.text,
      fontFamily: "inherit",
      fontSize: 14,
      outline: "none",
      padding: "10px 12px",
    };
  }

  function labelStyle(): CSSProperties {
    return {
      color: COLORS.muted,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.8,
      marginBottom: 6,
      textTransform: "uppercase",
    };
  }

  function renderNumberInput(
    label: string,
    value: number,
    field: keyof Pick<
      WaveDef,
      "count" | "delaySeconds" | "staggerSeconds" | "altitude" | "speed"
    >,
    min: number,
    max: number
  ) {
    return (
      <div>
        <div style={labelStyle()}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            updateSelectedWave({ [field]: clampNumber(Number(event.target.value), min, max) });
          }}
          style={inputStyle()}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        background: COLORS.bg,
        color: COLORS.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', 'Roboto Mono', monospace",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left panel: Wave List */}
        <aside
          style={{
            background: COLORS.card,
            borderRight: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            minWidth: 250,
            width: 250,
          }}
        >
          <div
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${COLORS.border}`,
              display: "flex",
              justifyContent: "space-between",
              padding: "16px",
            }}
          >
            <h2
              style={{
                color: COLORS.text,
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: 1.4,
                margin: 0,
              }}
            >
              WAVES
            </h2>
            <button
              onClick={handleAddWave}
              style={{
                background: COLORS.accent,
                border: "none",
                borderRadius: 6,
                color: COLORS.bg,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 800,
                padding: "7px 9px",
              }}
            >
              + Add Wave
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {waves.length === 0 && (
              <div
                style={{
                  border: `1px dashed ${COLORS.border}`,
                  borderRadius: 10,
                  color: COLORS.muted,
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: 16,
                  textAlign: "center",
                }}
              >
                No waves configured. Add a wave to begin.
              </div>
            )}

            {waves.map((wave, index) => {
              const isSelected = wave.id === selectedWaveId;
              return (
                <button
                  key={wave.id}
                  onClick={() => setSelectedWaveId(wave.id)}
                  style={{
                    background: isSelected ? "rgba(0, 212, 255, 0.08)" : "#0b111c",
                    border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
                    borderRadius: 10,
                    color: COLORS.text,
                    cursor: "pointer",
                    display: "block",
                    fontFamily: "inherit",
                    marginBottom: 10,
                    padding: 0,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div style={{ padding: 12, position: "relative" }}>
                    <div
                      style={{
                        alignItems: "center",
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ color: isSelected ? COLORS.accent : COLORS.text, fontWeight: 800 }}>
                        Wave {index + 1}
                      </span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteWave(wave.id);
                        }}
                        style={{
                          color: COLORS.danger,
                          cursor: "pointer",
                          fontSize: 16,
                          fontWeight: 800,
                          lineHeight: 1,
                          padding: 2,
                        }}
                        title="Delete wave"
                      >
                        ×
                      </span>
                    </div>
                    <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 700 }}>
                      {formatLabel(wave.droneType)} × {wave.count}
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
                      Sector {wave.spawnSector} · Delay {wave.delaySeconds}s
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center panel: Wave Editor */}
        <main
          style={{
            background: COLORS.bg,
            flex: 1,
            minWidth: 0,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {selectedWave ? (
            <div style={{ maxWidth: 900 }}>
              <div style={{ marginBottom: 22 }}>
                <h1 style={{ color: COLORS.text, fontSize: 24, margin: 0 }}>
                  Wave {selectedIndex + 1}
                </h1>
                <p style={{ color: COLORS.muted, fontSize: 13, margin: "6px 0 0" }}>
                  Configure threat composition, ingress sector, timing, and behavior.
                </p>
              </div>

              <div
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: 18,
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  <div>
                    <div style={labelStyle()}>Drone Type</div>
                    <select
                      value={selectedWave.droneType}
                      onChange={(event) => updateSelectedWave({ droneType: event.target.value })}
                      style={inputStyle()}
                    >
                      {DRONE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {formatLabel(type)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {renderNumberInput("Count", selectedWave.count, "count", 1, 10)}

                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={labelStyle()}>Spawn Sector</div>
                    <div
                      style={{
                        display: "grid",
                        gap: 8,
                        gridTemplateColumns: "repeat(4, minmax(58px, 1fr))",
                        maxWidth: 360,
                      }}
                    >
                      {SECTORS.map((sector) => {
                        const isSelected = selectedWave.spawnSector === sector;
                        return (
                          <button
                            key={sector}
                            onClick={() => updateSelectedWave({ spawnSector: sector })}
                            style={{
                              background: isSelected ? COLORS.accent : "#0b111c",
                              border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
                              borderRadius: 8,
                              color: isSelected ? COLORS.bg : COLORS.text,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontSize: 13,
                              fontWeight: 800,
                              padding: "10px 0",
                            }}
                          >
                            {sector}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {renderNumberInput("Delay (seconds)", selectedWave.delaySeconds, "delaySeconds", 0, 600)}
                  {renderNumberInput("Stagger (seconds)", selectedWave.staggerSeconds, "staggerSeconds", 0, 30)}
                  {renderNumberInput("Altitude (m)", selectedWave.altitude, "altitude", 10, 5000)}
                  {renderNumberInput("Speed (kts)", selectedWave.speed, "speed", 5, 500)}

                  <div>
                    <div style={labelStyle()}>Behavior</div>
                    <select
                      value={selectedWave.behavior}
                      onChange={(event) => updateSelectedWave({ behavior: event.target.value })}
                      style={inputStyle()}
                    >
                      {BEHAVIORS.map((behavior) => (
                        <option key={behavior} value={behavior}>
                          {formatLabel(behavior)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                alignItems: "center",
                border: `1px dashed ${COLORS.border}`,
                borderRadius: 12,
                color: COLORS.muted,
                display: "flex",
                fontSize: 14,
                height: "100%",
                justifyContent: "center",
                minHeight: 260,
              }}
            >
              Select or add a wave to edit its parameters.
            </div>
          )}
        </main>

        {/* Right panel: Timeline Preview */}
        <aside
          style={{
            background: COLORS.card,
            borderLeft: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            minWidth: 300,
            width: 300,
          }}
        >
          <div
            style={{
              borderBottom: `1px solid ${COLORS.border}`,
              padding: "18px 16px",
            }}
          >
            <h2
              style={{
                color: COLORS.text,
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: 1.4,
                margin: 0,
              }}
            >
              TIMELINE
            </h2>
            <p style={{ color: COLORS.muted, fontSize: 12, margin: "6px 0 0" }}>
              Wave start offsets and approximate duration
            </p>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div
              style={{
                borderBottom: `1px solid ${COLORS.border}`,
                height: 24,
                marginBottom: 12,
                position: "relative",
              }}
            >
              {[30, 60, 120, 180, 300].map((marker) => (
                <div
                  key={marker}
                  style={{
                    left: `${Math.min(100, (marker / timelineMaxSeconds) * 100)}%`,
                    position: "absolute",
                    top: 0,
                    transform: "translateX(-50%)",
                  }}
                >
                  <div style={{ background: COLORS.border, height: 24, margin: "0 auto", width: 1 }} />
                  <div style={{ color: COLORS.muted, fontSize: 10, marginTop: 2 }}>{marker}s</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
              {waves.length === 0 && (
                <div style={{ color: COLORS.muted, fontSize: 13, textAlign: "center" }}>
                  Add waves to preview timing.
                </div>
              )}

              {waves.map((wave, index) => {
                const duration = wave.count * wave.staggerSeconds + 30;
                const left = Math.min(92, (wave.delaySeconds / timelineMaxSeconds) * 100);
                const width = Math.max(16, Math.min(100 - left, (duration / timelineMaxSeconds) * 100));
                const color = WAVE_COLORS[index % WAVE_COLORS.length];
                return (
                  <div key={wave.id} style={{ height: 34, position: "relative" }}>
                    <div
                      style={{
                        background: "#0b111c",
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 8,
                        height: 30,
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        title={`Wave ${index + 1}: starts at ${wave.delaySeconds}s`}
                        style={{
                          alignItems: "center",
                          background: color,
                          borderRadius: 7,
                          color: COLORS.bg,
                          display: "flex",
                          fontSize: 11,
                          fontWeight: 900,
                          height: "100%",
                          justifyContent: "center",
                          left: `${left}%`,
                          minWidth: 46,
                          overflow: "hidden",
                          padding: "0 6px",
                          position: "absolute",
                          top: 0,
                          whiteSpace: "nowrap",
                          width: `${width}%`,
                        }}
                      >
                        W{index + 1}
                      </div>
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 10, marginTop: 2 }}>
                      {formatLabel(wave.droneType)} · {wave.count} · {wave.delaySeconds}s
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      <div
        style={{
          alignItems: "center",
          background: COLORS.card,
          borderTop: `1px solid ${COLORS.border}`,
          display: "flex",
          justifyContent: "space-between",
          padding: "12px 20px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            color: COLORS.text,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 700,
            padding: "10px 16px",
          }}
        >
          Back
        </button>
        <button
          onClick={onNext}
          style={{
            background: COLORS.accent,
            border: "none",
            borderRadius: 8,
            color: COLORS.bg,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 800,
            padding: "10px 18px",
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
