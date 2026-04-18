# OpenSentry — Training Curriculum Design
**Version 1.1 | April 4, 2026**
**Aligned to: AFJQS 3CS (C-sUAS SEI), ATP 3-01.81 (May 2025), JCO C-sUAS Playbook**

---

## Purpose

OpenSentry is a system-agnostic, browser-based C-UAS training simulator designed to prepare operators at any level for the cognitive and procedural demands of the DTID kill chain. This curriculum maps OpenSentry scenarios to real doctrinal standards, defines learning objectives with measurable performance criteria, and provides a structured progression from novice to proficient operator.

**Target Audience:** Any military or civilian personnel assigned a C-UAS duty position — regardless of platform or service branch.

**Entry Requirement:** None. No prior C-UAS experience required for Module 1.

---

## Doctrinal Alignment

| Doctrine | Relevance to OpenSentry |
|----------|------------------------|
| AFJQS 3CS (C-sUAS Operators, Mar 2023) | Core operator tasks, GO/NO GO standards, MQT requirements |
| ATP 3-01.81 (May 2025) | DTID framework, ROE, layered defense, threat characterization |
| DoD C-sUAS Quick Reference Guide | Threat classification, effector selection logic |
| JCO C-sUAS Playbook | Engagement authority, reporting procedures, multi-sensor fusion |

---

## Curriculum Structure

### Five-Module Progression

```
MODULE 1 → MODULE 2 → MODULE 3 → MODULE 4 → MODULE 5
Foundation  Procedures  Discipline  Complexity  Mastery
(Tutorial)  (Lone Wolf) (Recon)     (Swarm)     (Custom)
```

---

## MODULE 1 — Foundation of the DTID Kill Chain
**OpenSentry Scenario:** Tutorial
**Difficulty:** Beginner | **Time:** 20–30 min

### Learning Objectives
Upon completion, the operator will be able to:

1. **Identify** the four phases of the DTID kill chain (Detect, Track, Identify, Defeat) and explain the purpose of each phase
2. **Demonstrate** use of the L-Band surveillance radar to detect an inbound UAS contact
3. **Confirm** a track using the track confirmation function and explain why track correlation is required before engagement
4. **Slew** the EO/IR camera to a detected track and classify the threat type using visual silhouette identification
5. **Select** an appropriate low-collateral effector (`RF/PNT Jammer` or `DE-LASER-3km`) and engage a commercial quad-type UAS
6. **State** the primary limitation of RF/PNT jamming (ineffective against autonomous/INS-navigated threats) and the primary limitation of `DE-LASER-3km` (line of sight required)

### Performance Standards (GO/NO GO)
| Task | GO Criteria |
|------|------------|
| Radar detection | Contact detected within 10s of drone entering radar range |
| Track confirmation | Track confirmed before engagement — no unconfirmed engagements |
| Camera slew & ID | Correct threat classification (hostile commercial quad) before defeat action |
| Effector selection | RF/PNT Jammer or DE-LASER-3km selected (not JACKAL) for commercial quad — acceptable low-collateral choice |
| Engagement | Drone neutralized before reaching protected area |

### Key Concepts Introduced
- Sensor vs. effector roles
- Why you identify before you engage (ROE implications)
- EO/IR camera thermal vs. daylight mode
- DE-LASER-3km as a precision alternative to jamming
- Jam resistance concept (introduced, not tested here)

---

## MODULE 2 — Procedural Fluency Under Time Pressure
**OpenSentry Scenario:** Lone Wolf (Easy)
**Difficulty:** Easy | **Time:** 15–25 min

### Learning Objectives
Upon completion, the operator will be able to:

1. **Execute** the full DTID kill chain without prompting or tutorial guidance
2. **Use** the Radial Action Wheel (right-click) to access engagement options efficiently
3. **Operate** NEXUS protocol manipulation and correctly progress from 1/2 (downlink) to 2/2 (uplink) state
4. **Select** between RF jamming and NEXUS based on situational factors (range, threat type)
5. **Monitor** the event log and track list simultaneously while maintaining engagement focus
6. **Complete** the mission and interpret the debrief score by category

### Performance Standards (GO/NO GO)
| Task | GO Criteria |
|------|------------|
| Time to first engagement | Engagement initiated within 60 seconds of detection |
| Kill chain sequencing | No engagement before identification — zero ROE violations |
| Debrief interpretation | Operator can explain each score category without assistance |
| NEXUS proficiency | If NEXUS used, operator understands 1/2→2/2 progression and selects appropriate defeat mode |

### Key Concepts Introduced
- NEXUS 4-band RF detection (2.4/5.8/430/900 MHz)
- Defeat mode selection: HOLD vs. LAND NOW vs. DEAFEN
- Effector recharge cycles
- Track data block interpretation (speed, altitude, heading, ETA)

---

## MODULE 3 — Rules of Engagement and Threat Discrimination
**OpenSentry Scenario:** Recon Probe (Medium)
**Difficulty:** Medium | **Time:** 20–35 min

### Learning Objectives
Upon completion, the operator will be able to:

1. **Apply** ROE to determine engagement authority — distinguish between hostile, unknown, and non-engageable contacts
2. **Demonstrate** trigger discipline by correctly identifying which of 3 tracks requires engagement vs. monitoring
3. **Justify** a hold-fire or no-engagement decision for non-threatening contacts
4. **Use** the Hold Fire function on a track and explain when it is operationally appropriate
5. **Describe** the consequences of a ROE violation (friendly fire, civilian aircraft engagement) in a real-world context
6. **Recognize** ambient traffic types (birds, balloons, commercial aircraft) and classify them correctly

### Performance Standards (GO/NO GO)
| Task | GO Criteria |
|------|------------|
| Correct engagement decisions | Zero ROE violations — no birds, balloons, or neutral tracks engaged |
| Correct non-engagement decisions | Surveillance-only contacts correctly identified and not engaged |
| Hold Fire usage | Applied correctly to at least one ambiguous track |
| Threat discrimination accuracy | ≥ 2/3 hostile tracks correctly ID'd and defeated; non-hostile tracks untouched |

### Key Concepts Introduced
- ROE structure in C-UAS operations (positive ID requirement)
- Difference between surveillance UAS and attack UAS — intent assessment
- CLEAR AIRSPACE function and ATC coordination
- When NOT to engage is as important as when to engage

---

## MODULE 4 — Multi-Threat Management and Effector Economy
**OpenSentry Scenario:** Swarm Attack (Hard)
**Difficulty:** Hard | **Time:** 25–45 min

### Learning Objectives
Upon completion, the operator will be able to:

1. **Prioritize** 5 simultaneous tracks by threat severity using ETA-to-base as the primary triage metric
2. **Manage** effector economy — conserve JACKAL rounds, sequence jammer recharges, avoid simultaneous dry periods
3. **Recognize** and correctly respond to a Shahed-style autonomous threat (jam-immune, kinetic defeat only)
4. **Operate** under active jammer interference — adapt tactics when enemy EW affects friendly sensors
5. **Coordinate** simultaneous engagements using multiple effector types on different targets, including `DE-HPM-3km` for clustered drones and `DE-LASER-3km` for precision follow-up
6. **Maintain** awareness of all 5 tracks while actively engaging 2+ contacts

### Performance Standards (GO/NO GO)
| Task | GO Criteria |
|------|------------|
| Shahed identification | Shahed-style threat correctly identified as jam-immune; JACKAL or kinetic used |
| JACKAL economy | ≤ 2 JACKAL rounds wasted on jammable targets (jammer should handle those) |
| DE employment | `DE-HPM-3km` used on clustered/swarm contacts; `DE-LASER-3km` reserved for isolated, line-of-sight targets |
| Track management | No hostile track reaches the protected area unengaged |
| Multi-effector coordination | At least 2 different effector types used simultaneously in correct application |
| Threat prioritization | Closest/fastest tracks engaged first — documented in debrief event log |

### Key Concepts Introduced
- Autonomous/INS-navigated threat recognition (Shahed class)
- Layered defense — kinetic as last resort, EW as first
- Directed energy employment — HPM for swarms, laser for precision single-target defeat
- Jammer mutual exclusion effects on friendly GPS
- Swarm tactics and saturation risk

---

## MODULE 5 — Operator Proficiency Assessment (Custom Mission)
**OpenSentry Scenario:** Custom (User-defined location and loadout)
**Difficulty:** Variable | **Time:** 30–60 min

### Purpose
Evaluate operator ability to apply all prior skills in an unscripted environment. Operator defines the base location, configures equipment placement, selects scenario, and executes the mission with no in-game guidance.

### Learning Objectives
Upon completion, the operator will be able to:

1. **Configure** a realistic C-UAS defensive layout using the placement screen (sensor coverage, effector positioning, protected area sizing)
2. **Identify** coverage gaps in their own layout before mission execution
3. **Execute** a full mission in an unfamiliar environment without tutorial assistance
4. **Self-assess** performance using the debrief screen and identify areas for improvement
5. **Brief** a notional OPLAN for the configured defensive position (verbal or written — instructor-evaluated)

### Performance Standards (GO/NO GO)
| Task | GO Criteria |
|------|------------|
| Sensor placement | Radar and EO/IR positioned to cover primary approach corridors |
| Effector positioning | JACKAL within Ku-Band FCS coverage; jammer within 5km of likely threat axes |
| Mission execution | Zero unengaged hostile tracks reaching protected area |
| Debrief self-assessment | Operator correctly identifies at least 2 areas for improvement from their own score |

---

## Assessment Framework

### Three-Tier Evaluation Model

```
TIER 1: Knowledge Check (Pre-sim)
  Multiple choice — threat recognition, effector capabilities, ROE basics
  Required score: 70% to proceed to Tier 2

TIER 2: Simulator Performance (In-sim)
  GO/NO GO on critical tasks per module
  All asterisked tasks = required GO for module completion

TIER 3: Oral/Written Debrief (Post-sim)
  Instructor-led discussion of decisions made
  "Why did you engage TGT-3 before TGT-1?"
  Maps to AFJQS Stan Eval Phase II requirements
```

### Scoring Philosophy
OpenSentry debrief scores map to curriculum outcomes as follows:

| Debrief Category | Curriculum Objective |
|-----------------|---------------------|
| Threat Neutralization | DTID kill chain execution |
| ROE Compliance | Engagement authority / trigger discipline |
| Effector Selection | Equipment knowledge and application |
| Response Time | Procedural fluency under time pressure |
| Protected Area | Priority management and threat triage |

---

## Course Completion Pathways

### Path A — Individual Self-Paced
1. Complete Modules 1–4 in sequence
2. Achieve GO on all critical tasks per module
3. Complete Module 5 custom mission
4. Submit debrief screenshot + self-assessment notes

### Path B — Unit Training Event (4-hour block)
| Time | Activity |
|------|----------|
| 0:00–0:30 | Pre-brief: C-UAS overview, DTID framework, ROE review |
| 0:30–1:00 | Module 1 (Tutorial) — all operators |
| 1:00–1:45 | Module 2 (Lone Wolf) — individual reps |
| 1:45–2:30 | Module 3 (Recon Probe) — debrief and discussion |
| 2:30–3:15 | Module 4 (Swarm Attack) — challenge rep |
| 3:15–3:45 | Module 5 (Custom) — operator-configured defense |
| 3:45–4:00 | Post-brief: instructor-led debrief, Q&A |

### Path C — Stan Eval Prep (Fits AFJQS 3CS MQT/Phase II)
Modules 3 and 4 are the evaluation scenarios. Module 3 maps directly to ROE/engagement authority (critical task, asterisked). Module 4 maps to multi-threat management and effector employment.

---

## Gaps OpenSentry Should Close (Future Development)

| Gap | Proposed Feature |
|-----|-----------------|
| No pre-sim knowledge check | Add knowledge check screen before Module 1 |
| Debrief doesn't capture ROE violations explicitly | Add ROE violation counter to debrief scoring |
| No instructor mode | Add read-only observer view for unit trainer |
| No printable completion certificate | Generate PDF debrief on mission complete |
| No structured scenario progression lock | Lock Module N+1 until Module N is completed |

---

## Supporting References

- AFJQS 3CS — C-sUAS Operators (DAF, Mar 15 2023)
- ATP 3-01.81 — Counter-Unmanned Aircraft System Operations (Army, May 2025)
- DoD C-sUAS Quick Reference Guide (JCO)
- JCO C-sUAS Playbook
- DAFI 36-2670 — Total Force Development

---
*OpenSentry is not a replacement for system-specific IQT. It is a pre-qualification familiarization tool and procedural trainer designed to reduce time-to-proficiency on system-specific platforms.*
