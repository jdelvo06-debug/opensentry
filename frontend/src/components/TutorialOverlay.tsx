import { useState, useEffect, useCallback, useRef } from "react";

// --- Tutorial Step Definitions ---

export interface TutorialStep {
  id: string;
  phase: "ui_tour" | "dtid_practice";
  title: string;
  description: string;
  targetId?: string; // matches data-tutorial-id on DOM element
  arrowSide?: "top" | "bottom" | "left" | "right"; // which side of tooltip the arrow points from
}

export const UI_TOUR_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    phase: "ui_tour",
    title: "Welcome to OpenSentry",
    description:
      "This tutorial will walk you through every panel on screen, then guide you through your first engagement. A slow drone is already airborne — let's learn the interface first.",
  },
  {
    id: "header",
    phase: "ui_tour",
    title: "Header Bar",
    description:
      "The top bar shows elapsed mission time, current threat level, and mission controls. You can pause, adjust audio, and end the mission from here.",
    targetId: "tutorial-header",
    arrowSide: "bottom",
  },
  {
    id: "sensors",
    phase: "ui_tour",
    title: "Sensor Panel",
    description:
      "Your active sensors are listed here — radar, EO/IR camera, and RF detection. Each shows its type, range, and current status.",
    targetId: "tutorial-sensors",
    arrowSide: "right",
  },
  {
    id: "effectors",
    phase: "ui_tour",
    title: "Effector Panel",
    description:
      "Your weapons and countermeasures. The RF Jammer disrupts drone control links. The Shenobi does protocol-level manipulation. Check status and cooldown timers here.",
    targetId: "tutorial-effectors",
    arrowSide: "right",
  },
  {
    id: "tracklist",
    phase: "ui_tour",
    title: "Track List",
    description:
      "Detected contacts appear here. Click a track to select it for inspection. Tracks are color-coded: yellow = unknown, red = hostile, green = friendly.",
    targetId: "tutorial-tracklist",
    arrowSide: "right",
  },
  {
    id: "map",
    phase: "ui_tour",
    title: "Tactical Map",
    description:
      "The main map shows your base, sensor coverage rings, and all detected tracks. Right-click a track for quick actions. Blue rings show engagement zones.",
    targetId: "tutorial-map",
    arrowSide: "left",
  },
  {
    id: "trackdetail",
    phase: "ui_tour",
    title: "Track Detail Panel",
    description:
      "When you select a track, its details appear here — position, altitude, speed, heading, which sensors are detecting it, and its current DTID status.",
    targetId: "tutorial-trackdetail",
    arrowSide: "left",
  },
  {
    id: "engagement",
    phase: "ui_tour",
    title: "Engagement Panel",
    description:
      "This is your action center. Confirm Track, Slew Camera, Identify, declare Affiliation, and Engage — the full DTID kill chain, in order. Buttons light up when available.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  {
    id: "camera",
    phase: "ui_tour",
    title: "Camera Panel",
    description:
      "The EO/IR camera feed. Slew it onto a target to get a visual — the silhouette helps you classify the drone type (quad, fixed-wing, etc.).",
    targetId: "tutorial-camera",
    arrowSide: "left",
  },
  {
    id: "radial_wheel",
    phase: "ui_tour",
    title: "Radial Action Wheel",
    description:
      "Right-click any track on the tactical map to open the Radial Action Wheel — a quick-access menu for Confirm Track, Slew Camera, Identify, Engage, and more. It's the fastest way to act on a contact without scrolling through panels.",
    targetId: "tutorial-map",
    arrowSide: "left",
  },
  {
    id: "engagement_flow",
    phase: "ui_tour",
    title: "The DTID Kill Chain",
    description:
      "Every contact follows the same flow: DETECT (sensors find it) → TRACK (you confirm it's real) → IDENTIFY (classify it and declare hostile/friendly) → DEFEAT (engage with the right effector). The engagement panel buttons guide you through this sequence. Unknown contacts must go through ATC clearance before engagement.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  {
    id: "effector_selection",
    phase: "ui_tour",
    title: "Choosing the Right Effector",
    description:
      "Match the effector to the threat. RF Jammer works on most commercial drones. Shenobi does protocol manipulation — hold, land, or deafen. JACKAL is a kinetic interceptor for jam-resistant targets like the Shahed. Using the wrong tool wastes resources and costs points.",
    targetId: "tutorial-effectors",
    arrowSide: "right",
  },
  {
    id: "eventlog",
    phase: "ui_tour",
    title: "Event Log",
    description:
      "A running log of everything that happens — detections, engagements, ROE events, and system messages. Color-coded by severity.",
    targetId: "tutorial-eventlog",
    arrowSide: "top",
  },
  {
    id: "tour_complete",
    phase: "ui_tour",
    title: "UI Tour Complete",
    description:
      "You've seen every panel. Now let's put it all together — a slow drone is approaching your base. Follow the DTID kill chain to detect, track, identify, and defeat it. The buttons will pulse blue when it's time to act.",
  },
];

// --- Component ---

interface Props {
  /** Current step index into UI_TOUR_STEPS */
  currentStep: number;
  /** Total steps for the counter display */
  totalSteps: number;
  /** Advance to next step */
  onNext: () => void;
  /** Go back one step */
  onBack: () => void;
  /** Called when the tour is finished */
  onComplete: () => void;
}

export default function TutorialOverlay({
  currentStep,
  totalSteps,
  onNext,
  onBack,
  onComplete,
}: Props) {
  const step = UI_TOUR_STEPS[currentStep];
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    arrowSide: string;
  } | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const positionTooltip = useCallback(() => {
    if (!step?.targetId) {
      // No target — center the tooltip on screen
      setTooltipPos({ top: 0, left: 0, arrowSide: "none" });
      setHighlightRect(null);
      return;
    }

    const el = document.querySelector(`[data-tutorial-id="${step.targetId}"]`);
    if (!el) {
      setTooltipPos({ top: 0, left: 0, arrowSide: "none" });
      setHighlightRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    const tooltipWidth = 360;
    const tooltipHeight = 200; // approximate
    const gap = 16;
    const side = step.arrowSide || "left";

    let top = 0;
    let left = 0;

    switch (side) {
      case "right":
        // Tooltip is to the RIGHT of the element, arrow points left
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + gap;
        break;
      case "left":
        // Tooltip is to the LEFT of the element, arrow points right
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - gap;
        break;
      case "bottom":
        // Tooltip is BELOW the element, arrow points up
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case "top":
        // Tooltip is ABOVE the element, arrow points down
        top = rect.top - tooltipHeight - gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - tooltipHeight - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

    setTooltipPos({ top, left, arrowSide: side });
  }, [step]);

  useEffect(() => {
    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    return () => window.removeEventListener("resize", positionTooltip);
  }, [positionTooltip]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (isLastStep) onComplete();
        else onNext();
      } else if (e.key === "ArrowLeft" && !isFirstStep) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isLastStep, isFirstStep, onNext, onBack, onComplete]);

  if (!step) return null;

  const isCentered = !step.targetId;

  // Arrow SVG based on side
  const renderArrow = () => {
    if (!tooltipPos || tooltipPos.arrowSide === "none") return null;
    const size = 10;
    const style: React.CSSProperties = { position: "absolute", width: 0, height: 0 };

    switch (tooltipPos.arrowSide) {
      case "right":
        // Arrow on LEFT side of tooltip, pointing left toward element
        Object.assign(style, {
          left: -size,
          top: "50%",
          transform: "translateY(-50%)",
          borderTop: `${size}px solid transparent`,
          borderBottom: `${size}px solid transparent`,
          borderRight: `${size}px solid #58a6ff`,
        });
        break;
      case "left":
        // Arrow on RIGHT side of tooltip, pointing right toward element
        Object.assign(style, {
          right: -size,
          top: "50%",
          transform: "translateY(-50%)",
          borderTop: `${size}px solid transparent`,
          borderBottom: `${size}px solid transparent`,
          borderLeft: `${size}px solid #58a6ff`,
        });
        break;
      case "bottom":
        // Arrow on TOP of tooltip, pointing up toward element
        Object.assign(style, {
          top: -size,
          left: "50%",
          transform: "translateX(-50%)",
          borderLeft: `${size}px solid transparent`,
          borderRight: `${size}px solid transparent`,
          borderBottom: `${size}px solid #58a6ff`,
        });
        break;
      case "top":
        // Arrow on BOTTOM of tooltip, pointing down toward element
        Object.assign(style, {
          bottom: -size,
          left: "50%",
          transform: "translateX(-50%)",
          borderLeft: `${size}px solid transparent`,
          borderRight: `${size}px solid transparent`,
          borderTop: `${size}px solid #58a6ff`,
        });
        break;
    }

    return <div style={style} />;
  };

  return (
    <>
      {/* Dimmed backdrop — but cut out a hole for the highlighted element */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          pointerEvents: "none",
        }}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <mask id="tutorial-mask">
              <rect width="100%" height="100%" fill="white" />
              {highlightRect && (
                <rect
                  x={highlightRect.left - 4}
                  y={highlightRect.top - 4}
                  width={highlightRect.width + 8}
                  height={highlightRect.height + 8}
                  rx={6}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.5)"
            mask="url(#tutorial-mask)"
          />
        </svg>

        {/* Highlight border around target */}
        {highlightRect && (
          <div
            style={{
              position: "fixed",
              top: highlightRect.top - 4,
              left: highlightRect.left - 4,
              width: highlightRect.width + 8,
              height: highlightRect.height + 8,
              border: "2px solid #58a6ff",
              borderRadius: 6,
              boxShadow: "0 0 20px rgba(88, 166, 255, 0.3)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: "fixed",
          zIndex: 9999,
          ...(isCentered
            ? {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
            : {
                top: tooltipPos?.top ?? 0,
                left: tooltipPos?.left ?? 0,
              }),
          width: 360,
          background: "#161b22",
          border: "1px solid #58a6ff",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(88, 166, 255, 0.15)",
          padding: "20px",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {!isCentered && renderArrow()}

        {/* Step counter */}
        <div
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: "#58a6ff",
            letterSpacing: 1.5,
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          {currentStep + 1} OF {totalSteps}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: 8,
          }}
        >
          {step.title}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 13,
            color: "#8b949e",
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          {step.description}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={onBack}
            disabled={isFirstStep}
            style={{
              background: "none",
              border: "1px solid #30363d",
              color: isFirstStep ? "#30363d" : "#8b949e",
              padding: "6px 16px",
              borderRadius: 6,
              cursor: isFirstStep ? "default" : "pointer",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Back
          </button>

          <span
            style={{
              fontSize: 10,
              color: "#484f58",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Arrow keys or Enter
          </span>

          <button
            onClick={isLastStep ? onComplete : onNext}
            style={{
              background: "#58a6ff",
              border: "none",
              color: "#0d1117",
              padding: "6px 20px",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {isLastStep ? "Start Practice" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
