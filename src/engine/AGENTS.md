# src/engine/

## Purpose

A headless re-implementation of the upstream generator's runtime compositing: it reads the
asset pack's JSON definitions and PNGs and paints a character sheet with `@napi-rs/canvas`.
No browser, no Vite, no Mithril, no TypeScript build.

## Ownership

| File | Responsibility |
|---|---|
| `constants.js` | Sheet geometry, body types, directions, animation row blocks, cycles, frame counts |
| `catalog.js` | `Catalog`: loads `sheet_definitions/` + `palette_definitions/` into item and palette lookups; `customAnimationProviders()` is the authority on which custom blocks the pack can actually produce |
| `selection.js` | `normalizeSelections`: tool input -> the app's `{type_name: {itemId, variant, subId, recolor}}` map, plus defaults. `resolveItem` is exported so the saved-character reader resolves names the same way |
| `recolor.js` | Palette resolution and the CPU index-paired recolor of a loaded image |
| `sheet.js` | `SpriteEngine`: draw-call build, z-sort, load, recolor, composite; returns `{canvas, layout, warnings, layers}`; every crop (`extractAnimation`, `extractCustomAnimation`, `extractPreviewStrip`, `extractFrame`, `extractCustomFrame`) and `customAnimationNames()` |
| `custom-animations.js` | Oversize / non-grid animation blocks (wheelchair, 128-192px weapons) and their layouts |
| `credits.js` | Collect per-asset attribution and serialize it as CSV and TXT |
| `gif.js` | `encodeAnimatedGif` + `gifFrameDelay`: looping GIF89a encoding with per-frame local palettes and one-bit alpha transparency (gifenc, `rgba4444`/`oneBitAlpha`). Deterministic — byte-identical output for identical input is a tested claim. Used by `get_preview format:"gif"`; no engine dependency on it |

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
- **Warning text is part of the output contract.** The same character must produce the same
  `warnings` strings every run, so the aggregated missing-row lists are ordered by sheet position
  rather than by the order sprite loads settle. `test/golden-test.mjs` compares these across
  processes; treating a warning string as cosmetic will break the gate.
- **`renderCharacter` reports what it painted.** `layers` is built from the draw calls that survived
  row gating, not re-derived from the rules a second time. Anything that needs to know which row
  blocks an item contributed reads that list rather than recomputing `itemSupportsAnimation`.
- **Upstream data that this pack cannot use stays, but stays quiet.** `custom-animations.js` keeps
  upstream's 14 definitions even though the pack provides 12; `Catalog.customAnimationProviders()`
  decides reachability and `SpriteEngine.customAnimationNames()` is the only thing error messages may
  list. Do not delete the unreachable definitions for tidiness — that is a divergence from upstream
  tables, and `validate_sheet` reports the drift either way.
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
