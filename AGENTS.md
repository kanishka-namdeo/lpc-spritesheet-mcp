# DOX framework

- DOX is a highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

---

# Project

`lpc-spritesheet-mcp` — a Node.js MCP server that composes and renders Universal LPC
character spritesheets headlessly. It is a port of the
[Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
web app's runtime compositing onto `@napi-rs/canvas`. Plain ESM, no build step, no browser.

The server ships **no art**. It reads a local clone of the upstream asset pack and renders it.

## Global Contracts

These bind every subtree. Child docs may add local detail but may not weaken them.

- **Asset pack never enters this repo.** The ~350MB pack lives in an external clone.
  Vendoring sprites, `sheet_definitions/`, `palette_definitions/`, or `CREDITS.csv` into
  this repository is prohibited by `CONTRIBUTING.md` and by `package.json` `files`.
- **Attribution is a product feature, not a courtesy.** Every render writes
  `<name>-credits.csv` and `<name>-credits.txt` beside the PNG (assets are a mix of
  OGA-BY 3.0, CC-BY-SA 3.0, CC-BY 3.0/4.0 and GPL). `include_credits` defaults to on and
  a change that drops attribution files is a licensing regression. The duty also covers this
  repo's own committed imagery: every generated render in `docs/img/` ships a credits sidecar
  (`docs/AGENTS.md` owns the rule).
- **Code is GPL-3.0-only** because it derives from the GPL upstream. Assets keep their own
  licenses; the two are never conflated.
- **The universal sheet layout is an external contract.** 13 columns x 54 rows of 64px
  frames (832x3456), with the row-block grid in `src/engine/constants.js`. Engine consumers
  parse it from tool results. Changing it is a breaking change and a version bump.
- **Runtime is offline and inert by default.** No network calls, no telemetry, no secrets, no env
  reads other than `LPC_ASSETS_DIR` — **with one opt-in exception**: when `LPC_AI_API_KEY` is set,
  the `design_character` tool calls an OpenAI-compatible chat endpoint (`LPC_AI_BASE_URL`,
  `LPC_AI_MODEL`; see `src/ai.js`). Without the key the server is fully offline and that tool
  returns a setup error. `SECURITY.md` is the outward statement of this. (Recorded 2026-10-19 at
  the owner's request: the Dashscope coding-intl endpoint with the qwen3.7-plus / kimi-k2.5 /
  qwen3.6-plus models is the reference configuration; kimi-k2.5 is the default because it measured
  ~6s on the design task where the qwen models took 50–70s.)
- **Version is declared in three places and they must agree:** `package.json`, the `Server`
  info in `src/index.js`, and the newest `CHANGELOG.md` heading.
- **The published tarball is chosen by `package.json` `files`,** not by `.npmignore`: `src/`,
  `scripts/setup-assets.mjs`, `docs/*.md`, `README.md`, `CHANGELOG.md`, `LICENSE`. Never `docs/img/`,
  the generators, or `test/` — those need a checkout, the asset pack, or a devDependency, none of
  which an installer has. `CONTRIBUTING.md` owns the release runbook, whose pack-and-install step is
  the only check that runs the shipped artifact instead of the checkout.
- **The registry is written by CI only, and by no secret.** `.github/workflows/publish.yml` runs the
  same gate and then `npm publish --provenance`, authenticated with npm Trusted Publishing against
  this repo and that workflow file; there is no `NPM_TOKEN` in repo settings and none should be
  added. A tag is a publish input: the workflow checks it out, so the tagged commit must carry the
  manifest intended for that version.
- **`npm test` is the acceptance gate.** No lint, typecheck, or format tooling exists in this
  repo; do not claim a check that is not wired up.
- **Rendering is reproducible, and that is a tested claim.** `test/golden.json` records SHA-256
  hashes of canonical renders against a named asset-pack revision; `npm run golden` re-records it and
  `test/golden-test.mjs` fails on drift, including a revision mismatch. Bumping the pack revision CI
  checks out, `npm run golden`, and the manifest therefore belong to one change — a re-recorded
  golden file with no rendering reason is the bug, not the fix.

## Asset Discovery Order

One implementation: `src/assets-dir.js` (`assetCandidates()`, `hasAssets()`, `findAssetsDir()`,
`packRevision()`). The server, `test/` and `scripts/` all import it, so a pack that satisfies one of
them satisfies all. (Three private copies of this order are what let CI pass on a dev box and fail on
the runners.) `packRevision()` is how a result says which commit its art came from: `git rev-parse`
cached per directory, `null` for a non-git pack, never a throw.

1. `$LPC_ASSETS_DIR`
2. Sibling clone `../lpc-generator-src` (the dev-checkout convention)
3. `~/.lpc-spritesheet/lpc-generator-src` (where `npm run setup-assets` clones)

A valid pack is a directory containing both `sheet_definitions/` and `spritesheets/`. The
`StdioClientTransport` in the end-to-end test must pass `LPC_ASSETS_DIR` explicitly: the SDK inherits
only a small env allowlist, so an unset child environment is the difference between green and red CI.

## Documentation Rules

- The catalog is data-driven and large. Item, group, and palette counts come from the loaded
  asset pack at runtime — do not hard-code them into docs or messages unless the number is
  the point of the sentence.
- `README.md` owns user-facing facts. `docs/` owns port internals. `CHANGELOG.md` owns
  released history. An AGENTS.md owns working rules. Do not copy a table between them.
- Generated or scratch output is never documentation: `output/`, `test/out/`, and
  `audit-tmp/` are gitignored and unowned by any DOX child.

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

- 2026-10-19 (owner): the offline-runtime contract gains the opt-in `LPC_AI_*` AI-design exception
  (see Global Contracts above). The reference endpoint is Dashscope coding-intl
  (`https://coding-intl.dashscope.aliyuncs.com/v1`, OpenAI-compatible) with models qwen3.7-plus /
  kimi-k2.5 / qwen3.6-plus; keys are passed by the operator's MCP client env, never committed.
- 2026-10-19 (owner): delight features are first-class — animated GIF previews, seeded random
  characters, NPC batches, curated presets, multi-engine atlas dialects, upstream `generatorUrl`
  round-trip, MCP prompts/resources. All offline-capable except design_character (above).
- 2026-10-19 (owner): npm publishing takes no stored credential — use npm Trusted Publishing
  (GitHub Actions OIDC, workflow `publish.yml`) rather than an `NPM_TOKEN` secret, and keep
  provenance on. When a release's tag lags the packaging that should ship under it, move the tag
  rather than renumbering the version.

## Child DOX Index

| Path | Owns |
|---|---|
| `src/` | Shipped runtime: the thirteen-tool MCP surface (+ prompts/resources), the shared character-request pipeline, the bundle exporter, the atlas dialect emitters, the preset library, the seeded random generator, the opt-in AI designer, the saved-character reader/writer, the layout auditor |
| `src/engine/` | Headless port of the upstream renderer; fidelity rules; GIF encoding |
| `test/` | The acceptance gate: engine tests, real stdio MCP tests, the golden determinism manifest, canvas smoke |
| `scripts/` | Asset-pack setup and the generators behind every committed image in `docs/img/`, plus `npm run golden` |
| `docs/` | Durable internals: port map, invariants, upstream capability record |
| `.github/` | CI: the matrix, the pinned asset-pack checkout, the no-assets assertion; the publish workflow (trusted-publishing OIDC, provenance, tag/version guard); plus issue/PR templates and Dependabot |

Root-owned, with no child of their own: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `LICENSE`, `package.json`, `.gitignore`, `.gitattributes`.
`audit-tmp/` is throwaway verification scratch — gitignored, run by nothing, not a durable boundary.
