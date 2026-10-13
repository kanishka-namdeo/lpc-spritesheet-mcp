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

- [ ] `npm test` passes locally. That is the whole gate: 19 engine tests
      (`test/run-tests.mjs`), 16 end-to-end stdio MCP tests
      (`test/mcp-client-test.mjs`), plus the canvas smoke script
      (`test/smoke-canvas.mjs`) — 36 passing items as of `1.1.0`.
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
- [ ] If the version is bumped, all three declarations agree — `package.json`,
      the `Server` info in `src/index.js`, and the newest `CHANGELOG.md` heading
      (currently all `1.1.0`).
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

CI (`.github/workflows/ci.yml`) runs that on Node 20 and 22 across
`ubuntu-latest` and `windows-latest`, and separately asserts that with
`LPC_ASSETS_DIR=/nonexistent` the server exits `1` and prints
`asset pack is not installed` on stderr.

## Evidence for a rendering change

Paste the tool result payload (rows, frame counts, offsets, `warnings`) and, if
relevant, before/after images. Pixel assertions are the exception, not the rule —
the suite mostly asserts on the JSON.

## Notes for the reviewer

- Fidelity to the upstream app is the default; flag any intentional divergence.
- `@napi-rs/canvas` is a native binary: if the diff touches canvas sizes,
  recolor, or crop math, say which body types / animations you re-rendered.
