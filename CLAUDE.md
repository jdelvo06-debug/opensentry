# CLAUDE.md — SKYSHIELD Project Guide (Updated 2026-03-20)

## What Is This?
SKYSHIELD is a **free, browser-based C-UAS training simulator** designed to teach military operators the **DTID kill chain** (Detect → Track → Identify → Defeat). It's built to feel like a real FAAD C2 or Medusa workstation. No clearance required — purely training.

**Target User:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

**Vision:** Deployable worldwide so any military member can train C-UAS operations without needing real systems at their base.

## Current State (107 commits, ~18,600 lines)

### Equipment (Generic Band Names — No Real System Designators)
| System | Type | Range | Notes |
|--------|------|-------|-------|
| L-Band Multi-Mission Radar | Sensor | 10km | 360° surveillance radar |
| Ku-Band Fire Control Radar | Sensor | 8km | Fire control — required for JACKAL |
| EO/IR Camera | Sensor | 8km | Pan/tilt, 15° FOV, thermal + daylight |
| RF/PNT Jammer | Effector | 5km | Passive area suppression |
| JACKAL Pallet | Effector | 5km | 2 rounds max per scenario, 10-15s spinup |
| SHINOBI | Combined | 8km/6km | RF detect + protocol manipulation (HOLD/LAND/DEAFEN) |

### Drone Types
| Type | Jam Resistance | Notes |
|------|---------------|-------|
| commercial_quad | 0% | Fully jammable |
| micro | 10% | Small GPS receiver |
| fixed_wing | 40% | Basic autopilot |
| improvised | 50% | Unknown RF dependency |
| shahed | 100% | Autonomous INS, jam-immune — requires JACKAL |
| bird / weather_balloon | N/A | Ambient, cannot be cleared |
| passenger_aircraft / military_jet | N/A | Ambient, ATC-clearable |

### Core Features ✅
- **DTID Kill Chain** — Full detect → track → identify → defeat flow
- **EO/IR Camera** — Thermal + daylight modes, silhouettes drawn from `drone_type`. Drone types have distinct silhouettes: commercial_quad (Mavic-style), fixed_wing (delta), shahed (wide delta + pusher prop + V-tail), micro, bird, balloon, improvised
- **FAAD-style Hook Panel** — Bottom bar split: EVENT LOG (left, slim) + HOOK PANEL (right). Click any track to add a baseball card. Multiple tracks hookable simultaneously. Each card shows SPD/ALT/HDG/ETA/RNG/DTID/TYPE/RF. × to unhook per card.
- **Radial Action Wheel** — Animated open/close, DTID phase color theming
- **Tactical Map** — Leaflet.js + satellite, range rings default ON, bullseye default ON, engagement zone rings gated behind toggle
- **Range Rings** — Default ON at mission start; user can toggle off
- **Bullseye** — Default ON at mission start; user can toggle off
- **SHINOBI in COMBINED sidebar section** — No longer split across SENSORS/EFFECTORS; shown as single card under COMBINED
- **JAM ALL / CEASE JAMMING toggle** — Amber when ready, red when active; clicking while active ceases all jammers
- **CLEAR AIRSPACE** — Reroutes passenger/military aircraft 12km outbound on current bearing; suppresses new spawns 120s
- **Tutorial** — Zero ambient traffic, free drone movement, steps are guidance only
- **Custom Mission perimeter box** — Resizable rectangle with drag handles; correctly scales warning ring, protected ring, and base_radius_km

### Doctrine Loadouts (per scenario)
| Scenario | Sensors | Effectors | Note |
|----------|---------|-----------|------|
| Tutorial | L-Band + EO/IR | RF Jammer + SHINOBI | No JACKAL — learn basics |
| Lone Wolf | L-Band + Ku-Band + EO/IR | RF Jammer + 2× JACKAL + SHINOBI | Ku-Band required for JACKAL |
| Swarm Attack | L-Band + Ku-Band + 2× EO/IR | 2× RF Jammer + 2× JACKAL + 2× SHINOBI | High volume, RF saturation |
| Recon Probe | L-Band + Ku-Band + 2× EO/IR | RF Jammer + 1× JACKAL + SHINOBI | Surgical — ROE discipline |

**Doctrine rule:** Ku-Band FCS is always paired with JACKAL (fire control requirement). Shahed threats require kinetic defeat. Max 2 JACKALs per scenario.

### Game Flow
1. **Main Menu** → 2×2 scenario card grid (TUTORIAL / LONE WOLF / SWARM ATTACK / RECON PROBE) — each has LAUNCH button → straight into mission with doctrine loadout, no setup screens
2. **CUSTOM MISSION** → Scenario Select → Loadout → Placement (with resizable perimeter box) → Running → Debrief

### Scenario Spawn Data (Swarm Attack)
- bogey-5 (Shahed): spawns at 12km, 130kt — ~3 min ETA. Requires Ku-Band + JACKAL to defeat.

### Known Issues / TODO
- Custom Mission perimeter: visual confirmation could be cleaner (rings now scale correctly)
- Intermittent stuck bogey in Lone Wolf — root cause not confirmed
- SHINOBI `uplink_detected` never set in game loop — CM state can't transition 1/2 → 2/2 without it (needs detection loop trigger)
- Module-level `_evasive_state` dict in drone.py — shared across connections (blocks multiplayer)
- Phase 2 features (terrain LOS, planning score) — deferred

### Recently Fixed (2026-03-20 Opus Audit)
- ✅ SHINOBI CM state machine: pending→1/2 timing fixed (was ~9s, now ~1s)
- ✅ Coasting heading math: coordinate convention mismatch fixed (drones coast on correct bearing)
- ✅ Ambient aircraft exit: waypoint pushed to 15km so aircraft pass 12km cleanup
- ✅ 10Hz tick rate: enforced via tick budget (was drifting to ~7Hz under load)
- ✅ Scoring `should_engage`: no longer hard-coded True; ambient/friendly drones scored correctly
- ✅ `military_jet` classification: EngagementPanel + RadialActionWheel now send correct value
- ✅ `KTS_TO_KMS` constant: extracted to config.py, replaced 13 magic numbers
- ✅ Module renames: original prototype names updated to `shinobi.py` and `jackal.py`
- ✅ `IMPROVISED` jam resistance: explicit 50% in JAM_RESIST dict
- ✅ EventLog `as any` casts: removed, using typed fields

## Tech Stack
- **Backend:** FastAPI (Python 3.13), WebSocket at 10Hz tick rate
- **Frontend:** React 19, TypeScript, Vite, Leaflet.js, HTML5 Canvas
- **Maps:** OpenStreetMap satellite + CartoDB Dark Matter tiles (free)
- **Data:** JSON scenarios + base templates + equipment catalog

## Key File Structure

**Backend:**
- `app/main.py` — FastAPI app, WebSocket game loop, all action routing
- `app/models.py` — DroneState, GameState, ScenarioConfig (includes no_ambient flag)
- `app/actions.py` — All player action handlers including `handle_cease_jam`
- `app/jamming.py` — EW logic, JAM_RESIST dict per drone type
- `app/jackal.py` — JACKAL interceptor lifecycle (spinup, launch, midcourse, terminal, intercept, self-destruct)
- `app/shinobi.py` — SHINOBI protocol manipulation state machine (HOLD/LAND NOW/DEAFEN, CM state 1/2 → 2/2)
- `app/config.py` — Server config + shared constants (KTS_TO_KMS, CORS, rate limits)
- `app/waves.py` — Ambient spawn logic (AMBIENT_INTERVALS dict)
- `equipment/catalog.json` — All equipment definitions
- `scenarios/*.json` — lone_wolf, swarm_attack, recon_probe, tutorial

**Frontend:**
- `App.tsx` — State machine, WebSocket, all handlers, phase transitions; `hookedTrackIds` Set for hook panel; doctrine loadouts per scenario
- `components/TacticalMap.tsx` — Leaflet map, range rings (default ON), bullseye (default ON), 15° amber camera cone
- `components/CameraPanel.tsx` — Canvas EO/IR renderer; `drawShahed()` wide delta silhouette added
- `components/EngagementPanel.tsx` — DTID phase controls; SHINOBI CM submenu (HOLD/LAND NOW/DEAFEN); CM state progress bar (pending→1/2→2/2)
- `components/RadialActionWheel.tsx` — Right-click pie menu; SHINOBI CM submenu; all classification types including friendlies
- `components/EventLog.tsx` — Bottom bar: EVENT LOG (280px) + HOOK PANEL (flex); multi-card additive hook
- `components/HeaderBar.tsx` — JAM ALL ↔ CEASE JAMMING toggle; `onCeaseJam` prop
- `components/SensorPanel.tsx` — Filters `combined_sensor_*` from SENSORS section
- `components/EffectorPanel.tsx` — Shows `combined_effector_*` under COMBINED section
- `components/LoadoutScreen.tsx` — Equipment selection with COMBINED SYSTEMS section for SHINOBI
- `components/PlacementScreen.tsx` — Resizable perimeter box with drag handles; sends boundary + placement_bounds_km; map search
- `types.ts` — All TypeScript interfaces

## Valid Action Names (backend VALID_ACTION_NAMES)
`confirm_track`, `identify`, `engage`, `hold_fire`, `release_hold_fire`, `end_mission`, `slew_camera`, `shinobi_hold`, `shinobi_land_now`, `shinobi_deafen`, `jammer_toggle`, `jam_all`, `cease_jam`, `clear_airspace`, `pause_mission`, `resume_mission`

## Dev Server Notes
- Backend: `cd backend && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- Frontend: `cd frontend && npm run dev` (port 5173)
- **If frontend starts on 5174/5175**: `pkill -f vite` and restart

## Next Session — Priority Work
1. Investigate intermittent stuck bogey in Lone Wolf
2. Run full smoke test of Recon Probe end-to-end
3. Draft AFWERX/DIU one-pager for SKYSHIELD innovation submission
4. Consider: score system improvements, debrief detail, Phase 2 terrain LOS
