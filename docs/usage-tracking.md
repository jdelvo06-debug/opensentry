# OpenSentry Usage Tracking

OpenSentry is hosted on GitHub Pages as a static browser app. Usage tracking is implemented without adding a backend server.

## Purpose

The launch gate exists to understand adoption and improve the simulator. It is not an access-control system and should not block training.

Current privacy copy shown to users:

> This helps track OpenSentry usage and improve the simulator. Information submitted here is used for internal usage metrics only and is not sold, shared, or used for marketing.

## User Flow

Before a simulation launch, users see a short usage gate before the ROE briefing.

Fields:

- Unit — required
- Name — optional
- Email — optional

The gate appears for both:

- Standard scenario launches
- Scenario Builder custom scenario launches

For developer convenience, the app skips the gate automatically on local development hosts:

- `localhost`
- `127.0.0.1`
- `[::1]`

On the live site, the last submitted unit/name/email is saved in browser `localStorage` and prefilled on future launches.

A SKIP path remains available. Tracking is for metrics, not authentication.

## Data Captured

Rows are appended to the `OpenSentry Usage Tracker` Google Sheet with these columns:

- Timestamp
- Unit
- Name
- Email
- Scenario

## Architecture

- Frontend component: `frontend/src/components/UnitGate.tsx`
- Tracking utility: `frontend/src/utils/tracking.ts`
- App phase: `unit_gate` in `frontend/src/types.ts`
- Launch flow: `frontend/src/App.tsx`
- Apps Script source copy: `apps-script/tracking/Code.gs`

Flow:

1. User selects or builds a scenario.
2. App sets up `pendingRoeLaunchRef` as normal.
3. App enters `unit_gate` instead of jumping directly to `roe_briefing`.
4. `UnitGate` posts `{ unit, name, email, scenario }` to the Apps Script web app.
5. Apps Script appends a row to the Google Sheet.
6. App proceeds to `roe_briefing` whether tracking succeeds or fails.

## Apps Script Deployment

The Apps Script web app must be deployed manually from the Google Apps Script editor.

Required deployment settings:

- Deployment type: Web app
- Execute as: Me
- Who has access: Anyone

The deployed `/exec` URL is configured in `frontend/src/utils/tracking.ts`.

## CORS Note

The frontend intentionally omits `Content-Type: application/json` on the POST request. This keeps the request simple and avoids a browser CORS preflight, which Google Apps Script web apps often handle poorly.

Do not add JSON content-type headers unless the endpoint is reworked and browser-tested.

## Verification

Before shipping usage-tracking changes:

```bash
cd frontend
npx tsc --noEmit
npx vitest run
npm run build
```

Then verify the live Apps Script endpoint still returns `{"ok":true}` and that a test row appears in the Google Sheet.

Example endpoint test:

```bash
curl -s -L -X POST '<apps-script-exec-url>' \
  --data '{"unit":"QA Test Unit","name":"Cortana","email":"","scenario":"Endpoint Verification"}'
```

Expected response:

```json
{"ok":true}
```

## Known Pitfalls

- `doPost(e)` must be top-level in Apps Script. Do not nest it inside `myFunction()`.
- After changing Apps Script code, deploy a **new version**. Saving alone does not update the deployed web app.
- Copy the **Web app URL** from deployment details, not the browser address bar.
- If `curl -L -X POST` returns a 405 after redirect, try `curl -L` without forcing `-X POST`; Google’s redirect host can be picky.
- Tracking failure must not block launch.
