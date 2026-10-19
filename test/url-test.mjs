// Shareable-URL encoder tests: `toStateHash` / `generatorUrl` (src/spec.js) against the
// real pack — the writer half of the `fromHash` decoder. The format under test is
// upstream's sources/state/hash.ts, so these pins double as upstream-parity checks:
// name-based values ("Bangs", never "hair_bangs"), `sex=` first, raw variant strings
// (spaces percent-encoded, not underscored), and the `eyes=<slot-label>_<color>` param.
import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";
import { findAssetsDir } from "../src/assets-dir.js";
import {
  toStateHash,
  generatorUrl,
  GENERATOR_APP_URL,
  buildCharacterSpec,
  readSavedCharacter,
} from "../src/spec.js";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);

// The mission's canonical fixture: female, Bangs hair + Longsleeve, recolored
// (body amber, hair red, clothes teal) with green eyes.
const FIXTURE_SELECTIONS = normalizeSelections(
  catalog,
  "female",
  { hair: "Bangs", clothes: "Longsleeve" },
  { body: "amber", hair: "red", clothes: "teal", eyes: "green" },
);
const FIXTURE = { bodyType: "female", selections: FIXTURE_SELECTIONS };

test("round-trip A: a simple character survives hash -> readSavedCharacter -> normalizeSelections", () => {
  const hash = toStateHash(catalog, FIXTURE);
  assert.ok(hash.startsWith("#sex=female&"), hash);

  const read = readSavedCharacter(catalog, hash);
  const again = normalizeSelections(catalog, read.bodyType, read.selections, {});
  assert.equal(again.hair.itemId, "hair_bangs");
  assert.equal(again.hair.recolor, "red");
  assert.equal(again.body.recolor, "amber");
  assert.equal(again.clothes.itemId, "torso_clothes_longsleeve");
  assert.equal(again.clothes.recolor, "teal");
  assert.equal(again.head.recolor, "light");

  // EYES: the encoding CARRIES the eye color as upstream's own `eyes=` param (the slot
  // label is the name part), and the real web app recovers it through its sub-item
  // fallback (hash.ts:354-411). This port's `fromHash` has no such fallback, so the
  // hash path here drops it to exactly one warning — the documented limit; the v2 JSON
  // path carries eyes losslessly (asserted in the "none" test below).
  assert.ok(hash.includes("eyes=Eye_Color_green"), hash);
  assert.equal(read.warnings.length, 1, JSON.stringify(read.warnings));
  assert.match(read.warnings[0], /^State hash eyes="Eye_Color_green"/);
  assert.equal(again.eyes, undefined);
});

test("round-trip B: variant selections (weapon + tail) plus a recolor survive the hash", () => {
  const selections = normalizeSelections(
    catalog,
    "male",
    {
      weapon: { itemId: "weapon_sword_katana", variant: "katana" },
      tail: { itemId: "tail_cat", variant: "dark brown" },
      clothes: "Longsleeve",
    },
    { clothes: "teal" },
  );
  const hash = toStateHash(catalog, { bodyType: "male", selections });
  // Upstream writes variant/recolor strings RAW (hash.ts:237-242): "dark brown" is
  // percent-encoded by encodeURIComponent, never underscored — the old underscore
  // spelling is accepted by upstream's decoder (issue #296) but is not what it emits.
  assert.ok(hash.includes("weapon=Katana_katana"), hash);
  assert.ok(hash.includes("tail=Cat_Tail_dark%20brown"), hash);
  assert.ok(hash.includes("clothes=Longsleeve_teal"), hash);

  const read = readSavedCharacter(catalog, hash);
  assert.deepEqual(read.warnings, [], JSON.stringify(read.warnings));
  const again = normalizeSelections(catalog, read.bodyType, read.selections, {});
  assert.equal(again.weapon.itemId, "weapon_sword_katana");
  assert.equal(again.weapon.variant, "katana");
  assert.equal(again.tail.itemId, "tail_cat");
  assert.equal(again.tail.variant, "dark brown");
  assert.equal(again.clothes.recolor, "teal");
});

test("the hash uses upstream's exact name-based format (pinned byte-for-byte)", () => {
  const hash = toStateHash(catalog, FIXTURE);
  // sex first, then groups sorted (stable order; upstream has none — it serializes
  // insertion order). Names carry spaces as underscores ("Body Color" -> "Body_Color"),
  // sub-selections use their slot label ("Eye Color" -> "Eye_Color"), and no itemId
  // ever appears.
  assert.equal(
    hash,
    "#sex=female&body=Body_Color_amber&clothes=Longsleeve_teal&expression=Neutral_light" +
      "&eyes=Eye_Color_green&hair=Bangs_red&head=Human_Male_light",
  );
  assert.match(hash, /^#sex=(male|female|teen|child|muscular|pregnant)&/);
  assert.ok(hash.includes("Bangs"), "values are display names");
  assert.ok(!hash.includes("hair_bangs"), "values must not be itemIds");
});

test("generatorUrl prefixes the live upstream web-app URL from the README", () => {
  const url = generatorUrl(catalog, FIXTURE);
  assert.equal(
    GENERATOR_APP_URL,
    "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/",
  );
  assert.ok(url.startsWith("https://liberatedpixelcup.github.io/"), url);
  assert.ok(url.includes("#sex="), url);
  assert.equal(url, GENERATOR_APP_URL + toStateHash(catalog, FIXTURE));
});

test("stability: the same character always encodes to the identical canonical string", () => {
  const once = toStateHash(catalog, FIXTURE);
  assert.equal(toStateHash(catalog, FIXTURE), once);
  // A different insertion order of the same selections canonicalizes to the same hash:
  // group order is sorted, not caller-dependent.
  const reordered = {
    bodyType: "female",
    selections: Object.fromEntries(
      Object.keys(FIXTURE_SELECTIONS).reverse().map((g) => [g, FIXTURE_SELECTIONS[g]]),
    ),
  };
  assert.equal(toStateHash(catalog, reordered), once);
});

test("colors fold into the selection tails; nothing throws on odd input", () => {
  // Plain fold: colors.hair -> the hair selection's recolor tail.
  assert.equal(
    toStateHash(catalog, {
      bodyType: "male",
      selections: { hair: { itemId: "hair_bangs", subId: null, variant: null, recolor: null } },
      colors: { hair: "red" },
    }),
    "#sex=male&hair=Bangs_red",
  );
  // The special "eyes" color folds onto the eyes sub-selection (slot label as name).
  assert.equal(
    toStateHash(catalog, {
      bodyType: "male",
      selections: {
        head: { itemId: "heads_human_male", subId: null, variant: null, recolor: "light" },
        eyes: { itemId: "heads_human_male", subId: 1, variant: null, recolor: null },
      },
      colors: { eyes: "green" },
    }),
    "#sex=male&eyes=Eye_Color_green&head=Human_Male_light",
  );
  // A color for a group with no selection, an unofferable color, and a variant-only
  // item asked for a color are all skipped without throwing.
  assert.equal(
    toStateHash(catalog, {
      bodyType: "male",
      selections: {
        hair: { itemId: "hair_bangs", subId: null, variant: null, recolor: null },
        weapon: { itemId: "weapon_sword_katana", subId: null, variant: "katana", recolor: null },
      },
      colors: { hair: "notacolor", legs: "navy" },
    }),
    "#sex=male&hair=Bangs&weapon=Katana_katana",
  );
  // Folding never mutates the caller's character object.
  const input = {
    bodyType: "male",
    selections: { hair: { itemId: "hair_bangs", subId: null, variant: null, recolor: null } },
    colors: { hair: "red" },
  };
  toStateHash(catalog, input);
  assert.equal(input.selections.hair.recolor, null, "colors folding must not mutate the input");

  // Odd shapes: unknown itemIds, "none" leftovers, junk values, missing bodyType, and
  // an empty character never throw; unresolvable groups are skipped.
  assert.equal(
    toStateHash(catalog, {
      bodyType: "male",
      selections: {
        hair: { itemId: "does_not_exist", subId: null, variant: null, recolor: "red" },
        hat: "none",
        weapon: { itemId: "weapon_sword_katana", subId: null, variant: "nonsense", recolor: null },
      },
    }),
    "#sex=male&weapon=Katana",
  );
  assert.equal(toStateHash(catalog, {}), "#");
  assert.equal(toStateHash(catalog, { selections: null }), "#");
});

test("'none' groups: deleted before encoding; the v2 JSON path round-trips the character (incl. eyes)", async () => {
  // normalizeSelections deletes "none" groups, so its output — the shape toStateHash
  // takes — never contains them.
  const selections = normalizeSelections(
    catalog,
    "female",
    { hair: "Bangs", expression: "none" },
    { body: "amber", hair: "red", eyes: "green" },
  );
  assert.equal(selections.expression, undefined, '"none" deletes the default expression');

  // A hand-built shape that still carries a "none" value encodes without throwing.
  assert.equal(
    toStateHash(catalog, {
      bodyType: "female",
      selections: { hair: { itemId: "hair_bangs", subId: null, variant: null, recolor: "red" }, hat: "none" },
    }),
    "#sex=female&hair=Bangs_red",
  );

  // The real product flow: render, save the v2 character JSON, and read it back —
  // same itemIds everywhere, and the eyes sub-selection survives this path (unlike
  // the hash path, where this port's decoder drops it).
  const { layers } = await engine.renderCharacter({ bodyType: "female", selections });
  const doc = buildCharacterSpec(catalog, {
    bodyType: "female",
    selections,
    layers,
    credits: [],
    generator: { name: "url-test", version: "0" },
    pack: { revision: null },
  });

  const read = readSavedCharacter(catalog, JSON.parse(JSON.stringify(doc)));
  const again = normalizeSelections(catalog, read.bodyType, read.selections, {});
  for (const [group, sel] of Object.entries(doc.selections)) {
    assert.ok(again[group], `group ${group} survived the v2 JSON round-trip`);
    assert.equal(again[group].itemId, sel.itemId, `group ${group} kept its itemId`);
  }
  assert.equal(again.eyes.subId, 1);
  assert.equal(again.eyes.recolor, "green", "the v2 JSON path carries the eye color");
  // A "none" group cannot stay deleted across a re-read: normalizeSelections fills the
  // app defaults back in (documented fill-in behavior, same as any minimal char JSON).
  assert.equal(again.expression.itemId, "face_neutral");

  // And the same document's selections through the HASH path: identical itemIds for
  // every group except "eyes" (dropped by this port's hash decoder with one warning —
  // the real web app recovers it) and the deleted "expression" (re-filled as default).
  const hash = toStateHash(catalog, { bodyType: doc.bodyType, selections: doc.selections });
  const readHash = readSavedCharacter(catalog, hash);
  const againHash = normalizeSelections(catalog, readHash.bodyType, readHash.selections, {});
  for (const [group, sel] of Object.entries(doc.selections)) {
    if (group === "eyes") continue;
    assert.ok(againHash[group], `group ${group} survived the hash round-trip`);
    assert.equal(againHash[group].itemId, sel.itemId, `group ${group} kept its itemId via the hash`);
  }
  assert.equal(againHash.expression.itemId, "face_neutral");
  assert.equal(readHash.warnings.length, 1, JSON.stringify(readHash.warnings));
  assert.match(readHash.warnings[0], /^State hash eyes=/);
});
