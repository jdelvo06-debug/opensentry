# OpenSentry

**Free, browser-based C-UAS training simulator.** Practice the full DTID kill chain (Detect → Track → Identify → Defeat) in a realistic tactical operations center — no install, no account, no clearance required.

**Target user:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

## 🚀 [Launch Simulator →](https://alfred-intel-handler-source.github.io/skyshield/)

> No install. No account. Just open the link and train.

**Version:** v1.2.0 | **Status:** Active development

---

## What Is This?

OpenSentry puts you in the seat of a C-UAS operator managing a real-time airspace picture. Contacts appear on your tactical map, you track them, identify them through the EO/IR camera, and decide how to respond — all under time pressure and within realistic Rules of Engagement.

Scoring is based on operational doctrine: detection speed, identification accuracy, countermeasure selection, ROE compliance, and proportionality. Not a game — a training tool.

---

## Scenarios

| Scenario | Duration | Description | Difficulty |
|----------|----------|-------------|------------|
| **Tutorial** | 5 min | Guided walkthrough — single contact, no waves | Beginner |
| **Lone Wolf** | 8 min | Single drone threat; build the kill chain start to finish | Easy |
| **Recon Probe** | 12 min | Multi-contact with trigger discipline — not everything gets engaged | Medium |
| **Swarm Attack** | 15 min | High-volume multi-wave with Shahed-style autonomous threat | Hard |

---

## Equipment

All systems are fictional but specification-accurate — no real program of record designators.

### Sensors
| System | Type | Range | Notes |
|--------|------|-------|-------|
| L-Band Multi-Mission Radar | Surveillance | 10 km | 360°, all-weather, primary detection |
| Ku-Band Fire Control Radar | Fire control | 10 km | Guides JACKAL interceptors |
| EO/IR Camera | Pan/tilt/zoom | 8 km | Thermal + daylight, slew-to-cue, visual ID |

### Effectors
| System | Type | Range | Notes |
|--------|------|-------|-------|
| RF/PNT Jammer | Electronic warfare | 5 km | Disrupts RF command links + GPS/PNT nav; rechargeable |
| JACKAL Pallet | Kinetic interceptor | 10 km | 4 interceptors; 10–15s spinup; requires Ku-Band FCS |
| SHINOBI | RF detect + Protocol Manipulation | 8km/6km | Downlink acquisition → uplink defeat (HOLD / LAND NOW / DEAFEN) |

### Threats
| Threat | RF Jam Resistance | Notes |
|--------|------------------|-------|
| Commercial Quad | 0% | Fully jammable; SHINOBI-vulnerable |
| Micro UAS | 10% | Small RCS; hard to visually ID |
| Fixed-Wing UAS | 40% | Faster; partially jam-resistant |
| Improvised UAS | 50% | Unknown electronics; SHINOBI library miss likely |
| Shahed-style | 100% (RF-immune) | INS-primary; **RF jamming has no effect**; kinetic defeat required |
| Bird / Balloon | — | Ambient traffic; cannot be engaged (ROE) |
| Passenger / Military Jet | — | ATC-clearable via CLEAR AIRSPACE |

---

## Scoring

| Category | Weight | Criteria |
|----------|--------|----------|
| Detection Awareness | 20% | Time from contact spawn to first operator click |
| Confirmation Quality | — | Rewards deliberate 3–15s confirmation; flags impulsive <2s |
| Tracking | 15% | Time and accuracy of contact tracking |
| Identification | 20% | Correct classification and affiliation |
| Defeat Method | 25% | Optimal vs. acceptable vs. poor countermeasure selection |
| ROE Compliance | 20% | Did you follow the rules of engagement? |
| Completion Multiplier | — | Penalty for ending mission early (<90% duration) |

**Grades:** S → A → B → C → F (base compromised)

---

## Features

- **Real-world satellite maps** via Leaflet.js — train at any location on Earth
- **Pre-mission ROE briefing** — review Rules of Engagement before each scenario
- **Neutral track labels** — contacts spawn as TRN-### until you identify them
- **Track type display** — classification and affiliation shown post-identification
- **Camera orientation** — aircraft rotate in the camera view based on viewing angle
- **Spawn randomization** — threat positions, headings, and speeds vary each run
- **Radial action wheel** — WOD-style engagement controls
- **Event log** — full engagement history, color-coded by severity
- **Debrief screen** — per-category scoring breakdown with letter grade

---

## Architecture

OpenSentry runs entirely in the browser — no server required.

```
src/game/           ← TypeScript game engine (10Hz, runs in browser)
  state.ts          ← All types + GameState factory
  loop.ts           ← Game tick, wave spawning, debrief builder
  drone.ts          ← 4 movement behaviors
  detection.ts      ← Multi-sensor detection (FOV, LOS, noise)
  jamming.ts        ← RF + PNT jamming logic
  shinobi.ts        ← SHINOBI protocol manipulation state machine
  jackal.ts         ← JACKAL interceptor lifecycle
  waves.ts          ← Wave + ambient traffic spawning
  scoring.ts        ← Full DTID scoring engine
  actions.ts        ← 16 player action handlers

frontend/src/
  App.tsx           ← State machine, phase transitions, doctrine loadouts
  hooks/
    useGameEngine.ts ← 10Hz game loop (browser-native, no WebSocket needed)
  components/       ← All UI components

frontend/public/data/
  scenarios/        ← JSON scenario definitions
  bases/            ← JSON base templates
  equipment/        ← Equipment catalog

backend/            ← Python/FastAPI reference implementation (kept, not required)
```

**Deploy:** `git push origin main` → GitHub Actions builds and deploys to GitHub Pages automatically.

---

## Local Development

```bash
cd frontend && npm run dev
# → http://localhost:5173
```

No Python backend required. The game engine runs entirely client-side via `useGameEngine.ts`.

---

## Roadmap

### Open Issues (v1.3+)
- [ ] **#10** — ATC coordination mechanic for unidentified tracks
- [ ] **#22** — Tablet-responsive layout (iPad landscape)

### Future
- After-action replay (timeline scrub on debrief)
- Terrain LOS checks
- Multi-operator / shared mission
- Community-contributed scenarios

---

## Feedback

Found a bug or have a training realism suggestion? Use the **feedback button** on the live site. Submissions go directly to the development queue.

---

## License

MIT — free to use, modify, and distribute for training purposes.

---

*OpenSentry was previously named SKYSHIELD. The GitHub repo URL (`/skyshield`) is unchanged to preserve the GitHub Pages link.*
