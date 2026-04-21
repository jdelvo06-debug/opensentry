# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Status: v1.11.0 — Preset Library + Custom Mission Fixes (2026-04-20)

20 curated base presets are in main. Custom mission handoff is fixed. Polygon quality is the current blocker.

### What's Working

- ✅ 20 curated base presets with preset alias search system
- ✅ 4-sided default perimeter with midpoint add / right-click remove
- ✅ Custom mission handoff uses live edited boundary (not stale template)
- ✅ `placement_bounds_km` derived from edited polygon dynamically
- ✅ Shared location search component (BDA + custom mission)
- ✅ 62/62 frontend tests passing
- ✅ EW realism pass (PR #9): Shahed kinetic-only, RF/PNT split, Shenobi scoped

### What's Not Working (Current Blocker)

**Preset polygon quality.** The `generate-preset.py` script on `wip/preset-generation-script` branch has issues:
1. **OSM relation stitching** — multipolygon members don't always join cleanly, producing mangled polygons (Langley is the worst example)
2. **Oversized boundary tightening** — `landuse=military` boundaries include housing; crude vertex clipping produces irregular shapes (Barksdale)
3. **Runway ellipse fallback** — geometrically correct but visually fake
4. **Need proper geometry library** — `shapely` for polygon intersection, simplification, and ring extraction instead of hand-rolled math

### Branch Status

| Branch | Status | Contents |
|--------|--------|----------|
| `main` | Clean, deployed | 20 presets, all fixes through PR #22 |
| `wip/preset-generation-script` | WIP, do not merge | `generate-preset.py`, regenerated polygons, Langley preset |

### What's Next

**Priority 1: Fix polygon generation pipeline**
- Option A: Add `shapely` dependency to the script for proper polygon ops
- Option B: Have Codex/Claude Code rewrite the script with proper geometry handling
- Option C: Let Jeremy manually edit polygons in the app (drag handles work)

**Priority 2: Add remaining bases** (Langley, Andersen, Incirlik, etc.) — blocked on polygon quality

**Priority 3: Fix JACKAL trajectory + action wheel size (Issue #1)**

**Priority 4: Code quality**
- Add CI test step to GitHub Actions
- Code-split bundle with React.lazy()
- Investigate stuck bogey in Lone Wolf

### Key Design Decisions
- **4-sided default perimeter** — not 8-sided, user explicitly prefers this
- **OSM data, not LLM** — GLM consistently gets polygon coordinates wrong. Deterministic script is the right approach; it just needs proper geometry tooling.
- **Nominatim returns gate addresses** — never use Nominatim for base center coordinates. Always verify against OSM runway data.
- **Never merge PRs without Jeremy's explicit approval**

### Key Files

```
scripts/generate-preset.py    ← WIP: deterministic OSM preset generator
frontend/public/data/bases/   ← 20 preset JSONs + preset-aliases.json
frontend/src/components/bda/
  BdaBaseSelection.tsx         ← preset search + loading logic
  BdaPlacement.tsx             ← placement map with draggable boundary
docs/adding-base-presets.md   ← full guide for adding new presets
```

---

*Updated 2026-04-20 after pack 4 merge and script work session.*