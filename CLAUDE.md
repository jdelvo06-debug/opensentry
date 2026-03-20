# CLAUDE.md — OpenSentry Project Guide (Updated 2026-03-20)

## What Is This?
OpenSentry is a **free, browser-based C-UAS training simulator** designed to teach military operators the **DTID kill chain** (Detect → Track → Identify → Defeat). It's built to emulate real-world C-UAS command and control systems. No clearance required — purely training.

**Target User:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

**Live URL:** https://alfred-intel-handler-source.github.io/skyshield/
**Repo:** https://github.com/alfred-intel-handler-source/skyshield

---

## Architecture (as of 2026-03-20)

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
    hooks/useGameEngine.ts  ← 10Hz game loop in browser (replaces WebSocket)
    hooks/useWebSocket.ts   ← Legacy hook (kept for local dev with Python backend)
    components/             ← All UI components
    types.ts                ← TypeScript interfaces for all ServerMessage types
  public/data/              ← Static JSON data (served on GitHub Pages)
    scenarios/              ← lone_wolf.json, swarm_attack.json, recon_probe.json, tutorial.json + index.json
    bases/                  ← small_fob.json, medium_airbase.json, large_installation.json + index.json
    equipment/catalog.json  ← All equipment definitions

src/game/                   ← TypeScript game engine (ported from Python)
  state.ts                  ← All types/interfaces + GameState factory
  helpers.ts                ← Constants, effectiveness matrix, sensor/effector builders
  drone.ts                  ← 4 movement behaviors (direct, orbit, waypoint, evasive)
  jamming.ts                ← RF + PNT jamming, resistance tables, drift tick
  shinobi.ts                ← SHINOBI CM state machine (pending→1/2→2/2)
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
| SHINOBI | `shinobi` | Combined | 8km/6km | RF detect + protocol manipulation |

---

## EW Logic (jamming.ts / jamming.py)

Two independent jamming layers:

| Drone Type | RF Jam Resistance | PNT Drift (km/s/tick) |
|-----------|-----------------|----------------------|
| commercial_quad | 0% | 0.008 |
| micro | 10% | 0.006 |
| fixed_wing | 40% | 0.004 |
| improvised | 50% | 0.005 |
| shahed | 100% (RF-immune) | 0.003 (minor drift only) |
| bird / ambient | immune | immune |

**Tactical note:** Jammer won't defeat a Shahed — it gets `pnt_jammed` + navigation drift, shown as "PNT DEGRADED" in the panel. Use jammer to degrade Shahed accuracy + buy JACKAL spinup time. JACKAL is the only reliable defeat.

DroneState fields added for PNT: `pnt_jammed`, `pnt_drift_magnitude`, `pnt_jammed_time_remaining`

---

## Doctrine Loadouts (hardcoded in App.tsx `handleScenarioLaunch`)

| Scenario | Sensors | Effectors | Note |
|----------|---------|-----------|------|
| Tutorial | L-Band + EO/IR | RF Jammer + SHINOBI | Learn basics, no JACKAL |
| Lone Wolf | L-Band + Ku-Band + EO/IR | RF Jammer + 2× JACKAL + SHINOBI | Standard loadout |
| Swarm Attack | L-Band + Ku-Band + 2× EO/IR | 2× RF Jammer + 2× JACKAL + 2× SHINOBI | High volume |
| Recon Probe | L-Band + Ku-Band + 2× EO/IR | RF Jammer + 1× JACKAL + SHINOBI | ROE discipline |

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
`confirm_track`, `identify`, `engage`, `hold_fire`, `release_hold_fire`, `end_mission`, `slew_camera`, `shinobi_hold`, `shinobi_land_now`, `shinobi_deafen`, `jammer_toggle`, `jam_all`, `cease_jam`, `clear_airspace`, `pause_mission`, `resume_mission`

---

## Naming History
- Originally: **SKYSHIELD**
- Renamed 2026-03-20: **OpenSentry**
- GitHub repo stays `skyshield` (URL can't change without breaking Pages link)
- Internal catalog ID `kurz_fcs` → `kufcs` (no trademark exposure)
- `ninja.py` → `shinobi.py`, `coyote.py` → `jackal.py` (early prototype names, fully scrubbed)

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

### Deploy
```bash
git push origin main   # GitHub Actions auto-builds and deploys to Pages
```

### If frontend starts on wrong port
```bash
pkill -f vite && cd frontend && npm run dev
```

---

## Known Issues / Open TODO
- Intermittent stuck bogey in Lone Wolf — root cause unconfirmed
- SHINOBI `uplink_detected` — CM state 1/2 → 2/2 transition depends on detection loop correctly setting this field; verify in TypeScript port
- `_evasive_state` dict in drone.py is module-level (shared across connections) — blocks multiplayer, fine for single-player
- Phase 2 features (terrain LOS, planning score, after-action replay) — deferred

## Next Session — Priority Work
1. Smoke test all 4 scenarios on live GitHub Pages URL
2. Investigate stuck bogey (Lone Wolf)
3. Draft AFWERX/DIU one-pager for OpenSentry innovation submission
4. README polish for public sharing
