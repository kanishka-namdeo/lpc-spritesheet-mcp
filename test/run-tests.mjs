// Engine tests for lpc-spritesheet-mcp (run: npm test)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections, SelectionError } from "../src/engine/selection.js";
import { getAllCredits, creditsToCsv } from "../src/engine/credits.js";
import { ANIMATION_OFFSETS } from "../src/engine/constants.js";
import { findAssetsDir } from "../src/assets-dir.js";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}

const OUT_DIR = path.join(import.meta.dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);

function countOpaque(canvas, x = 0, y = 0, w = canvas.width, h = canvas.height) {
  const data = canvas.getContext("2d").getImageData(x, y, w, h).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

test("catalog loads items, groups and palettes", () => {
  assert.ok(catalog.itemsById.size > 600, `expected >600 items, got ${catalog.itemsById.size}`);
  assert.ok(catalog.byTypeName.get("hair").length > 50);
  assert.ok(catalog.paletteMetadata.materials.body.palettes.ulpc.light.length === 6);
  const body = catalog.getItem("body");
  assert.deepEqual(body.required, ["male", "female", "teen", "child", "muscular", "pregnant"]);
});

test("default selections resolve with base colors", () => {
  const sel = normalizeSelections(catalog, "male", {}, {});
  assert.equal(sel.body.itemId, "body");
  assert.equal(sel.body.recolor, "light");
  assert.equal(sel.head.itemId, "heads_human_male");
  assert.equal(sel.expression.itemId, "face_neutral");
});

test("selection resolution by name + colors + eye color", () => {
  const sel = normalizeSelections(
    catalog,
    "female",
    { hair: "Bangs", clothes: "Longsleeve", weapon: "Rapier", head: "Human Female" },
    { body: "amber", hair: "red", clothes: "maroon", eyes: "green" },
  );
  assert.equal(sel.hair.itemId, "hair_bangs");
  assert.equal(sel.hair.recolor, "red");
  assert.equal(sel.body.recolor, "amber");
  assert.equal(sel.clothes.itemId, "torso_clothes_longsleeve");
  assert.equal(sel.eyes.itemId, "heads_human_female", "eyes sub-selection should attach to head item");
  assert.equal(sel.eyes.subId, 1);
  assert.equal(sel.eyes.recolor, "green");
});

test("selection errors list valid values", () => {
  assert.throws(() => normalizeSelections(catalog, "male", { hair: "hair_bangs" }, { hair: "notacolor" }), /not a valid color/);
  assert.throws(() => normalizeSelections(catalog, "male", { hair: "zzz_nope" }), /Unknown item/);
  assert.throws(() => normalizeSelections(catalog, "wombat"), /Unknown bodyType/);
});

test("full sheet: default male renders 832x3456 with content", async () => {
  const { canvas, layout, warnings } = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, {}),
  });
  assert.equal(canvas.width, 832);
  assert.equal(canvas.height, 3456);
  assert.deepEqual(warnings, []);
  // walk row, down direction (row 10), frame 1 should contain body pixels
  const opaque = countOpaque(canvas, 64, 10 * 64, 64, 64);
  assert.ok(opaque > 100, `expected body pixels in walk-down frame, got ${opaque}`);
  assert.equal(layout.standard.animations.walk.frames, 9);
  fs.writeFileSync(path.join(OUT_DIR, "default-male.png"), canvas.toBuffer("image/png"));
});

test("full sheet: styled female with recolors", async () => {
  const selections = normalizeSelections(
    catalog,
    "female",
    {
      hair: "Bangs",
      clothes: "Longsleeve",
      legs: "Pants",
      shoes: "Basic Boots",
      weapon: "Rapier",
      head: "Human Female",
    },
    { body: "amber", hair: "red", clothes: "maroon", legs: "navy", eyes: "green" },
  );
  const { canvas, warnings } = await engine.renderCharacter({ bodyType: "female", selections });
  // The rapier adds a slash_oversize custom block (192px frames, 6 cols): the
  // sheet widens to 1152 and grows 4 rows of 192px below the standard area.
  assert.equal(canvas.width, 192 * 6);
  assert.equal(canvas.height, 3456 + 192 * 4);
  // Known upstream asset gap: the rapier's behind-hand layer has no hurt
  // animation (the web app silently skips it; we surface one aggregated
  // warning per item).
  assert.deepEqual(warnings, [
    "weapon_sword_rapier: no sprite for row(s) hurt — those rows will be empty (1 missing)",
  ]);
  fs.writeFileSync(path.join(OUT_DIR, "styled-female.png"), canvas.toBuffer("image/png"));
});

test("recolor actually changes pixels", async () => {
  const light = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, {}),
  });
  const amber = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, { body: "amber" }),
  });
  const frameLight = light.canvas.getContext("2d").getImageData(64, 10 * 64, 64, 64).data;
  const frameAmber = amber.canvas.getContext("2d").getImageData(64, 10 * 64, 64, 64).data;
  let diff = 0;
  for (let i = 0; i < frameLight.length; i += 4) {
    if (frameLight[i + 3] > 0 && (frameLight[i] !== frameAmber[i] || frameLight[i + 1] !== frameAmber[i + 1])) diff++;
  }
  assert.ok(diff > 50, `expected recolor to change many pixels, changed ${diff}`);
});

test("custom animation block (wheelchair) appended below sheet", async () => {
  const selections = normalizeSelections(catalog, "male", { wheelchair: "Wheelchair" }, {});
  const { canvas, layout } = await engine.renderCharacter({ bodyType: "male", selections });
  assert.equal(canvas.width, 832);
  // wheelchair def: 4 direction rows x 2 cols of 64px frames -> 256px tall block
  assert.equal(canvas.height, 3456 + 64 * 4);
  assert.equal(layout.custom.length, 1);
  assert.equal(layout.custom[0].name, "wheelchair");
  assert.equal(layout.custom[0].yOffset, 3456);
  fs.writeFileSync(path.join(OUT_DIR, "wheelchair.png"), canvas.toBuffer("image/png"));
});

test("oversize weapon custom blocks (dragonspear: walk_128 + thrust_oversize)", async () => {
  const selections = normalizeSelections(catalog, "male", { weapon: "weapon_polearm_dragonspear" }, {});
  const { canvas, layout } = await engine.renderCharacter({ bodyType: "male", selections });
  const names = layout.custom.map((c) => c.name).sort();
  assert.deepEqual(names, ["thrust_oversize", "walk_128"]);
  // canvas fits the widest custom block; height = sheet + both blocks stacked
  assert.equal(canvas.width, Math.max(832, 128 * 9, 192 * 8));
  assert.equal(canvas.height, 3456 + 128 * 4 + 192 * 4);
  fs.writeFileSync(path.join(OUT_DIR, "dragonspear.png"), canvas.toBuffer("image/png"));
});

test("extractAnimation crops walk rows", async () => {
  const { canvas } = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, {}),
  });
  const walk = engine.extractAnimation(canvas, "walk");
  assert.equal(walk.width, 832);
  assert.equal(walk.height, 256);
  assert.ok(countOpaque(walk) > 1000);
  fs.writeFileSync(path.join(OUT_DIR, "walk-only.png"), walk.toBuffer("image/png"));
});

test("extractPreviewStrip returns playback cycle frames", async () => {
  const { canvas } = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, {}),
  });
  const { canvas: strip, frames } = engine.extractPreviewStrip(canvas, "walk", "down");
  assert.equal(strip.width, frames.length * 64);
  assert.equal(strip.height, 64);
  assert.deepEqual(frames, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(countOpaque(strip) > 500);
  fs.writeFileSync(path.join(OUT_DIR, "preview-walk-down.png"), strip.toBuffer("image/png"));
});

test("credits collected for a styled character", async () => {
  const selections = normalizeSelections(catalog, "male", { clothes: "Longsleeve", weapon: "Rapier" }, {});
  const credits = getAllCredits(catalog, selections, "male");
  assert.ok(credits.length >= 4, `expected >=4 credit entries, got ${credits.length}`);
  const csv = creditsToCsv(credits);
  assert.match(csv, /^filename,notes,authors,licenses,urls\n/);
  assert.match(csv, /body\/bodies\/male/);
});

test("character JSON v2 import", async () => {
  const char = {
    version: 2,
    bodyType: "female",
    selections: {
      body: { itemId: "body", subId: null, variant: null, recolor: "bronze" },
      head: { itemId: "heads_human_female", subId: null, variant: null, recolor: "bronze" },
      hair: { itemId: "hair_bob", subId: null, variant: null, recolor: "platinum" },
    },
  };
  const { bodyType, selections } = await (async () => {
    // replicate buildSelections path
    const base = {};
    for (const [group, sel] of Object.entries(char.selections)) {
      base[group] = { itemId: sel.itemId, subId: sel.subId ?? null, variant: sel.variant ?? null, recolor: sel.recolor ?? null };
    }
    return { bodyType: char.bodyType, selections: normalizeSelections(catalog, char.bodyType, base, {}) };
  })();
  assert.equal(bodyType, "female");
  assert.equal(selections.hair.itemId, "hair_bob");
  assert.equal(selections.hair.recolor, "platinum");
});

test("child body type uses child assets", async () => {
  const selections = normalizeSelections(catalog, "child", {}, {});
  const { canvas, warnings } = await engine.renderCharacter({ bodyType: "child", selections });
  assert.equal(canvas.width, 832);
  assert.equal(canvas.height, 3456);
  // The child base art only ships 6 animations; missing ones are surfaced as
  // one aggregated warning (the web app silently skips them).
  assert.equal(warnings.length, 1, warnings.join("; "));
  assert.match(warnings[0], /^body: no sprite for row\(s\) /);
  const missingAnims = warnings[0]
    .match(/row\(s\) (.+?) —/)[1]
    .split(", ")
    .sort();
  assert.deepEqual(missingAnims, [
    "backslash", "climb", "combat_idle", "emote", "halfslash", "run", "shoot",
    "spellcast", "thrust",
  ]);
  fs.writeFileSync(path.join(OUT_DIR, "child.png"), canvas.toBuffer("image/png"));
});

test("${head} template resolution (expression face)", async () => {
  const selections = normalizeSelections(catalog, "male", { expression: "Angry" }, {});
  assert.equal(selections.expression.itemId, "face_angry");
  const { warnings } = await engine.renderCharacter({ bodyType: "male", selections });
  const templateWarnings = warnings.filter((w) => w.includes("face"));
  assert.deepEqual(templateWarnings, [], `face layers failed to load: ${templateWarnings.join("; ")}`);
});

// ---------------------------------------------------------------------------
// Audit-fix regression tests
// ---------------------------------------------------------------------------

test("layout: idle/combat_idle are 2 frames; alias rows carry frames + yOffset", () => {
  const layout = engine.describeLayout();
  assert.equal(layout.standard.animations.idle.frames, 2);
  assert.equal(layout.standard.animations.combat.frames, 2);
  assert.equal(layout.standard.animations.watering.yOffset, ANIMATION_OFFSETS.thrust);
  assert.equal(layout.standard.animations.watering.frames, 8);
  assert.equal(layout.standard.animations.combat.yOffset, ANIMATION_OFFSETS.combat_idle);
  assert.equal(layout.standard.animations["1h_halfslash"].frames, 6);
  assert.match(layout.standard.animations.watering.note, /thrust/);
});

test("hurt preview accepts any direction (single down-facing row); climb single up-facing row", async () => {
  const { canvas } = await engine.renderCharacter({
    bodyType: "male",
    selections: normalizeSelections(catalog, "male", {}, {}),
  });
  // hurt previously threw for direction "down"; its only row IS down-facing
  const hurt = engine.extractPreviewStrip(canvas, "hurt", "down");
  assert.equal(hurt.canvas.width, 6 * 64);
  assert.equal(hurt.canvas.height, 64);
  const hurtUp = engine.extractPreviewStrip(canvas, "hurt", "up");
  assert.equal(
    Buffer.compare(hurt.canvas.toBuffer("image/png"), hurtUp.canvas.toBuffer("image/png")),
    0,
    "hurt single row must be returned regardless of direction",
  );
  // climb is up-facing; down request returns the same single row
  const climb = engine.extractPreviewStrip(canvas, "climb", "down");
  assert.ok(countOpaque(climb.canvas) > 100);
  // multi-row anims still validate strictly
  assert.throws(() => engine.extractPreviewStrip(canvas, "walk", "southeast"), /Unknown direction/);
  // combat_idle alias crops the combat row
  const cidle = engine.extractAnimation(canvas, "combat_idle");
  assert.equal(cidle.width, 832);
  assert.equal(cidle.height, 256);
});

test("selections: unknown group errors with guidance; subId preserved; variant '' tolerated", () => {
  assert.throws(() => normalizeSelections(catalog, "male", { torso: "Longsleeve" }), /Unknown selection group "torso".*clothes/s);
  assert.throws(() => normalizeSelections(catalog, "male", { hair: 5 }), /must be an itemId string/);
  assert.throws(() => normalizeSelections(catalog, "male", {}, "red"), /colors must be an object/);
  // eyes sub-selection from a saved character JSON survives under "eyes"
  const sel = normalizeSelections(catalog, "male", {
    head: { itemId: "heads_human_male", subId: 1, recolor: "green" },
  }, {});
  assert.equal(sel.head.itemId, "heads_human_male");
  assert.equal(sel.eyes.itemId, "heads_human_male");
  assert.equal(sel.eyes.subId, 1);
  assert.equal(sel.eyes.recolor, "green");
  // empty-string variant falls back to the item's first variant
  const katana = normalizeSelections(catalog, "male", { weapon: { itemId: "weapon_sword_katana", variant: "" } }, {});
  assert.equal(katana.weapon.variant, "katana");
  // recolorable default is the upstream UI default (first palette entry):
  // cloth defaults to brown (not the palette base "white")
  const clothes = normalizeSelections(catalog, "male", { clothes: "Longsleeve" }, {});
  assert.equal(clothes.clothes.recolor, "brown");
  const metal = normalizeSelections(catalog, "male", { weapon: "tool_axe" }, {});
  assert.equal(metal.weapon.recolor, "ceramic");
});

test("character JSON merges with args.selections/colors and validates bodyType", () => {
  // buildSelections is exercised through the tool layer; test via engine-level replica
  const char = {
    version: 2,
    bodyType: "female",
    selections: {
      body: { itemId: "body", subId: null, variant: null, recolor: "bronze" },
      hair: { itemId: "hair_bob", subId: null, variant: null, recolor: "platinum" },
      eyes: { itemId: "heads_human_female", subId: 1, recolor: "purple" },
    },
  };
  const base = {};
  for (const [group, sel] of Object.entries(char.selections)) {
    base[group] = { itemId: sel.itemId, subId: sel.subId ?? null, variant: sel.variant ?? null, recolor: sel.recolor ?? null };
  }
  const merged = normalizeSelections(catalog, char.bodyType, { ...base, hair: "hair_bangs" }, { hair: "red" });
  assert.equal(merged.body.recolor, "bronze", "char JSON recolor survives the merge");
  assert.equal(merged.hair.itemId, "hair_bangs", "args.selections overrides char JSON");
  assert.equal(merged.hair.recolor, "red", "colors override char JSON");
  assert.equal(merged.eyes.recolor, "purple", "eyes sub-selection survives the merge");
  assert.equal(merged.head.itemId, "heads_human_male", "app default head; not clobbered by the eyes entry");
  assert.ok(merged.expression, "defaults fill in for minimal char JSONs");
  // invalid bodyType from char JSON is rejected (previously rendered a blank sheet)
  assert.throws(
    () => normalizeSelections(catalog, "potato", {}, {}),
    /Unknown bodyType "potato"/,
  );
});
