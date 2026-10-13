# lpc-spritesheet-mcp

<p align="center">
  <img src="docs/img/hero.png" alt="lpc-spritesheet-mcp banner: a knight with a sword, an archer with a hood and bow, and a mage in a purple kimono, each rendered by this server, with the 13-by-54 universal sheet layout drawn at top right" width="1184">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lpc-spritesheet-mcp"><img src="https://img.shields.io/npm/v/lpc-spritesheet-mcp.svg" alt="npm version"></a>
  <a href="https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/actions/workflows/ci.yml"><img src="https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License: GPL-3.0"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/node-%E2%89%A520.11-green.svg" alt="Node.js >= 20.11"></a>
</p>

**Give an AI agent a character artist's hands.** This is the
[Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
web app re-implemented as a headless Node.js [MCP](https://modelcontextprotocol.io) server: an agent
describes a character, and gets back a game-ready 832×3456 spritesheet with the exact frame layout —
no browser, no screenshotting, no manual export button.

<p align="center">
  <img src="docs/img/demo.gif" alt="Terminal recording of a real MCP session: the server reports 657 items and 104 groups, tools/list returns the seven tools, list_animations reports the walk row block, and a get_preview call renders a hooded character's walk cycle animating in the stage panel" width="880"><br>
  <sub>A real session against <code>src/index.js</code> over stdio — every byte of JSON shown is what the server returned.<br>
  Only the typing timing is authored. Regenerate with <code>npm run demo</code> (<a href="./docs/img/demo-credits.csv">attribution</a>).</sub>
</p>

- **657 selectable items across 104 groups** on the current asset pack: 6 body types
  (male, female, teen, child, muscular, pregnant), 91 hairstyles, 45 heads (human, beast, reptile,
  undead, …), clothes, armor, 40 weapons, 9 shields with heraldic patterns, hats, capes, tails,
  wings, prostheses, wheelchairs.
- **Named palette recoloring** for skin, hair, eyes, cloth, metal and wood — 22 skintones,
  26 hair colors, a 75-color universal palette.
- **15 animation row blocks** on the standard sheet: 13 run in all four directions, `hurt` and
  `climb` ship a single facing — that is exactly the 54 rows. Plus **custom-animation blocks** for
  wheelchairs and 128/192px oversize weapons and tools.
- **Engine-ready output.** Every render returns rows, frame counts, playback cycles and custom-block
  offsets, so a game engine never has to guess the layout.
- **Attribution included.** Each sheet gets `-credits.csv` / `-credits.txt` beside it naming the
  authors and licenses of the art actually used.

The server ships **no art**. It reads a local clone of the upstream asset pack and renders it,
entirely offline: no network calls, no telemetry, and one environment variable (`LPC_ASSETS_DIR`).

## Install

The server needs the upstream asset pack once. Any of these three lines does it — pick one:

```bash
git clone --depth 1 https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator ~/.lpc-spritesheet/lpc-generator-src
lpc-spritesheet-setup           # same thing, via the npm bin after `npm install -g lpc-spritesheet-mcp`
npm run setup-assets            # same thing, from a checkout of this repo
```

Then wire the server into an MCP client: `npx -y lpc-spritesheet-mcp`, or `npm install -g` it and run
`lpc-spritesheet-mcp`. Prefer a checkout? `git clone` this repo and run `node src/index.js`. Updating
assets is a `git pull` in the pack clone.

The pack is looked up in this order, and the first valid entry wins:

1. `$LPC_ASSETS_DIR`
2. `../lpc-generator-src` (sibling of the package — the dev-checkout convention)
3. `~/.lpc-spritesheet/lpc-generator-src` (where the setup command above clones)

A valid pack contains both `sheet_definitions/` and `spritesheets/`. If none is found the server
prints what it searched for and exits — it will not start half-configured.

## Try it now

No MCP client required — the official protocol inspector drives the server from a shell:

```bash
# list the seven tools and their schemas
npx -y @modelcontextprotocol/inspector --cli node src/index.js --method tools/list

# or render a walk cycle and print the JSON payload that names the PNG it wrote
npx -y @modelcontextprotocol/inspector --cli node src/index.js --method tools/call \
  --tool-name get_preview --tool-arg animation=walk --tool-arg scale=3 --tool-arg bodyType=female

# or drive it interactively: browse 657 items, call tools, view the result
npx @modelcontextprotocol/inspector node src/index.js
```

## MCP client configuration

All of these run the same stdio server. `LPC_ASSETS_DIR` is optional — omit it if the pack is in one
of the two automatic locations above.

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
<summary>Claude Code (<code>claude mcp add</code>)</summary>

```bash
claude mcp add lpc-spritesheet -- npx -y lpc-spritesheet-mcp
```
</details>

<details>
<summary>Cursor / VS Code / generic stdio client, with a custom asset location</summary>

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

<details>
<summary>ZCode (<code>~/.zcode/cli/config.json</code>)</summary>

```json
{
  "mcp": {
    "servers": {
      "lpc-spritesheet": { "type": "stdio", "command": "npx", "args": ["-y", "lpc-spritesheet-mcp"] }
    }
  }
}
```
</details>

## The seven tools

| Tool | Purpose |
|---|---|
| `list_categories` | All selection groups (`body`, `hair`, `head`, `clothes`, `legs`, `shoes`, `weapon`, `hat`, `shield`, `tail`, `wings`, …) with item counts and whether they take colors. Start here. |
| `list_items` | One category: exact `itemId`s, display names, pre-sliced variants, valid recolors — deduplicated into a response-level `palettes` map. Filter with `search`, page with `limit`/`offset`. |
| `list_palettes` | Color names per material (`body`, `hair`, `eye`, `cloth`, `metal`, `wood`, `all`), with each material's default. |
| `list_animations` | The row layout of every animation (rows, frame counts, playback cycles, y-offsets) plus the custom blocks and which items provide them. |
| `generate_spritesheet` | Render the full universal sheet; returns paths, layout, warnings and credits. |
| `get_animation` | Render, then crop ONE animation into its own PNG — standard row block or custom block. |
| `get_preview` | Render, then crop one direction's playback cycle, upscaled 1–8× — the quickest visual check of a design. |

The three render tools share one argument block: `bodyType`, `selections`, `colors`, `character`,
`match_body_color`, `output_path`, `include_credits`, `include_character_json`. Item IDs, display
names, `"none"`, and `{itemId, variant?, recolor?}` objects are all accepted per group; a
saved-character JSON (`{version: 2, selections}` from the web app) can be passed as `character` and
explicit `selections`/`colors` merge on top of it. Defaults mirror the web app — light-skinned body,
human male head, neutral expression (note the head default is *not* body-aware).

### One call, start to finish

Ask your agent for *"a female archer with red hair, a teal hood and a recurve bow, walking toward
the viewer"*, or call the tool directly:

```jsonc
// tools/call → get_preview
{
  "bodyType": "female",
  "selections": { "hair": "Bangs", "clothes": "Longsleeve", "weapon": "Recurve", "hat": "Hood" },
  "colors": { "body": "amber", "hair": "red", "clothes": "teal", "eyes": "green" },
  "animation": "walk",
  "direction": "down",
  "scale": 3,
  "output_path": "sprites/archer-walk.png"
}
```

```jsonc
// ← result
{
  "output": "…/sprites/archer-walk.png",
  "bodyType": "female",
  "image": { "width": 1536, "height": 192, "frameSize": 192 },
  "animation": "walk", "direction": "down", "scale": 3,
  "frames": [1, 2, 3, 4, 5, 6, 7, 8],
  "warnings": [
    "weapon_ranged_bow_recurve: no sprite for row(s) walk, custom:walk_128 — those rows will be empty (2 missing)"
  ],
  "selections": {
    "body": "body (amber)", "head": "heads_human_male (light)", "expression": "face_neutral (light)",
    "hair": "hair_bangs (red)", "clothes": "torso_clothes_longsleeve (teal)",
    "weapon": "weapon_ranged_bow_recurve [light]", "hat": "hat_hood_cloth (brown)",
    "eyes": "heads_human_male [green] (color sub-selection)"
  },
  "credits": { "csv": "…/archer-walk-credits.csv", "txt": "…/archer-walk-credits.txt", "entries": 7 }
}
```

That warning is the feature working: the recurve bow's definition claims a walk cycle but the pack
ships no `walk.png` for it, so the engine renders the archer, leaves the bow's walk row empty, and
*tells you* — one aggregated message per item, never a failure. A test renders this exact call and
asserts these exact numbers and this exact warning, so the example above cannot rot. Note also that
`hat_hood_cloth` stayed brown: `colors.clothes` recolors the torso group, not every cloth item.

Relative `output_path`s resolve against the **server's** working directory, not the client's. Omit
`output_path` entirely and the sheet lands in `lpc-spritesheet/` under the OS temp directory, with a
timestamp suffix so two renders never overwrite each other.

## What comes out

<p align="center">
  <img src="docs/img/gallery.png" alt="Nine generated characters in a three-by-three grid, each captioned with the capability it proves: heraldic shield pattern, an animation-scoped bow item, a wheelchair custom block, a palette recolor, the child body type, the muscular body type, a lizard head, an undead head with zombie skin, and a 128px katana animation block" width="1152">
  <br><sub>Nine characters, nine capabilities — every one is a single tool call.</sub>
</p>

<p align="center">
  <img src="docs/img/walk-strip.png" alt="A muscular axe-wielding character's walk playback cycle: eight frames of 64px art drawn at 2x in one row, each labelled with its cycle index from 1 to 8" width="1064">
  <br><sub><code>get_preview</code> — walk, down, 2×. The numbers are the cycle indices the tool returns.</sub>
</p>

<p align="center">
  <img src="docs/img/sheet-katana.png" alt="Three strips cropped from one generated katana sheet: the standard walk row block drawn at 2x with no katana sprite present, then the walk_128 and slash_128 custom blocks at native 128px" width="1216">
  <br><sub><code>generate_spritesheet</code> — the 64px walk row above the two 128px custom blocks the katana appends.
  The empty walk row is the honest case: this weapon ships no standard-row art, and the tool says so in <code>warnings</code>.</sub>
</p>

Rendering is fast enough to iterate on inside a conversation: a plain 832×3456 sheet composites in
about 45 ms and a weapon sheet with two 128px custom blocks in about 140 ms, with the 657-item catalog
loaded in about 160 ms (Node 24 on an i7-10750H, warm process, local pack — your numbers will differ).

## How it works

<p align="center">
  <img src="docs/img/architecture.svg" alt="System architecture: an MCP client speaks JSON-RPC over stdio to src/index.js, which dispatches seven tools into a shared request pipeline in src/character.js; that pipeline drives the engine modules over a read-only external asset pack and renders through @napi-rs/canvas to a PNG plus attribution files" width="1000">
</p>

`src/index.js` is the MCP surface, `src/character.js` is the request pipeline, and `src/engine/` is a
headless port of the upstream renderer: `catalog` reads the pack's JSON definitions, `selection`
normalizes what the agent asked for, `recolor` does CPU palette-swapping, `sheet` composites the draw
calls into the frame grid, and `credits` collects attribution. The engine knows nothing about MCP.

[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) has the upstream-to-here map, every intentional
divergence, and diagrams of the module graph, one render call, and where files land on disk.

## Sheet layout (stable)

13 columns × 54 rows of 64px frames = **832×3456**. Directions run up, left, down, right within each
row block:

| Animation | Row | Frames/dir | | Animation | Row | Frames/dir |
|---|---|---|---|---|---|---|
| `spellcast` | 0 | 7 | | `sit` | 30 | 3 |
| `thrust` | 4 | 8 | | `emote` | 34 | 3 |
| `walk` | 8 | 9 | | `run` | 38 | 8 |
| `slash` | 12 | 6 | | `combat_idle` | 42 | 2 |
| `shoot` | 16 | 13 | | `backslash` | 46 | 13 |
| `hurt` | 20 | 6 (1 row, down) | | `halfslash` | 50 | 6 |
| `climb` | 21 | 6 (1 row, up) | | | | |
| `idle` | 22 | 2 | | | | |

`watering`, `combat` and `1h_*` are accepted names that resolve onto these same blocks. Custom blocks
(64–192px frames) are appended below row 54 and can widen the canvas to 1664px; the result payload
reports every offset, so a consumer never has to derive them.

Known upstream asset gaps surface as `warnings`, one message per item — e.g. the `child` body ships
only hurt/idle/jump/sit/slash/walk, so its other rows come back empty by design, not by bug.

## Licensing — read this before you ship

- **This server's code:** GPL-3.0-only, because it derives from the GPL-3.0 upstream generator.
  See [LICENSE](./LICENSE).
- **The sprites it renders** come from the Liberated Pixel Cup pack: a mix of **OGA-BY 3.0,
  CC-BY-SA 3.0, CC-BY 3.0/4.0 and GPL** held by many artists. Every render writes
  `*-credits.csv` / `*-credits.txt` beside the PNG listing exactly the authors, licenses and links
  for the assets used. **Keep those files when you redistribute renders.**
- The images in this README are themselves renders, so they carry attribution too:
  [`docs/img/showcase-credits.csv`](./docs/img/showcase-credits.csv) and
  [`docs/img/demo-credits.csv`](./docs/img/demo-credits.csv).

## Development

```bash
npm install
npm run setup-assets    # or lpc-spritesheet-setup if you installed globally
npm test                # 36 passing items: 19 engine, 16 end-to-end stdio MCP, 1 canvas smoke
npm run assets          # regenerate every committed image (docs/img/)
```

`npm test` is the only automated gate — there is no lint, format or typecheck tooling in this repo, so
nothing else is claimed. CI runs the suite on Node 20 and 22 across Ubuntu and Windows, and asserts
that the server fails cleanly when the pack is missing.

See [CONTRIBUTING.md](./CONTRIBUTING.md), the issue templates under
[`.github/`](./.github), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/capability-inventory.md`](./docs/capability-inventory.md) (everything the *upstream* generator
can do).

## Acknowledgements

Built on the [Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
by Johannes Sjölund (wulax), bluecarrot16, Stephen Challener (Redshrike), ElizaWy, JaidynReiman and
the many LPC artists credited in its `CREDITS.csv` — this project exists to make their work usable
from AI agents. All sprites remain the property of their respective authors under the licenses noted
above.
