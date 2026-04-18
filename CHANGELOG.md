# Changelog

All notable changes to OpenSentry are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Directed energy split** — Legacy directed-energy effector split into two distinct systems: `DE-LASER-3km` and `DE-HPM-3km`.
- **Directed energy pre-slew behavior** — Out-of-range DE engagement orders now pre-slew the effector onto the selected track instead of failing silently. Once on target, the system waits in `READY` until the operator fires in-range.
- **Directed energy aim-time model** — DE engagements now include a short slew/aim delay that increases for larger angle changes and faster crossing targets.
- **Persistent DE FOV wedges** — `DE-LASER-3km` and `DE-HPM-3km` render persistent, visually distinct cones on the tactical map.

### Changed
- **DE naming cleanup** — Shortened user-facing names to `DE-LASER-3km` and `DE-HPM-3km` across loadouts, scenarios, and engagement UI.
- **DE gameplay differentiation** — `DE-LASER-3km` is now the precision LOS weapon for single drones, while `DE-HPM-3km` is the non-LOS area-effect option for swarms.

### Fixed
- **Static-site loadout parity** — GitHub Pages/browser path now exposes DE systems in preset scenario doctrine loadouts, matching the intended PR behavior.
- **DE animation triggering** — Browser engagement animations now use current runtime state instead of stale closures, restoring laser/HPM visual effects.
- **Engagement feedback** — Rejected or pending DE engagements no longer appear as no-ops; UI feedback now surfaces `SLEWING`, LOS, and range status clearly.
- **Effector-facing state updates** — Runtime `facing_deg` now flows through browser state updates so DE cones visibly slew on the tactical map.
- **ROE scoring normalization** — Placement-generated DE effector IDs now score correctly for collateral and ROE checks.

---

## [1.9.0] — 2026-04-09

### Added
- **BDA v2 Stepper Refactor** (PR #3) — Refactored 2830-line monolith into 120-line stepper shell + 13 focused components in `components/bda/`.
- **Unified 4-step flow** — Base Selection → Equipment Selection → Placement & Viewshed → Export to Mission. Mirrors Custom Mission's UX pattern.
- **Enriched equipment cards** — LOS badge, range, FOV stats, +/- quantity controls with base limit enforcement.
- **Per-system coverage toggle** — Show/hide individual system viewsheds, range rings, FOV cones for gap analysis.
- **Map tile layer toggle** — Dark (CartoDB), Satellite (Esri), and Topo (OpenTopoMap) base layers.
- **Draggable base perimeter** — Vertex drag handles, midpoint insertion, right-click vertex deletion, area label.
- **Geo search on placement map** — Nominatim geocoding search bar overlaid on the map.
- **2m AGL preset** — Altitude slider minimum lowered to 2m with quick-preset button in LOW band.
- **Export location preservation** — Custom location coordinates flow through to the game engine so missions render at the correct real-world location.

### Fixed
- **Stale closure in setSystems wrapper** — Functional updates were operating on stale state, causing placed systems to vanish when viewshed loaded. Replaced wrapper with direct React setState dispatch.
- **Shenobi requires LOS** — Changed `requires_los` from false to true. RF detection is blocked by terrain.
- **RF Jammer requires LOS** — Changed `requires_los` from false to true. RF jamming energy is blocked by terrain.
- **Export to Iraq bug** — Custom location base templates now propagate through the export chain so the game renders at the correct coordinates.

---

## [1.8.0] — 2026-04-05

### Added
- **Interactive Tutorial Overhaul** (#58/59) — Two-phase tutorial: Phase 1 is a click-through UI tour overlay spotlighting every panel (TacticalMap, SensorPanel, TrackList, EngagementPanel, etc.); Phase 2 is a hands-on guided DTID walkthrough with gated drone progression, persistent step tracker sidebar, pulse highlights on target buttons, and inline amber feedback on suboptimal decisions.
- **Free Play Scenario** (#56/57) — Open sandbox mode with steady mixed-threat spawns, one of each system (L-Band, Ku-Band, EO/IR, RF Jammer, JACKAL, Shenobi), no mission timer. Operators end the mission when ready. Casual difficulty.
- **Base Defense Architect** (#54/55) — Standalone altitude-aware sensor placement tool with viewshed analysis, terrain line-of-sight ray casting, and coverage visualization on real satellite imagery. Uses actual equipment catalog systems. Accessible from main menu as "BASE DEFENSE ARCHITECT BETA."
- **Test suite** — vitest configured with 28 unit tests covering detection math, confidence calculation, drone movement, jamming behavior, segment intersection, and GameState factory.
- **CSS hover classes** — `app.css` with `.menu-btn` and `.footer-btn` classes replaces inline DOM style manipulation on main menu.

### Fixed
- **Tutorial stuck on step 2** — disabled auto-select behavior and routed all tutorial actions through the game engine to prevent gating logic from being bypassed.
- **Stale closures in ATC callbacks** — `callATC` and `tagFriendly` now use refs (`tracksRef`, `elapsedRef`) instead of capturing stale `tracks`/`elapsed` values. ATC response timestamps were showing the time of the *call*, not the *response*.
- **Negative detection probability** — `detect_radar` could produce negative probability when ratio > 1.0; now clamped with `Math.max(0, ...)`.
- **Viewshed ray casting algorithm** — corrected elevation angle calculation at low AGL for Base Defense Architect.
- **Stale closure in altitude/drag handlers** — BDA altitude changes and drag events now pass fresh values instead of stale extracted state.
- **`thermopylae` missing from server whitelist** — backend `VALID_SCENARIO_IDS` now includes the Thermopylae scenario.
- **`PlacementConfig.boundary` type missing** — added to game engine's `PlacementConfig` interface, eliminating all `as any` casts in `loop.ts`.
- **Sequential async fetches** — `useGameEngine` now loads base template and equipment catalog in parallel via `Promise.all()`.
- **Double type casts in loop.ts** — replaced `as unknown as Record<string, unknown>` with proper `isRfReading()` type guard for Shenobi RF detection.
- **Health endpoint version mismatch** — server reported v2.0.0 instead of actual version; corrected to 1.8.0.
- **Main menu scroll blocked** — removed overflow:hidden and height:100vh from body/#root; fixed grid overlay intercepting pointer events on smaller viewports.

### Changed
- **Tutorial now two-phase** — replaces auto-dismissing text banners with spotlight-style UI tour overlay followed by gated hands-on DTID practice.
- **DTID tutorial step order** — reordered to: Select → ATC → Slew → Confirm → Affiliate → Engage.
- **Tighter TypeScript types** — `shenobi_cm_state`, `shenobi_cm_active`, `jammed_behavior`, and `intercept_phase` narrowed from `string` to proper union types (`NexusCMState`, `NexusCMType`, `JammedBehavior`, `InterceptPhase`).
- **Trail array management standardized** — all files now use immutable `.slice(-20)` instead of mixed `splice`/`slice` patterns (jamming.ts, shenobi.ts).
- **Documentation updated** — SKYSHIELD references updated to OpenSentry in package.json descriptions, server health endpoint, and training curriculum.
- **Removed 5 `as unknown as` type casts** from `useGameEngine.ts` by aligning `PlacementConfig` types between frontend and game engine.

---

## [1.7.0] — 2026-04-04

### Added
- **MIL-STD-2525 Affiliation Mechanic** (#51/52) — Operators must now declare track affiliation (HOSTILE / NEUTRAL / FRIEND / UNKNOWN) as a mandatory step before defeat options unlock. Replaces implicit hostile assumption.
- **Affiliation Declaration UI** — Four affiliation buttons appear after classification. Selection collapses to a badge (`[ HOSTILE ▼ ]`) that can be re-expanded to change affiliation mid-engagement.
- **MIL-STD-2525 Color Coding** — Tracks, icons, and labels use standard symbology colors: UNKNOWN=yellow, SUSPECT=amber, HOSTILE=red, NEUTRAL=green, FRIEND=cyan.
- **Polygon Breach Detection** — Base perimeter polygon now used for precise breach detection via `pointInPolygon` algorithm. BASE COMPROMISED banner triggers on breach.
- **Base Boundary on Tactical Map** — Perimeter polygon rendered on the tactical map during gameplay.
- **Shahed Jam Immunity** — OW-UAS (Shahed-class) threats are now immune to RF/PNT jamming — reflects real-world INS/autonomous guidance. Operators must use kinetic or DE effectors.

### Changed
- **Track Detail Panel** — Compressed to 2-column data grid with max-height 280px. All telemetry visible without scrolling.
- **Engagement Panel** — Full sidebar height, no camera competing for space. All action buttons visible throughout DTID flow.
- **Camera Panel** — Relocated from right sidebar to bottom-right corner, sharing bottom row with EventLog.

### Fixed
- Classification buttons: all 9 types now start yellow (no affiliation bias before operator decision).
- SUSPECT/SUSPICIOUS tracks added to MIL-STD type system.

---

## [1.6.0] — 2026-04-01

### Added
- **Jamming Realism — ATTI Mode** (#47) — RF-jammed drones now transition to attitude-hold mode with degraded flight behavior instead of instant defeat.
- **Hardened FPV FHSS Mechanic** (#48) — Frequency-hopping spread spectrum resistance for FPV-class drones.

### Fixed
- Jamming/Shenobi lifecycle — tracks no longer vanish on jam/shenobi; fixed RF/PNT timer expiry logic and fall-through bug.
- Ghost tracks on radar — defeated drones no longer persist on tactical map; slew camera available on defeated tracks.
- Bird waypoint clustering behavior — corrected path generation.
- JACKAL silhouette redrawn (matte black missile, conical nose, canards, 4-fin tail).
- Renamed SHAHED-136 → OW-UAS in UI labels.
- Shenobi hold altitude oscillation — fixed tick priority ordering and descent-to-ground at 2/2.
- Shenobi no longer sets `dtid_phase=defeated` prematurely; Shenobi-active tracks remain interactive in UI.
- 7 game engine bugs: evasive state, jamming effectiveness, JACKAL dedup, scoring edge cases, Shenobi events.

---

## [1.5.0] — 2026-03-26

### Added
- **THERMOPYLAE Scenario** — Unscripted free-play exercise. Three escalating threat phases (RECON → BUILDUP → OVERWHELM) followed by endless mode. All threat types, bird false alarms, 20-min base duration. Operator ends the mission manually. Full debrief on completion.
- **Debrief Scorecard v2** — Post-scenario debrief screen with full performance metrics: per-category breakdown, ROE violation summary, effector economy rating, letter grade (S/A/B/C/F), and phase timeline.
- **C-UAS Training Library** — Standalone study module accessible from the main menu. Five-module slide-style curriculum (Foundation → Mastery), aligned to AFJQS 3CS and ATP 3-01.81. Covers DTID kill chain, ROE, threat discrimination, multi-threat management, and operator proficiency assessment.
- **Training Curriculum Reference Doc** — Full 5-module curriculum added to `docs/TRAINING-CURRICULUM.md`.

### Fixed
- ROE Briefing screen scroll bug — `minHeight: 100vh` was preventing scroll on scenarios with long ROE lists (THERMOPYLAE). Fixed to `height: 100vh` + `boxSizing: border-box`.

---

## [1.3.0] — 2026-03-25

### Added
- **ATC Coordination Mechanic** — ~15% of contacts spawn as UNKNOWN (yellow). Operators can call ATC for IFF clearance before engaging. ATC responds after a realistic 6–8s delay via a floating comms window (bottom-right of map). Engaging an UNKNOWN track without clearance triggers a Blue-on-Blue ROE penalty.
- **CALL ATC Action** — Available in the radial action wheel (right-click) and Engagement Panel for all UNKNOWN tracks.
- **Tag FRIENDLY Workflow** — After ATC confirms an authorized aircraft, operator must manually tag the track as FRIENDLY. No auto-update.
- **ATC Comms Panel** — Floating chat window showing outbound ops request (gray) and inbound ATC response (cyan, typewriter effect). Auto-dismisses 10s after last response. Per-track message history.
- **Blue-on-Blue Penalty** — Score deduction and red event log entry when engaging UNKNOWN tracks without ATC response.

### Changed
- All sensitive system designator references scrubbed from codebase and git history.

### Fixed
- Radial action wheel (WOD) not appearing on left-click — root cause traced to Leaflet marker event propagation conflict with tablet layout PR. Rolled main back to v1.2.0 baseline and rebuilt cleanly.

---

## [1.2.0] — 2026-03-22

### Added
- **ROE Pre-Briefing Screen** — Operators must review and acknowledge Rules of Engagement before each mission begins. ROE button in HeaderBar for mid-mission reference.
- **Neutral Track Labels** — All contacts spawn as `TRN-###` (unified counter). Track type and affiliation only revealed after operator identification.
- **Track Type Display** — After identification, track list and baseball card show formatted type (e.g. "Commercial Quad") and affiliation. Pre-ID shows `—`.
- **Spawn Variance** — Threat drones now spawn with randomized position, heading, and speed offsets. No two runs are identical.
- **Camera Orientation** — Aircraft in the camera view now rotate based on aspect angle relative to the camera. Head-on = compressed front profile; crossing = full side profile; tail-on = rear view.
- **Civilian Aircraft Color** — Passenger aircraft render as light grey in daylight mode, visually distinct from military contacts.

### Changed
- **Detection Scoring** — Replaced "speed-to-confirm" metric with two separate scores: *Detection Awareness* (time-to-first-click) and *Confirmation Quality* (rewards methodical 3–15s confirmation). Penalizing deliberate operators is now fixed.
- **Nexus Scoring** — `shenobi_pm` added to acceptable effectors for RF-emitting commercial drones. No longer penalized as a "poor choice."
- **Scenario Durations** — Tutorial: 5 min | Lone Wolf: 8 min | Recon Probe: 12 min | Swarm Attack: 15 min (previously all 2–3 min, cut off mid-engagement).
- **Early Exit Penalty** — Ending a mission early now applies a completion multiplier to the final score (≥90%=1.0, ≥70%=0.95, ≥50%=0.85, <50%=0.70).
- **Defense Planning Score** — Hidden in preset scenario debrief. Only shown in custom mission flow where the operator placed their own sensors/effectors.

### Fixed
- Mission timer was hardcoded to 30 minutes regardless of scenario — now reads `duration_seconds` from scenario JSON.
- Ghost track bug — defeated drones (JAMMED/RTH) persisted on the tactical map and blocked camera slew.
- Tutorial scenario was spawning wave enemies — should be a single-contact introductory scenario (`waves_enabled: false`).

---

## [1.1.0] — 2026-03-20

### Added
- Client-side game engine — full Python/FastAPI backend ported to TypeScript. No server required. Runs entirely in the browser.
- GitHub Pages deployment via GitHub Actions.
- Feedback modal (Formspree) — green button in landing page footer.
- Shenobi countermeasure (protocol manipulation).
- JACKAL interceptor pallet.
- EO/IR camera with slew-to-cue.
- Placement screen for custom mission sensor/effector layout.
- Debrief screen with full scoring breakdown.

### Changed
- Project renamed from SKYSHIELD → **OpenSentry**.
- All system designators genericized (no real equipment names).

---

## [1.0.0] — 2026-03-15

### Added
- Initial release — Python/FastAPI backend + React frontend.
- Three scenarios: Lone Wolf, Recon Probe, Swarm Attack.
- Basic DTID scoring: detection, tracking, identification, defeat, ROE.
- Radar tactical map (Leaflet.js).
- Wave engine with ambient traffic.
