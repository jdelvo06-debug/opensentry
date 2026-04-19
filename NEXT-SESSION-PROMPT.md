# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Status: v1.10.1 — SystemsPanel Merged (2026-04-19)

PR #7 (SystemsPanel consolidation) is merged to main. DE split (v1.10.0) and sidebar refactor (v1.10.1) are both shipped.

### What's Working

- ✅ 4-step BDA flow: Base → Equip → Place → Export
- ✅ Directed energy split: DE-LASER-3km (precision/LOS) + DE-HPM-3km (area/non-LOS)
- ✅ SystemsPanel — single collapsible sidebar with SENSORS/EFFECTORS/COMBINED groups
- ✅ Shenobi — one combined row with capability subtext (no duplicates)
- ✅ DE LOS scoped correctly — standard scenarios skip, BDA/custom enforces
- ✅ 49/49 tests passing (DE dwell/resolution, camera slewing, tactical-map routing)
- ✅ Live browser QA: RF/PNT jammer, DE laser, HPM all verified
- ✅ EO/IR proximity slewing — nearest active camera selected
- ✅ Duplicate camera labels — #1, #2, etc.

### What's Next

**Priority 1: Fix JACKAL trajectory + action wheel size (Issue #1)**
- JACKAL interceptor flight path needs fixing
- Radial action wheel is too large on screen

**Priority 2: Save/Load BDA Designs**
- JSON export/import for architect designs
- Share designs between users
- Load previous designs to iterate

**Priority 3: Code Quality**
- Add CI test step to GitHub Actions (vitest + pytest)
- Code-split bundle with React.lazy() (currently 733 KB)
- Investigate stuck bogey in Lone Wolf

**Priority 4: Innovation Submission**
- Draft AFWERX/DIU one-pager for OpenSentry

### Key Design Decisions (2026-04-19)
- **Shenobi display:** One row with "RF Detect + Protocol Manipulation" subtext. No duplicate sensor/effector entries.
- **DE LOS enforcement:** Skipped in standard scenarios (users can't place systems based on terrain). Enforced only in BDA/custom placement missions.

### Key Files

```
frontend/src/components/
  BaseDefenseArchitect.tsx           ← stepper shell (~120 lines)
  SystemsPanel.tsx                   ← consolidated sidebar (PR #7)
  bda/
    types.ts, constants.ts, viewshed.ts  ← shared modules
    BdaStepIndicator.tsx             ← step progress bar
    BdaBaseSelection.tsx             ← step 1: base template + geo search
    BdaEquipmentSelection.tsx        ← step 2: catalog with enriched cards
    BdaPlacement.tsx                 ← step 3: map + viewshed + placement
    BdaExport.tsx                    ← step 4: coverage summary + launch
    components/                      ← sub-components (palette, markers, etc.)

src/game/
  actions.ts                         ← 16 player action handlers (DE LOS conditional)
  detection.ts                       ← _los_blocked() — used for BDA LOS only
  jamming.ts                         ← RF + PNT jamming logic
```

---

*Updated 2026-04-19 after SystemsPanel merge.*