# Claude Code Session Prompt — OpenSentry

Copy-paste this into Claude Code when you're ready to continue.

---

## Status: v1.12.x — Curated Preset Quality Pass + Shared Workflow Cleanup (2026-04-21)

The preset/search/save/load flow is working in both Custom Mission and BDA. The shared preset workflow is now documented and should be treated as authoritative.

### What's Working

- ✅ 19 curated searchable base presets are in `main` and wired through `frontend/public/data/bases/preset-aliases.json`
- ✅ Custom Mission and BDA now share the same search / preset handoff behavior
- ✅ Generic custom-location flow works: search → edit perimeter → save → revisit
- ✅ Live mission handoff uses the edited boundary/center instead of the old Iraq fallback
- ✅ Mission map pan/zoom no longer snaps back every tick
- ✅ Infrastructure overlay markers/labels were removed to reduce clutter
- ✅ 4-sided default perimeter with midpoint add / right-click remove
- ✅ 62/62 frontend tests passing

### Important Reality Check

- GitHub Pages is static hosting. Browser users cannot write shared presets back into the repo.
- On GitHub Pages, ad hoc custom saves are browser-local only.
- Shared presets for everyone must be curated into git under `frontend/public/data/bases/<base_id>.json`.

### Authoritative Preset Workflow (Use This)

1. Start from a real aerodrome boundary:
   - OSM aerodrome way/relation
   - or a manual trace in `geojson.io`
2. Convert/import it into preset format:
   - preferred: `python3 scripts/import_geojson_preset.py --preset <base_id> --geojson /abs/path/file.geojson`
3. Simplify carefully while preserving the installation shape
4. Apply only minimal local edits so runway/support geometry stays inside
5. Verify visually in-app after `npm test` and `npx vite build`

### Deprecated Workflow (Do Not Default To This)

- Do **not** create new curated presets by taking a runway midpoint and drawing a blanket buffer/oval around it
- Do **not** trust `wip/preset-generation-script` output as merge-ready without a traced/source-derived visual pass
- Do **not** treat GitHub Pages browser saves as shared repo state

### Current Preset Status

Recently reworked or visually checked in this pass:
- Osan AB
- Aviano AB
- Spangdahlem AB
- McEntire JNGB
- Shaw AFB
- Prince Sultan AB
- Ramstein AB
- RAF Mildenhall
- Barksdale AFB
- Scott AFB
- Tyndall AFB
- Kunsan AB
- Kadena AB
- Nellis AFB
- RAF Lakenheath
- Al Udeid AB

Still worth re-verifying in a future pass:
- Creech AFB
- Fort Liberty
- Lackland AFB

### Branch Status

| Branch | Status | Contents |
|--------|--------|----------|
| `main` | Clean, deployed | current shared preset library, save/load fixes, traced-outline docs |
| `wip/preset-generation-script` | WIP, do not merge blindly | experimental `generate-preset.py`, legacy regenerated polygons |

### What's Next

**Priority 1: Continue curated base verification**
- Finish visual pass on remaining unreviewed curated presets
- Add new requested bases using the traced/source-derived workflow

**Priority 2: Add remaining bases**
- Langley
- Andersen
- Incirlik
- others as requested

**Priority 3: Fix JACKAL trajectory + action wheel size (Issue #1)**

**Priority 4: Code quality**
- Add CI test step to GitHub Actions
- Code-split bundle with React.lazy()
- Investigate stuck bogey in Lone Wolf

### Key Design Decisions

- **4-sided default perimeter** — not 8-sided
- **Shared presets live in git** — curated JSON is the source of truth for everyone
- **GitHub Pages custom saves are local only** — not a collaborative database
- **Prefer traced/source-derived outlines** — not runway bubbles
- **Never merge PRs without Jeremy's explicit approval**

### Key Files

```text
scripts/import_geojson_preset.py  ← imports traced GeoJSON polygons into curated presets
scripts/generate-preset.py        ← experimental only; not the default workflow
frontend/public/data/bases/       ← curated preset JSONs + preset-aliases.json
frontend/src/components/bda/
  BdaBaseSelection.tsx            ← preset search + loading logic
  BdaPlacement.tsx                ← placement map with draggable boundary
docs/adding-base-presets.md       ← authoritative preset authoring guide
AGENTS.md                         ← current project guide for future coding agents
```

---

*Updated 2026-04-21 after the curated preset quality/documentation pass.*
