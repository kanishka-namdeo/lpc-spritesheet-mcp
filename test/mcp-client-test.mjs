// End-to-end MCP protocol test: spawns the server as a real subprocess.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { findAssetsDir } from "../src/assets-dir.js";

const SERVER_ENTRY = path.resolve(import.meta.dirname, "..", "src", "index.js");
const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}

test.before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: "pipe",
    // StdioClientTransport inherits only a safe env allowlist, so the pack
    // location has to be handed to the child explicitly or it exits at startup.
    env: { LPC_ASSETS_DIR: ASSETS_DIR },
  });
  transport.stderr?.on("data", () => {}); // drain so the child never blocks
  globalThis.mcpClient = new Client({ name: "e2e-test", version: "1.0.0" });
  await globalThis.mcpClient.connect(transport);
});

test.after(async () => {
  await globalThis.mcpClient?.close();
});

function callTool(name, args = {}) {
  return globalThis.mcpClient.callTool({ name, arguments: args });
}

test("server exposes 7 tools", async () => {
  const { tools } = await globalThis.mcpClient.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "generate_spritesheet",
    "get_animation",
    "get_preview",
    "list_animations",
    "list_categories",
    "list_items",
    "list_palettes",
  ]);
});

test("list_categories returns groups", async () => {
  const res = await callTool("list_categories");
  const payload = JSON.parse(res.content[0].text);
  assert.ok(payload.categories.length > 90);
  const hair = payload.categories.find((c) => c.category === "hair");
  assert.equal(hair.items, 91);
});

test("list_items resolves variants and colors", async () => {
  const res = await callTool("list_items", {
    category: "hair",
    search: "bangs",
    limit: 5,
  });
  const payload = JSON.parse(res.content[0].text);
  assert.ok(payload.items.some((i) => i.itemId === "hair_bangs"));
  const bangs = payload.items.find((i) => i.itemId === "hair_bangs");
  // palettes are hoisted to response level and referenced per item
  assert.ok(payload.palettes[bangs.colors[0].palette].includes("blonde"));
  assert.equal(bangs.colors[0].default, "orange");
  // `total` reflects the filtered result; the page is limited by `limit`
  assert.equal(payload.total, 8);
  assert.equal(payload.unfilteredTotal, 91);
  assert.equal(payload.showing.count, payload.items.length);
  // payload stays small (palettes deduplicated)
  assert.ok(res.content[0].text.length < 20_000, `list_items payload too big: ${res.content[0].text.length} bytes`);
});

test("list_items errors are isError with guidance", async () => {
  const missing = await callTool("list_items", {});
  assert.equal(missing.isError, true);
  assert.match(JSON.parse(missing.content[0].text).error, /category is required/);
  const unknown = await callTool("list_items", { category: "potato", bodyType: "male" });
  assert.equal(unknown.isError, true);
  const payload = JSON.parse(unknown.content[0].text);
  assert.match(payload.error, /Unknown category/);
  assert.ok(payload.validCategories.includes("hair"));
  const badBody = await callTool("list_items", { category: "hair", bodyType: "giant" });
  assert.equal(badBody.isError, true);
  assert.match(JSON.parse(badBody.content[0].text).error, /Unknown bodyType/);
});

test("generate_spritesheet writes PNG + credits", async () => {
  const res = await callTool("generate_spritesheet", {
    bodyType: "male",
    selections: { hair: "hair_bangs", clothes: "Longsleeve", weapon: "Katana" },
    colors: { body: "bronze", hair: "black", clothes: "teal" },
    output_path: path.join(import.meta.dirname, "out", "mcp-katana.png"),
    include_credits: true,
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  // katana adds walk_128 (1152px wide) + slash_128 custom blocks (512px tall each)
  assert.equal(payload.image.width, 1152);
  assert.equal(payload.image.height, 3456 + 512 + 512);
  assert.ok(payload.credits.entries >= 4);
  assert.ok(fs.existsSync(payload.output), payload.output);
});

test("get_animation crops walk", async () => {
  const res = await callTool("get_animation", {
    bodyType: "male",
    animation: "walk",
    output_path: path.join(import.meta.dirname, "out", "mcp-walk.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.image.width, 832);
  assert.equal(payload.image.height, 256);
});

test("get_preview returns strip", async () => {
  const res = await callTool("get_preview", {
    bodyType: "female",
    animation: "idle",
    direction: "left",
    scale: 4,
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.image.width, 3 * 64 * 4); // idle cycle = 3 frames
  assert.equal(payload.image.height, 64 * 4);
});

test("bad color returns helpful error", async () => {
  const res = await callTool("generate_spritesheet", {
    selections: { hair: "Bangs" },
    colors: { hair: "not_a_color" },
  });
  assert.equal(res.isError, true);
  const payload = JSON.parse(res.content[0].text);
  assert.match(payload.error, /not a valid color/);
});

test("unknown generate args produce did-you-mean warnings, not silent success", async () => {
  const res = await callTool("generate_spritesheet", {
    selection: { hair: "hair_bangs" }, // typo: should be "selections"
    output_path: path.join(import.meta.dirname, "out", "mcp-typo-warning.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.ok(
    payload.warnings.some((w) => /Unknown argument "selection".*did you mean "selections"/.test(w)),
    JSON.stringify(payload.warnings),
  );
});

test("get_preview accepts hurt/down (single-facing row) and echoes params", async () => {
  const res = await callTool("get_preview", {
    animation: "hurt",
    direction: "down",
    output_path: path.join(import.meta.dirname, "out", "mcp-hurt-preview.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.animation, "hurt");
  assert.equal(payload.direction, "down");
  assert.equal(payload.image.width, 6 * 64);
  assert.equal(payload.image.height, 64);
  assert.equal(payload.layout, undefined, "preview should not ship the full sheet layout");
  // out-of-range scale is rejected
  const badScale = await callTool("get_preview", { scale: 42 });
  assert.equal(badScale.isError, true);
  assert.match(JSON.parse(badScale.content[0].text).error, /between 1 and 8/);
});

test("get_animation: custom-anim errors name provider items; combat_idle alias works", async () => {
  const unselected = await callTool("get_animation", {
    animation: "slash_128",
    output_path: path.join(import.meta.dirname, "out", "mcp-unused.png"),
  });
  assert.equal(unselected.isError, true);
  const err = JSON.parse(unselected.content[0].text);
  assert.match(err.error, /weapon_sword_katana/);

  const unknown = await callTool("get_animation", { animation: "walkee" });
  assert.equal(unknown.isError, true);
  assert.match(JSON.parse(unknown.content[0].text).error, /Unknown animation "walkee"/);

  const alias = await callTool("get_animation", {
    animation: "combat_idle",
    output_path: path.join(import.meta.dirname, "out", "mcp-combat-idle.png"),
  });
  assert.equal(alias.isError, undefined, JSON.stringify(alias));
  const payload = JSON.parse(alias.content[0].text);
  assert.equal(payload.animation, "combat_idle");
  assert.equal(payload.image.width, 832);
  assert.equal(payload.layout.yOffsetInFullSheet, 42 * 64);
  assert.equal(payload.layout.frames, 2);
});

test("character JSON merges with args (regression: silent override loss)", async () => {
  const res = await callTool("generate_spritesheet", {
    character: {
      version: 2,
      bodyType: "female",
      selections: {
        body: { itemId: "body", subId: null, variant: null, recolor: "bronze" },
        hair: { itemId: "hair_bob", subId: null, variant: null, recolor: "platinum" },
      },
    },
    selections: { hair: "hair_bangs" },
    colors: { hair: "red" },
    output_path: path.join(import.meta.dirname, "out", "mcp-charmerge.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.bodyType, "female");
  assert.match(payload.selections.hair, /hair_bangs \(red\)/);
  assert.match(payload.selections.body, /bronze/);
  assert.match(payload.selections.head, /heads_human_male/); // app default head is not body-aware
  // invalid bodyType via character JSON must be an error, not a blank sheet
  const bad = await callTool("generate_spritesheet", {
    character: { version: 2, bodyType: "potato", selections: { body: { itemId: "body" } } },
  });
  assert.equal(bad.isError, true);
  assert.match(JSON.parse(bad.content[0].text).error, /Unknown bodyType "potato"/);
});

test("get_preview takes the combat_idle alias, like get_animation does", async () => {
  const res = await callTool("get_preview", {
    animation: "combat_idle",
    output_path: path.join(import.meta.dirname, "out", "mcp-combat-idle-preview.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.animation, "combat_idle");
  assert.equal(payload.image.width, 3 * 64); // cycle [0,0,1] -> three slots, two distinct frames
  assert.equal(payload.image.height, 64);
});

test("get_animation of a custom block reports that block's frame size", async () => {
  const res = await callTool("get_animation", {
    selections: { weapon: "Katana" },
    animation: "slash_128",
    output_path: path.join(import.meta.dirname, "out", "mcp-slash-128.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.layout.frameSize, 128);
  assert.equal(payload.image.frameSize, 128, "image.frameSize must match the cropped block");
});

test("list_animations gives every standard row a frame count and an offset", async () => {
  const res = await callTool("list_animations");
  const payload = JSON.parse(res.content[0].text);
  for (const [name, anim] of Object.entries(payload.standard)) {
    assert.ok(Number.isInteger(anim.frames), `${name}: frames is ${anim.frames}`);
    assert.ok(Number.isInteger(anim.yOffset), `${name}: yOffset is ${anim.yOffset}`);
  }
  // the two single-row blocks are the only ones with one facing
  const single = Object.values(payload.standard).filter((a) => a.directionRows === 1);
  assert.deepEqual(single.map((a) => a.label).sort(), ["climb", "hurt"]);
});

test("the README example renders exactly what the README promises", async () => {
  const res = await callTool("get_preview", {
    bodyType: "female",
    selections: { hair: "Bangs", clothes: "Longsleeve", weapon: "Recurve", hat: "Hood" },
    colors: { body: "amber", hair: "red", clothes: "teal", eyes: "green" },
    animation: "walk",
    direction: "down",
    scale: 3,
    output_path: path.join(import.meta.dirname, "out", "mcp-readme-example.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(res));
  const payload = JSON.parse(res.content[0].text);
  assert.deepEqual(payload.image, { width: 1536, height: 192, frameSize: 192 });
  assert.deepEqual(payload.frames, [1, 2, 3, 4, 5, 6, 7, 8]);
  // the README prints this warning verbatim: the bow claims a walk cycle the pack does not ship
  assert.equal(payload.warnings.length, 1, JSON.stringify(payload.warnings));
  assert.match(
    payload.warnings[0],
    /^weapon_ranged_bow_recurve: no sprite for row\(s\) walk, custom:walk_128/,
  );
  assert.equal(payload.credits.entries, 7);
  assert.equal(payload.selections.clothes, "torso_clothes_longsleeve (teal)");
  assert.equal(payload.selections.weapon, "weapon_ranged_bow_recurve [light]");
  assert.equal(payload.selections.hat, "hat_hood_cloth (brown)"); // colors.clothes does not retint a hat
});
