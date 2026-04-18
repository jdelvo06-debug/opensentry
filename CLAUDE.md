# CLAUDE.md — OpenSentry Project Guide (Updated 2026-04-18)

## What Is This?
OpenSentry is a **free, browser-based C-UAS training simulator** designed to teach military operators the **DTID kill chain** (Detect → Track → Identify → Defeat). It's built to emulate real-world C-UAS command and control systems. No clearance required — purely training.

**Target User:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

**Live URL:** https://jdelvo06-debug.github.io/opensentry/
**Repo:** https://github.com/jdelvo06-debug/opensentry

---

## Architecture (as of 2026-04-09)

### Stack
- **Frontend:** React 19, TypeScript, Vite, Leaflet.js, HTML5 Canvas
- **Game Engine:** Pure TypeScript, runs entirely in the browser (`src/game/*.ts`)
- **No backend server required** — static site, deployable to GitHub Pages / Netlify / USB drive
- **Deployment:** GitHub Actions → GitHub Pages (auto-deploys on push to main)

### How It Works
The game loop runs in the browser via `setInterval` at 10Hz. `useGameEngine.ts` replaces the old WebSocket hook — same interface, no server. Scenario/base/equipment JSON is fetched from `/data/` (static files in `frontend/public/data/`).

### Key Directories
```
frontend/                   ← React app (the game UI)
  src/
    App.tsx                 ← Main state machine, phase transitions, doctrine loadouts
    app.css                 ← CSS hover classes for main menu buttons
    hooks/useGameEngine.ts  ← 10Hz game loop in browser (replaces WebSocket)
    hooks/useWebSocket.ts   ← Legacy hook (kept for local dev with Python backend)
    components/             ← All UI components
      bda/                  ← Base Defense Architect v2 (stepper flow)
        BdaStepIndicator.tsx, BdaBaseSelection.tsx, BdaEquipmentSelection.tsx
        BdaPlacement.tsx, BdaExport.tsx
        types.ts, constants.ts, viewshed.ts
        components/         ← BDA sub-components (palette, markers, detail panel, etc.)
    types.ts                ← TypeScript interfaces for all ServerMessage types
    __tests__/              ← vitest unit tests for game engine
  public/data/              ← Static JSON data (served on GitHub Pages)
    scenarios/              ← lone_wolf.json, swarm_attack.json, recon_probe.json, tutorial.json, thermopylae.json, free_play.json + index.json
    bases/                  ← small_fob.json, medium_airbase.json, large_installation.json + index.json
    equipment/catalog.json  ← All equipment definitions

src/game/                   ← TypeScript game engine (ported from Python)
  state.ts                  ← All types/interfaces + GameState factory
  helpers.ts                ← Constants, effectiveness matrix, sensor/effector builders
  drone.ts                  ← 4 movement behaviors (direct, orbit, waypoint, evasive)
  jamming.ts                ← RF + PNT jamming, resistance tables, drift tick
  shenobi.ts                ← Shenobi CM state machine (pending→1/2→2/2)
  jackal.ts                 ← JACKAL lifecycle (spinup→launch→midcourse→terminal)
  detection.ts              ← Multi-sensor detection with FOV, LOS, noise
  waves.ts                  ← Wave generation + ambient traffic spawning
  scoring.ts                ← DTID scoring engine + placement scoring
  actions.ts                ← All 16 player action handlers
  loop.ts                   ← 10Hz tick functions, game_start/state/debrief builders

backend/                    ← Python/FastAPI reference implementation (DO NOT DELETE)
  app/                      ← Original Python source — still works for local dev
  scenarios/                ← Shared data (frontend/public/data copies from here)
  bases/
  equipment/

.github/workflows/deploy.yml ← GitHub Actions: build frontend → deploy to Pages
```

---

## Equipment (All generic — no real system designators)

| System | Catalog ID | Type | Range | LOS | Notes |
|--------|-----------|------|-------|-----|-------|
| L-Band Multi-Mission Radar | `tpq51` | Sensor | 10km | Yes | 360° surveillance |
| Ku-Band Fire Control Radar | `kufcs` | Sensor | 16km | Yes | Required for JACKAL guidance |
| EO/IR Camera | `eoir_camera` | Sensor | 8km | Yes | 15° FOV, thermal + daylight |
| RF/PNT Jammer | `rf_jammer` | Effector | 5km | Yes | RF energy blocked by terrain |
| DE-LASER-3km | `de_laser_3k` | Effector | 3km | Yes | Precision single-target DE weapon; can pre-slew to a selected track |
| DE-HPM-3km | `de_hpm_3k` | Effector | 3km | No | Area-effect DE pulse; best against swarms; no LOS required |
| JACKAL Pallet | `jackal_pallet` | Effector | 10km | No | 4 interceptors, guided flight path |
| Shenobi | `shenobi` | Combined | 8km/6km | Yes | RF detect + protocol manipulation |

**LOS = Line of Sight.** Systems with LOS=Yes get terrain-aware viewshed visualization in Base Defense Architect. `DE-HPM-3km` and JACKAL are the only current effectors that can engage without LOS.

**Directed Energy Behavior:** `DE-LASER-3km` and `DE-HPM-3km` can pre-slew toward a selected track even before it enters range. Their map cones should visibly rotate during the slew window, and an in-range engagement then fires after a short aim delay.

---

## EW Logic (jamming.ts / jamming.py)

Two independent jamming layers:

| Drone Type | RF Jam Resistance | PNT Drift (km/s/tick) |
|-----------|-----------------|----------------------|
| commercial_quad | 15% | 0.008 |
| micro | 20% | 0.006 |
| fixed_wing | 40% | 0.004 |
| improvised | 50% | 0.005 |
| improvised_hardened | 70% | 0.001 |
| shahed | 100% (RF-immune) | 0.0 (INS-primary, fully PNT-immune) |
| bird / ambient | 50% (default) | 0.0 (default — immunity via rf_emitting=false) |

**Tactical note:** Jammer won't defeat a Shahed — it gets `pnt_jammed` + navigation drift, shown as "PNT DEGRADED" in the panel. Use jammer to degrade Shahed accuracy + buy JACKAL spinup time. JACKAL is the only reliable defeat.

DroneState fields added for PNT: `pnt_jammed`, `pnt_drift_magnitude`, `pnt_jammed_time_remaining`

---

## Doctrine Loadouts (hardcoded in App.tsx `handleScenarioLaunch`)

| Scenario | Sensors | Effectors | Note |
|----------|---------|-----------|------|
| Tutorial | L-Band + EO/IR | RF Jammer + DE-LASER-3km + Shenobi | Learn basics, precision DE introduced |
| Lone Wolf | L-Band + Ku-Band + EO/IR | RF Jammer + DE-LASER-3km + 2× JACKAL + Shenobi | Standard single-threat loadout |
| Swarm Attack | L-Band + Ku-Band + 2× EO/IR | 2× RF Jammer + DE-LASER-3km + DE-HPM-3km + 2× JACKAL + 2× Shenobi | High-volume mixed DE + kinetic defense |
| Recon Probe | L-Band + Ku-Band + 2× EO/IR | RF Jammer + DE-LASER-3km + DE-HPM-3km + 1× JACKAL + Shenobi | ROE discipline with DE options |
| Free Play | L-Band + Ku-Band + EO/IR | RF Jammer + DE-LASER-3km + 1× JACKAL + Shenobi | Casual sandbox with a representative mixed-system loadout |

---

## Game Flow
1. **Main Menu** → 2×2 scenario card grid → LAUNCH → straight into mission (doctrine loadout, no setup)
2. **CUSTOM MISSION** → Scenario Select → Loadout → Placement → Running → Debrief
3. **BASE DEFENSE ARCHITECT** → Base Selection → Equipment Selection → Placement & Viewshed → Export to Mission
4. **GitHub Pages deploy** → auto on every `git push origin main`

### Base Defense Architect v2 (Shipped 2026-04-09)
Unified 4-step flow mirroring Custom Mission's UX pattern:
1. **Base Selection** — template cards (Small FOB, Medium Airbase, Large Installation) or custom geo search
2. **Equipment Selection** — enriched catalog cards with LOS badge, range, FOV stats, +/- qty, base limit enforcement
3. **Placement & Viewshed** — full map with terrain-aware LOS visualization, per-system coverage toggle, altitude/facing controls, draggable boundary polygon, Dark/Satellite/Topo tile layers, geo search
4. **Export** — coverage summary with approach corridor analysis, scenario picker, launch mission or download JSON

The stepper shell (`BaseDefenseArchitect.tsx`, ~120 lines) holds shared state; each step is a focused component in `components/bda/`. Viewshed computation uses Open-Elevation API (SRTM 30m) with 72 rays, 150m steps, and LRU caching.

---

## Data Path Convention
All static data fetches use `import.meta.env.BASE_URL` prefix:
```ts
fetch(`${import.meta.env.BASE_URL}data/scenarios/${id}.json`)
```
This resolves to `/` in local dev and `/opensentry/` on GitHub Pages. **Never use bare `/data/` paths** — they break on GitHub Pages.

`vite.config.ts` sets `base: process.env.GITHUB_ACTIONS ? "/opensentry/" : "/"` so local dev is unaffected.

---

## Valid Action Names
`confirm_track`, `identify`, `engage`, `hold_fire`, `release_hold_fire`, `end_mission`, `slew_camera`, `shenobi_hold`, `shenobi_land_now`, `shenobi_deafen`, `jammer_toggle`, `jam_all`, `cease_jam`, `clear_airspace`, `pause_mission`, `resume_mission`

---

## Naming History
- Originally: **SKYSHIELD**
- Renamed 2026-03-20: **OpenSentry**
- Migrated 2026-04-07 to `jdelvo06-debug/opensentry` (fresh repo, clean history)
- Internal catalog ID `kurz_fcs` → `kufcs` (no trademark exposure)
- `shenobi.py` → `shenobi.py`, `coyote.py` → `jackal.py` (early prototype names, fully scrubbed)

---

## Development

### Local dev (Python backend, original flow)
```bash
cd backend && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
cd frontend && npm run dev   # port 5173
```

### Client-side only (no Python needed)
```bash
cd frontend && npm run dev   # uses useGameEngine.ts, fetches /data/ from public/
```

### Run tests
```bash
cd frontend && npm test      # vitest — 28 game engine unit tests
cd backend && python -m pytest  # Python backend tests (5 modules)
```

### Deploy
```bash
git push origin main   # GitHub Actions auto-builds and deploys to Pages
```

### If frontend starts on wrong port
```bash
pkill -f vite && cd frontend && npm run dev
```

---

## Development Workflow

This project uses Claude Code subagents for a structured development pipeline:

| Agent | Role |
|-------|------|
| `planner` | Plans the approach before coding starts |
| `architect` | High-level design decisions |
| `code-reviewer` | Reviews code after writing |
| `security-reviewer` | Security audit pass |
| `refactor-cleaner` | Cleans dead code and tech debt |
| `build-error-resolver` | Diagnoses build failures |

**Typical flow:** plan → architect → implement → code-review → security-review → cleanup

These are Claude Code subagent types, not custom-built tools. They run as part of the normal Claude Code session and are invoked automatically based on the task at hand.

---

## Known Issues / Open TODO
- JACKAL trajectory + action wheel size (GitHub Issue #1)
- Intermittent stuck bogey in Lone Wolf — root cause unconfirmed
- `_evasive_state` dict in drone.py is module-level (shared across connections) — blocks multiplayer, fine for single-player
- App.tsx has 51 `useState` declarations — should be refactored into useReducer slices (audio, tracks, ATC, phase, UI)
- Bundle size 733 KB (205 KB gzipped) — should lazy-load BaseDefenseArchitect, StudyModule, PlacementScreen with React.lazy()
- No accessibility — missing ARIA labels, color-only indicators, no keyboard nav on RadialActionWheel
- Backend Python tests not run in CI — GitHub Actions only builds frontend
- BDA viewshed terrain accuracy depends on SRTM 30m data via Open-Elevation API — may not match local terrain perfectly
- After-action replay (timeline scrub) — deferred

## Testing
- **Frontend:** vitest with 37 unit tests in `frontend/src/__tests__/game-engine.test.ts`
  - Coverage: detection math (radar/RF/EO-IR/acoustic), FOV, terrain LOS, confidence calculation, segment intersection, drone creation/movement/trail limits, jam behavior rolls, PNT drift, GameState factory, directed-energy LOS/HPM behavior, scoring normalization, and DE slew/pre-slew timing
  - Run: `cd frontend && npm test`
- **Backend:** pytest with 5 test modules in `backend/tests/`
  - Coverage: security, detection, drone, models, scoring
  - Run: `cd backend && python -m pytest`
- **Not yet tested:** React components, hooks, phase transitions, integration tests

## Shipped in v1.8.0 (2026-04-05)
- Base Defense Architect (#54/55) — altitude-aware sensor placement, viewshed, terrain LOS
- Free Play scenario (#56/57) — casual mixed-threat sandbox mode
- Interactive tutorial overhaul (#58/59) — two-phase UI tour + hands-on DTID practice

## Shipped in v1.9.0 (2026-04-09)
- BDA v2 Stepper Refactor (PR #3) — 2830-line monolith → 120-line stepper shell + 13 focused components
- Unified 4-step flow: Base → Equip → Place → Export (mirrors Custom Mission UX)
- Per-system coverage toggle — show/hide individual system viewsheds for gap analysis
- Enriched equipment cards with LOS badge, range, FOV stats
- Map tile toggle (Dark/Satellite/Topo)
- Draggable base perimeter with vertex handles
- Geo search on placement map (Nominatim)
- Export to mission preserves custom location coordinates
- LOS corrections: Shenobi and RF Jammer now require LOS (only JACKAL is non-LOS)
- AGL height range extended down to 2m

## Shipped on main (2026-04-18)
- Directed energy split — legacy directed energy effector replaced by `DE-LASER-3km` and `DE-HPM-3km`
- Distinct DE gameplay — laser is precision/LOS/single-target; HPM is non-LOS/area-effect/anti-swarm
- Persistent DE FOV wedges plus distinct beam/pulse visuals
- Directed energy engagement feedback — rejected shots and `SLEWING` state surfaced clearly in the engagement panel
- Directed energy pre-slew — out-of-range DE commands now orient the system onto the track instead of doing nothing

## Next Session — Priority Work
1. Fix JACKAL trajectory and reduce action wheel size (Issue #1)
2. Save/load BDA designs as JSON (share with unit, iterate on layouts)
3. Add CI test step to GitHub Actions workflow (both vitest and pytest)
4. Code-split bundle with React.lazy() for heavy components (currently 733 KB)
5. Investigate stuck bogey in Lone Wolf — still unconfirmed
