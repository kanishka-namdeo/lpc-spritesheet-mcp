# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.4.0] - 2026-10-19

The "see it walk" release: every feature here exists to close the gap between *asking* for a
character and *seeing* one. The tool surface grows from nine to thirteen tools, and the server
gains three MCP prompts and three MCP resources. Rendering itself is byte-identical to 1.3.0 —
`npm run golden` passes unchanged against the same pinned pack revision.

### Added (watch it move)

- **Animated GIF previews.** `get_preview` accepts `format: "gif"` (+ `fps`, default 10) and
  returns a looping, transparency-preserving GIF of one animation's playback cycle for one
  direction — correct LPC playback order built in, because the cycle table (walk skips the
  standing pose, idle holds 0,0,1, sit/emote hold each frame five steps) *is* the timing table:
  one uniform tick per cycle entry is exact playback, not an approximation. Small GIFs come back
  inline (`image/gif`, `annotations: {audience: ["user"]}`) so a client shows the character
  walking in the conversation. `gifenc` (already used for the docs demo GIF) moves from
  devDependencies to dependencies — still zero native additions.
- **Seeded random characters.** `random_character` rolls a coherent character from any string
  seed: same seed → same character, forever, across processes (cyrb128 → mulberry32, no
  `Math.random`). Gear profiles (`bare` / `civilian` / `soldier` / `fancy`) tune how armed and
  fancy the roll is; `complete_only` (default on) restricts always-visible groups to items that
  paint both walk and idle, so random characters never have empty core rows; every emitted
  item/color is pre-verified against the same resolvers hand-written selections go through.
  Returns ready-to-render `selections`/`colors` plus an inline walk preview by default.
- **NPC batches.** `generate_batch` populates a village in one call: N characters from one seed
  (`seed:i` per character), each into its own directory with a full sheet, a walk preview and
  credits, plus `index.png` (a contact grid of every character's walk frame), a `manifest.json`
  indexing the batch, and one rolled-up `batch-credits.csv`/`.txt`. Same seed → same village.
- **Curated presets.** `list_presets` describes 18 verified archetypes (knight, mage, blacksmith,
  farmer, rogue, royal, child, zombie, lizardfolk, wheelchair user, …) and every render tool
  accepts `preset: "<name>"` as a one-call starting point — explicit `selections`/`colors` merge
  on top. Each preset was rendered and checked by test: every itemId is real, colors validate,
  and the walk cycle paints with no missing-row warnings.

### Added (engine-ready exports)

- **Five atlas dialects.** `export_character.atlas_format` now takes `texturepacker` (default,
  unchanged), `aseprite` (JSON data export with `frames` array + `meta.frameTags`, what
  Aseprite-adjacent tooling and the Bevy sprite plugins read), `godot` (a `.tres` SpriteFrames
  resource with one AtlasTexture sub-resource per unique frame rect and per-direction `loop`ing
  animations at 10 fps — point an `AnimatedSprite2D` at it), `libgdx` (`.atlas` text regions,
  Nearest-filtered, verified against TextureAtlas.java) and `unity` (`sheet.png.meta`
  TextureImporter with the sprite sheet pre-sliced: Multiple mode, Point filter, 64 px/unit,
  feet pivots, deterministic GUID). Every format was verified against its consumer's docs,
  parser, or a saved file from the engine itself — the sources are cited in
  `src/atlas-formats.js`.
- **Cycle-correct playback everywhere.** The TexturePacker atlas gains the `animations` map
  (TexturePacker/Pixi convention: `"walk_down": ["walk_down_2", …, "walk_down_9"]`), the
  manifest carries it for every dialect, Aseprite's `meta.animations` mirrors it, Godot's
  animations play in cycle order, and Unity's `userData` embeds it for scripting clips. Playback
  order is the classic LPC integration bug — no consumer has to re-derive it now.

### Added (share and return)

- **`generatorUrl` on every render.** Each result links to the upstream web app preloaded with
  the exact character (`#sex=female&hair=Bangs_red&…`), so a human can open and tweak the same
  character in the browser. The encoder is a faithful port of upstream's `hash.ts` serialization
  — differentially verified byte-identical against a transcription of upstream's logic across
  53,604 selection shapes (every item × variant × recolor the pack ships).
- **MCP prompts** (`design-a-character`, `populate-a-village`, `export-for-my-engine`): scripted
  agent flows that chain the tools well — discovery → preview → iterate → export, with the
  engine-specific atlas guidance baked into the export flow.
- **MCP resources** (`lpc://sheet-layout`, `lpc://licensing`, `lpc://presets`): reference
  material an agent can cite without a tool call — the stable layout table, the attribution
  cheat sheet, the preset library.

### Added (opt-in AI design)

- **`design_character`** turns a natural-language brief ("a tanned female blacksmith with a
  leather apron and a hammer") into ready-to-render `selections`/`colors`, with the model's
  rationale and an inline preview of the result. **Strictly opt-in:** the server stays fully
  offline unless `LPC_AI_API_KEY` is set in its environment; without it the tool returns a setup
  error, never a network call. Config: `LPC_AI_BASE_URL` (any OpenAI-compatible endpoint;
  defaults to Dashscope's), `LPC_AI_MODEL` (qwen3.7-plus, kimi-k2.5, qwen3.6-plus; default
  kimi-k2.5, which measured ~6s on this task where the qwen models took 50–70s — the difference
  between fitting and not fitting an MCP client's default request timeout). The model is
  grounded on a byte-budgeted catalog digest (7.5k chars: itemIds per curated group, counts for
  the rest, palettes), its proposal is validated through the same `normalizeSelections` as
  hand-written input, and one self-healing round feeds a failed proposal back with the valid
  itemIds before giving up with the full proposal + hint.

### Fixed

- Duplicated `limit`/`offset` validation in `list_items` (dead code from the 1.3.0 surface —
  the same check ran twice per call).

### Internal

- The test suite grows from 66 to 140 passing items across six new files (`gif`, `random`,
  `presets`, `atlas-formats`, `url`, `ai`, plus the `mcp-new-tools` end-to-end suite). The
  golden manifest is untouched: rendering is provably byte-identical to 1.3.0.
- `get_preview` GIF/PNG output paths always end in the extension of the format actually written.

### Publishing

- Landed with the 1.4.0 tarball, so npm users get them as part of 1.4.0:
  - `bin` paths normalized (`./src/index.js` → `src/index.js`). npm 11.x flags the `./` form
    as invalid and silently *removes* the bins from the published manifest, breaking
    `npx lpc-spritesheet-mcp` and `lpc-spritesheet-setup`; both now use the form npm accepts
    (the registry had been auto-correcting earlier versions).
  - Both bin scripts carry the executable bit in git (`100755`), so the tarball preserves it.
  - The tarball no longer ships the three contributor/agent `AGENTS.md` files (repo-side docs,
    no user value); `prepublishOnly: "npm test"` now gates every publish against the full
    140-item suite.
  - README images and links to files outside the tarball now use absolute GitHub URLs, so the
    npm registry page renders the banner, demo GIF, gallery and architecture diagram instead
    of broken images.
  - New `publish.yml` workflow publishes to npm from CI with provenance (release-published or
    manual dispatch): tag/version drift fails fast, an already-published version skips cleanly
    instead of erroring on re-run, and the full test gate runs before upload.

## [1.3.0] - 2026-10-14

Audited against the live asset pack rather than against the docs: every claim below was measured
first, and the fixes are the places where the shipped behaviour and the documented behaviour disagreed.

### Added (engine-artifact export)

- **`export_character`** fans one character out into a directory bundle instead of a single PNG:
  `sheet.png`, `sheet.atlas.texturepacker.json` (TexturePacker JSON Hash, which Phaser and most
  importers read) with a rect for every frame of every row block and custom block, `manifest.json`
  with the full layout and the pack revision, and either one PNG per animation row block
  (`mode: "animation"`, default) or one per frame cell (`mode: "frames"`). Credits sidecars are
  written beside the bundle, so attribution survives the fan-out. `extractFrame`, which the engine
  had ported but no tool exposed, is now the back of the per-frame path, with a new
  `extractCustomFrame` for oversize blocks.
  Deliberately **not** a ZIP: the MCP client is co-located, a path is already what this server
  returns, and the package still has two dependencies. This is the upstream app's split-by-animation
  and split-by-frame export modes, which its maintainer declined to add to the browser for exactly
  the reason a headless server can answer — different engines want different files.
- **`validate_sheet`** audits the layout instead of painting it. `scope: "layout"` checks the port's
  row-block tables against each other and against the pack's `custom_animation` values in both
  directions; `scope: "character"` renders in memory and compares the columns actually painted per
  direction row against the declared frame counts; `scope: "catalog"` reads item definitions for
  animations this port cannot resolve and for layers that ship no art for a body type the item
  claims. It writes nothing, and `ok: false` names the failing check. Written after upstream's
  maintainer asked the community for "a PR to test animation alignment in an automated fashion".
  On its first run against this pack it found two real things: see Fixed.
- **`npm run golden`** (`scripts/make-golden.mjs`) records SHA-256 hashes, dimensions, sorted warning
  strings and credit counts for seven canonical characters into `test/golden.json`, and
  `test/golden-test.mjs` re-renders and compares. Hashes of renders are committed; the art itself is
  not, so the pack-never-vendored rule holds. A second test renders one spec twice and asserts
  `Buffer.compare === 0`, which catches nondeterminism regardless of which pack is on disk.
- Every render result, bundle manifest and audit result now carries `pack: { revision }`, the commit
  the asset pack is checked out at. `scripts/setup-assets.mjs` accepts `LPC_ASSETS_REF`, clones at the
  pinned revision when it is set, and prints the revision it installed — the scripts doc had admitted
  nothing recorded it. CI's asset-pack checkout is pinned to the matching revision, because a byte
  hash against unpinned art is a coin flip rather than a gate.
- **Character spec round-trip.** `include_character_json` writes the app's full v2 document:
  `layers[]` with `zPos`, `layerNum`, recolor slots and `supportedAnimations` per layer (taken from the
  draw calls the engine actually painted, so it cannot disagree with the PNG it describes), `credits[]`,
  `flags`, and the pack revision. The `character` argument now also accepts a **v1 document carrying a
  `#sex=…&group=Name_variant_recolor` state hash**; names that no longer resolve come back as
  `warnings` and the rest of the character still renders.

### Added (protocol conformance)

- Every tool declares a `title` and the four annotations (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`). Absent hints default to the unsafe end: a client must assume a
  tool it knows nothing about can delete data and reach the network.
- `outputSchema` plus matching `structuredContent` on the four `list_*` tools, `export_character` and
  `validate_sheet`. The three render tools stay text-only: their `layout` mirrors `describeLayout`,
  and a hand-maintained twin schema is a second source of truth waiting to rot.
- `get_preview` returns the crop as a `type: "image"` result block as well as a path, size-gated at
  64 KB. A 64px strip is 2–4 KB; a full sheet is 188–280 KB and is not something to base64 into a
  conversation, so the big ones stay paths.

### Added (discovery ergonomics)

- `list_items` responses are budgeted server-side at 12,000 bytes. Measured before the change: `hat`
  cost 24,400 bytes (~6.8k tokens) and `head` 20,573 at the default `limit`, and the only bound in the
  repo was a test asserting one category stayed under 20,000 — 24 of the 104 groups broke it. Responses
  now report `bytes`, `truncated` and `nextOffset`, and a new `fields` array
  (`itemId`, `name`, `variants`, `colors`, `customAnimation`) lets a caller list a whole category for a
  fraction of the cost.
- `list_items` documents the `bodyType` filter and `list_palettes` the `material` filter, both of which
  were implemented and undocumented.
- An invalid color name now suggests the nearest valid one and caps the enumeration
  (`Valid: light, amber, … (78 more). Did you mean "dark_green"?`). The old message dumped 93 names,
  1,630 bytes, for one typo.

### Fixed

- The `generate_spritesheet` description — the agent-facing contract — told callers custom blocks
  widen the canvas "e.g. 1152/1536px". The measured maximum is 1664px (`tool_rod` renders 1664x3968);
  the README already had this right, the schema did not. A new test asserts the description text.
- `output_path`'s description claimed the default was `<server dir>/output/…`. It is
  `lpc-spritesheet/<name>-<timestamp>.png` under the OS temp directory, which is what the README and
  the code have always said.
- Missing-row warnings listed their rows in the order sprite loads happened to settle, so the same
  character produced different `warnings` strings across processes. Rows are now reported in sheet
  order. `validate_sheet` found the table bug and the golden gate found the ordering — both were
  written to catch exactly this.
- Unreachable custom-animation blocks are no longer advertised as usable. `thrust_128` and
  `whip_oversize` exist in upstream's definition table but no item in the pack provides them, so
  `get_animation`'s "Unknown animation" error used to suggest names nothing can render. The
  definitions stay (upstream parity), `list_animations` marks them `available: false`, and error
  strings name only reachable blocks.
- The README's "Sheet layout (stable)" table omitted `jump` (row 26, 5 frames per direction) while the
  same file claimed 15 row blocks. It now lists all 15, and the alias sentence is corrected:
  `watering` and `1h_slash` are aliases, while `combat`, `1h_backslash` and `1h_halfslash` own their
  rows and differ only in the folder the pack ships them in.
- The README's timings ("a plain sheet composites in about 45 ms") were warm-process numbers with no
  cold-path figure. Replaced with measurements from one machine: ~200 ms catalog load, ~1.1 s to a
  ready server, ~0.53 s for the first render while sprites come off disk, 3–10 ms after that.
- The 1.2.1 defect fixes originally planned as a separate patch release ship here instead, since
  nothing was published in between; the version sites and this heading stay in agreement.

### Changed

- `src/engine/sheet.js`'s `renderCharacter` also returns `layers` — the inventory of which item layers
  painted and which row blocks each contributed. Pixels, dimensions and the existing result keys are
  unchanged, and the golden gate proves it.

## [1.2.0] - 2026-10-13

### Fixed (CI and documentation drift)

Every CI run on `main` had been failing; these are the causes.

- `npm test` could not run on the declared minimum Node: `node --test "test/*.mjs"` has no glob
  support on Node 20, and a quoted glob is not expanded by `cmd.exe` on Windows runners either. The
  script now names its three files.
- The end-to-end stdio tests failed on any machine without a sibling asset clone:
  `StdioClientTransport` inherits only a small env allowlist, so the spawned server lost
  `LPC_ASSETS_DIR`, exited at startup, and all 12 tests reported `MCP error -32000: Connection
  closed`. The pack location is now passed to the child explicitly.
- `test/smoke-canvas.mjs` looked for the pack one directory above the repository (the wrong place on
  a CI runner) and ignored `LPC_ASSETS_DIR`; it now uses the shared resolver and asserts rather than
  only printing.
- The graceful-failure CI step could never have passed: it read `code=$?` on the line after a
  command expected to fail, which `bash -e` aborts first. It was masked because `npm test` always
  failed before it ran. It now captures the status with `cmd || code=$?`.
- Asset-pack discovery is a single shared implementation, `src/assets-dir.js`, imported by the
  server, the tests and the scripts, so the three can no longer disagree.
- `get_preview` accepts `combat_idle` as an alias of `combat`, as `get_animation` already did and as
  1.1.0's entry claimed.
- `get_animation` on a custom-animation block reports that block's frame size in `image.frameSize`
  (a 128px weapon block used to report `64`).
- `list_animations` now reports a frame count and a y-offset for every standard row, including the
  `watering` alias, matching what `generate_spritesheet`'s `layout` already said.
- Alias labelling is consistent: `combat` is the canonical row-block name and no longer describes
  itself as an alias of itself, while `watering` and `1h_slash` are labelled as the aliases they are.
- The README's flagship example passed `weapon: "Recurve Bow"`, which is not an item in the pack and
  threw a selection error. It is `Recurve`, and a new test renders that exact call and asserts the
  `image` and `frames` values the README prints.
- The no-assets startup hint told users to run `npm run setup-assets`, which only resolves from a
  checkout. Installed users — the `npx` / `npm install -g` path this package is published for — are now
  pointed at the `lpc-spritesheet-setup` bin, with the checkout command kept as the alternative.

### Added

- `docs/ARCHITECTURE.md`: the upstream-to-here map now covers the whole shipped runtime (including
  `src/index.js`, `src/character.js`, `src/assets-dir.js` and every crop/extract entry point), plus a
  "Local inventions" section, a tool-surface-to-engine table, and three `mermaid` diagrams.
- Regenerable repository imagery: `docs/img/architecture.svg` via `npm run diagrams`, a banner /
  gallery / logo / social-preview set via `npm run showcase`, and an animated real-session capture via
  `npm run demo` (`npm run assets` runs all three). Every committed render now carries a credits
  sidecar, so the repository holds itself to the attribution rule it advertises.
- `.github/`: Dependabot config for `npm` and `github-actions`, issue templates for bug reports,
  asset-pack problems and feature requests, and a PR template that mirrors the real acceptance gate.
- Four end-to-end regression tests pinning the fixes above: the suite is 36 passing items (19 engine,
  16 end-to-end, 1 canvas smoke), up from 32.
- `lpc-spritesheet-setup`, an npm bin for `scripts/setup-assets.mjs`. 1.1.0 shipped that script inside
  the tarball with no way to invoke it short of a checkout.

### Changed

- Removed dead surface found while fixing the above: an unused import set in `src/index.js`, a
  duplicated animation-folder table (its `const` was also referenced before declaration), and two
  unused exports' callers. `describeLayout`'s column count now derives from
  `STANDARD_ANIMATION_FRAMES_PER_ROW` instead of a literal.
- Corrected claims that no longer held: the palette count in the README (the `all`/`lpcr` palette is
  75 colors, not 74), the "15 animations x 4 directions" phrasing (13 blocks are 4-direction, `hurt`
  and `climb` ship one facing each — which is exactly the 54 rows), the credits filenames in
  `SECURITY.md`, and four upstream counts in `docs/capability-inventory.md`.
- A render with no `output_path` now lands in `<os tmpdir>/lpc-spritesheet/` rather than
  `<package>/output/`. For an installed server the old default resolved inside
  `node_modules/lpc-spritesheet-mcp/`, where the next `npm install` replaces the tree and a root-owned
  global prefix refuses the write outright. The absolute path is still reported in every result's
  `output`, with the credits sidecars beside it.
- `zod` is no longer a declared dependency: no file in `src/`, `scripts/` or `test/` imports it, and
  `@modelcontextprotocol/sdk` declares the range it actually needs.
- The published tarball ships the runtime, `scripts/setup-assets.mjs` and the `docs/*.md` internals —
  20 files, 229 kB unpacked, down from 37 files and 1.5 MB. `docs/img/` and the three generators it
  documents are dev-only: an installer has neither the `gifenc` devDependency nor the 350 MB pack the
  generators read, so shipping them bought 1.2 MB of imagery no consumer of `node_modules` can open.

## [1.1.0] - 2026-09-17

### Fixed (audit hardening)

- Saved-character JSON now acts as the BASE with explicit `selections`/`colors`
  always merging on top; invalid `character.bodyType` is rejected instead of
  rendering a blank sheet; minimal character JSONs get app defaults filled in.
- Eyes sub-selections (`{itemId, subId}`) survive normalization (previously
  dropped or mis-filed, corrupting eye color).
- `get_preview("hurt")` / `("climb")` accept any direction and return their
  single facing (hurt = down-only art, climb = up-only art).
- Default recolors match the upstream UI (first palette entry: cloth→brown,
  metal→ceramic) instead of the palette meta's base color.
- Empty-string `variant` falls back to the item's first variant instead of
  erroring.

### Changed

- `list_items` responses stay small: recolor palettes are deduplicated
  into a response-level `palettes` map referenced per item (a filtered
  `list_items` page is asserted to stay under 20 KB by the test suite).
- `list_items` `total` reflects the active search/bodyType filters
  (`unfilteredTotal` added); discovery errors are returned as MCP errors
  (`isError: true`) with valid-value guidance.
- Unknown arguments on generate tools produce did-you-mean warnings instead of
  silent default renders; unknown selection groups error with the valid group
  list (shirts are `clothes`, boots are `shoes`).
- Missing assets are reported as one aggregated warning per item instead of one
  message per PNG.
- `get_animation` echoes the cropped animation with crop-relative layout info;
  `get_preview` echoes `animation`/`direction`/`scale` and omits the sheet
  layout; `combat_idle` works as an alias of `combat`; unknown animation names
  list valid standard + custom names.
- Layout metadata now reports frame counts and y-offsets for alias animations
  (`watering`, `combat`, `1h_*`); `idle`/`combat_idle` frame count corrected
  to 2 (verified against all shipped PNGs).
- Server-side validation for `scale`, `limit`, `offset`, `bodyType`; recolor
  and image caches are capped for long-lived sessions; default output names
  get a timestamp suffix so renders never overwrite each other.

## [1.0.0] - 2026-09-17

### Added

- Initial release: headless port of the Universal-LPC-Spritesheet-Character-Generator
  compositing engine (Node + @napi-rs/canvas, CPU palette recolor).
- MCP tools: `list_categories`, `list_items`, `list_palettes`, `list_animations`,
  `generate_spritesheet`, `get_animation`, `get_preview`.
- Standard universal sheet (832×3456, 13×54 frames of 64px) plus appended
  custom-animation blocks (wheelchair, 128/192px oversize weapons/tools).
- Per-asset attribution (`<name>-credits.csv`/`.txt`) written next to every
  generated sheet, as required by the upstream asset licenses.
- Test suite: engine tests, real stdio MCP protocol tests, canvas smoke test.
