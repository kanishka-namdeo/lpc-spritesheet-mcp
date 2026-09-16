# lpc-spritesheet-mcp

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.11-green.svg)](./package.json)
[![npm](https://img.shields.io/npm/v/lpc-spritesheet-mcp.svg)](https://www.npmjs.com/package/lpc-spritesheet-mcp)
[![CI](https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/actions/workflows/ci.yml/badge.svg)](../../actions)

**MCP server that generates [Universal LPC](https://lpc.opengameart.org) character spritesheets headlessly** — the [Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) web app, re-implemented as a Node.js MCP server so AI agents can compose and render game-ready character sheets without a browser.

- **657 selectable items** across 104 groups: 6 body types (male, female, teen, child, muscular, pregnant), 91 hairstyles, 45 heads (human/beast/reptile/undead/…), clothes, armor, 40 weapons, shields with heraldic patterns, hats, capes, tails, wings, prostheses, wheelchairs…
- **Named palette recoloring** for skin/hair/eyes/cloth/metal/wood (22 skintones, 26 hair colors, 74-color universal palette…).
- **15 standard animations** × 4 directions (walk, slash, thrust, spellcast, shoot, hurt, climb, idle, jump, sit, emote, run, combat idle, backslash, halfslash) on the standard **832×3456** sheet (13×54 frames of 64px), plus **custom-animation blocks** for wheelchairs and 128/192px oversize weapons/tools.
- Engine-ready results: every render returns the exact frame layout (rows, frame counts, playback cycles, custom-block offsets), and per-asset **attribution files** are written next to each sheet as the upstream licenses require.

The server does **not** bundle any art: it reads a local clone of the upstream asset pack and renders it with `@napi-rs/canvas` — fully offline.

## Install

```bash
npm install -g lpc-spritesheet-mcp   # or just use npx (see below)

# one-time: fetch the ~350MB asset pack the server renders from
npm run setup-assets                 # clones into ~/.lpc-spritesheet/lpc-generator-src
```

Prefer a local checkout? Clone the repo, `npm install`, and either run
`npm run setup-assets` or clone
[Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
yourself next to it as `../lpc-generator-src`. Any location works if you point
`LPC_ASSETS_DIR` at it. Updating assets = `git pull` in that clone.

## MCP client configuration

Run command (stdio): `npx lpc-spritesheet-mcp` (or `node <path>/src/index.js`).

<details>
<summary>ZCode (<code>~/.zcode/cli/config.json</code>)</summary>

```json
{
  "mcp": {
    "servers": {
      "lpc-spritesheet": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "lpc-spritesheet-mcp"]
      }
    }
  }
}
```
</details>

<details>
<summary>Claude Desktop (<code>claude_desktop_config.json</code>)</summary>

```json
{
  "mcpServers": {
    "lpc-spritesheet": {
      "command": "npx",
      "args": ["-y", "lpc-spritesheet-mcp"]
    }
  }
}
```
</details>

<details>
<summary>Cursor / generic (with a custom asset location)</summary>

```json
{
  "mcpServers": {
    "lpc-spritesheet": {
      "command": "npx",
      "args": ["-y", "lpc-spritesheet-mcp"],
      "env": { "LPC_ASSETS_DIR": "D:/assets/lpc-generator-src" }
    }
  }
}
```
</details>

## Tools

| Tool | Purpose |
|---|---|
| `list_categories` | All selection groups (body, hair, head, clothes, legs, shoes, weapon, hat, shield, tail, wings, …) with item counts. Start here. |
| `list_items` | Items of one category: exact `itemId`s, display names, pre-sliced variants; recolor colors deduplicated into a response-level `palettes` map. |
| `list_palettes` | Color names per material (body=skintone, hair, cloth, eye, metal, wood, all). |
| `list_animations` | Animation row layout (rows, frame counts, playback cycles) + custom-animation definitions and which items provide them. |
| `generate_spritesheet` | Render the full universal sheet PNG + custom blocks; returns paths, layout, warnings, credits. |
| `get_animation` | Render + crop ONE animation into its own PNG (e.g. walk = 832×256, 9 frames × 4 directions). |
| `get_preview` | Render + crop a playback-cycle strip for one direction — quick visual check. |

### Example

Ask your agent for *"a female archer with red hair and a bow, teal hood, and a walk cycle"*, or call directly:

```jsonc
{
  "tool": "get_animation",
  "arguments": {
    "bodyType": "female",
    "selections": { "hair": "Bangs", "clothes": "Longsleeve", "weapon": "Recurve Bow", "hat": "Hood" },
    "colors": { "body": "amber", "hair": "red", "clothes": "teal", "eyes": "green" },
    "animation": "walk",
    "output_path": "sprites/archer-walk.png"
  }
}
// → { "output": "…/archer-walk-walk.png", "image": { "width": 832, "height": 256, … },
//     "layout": { "frames": 9, "cycle": [1,2,…,8], … }, "credits": { … } }
```

ItemIds, display names, `"none"`, and `{itemId, variant?, recolor?}` objects are all accepted per group; a saved-character JSON (`{version:2, selections}` from the web app) can be passed as `character` and explicit `selections`/`colors` merge on top. Defaults mirror the web app (light-skinned male body, human male head, neutral expression).

## Sheet layout (stable)

13 columns × 54 rows of 64px frames. Row blocks (directions top-to-bottom: up, left, down, right): spellcast r0 (7f), thrust r4 (8f), walk r8 (9f), slash r12 (6f), shoot r16 (13f), hurt r20 (1 row, 6f, down-facing), climb r21 (1 row, 6f, up-facing), idle r22 (2f), jump r26 (5f), sit r30 (3f), emote r34 (3f), run r38 (8f), combat_idle r42 (2f), backslash r46 (13f), halfslash r50 (6f). `watering`/`combat`/`1h_*` are aliases of these rows. Custom blocks (64–192px frames) are appended below and can widen the canvas; the result payload reports every offset.

## Licensing — important

- **This server's code:** GPL-3.0-only — it is a port of the GPL-3.0 upstream generator. See [LICENSE](./LICENSE).
- **The sprites it renders** come from the Liberated Pixel Cup asset pack: a mix of **OGA-BY 3.0, CC-BY-SA 3.0, CC-BY 3.0/4.0 and GPL** licenses held by many artists. The server writes `*-credits.csv` / `*-credits.txt` next to every generated sheet listing exactly the authors, licenses and links for the assets used — **keep these files when you redistribute renders**, and check `CREDITS.csv` in the asset repo for details.

## Development

```bash
npm test          # 32 tests: engine + real stdio MCP protocol tests
```

See [CONTRIBUTING.md](./CONTRIBUTING.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) (upstream→port mapping and port invariants) and [docs/capability-inventory.md](./docs/capability-inventory.md) (everything the upstream generator can do).

## Acknowledgements

Built on the [Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) by Johannes Sjölund (wulax), bluecarrot16, Stephen Challener (Redshrike), ElizaWy, JaidynReiman and the many LPC artists credited in its `CREDITS.csv` — this project exists to make their work usable from AI agents. All sprites remain the property of their respective authors under the licenses noted above.
