// End-to-end tests for the 1.3.0 surface: tool metadata, response budgets, the bundle export,
// the layout validator and the character-spec round-trip. Spawns its own server process for the
// same reason mcp-client-test.mjs does — the protocol envelope is part of what is being tested.
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
    // StdioClientTransport inherits only a small env allowlist; the pack location must be handed
    // to the child explicitly or it exits at startup.
    env: { LPC_ASSETS_DIR: ASSETS_DIR },
  });
  transport.stderr?.on("data", () => {});
  globalThis.surfaceClient = new Client({ name: "surface-test", version: "1.0.0" });
  await globalThis.surfaceClient.connect(transport);
});

test.after(async () => {
  await globalThis.surfaceClient?.close();
});

function callTool(name, args = {}) {
  return globalThis.surfaceClient.callTool({ name, arguments: args });
}

const text = (res) => JSON.parse(res.content[0].text);

test("every tool carries a title and full risk annotations", async () => {
  const { tools } = await globalThis.surfaceClient.listTools();
  assert.equal(tools.length, 9);
  for (const t of tools) {
    assert.ok(t.title, `${t.name} has no title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof t.annotations?.[hint], "boolean", `${t.name} is missing ${hint}`);
    }
    const readOnly = t.name.startsWith("list_") || t.name === "validate_sheet";
    assert.equal(t.annotations.readOnlyHint, readOnly, `${t.name} readOnlyHint`);
    assert.equal(t.annotations.destructiveHint, false, `${t.name} never deletes`);
    assert.equal(t.annotations.openWorldHint, false, `${t.name} makes no network calls`);
    assert.equal(t.annotations.idempotentHint, readOnly, `${t.name} mints a timestamped file per call`);
  }
  assert.deepEqual(tools.find((t) => t.name === "get_animation").inputSchema.required, ["animation"]);
  assert.deepEqual(tools.find((t) => t.name === "list_items").inputSchema.required, ["category"]);
  assert.deepEqual(
    tools.find((t) => t.name === "export_character").inputSchema.properties.mode.enum,
    ["animation", "frames"],
  );
});

test("the render description states the measured maximum width", async () => {
  const { tools } = await globalThis.surfaceClient.listTools();
  const gen = tools.find((t) => t.name === "generate_spritesheet");
  assert.match(gen.description, /1664px/, "the widest custom canvas is 13 columns of 128px");
  assert.doesNotMatch(gen.description, /1152\/1536px/, "the old understated example is gone");
  const outputPath = gen.inputSchema.properties.output_path.description;
  assert.match(outputPath, /temp directory/, "the documented default is the real default");
  assert.doesNotMatch(outputPath, /server dir/, "no claim about writing into the package directory");
});

test("declared outputSchemas are paired with structuredContent", async () => {
  const { tools } = await globalThis.surfaceClient.listTools();
  const declared = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
  assert.deepEqual(declared, [
    "export_character",
    "list_animations",
    "list_categories",
    "list_items",
    "list_palettes",
    "validate_sheet",
  ]);
  for (const name of ["list_categories", "list_animations", "list_palettes"]) {
    const res = await callTool(name);
    assert.ok(res.structuredContent, `${name} sent no structuredContent`);
    assert.deepEqual(res.structuredContent, text(res), `${name} pair drifted`);
  }
  const render = await callTool("generate_spritesheet", {
    output_path: path.join(OUT_DIR, "surface-no-schema.png"),
  });
  assert.equal(render.structuredContent, undefined, "render tools stay text-only");
});

test("list_palettes covers every material and rejects an unknown one", async () => {
  const all = text(await callTool("list_palettes"));
  const materials = Object.keys(all.materials);
  assert.ok(materials.length >= 6, `expected six materials plus universal, got ${materials}`);
  for (const m of ["body", "hair", "cloth", "eye", "metal", "wood"]) {
    assert.ok(all.materials[m], `${m} material missing`);
    assert.ok(Object.keys(all.materials[m].versions).length > 0, `${m} has no palette versions`);
  }
  assert.ok(all.materials.body.versions.ulpc.includes("light"));
  const one = text(await callTool("list_palettes", { material: "cloth" }));
  assert.deepEqual(Object.keys(one.materials), ["cloth"]);
  const bad = await callTool("list_palettes", { material: "chromium" });
  assert.equal(bad.isError, true);
  const payload = text(bad);
  assert.match(payload.error, /Unknown material "chromium"/);
  assert.ok(payload.validMaterials.includes("wood"));
});

test("list_animations marks unreachable custom blocks instead of hiding them", async () => {
  const payload = text(await callTool("list_animations"));
  const blocks = Object.entries(payload.custom);
  const unavailable = blocks.filter(([, v]) => v.available === false).map(([k]) => k);
  assert.deepEqual(unavailable, ["thrust_128", "whip_oversize"], "exactly the blocks no item provides");
  for (const [name, block] of blocks) {
    assert.equal(typeof block.available, "boolean", `${name} has no availability flag`);
    assert.equal(block.available, block.usedBy.length > 0, `${name} availability disagrees with usedBy`);
  }
  assert.match(payload.customNote, /available:false/, "the note explains the flag");
});

test("list_items stays inside its byte budget for every category", async () => {
  const categories = text(await callTool("list_categories")).categories;
  assert.ok(categories.length > 90, "the pack exposes many groups");
  let worst = 0;
  let worstCategory = "";
  let cut = 0;
  for (const { category } of categories) {
    const res = await callTool("list_items", { category });
    const body = res.content[0].text;
    const payload = JSON.parse(body);
    assert.equal(payload.bytes, body.length, `${category} misreported its own size`);
    assert.equal(payload.showing.count, payload.items.length, `${category} showing.count`);
    assert.ok(
      body.length <= 12_000 || payload.oversizedItem,
      `${category} returned ${body.length} bytes with no oversizedItem flag`,
    );
    if (payload.truncated) cut++;
    if (body.length > worst) {
      worst = body.length;
      worstCategory = category;
    }
  }
  assert.ok(cut > 0, "the budget never engaged on any category");
  assert.ok(worst > 6000, `budget never bit: worst was only ${worst} (${worstCategory})`);
});

test("list_items fields shrinks the page and offset resumes it", async () => {
  const fat = text(await callTool("list_items", { category: "hat" }));
  const slim = text(await callTool("list_items", { category: "hat", fields: ["itemId", "name"] }));
  assert.ok(slim.bytes < fat.bytes / 2, `fields bought only ${fat.bytes - slim.bytes} bytes`);
  assert.deepEqual(Object.keys(slim.items[0]).sort(), ["itemId", "name"]);
  if (fat.truncated) {
    const rest = text(
      await callTool("list_items", { category: "hat", offset: fat.nextOffset, fields: ["itemId"] }),
    );
    assert.equal(rest.showing.offset, fat.nextOffset, "offset continues where the cut happened");
    assert.notEqual(rest.items[0].itemId, fat.items.at(-1).itemId, "no item repeats across the cut");
  }
  const bad = await callTool("list_items", { category: "hat", fields: ["shoesize"] });
  assert.equal(bad.isError, true);
  assert.match(text(bad).error, /fields must be an array/);
});

test("render results name the asset pack revision behind them", async () => {
  const payload = text(
    await callTool("generate_spritesheet", { output_path: path.join(OUT_DIR, "surface-revision.png") }),
  );
  assert.match(String(payload.pack.revision), /^[0-9a-f]{40}$/, "a commit SHA or null, never a guess");
});

test("get_preview returns the crop inline without leaking it into the JSON", async () => {
  const res = await callTool("get_preview", { output_path: path.join(OUT_DIR, "surface-inline.png") });
  const body = res.content[0].text;
  assert.ok(!body.includes("inlinePng"), "raw bytes never ride along in the text payload");
  const image = res.content.find((b) => b.type === "image");
  assert.ok(image, "a 64px strip comes back as an image block");
  assert.equal(image.mimeType, "image/png");
  assert.equal(Buffer.from(image.data, "base64").subarray(1, 4).toString(), "PNG");
  assert.equal(JSON.parse(body).frames.length, 8, "walk cycle frames are reported");
});

test("export_character animation mode writes strips, atlas and credits", async () => {
  const dir = path.join(OUT_DIR, "bundle-anim");
  const res = await callTool("export_character", {
    bodyType: "male",
    selections: { hair: "hair_bangs", clothes: "Longsleeve", weapon: "Katana" },
    colors: { body: "bronze", hair: "black", clothes: "teal" },
    mode: "animation",
    output_dir: dir,
  });
  const payload = text(res);
  assert.equal(res.isError, undefined, JSON.stringify(payload));
  assert.equal(payload.image.width, 1152);
  assert.ok(fs.existsSync(path.join(dir, "sheet.png")), "the sheet landed");
  assert.ok(fs.existsSync(path.join(dir, "standard", "walk.png")), "per-animation strips landed");
  assert.ok(fs.existsSync(path.join(dir, "standard", "jump.png")), "the jump row block is exported");
  assert.ok(fs.existsSync(path.join(dir, "custom", "walk_128.png")), "custom blocks were stripped too");
  assert.ok(fs.existsSync(path.join(dir, "sheet-credits.csv")), "attribution ships with the bundle");

  const atlas = JSON.parse(fs.readFileSync(payload.atlas, "utf8"));
  assert.equal(atlas.meta.image, "sheet.png");
  assert.equal(atlas.meta.size.w, 1152);
  assert.equal(atlas.meta.app, "lpc-spritesheet-mcp");
  const frame = atlas.frames.walk_down_1;
  assert.ok(frame, "walk_down_1 exists in the atlas");
  assert.deepEqual(frame.frame, { x: 0, y: 640, w: 64, h: 64 }, "walk row 8, down is the third row");
  assert.equal(frame.rotated, false);
  assert.equal(frame.trimmed, false);
  assert.match(atlas.meta.pivotNote, /local default/, "the invented anchor is labelled as one");

  const manifest = JSON.parse(fs.readFileSync(payload.manifest, "utf8"));
  assert.match(String(manifest.pack.revision), /^[0-9a-f]{40}$/);
  assert.ok(manifest.files.includes("manifest.json"), "the manifest lists itself");
});

test("export_character frames mode crops one file per frame cell", async () => {
  const dir = path.join(OUT_DIR, "bundle-frames");
  const payload = text(
    await callTool("export_character", {
      selections: { weapon: "weapon_polearm_dragonspear" },
      mode: "frames",
      output_dir: dir,
    }),
  );
  const perFrame = payload.files.filter((f) => /^[a-z]+-\d+\.png$/.test(path.basename(f)));
  assert.ok(perFrame.length > 100, `expected a file per cell, got ${perFrame.length}`);
  assert.ok(payload.frames > 100, "the atlas frame count was reported");
  const cell = path.join(dir, "custom", "walk_128", "down-1.png");
  assert.ok(fs.existsSync(cell), "a 128px custom block frame was cropped");
  assert.ok(!fs.existsSync(path.join(dir, "standard", "walk.png")), "frames mode does not also emit strips");
});

test("export_character validates its own arguments and warns about ignored ones", async () => {
  const badMode = await callTool("export_character", { mode: "zip" });
  assert.equal(badMode.isError, true);
  assert.match(text(badMode).error, /Unknown mode "zip"/);

  const badAtlas = await callTool("export_character", { atlas_format: "godot" });
  assert.equal(badAtlas.isError, true);
  assert.match(text(badAtlas).error, /Unknown atlas_format "godot"/);

  const ignored = await callTool("export_character", {
    output_path: "ignored.png",
    output_dir: path.join(OUT_DIR, "bundle-warn"),
  });
  const payload = text(ignored);
  assert.ok(
    payload.warnings.some((w) => /Unknown argument "output_path"/.test(w)),
    JSON.stringify(payload.warnings),
  );
});

test("validate_sheet over the wire reports ok with structuredContent", async () => {
  const res = await callTool("validate_sheet", { scope: "layout" });
  assert.equal(res.isError, undefined);
  const payload = text(res);
  assert.equal(payload.ok, true, JSON.stringify(payload.checks.filter((c) => c.status === "fail")));
  assert.deepEqual(res.structuredContent, payload);
  assert.ok(payload.summary.pass >= 3 && payload.checks.length >= 4, "the audit ran its table checks");
  assert.equal(payload.summary.warn, 1, "the two unreachable blocks are the one honest warning");

  const child = await callTool("validate_sheet", { scope: "character", bodyType: "child" });
  const childPayload = text(child);
  assert.equal(childPayload.ok, true, JSON.stringify(childPayload.checks));
  assert.ok(
    childPayload.checks.some((c) => c.id === "empty-rows" && c.status === "warn"),
    "the under-supported child body surfaces as a warning, not a failure",
  );

  const badScope = await callTool("validate_sheet", { scope: "vibes" });
  assert.equal(badScope.isError, true);
  assert.match(text(badScope).error, /Unknown scope "vibes"/);
});

test("include_character_json writes the layer inventory, not just selections", async () => {
  const res = await callTool("generate_spritesheet", {
    bodyType: "female",
    selections: { hair: "Bangs", weapon: "Rapier" },
    colors: { body: "amber" },
    output_path: path.join(OUT_DIR, "surface-spec.png"),
    include_character_json: true,
  });
  const payload = text(res);
  const doc = JSON.parse(fs.readFileSync(payload.characterJson, "utf8"));
  assert.equal(doc.version, 2);
  assert.equal(doc.bodyType, "female");
  assert.ok(Array.isArray(doc.layers) && doc.layers.length > 3, "layers were written");
  assert.ok(doc.layers.every((l) => Array.isArray(l.supportedAnimations)), "each layer lists what it paints");
  assert.equal(doc.credits.length, payload.credits.entries, "credits ride along in the doc");
  assert.equal(doc.pack.revision, payload.pack.revision, "the doc records the same pack revision");
  assert.match(String(doc.selections.hair.itemId), /^hair_/, "selections still round-trip");

  const back = text(
    await callTool("generate_spritesheet", {
      character: doc,
      output_path: path.join(OUT_DIR, "surface-spec-back.png"),
    }),
  );
  assert.equal(back.image.width, payload.image.width, "the doc renders the same sheet size");
  assert.deepEqual(back.selections, payload.selections, "the doc reads back as the same character");
});

test("a stale v1 state hash imports as a warning, never a failure", async () => {
  const res = await callTool("generate_spritesheet", {
    character: { version: 1, url: "#sex=muscular&hair=Bangs_2_notacolor&torso=Longsleeve" },
    output_path: path.join(OUT_DIR, "surface-v1.png"),
  });
  const payload = text(res);
  assert.equal(res.isError, undefined, JSON.stringify(payload));
  assert.equal(payload.bodyType, "muscular", "v1 sex became the body type");
  const hashWarnings = payload.warnings.filter((w) => /State hash/.test(w));
  assert.equal(hashWarnings.length, 2, JSON.stringify(payload.warnings));
  assert.ok(hashWarnings.some((w) => /torso/.test(w)), "the retired group name is named in the warning");
});
