# CLAUDE.md — OpenSentry Project Guide (Updated 2026-04-04)

## What Is This?
OpenSentry is a **free, browser-based C-UAS training simulator** designed to teach military operators the **DTID kill chain** (Detect → Track → Identify → Defeat). It's built to emulate real-world C-UAS command and control systems. No clearance required — purely training.

**Target User:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

**Live URL:** https://alfred-intel-handler-source.github.io/skyshield/
**Repo:** https://github.com/alfred-intel-handler-source/skyshield

---

## Architecture (as of 2026-04-04)

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

| System | Catalog ID | Type | Range | Notes |
|--------|-----------|------|-------|-------|
| L-Band Multi-Mission Radar | `tpq51` | Sensor | 10km | 360° surveillance |
| Ku-Band Fire Control Radar | `kufcs` | Sensor | 10km | Required for JACKAL guidance |
| EO/IR Camera | `eoir_camera` | Sensor | 8km | 15° FOV, thermal + daylight |
| RF/PNT Jammer | `rf_jammer` | Effector | 5km | Passive area suppression, rechargeable |
| JACKAL Pallet | `jackal_pallet` | Effector | 10km | 4 interceptors, requires Ku-Band FCS |
| Shenobi | `shenobi` | Combined | 8km/6km | RF detect + protocol manipulation |

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
| Tutorial | L-Band + EO/IR | RF Jammer + Shenobi | Learn basics, no JACKAL |
| Lone Wolf | L-Band + Ku-Band + EO/IR | RF Jammer + 2× JACKAL + Shenobi | Standard loadout |
| Swarm Attack | L-Band + Ku-Band + 2× EO/IR | 2× RF Jammer + 2× JACKAL + 2× Shenobi | High volume |
| Recon Probe | L-Band + Ku-Band + 2× EO/IR | RF Jammer + 1× JACKAL + Shenobi | ROE discipline |
| Free Play | L-Band + Ku-Band + EO/IR | RF Jammer + 1× JACKAL + Shenobi | One of each, casual sandbox |

---

## Game Flow
1. **Main Menu** → 2×2 scenario card grid → LAUNCH → straight into mission (doctrine loadout, no setup)
2. **CUSTOM MISSION** → Scenario Select → Loadout → Placement → Running → Debrief
3. **GitHub Pages deploy** → auto on every `git push origin main`

---

## Data Path Convention
All static data fetches use `import.meta.env.BASE_URL` prefix:
```ts
fetch(`${import.meta.env.BASE_URL}data/scenarios/${id}.json`)
```
This resolves to `/` in local dev and `/skyshield/` on GitHub Pages. **Never use bare `/data/` paths** — they break on GitHub Pages.

`vite.config.ts` sets `base: process.env.GITHUB_ACTIONS ? "/skyshield/" : "/"` so local dev is unaffected.

---

## Valid Action Names
`confirm_track`, `identify`, `engage`, `hold_fire`, `release_hold_fire`, `end_mission`, `slew_camera`, `shenobi_hold`, `shenobi_land_now`, `shenobi_deafen`, `jammer_toggle`, `jam_all`, `cease_jam`, `clear_airspace`, `pause_mission`, `resume_mission`

---

## Naming History
- Originally: **SKYSHIELD**
- Renamed 2026-03-20: **OpenSentry**
- GitHub repo stays `skyshield` (URL can't change without breaking Pages link)
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
- Intermittent stuck bogey in Lone Wolf — root cause unconfirmed
- `_evasive_state` dict in drone.py is module-level (shared across connections) — blocks multiplayer, fine for single-player
- App.tsx has 51 `useState` declarations — should be refactored into useReducer slices (audio, tracks, ATC, phase, UI)
- Bundle size 689 KB (193 KB gzipped) — should lazy-load BaseDefenseArchitect, StudyModule, PlacementScreen with React.lazy()
- No accessibility — missing ARIA labels, color-only indicators, no keyboard nav on RadialActionWheel
- Backend Python tests not run in CI — GitHub Actions only builds frontend
- Duplicate constants (CLASSIFICATIONS, color maps) across multiple components — should centralize into constants.ts
- Phase 2 features (terrain LOS, planning score, after-action replay) — deferred

## Testing
- **Frontend:** vitest with 28 unit tests in `frontend/src/__tests__/game-engine.test.ts`
  - Coverage: detection math (radar/RF/EO-IR/acoustic), FOV, terrain LOS, confidence calculation, segment intersection, drone creation/movement/trail limits, jam behavior rolls, PNT drift, GameState factory
  - Run: `cd frontend && npm test`
- **Backend:** pytest with 5 test modules in `backend/tests/`
  - Coverage: security, detection, drone, models, scoring
  - Run: `cd backend && python -m pytest`
- **Not yet tested:** React components, hooks, phase transitions, integration tests

## Next Session — Priority Work
1. Investigate stuck bogey (Lone Wolf) — still unconfirmed
2. Add CI test step to GitHub Actions workflow (both vitest and pytest)
3. Code-split bundle with React.lazy() for heavy components
4. Draft AFWERX/DIU one-pager for OpenSentry innovation submission
