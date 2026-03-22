interface Props {
  scenarioName: string;
  roeBriefing: string[];
  onConfirm: () => void;
  onBack: () => void;
}

export default function ROEBriefing({ scenarioName, roeBriefing, onConfirm, onBack }: Props) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d1117",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        color: "#e6edf3",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          width: "100%",
          padding: "0 24px",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#3fb950",
              letterSpacing: 2,
              marginBottom: 8,
            }}
          >
            RULES OF ENGAGEMENT
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {scenarioName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8b949e",
              marginTop: 8,
            }}
          >
            Review and acknowledge the following ROE before commencing the mission.
          </div>
        </div>

        {/* ROE List */}
        <div
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 24,
            marginBottom: 32,
          }}
        >
          {roeBriefing.map((rule, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                padding: "12px 0",
                borderBottom: i < roeBriefing.length - 1 ? "1px solid #21262d" : "none",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "rgba(63, 185, 80, 0.12)",
                  border: "1px solid rgba(63, 185, 80, 0.3)",
                  color: "#3fb950",
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <span
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "#e6edf3",
                  paddingTop: 2,
                }}
              >
                {rule}
              </span>
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <button
            onClick={onBack}
            style={{
              padding: "12px 32px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              letterSpacing: 1,
              border: "1px solid #30363d",
              borderRadius: 8,
              cursor: "pointer",
              background: "transparent",
              color: "#8b949e",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "#58a6ff";
              (e.currentTarget as HTMLElement).style.color = "#58a6ff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "#30363d";
              (e.currentTarget as HTMLElement).style.color = "#8b949e";
            }}
          >
            BACK
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "12px 32px",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
              letterSpacing: 1.5,
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              background: "#3fb950",
              color: "#0d1117",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.filter = "brightness(1.2)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(63, 185, 80, 0.3)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.filter = "none";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            I UNDERSTAND THE ROE — BEGIN MISSION
          </button>
        </div>
      </div>
    </div>
  );
}
