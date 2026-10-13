# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

### Changed

- Removed dead surface found while fixing the above: an unused import set in `src/index.js`, a
  duplicated animation-folder table (its `const` was also referenced before declaration), and two
  unused exports' callers. `describeLayout`'s column count now derives from
  `STANDARD_ANIMATION_FRAMES_PER_ROW` instead of a literal.
- Corrected claims that no longer held: the palette count in the README (the `all`/`lpcr` palette is
  75 colors, not 74), the "15 animations x 4 directions" phrasing (13 blocks are 4-direction, `hurt`
  and `climb` ship one facing each — which is exactly the 54 rows), the credits filenames in
  `SECURITY.md`, and four upstream counts in `docs/capability-inventory.md`.

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
