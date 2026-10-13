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
  a change that drops attribution files is a licensing regression.
- **Code is GPL-3.0-only** because it derives from the GPL upstream. Assets keep their own
  licenses; the two are never conflated.
- **The universal sheet layout is an external contract.** 13 columns x 54 rows of 64px
  frames (832x3456), with the row-block grid in `src/engine/constants.js`. Engine consumers
  parse it from tool results. Changing it is a breaking change and a version bump.
- **Runtime is offline and inert.** No network calls, no telemetry, no secrets, no env reads
  other than `LPC_ASSETS_DIR`. `SECURITY.md` is the outward statement of this.
- **Version is declared in three places and they must agree:** `package.json`, the `Server`
  info in `src/index.js`, and the newest `CHANGELOG.md` heading.
- **`npm test` is the acceptance gate.** No lint, typecheck, or format tooling exists in this
  repo; do not claim a check that is not wired up.

## Asset Discovery Order

Only `src/index.js` implements the full order. Other entry points implement subsets, so a
setup that works for the server can still fail for the test suite or the showcase script.

1. `$LPC_ASSETS_DIR`
2. Sibling clone `../lpc-generator-src` (the dev-checkout convention)
3. `~/.lpc-spritesheet/lpc-generator-src` (where `npm run setup-assets` clones)

A valid pack is a directory containing both `sheet_definitions/` and `spritesheets/`.

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

## Child DOX Index

| Path | Owns |
|---|---|
| `src/` | Shipped runtime: the MCP tool surface and the shared character-request pipeline |
| `src/engine/` | Headless port of the upstream renderer; fidelity rules |
| `test/` | The acceptance gate: engine tests, real stdio MCP tests, canvas smoke |
| `scripts/` | Asset-pack setup and README showcase generation |
| `docs/` | Durable internals: port map, invariants, upstream capability record |
| `.github/` | CI: the matrix, the asset-pack checkout, the no-assets assertion |

Root-owned, with no child of their own: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `LICENSE`, `package.json`, `.gitignore`, `.gitattributes`.
`audit-tmp/` is throwaway verification scratch — gitignored, run by nothing, not a durable boundary.
