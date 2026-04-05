> **COMPLETED** — All 5 features implemented across v1.1.0–v1.8.0: Base Defense Planner (#54), Equipment Loadout, EO/IR Camera Panel, Updated Identify Workflow, and Full Training Flow.
> This file is retained as design documentation.

# Claude Code Session Prompt — Phase 2 Features

Copy-paste this into Claude Code when you're ready to work on SKYSHIELD.

---

## The Prompt

```
Read CLAUDE.md for full project context, then implement these Phase 2 features:

### 1. BASE DEFENSE PLANNER (Key Feature — Build Before You Fight)
Add a pre-mission planning phase where the player places sensors and effectors on a map of their base/FOB. This is the "cradle to grave" training flow: PLAN → EQUIP → EXECUTE → DEBRIEF.

**Base Templates:**
Create 3-4 base map templates the player can choose from:
- Small FOB (Forward Operating Base) — compact, limited entry points, tight perimeter
- Medium Airbase — runway, hangars, flight line, ATC tower as protected asset
- Large Installation — multiple protected assets, wider perimeter, more complex
- Custom (stretch goal) — player drops buildings/assets on a blank map

Each template is a JSON file in `backend/bases/` with:
- Base boundary polygon (perimeter)
- Protected assets (what must be defended) — each with a name, position, priority
- Terrain features (buildings, towers, berms, treelines) that block LOS for sensors/effectors
- Entry points / known threat approach corridors
- Pre-placed roads, structures, landing pads as visual reference

**Sensor/Effector Placement Phase:**
After selecting a base template and equipment loadout, the player enters a PLACEMENT screen:
- Top-down view of the base map (same dark tactical theme)
- Player drags-and-drops their selected sensors and effectors onto the map
- As they place each item, show its COVERAGE ARC / RANGE RING on the map:
  - Radar: full 360° circle
  - RF Detector: 360° circle (but shows bearing accuracy degrades at range)
  - EO/IR Camera: limited FOV cone (maybe 60-90° arc) — player sets the direction it faces
  - Acoustic: small 360° circle
  - Effectors: range ring showing engagement envelope
- Show coverage gaps visually — areas with NO sensor coverage highlighted in red/orange
- Show overlapping coverage — areas with 2+ sensors in a different shade (this is where confidence will be highest during the mission)
- Terrain/buildings that block LOS should cast "shadow" zones for LOS-dependent sensors (EO/IR, DE)

**How Placement Affects the Mission:**
- The positions the player chose ARE the positions during gameplay
- If they left a gap in coverage, drones can approach through it undetected
- If they placed EO/IR facing the wrong direction, they can't slew to targets on the blind side
- Effector placement determines engagement range to different approach vectors
- Good placement = easier mission. Bad placement = harder mission. Natural difficulty scaling.

**Placement Scoring (added to debrief):**
After the mission, debrief includes a "Defense Planning" score:
- Coverage completeness (% of approach vectors covered)
- Sensor overlap quality (multi-sensor correlation zones)
- Effector positioning (can they reach threats before they reach assets?)
- LOS management (did buildings block critical sensor views?)

Store base templates in `backend/bases/` as JSON files. Store the player's placement config so it can be replayed/shared.

### 2. EQUIPMENT LOADOUT MENU
Before the placement phase, add a pre-mission equipment selection screen where the player builds their loadout. Categories:

**SENSORS (pick 3-4 from available pool):**
- AN/TPQ-51 Radar (long range, all-weather, 360° coverage)
- RF-300 Direction Finder (medium range, RF-emitting targets only, 360°)
- EO/IR Camera System (short range, visual ID capability, limited FOV cone)
- Acoustic Array (very short range, passive detection, 360°)
- ADS-B Receiver (cooperative targets only, identifies transponder-equipped aircraft)

**EFFECTORS (pick 2-3 from available pool):**
- RF Jammer (electronic attack, rechargeable, effective vs commercial drones)
- GPS Spoofer (electronic attack, redirects GPS-dependent UAS, collateral risk to friendly GPS)
- JACKAL (kinetic interceptor missile, single-use, high effectiveness)
- MADIS Stinger (kinetic, shoulder-launched missile, single-use)
- Drone Interceptor / Net Gun (net capture drone, single-use, low collateral)
- HELWS / Directed Energy (high-energy laser, rechargeable, LOS only, short range)
- LMADIS EW Suite (electronic warfare package, jam + spoof combo)

**KINETIC/MUNITIONS OPTIONS:**
- 30mm Proximity Round (area effect, high collateral risk)
- .50 Cal HMG (direct fire, requires skilled gunner)
- Shotgun / Counter-Drone Shell (very short range, last resort)

Each item should show: name, type, effective range, reload/recharge time, pros, cons, and a brief description. The loadout affects what's available during the placement phase and the mission. Different scenarios might recommend different loadouts but the player always chooses.

Store equipment definitions in a new JSON file: `backend/equipment/catalog.json`

### 3. EO/IR CAMERA PANEL (Critical Feature)
Add a camera view panel that simulates an EO/IR camera feed. This is how the player visually identifies targets during the IDENTIFY phase of DTID.

**How it works:**
- When a track is selected and within EO/IR range AND within the camera's FOV (based on where they placed it), a "SLEW CAMERA" button appears
- Clicking it opens/activates a camera panel (can be a modal overlay or a dedicated panel area)
- The camera view shows a simulated view of the sky with:
  - A rendered silhouette/image of the drone type against a sky background
  - Camera crosshairs / reticle overlay
  - Range, bearing, elevation data overlaid on the camera feed
  - Zoom level indicator
- The drone image should vary by type:
  - Commercial quad (DJI-style 4-rotor silhouette)
  - Fixed-wing (airplane-like silhouette)
  - Micro drone (tiny, hard to see)
  - Bird (for false alarm scenarios — looks like a bird, not a drone)
  - Weather balloon (round, floating)
  - Improvised / homemade (irregular shape)
- Image clarity depends on range: closer = clearer, farther = grainier/harder to see
- Player uses the camera view to make their classification decision
- This replaces the old dropdown-style classification — now it's VISUAL identification

**Camera panel should look like a real EO/IR display:**
- Dark/thermal color palette (grayscale or green-tint thermal look)
- HUD overlay with targeting data
- Slight static/noise effect that reduces as drone gets closer
- Crosshair/reticle in center

The silhouettes can be simple Canvas-drawn shapes — don't need actual images. But make them distinct enough that the player can tell a quad from a fixed-wing from a bird.

### 4. UPDATED IDENTIFY WORKFLOW
With the camera panel, the IDENTIFY step changes:
1. Player clicks "SLEW CAMERA" on a tracked target (only available if target is in camera FOV)
2. Camera panel opens with the drone visual
3. Player looks at the silhouette and picks classification from buttons: COMMERCIAL QUAD | FIXED WING | MICRO DRONE | BIRD | WEATHER BALLOON | IMPROVISED
4. Player also sets affiliation: HOSTILE | FRIENDLY | NEUTRAL
5. If they get it wrong, scoring penalizes them in the Identification category
6. If target is NOT in camera FOV, player must identify based on sensor data alone (harder, lower confidence)

Make sure the camera panel is visually distinct from the map — it should feel like a separate screen/feed, like looking through a real camera mounted on a sensor mast.

### 5. FULL TRAINING FLOW
The complete user flow should now be:
1. **SELECT SCENARIO** — Choose scenario (Lone Wolf, etc.) + base template
2. **EQUIP** — Select sensors and effectors from the catalog
3. **PLAN** — Place equipment on the base map, review coverage
4. **EXECUTE** — Run the DTID mission with your planned defense layout
5. **DEBRIEF** — Score on planning + execution (both matter)

This is a cradle-to-grave C-UAS training loop. The goal: a military member at a base with zero C-UAS training resources can use this to practice planning AND executing base defense.

Keep all existing functionality working. Add the new screens/phases to the game flow. The base planner and loadout are new screens BEFORE the active mission.
```

---

*This file is committed to the repo. After cloning on your M4, open it and paste the prompt section into Claude Code.*
