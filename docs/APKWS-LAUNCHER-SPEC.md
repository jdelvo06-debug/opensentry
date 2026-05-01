# APKWS Launcher — Initial Planning Specification

Status: Initial specification approved for first implementation
Scope: OpenSentry C-UAS training simulator / Base Defense Architect
Decision date: 2026-05-01

Approved planning decisions:
- Add APKWS as a distinct effector type, not generic JACKAL-style `kinetic`.
- Use the proposed first-cut gameplay values: 5 km range, 120° FOV, 7 rockets, 2 sec recharge, LOS required, high collateral risk.
- Model APKWS as laser-designation dependent conceptually; first implementation may start with identified hostile track gating, then add explicit laser designator behavior in a follow-on pass.
- Keep all behavior unclassified and training-oriented.

## Intent

Add an APKWS launcher as a kinetic effector option in OpenSentry. It should give players a medium-range precision kinetic option between JACKAL-style interceptors and directed-energy/electronic defeat systems.

The implementation should stay unclassified and training-oriented: model high-level operational tradeoffs, not detailed weapon employment data.

## Proposed Catalog Entry

```json
{
  "catalog_id": "apkws_launcher",
  "name": "APKWS Launcher",
  "type": "kinetic",
  "range_km": 5.0,
  "fov_deg": 120,
  "recharge_seconds": 2,
  "single_use": false,
  "ammo_count": 7,
  "description": "Ground-launched laser-guided 70mm rocket launcher for precision C-UAS engagements. Effective against larger Group 2-3 UAS and one-way attack platforms when supported by a valid laser designation / target handoff. Limited magazine and elevated collateral/ROE considerations compared to non-kinetic systems.",
  "pros": [
    "Precision kinetic defeat option",
    "Good effect against fixed-wing and larger UAS",
    "Useful against autonomous or RF-silent threats",
    "Lower unit cost than interceptor missiles"
  ],
  "cons": [
    "Requires line of sight and laser designation / target handoff",
    "Finite magazine",
    "Collateral/ROE risk from kinetic intercept and debris",
    "Less suitable for micro-UAS and dense swarms",
    "Directional launcher placement matters"
  ],
  "requires_los": true,
  "collateral_risk": "high"
}
```

## Initial Simulation Values

These are gameplay-tuned placeholders, not weapon-performance claims.

| Field | Initial Value | Notes |
| --- | ---: | --- |
| Range | 5 km | Keeps APKWS shorter than JACKAL pallet, longer than DE-LASER-3km |
| FOV | 120° | Directional launcher; placement/facing matters |
| Ammo | 7 rockets | Represents one pod/load for simple gameplay |
| Recharge | 2 sec | Salvo-capable but not spammy |
| LOS | Required | Terrain and base layout should matter |
| Collateral risk | High | Kinetic rocket + debris/ground impact training factor |
| Sensor dependency | Phase 1: identified hostile track; Phase 2: require a simulated laser designator or valid designating sensor handoff |

## Effectiveness Matrix Proposal

Add a dedicated `apkws` effector type if we want distinct behavior. If we keep `type: kinetic`, it will inherit JACKAL-like generic kinetic effectiveness, which is probably too broad.

Recommended new type: `apkws`.

```ts
apkws: {
  commercial_quad: 0.55,
  fixed_wing: 0.85,
  micro: 0.25,
  swarm: 0.20,
  improvised: 0.80,
  improvised_hardened: 0.75,
  shahed: 0.80,
}
```

Rationale:
- Strong against Group 2/3 fixed-wing, improvised, and one-way attack threats.
- Poor against micro targets and swarms due to target size, magazine depth, and engagement geometry.
- Less universally reliable than JACKAL in the current sim.

## Gameplay Role

APKWS should teach these tradeoffs:

1. **Kinetic escalation** — effective but ROE-heavy.
2. **Magazine management** — limited shots; don’t waste on birds/micro/no-ID tracks.
3. **Placement geometry** — directional FOV makes launcher siting important.
4. **Designation chain** — should require a valid simulated laser designation or designating sensor handoff, not just generic track data.
5. **Target selection** — best saved for Shahed/improvised/fixed-wing class threats.

## Implementation Options

### Option A — Simple Catalog-Only Addition

- Add APKWS to `backend/equipment/catalog.json` and `frontend/public/data/equipment/catalog.json`.
- Use existing `kinetic` behavior.
- Fastest path, but APKWS behaves too much like JACKAL.

Recommendation: only use as a temporary prototype.

### Option B — New `apkws` Effector Type

- Add `apkws` to backend/frontend type unions.
- Add APKWS-specific effectiveness matrix row.
- Add UI color/letter mapping.
- Treat as direct kinetic kill with ammo decrement and recharge.
- Use existing range/FOV/LOS checks.

Recommendation: best first real implementation.

### Option C — Laser Designator-Gated APKWS

Build on Option B, then add a simulated designation requirement such as:
- a colocated or networked EO/IR/laser designator system has line of sight to the target, or
- a future dedicated `laser_designator` sensor/equipment item is actively designating the target, or
- simplified v1 fallback: target has `dtid_phase === identified` and confidence above threshold.

Ku-FCS track alone should not be treated as laser designation unless we intentionally model a separate handoff/designator capability.

Recommendation: best training model, but should follow after basic system works.

## Proposed Acceptance Criteria

- APKWS appears in BDA equipment selection as an effector.
- Player can place launcher and see range/FOV footprint.
- Engagement consumes one rocket per shot.
- Launcher enters recharge between shots and depleted state at zero ammo.
- Requires target in range/FOV and LOS when placement terrain is active.
- Effectiveness differs from JACKAL, especially lower Pk vs micro/swarms.
- Event log names APKWS clearly and reports out-of-range/depleted/LOS blocks.
- Scoring records APKWS as the effector used.
- No classified or sensitive operational data is introduced.

## Open Questions

1. Should APKWS require a simulated laser designator from day one, or start with identified-track gating?
2. Should the sim model a 7-shot pod, 4-shot launcher, or configurable magazine?
3. Should APKWS have a minimum range / safety fan, or keep it simple for v1?
4. Should collateral risk affect scoring immediately, or just appear as UI metadata first?
5. Do we want APKWS in free-play/BDA only, or also scripted scenarios?

## Approved First Cut

Implement Option B now, then Option C as a second pass.

Approved first cut values:
- `type: "apkws"`
- range: `5.0 km`
- FOV: `120°`
- ammo: `7`
- recharge: `2 sec`
- LOS required: `true`
- collateral risk: `high`

This gives APKWS a unique training role without overcomplicating the first implementation.
