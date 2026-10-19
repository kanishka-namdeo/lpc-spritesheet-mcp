// Seeded random generator tests: determinism, output validity, renderability
// (run: node --test test/random-test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";
import {
  randomCharacter,
  randomCharacters,
  rngForSeed,
  cyrb128,
  mulberry32,
  GEAR_PROFILES,
} from "../src/random.js";
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

/** Rows named in a missing-asset warning; `custom:walk_128` style rows are custom blocks. */
function missingRows(warning) {
  const m = warning.match(/no sprite for row\(s\) (.+?) —/);
  return m ? m[1].split(", ") : [];
}

test("PRNG primitives are stable and well-distributed", () => {
  // cyrb128 is pure: same string → same four 32-bit words; different strings → different words.
  assert.deepEqual(cyrb128("lpc"), cyrb128("lpc"));
  assert.deepEqual(cyrb128("lpc"), [3478998573, 3776048659, 108607798, 674601224]);
  assert.deepEqual(
    cyrb128("lpc"),
    cyrb128("lpc").map((w) => w >>> 0),
  );
  assert.notDeepEqual(cyrb128("lpc"), cyrb128("lpc2"));
  // mulberry32: deterministic sequence in [0,1)
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  const seq = Array.from({ length: 1000 }, () => mulberry32(7)());
  assert.ok(seq.every((v) => v >= 0 && v < 1));
  // rngForSeed: distinct seeds give distinct first draws (probabilistically safe: 20 samples)
  const draws = new Set(Array.from({ length: 20 }, (_, i) => rngForSeed(`s${i}`)()));
  assert.equal(draws.size, 20);
});

test("same seed → identical character; different seeds → different characters", () => {
  const one = randomCharacter(catalog, { seed: "hello" });
  const two = randomCharacter(catalog, { seed: "hello" });
  assert.deepEqual(one, two);

  const outputs = new Set(
    Array.from({ length: 20 }, (_, i) =>
      JSON.stringify(randomCharacter(catalog, { seed: `seed-${i}` })),
    ),
  );
  assert.equal(outputs.size, 20);
});

test("output is valid tool input for every seed and gear profile", () => {
  for (const seed of ["alpha", "beta", "gamma", "villager-1", "party", "test-6", "test-7", "test-8", "test-9", "test-10"]) {
    for (const gear of Object.keys(GEAR_PROFILES)) {
      const r = randomCharacter(catalog, { seed, gear });
      // The critical gate: this must never throw.
      const selections = normalizeSelections(catalog, r.bodyType, r.selections, r.colors);
      assert.ok(selections.body, "body implicit selection");
      assert.ok(selections.head, "head selection");
    }
  }
});

test("random characters render with a painted walk cycle", async () => {
  for (const seed of ["walk-a", "walk-b", "walk-c", "walk-d", "walk-e"]) {
    const r = randomCharacter(catalog, { seed, gear: "soldier" });
    const selections = normalizeSelections(catalog, r.bodyType, r.selections, r.colors);
    const { canvas, warnings } = await engine.renderCharacter({
      bodyType: r.bodyType,
      selections,
      matchBodyColorEnabled: true,
    });
    assert.ok(canvas.width >= 832 && canvas.height >= 3456);

    // completeOnly (default) guarantees no always-visible item misses its walk row.
    for (const warning of warnings) {
      const rows = missingRows(warning);
      assert.ok(
        !rows.includes("walk"),
        `seed ${seed} produced a walk-row gap: ${warning}`,
      );
    }

    // walk-down frame 1 actually paints (row 10 = walk row 8 + down index 2)
    const walkDown = countOpaque(canvas, 0, 10 * 64, 64, 64);
    assert.ok(walkDown > 0, `seed ${seed} walk-down frame unpainted`);
  }
});

test("bodyType is respected and every selection supports it", () => {
  const r = randomCharacter(catalog, { seed: "forced", bodyType: "female" });
  assert.equal(r.bodyType, "female");
  for (const [group, value] of Object.entries(r.selections)) {
    const itemId = typeof value === "string" ? value : value.itemId;
    const item = catalog.getItem(itemId);
    assert.ok(item.required.includes("female"), `${group} item ${itemId} not female-capable`);
  }
});

test("bare gear rolls no weapons or shields", () => {
  // Deterministic across 30 seeds: the bare profile's 0% gates never fire.
  for (let i = 0; i < 30; i++) {
    const r = randomCharacter(catalog, { seed: `bare-${i}`, gear: "bare" });
    assert.equal("weapon" in r.selections, false, `seed bare-${i} rolled a weapon`);
    assert.equal("shield" in r.selections, false);
    assert.equal("wings" in r.selections, false);
  }
});

test("invalid options throw with guidance", () => {
  assert.throws(() => randomCharacter(catalog, { bodyType: "giant" }), /Unknown bodyType/);
  assert.throws(() => randomCharacter(catalog, { gear: "ninja" }), /Unknown gear profile/);
  assert.throws(() => randomCharacters(catalog, { count: -1 }), /non-negative integer/);
  assert.throws(() => randomCharacters(catalog, { count: 1.5 }), /non-negative integer/);
});

test("randomCharacters: per-index seeds, batch = individual rolls", () => {
  const batch = randomCharacters(catalog, { seed: "village", count: 7 });
  assert.equal(batch.length, 7);
  assert.deepEqual(batch[3], randomCharacter(catalog, { seed: "village:3" }));
  assert.deepEqual(batch.map((c) => c.seed), ["village:0", "village:1", "village:2", "village:3", "village:4", "village:5", "village:6"]);
});

test("child body relaxes gracefully where the pack is thin", async () => {
  const r = randomCharacter(catalog, { seed: "kid", bodyType: "child" });
  const selections = normalizeSelections(catalog, "child", r.selections, r.colors);
  const { canvas } = await engine.renderCharacter({
    bodyType: "child",
    selections,
    matchBodyColorEnabled: true,
  });
  // child ships hurt/idle/jump/sit/slash/walk only — walk must still paint.
  assert.ok(countOpaque(canvas, 0, 10 * 64, 64, 64) > 0, "child walk-down unpainted");
});
