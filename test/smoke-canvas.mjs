// Smoke check: prove @napi-rs/canvas can load, draw and read back a pack PNG in
// this environment. Top-level script rather than a node:test suite — a throw here
// fails the run.
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { findAssetsDir } from "../src/assets-dir.js";

const assetsDir = findAssetsDir();
if (!assetsDir) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}

const img = await loadImage(path.join(assetsDir, "spritesheets/body/bodies/male/walk.png"));
console.log("loaded walk.png:", img.width, "x", img.height);
assert.ok(img.width > 0 && img.height > 0, "canvas did not decode the pack PNG");

const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, 64, 64);
let opaque = 0;
for (let i = 3; i < data.data.length; i += 4) if (data.data[i] > 0) opaque++;
console.log("opaque pixels in first frame:", opaque);
assert.ok(opaque > 0, "drawImage produced an empty frame");

// recolor exercise
const recolored = createCanvas(img.width, img.height);
const rctx = recolored.getContext("2d");
rctx.drawImage(img, 0, 0);
const id2 = recolored.getContext("2d").getImageData(0, 0, img.width, img.height);
const px = id2.data;
for (let i = 0; i < px.length; i += 4) {
  if (px[i + 3] === 0) continue;
  px[i] = 255 - px[i];
  px[i + 1] = 255 - px[i + 1];
  px[i + 2] = 255 - px[i + 2];
}
rctx.putImageData(id2, 0, 0);
assert.notDeepStrictEqual(
  recolored.getContext("2d").getImageData(0, 0, 64, 64).data,
  data.data,
  "inverting the pixels changed nothing",
);

const out = path.join(import.meta.dirname, "out", "smoke-out.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, recolored.toBuffer("image/png"));
console.log("wrote", out);
console.log("SMOKE OK");
