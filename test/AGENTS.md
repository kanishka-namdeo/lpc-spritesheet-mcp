# test/

## Purpose

The acceptance gate for the whole repo. It is the only automated check that exists, and it is
the one CI runs.

## Ownership

- `run-tests.mjs` — engine-level tests, in-process: composition, recolor, selection, crops, custom blocks.
- `mcp-client-test.mjs` — end-to-end: spawns the real server over stdio with the SDK client and
  exercises handshake, `tools/list`, and `tools/call`.
- `smoke-canvas.mjs` — top-level script, not a `node:test` suite: proves `@napi-rs/canvas` can load
  and draw a pack PNG in this environment.

## Local Contracts

- **The glob is the runner.** `npm test` is `node --test "test/*.mjs"`. Any `.mjs` dropped in this
  folder runs; anything not matching the pattern never runs. Files here must be tests or smoke
  scripts, not helpers.
- **Shared helpers do not exist yet.** Each file resolves its own asset directory. Follow the
  `run-tests.mjs` pattern — honour `LPC_ASSETS_DIR`, then the sibling `../lpc-generator-src`.
  `smoke-canvas.mjs` hard-codes the sibling path and ignores the env var; that is the anti-pattern,
  not the convention.
- **Only the server honours all three asset locations.** A pack installed by `npm run setup-assets`
  into `~/.lpc-spritesheet` satisfies `mcp-client-test.mjs` but not `run-tests.mjs` unless
  `LPC_ASSETS_DIR` is exported. Set it in dev the same way CI does.
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
