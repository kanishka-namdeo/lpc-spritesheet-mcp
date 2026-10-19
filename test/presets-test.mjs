// Preset library tests: every curated preset must normalize, render, and paint
// its walk cycle against the real asset pack (run: node --test test/presets-test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";
import { listPresets, getPreset, presetNames } from "../src/presets.js";
import { findAssetsDir } from "../src/assets-dir.js";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);

function countOpaque(canvas, x, y, w, h) {
  const data = canvas.getContext("2d").getImageData(x, y, w, h).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

/**
 * Extract the row names from a missing-asset warning. A warning reads
 * `itemId: no sprite for row(s) walk, idle — those rows will be empty (2 missing)`.
 * Custom-block rows are reported as `custom:walk_128` etc. and must NOT be
 * mistaken for the standard `walk` row.
 */
function missingRows(warning) {
  const m = warning.match(/no sprite for row\(s\) (.+?) —/);
  return m ? m[1].split(", ") : [];
}

// Core groups every preset should fill. Pack-level exceptions are asserted
// intentionally below (see GROUP_EXCEPTIONS):
// - "child": no child shoes and no child-capable expression items exist in the pack
//   (non-human child heads ship their own faces, and the human child head is not in
//   the expression layer's ${head} template table either).
// - "barbarian": the muscular body type has no torso clothes/armour items at all,
//   so a muscular preset is legitimately shirtless.
// - "knight"/"rogue": torso armour is its own selection group (`armour`), not `clothes` —
//   an armoured preset covers its torso through that group instead.
// - "lizardfolk": the lizard head ships its own face (no expression items support it)
//   and takes no hair or headwear.
// The wheelchair preset is NOT an exception: the wheelchair item layers around the
// character (own group, custom animation block), so its legs and shoes still render.
const REQUIRED_GROUPS = ["head", "expression", "clothes", "legs", "shoes"];
const GROUP_EXCEPTIONS = {
  child: ["expression", "shoes"],
  barbarian: ["clothes"],
  knight: ["clothes"],
  rogue: ["clothes"],
  lizardfolk: ["expression", "hair", "hat"],
};

test("listPresets describes a full library with unique names", () => {
  const presets = listPresets();
  assert.ok(presets.length >= 12, `expected >= 12 presets, got ${presets.length}`);
  assert.equal(new Set(presets.map((p) => p.name)).size, presets.length, "preset names must be unique");
  for (const preset of presets) {
    assert.equal(typeof preset.name, "string", JSON.stringify(preset));
    assert.equal(typeof preset.description, "string");
    assert.ok(preset.description.length > 10, "descriptions are informative");
    assert.ok(["male", "female", "teen", "child", "muscular", "pregnant"].includes(preset.bodyType));
    assert.ok(Array.isArray(preset.groups) && preset.groups.length > 0);
    assert.ok(preset.groups.every((g) => typeof g === "string"));
  }
  // The library spans every body type the engine supports.
  const bodyTypes = new Set(presets.map((p) => p.bodyType));
  for (const bodyType of ["male", "female", "teen", "child", "muscular", "pregnant"]) {
    assert.ok(bodyTypes.has(bodyType), `no preset covers bodyType ${bodyType}`);
  }
});

test("getPreset round-trips case-insensitively; unknown names return null", () => {
  for (const spelling of ["knight", "Knight", "KNIGHT", " KnIgHt "]) {
    const preset = getPreset(spelling);
    assert.ok(preset, `getPreset(${JSON.stringify(spelling)}) must resolve`);
    assert.equal(preset.name, "knight");
    assert.equal(preset.bodyType, "male");
    assert.ok(preset.selections.armour);
    assert.equal(preset.selections.armour, "torso_armour_plate");
    assert.ok(preset.colors.armour);
  }
  assert.equal(getPreset("nope"), null);
  assert.equal(getPreset(""), null);
  assert.equal(getPreset(null), null);
  assert.equal(getPreset(42), null);
});

test("presetNames matches the library listing", () => {
  const names = presetNames();
  assert.deepEqual(names, listPresets().map((p) => p.name));
  assert.ok(names.includes("knight") && names.includes("villager"));
});

test("getPreset returns a defensive copy", () => {
  const preset = getPreset("rogue");
  preset.selections.hair = "mutated";
  preset.colors.hair = "mutated";
  assert.equal(getPreset("rogue").selections.hair, "hair_bob");
  assert.equal(getPreset("rogue").colors.hair, "black");
});

test("listPresets groups agree with getPreset selections", () => {
  for (const entry of listPresets()) {
    const preset = getPreset(entry.name);
    assert.deepEqual(entry.groups, Object.keys(preset.selections), entry.name);
  }
});

for (const entry of listPresets()) {
  test(`preset "${entry.name}" (${entry.bodyType}) normalizes, renders, and paints its walk cycle`, async () => {
    const preset = getPreset(entry.name);

    // 1. Every itemId and color name is real: normalization must not throw.
    const selections = normalizeSelections(catalog, preset.bodyType, preset.selections, preset.colors);
    assert.ok(selections.body, "body is always selected (implicit)");

    // 2. The full sheet renders.
    const { canvas, warnings } = await engine.renderCharacter({
      bodyType: preset.bodyType,
      selections,
      matchBodyColorEnabled: true,
    });
    assert.ok(canvas.width >= 832 && canvas.height >= 3456);

    // 3. No selected item is missing its walk row (the core animation). Other
    //    row gaps are allowed (e.g. capes ship no climb art) but minimized by
    //    curation; `custom:walk_128` mentions are custom-block rows, not walk.
    for (const warning of warnings) {
      const rows = missingRows(warning);
      assert.ok(
        !rows.includes("walk"),
        `preset ${entry.name} has a walk-row gap: ${warning}`,
      );
    }

    // 4. The walk cycle actually paints: frame column 1 of the up (row 8) and
    //    down (row 10) direction rows carries opaque pixels, like the body test
    //    in run-tests.mjs.
    const walkUp = countOpaque(canvas, 64, 8 * 64, 64, 64);
    const walkDown = countOpaque(canvas, 64, 10 * 64, 64, 64);
    assert.ok(walkUp > 0, `walk-up frame unpainted (${walkUp} opaque px)`);
    assert.ok(walkDown > 0, `walk-down frame unpainted (${walkDown} opaque px)`);

    // 5. Core group coverage, with the documented pack-level exceptions.
    const exceptions = GROUP_EXCEPTIONS[entry.name] ?? [];
    for (const group of REQUIRED_GROUPS) {
      if (exceptions.includes(group)) continue;
      assert.ok(group in preset.selections, `preset ${entry.name} is missing group "${group}"`);
    }
    assert.ok(
      exceptions.includes("hair") ||
        "hair" in preset.selections ||
        "hat" in preset.selections,
      `preset ${entry.name} needs hair or headwear`,
    );
  });
}
