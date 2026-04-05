> **COMPLETED** — Implemented in PR #59 (2026-04-05). Tutorial now has two-phase UI tour + guided DTID practice with gated progression, step tracker, and feedback.
> This file is retained as design documentation.

# Claude Code Session Prompt — Tutorial Overhaul

Read CLAUDE.md for full project context, then overhaul the tutorial into a real step-by-step training experience.

---

## Goal
The tutorial should teach an E-5 with zero C-UAS experience how to run the full DTID kill chain. Currently it fires text banners that auto-dismiss. We need gated progression, UI spotlights, a persistent step tracker, and feedback on correct/incorrect decisions.

---

## Feature 1: Persistent Step Tracker (sidebar)

Replace the auto-dismissing banner with a persistent step tracker panel displayed on the left side of the screen during tutorial mode.

**Steps to display:**
1. DETECT — Wait for contact on tactical map
2. TRACK — Confirm the track (click CONFIRM TRACK)
3. SLEW — Slew camera to target (click SLEW CAMERA)
4. IDENTIFY — Classify threat type and affiliation
5. DEFEAT — Select and engage with appropriate effector
6. DEBRIEF — Review your score

**Styling:**
- Dark panel, monospace font, matches the rest of the UI
- Current step: highlighted in blue (#58a6ff), bold, with a pulsing dot indicator
- Completed steps: green checkmark (✓), muted color
- Future steps: greyed out, locked icon
- Small descriptive subtitle under each step label
- Panel sits above the existing sidebar (sensors/effectors list), or replaces it during tutorial

---

## Feature 2: UI Spotlights / Button Pulsing

When a step requires the operator to click a specific button, that button should pulse to draw attention.

**Implementation:**
- Add a CSS class `tutorial-pulse` with a glowing animation (box-shadow pulse in #58a6ff)
- Apply this class dynamically based on current tutorial step:
  - Step 2 (TRACK): pulse the `CONFIRM TRACK` button in EngagementPanel
  - Step 3 (SLEW): pulse the `SLEW CAMERA` button in EngagementPanel
  - Step 4 (IDENTIFY): pulse the classification buttons
  - Step 5 (DEFEAT): pulse the `ENGAGE` button
- Remove pulse class once the step is completed
- Pass `tutorialStep` as a prop to EngagementPanel so it knows what to highlight

---

## Feature 3: Gated Progression (drone waits for operator)

The tutorial drone should hold its position until the operator completes each step. It should not advance toward the base while the operator is still learning step 2.

**Backend change (app/main.py or a new tutorial_mode.py):**
- Add a `tutorial_step` field to GameState (int, 0-5)
- Add a `tutorial_gate_active` boolean to DroneState for the tutorial drone
- When `tutorial_gate_active` is True, drone velocity = 0 (holds position)
- Backend sends a `set_tutorial_gate` signal to frontend on each step
- Gate releases when the operator completes the required action
- Specifically:
  - Gate 1: releases when track is detected by sensors (automatic)
  - Gate 2: releases when player sends `confirm_track` action
  - Gate 3: releases when player sends `slew_camera` action
  - Gate 4: releases when player sends `identify` action
  - Gate 5: releases when player sends `engage` action
- Drone resumes normal approach speed once each gate releases

---

## Feature 4: Feedback on Wrong Decisions

If the operator makes a suboptimal or incorrect choice, show a brief inline callout (not a full modal — just a small tooltip/message near the relevant UI element).

**Cases to handle:**
- Player selects JACKAL (kinetic) instead of jammer for a commercial quad:
  Show: "JACKAL is overkill for a commercial quad — high collateral risk. Jammer is the optimal choice."
- Player classifies drone incorrectly:
  Show: "Incorrect classification. Check the camera feed — look at the silhouette shape."
- Player tries to engage before identifying:
  This is already blocked — no change needed.

**Implementation:**
- Small amber (#d29922) tooltip/callout that appears near the EngagementPanel
- Auto-dismisses after 6 seconds
- Does NOT fail the tutorial — just teaches and lets them proceed

---

## Feature 5: Camera Step (currently missing entirely)

The existing tutorial prompts skip camera slew. Add it as an explicit gated step between TRACK and IDENTIFY.

- After CONFIRM TRACK, the prompt says: "Track confirmed. Now slew the EO/IR Camera to get a visual on the target. Use the Radial Action Wheel (right-click the track) → SLEW CAMERA, or use the button in the Engagement Panel."
- Gate holds drone position until `slew_camera` action is received
- Once slewed, camera panel opens automatically and prompt continues: "Camera is locked on. Study the silhouette — this determines your classification. When ready, proceed to IDENTIFY."

---

## What NOT to change
- Do not modify debrief logic, scoring, or any non-tutorial scenario
- Do not add new action names to VALID_ACTION_NAMES (use existing `slew_camera`, `confirm_track`, `identify`, `engage`)
- Keep all existing tutorial_prompts in tutorial.json — they can be the fallback subtitle text

## Definition of Done
- Tutorial has 6 visible steps in a persistent sidebar panel
- Current step pulses the correct UI button
- Drone holds position at each gate until action is taken
- Camera slew is a required gated step
- Wrong effector choice shows inline feedback
- TypeScript compiles clean, no regressions on non-tutorial scenarios

---

When completely finished, run:
openclaw system event --text "Done: SKYSHIELD tutorial overhaul complete — gated progression, step tracker, spotlights" --mode now
