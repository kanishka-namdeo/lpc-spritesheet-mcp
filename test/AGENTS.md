# test/

## Purpose

The acceptance gate for the whole repo. It is the only automated check that exists, and it is
the one CI runs.

## Ownership

- `run-tests.mjs` — 25 engine-level tests, in-process: composition, recolor, selection, crops, custom
  blocks, the warning-ordering determinism claim, layer inventory, the layout audit, and the
  character-spec round-trip.
- `mcp-client-test.mjs` — 16 end-to-end tests: spawns the real server over stdio with the SDK client
  and exercises handshake, `tools/list`, and `tools/call`. Includes the regression pins for the
  documented behavior — one of them renders the README's own example call and asserts the exact
  `image` and `frames` values the README prints, so a doc example cannot rot unnoticed.
- `mcp-surface-test.mjs` — 15 end-to-end tests for the 1.3.0 surface: titles and annotations on all
  thirteen tools, `outputSchema`↔`structuredContent` pairing, the `list_items` byte budget across every
  category, `fields`/`nextOffset`, `list_palettes` coverage, the inline `type:"image"` block, both
  `export_character` modes, `validate_sheet`, and the `pack: {revision}` claim.
- `mcp-new-tools-test.mjs` — 22 end-to-end tests for the 1.4.0 surface: GIF previews (header, loop
  extension, inline `image/gif`, `.gif` path coercion, `fps`/`format` validation), presets (list,
  one-call render, override merge, unknown-preset error), `random_character` (determinism, inline
  preview, `preview:false`, gear validation), `generate_batch` (files, manifest, contact grid,
  rolled-up credits, batch determinism, re-render), prompts and resources over the wire, the
  offline `design_character` gate, and all five atlas dialects end-to-end.
- `gif-test.mjs` — 6 unit tests for the GIF encoder: header/loop extension, byte determinism, a
  minimal in-test GIF block walker counting frames, GCE transparency flags, delay clamping,
  `TypeError` paths. Runs without the asset pack.
- `random-test.mjs` — 9 tests: PRNG stability/distribution, same-seed determinism, 20-seed
  distinctness, `normalizeSelections` validity across seeds and gear profiles, walk-cycle
  painting, bodyType pinning, bare-gear guarantees, argument validation, batch per-index seeds.
- `presets-test.mjs` — 23 tests: every preset normalizes, renders, and paints its walk cycle with
  no walk-row gaps; structural coverage with documented pack-level exceptions (armour is its own
  group; lizard heads ship their own face).
- `atlas-formats-test.mjs` — 5 tests for the dialect emitters: cycle-correct `animationsMap`,
  Aseprite array-frames + frameTags indices, Godot sub-resource/animation shape, libGDX region
  blocks, Unity y-flip + deterministic GUID + `userData` playback map.
- `url-test.mjs` — 7 tests for the upstream URL encoder: two round-trips, byte-pinned format
  string, `generatorUrl` prefix, stability, colors folding, "none"/v2-JSON handling.
- `ai-test.mjs` — 14 fully offline tests (mocked `fetchImpl`, no keys): env gate, digest budget and
  curation, chatCompletion happy path + `response_format` retry + errors + timeout, spec parsing,
  the design flow, and the self-healing repair round.
- `golden-test.mjs` — the determinism gate: asserts `test/golden.json` was recorded against the pack
  revision on disk, re-renders all seven canonical specs and compares hashes, dimensions, sorted
  warnings and credit counts, then renders one spec twice and asserts `Buffer.compare === 0`.
  `golden-specs.mjs` is the spec list, shared with the generator so the two cannot diverge.
- `smoke-canvas.mjs` — top-level script, not a `node:test` suite: asserts `@napi-rs/canvas` can
  load, draw, read back and recolor a pack PNG in this environment.

`npm test` reports these as 140 passing items (25 engine + 16 client + 15 surface + 22 new-tools
+ 6 gif + 9 random + 23 presets + 5 atlas + 7 url + 14 ai + 9 golden + the smoke script counted as
one by the runner).

## Local Contracts

- **The `npm test` script lists these files by name.** It used to be `node --test "test/*.mjs"`,
  which cannot work: Node 20's test runner has no glob support, and a quoted glob is not expanded by
  `cmd.exe` on Windows runners either. A new test file must be added to that script line in the same
  pass, or it silently never runs.
- **One asset lookup, shared with the server.** Every file here calls `findAssetsDir()` from
  `src/assets-dir.js` and throws a clear "run `npm run setup-assets`" message when it returns null.
  Do not re-implement the discovery order in a test file — three private copies are what made CI
  pass locally and fail on the runners.
- **The stdio test must hand the pack location to the child.** `StdioClientTransport` inherits only
  a small env allowlist, so `LPC_ASSETS_DIR` is stripped unless passed in the transport's `env`.
  Without it the spawned server exits at startup and every end-to-end test fails as `hookFailed`
  with `MCP error -32000: Connection closed`.
- **Artifacts go in `test/out/` and nowhere else.** That directory is gitignored. Engine-test
  outputs use bare names; the stdio suites prefix `mcp-` and `surface-` so the three stay
  distinguishable, and the golden gate writes `golden-<spec>.png` per canonical render.
  Render tools also write `-credits.csv`/`-credits.txt` beside them, and `export_character` writes a
  whole bundle directory — all expected, not clutter to suppress.
- **Tool surface is pinned by name.** `mcp-client-test.mjs` asserts the exact sorted set of the nine
  tool names. Change the surface and this file changes in the same pass.
- **`test/golden.json` is data, not a snapshot to be waved through.** It is written only by
  `npm run golden`, records the pack revision it was taken at, and `golden-test.mjs` fails when the
  pack on disk differs from it. When a rendering change is intended, the re-recorded file belongs in
  the same commit as the change; when it is not, the diff is the bug report. Never hand-edit a hash.
  A test that re-renders one spec twice proves byte determinism independently of which pack is present,
  so a pack drift cannot be used to explain a real rendering change.
- **Assertions are `node:assert/strict`.** No third-party framework, no jest/vitest globals.

## Work Guidance

- New behavior needs a test; a bug fix needs a regression test — `CONTRIBUTING.md` makes this binding.
- Prefer asserting on the JSON payload the tool returns (layout, warnings, echoed selections) over
  asserting on pixels; a few tests do check pixel color and should stay that way where recolor is the subject.
- The suite needs the real pack. Do not mock it, and do not vendor it.

## Verification

`npm test`, with `LPC_ASSETS_DIR` pointing at a valid pack **at the revision `test/golden.json`
records** — a drifted pack fails the golden gate on purpose. CI runs it on Node 20 and 22 across
Ubuntu and Windows against the pinned checkout — see `.github/AGENTS.md`.

## Child DOX Index

None. `test/out/` is generated, gitignored, and owns nothing.
