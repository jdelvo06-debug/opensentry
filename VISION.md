# OpenSentry — Vision & Roadmap

## Mission
Free, browser-based C-UAS training simulator that any military member worldwide can use to train on the DTID kill chain — even if they don't have real systems at their base.

## Target User
"The E-5 who gets handed the C-UAS binder and told to figure it out."

## Core Principles
- Cradle-to-grave: continuous watch, not isolated scenarios
- Realistic: mirrors real-world C-UAS C2 workflows
- Accessible: runs in a browser, no install, no clearance needed for the tool itself
- Free: open source, zero infrastructure cost for end users

## Systems Modeled
- **Radial action wheel** — pie menu-style engagement workflow (track management, effector selection)
- **Device management** — sensor/effector status, range rings, coverage overlays
- **Sensors:** AN/TPQ-51, Ku-Band FCS, EO/IR Camera
- **Effectors:** JACKAL, RF/PNT Jammer
- **Network:** Joint Data Network (Link-16, SIAP)

## Key Features (Planned)

### JACKAL Intercept (Full Lifecycle)
- Green JACKAL track appears on tactical map at launch
- Ku-Band FCS radar guides mid-course (waypoints to avoid friendly air tracks — ATA)
- Terminal phase: seeker acquires target
- Impact: explosion on camera feed + map
- Failure: self-destruct at 100m+ altitude
- Track management: Jackal shows as friendly track during flight
- Hold Fire / Cease Fire commands work on in-flight Jackals


### Joint Data Network / SIAP
- Simulated network of multiple C2 nodes
- Shared air picture (tracks disseminated between nodes)
- External track sources (Link-16 feeds)
- Track correlation (same physical object, different track numbers)
- ID Authority (IDA) concept — who has authority to identify
- Bulls-eye reference point for range/azimuth calls

### Continuous Operations
- No auto-end — operator maintains watch until END MISSION
- Escalating threat waves with pauses between
- Ambient air traffic (commercial, military, birds, balloons)
- Realistic EW effects (jamming → drone behavior change, not instant defeat)
- Shift handoff concept (stretch)

### Scoring & AAR
- Per-wave and cumulative scoring
- ROE tracking (friendly fire penalties)
- After-action replay (timeline scrub)
- Training metrics: reaction time, correct identification rate, engagement effectiveness

### Deployment
- Eventually: all client-side JavaScript (no server needed)
- Hosted on free static hosting for zero-cost global access
- Offline-capable (PWA)
- Mobile/tablet responsive for field demos
