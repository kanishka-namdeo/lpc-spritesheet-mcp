# test/

## Purpose

The acceptance gate for the whole repo. It is the only automated check that exists, and it is
the one CI runs.

## Ownership

- `run-tests.mjs` — 19 engine-level tests, in-process: composition, recolor, selection, crops, custom blocks.
- `mcp-client-test.mjs` — 16 end-to-end tests: spawns the real server over stdio with the SDK client
  and exercises handshake, `tools/list`, and `tools/call`. Includes the regression pins for the
  documented behavior — one of them renders the README's own example call and asserts the exact
  `image` and `frames` values the README prints, so a doc example cannot rot unnoticed.
- `smoke-canvas.mjs` — top-level script, not a `node:test` suite: asserts `@napi-rs/canvas` can
  load, draw, read back and recolor a pack PNG in this environment.

`npm test` reports these as 36 passing items (19 + 16 + the smoke script counted as one by the runner).

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
  outputs use bare names; end-to-end outputs are prefixed `mcp-` so the two are distinguishable.
  Render tools also write `-credits.csv`/`-credits.txt` beside them — expected, not clutter to suppress.
- **Tool surface is pinned by name.** `mcp-client-test.mjs` asserts the exact sorted set of the seven
  tool names. Change the surface and this file changes in the same pass.
- **Assertions are `node:assert/strict`.** No third-party framework, no jest/vitest globals.

## Work Guidance

- New behavior needs a test; a bug fix needs a regression test — `CONTRIBUTING.md` makes this binding.
- Prefer asserting on the JSON payload the tool returns (layout, warnings, echoed selections) over
  asserting on pixels; a few tests do check pixel color and should stay that way where recolor is the subject.
- The suite needs the real pack. Do not mock it, and do not vendor it.

## Verification

`npm test`, with `LPC_ASSETS_DIR` pointing at a valid pack. CI runs it on Node 20 and 22 across
Ubuntu and Windows — see `.github/AGENTS.md`.

## Child DOX Index

None. `test/out/` is generated, gitignored, and owns nothing.
