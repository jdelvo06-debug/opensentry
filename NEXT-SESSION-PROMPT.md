# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Status: BDA v2 Shipped (2026-04-09)

The Base Defense Architect v2 stepper refactor is complete and merged to main (PR #3).

### What's Working

- ✅ 4-step flow: Base → Equip → Place → Export
- ✅ Equipment selection with enriched cards (LOS, range, FOV, +/- qty)
- ✅ Terrain-aware viewshed for all LOS systems (radar, EO/IR, Shenobi, jammer)
- ✅ Per-system coverage toggle (show/hide individual viewsheds)
- ✅ Draggable base perimeter with vertex handles
- ✅ Map tile toggle (Dark/Satellite/Topo)
- ✅ Geo search on placement map
- ✅ Export to mission preserves custom location coordinates
- ✅ AGL height down to 2m with preset buttons
- ✅ Approach corridor coverage analysis on export screen

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

### Key Files

```
frontend/src/components/
  BaseDefenseArchitect.tsx           ← stepper shell (~120 lines)
  bda/
    types.ts, constants.ts, viewshed.ts  ← shared modules
    BdaStepIndicator.tsx             ← step progress bar
    BdaBaseSelection.tsx             ← step 1: base template + geo search
    BdaEquipmentSelection.tsx        ← step 2: catalog with enriched cards
    BdaPlacement.tsx                 ← step 3: map + viewshed + placement
    BdaExport.tsx                    ← step 4: coverage summary + launch
    components/                      ← sub-components (palette, markers, etc.)
```

---

*Updated 2026-04-09 after BDA v2 merge.*
