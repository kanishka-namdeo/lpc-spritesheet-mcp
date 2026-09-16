// Smoke test: verify @napi-rs/canvas works on this machine
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../lpc-generator-src");
const img = await loadImage(path.join(repo, "spritesheets/body/bodies/male/walk.png"));
console.log("loaded walk.png:", img.width, "x", img.height);

const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, 64, 64);
let opaque = 0;
for (let i = 3; i < data.data.length; i += 4) if (data.data[i] > 0) opaque++;
console.log("opaque pixels in first frame:", opaque);

// recolor exercise
const recolored = createCanvas(img.width, img.height);
const rctx = recolored.getContext("2d");
rctx.drawImage(img, 0, 0);
const id2 = rctx.getImageData(0, 0, img.width, img.height);
const px = id2.data;
for (let i = 0; i < px.length; i += 4) {
  if (px[i + 3] === 0) continue;
  px[i] = 255 - px[i];
  px[i + 1] = 255 - px[i + 1];
  px[i + 2] = 255 - px[i + 2];
}
rctx.putImageData(id2, 0, 0);
const out = path.join(import.meta.dirname, "out", "smoke-out.png");
fs.writeFileSync(out, recolored.toBuffer("image/png"));
console.log("wrote", out);
console.log("SMOKE OK");
