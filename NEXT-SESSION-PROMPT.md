# Claude Code Session Prompt — Phase 2 Features

Copy-paste this into Claude Code when you're ready to work on SKYSHIELD.

---

## The Prompt

```
Read CLAUDE.md for full project context, then implement these Phase 2 features:

### 1. EQUIPMENT LOADOUT MENU
Before starting a scenario, add a pre-mission equipment selection screen where the player builds their loadout. Categories:

**SENSORS (pick 3-4 from available pool):**
- AN/TPQ-50 Radar (long range, all-weather)
- RF-300 Direction Finder (medium range, RF-emitting targets only)
- EO/IR Camera System (short range, visual ID capability)
- Acoustic Array (very short range, passive detection)
- ADS-B Receiver (cooperative targets only, identifies transponder-equipped aircraft)

**EFFECTORS (pick 2-3 from available pool):**
- RF Jammer (electronic attack, rechargeable, effective vs commercial drones)
- GPS Spoofer (electronic attack, redirects GPS-dependent UAS, collateral risk to friendly GPS)
- Coyote Block 3 (kinetic interceptor missile, single-use, high effectiveness)
- MADIS Stinger (kinetic, shoulder-launched missile, single-use)
- Drone Interceptor / Net Gun (net capture drone, single-use, low collateral)
- HELWS / Directed Energy (high-energy laser, rechargeable, LOS only, short range)
- LMADIS EW Suite (electronic warfare package, jam + spoof combo)

**KINETIC/MUNITIONS OPTIONS:**
- 30mm Proximity Round (area effect, high collateral risk)
- .50 Cal HMG (direct fire, requires skilled gunner)
- Shotgun / Counter-Drone Shell (very short range, last resort)

Each item should show: name, type, effective range, reload/recharge time, pros, cons, and a brief description. The loadout affects what's available during the scenario. Different scenarios might recommend different loadouts.

Store equipment definitions in a new JSON file: `backend/equipment/catalog.json`

### 2. EO/IR CAMERA PANEL (Critical Feature)
Add a camera view panel that simulates an EO/IR camera feed. This is how the player visually identifies targets during the IDENTIFY phase of DTID.

**How it works:**
- When a track is selected and within EO/IR range, a "SLEW CAMERA" button appears
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

### 3. UPDATED IDENTIFY WORKFLOW
With the camera panel, the IDENTIFY step changes:
1. Player clicks "SLEW CAMERA" on a tracked target
2. Camera panel opens with the drone visual
3. Player looks at the silhouette and picks classification from buttons: COMMERCIAL QUAD | FIXED WING | MICRO DRONE | BIRD | WEATHER BALLOON | IMPROVISED
4. Player also sets affiliation: HOSTILE | FRIENDLY | NEUTRAL
5. If they get it wrong, scoring penalizes them in the Identification category

Make sure the camera panel is visually distinct from the map — it should feel like a separate screen/feed, like looking through a real camera mounted on a sensor mast.

Keep all existing functionality working. The loadout menu is a new screen between the start screen and the active mission. The camera panel integrates into the existing right sidebar or as an overlay during the IDENTIFY phase.
```

---

*Save this file in the repo so it's accessible from your M4 after clone.*
