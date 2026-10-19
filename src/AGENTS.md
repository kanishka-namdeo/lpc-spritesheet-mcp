# src/

## Purpose

The shipped runtime: a stdio MCP server that exposes the engine as thirteen tools plus three
prompts and three resources. The default runtime touches no network; the one exception is the
opt-in `design_character` AI path, gated on `LPC_AI_API_KEY` (see `ai.js`). Everything here is
plain ESM with no build step.

## Ownership

- `index.js` — server bootstrap, tool/prompt/resource declarations (schemas, titles, annotations,
  `outputSchema`), dispatch, response envelope, and the `list_*`/`validate_sheet` payload shapes.
- `character.js` — the request pipeline shared by the render tools: input normalization (preset,
  saved-character document, explicit selections), render, save (PNG or GIF), result payload. Also
  `describeSelections`, the one echo format.
- `export.js` — `export_character`: the same render fanned out into a directory bundle (sheet PNG,
  atlas in one of five dialects, manifest, per-animation or per-frame crops, credits). The only
  module besides `character.js` that writes files, and only inside the `output_dir` it is given.
- `atlas-formats.js` — pure atlas-dialect emitters (TexturePacker `animations` map, Aseprite JSON,
  Godot `.tres`, libGDX `.atlas`, Unity `.png.meta`) over the frame model `export.js` builds. No
  filesystem, no clock — determinism is a tested claim. Each emitter's doc comment cites the
  consumer-side source it was verified against.
- `presets.js` — the curated preset library (data + `listPresets`/`getPreset`/`presetNames`). Every
  entry is verified renderable by `test/presets-test.mjs`.
- `random.js` — the seeded random generator (cyrb128→mulberry32 PRNG, gear profiles, completeness
  gates) and the `randomCharacters` batch helper. Output is tool-input form that must survive
  `normalizeSelections` — that is the tested contract.
- `ai.js` — the opt-in AI designer: env config reader (`aiConfigFromEnv`), byte-budgeted catalog
  digest, OpenAI-compatible `chatCompletion` client (injectable `fetch`, timeout, one retry without
  `response_format`), strict spec parser, and the `designCharacter` flow with its self-healing
  repair round. Reads no `process.env` itself — the caller passes an env object. No hardcoded keys.
- `spec.js` — reading and writing saved-character documents (v2 with the layer inventory, v1 with a
  URL state hash), plus the `toStateHash`/`generatorUrl` encoder half: a faithful port of upstream's
  `hash.ts` serialization so results link back to the live web app.
- `validate.js` — the `validate_sheet` audits: port tables vs the pack, painted columns vs declared
  counts, item definitions vs what this port can resolve. Writes nothing.
- `assets-dir.js` — the one implementation of the asset-pack discovery order, the "is this a valid
  pack" probe, and `packRevision()`. The server, `test/` and `scripts/` all import it, so a setup that
  satisfies one cannot silently fail another. Lookups only: it never logs, throws, or exits —
  reporting and `process.exit(1)` stay in `resolveAssetsDir` in `index.js`. `packRevision` shells out
  to `git rev-parse`, caches per directory, and returns `null` for a non-git pack rather than failing.
- `engine/` — rendering itself. Read `src/engine/AGENTS.md` before touching it.

## Local Contracts

- **stdout is the protocol.** The transport is stdio JSON-RPC. Never write to stdout from this
  subtree: use `console.error` for everything human, as `resolveAssetsDir` and the startup lines do.
  A stray `console.log` corrupts the client stream.
- **The tool list is a test assertion.** `test/mcp-client-test.mjs` asserts the exact sorted set of
  thirteen tool names. Adding, renaming, or removing a tool means editing `TOOLS`, its `TOOL_META` entry
  (title + all four annotations — a tool without one fails at startup), the dispatch switch, the header
  comment, the README table, and that assertion in the same pass.
- **`CHARACTER_PROPS` is the shared argument schema** for `generate_spritesheet`, `get_animation` and
  `get_preview` (and carries `preset`, resolved inside `buildSelections` before the saved-character
  document and explicit selections merge on top, in that order). `export_character` uses
  `BUNDLE_CHARACTER_PROPS` (no `output_path` — it takes
  `output_dir`) and `validate_sheet` uses `CHARACTER_ONLY_PROPS` (no output or sidecar arguments,
  because it writes nothing). Derive a new subset from `CHARACTER_PROPS` rather than copying props
  into a second literal, and list the resulting keys in that tool's `unknownArgWarnings` set so an
  ignored argument is reported.
- **Per-tool arguments stay out of `CHARACTER_PROPS`** (`animation`, `direction`, `scale`) and must be
  appended to that tool's `unknownArgWarnings` key list, or the tool silently ignores its own inputs.
- **Errors are payloads, not crashes.** Throw `CharacterRequestError` (or let `SelectionError` escape)
  so `errorPayload` adds the discovery hint; anything else surfaces as a bare message. Both paths
  return `isError: true` with pretty-printed JSON — never let a tool handler reject.
- **Single-file render tools share one save path.** They differ only by the `extract` callback handed
  to `renderAndSave`. Add a new one-file render tool by supplying an extractor, not by duplicating
  write logic. `export_character` is the deliberate exception: it writes many files, so it calls
  `buildSelections` and `engine.renderCharacter` directly through `export.js`.
- **`outputSchema` and `structuredContent` are a pair, maintained by hand.** The low-level `Server`
  does not validate them, so a tool declares a schema only together with a dispatch that sends
  `schema` to `jsonResult`. `jsonResult` also strips `inlinePng`/`inlineImage` before serializing —
  raw bytes belong in an image block (with `annotations: {audience: ["user"]}`), never in the JSON
  text. `jsonResultWithImage` is the only envelope that attaches one, and is what the preview
  conveniences of `random_character`/`design_character` route through.
- **The AI path is opt-in and quarantined.** `design_character` checks `aiConfigFromEnv(process.env)`
  first and returns a setup error without a key — no socket. All network I/O lives in `ai.js`'s
  `chatCompletion` (injectable `fetchImpl` for tests); `ai.js` never reads `process.env` itself.
- **Missing assets fail at startup, on stderr, exit 1**, with the phrase `asset pack is not installed`.
  That phrase is grepped by CI; if you reword it, update `.github/AGENTS.md` and `ci.yml`. The fix hint
  names the `lpc-spritesheet-setup` bin first, because an installed server has no checkout to run
  `npm run setup-assets` in.
- Default output is `lpc-spritesheet/<name>-<timestamp>.png` under the OS temp directory;
  `resolveOutputPath` creates parent directories and resolves relative paths against the **server's**
  cwd, not the client's. Never default into the package directory — an installed server lives under
  `node_modules/`, which the next `npm install` replaces and a root-owned global prefix cannot write.

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
| `engine/` | The upstream-fidelity port: catalog, recolor, sheet compositing, selection, credits, custom animations, GIF encoding |
