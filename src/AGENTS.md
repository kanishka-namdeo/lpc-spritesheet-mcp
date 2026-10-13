# src/

## Purpose

The shipped runtime: a stdio MCP server that exposes the engine as seven tools. Nothing here
touches the network; everything here is plain ESM with no build step.

## Ownership

- `index.js` — server bootstrap, asset-pack discovery, tool declarations, dispatch, response envelope.
- `character.js` — the request pipeline shared by the three render tools: input normalization,
  render, save, result payload.
- `engine/` — rendering itself. Read `src/engine/AGENTS.md` before touching it.

## Local Contracts

- **stdout is the protocol.** The transport is stdio JSON-RPC. Never write to stdout from this
  subtree: use `console.error` for everything human, as `resolveAssetsDir` and the startup lines do.
  A stray `console.log` corrupts the client stream.
- **The tool list is a test assertion.** `test/mcp-client-test.mjs` asserts the exact sorted set of
  seven tool names. Adding, renaming, or removing a tool means editing `TOOLS`, the dispatch switch,
  the header comment, and that assertion in the same pass.
- **`CHARACTER_PROPS` is the single shared argument schema.** `generate_spritesheet`,
  `get_animation`, and `get_preview` all spread it. A new cross-tool argument belongs there so all
  three, and the `CHAR_ARG_KEYS` typo-warning list, pick it up at once.
- **Per-tool arguments stay out of `CHARACTER_PROPS`** (`animation`, `direction`, `scale`) and must be
  appended to that tool's `unknownArgWarnings` key list, or the tool silently ignores its own inputs.
- **Errors are payloads, not crashes.** Throw `CharacterRequestError` (or let `SelectionError` escape)
  so `errorPayload` adds the discovery hint; anything else surfaces as a bare message. Both paths
  return `isError: true` with pretty-printed JSON — never let a tool handler reject.
- **Render tools share one save path.** They differ only by the `extract` callback handed to
  `renderAndSave`. Add a new render tool by supplying an extractor, not by duplicating write logic.
- **Missing assets fail at startup, on stderr, exit 1**, with the phrase `asset pack is not installed`.
  That phrase is grepped by CI; if you reword it, update `.github/AGENTS.md` and `ci.yml`.
- Default output is `<package>/output/<name>-<timestamp>.png`; `resolveOutputPath` creates parent
  directories and resolves relative paths against the **server's** cwd, not the client's.

## Work Guidance

- Keep tool results engine-ready: report exact rows, frame counts, cycles, offsets, and warnings so a
  consumer never has to re-derive the layout.
- Unknown input is a warning, not a failure — `unknownArgWarnings` exists so a typo'd argument tells
  the caller what was ignored instead of silently rendering something else.
- Warnings aggregate one message per item; keep that shape rather than emitting per-frame noise.

## Verification

`npm test` (see `test/AGENTS.md`). `mcp-client-test.mjs` drives the real server over stdio, so it
covers dispatch and the response envelope; `run-tests.mjs` covers the engine beneath it.

## Child DOX Index

| Path | Owns |
|---|---|
| `engine/` | The upstream-fidelity port: catalog, recolor, sheet compositing, selection, credits, custom animations |
