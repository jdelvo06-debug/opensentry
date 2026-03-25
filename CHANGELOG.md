# Changelog

All notable changes to OpenSentry are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/).

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
- **Nexus Scoring** — `nexus_pm` added to acceptable effectors for RF-emitting commercial drones. No longer penalized as a "poor choice."
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
- NEXUS countermeasure (protocol manipulation).
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
