<!--
Keep this short. The only automated check in this repository is `npm test`.
There is no lint, format, typecheck, or publish tooling — do not add a box for
a check that is not wired up, and do not describe one in the PR text.
-->

## What changed

One or two sentences: the behavior, not the file tour.

-

## Related issue

Closes #

## Acceptance gate

- [ ] `npm test` passes locally. That is the whole gate: 25 engine tests
      (`test/run-tests.mjs`), 16 end-to-end stdio MCP tests
      (`test/mcp-client-test.mjs`), 15 end-to-end tests of the 1.3.0 tool surface
      (`test/mcp-surface-test.mjs`), the golden-render determinism gate
      (`test/golden-test.mjs`, 9 items, comparing against `test/golden.json`),
      plus the canvas smoke script (`test/smoke-canvas.mjs`) — 66 passing items
      as of `1.3.0`.
- [ ] A **bug fix ships a regression test** that fails without the fix
      (`CONTRIBUTING.md` makes this binding; new behavior needs a test too).
- [ ] If a change alters visible rendering, the committed README showcase
      images were regenerated with `npm run showcase` and are included in the
      diff (`docs/img/`). Renders are stale the moment the renderer changes.
- [ ] No asset pack content is in this diff — no `spritesheets/`,
      `sheet_definitions/`, `palette_definitions/`, or `CREDITS.csv`. The pack is
      an external ~350MB clone, never vendored.
- [ ] Attribution is intact: renders still write `<name>-credits.csv` and
      `<name>-credits.txt` beside the PNG. Dropping them is a licensing
      regression.
- [ ] If an intended change alters rendering, `test/golden.json` was re-recorded
      with `npm run golden` and its diff is in this PR — never hand-edit it.
      The same applies to bumping the asset-pack `ref` in
      `.github/workflows/ci.yml`: the pin and the re-recorded golden file
      belong to one pass.
- [ ] If the version is bumped, all three declarations agree — `package.json`,
      the `Server` info in `src/index.js`, and the newest `CHANGELOG.md` heading
      (currently all `1.3.0`).
- [ ] Anything that changes the engine's behavior is matched against upstream or
      recorded as a documented divergence in `docs/ARCHITECTURE.md`, and that doc
      was updated in this same pass.
- [ ] The DOX pass is done: every AGENTS.md whose scope covers a touched path was
      re-read and updated if the change altered its contracts.

## Running the tests needs a real asset pack

`npm test` renders against the actual pack; it is not mocked and must not be
vendored. Point at a clone the same way CI does:

```bash
npm ci
LPC_ASSETS_DIR=/path/to/lpc-generator-src npm test   # or a sibling ../lpc-generator-src
npm run setup-assets                                # clones into ~/.lpc-spritesheet
```

CI (`.github/workflows/ci.yml`) checks out the pack at a pinned ref, runs
that on Node 20 and 22 across `ubuntu-latest` and `windows-latest`, and
separately asserts that with `LPC_ASSETS_DIR=/nonexistent` the server exits
`1` and prints `asset pack is not installed` on stderr. `test/golden.json`
records that revision, so local runs need the same pack (install it with
`LPC_ASSETS_REF=<sha> npm run setup-assets`).

## Evidence for a rendering change

Paste the tool result payload (rows, frame counts, offsets, `warnings`, and
the `pack: {revision}` every render now reports) and, if
relevant, before/after images. Pixel assertions are no longer the exception:
the golden gate hashes seven canonical renders, so a rendering change is
expected to show up as a `test/golden.json` diff.

## Notes for the reviewer

- Fidelity to the upstream app is the default; flag any intentional divergence.
- `@napi-rs/canvas` is a native binary: if the diff touches canvas sizes,
  recolor, or crop math, say which body types / animations you re-rendered.
