# AGENTS.md — OpenSentry Project Guide (Updated 2026-05-17)

## What Is This?
OpenSentry is a **free, browser-based C-UAS training simulator** designed to teach military operators the **DTID kill chain** (Detect → Track → Identify → Defeat). It's built to emulate real-world C-UAS command and control systems. No clearance required — purely training.

**Target User:** "The E-5 who gets handed the C-UAS binder and told to figure it out."

**Live URL:** https://jdelvo06-debug.github.io/opensentry/
**Repo:** https://github.com/jdelvo06-debug/opensentry

## Project Mapping

Linear is the task board and source of truth; it does not know local folders by itself.

- Linear team: `Opensentry` (`OPE`)
- Linear project: `OpenSentry Core Roadmap`
- Linear project URL: `https://linear.app/agent-os-contana-and-alfred/project/opensentry-core-roadmap-8e95c46b7bff`
- GitHub repo: `jdelvo06-debug/opensentry`
- GitHub URL: `https://github.com/jdelvo06-debug/opensentry`
- Local repo path: `/Users/jeremydelvaux/projects/opensentry`
- Live GitHub Pages URL: `https://jdelvo06-debug.github.io/opensentry/`

Keep separate from **OpenSentry Pixel**:

- Pixel Linear team: `OpenSentry Pixel` (`PIXEL`)
- Pixel local repo path: `/Users/jeremydelvaux/projects/opensentry-pixel`
- Pixel work belongs in the Pixel Game chat, not this repo/team.

Rules:

- Work one Linear issue at a time.
- Before creating/moving issues, confirm team key `OPE` and project `OpenSentry Core Roadmap`.
- Before editing code, verify this repo path, Git remote, active branch, and clean status.
- Do not mix arcade/OpenSentry Pixel tasks into this project.

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
      ScenarioBuilder.tsx   ← Browser-local custom scenario builder shell
      WaveComposer.tsx      ← Multi-threat wave/threat-group composer
      UnitGate.tsx          ← Pre-launch usage tracking gate
      bda/                  ← Base Defense Architect v2 (stepper flow)
        BdaStepIndicator.tsx, BdaBaseSelection.tsx, BdaEquipmentSelection.tsx
        BdaPlacement.tsx, BdaExport.tsx
        types.ts, constants.ts, viewshed.ts
        components/         ← BDA sub-components (palette, markers, detail panel, etc.)
    types.ts                ← TypeScript interfaces for all ServerMessage types
    utils/tracking.ts       ← Apps Script usage tracking client
    utils/scenarioBuilderUtils.ts ← Pure Scenario Builder helpers + normalization
    __tests__/              ← vitest unit tests for game engine
  public/data/              ← Static JSON data (served on GitHub Pages)
    scenarios/              ← lone_wolf.json, swarm_attack.json, recon_probe.json, tutorial.json, thermopylae.json, free_play.json, apkws_test.json, maul_test.json + index.json
    bases/                  ← generic templates + curated presets + preset-aliases.json
    equipment/catalog.json  ← All equipment definitions

scripts/                    ← preset authoring helpers
  import_geojson_preset.py  ← imports traced GeoJSON polygons into curated presets

apps-script/                ← Google Apps Script source copies
  tracking/Code.gs          ← Usage tracking web app; appends launch rows to Sheets

src/game/                   ← TypeScript game engine (ported from Python)
  state.ts                  ← All types/interfaces + GameState factory
  helpers.ts                ← Constants, effectiveness matrix, sensor/effector builders
  drone.ts                  ← 4 movement behaviors (direct, orbit, waypoint, evasive)
  jamming.ts                ← RF + PNT jamming, resistance tables, drift tick
  shenobi.ts                ← Shenobi CM state machine (pending→1/2→2/2)
  jackal.ts                 ← JACKAL lifecycle (spinup→launch→midcourse→terminal)
  maul.ts                   ← MAUL interceptor lifecycle (spinup→launch→midcourse→terminal→ram)
  apkws.ts                  ← APKWS rocket lifecycle (launch→midcourse→terminal→impact)
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
| JACKAL Pallet | `jackal_pallet` | Effector | 10km | No | 4 interceptors, Ku-band FCS guided |
| MAUL Coffin Launcher | `maul_launcher` | Effector | 4km | No | 4 autonomous ramming interceptors, no FCS needed |
| APKWS Launcher | `apkws_launcher` | Effector | 5km | Yes | 7 laser-guided rockets, requires designation |
| DE-LASER-3km | `de_laser_3k` | Effector | 3km | Yes | Precision, single-target, requires slew |
| DE-HPM-3km | `de_hpm_3k` | Effector | 3km | No | Area-effect, anti-swarm, requires slew |
| Shenobi | `shenobi` | Combined | 8km/6km | Yes | RF detect + protocol manipulation |

**LOS = Line of Sight.** Systems with LOS=Yes get terrain-aware viewshed visualization in Base Defense Architect. MAUL and JACKAL (kinetic interceptors) operate without LOS.

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

**Tactical notes:** RF jam effects now require `rf_emitting`; a non-emitting fixed-wing can still show **PNT DEGRADED** without ever entering RF-jammed behavior. Shenobi protocol manipulation is scoped to `commercial_quad` and `micro` library matches only. Shahed / OW-UAS is fully RF/PNT-immune and should be treated as a **kinetic-only** doctrine target.

DroneState fields added for PNT: `pnt_jammed`, `pnt_drift_magnitude`, `pnt_jammed_time_remaining`

## Ambient Traffic Behavior

Birds and balloons are ambient objects handled exclusively by the ambient traffic system. They are not combat threats and never spawn through the combat pipeline.

- **Birds:** spawn every 180-300s (max 4 active), fly cross-map on erratic_wander behavior with proper exit waypoints, exit the map or fly out of radar range. Never fly toward base center.
- **Balloons:** spawn every 300-480s (max 2 active), drift_ascend in a random direction while climbing, eventually climb above detection range.
- **Auto-classification:** when the operator IDENTIFY's a track as "bird" or "weather_balloon", the affiliation auto-resolves to NEUTRAL and a "C2: FALSE ALARM" tactical note appears. No separate affiliation declaration step is needed.

---

## Doctrine Loadouts (hardcoded in App.tsx `handleScenarioLaunch`)

| Scenario | Sensors | Effectors | Note |
|----------|---------|-----------|------|
| Tutorial | L-Band + EO/IR | RF Jammer + Shenobi + DE-LASER | Learn basics, no JACKAL/MAUL |
| Lone Wolf | L-Band + Ku-Band + EO/IR | RF Jammer + 2x JACKAL + DE-LASER + Shenobi | Standard loadout |
| Swarm Attack | L-Band + Ku-Band + 2x EO/IR | 2x RF Jammer + 2x JACKAL + DE-LASER + DE-HPM + 2x APKWS + 2x Shenobi | High volume |
| Recon Probe | L-Band + Ku-Band + 2x EO/IR | RF Jammer + 1x JACKAL + DE-LASER + DE-HPM + Shenobi | ROE discipline |
| Free Play | L-Band + Ku-Band + EO/IR | RF Jammer + 1x JACKAL + MAUL + DE-LASER + Shenobi | One of each, casual sandbox |
| Thermopylae | L-Band + Ku-Band + 2x EO/IR | 2x RF Jammer + 2x JACKAL + MAUL + DE-LASER + DE-HPM + 2x Shenobi | Heavy threat environment |
| MAUL Test | L-Band + Ku-Band + EO/IR | 1x MAUL + 1x JACKAL | Quick MAUL exercise |
| APKWS Test | L-Band + Ku-Band + EO/IR | 2x APKWS + 1x JACKAL | Quick APKWS exercise |

---

## Game Flow
1. **Main Menu** → 2×2 scenario card grid → LAUNCH → usage gate → ROE briefing → mission
2. **CUSTOM MISSION** → Scenario Select → Loadout → Placement → Usage gate → ROE briefing → Running → Debrief
3. **BASE DEFENSE ARCHITECT** → Base Selection → Equipment Selection → Placement & Viewshed → Export to Mission
4. **Scenario Builder** → Base → Equip → Place → Compose Waves → Review → Usage gate → ROE briefing → Running
5. **GitHub Pages deploy** → auto on every `git push origin main`

### Base Defense Architect v2 (Shipped 2026-04-09)
Unified 4-step flow mirroring Custom Mission's UX pattern:
1. **Base Selection** — template cards (Small FOB, Medium Airbase, Large Installation) or custom geo search
2. **Equipment Selection** — enriched catalog cards with LOS badge, range, FOV stats, +/- qty, base limit enforcement
3. **Placement & Viewshed** — full map with terrain-aware LOS visualization, per-system coverage toggle, altitude/facing controls, draggable boundary polygon, Dark/Satellite/Topo tile layers, geo search
4. **Export** — coverage summary with approach corridor analysis, scenario picker, launch mission or download JSON

The stepper shell (`BaseDefenseArchitect.tsx`, ~120 lines) holds shared state; each step is a focused component in `components/bda/`. Viewshed computation uses Open-Elevation API (SRTM 30m) with 72 rays, 150m steps, and LRU caching.

### Scenario Builder MVP (Shipped 2026-05-16)
- `ScenarioBuilder.tsx` orchestrates Base → Equip → Place → Wave Composer → Review → Launch.
- `WaveComposer.tsx` supports multiple threat groups per wave. Each group can set UAS type, count, bearing, offset, stagger, altitude, speed, and behavior.
- `scenarioBuilderUtils.ts` owns the pure logic: templates, type guards, bearing conversion, scenario duration, drone generation, waypoint generation, and wave/threat-group normalization.
- The engine still consumes flat `drones[]`; do not change the game-engine scenario schema just to support UI grouping.
- Legacy single-threat wave fields should continue to normalize through `normalizeWave()` / `normalizeThreatGroup()`.
- Scenario Builder UX is MVP-level. Expect user feedback and prefer small UX improvements over large rewrites.

### Usage Tracking Gate (Shipped 2026-05-17)
- `UnitGate.tsx` appears before ROE briefing for main-menu quick-launch scenarios, custom mission launches, and Scenario Builder launches.
- Local dev hosts (`localhost`, `127.0.0.1`, `[::1]`) bypass the gate automatically so testing does not require repeated form entry.
- Required field: Unit. Optional fields: Name, Email.
- Last submitted unit/name/email is stored in browser `localStorage` and prefilled on future live-site launches.
- Privacy copy: information is used for internal usage metrics only and is not sold, shared, or used for marketing.
- Tracking posts to Google Apps Script through `utils/tracking.ts`, which appends to the `OpenSentry Usage Tracker` Google Sheet.
- Tracking failure must never block launch. Metrics are useful; training access is mission-critical.
- Do not add `Content-Type: application/json` to the tracking POST unless browser-tested; omitting it avoids Apps Script CORS preflight issues.
- Apps Script source copy lives at `apps-script/tracking/Code.gs`; deployed web app must expose top-level `doPost(e)` and be deployed as: Execute as Me, access Anyone.
- Full notes: `docs/usage-tracking.md`.

---

## Data Path Convention
All static data fetches use `import.meta.env.BASE_URL` prefix:
```ts
fetch(`${import.meta.env.BASE_URL}data/scenarios/${id}.json`)
```
This resolves to `/` in local dev and `/opensentry/` on GitHub Pages. **Never use bare `/data/` paths** — they break on GitHub Pages.

`vite.config.ts` sets `base: process.env.GITHUB_ACTIONS ? "/opensentry/" : "/"` so local dev is unaffected.

---

## Curated Base Presets (Authoritative Workflow — 2026-04-21)

- Shared presets for all users live in git under `frontend/public/data/bases/<base_id>.json` plus `frontend/public/data/bases/preset-aliases.json`.
- On GitHub Pages, ad hoc custom-location saves are browser-local only. They do **not** write back to the repo. If a searched location should become shared, promote it into a curated preset commit.
- Default workflow for new curated boundaries:
  1. Start from a real aerodrome way/relation in OSM, or hand-trace it in `geojson.io`.
  2. Import/simplify the outline with topology preservation.
     Preferred path: `python3 scripts/import_geojson_preset.py --preset <base_id> --geojson /abs/path/file.geojson`
  3. Keep the distinctive installation shape. Expect roughly 18–30 points when needed.
  4. Apply only minimal local edits so existing runway/apron/support geometry remains inside the polygon.
  5. Verify visually in-app after `npm test` and `vite build`.
- Deprecated workflow:
  - Do **not** generate new curated presets by taking a runway midpoint and applying a blanket buffer/oval around the runway complex.
  - Do **not** treat output from `wip/preset-generation-script` as merge-ready without a traced visual pass.

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
cd frontend && npm test      # vitest — 62 frontend/game-engine tests
cd backend && python -m pytest  # Python backend tests (147 tests / 6 modules)
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

Use Linear as the source of truth for original OpenSentry work.

1. Pick or create exactly one issue in Linear team `OPE` / project `OpenSentry Core Roadmap`.
2. Move it to `In Progress` before implementation.
3. Create a branch from clean `main`, using the issue key when practical, e.g. `feature/ope-4-scenario-library`.
4. Keep the branch scoped to that one issue.
5. Run verification before PR:
   ```bash
   cd frontend && npx vitest run
   cd frontend && npm run build
   ```
6. Commit, push, open a PR, then move the Linear issue to `In Review` with a comment summarizing changes and verification.
7. **Stop at PR/In Review. Do not merge to `main` automatically.** Jeremy must explicitly approve the merge with wording such as `merge it`, `merge this PR`, or an equivalent direct instruction.
8. After Jeremy approves and the PR is merged/deployed, move the Linear issue to `Done`.

Merge discipline:

- Default deliverable for implementation work is a reviewed PR, not a direct `main` merge.
- If a task looks risky, unclear, or larger than expected, do discovery/planning first and ask before coding.
- Do not treat passing tests as merge approval. Passing tests means the PR is ready for Jeremy's decision.
- Docs-only guardrail updates may be committed/pushed when Jeremy asks to update agent instructions, but feature code still stops at PR unless he approves merge.

### Seeded Linear Roadmap Issues (2026-05-17)

- `OPE-1` — Audit current OpenSentry baseline and roadmap state
- `OPE-2` — Improve preset polygon quality workflow
- `OPE-3` — Polish Scenario Builder MVP flow
- `OPE-4` — Add browser-local scenario save/load library
- `OPE-5` — Improve BDA coverage and gap summary
- `OPE-6` — Create printable base defense planning brief
- `OPE-7` — Refine EW and interceptor realism test coverage
- `OPE-8` — Maintain usage tracking and weekly reporting

### Codex Handoff Notes

Codex may be used for implementation, but it must stay inside this repo and follow the Linear issue scope.

Before launching Codex:

- Confirm current directory is `/Users/jeremydelvaux/projects/opensentry`.
- Confirm `git remote -v` shows `origin` as `https://github.com/jdelvo06-debug/opensentry.git`.
- Confirm the active Linear issue belongs to `OPE`, not `PIXEL`.
- Give Codex the issue identifier, acceptance criteria, verification commands, and this `AGENTS.md` context.
- Do not let Codex create OpenSentry Pixel/arcade work in this repo.

Recommended Codex pattern:

```bash
codex exec --full-auto "Work on OPE-<n>: <issue title>. Read AGENTS.md first. Stay scoped to this issue. Run cd frontend && npx vitest run and cd frontend && npm run build before finishing. Summarize files changed, verification, and any limitations."
```

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
- **Frontend:** vitest with 78 unit tests across 6 test files
  - Coverage: detection math, FOV, terrain LOS, confidence, JACKAL/APKWS/MAUL lifecycles, DE laser/HPM, EO/IR camera selection, tactical-map routing, realism gating, PNT-only effect-state, bird false-alarm auto-classification, ambient spawn behavior
  - Run: `cd frontend && npm test`
- **Backend:** pytest with 147 tests across 6 modules in `backend/tests/`
  - Coverage: security, detection, drone, models, scoring, and NEXUS/Shenobi eligibility
  - Run: `cd backend && python3 -m pytest`
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

## Shipped in v1.10.0 (2026-04-18)
- Directed energy split — legacy DE replaced by `DE-LASER-3km` and `DE-HPM-3km`
- DE gameplay differentiation — laser is precision/LOS/single-target; HPM is non-LOS/area-effect/anti-swarm
- Persistent DE FOV wedges + distinct beam/pulse visuals
- DE engagement feedback — `SLEWING` state surfaced in engagement panel
- DE pre-slew — out-of-range DE orders orient the system onto the track
- EO/IR proximity slewing — binds to nearest active EO/IR sensor
- EO/IR tactical-map cone fix — renders from selected camera
- Duplicate EO/IR labels — `#1`, `#2`, etc.

## Shipped in v1.10.1 (2026-04-19)
- **SystemsPanel sidebar consolidation (PR #7)** — SensorPanel + EffectorPanel merged into single collapsible SystemsPanel with SENSORS, EFFECTORS, and COMBINED groups
- **Shenobi display fix** — one combined row with capability subtext instead of duplicate rows
- **DE LOS scoped to BDA only** — directed energy line-of-sight enforcement skipped in standard scenarios, applied only in Base Defense Architect / custom placement
- **49/49 tests passing** — DE dwell/resolution timing tests added; live browser QA verified RF/PNT jammer, DE laser, and HPM

## Shipped in v1.12.0 (2026-04-21)
- **Custom search save flow** — searched locations now start from a generic editable polygon, persist as namespaced custom presets (browser-local on Pages), and reload consistently in both Custom Mission and BDA without overwriting curated presets
- **Mission launch center fix** — live mission export now preserves the selected custom location instead of falling back to the generic Iraq debug center
- **Mission map stability fix** — live mission map now preserves user pan/zoom instead of snapping back on every render tick

## Current main (post-v1.12.0)
- **PR #9 realism pass** — Shahed / OW-UAS is kinetic-only in doctrine and effectiveness tables
- **Curated searchable preset library** — current repo inventory is 19 shared base presets wired through `preset-aliases.json`
- **4-sided default perimeter** with midpoint add / right-click remove
- **Custom mission handoff** uses live edited boundary, not stale template
- **Custom search save flow** — searched locations now start from a generic editable polygon, persist as namespaced custom presets (browser-local on Pages), and reload consistently in both Custom Mission and BDA without overwriting curated presets
- **Mission map stability fix** — live mission map now preserves the selected center and no longer fights user pan/zoom on every tick
- **Infrastructure overlays removed** — protected-asset / terrain marker clutter is hidden in planning and mission views
- **Curated perimeter workflow updated** — current default is traced/source-derived aerodrome outlines; recent quality pass reworked Scott, Prince Sultan, Kunsan, Kadena, Nellis, RAF Lakenheath, and Al Udeid away from runway-bubble shapes
- **GeoJSON importer shipped** — `scripts/import_geojson_preset.py` converts traced polygons into curated preset format
- **78/78 frontend tests passing**

## Shipped in v1.14.0 (2026-05-10)
- **MAUL autonomous kinetic interceptor** — coffin-launched ramming quadcopter, 4km range, autonomous CV guidance (no Ku-band FCS), up to 3 re-engagement attempts, 0.90 Pk vs quads / 0.25 Pk vs Shahed
- **MAUL Test scenario** — dedicated 3-threat exercise (quad + micro + Shahed)
- **MAUL added to Free Play and Thermopylae doctrine loadouts**
- **MAUL camera silhouette** — armored body, blunt nose cone, heavy stubby arms
- **Altitude tracking** — MAUL, JACKAL, and APKWS now climb/descend toward target altitude during pursuit
- **Bird/balloon consistency** — removed from all combat spawn pools; ambient system handles everything identically across all scenarios
- **Bird/balloon auto-classification** — identifying as bird/balloon auto-resolves to NEUTRAL with false-alarm note
- **16 new MAUL tests** — lifecycle, re-engagement, ammo depletion, duplicate prevention, target loss, Shahed Pk, Ku-FC independence
- **78/78 tests passing**

## WIP (on `wip/preset-generation-script` branch)
- `scripts/generate-preset.py` — deterministic OSM-based preset generator (experimental only; not the default preset-authoring workflow)
- Script-regenerated Barksdale, Nellis, Kadena, Tyndall (unverified)
- Langley AFB preset (polygon mangled from OSM relation stitching)
- Do not merge this branch's preset output without a traced/source-derived visual cleanup pass

## Next Session — Priority Work
1. Continue curated base verification using the traced-outline workflow (remaining: Creech, Fort Liberty, Lackland, and other unreviewed presets)
2. Fix JACKAL trajectory and reduce action wheel size (Issue #1)
3. Add remaining bases (Langley, Andersen, Incirlik, etc.) using traced/source-derived outlines instead of runway buffers
4. Add CI test step to GitHub Actions workflow (both vitest and pytest)
5. Code-split bundle with React.lazy() for heavy components (currently 733 KB)
