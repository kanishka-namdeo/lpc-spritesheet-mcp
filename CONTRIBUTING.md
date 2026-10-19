# Contributing

Thanks for improving `lpc-spritesheet-mcp`!

## Development setup

```bash
git clone https://github.com/kanishka-namdeo/lpc-spritesheet-mcp.git
cd lpc-spritesheet-mcp
npm install

# one-time: clone the ~350MB asset pack the server reads from
npm run setup-assets        # → ~/.lpc-spritesheet/lpc-generator-src
# LPC_ASSETS_REF=<sha> pins the clone and prints the revision installed;
# `test/golden.json` records the pack revision the golden gate expects.
# (or clone Universal-LPC-Spritesheet-Character-Generator yourself
#  next to this repo as ../lpc-generator-src, or anywhere + LPC_ASSETS_DIR)

npm test                    # 66 passing items: engine + stdio MCP + tool-surface tests
                            # + golden-render determinism gate + canvas smoke
```

`LPC_ASSETS_DIR` overrides where the server looks for the asset pack, and the test suite honours the
same order the server does (`src/assets-dir.js`), so a pack installed by `npm run setup-assets` is
enough — no export needed.

## Project layout

- `src/engine/` — headless port of the upstream generator's renderer
  (`constants`, `catalog`, `recolor`, `sheet`, `selection`, `credits`,
  `custom-animations`). Plain ESM JavaScript, no build step.
- `src/index.js` — MCP tool layer. `src/character.js` — shared request
  pipeline (input normalization, rendering, saving). `src/assets-dir.js` — the one
  implementation of the asset-pack discovery order.
- `docs/ARCHITECTURE.md` — the upstream → port mapping, local inventions, diagrams and invariants
  every change must preserve. **Read it before touching `src/engine/`.**
- `docs/capability-inventory.md` — what the upstream generator can do.
- `docs/img/` — every image the README embeds, all generated. See the image rule below.
- `test/` — the acceptance gate, including the golden renders and `test/golden.json`.
  `scripts/` — setup, docs-asset generation, and `npm run golden` (`scripts/make-golden.mjs`).

## Ground rules

1. **Port fidelity.** The engine mirrors
   [Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator).
   Behavior changes must either match the upstream app or be an explicit,
   documented improvement (like aggregated warnings). Cite the upstream
   file/line in the PR when relevant.
2. **Tests.** New behavior needs a test; bug fixes need a regression test.
   Run the full suite (`npm test`) — it spawns the real server over stdio.
3. **Licensing.** This code is GPL-3.0-only (it derives from the GPL-3.0
   upstream). The *assets* keep their own licenses; never bundle them into
   this repo, and keep attribution files written next to generated sheets.
4. **No secrets, no assets in git.** CI and contributors rely on the asset
   clone step, not vendored copies.
5. **Docs images are generated, never hand-placed.** Everything in `docs/img/` comes from
   `npm run assets` (`diagrams` → the architecture SVG, `showcase` → the rendered banners and
   gallery, `demo` → the animated session capture). A change that alters visible rendering must
   regenerate them in the same pass, and each render keeps its credits sidecar.
6. **The golden gate is data, not prose.** `test/golden.json` records SHA-256 hashes, dimensions,
   warnings, credit counts, and the pack revision for seven canonical renders; `npm test` re-renders
   and compares (`test/golden-test.mjs`). Never hand-edit it — an intentional rendering change
   re-records it with `npm run golden` and commits the diff in the same pass.

## Releasing

There is no publish workflow — CI runs `npm test` (against the asset-pack revision pinned in
`.github/workflows/ci.yml`) and the no-assets check, and stops there. The
release is a human sequence, run from a checkout with the asset pack present.

1. **Gate first.** `npm test` (140 items) locally and CI green on `main`. Nothing else in this repo
   checks the publish surface, so do not skip this step and do not publish from a dirty tree.
2. **Decide the version.** A change to the 832x3456 universal layout, a tool rename, or any other
   break of the external contract is a major. A new tool, argument, or `bin` is a minor. Everything
   else is a patch.
3. **Set the version in all three places** — `package.json`, the `Server` info in `src/index.js`, and
   the newest `CHANGELOG.md` heading, which also gets the release date. Turn `## [Unreleased]` into the
   released heading and leave an empty `## [Unreleased]` above it.
4. **Pack and install the artifact, then run it.** This is the only step that catches what a checkout
   cannot see, because the server resolves paths relative to its own package directory:

   ```bash
   npm pack                                                   # → lpc-spritesheet-mcp-<version>.tgz
   npm init -y && npm install ../lpc-spritesheet-mcp-<version>.tgz
   ./node_modules/.bin/lpc-spritesheet-mcp                      # no pack: stderr block, exit 1
   npx -y @modelcontextprotocol/inspector --cli \
     node_modules/lpc-spritesheet-mcp/src/index.js --method tools/list
   ```

   Check the tarball list too: `src/`, `scripts/setup-assets.mjs`, `docs/*.md`, `README.md`,
   `CHANGELOG.md`, `LICENSE`. No `docs/img/`, no generators, no `test/`, no asset pack. `tools/list`
   must return the thirteen tools, and `initialize` must report the version you just set.
5. **Publish.** `npm whoami` must already answer; if the account requires 2FA, pass `--otp=<code>`.
   Provenance cannot be minted from a workstation — `--provenance` needs CI's OIDC identity.
6. **Mark it.** `git tag v<version> && git push --tags`, then a GitHub release whose notes are that
   `CHANGELOG.md` section. Nothing here enforces the tag, so it is easy to forget and painful to
   reconstruct.
7. **Verify from the registry.** `npm view lpc-spritesheet-mcp version`, and one `npx -y
   lpc-spritesheet-mcp` startup from a directory that is not this checkout.

`lpc-spritesheet-setup` in step 4 clones ~350 MB when no pack is found, and prints "already present"
when one is. Point it at an existing pack with `LPC_ASSETS_DIR` unless you mean the clone.

## Reporting bugs

Open a [new issue](https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/issues/new/choose) using
the bug or asset-pack template. They ask for the evidence that makes a report reproducible: the tool
name, the exact arguments JSON, the FULL JSON payload returned, and the server's stderr block (it
prints which pack locations it searched). For render bugs, attach the output PNG and the
`selections` echo from the result payload.
