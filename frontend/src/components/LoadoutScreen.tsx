import React, { useState, useEffect } from "react";
import type { CatalogSensor, CatalogEffector, EquipmentCatalog } from "../types";

interface Props {
  maxSensors: number;
  maxEffectors: number;
  onConfirm: (selectedSensors: CatalogSensor[], selectedEffectors: CatalogEffector[]) => void;
  onBack: () => void;
}

const API_BASE = window.location.origin;

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  blue: "#58a6ff",
  green: "#3fb950",
  yellow: "#d29922",
  red: "#f85149",
  purple: "#bc8cff",
  blueBg: "rgba(88, 166, 255, 0.08)",
  blueBorder: "rgba(88, 166, 255, 0.5)",
};

const TYPE_COLORS: Record<string, string> = {
  radar: COLORS.blue,
  rf: COLORS.purple,
  eoir: COLORS.yellow,
  acoustic: COLORS.green,
  jammer: COLORS.purple,
  kinetic: COLORS.red,
  interceptor: COLORS.blue,
  directed_energy: COLORS.yellow,
};

const COLLATERAL_COLORS: Record<string, string> = {
  low: COLORS.green,
  medium: COLORS.yellow,
  high: COLORS.red,
  very_high: COLORS.red,
};

export default function LoadoutScreen({ maxSensors, maxEffectors, onConfirm, onBack }: Props) {
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSensorIds, setSelectedSensorIds] = useState<Set<string>>(new Set());
  const [selectedEffectorIds, setSelectedEffectorIds] = useState<Set<string>>(new Set());
  const [sensorWarning, setSensorWarning] = useState(false);
  const [effectorWarning, setEffectorWarning] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/equipment`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: EquipmentCatalog) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const toggleSensor = (id: string) => {
    setSelectedSensorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSensorWarning(false);
      } else if (next.size < maxSensors) {
        next.add(id);
        setSensorWarning(false);
      } else {
        setSensorWarning(true);
        setTimeout(() => setSensorWarning(false), 2000);
      }
      return next;
    });
  };

  const toggleEffector = (id: string) => {
    setSelectedEffectorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setEffectorWarning(false);
      } else if (next.size < maxEffectors) {
        next.add(id);
        setEffectorWarning(false);
      } else {
        setEffectorWarning(true);
        setTimeout(() => setEffectorWarning(false), 2000);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!catalog) return;
    const sensors = catalog.sensors.filter((s) => selectedSensorIds.has(s.catalog_id));
    const effectors = catalog.effectors.filter((e) => selectedEffectorIds.has(e.catalog_id));
    onConfirm(sensors, effectors);
  };

  const canConfirm = selectedSensorIds.size > 0 && selectedEffectorIds.size > 0;

  // --- Styles ---

  const containerStyle: React.CSSProperties = {
    background: COLORS.bg,
    height: "100vh",
    color: COLORS.text,
    fontFamily: "'Inter', sans-serif",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: `1px solid ${COLORS.border}`,
    flexWrap: "wrap",
    gap: "12px",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "20px",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: COLORS.text,
    margin: 0,
  };

  const counterContainerStyle: React.CSSProperties = {
    display: "flex",
    gap: "24px",
    alignItems: "center",
  };

  const counterStyle = (count: number, max: number, warn: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "13px",
    color: warn ? COLORS.red : count >= max ? COLORS.yellow : COLORS.muted,
    transition: "color 0.2s",
  });

  const sectionStyle: React.CSSProperties = {
    padding: "24px 32px 8px",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "1.5px",
    textTransform: "uppercase" as const,
    color: COLORS.muted,
    marginBottom: "16px",
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "16px",
  };

  const cardStyle = (selected: boolean): React.CSSProperties => ({
    background: selected ? COLORS.blueBg : COLORS.card,
    border: `1px solid ${selected ? COLORS.blueBorder : COLORS.border}`,
    borderRadius: "8px",
    padding: "20px",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
    userSelect: "none" as const,
  });

  const nameStyle: React.CSSProperties = {
    fontSize: "15px",
    fontWeight: 600,
    color: COLORS.text,
    marginBottom: "8px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  };

  const tagStyle = (color: string): React.CSSProperties => ({
    fontSize: "10px",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color,
    background: `${color}1a`,
    padding: "2px 8px",
    borderRadius: "4px",
    border: `1px solid ${color}33`,
  });

  const descStyle: React.CSSProperties = {
    fontSize: "13px",
    color: COLORS.muted,
    lineHeight: 1.5,
    marginBottom: "12px",
  };

  const statsRowStyle: React.CSSProperties = {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "12px",
  };

  const statStyle: React.CSSProperties = {
    fontSize: "12px",
    fontFamily: "'JetBrains Mono', monospace",
    color: COLORS.muted,
  };

  const statValueStyle: React.CSSProperties = {
    color: COLORS.text,
    fontWeight: 600,
  };

  const prosConsStyle: React.CSSProperties = {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  };

  const listStyle: React.CSSProperties = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    fontSize: "11px",
    lineHeight: 1.7,
  };

  const footerStyle: React.CSSProperties = {
    marginTop: "auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 32px",
    borderTop: `1px solid ${COLORS.border}`,
  };

  const btnBase: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 24px",
    borderRadius: "6px",
    cursor: "pointer",
    border: "none",
    transition: "opacity 0.15s",
  };

  const backBtnStyle: React.CSSProperties = {
    ...btnBase,
    background: COLORS.card,
    color: COLORS.muted,
    border: `1px solid ${COLORS.border}`,
  };

  const confirmBtnStyle: React.CSSProperties = {
    ...btnBase,
    background: canConfirm ? COLORS.blue : COLORS.border,
    color: canConfirm ? "#fff" : COLORS.muted,
    cursor: canConfirm ? "pointer" : "not-allowed",
    opacity: canConfirm ? 1 : 0.6,
  };

  const warningStyle: React.CSSProperties = {
    fontSize: "12px",
    fontFamily: "'JetBrains Mono', monospace",
    color: COLORS.red,
    marginLeft: "8px",
  };

  const collateralBadgeStyle = (risk: string): React.CSSProperties => {
    const color = COLLATERAL_COLORS[risk] || COLORS.muted;
    return {
      fontSize: "10px",
      fontWeight: 600,
      fontFamily: "'JetBrains Mono', monospace",
      textTransform: "uppercase" as const,
      color,
      background: `${color}1a`,
      padding: "2px 8px",
      borderRadius: "4px",
      border: `1px solid ${color}33`,
    };
  };

  // --- Render ---

  if (loading) {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.muted, fontSize: "14px" }}>
          LOADING EQUIPMENT CATALOG...
        </span>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.red, fontSize: "14px" }}>
          FAILED TO LOAD CATALOG: {error || "Unknown error"}
        </span>
        <button style={backBtnStyle} onClick={onBack}>BACK</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={titleStyle}>EQUIPMENT LOADOUT</h1>
        <div style={counterContainerStyle}>
          <span style={counterStyle(selectedSensorIds.size, maxSensors, sensorWarning)}>
            SENSORS: {selectedSensorIds.size}/{maxSensors} selected
          </span>
          {sensorWarning && <span style={warningStyle}>MAX REACHED</span>}
          <span style={{ color: COLORS.border }}>|</span>
          <span style={counterStyle(selectedEffectorIds.size, maxEffectors, effectorWarning)}>
            EFFECTORS: {selectedEffectorIds.size}/{maxEffectors} selected
          </span>
          {effectorWarning && <span style={warningStyle}>MAX REACHED</span>}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "16px" }}>
        {/* Sensors Section */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>SENSORS</div>
          <div style={gridStyle}>
            {catalog.sensors.map((sensor) => {
              const selected = selectedSensorIds.has(sensor.catalog_id);
              const typeColor = TYPE_COLORS[sensor.type] || COLORS.muted;
              return (
                <div
                  key={sensor.catalog_id}
                  style={cardStyle(selected)}
                  onClick={() => toggleSensor(sensor.catalog_id)}
                >
                  <div style={nameStyle}>
                    <span>{sensor.name}</span>
                    <span style={tagStyle(typeColor)}>{sensor.type}</span>
                    {sensor.requires_los && (
                      <span style={tagStyle(COLORS.muted)}>LOS</span>
                    )}
                  </div>
                  <div style={descStyle}>{sensor.description}</div>
                  <div style={statsRowStyle}>
                    <span style={statStyle}>
                      Range: <span style={statValueStyle}>{sensor.range_km} km</span>
                    </span>
                    <span style={statStyle}>
                      FOV: <span style={statValueStyle}>{sensor.fov_deg}&deg;</span>
                    </span>
                  </div>
                  <div style={prosConsStyle}>
                    {sensor.pros.length > 0 && (
                      <ul style={listStyle}>
                        {sensor.pros.map((p, i) => (
                          <li key={i} style={{ color: COLORS.green }}>+ {p}</li>
                        ))}
                      </ul>
                    )}
                    {sensor.cons.length > 0 && (
                      <ul style={listStyle}>
                        {sensor.cons.map((c, i) => (
                          <li key={i} style={{ color: COLORS.red }}>- {c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Effectors Section */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>EFFECTORS</div>
          <div style={gridStyle}>
            {catalog.effectors.map((effector) => {
              const selected = selectedEffectorIds.has(effector.catalog_id);
              const typeColor = TYPE_COLORS[effector.type] || COLORS.muted;
              return (
                <div
                  key={effector.catalog_id}
                  style={cardStyle(selected)}
                  onClick={() => toggleEffector(effector.catalog_id)}
                >
                  <div style={nameStyle}>
                    <span>{effector.name}</span>
                    <span style={tagStyle(typeColor)}>{effector.type}</span>
                    {effector.single_use && (
                      <span style={tagStyle(COLORS.yellow)}>SINGLE USE</span>
                    )}
                    <span style={collateralBadgeStyle(effector.collateral_risk)}>
                      {effector.collateral_risk.replace("_", " ")} COLLATERAL
                    </span>
                  </div>
                  <div style={descStyle}>{effector.description}</div>
                  <div style={statsRowStyle}>
                    <span style={statStyle}>
                      Range: <span style={statValueStyle}>{effector.range_km} km</span>
                    </span>
                    <span style={statStyle}>
                      FOV: <span style={statValueStyle}>{effector.fov_deg}&deg;</span>
                    </span>
                    {effector.recharge_seconds > 0 && (
                      <span style={statStyle}>
                        Recharge: <span style={statValueStyle}>{effector.recharge_seconds}s</span>
                      </span>
                    )}
                    {effector.requires_los && (
                      <span style={tagStyle(COLORS.muted)}>LOS</span>
                    )}
                  </div>
                  <div style={prosConsStyle}>
                    {effector.pros.length > 0 && (
                      <ul style={listStyle}>
                        {effector.pros.map((p, i) => (
                          <li key={i} style={{ color: COLORS.green }}>+ {p}</li>
                        ))}
                      </ul>
                    )}
                    {effector.cons.length > 0 && (
                      <ul style={listStyle}>
                        {effector.cons.map((c, i) => (
                          <li key={i} style={{ color: COLORS.red }}>- {c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <button style={backBtnStyle} onClick={onBack}>
          BACK
        </button>
        <button
          style={confirmBtnStyle}
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          CONFIRM LOADOUT
        </button>
      </div>
    </div>
  );
}
