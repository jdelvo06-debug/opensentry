import React, { useEffect, useState } from "react";

interface StudyModuleMeta {
  id: string;
  title: string;
  subtitle: string;
  scenario: string;
  difficulty: string;
}

const MODULES: StudyModuleMeta[] = [
  { id: "module_1", title: "Foundation of the DTID Kill Chain", subtitle: "Beginner | 20–30 min", scenario: "Tutorial", difficulty: "Beginner" },
  { id: "module_2", title: "Procedural Fluency Under Time Pressure", subtitle: "Easy | 15–25 min", scenario: "Lone Wolf", difficulty: "Easy" },
  { id: "module_3", title: "Rules of Engagement and Threat Discrimination", subtitle: "Medium | 20–35 min", scenario: "Recon Probe", difficulty: "Medium" },
  { id: "module_4", title: "Multi-Threat Management and Effector Economy", subtitle: "Hard | 25–45 min", scenario: "Swarm Attack", difficulty: "Hard" },
  { id: "module_5", title: "Operator Proficiency Assessment", subtitle: "Variable | 30–60 min", scenario: "Custom (user-defined)", difficulty: "Variable" },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: "#3fb950",
  Easy: "#3fb950",
  Medium: "#d29922",
  Hard: "#f85149",
  Variable: "#58a6ff",
};

interface Props {
  onSelectModule: (moduleId: string) => void;
  onBack: () => void;
}

export default function StudyLibrary({ onSelectModule, onBack }: Props) {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "#0d1117",
        overflow: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          padding: "40px 24px 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          onClick={onBack}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            color: "#8b949e",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: "pointer",
            padding: "4px 0",
            marginBottom: 8,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#e6edf3"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#8b949e"; }}
        >
          ← BACK
        </button>
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "#e6edf3",
            letterSpacing: 4,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          TRAINING LIBRARY
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#8b949e",
            letterSpacing: 1,
            fontWeight: 500,
          }}
        >
          C-UAS Operator Certification Preparation
        </div>
      </div>

      {/* Module cards */}
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          padding: "32px 24px 48px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {MODULES.map((mod, idx) => {
          const accent = DIFFICULTY_COLORS[mod.difficulty] || "#58a6ff";
          return (
            <div
              key={mod.id}
              style={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderTop: `3px solid ${accent}`,
                borderRadius: 8,
                padding: "20px 20px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                ...(idx === MODULES.length - 1 && MODULES.length % 2 === 1
                  ? { gridColumn: "1 / -1", maxWidth: "calc(50% - 8px)" }
                  : {}),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#8b949e",
                      letterSpacing: 2,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    MODULE {idx + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#e6edf3",
                      letterSpacing: 0.5,
                      fontFamily: "'Inter', sans-serif",
                      lineHeight: 1.3,
                    }}
                  >
                    {mod.title}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: `${accent}18`,
                    color: accent,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: "nowrap",
                    marginLeft: 12,
                    marginTop: 2,
                  }}
                >
                  {mod.difficulty.toUpperCase()}
                </span>
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: "#8b949e",
                  lineHeight: 1.5,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {mod.subtitle}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: "#58a6ff",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: 0.5,
                }}
              >
                Scenario: {mod.scenario}
              </div>

              <button
                onClick={() => onSelectModule(mod.id)}
                style={{
                  marginTop: 4,
                  padding: "10px 0",
                  background: "transparent",
                  border: `1px solid ${accent}`,
                  borderRadius: 5,
                  color: accent,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 2,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = accent;
                  el.style.color = "#0d1117";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "transparent";
                  el.style.color = accent;
                }}
              >
                OPEN MODULE
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
