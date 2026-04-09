import React from "react";
import type { BdaStep } from "./types";
import { COLORS } from "./constants";

const STEPS = [
  { num: 1 as BdaStep, label: "BASE" },
  { num: 2 as BdaStep, label: "EQUIP" },
  { num: 3 as BdaStep, label: "PLACE" },
  { num: 4 as BdaStep, label: "EXPORT" },
];

interface Props {
  currentStep: BdaStep;
  completedSteps: Set<BdaStep>;
  onStepClick: (step: BdaStep) => void;
}

export default function BdaStepIndicator({ currentStep, completedSteps, onStepClick }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: "12px 16px",
        background: COLORS.card,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {STEPS.map((step, i) => {
        const isActive = step.num === currentStep;
        const isCompleted = completedSteps.has(step.num);
        const isClickable = isCompleted && step.num !== currentStep;

        return (
          <React.Fragment key={step.num}>
            {i > 0 && (
              <div
                style={{
                  width: 40,
                  height: 2,
                  background: completedSteps.has(STEPS[i - 1].num) ? COLORS.accent : COLORS.border,
                  margin: "0 4px",
                }}
              />
            )}
            <button
              onClick={() => isClickable && onStepClick(step.num)}
              disabled={!isClickable}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                cursor: isClickable ? "pointer" : "default",
                padding: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: isActive || isCompleted ? COLORS.accent : COLORS.border,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  color: isActive || isCompleted ? COLORS.bg : COLORS.muted,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {isCompleted && !isActive ? "✓" : step.num}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? COLORS.accent : isCompleted ? COLORS.accent : COLORS.muted,
                  letterSpacing: 0.5,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {step.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
