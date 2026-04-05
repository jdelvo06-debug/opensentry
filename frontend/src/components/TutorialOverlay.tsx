import { useState, useEffect, useCallback, useRef } from "react";

// --- Tutorial Step Definitions ---

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  targetId?: string; // matches data-tutorial-id on DOM element
  arrowSide?: "top" | "bottom" | "left" | "right";
}

// Phase 1: UI Tour — user clicks Next/Back to advance
export const UI_TOUR_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to OpenSentry",
    description:
      "This tutorial will walk you through every panel on screen, then guide you through your first engagement. A slow drone is already airborne — let's learn the interface first.",
  },
  {
    id: "header",
    title: "Header Bar",
    description:
      "The top bar shows elapsed mission time, current threat level, and mission controls. You can pause, adjust audio, and end the mission from here.",
    targetId: "tutorial-header",
    arrowSide: "bottom",
  },
  {
    id: "sensors",
    title: "Sensor Panel",
    description:
      "Your active sensors are listed here — radar, EO/IR camera, and RF detection. Each shows its type, range, and current status.",
    targetId: "tutorial-sensors",
    arrowSide: "right",
  },
  {
    id: "effectors",
    title: "Effector Panel",
    description:
      "Your weapons and countermeasures. The RF Jammer disrupts drone control links. The Shenobi does protocol-level manipulation. Check status and cooldown timers here.",
    targetId: "tutorial-effectors",
    arrowSide: "right",
  },
  {
    id: "tracklist",
    title: "Track List",
    description:
      "Detected contacts appear here. Click a track to select it for inspection. Tracks are color-coded: yellow = unknown, red = hostile, green = friendly.",
    targetId: "tutorial-tracklist",
    arrowSide: "right",
  },
  {
    id: "map",
    title: "Tactical Map",
    description:
      "The main map shows your base, sensor coverage rings, and all detected tracks. Right-click a track for the Radial Action Wheel — a quick shortcut menu. Blue rings show engagement zones.",
    targetId: "tutorial-map",
    arrowSide: "left",
  },
  {
    id: "trackdetail",
    title: "Track Detail Panel",
    description:
      "When you select a track, its details appear here — position, altitude, speed, heading, which sensors are detecting it, and its current DTID status.",
    targetId: "tutorial-trackdetail",
    arrowSide: "left",
  },
  {
    id: "engagement",
    title: "Engagement Panel",
    description:
      "This is your action center. Confirm Track, Slew Camera, Identify, declare Affiliation, and Engage — the full DTID kill chain, in order. Buttons light up when available.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  {
    id: "camera",
    title: "Camera Panel",
    description:
      "The EO/IR camera feed. Slew it onto a target to get a visual — the silhouette helps you classify the drone type (quad, fixed-wing, etc.).",
    targetId: "tutorial-camera",
    arrowSide: "left",
  },
  {
    id: "eventlog",
    title: "Event Log",
    description:
      "A running log of everything that happens — detections, engagements, ROE events, and system messages. Color-coded by severity.",
    targetId: "tutorial-eventlog",
    arrowSide: "top",
  },
  {
    id: "tour_complete",
    title: "UI Tour Complete",
    description:
      "Now let's put it all together. A slow drone is approaching your base. We'll walk you through each step of the DTID kill chain — the buttons will pulse blue when it's time to act. You can also right-click the track on the map for a quick-action menu.",
  },
];

// Phase 2: DTID Practice — driven by game engine tutorialStep (0-7)
// These update automatically as the player performs each action.
// The overlay tells the player EXACTLY what to click next.
export const DTID_PRACTICE_STEPS: Record<number, TutorialStep> = {
  0: {
    id: "dtid_waiting",
    title: "Step 1: Detect",
    description:
      "Sensors are scanning... wait for a contact to appear in the Track List on the left. The radar will pick it up automatically.",
    targetId: "tutorial-tracklist",
    arrowSide: "right",
  },
  1: {
    id: "dtid_select",
    title: "Step 1: Click the Track",
    description:
      "A contact just appeared! Click it in the Track List to select it. You can also click the dot on the Tactical Map. Once selected, its details will show on the right side.",
    targetId: "tutorial-tracklist",
    arrowSide: "right",
  },
  2: {
    id: "dtid_atc",
    title: "Step 2: Call ATC",
    description:
      "Good — you've selected the contact. Before engaging an unknown track, call ATC for an IFF check. Click the CALL ATC button in the Engagement Panel. ATC will respond in a few seconds telling you if this contact is in their system.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  3: {
    id: "dtid_slew",
    title: "Step 3: Slew Camera",
    description:
      "ATC is working on it. While you wait, slew your EO/IR camera onto the target. Click the SLEW CAMERA button. Watch the Camera Panel in the bottom-right — you'll see a silhouette of the drone.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  4: {
    id: "dtid_confirm_identify",
    title: "Step 4: Confirm Track & Identify",
    description:
      "Camera is locked on. Click CONFIRM TRACK to start monitoring, then classify the drone using the buttons below. Look at the silhouette — this is a commercial quadcopter. You can also right-click the track on the map for the Radial Action Wheel.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  5: {
    id: "dtid_affiliate",
    title: "Step 5: Declare Affiliation",
    description:
      "Contact classified. Now declare it HOSTILE — click the HOSTILE button. ATC confirmed this track is not in their system, so it's an unauthorized UAS in your airspace.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  6: {
    id: "dtid_engage",
    title: "Step 6: Engage!",
    description:
      "Target confirmed hostile. Select an effector and click ENGAGE. The RF Jammer is the best choice for a commercial quad — proportional and effective. JACKAL works but is overkill. Try the Engagement Panel or right-click the track for the Radial Action Wheel.",
    targetId: "tutorial-engagement",
    arrowSide: "left",
  },
  7: {
    id: "dtid_complete",
    title: "Target Neutralized!",
    description:
      "Outstanding work. You completed the full DTID kill chain: Detect → Track → Identify → Defeat. The debrief screen will show your score. Remember: call ATC for unknowns, match the effector to the threat, and follow ROE.",
  },
};

// --- Tooltip positioning logic (shared between both phases) ---

function useTooltipPosition(step: TutorialStep | undefined) {
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    arrowSide: string;
  } | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const positionTooltip = useCallback(() => {
    if (!step?.targetId) {
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
    const tooltipHeight = 200;
    const gap = 16;
    const side = step.arrowSide || "left";

    let top = 0;
    let left = 0;

    switch (side) {
      case "right":
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + gap;
        break;
      case "left":
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - gap;
        break;
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case "top":
        top = rect.top - tooltipHeight - gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
    }

    top = Math.max(8, Math.min(top, window.innerHeight - tooltipHeight - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

    setTooltipPos({ top, left, arrowSide: side });
  }, [step]);

  useEffect(() => {
    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    return () => window.removeEventListener("resize", positionTooltip);
  }, [positionTooltip]);

  return { tooltipPos, highlightRect };
}

// --- Arrow renderer ---

function TooltipArrow({ arrowSide }: { arrowSide: string }) {
  if (arrowSide === "none") return null;
  const size = 10;
  const style: React.CSSProperties = { position: "absolute", width: 0, height: 0 };

  switch (arrowSide) {
    case "right":
      Object.assign(style, {
        left: -size, top: "50%", transform: "translateY(-50%)",
        borderTop: `${size}px solid transparent`,
        borderBottom: `${size}px solid transparent`,
        borderRight: `${size}px solid #58a6ff`,
      });
      break;
    case "left":
      Object.assign(style, {
        right: -size, top: "50%", transform: "translateY(-50%)",
        borderTop: `${size}px solid transparent`,
        borderBottom: `${size}px solid transparent`,
        borderLeft: `${size}px solid #58a6ff`,
      });
      break;
    case "bottom":
      Object.assign(style, {
        top: -size, left: "50%", transform: "translateX(-50%)",
        borderLeft: `${size}px solid transparent`,
        borderRight: `${size}px solid transparent`,
        borderBottom: `${size}px solid #58a6ff`,
      });
      break;
    case "top":
      Object.assign(style, {
        bottom: -size, left: "50%", transform: "translateX(-50%)",
        borderLeft: `${size}px solid transparent`,
        borderRight: `${size}px solid transparent`,
        borderTop: `${size}px solid #58a6ff`,
      });
      break;
  }

  return <div style={style} />;
}

// --- Shared backdrop + highlight + tooltip shell ---

function TutorialTooltipShell({
  step,
  tooltipPos,
  highlightRect,
  counterText,
  children,
  allowClickThrough,
}: {
  step: TutorialStep;
  tooltipPos: { top: number; left: number; arrowSide: string } | null;
  highlightRect: DOMRect | null;
  counterText: string;
  children: React.ReactNode;
  allowClickThrough?: boolean;
}) {
  const isCentered = !step.targetId;

  return (
    <>
      {/* Dimmed backdrop with cutout */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          pointerEvents: allowClickThrough ? "none" : "auto",
        }}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
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
            fill={allowClickThrough ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.5)"}
            mask="url(#tutorial-mask)"
            style={{ pointerEvents: "none" }}
          />
        </svg>

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
        style={{
          position: "fixed",
          zIndex: 9999,
          ...(isCentered
            ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
            : { top: tooltipPos?.top ?? 0, left: tooltipPos?.left ?? 0 }),
          width: 360,
          background: "#161b22",
          border: "1px solid #58a6ff",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(88, 166, 255, 0.15)",
          padding: "20px",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {!isCentered && tooltipPos && <TooltipArrow arrowSide={tooltipPos.arrowSide} />}

        {/* Counter */}
        <div style={{
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          color: "#58a6ff",
          letterSpacing: 1.5,
          marginBottom: 8,
          fontWeight: 600,
        }}>
          {counterText}
        </div>

        {/* Title */}
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3", marginBottom: 8 }}>
          {step.title}
        </div>

        {/* Description */}
        <div style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.6, marginBottom: 16 }}>
          {step.description}
        </div>

        {children}
      </div>
    </>
  );
}

// ====================
// Phase 1: UI Tour
// ====================

interface TourProps {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onBack: () => void;
  onComplete: () => void;
}

export function TutorialTourOverlay({
  currentStep,
  totalSteps,
  onNext,
  onBack,
  onComplete,
}: TourProps) {
  const step = UI_TOUR_STEPS[currentStep];
  const { tooltipPos, highlightRect } = useTooltipPosition(step);

  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

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

  return (
    <TutorialTooltipShell
      step={step}
      tooltipPos={tooltipPos}
      highlightRect={highlightRect}
      counterText={`UI TOUR — ${currentStep + 1} OF ${totalSteps}`}
    >
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

        <span style={{
          fontSize: 10,
          color: "#484f58",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
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
    </TutorialTooltipShell>
  );
}

// ====================
// Phase 2: DTID Practice Guide
// ====================

interface PracticeProps {
  /** The game engine's current tutorial step (0-7) */
  gameStep: number;
}

export function TutorialPracticeOverlay({ gameStep }: PracticeProps) {
  const step = DTID_PRACTICE_STEPS[gameStep];
  const { tooltipPos, highlightRect } = useTooltipPosition(step);
  const prevStepRef = useRef(gameStep);

  // Re-position when game step changes
  useEffect(() => {
    prevStepRef.current = gameStep;
  }, [gameStep]);

  if (!step) return null;

  return (
    <TutorialTooltipShell
      step={step}
      tooltipPos={tooltipPos}
      highlightRect={highlightRect}
      counterText={`DTID PRACTICE — STEP ${Math.min(gameStep + 1, 7)} OF 7`}
      allowClickThrough={true}
    >
      <div style={{
        fontSize: 11,
        color: "#58a6ff",
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: 0.5,
        opacity: 0.8,
      }}>
        {gameStep < 7
          ? "Perform the action — the guide will advance automatically"
          : "Mission complete!"}
      </div>
    </TutorialTooltipShell>
  );
}

// Default export for backward compat
export default TutorialTourOverlay;
