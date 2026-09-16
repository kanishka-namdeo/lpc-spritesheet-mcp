# Engine port notes (upstream → this server)

The upstream repo (cloned at `../lpc-generator-src`) is a Vite + Mithril + TypeScript
SPA. This server re-implements its runtime compositing in plain ESM JavaScript on
`@napi-rs/canvas`, reading the JSON definitions + PNG assets directly (no build step).
Port equivalence is covered by the test suite (`test/run-tests.mjs`).

## Upstream → here map

| Upstream | Here |
|---|---|
| `sources/state/constants.ts` | `src/engine/constants.js` (verbatim tables: FRAME_SIZE 64, 13 cols, 54 rows, ANIMATIONS + folderName remaps, ANIMATION_OFFSETS, ANIMATION_CONFIGS) |
| `sources/custom-animations.ts` | `src/engine/custom-animations.js` (data extracted verbatim) |
| `scripts/generateSources/{items,item-helper,palettes}.ts` | `src/engine/catalog.js` (reads `sheet_definitions/` + `palette_definitions/` at startup; ports parseItem, getRequiredSexes, collectLayers, normalizeRecolors/expandRecolorPalettes) |
| `sources/state/palettes.ts` | `src/engine/recolor.js` (parseRecolorKey, getBasePalette, getTargetPalette, getMultiRecolors, getBodyColor, fixMissingRecolor, getPalettesFromMeta) |
| `sources/canvas/palette-recolor.ts` (CPU path) | `src/engine/recolor.js` (recolorImageCPU: index-paired palettes, ±1 tolerance, skip alpha 0; WebGL path intentionally not ported) |
| `sources/canvas/renderer.ts` (runRenderCharacter + custom areas) | `src/engine/sheet.js` (SpriteEngine.renderCharacter: drawCalls → z-sort → load → recolor → drawImage(0, yPos); custom blocks appended below SHEET_HEIGHT) |
| `sources/canvas/draw-frames.ts` | `src/engine/sheet.js` (drawFramesToCustomAnimation, drawSingleAnimSpriteToCustomAnimation, drawFrameToFrame) |
| `sources/utils/credits.ts` | `src/engine/credits.js` (getAllCredits, creditsToCsv, creditsToTxt) |
| `sources/state/state.ts` selectDefaults | `src/engine/selection.js` (defaults: body + heads_human_male + face_neutral, all "light") |
| URL hash / saved JSON | tool args (`selections`, `colors`, `character` v2 JSON); hash parsing intentionally not ported |

## Invariants worth remembering

- Selections map is keyed by the item's `type_name`; sub-recolors (eyes) are their
  own map entry `{itemId, subId, recolor}` keyed by the recolor slot's type_name
  ("eyes") and are skipped by the renderer's drawCall loop (`subId` → recolor
  info only). Sub-selections are validated against `recolors[subId]`.
- Default recolor for a recolorable item is the upstream UI default: the FIRST
  entry of the slot's palette (cloth→brown, metal→ceramic, body→light), not the
  material meta's `base`.
- Selection group keys are validated against real type_names ("torso"/"feet"
  are rejected with guidance; shirts are "clothes", boots are "shoes").
- zPos: lower draws first (shadow 0, body 10, default 100).
- Row gating: `combat_idle` row ← items listing `combat`; `thrust` row ← `thrust`
  or `watering`; `backslash` ← `1h_slash`/`1h_backslash`; `halfslash` ← `1h_halfslash`.
- Recolorable items load the BASE png and tint at draw time; variant items load
  `.../<anim>/<variant>.png` (spaces→underscores). `recolors != null` ⇒ base png.
- `${head}` templates in layer paths resolve via the item's `replace_in_path`
  map using the selected head's display name (spaces→underscores) as the key.
- Custom blocks: heights add below 3456; canvas width = max(832, widest block).
  `custom_sprite` layers draw whole (or via single-anim remap when
  `sourceSingleAnimation`); all other layers' frames of the base animation are
  extracted per the block's frame grid.
- Known upstream asset gaps surface as `warnings`, aggregated one message per
  item (`"<itemId>: no sprite for row(s) hurt — those rows will be empty"`):
  child body ships only hurt/idle/jump/sit/slash/walk; rapier behind-layer lacks
  hurt; many weapons carry oversize custom blocks that widen the canvas.
- Single-row blocks face one way: hurt is down-only art, climb is up-only art —
  extraction accepts any direction and always returns that row.
- `combat` is the canonical config key (combat_idle is accepted as an alias);
  `watering`/`1h_*` rows report the frames/yOffset of the row block they share.
- Per-animation source PNGs are cropped to their real frame count (walk 9 cols,
  idle 2, combat_idle 2, …) — never assume 13 filled columns.
