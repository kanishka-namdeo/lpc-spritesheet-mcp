# src/engine/

## Purpose

A headless re-implementation of the upstream generator's runtime compositing: it reads the
asset pack's JSON definitions and PNGs and paints a character sheet with `@napi-rs/canvas`.
No browser, no Vite, no Mithril, no TypeScript build.

## Ownership

| File | Responsibility |
|---|---|
| `constants.js` | Sheet geometry, body types, directions, animation row blocks, cycles, frame counts |
| `catalog.js` | `Catalog`: loads `sheet_definitions/` + `palette_definitions/` into item and palette lookups |
| `selection.js` | `normalizeSelections`: tool input -> the app's `{type_name: {itemId, subId, variant, recolor}}` map, plus defaults |
| `recolor.js` | Palette resolution and the CPU index-paired recolor of a loaded image |
| `sheet.js` | `SpriteEngine`: draw-call build, z-sort, load, recolor, composite, and every crop/extract |
| `custom-animations.js` | Oversize / non-grid animation blocks (wheelchair, 128-192px weapons) and their layouts |
| `credits.js` | Collect per-asset attribution and serialize it as CSV and TXT |

## Local Contracts

- **`docs/ARCHITECTURE.md` is the invariant source of truth for this subtree.** Read its
  upstream-to-here map and "invariants worth remembering" before editing, and update that same
  section in the pass that changes behavior. Do not restate its invariants here.
- **Fidelity is the default.** Behavior must match the upstream app, or be an explicit, documented
  divergence. When diverging, say so at the definition site and record it in
  `docs/ARCHITECTURE.md` — `ANIMATION_FRAME_COUNTS` is the model: it is *not* verbatim, it is
  verified against the shipped PNG strip widths, and the comment says so.
- **Tables mirror upstream and are edited, not computed.** Keep `constants.js` entries aligned to
  upstream names and row numbers; where upstream's on-disk folder differs from the canonical row
  name, use `folderName` remaps rather than renaming either side.
- **The WebGL recolor path is intentionally unported.** CPU-only; do not describe or add a GPU path.
- **The engine knows nothing about MCP.** No tool shapes, argument names, or result payloads from
  `src/index.js` may leak in here; the boundary is `character.js`.
- **The engine never writes files.** It returns canvases and layout data; saving and attribution
  side-effects belong to the caller.
- **Everything is driven by the pack on disk.** Item counts, groups, palettes, and which custom
  animations exist come from `Catalog`. Nothing here may hard-code a catalog number.

## Work Guidance

- Cite the upstream file (and line, when it helps) in the PR for any behavior change.
- Known upstream asset gaps surface as warnings, not errors: an item with no sprite for a row
  yields an empty row plus one aggregated message. Preserve that degradation path rather than
  throwing.
- Canvas sizes come from geometry plus appended custom blocks; report offsets rather than
  assuming the standard 832x3456 bounds.

## Verification

`npm test` — `test/run-tests.mjs` exercises this subtree in-process against a real asset pack,
including the custom-animation and recolor cases.

## Child DOX Index

None. `src/engine/` is a leaf.
