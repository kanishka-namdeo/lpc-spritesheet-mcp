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

npm test                    # 32 tests: engine + real stdio MCP client
```

`LPC_ASSETS_DIR` overrides where the server looks for the asset pack.

## Project layout

- `src/engine/` — headless port of the upstream generator's renderer
  (`constants`, `catalog`, `recolor`, `sheet`, `selection`, `credits`,
  `custom-animations`). Plain ESM JavaScript, no build step.
- `src/index.js` — MCP tool layer. `src/character.js` — shared request
  pipeline (input normalization, rendering, saving).
- `docs/ARCHITECTURE.md` — the upstream → port mapping and invariants every
  change must preserve. **Read it before touching `src/engine/`.**
- `docs/capability-inventory.md` — what the upstream generator can do.

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

## Reporting bugs

Open an issue with: tool name, exact arguments, observed vs expected JSON
result, and (for render bugs) the output PNG + `selections` echo from the
result payload.
