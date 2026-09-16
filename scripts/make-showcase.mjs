#!/usr/bin/env node
// Regenerates the showcase images in docs/img/ used by the README.
// Usage: node scripts/make-showcase.mjs   (requires the asset pack — see README)
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";

const ASSETS_DIR = process.env.LPC_ASSETS_DIR
  ? path.resolve(process.env.LPC_ASSETS_DIR)
  : path.resolve(import.meta.dirname, "..", "..", "lpc-generator-src");
const OUT_DIR = path.join(import.meta.dirname, "..", "docs", "img");
fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);

// Nearest-neighbor scale of a canvas
function scale(canvas, factor) {
  const out = createCanvas(Math.round(canvas.width * factor), Math.round(canvas.height * factor));
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

async function render(name, args) {
  const selections = normalizeSelections(catalog, args.bodyType ?? "male", args.selections ?? {}, args.colors ?? {});
  const { canvas, warnings } = await engine.renderCharacter({ bodyType: args.bodyType ?? "male", selections });
  if (warnings.length) console.warn(`[${name}] warnings:`, warnings);
  return { selections, canvas };
}

function withBackdrop(canvas, pad = 24, bg = "#151a26") {
  const out = createCanvas(canvas.width + pad * 2, canvas.height + pad * 2);
  const ctx = out.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, pad, pad);
  return out;
}

let labelFont = null;
try {
  GlobalFonts.registerFromPath("C:\\Windows\\Fonts\\segoeuib.ttf", "Segoe UI");
  labelFont = '30px "Segoe UI"';
} catch {
  try {
    GlobalFonts.registerFromPath("C:\\Windows\\Fonts\\arialbd.ttf", "Arial");
    labelFont = '30px "Arial"';
  } catch {
    console.warn("no system font found — hero labels will be skipped");
  }
}

// ---------------------------------------------------------------------------
// Hero: three characters (idle, 5x) + one shared walk cycle (2x) on a dark card
// ---------------------------------------------------------------------------
const CAST = [
  {
    label: "KNIGHT",
    bodyType: "male",
    selections: {
      hair: "hair_short",
      armour: { itemId: "torso_armour_plate", recolor: "steel" },
      legs: "legs_armour",
      shoes: "feet_boots_basic",
      shoulders: "shoulders_pauldrons",
      weapon: { itemId: "weapon_sword_arming", variant: "steel" },
      shield: "shield_heater_wood",
      shield_pattern: { itemId: "shield_heater_pattern_barry", variant: "red" },
    },
    colors: { body: "light", hair: "dark_brown" },
  },
  {
    label: "ARCHER",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_bangs",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      hat: "hat_hood_cloth",
      weapon: { itemId: "weapon_ranged_bow_recurve", variant: "medium" },
    },
    colors: { body: "amber", hair: "red", clothes: "maroon", eyes: "green" },
  },
  {
    label: "MAGE",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_bob",
      dress: { itemId: "dress_kimono", variant: "purple" },
      belt: "belt_mage",
      weapon: "weapon_magic_wand",
    },
    colors: { body: "taupe", hair: "white" },
  },
];

const POSE_SCALE = 5;
const STRIP_SCALE = 2;
const GAP = 56;
const PAD = 40;

const cast = [];
for (const spec of CAST) {
  const { selections, canvas } = await render(spec.label, spec);
  const pose = scale(engine.extractFrame(canvas, "idle", "down", 0), POSE_SCALE);
  cast.push({ spec, selections, pose });
}

console.log("assembling hero card");
// walk cycle from the knight (his sword renders in the standard walk rows)
const knight = cast[0];
const strip = scale(
  engine.extractPreviewStrip((await render("walk", knight.spec)).canvas, "walk", "down").canvas,
  STRIP_SCALE,
);

const castWidth = cast.length * cast[0].pose.width + (cast.length - 1) * GAP;
const width = Math.max(castWidth, strip.width) + PAD * 2;
const height = PAD + cast[0].pose.height + 64 + strip.height + PAD * 2;

const hero = createCanvas(width, height);
const hctx = hero.getContext("2d");
hctx.fillStyle = "#151a26";
hctx.fillRect(0, 0, width, height);
// faint checkerboard so transparency reads like a sprite editor
hctx.fillStyle = "#1b2130";
for (let y = PAD; y < height - PAD; y += 32) {
  for (let x = PAD; x < width - PAD; x += 32) {
    if (((x / 32) | 0) % 2 === ((y / 32) | 0) % 2) hctx.fillRect(x, y, 32, 32);
  }
}

let x = (width - castWidth) / 2;
for (const { spec, pose } of cast) {
  hctx.drawImage(pose, x, PAD);
  if (labelFont) {
    hctx.fillStyle = "#8ea2c9";
    hctx.font = labelFont;
    hctx.textAlign = "center";
    hctx.fillText(spec.label, x + pose.width / 2, PAD + pose.height + 44);
  }
  x += pose.width + GAP;
}
hctx.drawImage(strip, (width - strip.width) / 2, PAD + cast[0].pose.height + 64 + PAD / 2);
fs.writeFileSync(path.join(OUT_DIR, "hero.png"), hero.toBuffer("image/png"));
console.log("wrote docs/img/hero.png", hero.width, "x", hero.height);

// ---------------------------------------------------------------------------
// Full-sheet example: katana wielder (walk_128 + slash_128 custom blocks)
// ---------------------------------------------------------------------------
const sheet = await render("sheet", {
  selections: { hair: "hair_bangs", clothes: "Longsleeve", weapon: "Katana" },
  colors: { body: "bronze", hair: "black", clothes: "teal" },
});
const sheetThumb = scale(sheet.canvas, 0.28);
fs.writeFileSync(path.join(OUT_DIR, "sheet-katana.png"), withBackdrop(sheetThumb, 12).toBuffer("image/png"));
console.log("wrote docs/img/sheet-katana.png", sheetThumb.width, "x", sheetThumb.height);

// ---------------------------------------------------------------------------
// Preview-strip example: knight walk cycle at 3x
// ---------------------------------------------------------------------------
const preview = scale(
  engine.extractPreviewStrip((await render("preview", knight.spec)).canvas, "walk", "down").canvas,
  3,
);
fs.writeFileSync(path.join(OUT_DIR, "walk-strip.png"), withBackdrop(preview, 16).toBuffer("image/png"));
console.log("wrote docs/img/walk-strip.png", preview.width, "x", preview.height);
