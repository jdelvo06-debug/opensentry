interface Props {
  tutorialStep: number;
}

const STEPS = [
  { num: 1, label: "DETECT", subtitle: "Wait for contact on tactical map" },
  { num: 2, label: "SELECT", subtitle: "Click the track to inspect it" },
  { num: 3, label: "CALL ATC", subtitle: "Request IFF check for unknown contact" },
  { num: 4, label: "SLEW & ID", subtitle: "Slew camera, confirm track, classify" },
  { num: 5, label: "AFFILIATE", subtitle: "Declare HOSTILE / NEUTRAL / FRIENDLY" },
  { num: 6, label: "DEFEAT", subtitle: "Select effector and engage" },
  { num: 7, label: "DEBRIEF", subtitle: "Review your score" },
];

export default function TutorialStepTracker({ tutorialStep }: Props) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid #30363d",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "#58a6ff",
          letterSpacing: 2,
          marginBottom: 10,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        TUTORIAL — DTID KILL CHAIN
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {STEPS.map((step) => {
          const isCompleted = tutorialStep > step.num;
          const isCurrent = tutorialStep === step.num;
          const isFuture = tutorialStep < step.num;

          return (
            <div
              key={step.num}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "4px 6px",
                borderRadius: 4,
                background: isCurrent ? "rgba(88, 166, 255, 0.08)" : "transparent",
              }}
            >
              {/* Status indicator */}
              <div
                style={{
                  width: 16,
                  height: 16,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {isCompleted ? (
                  <span
                    style={{
                      color: "#3fb950",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                ) : isCurrent ? (
                  <span
                    className="tutorial-pulse-dot"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#58a6ff",
                      display: "inline-block",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      color: "#484f58",
                      fontSize: 10,
                    }}
                  >
                    ○
                  </span>
                )}
              </div>

              {/* Step label + subtitle */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCompleted
                      ? "#3fb950"
                      : isCurrent
                        ? "#58a6ff"
                        : "#484f58",
                    letterSpacing: 0.5,
                    opacity: isCompleted ? 0.7 : 1,
                  }}
                >
                  {step.num}. {step.label}
                </div>
                {(isCurrent || isCompleted) && (
                  <div
                    style={{
                      fontSize: 9,
                      color: isCurrent ? "#8b949e" : "#484f58",
                      fontFamily: "'Inter', sans-serif",
                      marginTop: 1,
                      lineHeight: 1.3,
                    }}
                  >
                    {step.subtitle}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
