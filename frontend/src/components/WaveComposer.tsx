// frontend/src/components/WaveComposer.tsx
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { COLORS } from "./bda/constants";
import {
  BEHAVIORS,
  DRONE_TYPES,
  SECTOR_BEARINGS,
  createDefaultThreatGroup,
  normalizeBearing,
  normalizeWaves,
  type NormalizedWaveDef,
  type ThreatGroupDef,
  type WaveDef,
} from "../utils/scenarioBuilderUtils";

export type { ThreatGroupDef, WaveDef } from "../utils/scenarioBuilderUtils";

interface Props {
  waves: WaveDef[];
  onWavesChange: (waves: WaveDef[]) => void;
  onBack: () => void;
  onNext: () => void;
}

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

const SECTOR_OPTIONS = Object.entries(SECTOR_BEARINGS);

let _waveIdCounter = 0;
let _threatGroupIdCounter = 0;

export function resetWaveIdCounter(value = 0) {
  _waveIdCounter = value;
  _threatGroupIdCounter = value;
}

export function nextWaveId(): string {
  _waveIdCounter += 1;
  return "wave-" + _waveIdCounter;
}

export function nextThreatGroupId(): string {
  _threatGroupIdCounter += 1;
  return "group-" + _threatGroupIdCounter;
}

export function createNewThreatGroup(patch: Partial<ThreatGroupDef> = {}): ThreatGroupDef {
  const id = patch.id ?? nextThreatGroupId();
  return {
    ...createDefaultThreatGroup(id),
    ...patch,
    id,
  };
}

export function createNewWave(): WaveDef {
  return {
    id: nextWaveId(),
    startSeconds: 30,
    threatGroups: [
      {
        ...createDefaultThreatGroup(nextThreatGroupId()),
      },
    ],
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

function countDrones(wave: NormalizedWaveDef): number {
  return wave.threatGroups.reduce((sum, group) => sum + group.count, 0);
}

function groupStartSeconds(wave: NormalizedWaveDef, group: ThreatGroupDef): number {
  return wave.startSeconds + group.spawnOffsetSeconds;
}

function groupDurationSeconds(group: ThreatGroupDef): number {
  return group.count * group.staggerSeconds + 30;
}

function inputStyle(width: string | number = "100%"): CSSProperties {
  return {
    width,
    boxSizing: "border-box",
    background: "#0b111c",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    color: COLORS.text,
    fontFamily: "inherit",
    fontSize: 13,
    outline: "none",
    padding: "8px 10px",
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

function iconButtonStyle(color = COLORS.text, disabled = false): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: disabled ? COLORS.muted : color,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 800,
    padding: "6px 8px",
  };
}

function normalizeForState(waves: WaveDef[]): WaveDef[] {
  return normalizeWaves(waves).map((wave) => ({
    id: wave.id,
    startSeconds: wave.startSeconds,
    threatGroups: wave.threatGroups,
  }));
}

export default function WaveComposer({ waves, onWavesChange, onBack, onNext }: Props) {
  const normalizedWaves = useMemo(() => normalizeWaves(waves), [waves]);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(normalizedWaves[0]?.id ?? null);

  useEffect(() => {
    if (normalizedWaves.length === 0) {
      setSelectedWaveId(null);
      return;
    }
    if (!selectedWaveId || !normalizedWaves.some((wave) => wave.id === selectedWaveId)) {
      setSelectedWaveId(normalizedWaves[0].id);
    }
  }, [normalizedWaves, selectedWaveId]);

  const selectedIndex = normalizedWaves.findIndex((wave) => wave.id === selectedWaveId);
  const selectedWave = selectedIndex >= 0 ? normalizedWaves[selectedIndex] : null;
  const canContinue = normalizedWaves.length > 0;

  const timelineMaxSeconds = useMemo(() => {
    const lastGroupEnd = normalizedWaves.reduce((max, wave) => {
      const waveEnd = wave.threatGroups.reduce((groupMax, group) => {
        return Math.max(groupMax, groupStartSeconds(wave, group) + groupDurationSeconds(group));
      }, 0);
      return Math.max(max, waveEnd);
    }, 300);
    return Math.max(300, Math.ceil(lastGroupEnd / 30) * 30);
  }, [normalizedWaves]);

  function commitWaves(nextWaves: WaveDef[]) {
    onWavesChange(normalizeForState(nextWaves));
  }

  function commitSelectedWave(nextWave: NormalizedWaveDef) {
    commitWaves(normalizedWaves.map((wave) => (wave.id === nextWave.id ? nextWave : wave)));
  }

  function handleAddWave() {
    const nextWave = createNewWave();
    commitWaves([...normalizedWaves, nextWave]);
    setSelectedWaveId(nextWave.id);
  }

  function handleDeleteWave(id: string) {
    const nextWaves = normalizedWaves.filter((wave) => wave.id !== id);
    commitWaves(nextWaves);
    if (selectedWaveId === id) {
      setSelectedWaveId(nextWaves[0]?.id ?? null);
    }
  }

  function updateSelectedWave(patch: Partial<NormalizedWaveDef>) {
    if (!selectedWave) return;
    commitSelectedWave({ ...selectedWave, ...patch });
  }

  function updateThreatGroup(groupId: string, patch: Partial<ThreatGroupDef>) {
    if (!selectedWave) return;
    commitSelectedWave({
      ...selectedWave,
      threatGroups: selectedWave.threatGroups.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    });
  }

  function handleAddThreatGroup() {
    if (!selectedWave) return;
    const lastOffset = selectedWave.threatGroups.reduce(
      (max, group) => Math.max(max, group.spawnOffsetSeconds),
      0,
    );
    commitSelectedWave({
      ...selectedWave,
      threatGroups: [
        ...selectedWave.threatGroups,
        createNewThreatGroup({ spawnOffsetSeconds: lastOffset + 30 }),
      ],
    });
  }

  function handleDuplicateThreatGroup(group: ThreatGroupDef) {
    if (!selectedWave) return;
    commitSelectedWave({
      ...selectedWave,
      threatGroups: [
        ...selectedWave.threatGroups,
        {
          ...group,
          id: nextThreatGroupId(),
          spawnOffsetSeconds: group.spawnOffsetSeconds + 10,
        },
      ],
    });
  }

  function handleDeleteThreatGroup(groupId: string) {
    if (!selectedWave || selectedWave.threatGroups.length <= 1) return;
    commitSelectedWave({
      ...selectedWave,
      threatGroups: selectedWave.threatGroups.filter((group) => group.id !== groupId),
    });
  }

  function renderNumberInput(
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    width: string | number = "100%",
  ) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        style={inputStyle(width)}
      />
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
        <aside
          style={{
            background: COLORS.card,
            borderRight: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            minWidth: 270,
            width: 270,
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
            {normalizedWaves.length === 0 && (
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

            {normalizedWaves.map((wave, index) => {
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
                      {wave.threatGroups.length} groups · {countDrones(wave)} UAS
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
                      Start T+{wave.startSeconds}s
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

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
            <div style={{ maxWidth: 1180 }}>
              <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between", gap: 18, marginBottom: 22 }}>
                <div>
                  <h1 style={{ color: COLORS.text, fontSize: 24, margin: 0 }}>
                    Wave {selectedIndex + 1}
                  </h1>
                  <p style={{ color: COLORS.muted, fontSize: 13, margin: "6px 0 0" }}>
                    Compose mixed UAS groups with independent timing, bearing, and behavior.
                  </p>
                </div>
                <div style={{ minWidth: 180 }}>
                  <div style={labelStyle()}>Wave Start</div>
                  {renderNumberInput(
                    selectedWave.startSeconds,
                    0,
                    900,
                    (value) => updateSelectedWave({ startSeconds: value }),
                  )}
                </div>
              </div>

              <div
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    borderBottom: `1px solid ${COLORS.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>
                    THREAT GROUPS
                  </div>
                  <button
                    onClick={handleAddThreatGroup}
                    style={{
                      background: COLORS.accent,
                      border: "none",
                      borderRadius: 6,
                      color: COLORS.bg,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 800,
                      padding: "8px 10px",
                    }}
                  >
                    + Add Group
                  </button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      borderCollapse: "collapse",
                      minWidth: 1040,
                      width: "100%",
                    }}
                  >
                    <thead>
                      <tr>
                        {["UAS Type", "Count", "Bearing", "Offset", "Stagger", "Altitude", "Speed", "Behavior", ""].map((label) => (
                          <th
                            key={label}
                            style={{
                              borderBottom: `1px solid ${COLORS.border}`,
                              color: COLORS.muted,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: 0.8,
                              padding: "10px 8px",
                              textAlign: "left",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedWave.threatGroups.map((group) => (
                        <tr key={group.id}>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 170 }}>
                            <select
                              value={group.droneType}
                              onChange={(event) => updateThreatGroup(group.id, { droneType: event.target.value })}
                              style={inputStyle()}
                            >
                              {DRONE_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {formatLabel(type)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 82 }}>
                            {renderNumberInput(group.count, 1, 20, (value) => updateThreatGroup(group.id, { count: value }))}
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 180 }}>
                            {renderNumberInput(
                              group.bearingDeg,
                              0,
                              359,
                              (value) => updateThreatGroup(group.id, { bearingDeg: normalizeBearing(value) }),
                            )}
                            <div style={{ display: "grid", gap: 4, gridTemplateColumns: "repeat(4, 1fr)", marginTop: 6 }}>
                              {SECTOR_OPTIONS.map(([sector, bearing]) => (
                                <button
                                  key={sector}
                                  onClick={() => updateThreatGroup(group.id, { bearingDeg: bearing })}
                                  style={{
                                    ...iconButtonStyle(group.bearingDeg === bearing ? COLORS.bg : COLORS.muted),
                                    background: group.bearingDeg === bearing ? COLORS.accent : "transparent",
                                    fontSize: 10,
                                    padding: "4px 0",
                                  }}
                                >
                                  {sector}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 88 }}>
                            {renderNumberInput(group.spawnOffsetSeconds, 0, 600, (value) => updateThreatGroup(group.id, { spawnOffsetSeconds: value }))}
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 88 }}>
                            {renderNumberInput(group.staggerSeconds, 0, 60, (value) => updateThreatGroup(group.id, { staggerSeconds: value }))}
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 100 }}>
                            {renderNumberInput(group.altitude, 10, 5000, (value) => updateThreatGroup(group.id, { altitude: value }))}
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 90 }}>
                            {renderNumberInput(group.speed, 5, 500, (value) => updateThreatGroup(group.id, { speed: value }))}
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 150 }}>
                            <select
                              value={group.behavior}
                              onChange={(event) => updateThreatGroup(group.id, { behavior: event.target.value })}
                              style={inputStyle()}
                            >
                              {BEHAVIORS.map((behavior) => (
                                <option key={behavior} value={behavior}>
                                  {formatLabel(behavior)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ borderBottom: `1px solid ${COLORS.border}`, padding: 8, verticalAlign: "top", width: 120 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => handleDuplicateThreatGroup(group)}
                                style={iconButtonStyle(COLORS.accent)}
                                title="Duplicate group"
                              >
                                DUP
                              </button>
                              <button
                                onClick={() => handleDeleteThreatGroup(group.id)}
                                disabled={selectedWave.threatGroups.length <= 1}
                                style={iconButtonStyle(COLORS.danger, selectedWave.threatGroups.length <= 1)}
                                title="Delete group"
                              >
                                DEL
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
              Select or add a wave to edit its threat groups.
            </div>
          )}
        </main>

        <aside
          style={{
            background: COLORS.card,
            borderLeft: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            minWidth: 320,
            width: 320,
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
              Mixed threat groups by mission time
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
              {[30, 60, 120, 180, 300, 600].filter((marker) => marker <= timelineMaxSeconds).map((marker) => (
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

            <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 12 }}>
              {normalizedWaves.length === 0 && (
                <div style={{ color: COLORS.muted, fontSize: 13, textAlign: "center" }}>
                  Add waves to preview timing.
                </div>
              )}

              {normalizedWaves.map((wave, waveIndex) => {
                const color = WAVE_COLORS[waveIndex % WAVE_COLORS.length];
                return (
                  <div key={wave.id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ color: COLORS.text, fontSize: 11, fontWeight: 800 }}>
                      Wave {waveIndex + 1} · T+{wave.startSeconds}s
                    </div>
                    {wave.threatGroups.map((group, groupIndex) => {
                      const absoluteStart = groupStartSeconds(wave, group);
                      const duration = groupDurationSeconds(group);
                      const left = Math.min(92, (absoluteStart / timelineMaxSeconds) * 100);
                      const width = Math.max(12, Math.min(100 - left, (duration / timelineMaxSeconds) * 100));
                      return (
                        <div key={group.id} style={{ height: 32, position: "relative" }}>
                          <div
                            style={{
                              background: "#0b111c",
                              border: `1px solid ${COLORS.border}`,
                              borderRadius: 8,
                              height: 24,
                              overflow: "hidden",
                              position: "relative",
                            }}
                          >
                            <div
                              title={`Wave ${waveIndex + 1}, Group ${groupIndex + 1}: starts at ${absoluteStart}s`}
                              style={{
                                alignItems: "center",
                                background: color,
                                borderRadius: 7,
                                color: COLORS.bg,
                                display: "flex",
                                fontSize: 10,
                                fontWeight: 900,
                                height: "100%",
                                justifyContent: "center",
                                left: `${left}%`,
                                minWidth: 38,
                                overflow: "hidden",
                                padding: "0 5px",
                                position: "absolute",
                                top: 0,
                                whiteSpace: "nowrap",
                                width: `${width}%`,
                              }}
                            >
                              W{waveIndex + 1}.G{groupIndex + 1}
                            </div>
                          </div>
                          <div style={{ color: COLORS.muted, fontSize: 10, marginTop: 2 }}>
                            {formatLabel(group.droneType)} · {group.count} · {group.bearingDeg}° · T+{absoluteStart}s
                          </div>
                        </div>
                      );
                    })}
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
          disabled={!canContinue}
          style={{
            background: canContinue ? COLORS.accent : COLORS.border,
            border: "none",
            borderRadius: 8,
            color: canContinue ? COLORS.bg : COLORS.muted,
            cursor: canContinue ? "pointer" : "not-allowed",
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
