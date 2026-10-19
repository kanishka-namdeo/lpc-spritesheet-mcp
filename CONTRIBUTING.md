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

CI runs `npm test` (against the asset-pack revision pinned in
`.github/workflows/ci.yml`) and the no-assets check. Publishing happens from CI —
[`publish.yml`](./.github/workflows/publish.yml) runs on a published GitHub release (or a manual
dispatch), gates on the same tests, and publishes with **provenance**, which only CI's OIDC
identity can mint. One-time setup: on the npm package, add a **Trusted Publisher** for GitHub
Actions naming repository `kanishka-namdeo/lpc-spritesheet-mcp` and workflow `publish.yml`. Any
branch or environment filter added there has to match the ref the workflow actually runs on — a
`release` event runs on the tag, a dispatch on whatever ref it was started from. No npm token is
kept in repo settings, and the publish step deliberately sets no `NODE_AUTH_TOKEN`. The job installs
`npm@11` first: trusted publishing needs npm CLI ≥ 11.5.1, Node 22 ships 10.x, and the older CLI
fails at the upload with `404 'lpc-spritesheet-mcp@<version>' is not in this registry` — which reads
like a missing package but is an anonymous PUT, after provenance was already signed and uploaded.

The release sequence, run from a checkout whose asset pack is at the revision
`test/golden.json` pins — read it with
`node -p "require('./test/golden.json').packRevision"`, never with `npm run golden`, which
re-records the manifest against whatever pack it finds:

1. **Gate first.** `npm test` (140 items) locally and CI green on `main`. Nothing else in this repo
   checks the publish surface, so do not skip this step and do not publish from a dirty tree.
   (`npm publish` re-runs the suite itself via `prepublishOnly` — that is the backstop, not the gate.)
   A pack that simply moved ahead is the usual reason this goes red on a working machine: the golden
   gate compares the renders *and* the revision they were taken from, so an upstream bump fails the
   suite with nothing wrong in this repo. Set `LPC_ASSETS_DIR` to a checkout of the pinned commit.
   Moving to a newer pack is a deliberate change — the workflow `ref`, `scripts/setup-assets.mjs`'s
   `LPC_ASSETS_REF`, and a re-recorded `test/golden.json` belong to one pass, never to a fix.
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

   Check the tarball list too: `src/`, `scripts/setup-assets.mjs`, `docs/ARCHITECTURE.md` +
   `docs/capability-inventory.md`, `README.md`, `CHANGELOG.md`, `LICENSE`. No `docs/img/`, no
   `AGENTS.md` files, no generators, no `test/`, no asset pack. `tools/list`
   must return the thirteen tools, and `initialize` must report the version you just set.
5. **Mark it.** `git tag v<version> && git push --tags`, then a GitHub release whose notes are that
   `CHANGELOG.md` section. Tag the commit you mean to ship: the workflow checks the tag out, and its
   guard compares only the version *string*, so a tag left behind a later packaging change publishes
   that older manifest while still passing. Publishing the release triggers `publish.yml`, which
   refuses to run if the tag and `package.json` disagree, skips cleanly if that version is already
   on the registry, and otherwise runs the gate and publishes with provenance. Watch the run:
   the last step prints the tarball URL and integrity of what landed.

   For a version whose GitHub release already predates the workflow, run `publish.yml` manually on
   the right ref (Actions → Publish → Run workflow). If the trusted publisher is missing or its
   filters reject the run, npm answers 401 and nothing is published — fix the publisher and re-run.
   A workstation publish still works as a fallback (`npm whoami` must already answer; pass
   `--otp=<code>` if the account requires 2FA) but carries no provenance, and from this box also
   ships the bins without their executable bit, because `core.fileMode` is off on Windows and
   `npm pack` copies the file mode it sees.
6. **Verify from the registry.** `npm view lpc-spritesheet-mcp version`, and one `npx -y
   lpc-spritesheet-mcp` startup from a directory that is not this checkout.

`lpc-spritesheet-setup` in step 4 clones ~350 MB when no pack is found, and prints "already present"
when one is. Point it at an existing pack with `LPC_ASSETS_DIR` unless you mean the clone.

## Reporting bugs

Open a [new issue](https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/issues/new/choose) using
the bug or asset-pack template. They ask for the evidence that makes a report reproducible: the tool
name, the exact arguments JSON, the FULL JSON payload returned, and the server's stderr block (it
prints which pack locations it searched). For render bugs, attach the output PNG and the
`selections` echo from the result payload.
