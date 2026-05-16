# Scenario Builder (Instructor Mode) — Implementation Plan

> **For Hermes:** Use subagent-driven-development with GPT-5.5 Codex subagents. Dispatch one subagent per task.

**Goal:** Build a visual scenario designer that lets instructors create custom C-UAS training scenarios from scratch — base selection, equipment constraints, wave composition, and instructor notes.

**Architecture:** New 4-step stepper component (`ScenarioBuilder.tsx`) following the exact BDA pattern. Reuses `BdaBaseSelection`, `BdaEquipmentSelection`, and `BdaPlacement` components directly. Step 3 is a new wave composer. Step 4 saves the scenario JSON to localStorage and launches the mission.

**Tech Stack:** React 19, TypeScript, existing BDA component library, localStorage API

---

## Task 1: Create `customScenarios.ts` localStorage utility

**Objective:** CRUD operations for custom-built training scenarios in localStorage

**Files:**
- Create: `frontend/src/utils/customScenarios.ts`

**What to build:**

```ts
// frontend/src/utils/customScenarios.ts
// Follows exact pattern of browserBasePresets.ts

const STORAGE_PREFIX = "opensentry.customScenario.";

export interface CustomScenario {
  id: string;           // unique slug
  name: string;         // display name
  instructorNotes: string;
  scenarioData: Record<string, unknown>;  // the full scenario JSON (matching existing format)
  baseId: string;
  createdAt: string;    // ISO timestamp
}

export function saveCustomScenario(scenario: CustomScenario): boolean
export function loadCustomScenario(id: string): CustomScenario | null
export function deleteCustomScenario(id: string): boolean
export function listCustomScenarios(): CustomScenario[]
export function generateScenarioId(name: string): string  // slugify + timestamp
```

**Verification:** Write a quick inline test or console.log to verify round-trip save/load.

---

## Task 2: Build `ScenarioBuilder.tsx` stepper shell

**Objective:** The main 4-step stepper component (mirrors `BaseDefenseArchitect.tsx`)

**Files:**
- Create: `frontend/src/components/ScenarioBuilder.tsx`
- Modify: `frontend/src/types.ts` — add `"scenario_build"` to `GamePhase`

**Architecture:**

The stepper shell holds all shared state across steps:
1. Base (same state shape as BDA: `selectedBaseId`, `baseTemplate`, `boundary`)
2. Equipment (same: `selectedEquipment` of type `SelectedEquipment`)
3. Waves (new: `WaveDef[]` array)
4. Scenario name + instructor notes (new: strings)

Steps:
- **Step 1:** `<BdaBaseSelection>` — exact same component, no modifications
- **Step 2:** `<BdaEquipmentSelection>` — exact same component, no modifications  
- **Step 3:** `<WaveComposer>` — brand new (see Task 3)
- **Step 4:** `<ScenarioSummary>` — name, notes, save, launch (new, part of this task)

**Step 4 (ScenarioSummary) is built inline in this task** — it's a simple panel that shows:
- Scenario name text input
- Instructor notes textarea
- Read-only summary of what's been configured (base name, equipment count, wave count)
- "Save Scenario" button → calls `saveCustomScenario()`
- "Launch Scenario" button → calls `onLaunchScenario(scenarioObject)` passed from App

**Props:**
```ts
interface Props {
  onBack: () => void;
  onLaunchScenario: (scenario: Record<string, unknown>, baseId: string, placement: PlacementConfig) => void;
}
```

**Launch flow:**
When the user clicks Launch, the builder:
1. Assembles the full scenario JSON in the existing format (matching `lone_wolf.json` structure)
2. Builds a `PlacementConfig` from the placed systems and boundary
3. Calls `onLaunchScenario(scenarioJson, baseId, placementConfig)`

**Verification:** Component compiles, `npm run build` succeeds.

---

## Task 3: Build `WaveComposer.tsx` sub-component

**Objective:** The wave builder UI — the heart of this feature

**Files:**
- Create: `frontend/src/components/WaveComposer.tsx`

**Design:**

Three-panel layout:

**Left panel — Wave List:**
- "Add Wave" button at top
- Each wave is a card: "Wave 1: 3× commercial_quad from NE @ T+0:30"
- Click to select/edit, drag to reorder (or just up/down buttons for V1), X to delete
- Shows sequence: Wave 1 → Wave 2 → Wave 3

**Center panel — Wave Editor (visible when a wave is selected):**
- Drone type dropdown: `commercial_quad`, `micro`, `fixed_wing`, `improvised`, `improvised_hardened`, `shahed`
- Count: number input (1-10)
- Spawn sector: 8-button compass rose (N, NE, E, SE, S, SW, W, NW)
- Delay from mission start: seconds input (0-600)
- Stagger between drones: seconds input (0-30)
- Altitude: meters input (10-5000)
- Speed: knots input (5-500)
- Behavior dropdown: `direct_approach`, `evasive`, `orbit`, `waypoint_path`

**Right panel — Timeline Preview:**
- Simple horizontal timeline showing when each wave hits
- Each wave as a colored bar positioned by its start delay
- Quick visual sanity check: "Is Wave 3 spawning before Wave 2 hits?" etc.

**WaveDef type:**
```ts
export interface WaveDef {
  id: string;          // "wave-1", "wave-2", etc.
  droneType: string;   // matches DroneType
  count: number;
  spawnSector: string; // "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"
  delaySeconds: number;
  staggerSeconds: number;
  altitude: number;
  speed: number;
  behavior: string;
}
```

**Logic to convert WaveDef → scenario drone entries:**
When assembling the final scenario JSON, the WaveComposer converts each WaveDef into one or more `DroneStartConfig` entries (matching the `drones[]` array in `lone_wolf.json`). Each drone gets:
- A unique ID
- `start_x`/`start_y` computed from the spawn sector (polar → cartesian at ~4-5km distance)
- `heading` computed toward base center
- `spawn_delay` = wave delay + (drone index × stagger)
- Correct classification/affiliation/effectors derived from drone type (use the existing template data from `waves.ts`)

**Verification:** Component compiles, wave list shows, can add/edit/delete waves.

---

## Task 4: Wire into App.tsx and enhance DebriefScreen

**Objective:** Connect the ScenarioBuilder to the app's state machine and add instructor notes to debrief

**Files:**
- Modify: `frontend/src/App.tsx`
  - Add `"scenario_build"` to GamePhase (in types.ts, done in Task 2)
  - Add new phase handler: render `<ScenarioBuilder>` when `phase === "scenario_build"`
  - Add `handleScenarioBuildLaunch` — receives scenario object + baseId + placement, sets them, goes to roe_briefing → equip flow
  - Engine change: allow scenario JSON to be passed inline instead of only fetched from URL. The simplest approach: add a `customScenario` ref/state that, when set, the game engine uses instead of fetching from `/data/scenarios/...`
- Modify: `frontend/src/components/LandingPage.tsx`
  - Add `onScenarioBuilder` prop
  - Add "SCENARIO BUILDER" button in the CTAs section (next to Custom Mission and BDA)
- Modify: `frontend/src/components/DebriefScreen.tsx`
  - Add optional `instructorNotes?: string` prop
  - When present, render a section at the bottom: "INSTRUCTOR NOTES" header + the notes text

**Engine change detail:**
The key insight: `useGameEngine.ts` currently takes a `scenarioId` and fetches from `/data/scenarios/${scenarioId}.json`. We need to support passing a full scenario object directly. 

Add an optional `customScenario` field to the game engine's config/connect function. When present, skip the fetch and use it directly.

Simplest approach in App.tsx:
```ts
const [customScenario, setCustomScenario] = useState<Record<string, unknown> | null>(null);
// Pass customScenario to useGameEngine; when set, engine uses it instead of the fetch
```

**Verification:** 
- Landing page shows Scenario Builder button
- Clicking it → ScenarioBuilder renders
- Build a scenario → Launch → game starts with custom scenario
- Debrief shows instructor notes

---

## Task 5: Run tests, verify build, commit

**Objective:** Make sure everything works, nothing regressed

**Steps:**
1. `cd frontend && npx vitest run` — all 78 tests must pass
2. `cd frontend && npm run build` — must succeed with no TS errors
3. Manual smoke test: `npm run dev`, navigate to landing page, click Scenario Builder
4. Verify existing flows (quick launch, custom mission, BDA) still work
5. `git add -A && git commit -m "feat: scenario builder for instructor mode (closes #33)"`
6. Push branch: `git push -u origin feature/scenario-builder`

---

## Sequence

Tasks must run in order: 1 (utility) → 2 (stepper + types) → 3 (wave composer) → 4 (App wiring) → 5 (verify)

Tasks 2 and 3 could theoretically be parallel if 3 builds the WaveComposer as a standalone component first, but it's safer sequential — Task 2 creates the shell that Task 3 slots into.
