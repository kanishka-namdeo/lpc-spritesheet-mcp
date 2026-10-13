# Contributing

Thanks for improving `lpc-spritesheet-mcp`!

## Development setup

```bash
git clone https://github.com/kanishka-namdeo/lpc-spritesheet-mcp.git
cd lpc-spritesheet-mcp
npm install

# one-time: clone the ~350MB asset pack the server reads from
npm run setup-assets        # → ~/.lpc-spritesheet/lpc-generator-src
# (or clone Universal-LPC-Spritesheet-Character-Generator yourself
#  next to this repo as ../lpc-generator-src, or anywhere + LPC_ASSETS_DIR)

npm test                    # 36 passing items: engine tests + real stdio MCP client tests
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
- `test/` — the acceptance gate. `scripts/` — setup and docs-asset generation.

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

## Reporting bugs

Open a [new issue](https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/issues/new/choose) using
the bug or asset-pack template. They ask for the evidence that makes a report reproducible: the tool
name, the exact arguments JSON, the FULL JSON payload returned, and the server's stderr block (it
prints which pack locations it searched). For render bugs, attach the output PNG and the
`selections` echo from the result payload.
