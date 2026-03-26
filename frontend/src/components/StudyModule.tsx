import React, { useEffect, useState } from "react";

interface Slide {
  title: string;
  type: string;
  content: string | string[];
}

interface ModuleData {
  id: string;
  title: string;
  subtitle: string;
  scenario: string;
  difficulty: string;
  slides: Slide[];
}

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: "#3fb950",
  Easy: "#3fb950",
  Medium: "#d29922",
  Hard: "#f85149",
  Variable: "#58a6ff",
};

const TYPE_ICONS: Record<string, string> = {
  overview: "01",
  objectives: "02",
  concepts: "03",
  standards: "04",
};

interface Props {
  moduleId: string;
  onBack: () => void;
  onLaunchScenario: (scenario: string) => void;
}

export default function StudyModule({ moduleId, onBack, onLaunchScenario }: Props) {
  const [module, setModule] = useState<ModuleData | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlideIndex(0);
    fetch(`${import.meta.env.BASE_URL}data/study/${moduleId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load module: ${r.status}`);
        return r.json();
      })
      .then((data: ModuleData) => setModule(data))
      .catch((e) => setError(e.message));
  }, [moduleId]);

  if (error) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d1117", color: "#f85149", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Error loading module</div>
          <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 24 }}>{error}</div>
          <button onClick={onBack} style={{ padding: "10px 24px", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600 }}>
            ← BACK TO LIBRARY
          </button>
        </div>
      </div>
    );
  }

  if (!module) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d1117", color: "#8b949e", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
        Loading module...
      </div>
    );
  }

  const slide = module.slides[slideIndex];
  const isLast = slideIndex === module.slides.length - 1;
  const isFirst = slideIndex === 0;
  const accent = DIFFICULTY_COLORS[module.difficulty] || "#58a6ff";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0d1117",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#8b949e",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: "pointer",
            padding: "4px 0",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#e6edf3"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#8b949e"; }}
        >
          ← BACK TO LIBRARY
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#e6edf3",
              fontFamily: "'Inter', sans-serif",
              letterSpacing: 0.5,
            }}
          >
            {module.title}
          </span>
        </div>

        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: accent,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 1,
          }}
        >
          {slideIndex + 1} / {module.slides.length}
        </span>
      </div>

      {/* Slide content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          overflow: "auto",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* Slide type label */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: accent,
              letterSpacing: 3,
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase",
            }}
          >
            {slide.type}
          </div>

          {/* Slide title */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#e6edf3",
              fontFamily: "'Inter', sans-serif",
              letterSpacing: 1,
              lineHeight: 1.3,
            }}
          >
            {slide.title}
          </div>

          {/* Slide body */}
          {Array.isArray(slide.content) ? (
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 20px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {slide.content.map((item, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 15,
                    color: "#c9d1d9",
                    lineHeight: 1.7,
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <div
              style={{
                fontSize: 16,
                color: "#c9d1d9",
                lineHeight: 1.8,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {slide.content}
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderTop: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
          disabled={isFirst}
          style={{
            padding: "10px 24px",
            background: isFirst ? "#161b22" : "#161b22",
            border: `1px solid ${isFirst ? "#21262d" : "#30363d"}`,
            borderRadius: 6,
            color: isFirst ? "#484f58" : "#e6edf3",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            cursor: isFirst ? "default" : "pointer",
            transition: "all 0.15s",
          }}
        >
          ← PREV
        </button>

        <div style={{ display: "flex", gap: 6 }}>
          {module.slides.map((_, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i === slideIndex ? accent : "#30363d",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>

        {isLast ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onBack}
              style={{
                padding: "10px 20px",
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#8b949e",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              ← BACK TO LIBRARY
            </button>
            <button
              onClick={() => onLaunchScenario(module.scenario)}
              style={{
                padding: "10px 24px",
                background: accent,
                border: "none",
                borderRadius: 6,
                color: "#0d1117",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
            >
              LAUNCH SCENARIO
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSlideIndex((i) => Math.min(module.slides.length - 1, i + 1))}
            style={{
              padding: "10px 24px",
              background: accent,
              border: "none",
              borderRadius: 6,
              color: "#0d1117",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.2)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
          >
            NEXT →
          </button>
        )}
      </div>
    </div>
  );
}
