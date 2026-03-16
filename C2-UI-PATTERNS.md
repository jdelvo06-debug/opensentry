# C2 UI Patterns — Extracted from JCU Operator Course Materials

## FAAD C2 UI Patterns

### Hook Bubbles (Track Data Blocks)
- Left-click a track to "hook" it — Hook Bubble Summary appears in upper left of display
- Color matches track ID: Green=Friendly, Red=Hostile/Suspect, Yellow=Unknown
- Shows: track number, speed, heading, altitude, range, bearing, ID designation
- Lock icon (gold padlock) in upper right of bubble — locks it on screen
- Up to 3 additional items can be hooked simultaneously after locking
- Can also hook radars, cameras, weapons, and units (not just air tracks)
- "Hook by name" — search for a specific track number

### Pie Menu (Wheel of Death)
- Right-click any track to open a circular pie menu of shortcuts
- Menu color matches track ID (hostile=red, unknown=yellow, friendly=green)
- Pie menu segments include:
  - Fire Control Order (opens engagement submenu)
  - ID (opens Manual ID/Classification menu)
  - Event History
  - ISR Command (slew camera to track)
  - Hold Fire
  - "+" expander for secondary pie menu
- Secondary pie menu includes ISR camera commands
- Camera cue shows tracking cone on map that follows track, widens/narrows with zoom

### Track Symbology (UAV-specific)
- Unknown UAV: "U" with small "v" on top
- Friendly UAV: circle with small "v" on top
- Suspect UAV: "V" with small "v" on top
- Hostile UAV: diamond with small "v" on top
- Velocity indicator: no line=slow (<20m/s), short line=medium (20-160m/s), long line=fast (>160m/s)
- Coasting/extrapolated tracks become faded and stippled
- Coyote tracks disappear without stippling

### Track States & Alerts
- Track alerts: alarm sounds + track icon blinks on display + alert count visible
- Engaged tracks: icon blinks when engagement active
- Hold Fire: dashed box with "HF" in upper right surrounds track
- Bull's-eye overlay: range rings and azimuth lines from center reference point
- When bulls-eye active: background darkens, cursor shows range/azimuth from center

### Engagement Workflow
1. Hook track (left-click to select)
2. Right-click → pie menu → slew camera
3. Camera provides visual on track
4. Visual confirms non-friend UAV
5. Right-click → pie menu → ID → select classification + Process
6. Right-click → pie menu → Fire Control Order → select weapon → Engage/Process
7. Monitor engagement
8. Abort options: Cease Launch, Hold Fire (fastest), Change ID to Friend

### EW (Electronic Warfare) Engagement
- EW menu on navigation bar or via SFEW pie menu
- Options: All SFEW, By Area, By Label
- SFEW node begins "radiating" when engaged
- Redirect option: input MGRS coordinate to redirect EW

## MEDUSA C2 UI Patterns

### HMI Overview
- Android OS-based — works on tablets, monitors, laptops
- Army Globe Engine (AGE) — 3D mapping (like Google Earth) with 3D objects
- Video on Demand (VOD) for camera streaming through Medusa
- Tool Tray at bottom of screen with selectable buttons

### Wheel of Death (WOD) — 3 Types
1. **AGE WOD** — for map interactions
2. **Device WOD** — for sensor/effector control (cameras, radars, jammers)
3. **Threat WOD** — for threat track interactions (most complex)
   - Prioritizes devices in a predetermined order for engagement
   - Functions change based on the object it appears around

### Selection List
- If operator clicks near multiple objects (threats + devices), a selection list window opens
- List categorized by Threats and Devices
- Select desired object → respective WOD opens

### Map Overlays
- Protected Area: determines ETA and priority level based on proximity (purple, circle or polygon)
- Warning Area: offset from Protected Area for additional awareness
- Range rings and fans per device type
- Camera FOV: triangular fan that widens/narrows with zoom
  - Yellow line: Line of Sight
  - Green fill: actual field of view
- Saved Locations: quick reference to areas of interest, can navigate map quickly

### Camera Joystick
- Physical or virtual joystick for camera control
- Proficiency in joystick controls is a certification requirement
- Camera streams through VOD (Video on Demand)

### Detect & Track
- Detections Button for selecting tracks
- AGE map shows device types with specific icons
- Track affiliation assignment

### Identify
- Positive identification using camera (visual ID required)
- Camera joystick controls for slewing/zooming
- Track affiliation confirmation

### Defeat
- Duke engagement (EW system) — multiple methods available
- Engagement via WOD or menu system
- System prioritizes effectors for operator

## NINJA UI Patterns
- SDR Platform Manager interface
- Dashboard-based UI
- Emulator system available for training
- PMI and Troubleshooting workflows

## Key Features to Add to SKYSHIELD

### HIGH PRIORITY (directly improves realism)
1. **FAAD-style Hook Bubbles** — ALREADY ADDED (track data blocks)
2. **Wheel of Death** — ALREADY ADDED (radial action wheel)
3. **3 Types of WOD** (Medusa) — Add Device WOD for sensors/effectors, not just tracks
4. **Track Coasting** — When drone leaves sensor range, show faded/stippled icon extrapolating position
5. **Hold Fire indicator** — HF dashed box around tracks under hold fire
6. **Protected Area overlay** — Purple perimeter with ETA calculation
7. **Warning Area** — Buffer zone around protected area
8. **Camera tracking cone** — Show FOV cone on map following slewed track
9. **Bulls-eye overlay** — Range rings + azimuth from reference point (already have range rings)
10. **Selection list** — When clicking near multiple objects, show disambiguation list

### MEDIUM PRIORITY
11. **Velocity indicators on track icons** — Line length/presence based on speed
12. **Track alert system** — Alarm + blinking icon when track enters threshold
13. **Engagement visual feedback** — Blinking track during active engagement
14. **Saved Locations** — Quick nav bookmarks on the map
15. **Lock Hook Bubble** — Lock data blocks to persist on screen (up to 3)
16. **Keyboard navigation** — Alt key shortcuts like FAAD

### NICE TO HAVE
17. **EW radiate visual** — Show jamming pattern emanating from EW device
18. **Coyote intercept visualization** — Show interceptor track with waypoints
19. **Track coasting timer** — 24-26 second extrapolation before track drops
20. **Situational Awareness objects** — Player-created map annotations
