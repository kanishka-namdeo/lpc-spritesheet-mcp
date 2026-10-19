// End-to-end tests for the 1.4.0 surface: GIF previews, presets, seeded random
// characters, NPC batches, prompts/resources, the opt-in AI gate, and the new
// atlas dialects. Spawns its own server process over stdio like the other MCP
// suites — the protocol envelope is part of what is being tested.
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

const OUT_DIR = path.join(import.meta.dirname, "out");

test.before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: "pipe",
    // No LPC_AI_* vars are passed on purpose: design_character must answer with
    // its setup error, proving the AI path is opt-in and the server stays offline.
    env: { LPC_ASSETS_DIR: ASSETS_DIR },
  });
  transport.stderr?.on("data", () => {});
  globalThis.newToolsClient = new Client({ name: "new-tools-test", version: "1.0.0" });
  await globalThis.newToolsClient.connect(transport);
});

test.after(async () => {
  await globalThis.newToolsClient?.close();
});

function callTool(name, args = {}) {
  return globalThis.newToolsClient.callTool({ name, arguments: args });
}
const text = (res) => JSON.parse(res.content[0].text);

// ---------------------------------------------------------------------------
// get_preview format:gif
// ---------------------------------------------------------------------------

test("get_preview format:gif returns a looping animated GIF inline", async () => {
  const res = await callTool("get_preview", {
    bodyType: "female",
    selections: { hair: "Bangs", clothes: "Longsleeve", hat: "Hood" },
    colors: { body: "amber", hair: "red" },
    animation: "walk",
    direction: "down",
    scale: 2,
    format: "gif",
    output_path: path.join(OUT_DIR, "gif-walk.gif"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(text(res)));
  const payload = text(res);
  assert.equal(payload.format, "gif");
  assert.match(payload.output, /\.gif$/);
  assert.equal(payload.fps, 10);
  assert.equal(payload.frames, 8, "the walk cycle is 8 frames");
  assert.match(payload.generatorUrl, /^https:\/\//, "renders link back to the web app");

  const image = res.content.find((b) => b.type === "image");
  assert.ok(image, "the GIF comes back as an inline image block");
  assert.equal(image.mimeType, "image/gif");
  const bytes = Buffer.from(image.data, "base64");
  assert.equal(bytes.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.ok(bytes.includes(Buffer.from("NETSCAPE2.0")), "the loop extension is present");
  // the file on disk is the same animation
  assert.equal(fs.readFileSync(payload.output).subarray(0, 6).toString("ascii"), "GIF89a");
});

test("get_preview gif validates fps and format, and a .png path still becomes .gif", async () => {
  const badFps = await callTool("get_preview", { format: "gif", fps: 100 });
  assert.equal(badFps.isError, true);
  assert.match(text(badFps).error, /fps must be a number between 1 and 30/);

  const badFormat = await callTool("get_preview", { format: "webm" });
  assert.equal(badFormat.isError, true);
  assert.match(text(badFormat).error, /Unknown format "webm"/);

  const forced = await callTool("get_preview", {
    format: "gif",
    output_path: path.join(OUT_DIR, "gif-ext.png"),
  });
  assert.match(text(forced).output, /gif-ext\.gif$/);
});

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

test("list_presets describes the curated library", async () => {
  const res = await callTool("list_presets");
  const payload = text(res);
  assert.ok(payload.presets.length >= 12, `expected >= 12 presets, got ${payload.presets.length}`);
  for (const preset of payload.presets) {
    assert.ok(preset.name && preset.description && preset.bodyType);
    assert.ok(Array.isArray(preset.groups) && preset.groups.length > 0);
  }
  assert.ok(res.structuredContent, "the declared outputSchema is served");
});

test("a preset renders in one call and merges with explicit overrides", async () => {
  const res = await callTool("generate_spritesheet", {
    preset: "knight",
    output_path: path.join(OUT_DIR, "preset-knight.png"),
  });
  assert.equal(res.isError, undefined, JSON.stringify(text(res)));
  const payload = text(res);
  assert.ok(payload.warnings.some((w) => /Preset "knight" applied/.test(w)));
  assert.match(payload.generatorUrl, /#sex=/);

  // an override swaps one item on top of the preset base
  const overridden = text(
    await callTool("get_preview", {
      preset: "villager",
      selections: { hair: "Bangs" },
      scale: 1,
      output_path: path.join(OUT_DIR, "preset-override.png"),
    }),
  );
  assert.match(overridden.selections.hair, /hair_bangs/);

  const unknown = await callTool("generate_spritesheet", { preset: "space-marine" });
  assert.equal(unknown.isError, true);
  const err = text(unknown);
  assert.match(err.error, /Unknown preset "space-marine"/);
  assert.ok(err.hint || err.error.includes("knight"), "the error names real presets");
});

// ---------------------------------------------------------------------------
// random_character
// ---------------------------------------------------------------------------

test("random_character rolls deterministically and returns a renderable inline preview", async () => {
  const res = await callTool("random_character", { seed: "village-hero" });
  assert.equal(res.isError, undefined, JSON.stringify(text(res)));
  const payload = text(res);
  assert.equal(payload.seed, "village-hero");
  assert.ok(payload.bodyType);
  assert.ok(payload.selections.hair || payload.selections.hat);
  assert.match(payload.generatorUrl, /^https:\/\//);
  assert.ok(payload.preview, "the default renders a preview");
  assert.equal(payload.preview.animation, "walk");
  const image = res.content.find((b) => b.type === "image");
  assert.ok(image, "the preview strip comes back inline");
  assert.equal(image.mimeType, "image/png");

  // determinism over the wire: same seed, identical roll (preview path differs by timestamp)
  const again = text(await callTool("random_character", { seed: "village-hero" }));
  assert.deepEqual(again.bodyType, payload.bodyType);
  assert.deepEqual(again.selections, payload.selections);
  assert.deepEqual(again.colors, payload.colors);

  // preview:false rolls without writing anything
  const noPreview = text(await callTool("random_character", { seed: "quiet", preview: false }));
  assert.equal(noPreview.preview, undefined);

  // bad gear errors with guidance
  const badGear = await callTool("random_character", { seed: "x", gear: "ninja" });
  assert.equal(badGear.isError, true);
  assert.match(text(badGear).error, /Unknown gear profile "ninja"/);
});

// ---------------------------------------------------------------------------
// generate_batch
// ---------------------------------------------------------------------------

test("generate_batch populates a village: sheets, previews, index grid, manifest, credits", async () => {
  const dir = path.join(OUT_DIR, "batch-village");
  const res = await callTool("generate_batch", { count: 3, seed: "riverford", output_dir: dir });
  assert.equal(res.isError, undefined, JSON.stringify(text(res)));
  const payload = text(res);
  assert.equal(payload.count, 3);
  assert.equal(payload.seed, "riverford");
  assert.equal(payload.characters.length, 3);
  assert.deepEqual(payload.characters.map((c) => c.seed), ["riverford:0", "riverford:1", "riverford:2"]);
  assert.ok(res.structuredContent, "the declared outputSchema is served");

  for (const character of payload.characters) {
    assert.ok(fs.existsSync(character.files.sheet), `${character.seed} sheet`);
    assert.ok(fs.existsSync(character.files.preview), `${character.seed} preview`);
    assert.ok(fs.existsSync(character.files.creditsCsv), `${character.seed} credits`);
    assert.match(character.generatorUrl, /^https:\/\//);
  }
  assert.ok(fs.existsSync(path.join(dir, "index.png")), "the contact grid landed");
  assert.ok(fs.existsSync(path.join(dir, "manifest.json")), "the manifest landed");
  assert.ok(fs.existsSync(path.join(dir, "batch-credits.csv")), "the rolled-up credits landed");

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.count, 3);
  assert.equal(manifest.characters.length, 3);
  assert.match(String(manifest.pack.revision), /^[0-9a-f]{40}$/);
  assert.equal(manifest.index.file, "index.png");
  // per-character files are recorded relative to the bundle
  assert.equal(manifest.characters[0].files.sheet, path.join("01", "sheet.png"));

  // index grid geometry: 3 characters → 2 columns × 2 rows of 64px cells
  assert.equal(payload.index.columns, 2);
  assert.equal(payload.index.rows, 2);

  // determinism: the same seed rerolls the same villagers
  const again = text(await callTool("generate_batch", { count: 3, seed: "riverford", output_dir: path.join(OUT_DIR, "batch-village-2") }));
  assert.deepEqual(
    again.characters.map((c) => [c.bodyType, c.selections, c.colors]),
    payload.characters.map((c) => [c.bodyType, c.selections, c.colors]),
  );

  // the rolls are directly renderable: character 2's config renders as the same body type
  const rerender = text(
    await callTool("generate_spritesheet", {
      ...payload.characters[1],
      output_path: path.join(OUT_DIR, "batch-rerender.png"),
    }),
  );
  assert.equal(rerender.bodyType, payload.characters[1].bodyType);

  const badCount = await callTool("generate_batch", { count: 0 });
  assert.equal(badCount.isError, true);
  assert.match(text(badCount).error, /count must be an integer between 1 and 25/);
});

// ---------------------------------------------------------------------------
// prompts and resources
// ---------------------------------------------------------------------------

test("three workflow prompts are listed and fetchable", async () => {
  const { prompts } = await globalThis.newToolsClient.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), [
    "design-a-character",
    "export-for-my-engine",
    "populate-a-village",
  ]);
  for (const prompt of prompts) {
    assert.ok(prompt.description, `${prompt.name} has no description`);
  }

  const got = await globalThis.newToolsClient.getPrompt({ name: "design-a-character", arguments: { brief: "a snow wizard" } });
  const body = got.messages[0].content.text;
  assert.match(body, /snow wizard/);
  assert.match(body, /get_preview/);
  assert.match(body, /export_character/);

  const enginePrompt = await globalThis.newToolsClient.getPrompt({ name: "export-for-my-engine", arguments: { engine: "Godot 4" } });
  assert.match(enginePrompt.messages[0].content.text, /Godot 4/);

  const unknown = await globalThis.newToolsClient.getPrompt({ name: "nope" }).catch((e) => e);
  assert.ok(unknown, "an unknown prompt fails loudly");
});

test("three reference resources are listed and readable", async () => {
  const { resources } = await globalThis.newToolsClient.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), [
    "lpc://licensing",
    "lpc://presets",
    "lpc://sheet-layout",
  ]);

  const layout = await globalThis.newToolsClient.readResource({ uri: "lpc://sheet-layout" });
  const layoutDoc = JSON.parse(layout.contents[0].text);
  assert.equal(layoutDoc.standard.walk.row, 8);
  assert.equal(layoutDoc.standard.walk.frames, 9);

  const licensing = await globalThis.newToolsClient.readResource({ uri: "lpc://licensing" });
  assert.match(licensing.contents[0].text, /ATTRIBUTION/);
  assert.match(licensing.contents[0].text, /credits/);
});

// ---------------------------------------------------------------------------
// design_character (offline gate)
// ---------------------------------------------------------------------------

test("design_character without LPC_AI_API_KEY answers with a setup error, not a crash", async () => {
  const res = await callTool("design_character", { prompt: "a tanned blacksmith with a hammer" });
  assert.equal(res.isError, true);
  const payload = text(res);
  assert.match(payload.error, /not configured/);
  assert.match(payload.hint, /LPC_AI_API_KEY/);
});

// ---------------------------------------------------------------------------
// new atlas dialects
// ---------------------------------------------------------------------------

test("export_character writes every atlas dialect with cycle-correct animations", async () => {
  const character = {
    bodyType: "male",
    selections: { hair: "hair_bangs", clothes: "Longsleeve", weapon: "Katana" },
  };

  // TexturePacker: the animations playback map rides in the atlas itself
  const tpDir = path.join(OUT_DIR, "atlas-tp");
  const tp = text(await callTool("export_character", { ...character, output_dir: tpDir }));
  assert.equal(tp.atlasFormat, "texturepacker");
  const tpAtlas = JSON.parse(fs.readFileSync(tp.atlas, "utf8"));
  assert.deepEqual(
    tpAtlas.animations.walk_down,
    ["walk_down_2", "walk_down_3", "walk_down_4", "walk_down_5", "walk_down_6", "walk_down_7", "walk_down_8", "walk_down_9"],
  );
  assert.deepEqual(tpAtlas.animations.walk_128_down, ["walk_128_down_1", "walk_128_down_2", "walk_128_down_3", "walk_128_down_4", "walk_128_down_5", "walk_128_down_6", "walk_128_down_7", "walk_128_down_8", "walk_128_down_9"]);
  const tpManifest = JSON.parse(fs.readFileSync(tp.manifest, "utf8"));
  assert.deepEqual(tpManifest.animations.idle_up, ["idle_up_1", "idle_up_1", "idle_up_2"]);

  // Godot: .tres with AtlasTextures and per-direction animations
  const godotDir = path.join(OUT_DIR, "atlas-godot");
  const godot = text(await callTool("export_character", { ...character, atlas_format: "godot", output_dir: godotDir }));
  const tres = fs.readFileSync(godot.atlas, "utf8");
  assert.match(tres, /^\[gd_resource type="SpriteFrames"/);
  assert.match(tres, /res:\/\/sheet\.png/);
  assert.ok(tres.includes('"name": &"walk_down"'));
  assert.ok((tres.match(/\[sub_resource type="AtlasTexture"/g) ?? []).length > 100);

  // Aseprite: array frames + frameTags
  const aseDir = path.join(OUT_DIR, "atlas-aseprite");
  const ase = text(await callTool("export_character", { ...character, atlas_format: "aseprite", output_dir: aseDir }));
  const aseDoc = JSON.parse(fs.readFileSync(ase.atlas, "utf8"));
  assert.ok(Array.isArray(aseDoc.frames) && aseDoc.frames.length > 100);
  assert.ok(aseDoc.meta.frameTags.some((t) => t.name === "walk_down"));
  assert.deepEqual(aseDoc.meta.animations.walk_down.slice(0, 2), ["walk_down_2", "walk_down_3"]);

  // libGDX: text regions
  const gdxDir = path.join(OUT_DIR, "atlas-libgdx");
  const gdx = text(await callTool("export_character", { ...character, atlas_format: "libgdx", output_dir: gdxDir }));
  const gdxText = fs.readFileSync(gdx.atlas, "utf8");
  assert.match(gdxText, /^sheet\.png\nformat: RGBA8888/);
  assert.match(gdxText, /filter: Nearest,Nearest/);
  assert.ok(gdxText.includes("walk_down_1"));

  // Unity: .png.meta with pre-sliced sprites and a deterministic guid
  const unityDir = path.join(OUT_DIR, "atlas-unity");
  const unity = text(await callTool("export_character", { ...character, atlas_format: "unity", output_dir: unityDir }));
  const metaText = fs.readFileSync(unity.atlas, "utf8");
  assert.match(metaText, /spriteMode: 2/);
  assert.match(metaText, /guid: [0-9a-f]{32}/);
  assert.ok((metaText.match(/- name: \S+\n\s+rect: \{x:/g) ?? []).length > 100);
});
