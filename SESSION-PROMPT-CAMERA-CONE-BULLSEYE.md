# Claude Code Session Prompt — Camera Cone + Bulls-eye Overlay

Read CLAUDE.md for full project context, then implement these two focused features:

---

## Feature 1: EO/IR Camera Tracking Cone on Tactical Map

When the operator slews the camera to a track, show a **triangular FOV cone** on the Leaflet tactical map originating from the camera's position and pointing toward the slewed track. This mirrors real GUARDIAN C2 and Cerberus behavior.

**Behavior:**
- When `slew_camera` is active (a track is being viewed in CameraPanel), draw a cone on the map from the EO/IR camera device position toward the slewed track
- Cone angle: ~30° wide (narrow targeting cone — this is an EO/IR, not a wide-area sensor)
- Cone length: matches the Nighthawk's range ring (8km), but clips at the actual range to the track
- Cone styling: semi-transparent yellow/amber fill with a yellow border — matches thermal camera aesthetic
- Cone updates every tick as the drone moves
- Cone disappears when the camera is no longer slewed (CameraPanel closed or track lost)

**Implementation notes:**
- The EO/IR Camera device position is already on the map — use its lat/lng as the cone origin
- Calculate bearing from camera to the slewed track's lat/lng
- Draw the cone as a Leaflet Polygon (triangle with the apex at camera, base at range)
- Add a thin yellow "line of sight" stroke from camera to track center
- Store slewed track ID in App.tsx state (it may already be there — check before adding)

**Keep it clean:** One cone, no label, no clutter. Just the cone.

---

## Feature 2: Bulls-eye Overlay (Toggle)

Add a **bulls-eye reference overlay** to the tactical map: concentric range rings with azimuth lines radiating from a center reference point. Operators use this for reporting ("threat at 270°, 3km from bulls-eye").

**Behavior:**
- Center point: defaults to the center of the placed base/assets on load (or map center if not deterministic)
- Operator can **right-click anywhere on the map** to "Set Bulls-eye Here" (add this to a small context menu or just a map right-click handler)
- Range rings: 1km, 2km, 3km, 5km, 10km — labeled on the rings
- Azimuth spokes: every 45° (8 spokes: N/NE/E/SE/S/SW/W/NW) — labeled at the outer ring
- Styling: thin, semi-transparent white lines with subtle labels — should NOT overpower the track icons
- Toggle button: add a small **"Bulls-eye"** toggle button in the HeaderBar or as a map control (similar to how range rings are toggled)
- Default: OFF (don't show until toggled on)

**Implementation notes:**
- Draw as Leaflet SVG overlays or Polygon/Polyline layers in a dedicated LayerGroup
- The bulls-eye LayerGroup is shown/hidden by the toggle
- Ring labels: small, white, positioned at due-East azimuth for each ring
- Spoke labels (N/NE/E etc.): at the outermost ring, rotated to match direction

**Keep it clean:** Subtle, thin lines. It should feel like a targeting grid overlay, not a graph.

---

## What NOT to change
- Do not modify CameraPanel rendering, backend logic, or scoring
- Do not add new actions to VALID_ACTION_NAMES
- Do not refactor existing map components — add to TacticalMap.tsx only

## Definition of Done
- Camera cone appears on map when camera is slewed, disappears when not
- Bulls-eye overlay can be toggled on/off from the UI
- Both features work without impacting existing functionality
- TypeScript compiles clean, no new console errors
