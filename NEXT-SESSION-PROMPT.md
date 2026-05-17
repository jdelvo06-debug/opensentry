# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Status: OpenSentry MVP Expansion — Scenario Builder + Usage Tracking (2026-05-16/17)

OpenSentry is deployed from `main` to GitHub Pages. The recent work shipped the Scenario Builder MVP, multi-threat Wave Composer, and a lightweight usage tracking gate backed by Google Apps Script + Google Sheets.

Live site: https://jdelvo06-debug.github.io/opensentry/

## Current Verification Baseline

- TypeScript: clean
- Frontend tests: **102/102 passing** across 7 files
- Production build: passes
- Bundle warning: still present; latest observed build around **829 KB minified** with Vite's existing 500 KB warning
- Apps Script endpoint: verified returning `{"ok":true}`
- Google Sheet append: verified rows land in `OpenSentry Usage Tracker`

## Recently Shipped

### Scenario Builder MVP

Users can now build browser-local custom scenarios:

1. Select a base
2. Choose equipment within base limits
3. Place systems on the BDA map
4. Compose waves
5. Review summary
6. Launch directly into the simulator

Important files:

```text
frontend/src/components/ScenarioBuilder.tsx
frontend/src/components/WaveComposer.tsx
frontend/src/utils/scenarioBuilderUtils.ts
frontend/src/__tests__/scenario-builder.test.ts
frontend/src/components/bda/BdaEquipmentSelection.tsx
```

### Multi-threat Wave Composer

`WaveDef` now supports:

- `startSeconds`
- `threatGroups[]`

Each threat group supports:

- UAS type
- count
- bearing
- spawn offset
- stagger
- altitude
- speed
- behavior

Legacy single-threat wave fields still normalize correctly through `normalizeWave()` / `normalizeThreatGroup()`.

Scenario output still emits standard flat `drones[]`; there is no game-engine schema change.

### Usage Tracking Gate

Before ROE, users see a lightweight usage gate:

- Unit — required
- Name — optional
- Email — optional

The gate appears before both:

- Standard scenario launches
- Scenario Builder custom launches

The gate includes this privacy copy:

> This helps track OpenSentry usage and improve the simulator. Information submitted here is used for internal usage metrics only and is not sold, shared, or used for marketing.

Tracking failure must **not** block launch.

Important files:

```text
frontend/src/components/UnitGate.tsx
frontend/src/utils/tracking.ts
frontend/src/types.ts                ← includes unit_gate phase
frontend/src/App.tsx                 ← routes launch flow through unit_gate
apps-script/tracking/Code.gs         ← source copy for Apps Script endpoint
docs/usage-tracking.md               ← architecture and maintenance notes
```

## Apps Script / Tracking Notes

The deployed Apps Script `/exec` URL is configured in:

```text
frontend/src/utils/tracking.ts
```

The Google Sheet columns are:

- Timestamp
- Unit
- Name
- Email
- Scenario

Apps Script deployment settings must be:

- Deployment type: Web app
- Execute as: Me
- Who has access: Anyone

Known pitfall: `doPost(e)` must be top-level in Apps Script. Do not leave it nested inside `myFunction()`.

The frontend intentionally omits `Content-Type: application/json` on the POST to avoid Apps Script CORS preflight failures.

## Current Docs Updated

- `README.md` — features, architecture, completed/unreleased items
- `CHANGELOG.md` — Scenario Builder, Wave Composer, usage gate, fixes
- `docs/usage-tracking.md` — tracking architecture/verification/pitfalls
- `NEXT-SESSION-PROMPT.md` — this file

## Known Issues / Watch Items

- **Scenario Builder UX** is MVP-level. Jeremy is not fully in love with it yet; expect user feedback to drive simplification or layout changes.
- **Bundle size warning** persists. Not urgent, but code-splitting remains a future cleanup item.
- **Preset polygon quality** still varies. Many OSM-sourced/generated polygons need manual tracing or shapely/manual processing.
- **Langley AFB** script-generated preset exists but polygon is still mangled.

## Next Useful Work

1. Collect user feedback on Scenario Builder MVP.
2. Improve Scenario Builder UX based on observed friction.
3. Add a small admin/status doc or dashboard for usage metrics if needed.
4. Code-split large frontend bundle if the warning becomes painful.
5. Continue curated base polygon quality pass.

## Commands

From repo root:

```bash
cd frontend
npx tsc --noEmit
npx vitest run
npm run build
npm run dev
```

Deployment:

```bash
git push origin main
# GitHub Actions deploys to GitHub Pages
```

## Ground Rules

- Do not add a backend server unless Jeremy explicitly asks.
- Keep OpenSentry browser-local/static-site friendly.
- Do not block mission launch if usage tracking fails.
- Use `import.meta.env.BASE_URL` for static data paths.
- No real vendor/program designators unless Jeremy explicitly approves.
- Read files before edits; make small surgical changes.

---

*Updated 2026-05-17 after Scenario Builder MVP, multi-threat Wave Composer, usage tracking gate, and documentation refresh.*
