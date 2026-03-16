# SKYSHIELD — Open Source C-UAS Training Simulator

## Concept
A browser-based counter-drone training simulator that puts players in a tactical operations center, responding to drone incursions with realistic decision-making under pressure. Unclassified, but informed by real operational knowledge.

---

## MVP Feature Set (v0.1)

### Core Gameplay Loop
1. **Detect** — Drones appear on a radar-style display with varying signatures
2. **Identify** — Classify threat type (commercial quad, fixed-wing, swarm, decoy)
3. **Decide** — Choose response from available countermeasures
4. **Execute** — Deploy response, observe outcome
5. **Debrief** — Score breakdown: response time, correct ID, proportionality, collateral risk

### Threat Library (Sanitized / Unclassified)
| Scenario | Drone Type | Behavior | Difficulty |
|----------|-----------|----------|------------|
| Lone Wolf | Commercial quad (DJI-class) | Direct approach, low altitude | Easy |
| Recon Orbit | Fixed-wing | Circling pattern at standoff range | Medium |
| Swarm Probe | 3-5 small quads | Coordinated approach from multiple vectors | Hard |
| Decoy + Strike | Mixed | Decoy draws attention, strike drone flanks | Hard |
| False Alarm | Bird / weather balloon | Non-threat requiring correct ID | Easy |
| Low-Slow-Small | Micro drone | Barely detectable, close range | Expert |

### Countermeasure Options
| Response | Effective Against | Risk | Notes |
|----------|------------------|------|-------|
| RF Jamming | Commercial quads | Low | Ineffective vs autonomous nav |
| GPS Spoofing | GPS-dependent UAS | Medium | Collateral to friendly systems |
| Kinetic (Shooter) | All | High | Falling debris, ROE constraints |
| Net/Interceptor Drone | Quads, small fixed-wing | Low | Limited range, single use |
| Directed Energy | All | Low | Power requirements, LOS only |
| PACE Alert (Passive) | Recon threats | None | Observe only, report up |
| No Action | False alarms | None | Correct response for non-threats |

---

## Technical Architecture

```
┌─────────────────────────────────────┐
│           Browser Client            │
│  ┌───────────┐  ┌────────────────┐  │
│  │  Radar UI │  │ Decision Panel │  │
│  │ (Canvas)  │  │  (React)       │  │
│  └───────────┘  └────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │     Debrief / Score View      │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ WebSocket
┌──────────────▼──────────────────────┐
│         Python Backend (FastAPI)     │
│  ┌────────────┐  ┌───────────────┐  │
│  │  Scenario   │  │  Scoring      │  │
│  │  Engine     │  │  Engine       │  │
│  └────────────┘  └───────────────┘  │
│  ┌────────────┐  ┌───────────────┐  │
│  │  Drone AI   │  │  Physics /    │  │
│  │  Behaviors  │  │  Detection    │  │
│  └────────────┘  └───────────────┘  │
└─────────────────────────────────────┘
```

### Stack
- **Frontend:** React + HTML5 Canvas (radar display)
- **Backend:** Python / FastAPI (you know Python, keeps it accessible)
- **Comms:** WebSocket for real-time sim state
- **Data:** JSON scenario files (easy to author new ones)
- **Deployment:** Docker container or static deploy — runs anywhere

### Why This Stack
- Python because you're comfortable in it
- React because you're learning it — this is a real project to learn on
- Canvas for the radar — lightweight, no game engine needed
- JSON scenarios so anyone can contribute new threats without touching code

---

## Radar UI Concept

```
        ╭─────────────────────╮
       ╱    ·                  ╲
      │        ·  △              │
      │   ╱─────────╲   ·       │
      │  ·    ⬡ BASE  ·  △     │
      │   ╲─────────╱          │
      │        ·                 │
       ╲           ·           ╱
        ╰─────────────────────╯
  
  △ = Detected threat (unclassified)
  · = Radar noise / clutter
  ⬡ = Protected asset

  Bottom panel:
  ┌──────────────────────────────┐
  │ THREAT: UNK   RANGE: 2.4km  │
  │ ALT: 150ft    SPD: 35kts    │
  │                              │
  │ [CLASSIFY] [JAM] [KINETIC]  │
  │ [INTERCEPT] [OBSERVE] [DE]  │
  └──────────────────────────────┘
```

---

## Scoring System

| Factor | Weight | Criteria |
|--------|--------|----------|
| Response Time | 25% | Faster = better (within reason) |
| Correct ID | 30% | Did you classify the threat right? |
| Proportionality | 20% | Did you match response to threat level? |
| Collateral Avoidance | 15% | Did your response create secondary risks? |
| ROE Compliance | 10% | Did you follow rules of engagement? |

**Grades:** S (Perfect) → A → B → C → F (Base compromised)

---

## Development Phases

### Phase 1 — Proof of Concept (2-3 weeks)
- [ ] Static radar display with canvas
- [ ] Single scenario: "Lone Wolf" commercial quad
- [ ] Basic decision buttons → outcome display
- [ ] Simple scoring
- [ ] Runs locally

### Phase 2 — Core Sim (4-6 weeks)
- [ ] Multiple scenarios from threat library
- [ ] Real-time drone movement on radar
- [ ] Countermeasure effectiveness logic
- [ ] Debrief screen with scoring breakdown
- [ ] Scenario JSON format documented

### Phase 3 — Polish & Share (2-3 weeks)
- [ ] Tutorial / onboarding scenario
- [ ] Leaderboard (local)
- [ ] Dockerized deployment
- [ ] GitHub repo with README, LICENSE (MIT)
- [ ] Post to r/UAS, defense tech communities

### Phase 4 — Growth (Post-Launch)
- [ ] Multiplayer (team exercises)
- [ ] Community-contributed scenarios
- [ ] Integration with flight sim data
- [ ] Mobile-responsive version
- [ ] Training curriculum companion guide

---

## Monetization Paths (Optional, Post-Traction)
1. **Consulting addon** — "I built the sim, I'll run your team through it"
2. **Enterprise version** — Custom scenarios, AAR reports, LMS integration
3. **SBIR grant** — DoD small business innovation funding for training tools
4. **Conference demos** — AUSA, SOF Week, C-UAS summits

---

## Name Options
- **SKYSHIELD** ← current favorite
- **VANGUARD Sim**
- **Drone Guard Trainer**
- **Overwatch Sim** (might conflict with the game)

---

## OPSEC Notes
- ALL scenarios based on **unclassified, publicly available** threat data
- No real unit names, locations, or TTPs
- Drone behaviors based on commercial UAS specs (DJI, Autel, etc.)
- Countermeasure effectiveness based on published vendor data and open-source reporting
- When in doubt, sanitize harder

---

## Next Steps
1. Jeremy sketches 2-3 real-world-inspired scenarios (sanitized)
2. Alfred scaffolds the repo (Python + React)
3. Build the radar canvas prototype
4. Get one scenario working end-to-end
5. Iterate from there

---

*Created: March 15, 2026*
*Status: Planning*
