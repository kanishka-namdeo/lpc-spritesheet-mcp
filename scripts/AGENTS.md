# scripts/

## Purpose

Operator-facing helpers wired to npm scripts. They are dev and release tooling, not part of the
server's runtime — though `package.json` `files` does ship this folder.

## Ownership

- `setup-assets.mjs` (`npm run setup-assets`) — acquires the external LPC asset pack.
- `make-showcase.mjs` (`npm run showcase`) — regenerates the README showcase PNGs in `docs/img/`.

## Local Contracts

- **Both scripts must run before the repo is usable or presentable**, and both need the pack except
  as noted: setup-assets is what makes the pack exist.
- **Setup is idempotent by probe, not by lock.** It treats a directory as already installed when it
  contains both `sheet_definitions/` and `spritesheets/`, then exits without touching it. Keep that
  probe identical to the server's so the two never disagree about what "installed" means.
- **Clone target order mirrors asset discovery:** `$LPC_ASSETS_DIR`, then sibling `../lpc-generator-src`,
  then `~/.lpc-spritesheet/lpc-generator-src`. It requires `git` on PATH and fails loudly without it.
- **The clone is unpinned** (`--depth 1` at the pack's default branch). No script records which
  revision was fetched, so nothing here may claim a reproducible asset version.
- **`make-showcase.mjs` bypasses MCP** and drives `SpriteEngine` directly. Its output is a documentation
  artifact: the README embeds these three files, so they are stale the moment the renderer changes and
  must be regenerated in the pass that changes visible rendering.
- **Showcase labels are Windows-only.** It registers absolute `C:\Windows\Fonts` paths and falls back to
  unlabeled output elsewhere. Keep the fallback; do not let a missing font fail a docs build.
- **Never point these scripts at `output/`** or commit what they generate into a tracked source tree
  other than `docs/img/`.

## Work Guidance

- Add a script by giving it an npm script name; an unreferenced `.mjs` here is invisible to operators.
- Print what was found: the asset dir used, the target chosen, the files written. Silent success here
  is how contributors end up rendering against the wrong pack.

## Verification

No test covers this folder. Correctness is proven by the downstream check it enables — `npm test` after
`setup-assets`, rendered README images after `showcase`.

## Child DOX Index

None.
