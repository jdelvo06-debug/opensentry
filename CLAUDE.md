# CLAUDE.md — SKYSHIELD Project Context

## What Is This?
SKYSHIELD is an open-source, browser-based Counter-UAS (C-UAS) training simulator. It puts the player in a tactical operations center, working through the **DTID kill chain** (Detect → Track → Identify → Defeat) against drone threats. Unclassified, but designed to feel like a real C2 workstation.

## Tech Stack
- **Backend:** Python 3.13 / FastAPI / WebSocket (real-time at 10Hz tick rate)
- **Frontend:** React 19 / TypeScript / Vite / HTML5 Canvas (tactical map)
- **Data:** JSON scenario files in `backend/scenarios/`
- **Deployment:** Docker Compose or `make dev` for local

## Architecture

```
frontend/                  # React + Vite + TypeScript
  src/
    App.tsx                # Main app — game state machine (scenario_select → loadout → placement → running → debrief)
    types.ts               # All TypeScript types/interfaces for WebSocket messages + equipment + bases
    hooks/
      useWebSocket.ts      # WebSocket connection hook
    components/
      TacticalMap.tsx      # HTML5 Canvas — dark tactical map, MIL-STD-2525 icons, range rings, trails
      HeaderBar.tsx        # Mission clock, threat level (GREEN→RED), scenario name
      SensorPanel.tsx      # Left sidebar top — sensor status (Radar, RF, EO/IR, Acoustic)
      EffectorPanel.tsx    # Left sidebar bottom — countermeasure readiness
      TrackDetailPanel.tsx # Right sidebar — selected track info + DTID phase progress
      EngagementPanel.tsx  # Right sidebar — action buttons based on current DTID phase
      EventLog.tsx         # Bottom bar — timestamped mission events
      DebriefScreen.tsx    # Post-mission scoring overlay
      ScenarioSelect.tsx   # Scenario + base template selection screen
      LoadoutScreen.tsx    # Equipment selection (sensors + effectors from catalog)
      PlacementScreen.tsx  # Drag-and-drop sensor/effector placement on base map (1500 lines)
      CameraPanel.tsx      # EO/IR camera simulation — thermal silhouettes for visual ID (590 lines)

backend/
  app/
    main.py                # FastAPI app + WebSocket game loop
    models.py              # Pydantic models — DTIDPhase, Affiliation, DroneState, ScenarioConfig, etc.
    scenario.py            # Loads JSON scenario files from backend/scenarios/
    scoring.py             # DTID scoring engine (5 categories, S/A/B/C/F grades)
    drone.py               # Drone movement behaviors (direct_approach, etc.)
    detection.py           # Multi-sensor simulation (radar, RF, EO/IR, acoustic)
  scenarios/
    lone_wolf.json         # Single commercial quad, beginner difficulty
  bases.py                 # Load base templates from backend/bases/
  bases/
    small_fob.json         # Compact FOB — tight perimeter, 2 protected assets
    medium_airbase.json    # Airbase with runway, hangars, ATC tower
    large_installation.json # Major installation, multiple assets, complex terrain
  equipment/
    catalog.json           # Full equipment catalog — 5 sensors + 10 effectors with stats
```

## Kill Chain: DTID
This is the core gameplay loop. Every decision flows through these four phases:

1. **DETECT** — Track appears as UNKNOWN (yellow square). Radar picks it up. Limited info.
2. **TRACK** — Player clicks "Confirm Track." Multiple sensors correlate. Confidence grows. More data flows in (altitude, speed, heading, bearing).
3. **IDENTIFY** — Player classifies threat type (commercial_quad, fixed_wing, micro, bird, weather_balloon, improvised) and sets affiliation (hostile, friendly, neutral). Icon changes color based on affiliation.
4. **DEFEAT** — Player selects countermeasure and engages. Backend calculates effectiveness. Outcome displayed.

**Do NOT add AI-suggested responses or hints.** The player makes all decisions independently. This is a training tool, not easy mode.

## MIL-STD-2525 Symbology (Simplified)
- **UNKNOWN** = yellow square
- **HOSTILE** = red diamond
- **FRIENDLY** = blue rectangle
- **NEUTRAL** = green square
- Track tails show flight path history
- Speed leader lines show projected trajectory

## Sensor Types
Each sensor provides different data and has different range:
- **RADAR** — Best range. Provides range, altitude, speed, heading. Always-on detection.
- **RF DETECTOR** — Medium range. Only detects RF-emitting drones. Provides bearing. Identifies protocol.
- **EO/IR CAMERA** — Short range. Provides visual classification hints (silhouette type).
- **ACOUSTIC** — Very short range. Detects all drones by sound. Provides bearing.

## Effector Types
- **RF JAMMER** — Effective vs commercial quads. Rechargeable (10s). Low collateral.
- **KINETIC** — Effective vs all. Single-use. ROE violation in Lone Wolf scenario.
- **INTERCEPTOR DRONE** — Good vs quads/small. Single-use. Low collateral.
- **DIRECTED ENERGY** — Effective vs all. Rechargeable (15s). Short range. LOS required.

## Scoring System (5 categories)
| Category | Weight | What It Measures |
|----------|--------|-----------------|
| Detection Response | 20% | How fast player confirmed track after detection |
| Tracking | 15% | Did player let sensors build confidence before ID? |
| Identification | 25% | Correct classification + correct affiliation |
| Defeat Method | 25% | Optimal vs acceptable vs poor effector choice |
| ROE Compliance | 15% | Did player violate rules of engagement? |

Grades: S (≥95) → A (≥85) → B (≥70) → C (≥50) → F

## UI Layout — Single Pane of Glass
The interface follows real C2 system patterns (Lattice, FAAD C2, Medusa, DroneSentry):

```
┌──────────────────────────────────────────────────────┐
│  HEADER: Mission clock │ Threat level │ ROE status   │
├────────────┬─────────────────────────┬───────────────┤
│  SENSOR    │                         │  TRACK        │
│  STATUS    │    TACTICAL MAP         │  DETAIL       │
│  PANEL     │                         │  PANEL        │
│            │  (dark theme, tracks,   │               │
│            │   range rings, trails)  │               │
├────────────┤                         ├───────────────┤
│  EFFECTOR  │                         │  ENGAGEMENT   │
│  STATUS    │                         │  PANEL        │
├────────────┴─────────────────────────┴───────────────┤
│  EVENT LOG: Timestamped mission events               │
└──────────────────────────────────────────────────────┘
```

## WebSocket Protocol
Client → Server:
- `{"type": "start", "scenario_id": "lone_wolf"}` — Start scenario
- `{"type": "action", "action": "confirm_track", "target_id": "bogey-1"}` — Confirm track (DETECT→TRACK)
- `{"type": "action", "action": "identify", "target_id": "bogey-1", "classification": "commercial_quad", "affiliation": "hostile"}` — Identify (TRACK→IDENTIFY)
- `{"type": "action", "action": "engage", "target_id": "bogey-1", "effector": "jammer"}` — Engage (IDENTIFY→DEFEAT)
- `{"type": "restart"}` — Restart scenario

Server → Client:
- `game_start` — Scenario loaded, sensor/effector configs
- `state` — 10Hz game state updates (tracks, sensors, effectors, elapsed time)
- `event` — Timestamped mission log events
- `engagement_result` — Outcome of an engagement action
- `debrief` — Final score breakdown

## Adding New Scenarios
1. Create a JSON file in `backend/scenarios/` following `lone_wolf.json` format
2. Define drones (type, start position, behavior), sensors, effectors, engagement zones
3. Set `correct_classification`, `correct_affiliation`, `optimal_effectors`, `roe_violations`
4. The scenario engine auto-discovers all JSON files in the directory

## Drone Behaviors
Currently implemented:
- `direct_approach` — Flies straight toward base (0,0)

Planned:
- `orbit` — Circles at standoff range
- `coordinated` — Multi-drone coordinated approach

## Design Principles
- **Dark theme throughout** — Dark backgrounds (#0d1117, #161b22), subtle borders (#30363d)
- **Professional C2 aesthetic** — Inspired by Anduril Lattice, not arcade games
- **Clean, modern UI** — Consumer-web-app feel, not 1990s military terminal
- **Color-coded status** — Green=ready/active, Yellow=warning, Orange=caution, Red=critical/hostile
- **No unnecessary animation** — Radar sweep is subtle, data updates are clean

## Development
```bash
make install    # Install Python + Node dependencies
make dev        # Start backend :8000 + frontend :5173
```

Or manually:
```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev
```

## OPSEC
- ALL scenarios use unclassified, publicly available threat data
- No real unit names, locations, or TTPs
- Drone behaviors based on commercial UAS specs (DJI, Autel, etc.)
- Countermeasure effectiveness based on published vendor data
- When in doubt, sanitize harder

## Training Flow (Cradle-to-Grave)
The complete user flow:
1. **SELECT SCENARIO** — Choose scenario (Lone Wolf, etc.) + base template (FOB, Airbase, Installation)
2. **EQUIP** — Select sensors and effectors from the equipment catalog
3. **PLAN** — Drag-and-drop place equipment on the base map, review coverage arcs/gaps
4. **EXECUTE** — Run the DTID mission with your planned defense layout
5. **DEBRIEF** — Score on both planning quality AND execution quality

## EO/IR Camera Panel
- Modal overlay with thermal/HUD aesthetic for visual drone identification
- Canvas-drawn silhouettes: commercial quad, fixed-wing, micro, bird, weather balloon, improvised
- Range-based clarity (closer = sharp, farther = grainy with noise)
- Crosshairs, targeting data HUD, zoom indicator
- Only available when target is within camera FOV (based on placement direction)

## Equipment Catalog
Stored in `backend/equipment/catalog.json`. Each item has: name, type, range_km, fov_deg, description, pros, cons, requires_los, collateral_risk (effectors), recharge_seconds, single_use.

## Base Templates
Stored in `backend/bases/` as JSON. Each has: boundary polygon, protected_assets (name, position, priority), terrain features (buildings, towers, berms, treelines with LOS blocking), approach corridors.

## Current Status
- Phase 1 MVP complete — Lone Wolf scenario playable end-to-end
- Phase 2 complete — Equipment loadout, base defense planner, EO/IR camera panel, full training flow
- DTID kill chain implemented
- Tactical map with MIL-STD-2525-lite symbology
- Sensor fusion and effector management
- Scoring and debrief system (planning + execution)
- 3 base templates, full equipment catalog

## Roadmap
- Phase 3: Multi-track scenarios, tutorial flow, placement UI polish, camera silhouette refinement
- Phase 4: Multiplayer, community scenarios, Docker deployment, mobile support
