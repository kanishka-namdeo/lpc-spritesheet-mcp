// The determinism gate: canonical specs re-rendered and compared against test/golden.json.
//
// Until this file existed the repo claimed byte-identical output as a convention with nothing
// checking it, and `test/out/` is gitignored so there was no baseline at all. The manifest stores
// hashes, not images, because the asset pack must never enter this repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { findAssetsDir, packRevision } from "../src/assets-dir.js";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";
import { getAllCredits } from "../src/engine/credits.js";
import { GOLDEN_SPECS } from "./golden-specs.mjs";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error("No LPC asset pack found. Run `npm run setup-assets` before `npm test`.");
}

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);
const OUT_DIR = path.join(import.meta.dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

const MANIFEST_PATH = path.join(import.meta.dirname, "golden.json");
const manifest = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
  : null;

async function renderEntry(spec) {
  const selections = normalizeSelections(catalog, spec.bodyType, spec.selections, spec.colors);
  const { canvas, warnings } = await engine.renderCharacter({
    bodyType: spec.bodyType,
    selections,
    matchBodyColorEnabled: true,
  });
  const png = canvas.toBuffer("image/png");
  return {
    png,
    width: canvas.width,
    height: canvas.height,
    sha256: crypto.createHash("sha256").update(png).digest("hex"),
    warnings: warnings.slice().sort(),
    creditsEntries: getAllCredits(catalog, selections, spec.bodyType).length,
  };
}

test("golden manifest was recorded against this asset pack revision", () => {
  assert.ok(manifest, "test/golden.json is missing — run `npm run golden` and commit it.");
  const live = packRevision(ASSETS_DIR);
  assert.equal(
    live,
    manifest.packRevision,
    [
      `The pack on disk is ${live ?? "not a git checkout"} but test/golden.json was recorded at ${manifest.packRevision}.`,
      `Byte hashes are only meaningful against the art they were taken from. Either:`,
      `  git -C "${ASSETS_DIR}" checkout ${manifest.packRevision}`,
      `or re-record on purpose with \`npm run golden\` and commit the diff.`,
    ].join("\n"),
  );
});

for (const spec of GOLDEN_SPECS) {
  test(`golden render matches: ${spec.name}`, async () => {
    const expected = manifest?.renders?.[spec.name];
    assert.ok(expected, `test/golden.json has no entry for "${spec.name}" — run \`npm run golden\`.`);
    const actual = await renderEntry(spec);
    fs.writeFileSync(path.join(OUT_DIR, `golden-${spec.name}.png`), actual.png);

    assert.equal(actual.width, expected.width, `${spec.name} width`);
    assert.equal(actual.height, expected.height, `${spec.name} height`);
    assert.deepEqual(actual.warnings, expected.warnings, `${spec.name} warnings`);
    assert.equal(actual.creditsEntries, expected.creditsEntries, `${spec.name} credit entries`);
    assert.equal(
      actual.sha256,
      expected.sha256,
      `${spec.name} pixels changed: expected ${expected.sha256} (recorded at ${manifest.packRevision}), got ${actual.sha256}`,
    );
  });
}

test("the same spec rendered twice is byte-identical", async () => {
  const first = await renderEntry(GOLDEN_SPECS[2]);
  const second = await renderEntry(GOLDEN_SPECS[2]);
  assert.equal(Buffer.compare(first.png, second.png), 0, "two renders of one spec differed");
});
