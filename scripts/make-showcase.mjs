#!/usr/bin/env node
// Regenerates EVERY committed image in docs/img/ that README.md embeds, in one run:
//
//   hero.png           — 1184x576 banner: name, tagline, live counts, three characters
//   walk-strip.png     — 1064x228: one 8-frame walk cycle at 2x, source column per frame
//   sheet-katana.png   — 1216x624: a real sheet cropped to its walk row + both 128px blocks
//   gallery.png        — 1152x1444: 9 labelled characters, one capability each
//   social-preview.png — 1280x640 opaque banner for the repo settings page
//   logo.png           — 400x400 emblem for MCP directories
//   showcase-credits.csv / .txt — attribution for every asset in every render above
//
// Usage: node scripts/make-showcase.mjs   (requires the asset pack — see README)
//
// Determinism: no timestamps, no Math.random, every collection iterated in a fixed
// order, credits sorted by file path. Two runs must produce byte-identical PNGs.
//
// CRISPNESS RULE (binding): pixel art here is only ever drawn at an INTEGER multiple
// of its native 64px frame (or 128px custom-animation frame) with
// imageSmoothingEnabled = false. GitHub's markdown sanitizer strips inline `style`,
// so `image-rendering: pixelated` is not available in a README; the upscale has to be
// baked into the PNG, and each file's natural pixel size is the size the README shows
// it at. A FRACTIONAL scale — e.g. the old `scale(sheet, 0.28)` thumbnail — resamples
// neighbouring art pixels into blends and produces mushy, smeared output: never do it.
// If a whole 832x3456 sheet will not fit at an integer scale, crop it to the row
// blocks you want to show and upscale those by a whole number instead.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Catalog } from "../src/engine/catalog.js";
import { SpriteEngine } from "../src/engine/sheet.js";
import { normalizeSelections } from "../src/engine/selection.js";
import { getAllCredits, creditsToCsv, creditsToTxt } from "../src/engine/credits.js";
import { findAssetsDir } from "../src/assets-dir.js";
import {
  ANIMATION_CONFIGS,
  BODY_TYPES,
  DIRECTIONS,
  FRAME_SIZE,
  SHEET_HEIGHT,
  SHEET_WIDTH,
} from "../src/engine/constants.js";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  console.error(
    "asset pack is not installed — run `npm run setup-assets`, or set LPC_ASSETS_DIR to a " +
      "clone of Universal-LPC-Spritesheet-Character-Generator.",
  );
  process.exit(1);
}
const OUT_DIR = path.join(import.meta.dirname, "..", "docs", "img");
fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);

// ---------------------------------------------------------------------------
// palette — one dark card language shared by every image
// ---------------------------------------------------------------------------
const INK = {
  bg: "#0e1119",
  card: "#161b28",
  grid: "#1b2233",
  checker: "#131826",
  hairline: "#2b3550",
  title: "#f2f6ff",
  body: "#c9d6f2",
  muted: "#8ea2c9",
  amber: "#f0b25a",
  teal: "#5ad0b0",
};

// ---------------------------------------------------------------------------
// fonts — labels are baked into the PNG, so the family must be registered here.
// Windows-first, then the usual Linux/macOS bold sans candidates. If nothing
// registers we still write every image (art only) and exit non-zero at the end,
// so a docs build can never silently ship an unlabeled banner.
// ---------------------------------------------------------------------------
const FONT_CANDIDATES = {
  bold: [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/tahomab.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ],
  regular: [
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ],
};

function registerFont(candidates, family) {
  for (const file of candidates) {
    try {
      if (GlobalFonts.registerFromPath(file, family)) return file;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const BOLD_FAMILY = "Showcase Bold";
const SANS_FAMILY = "Showcase Sans";
const boldFontPath = registerFont(FONT_CANDIDATES.bold, BOLD_FAMILY);
const sansFontPath = registerFont(FONT_CANDIDATES.regular, SANS_FAMILY);
// A missing regular face is survivable (bold everywhere); a missing bold face is not
// (banner titles would fall back to whatever the canvas bundles), so both cases
// degrade to bold and the font report says which path was used.
const LABEL_FAMILY = boldFontPath ? BOLD_FAMILY : null;
const BODY_FAMILY = sansFontPath ? SANS_FAMILY : LABEL_FAMILY;
const font = (size, emphasis = "body") =>
  `${size}px "${emphasis === "label" ? LABEL_FAMILY : BODY_FAMILY}"`;
const FONTS_AVAILABLE = Boolean(LABEL_FAMILY);

// ---------------------------------------------------------------------------
// drawing primitives — nearest-neighbour only, integer factors only
// ---------------------------------------------------------------------------
function ctxOf(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false; // every draw in this script goes through here
  return ctx;
}

/** Draw src at `factor`x. `factor` must be a positive integer — see the crispness rule. */
function blit(ctx, src, dx, dy, factor, sx = 0, sy = 0, sw = src.width, sh = src.height) {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`non-integer pixel-art scale ${factor} — bake an integer upscale instead`);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, sw * factor, sh * factor);
}

function card(width, height, bg = INK.bg) {
  const canvas = createCanvas(width, height);
  const ctx = ctxOf(canvas);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Sprite-editor checkerboard under a cell, sized in art pixels so it stays on-grid. */
function checker(ctx, x, y, w, h, cellPx, a = INK.checker, b = INK.card) {
  for (let cy = 0; cy < h / cellPx; cy++) {
    for (let cx = 0; cx < w / cellPx; cx++) {
      ctx.fillStyle = (cx + cy) % 2 === 0 ? a : b;
      ctx.fillRect(x + cx * cellPx, y + cy * cellPx, cellPx, cellPx);
    }
  }
}

function text(ctx, str, x, y, { size, color, align = "left", emphasis = "label" }) {
  // With no registered face the canvas would fall back to whatever it bundles, which
  // is neither legible nor portable: draw no labels at all and let the exit code complain.
  if (!FONTS_AVAILABLE) return;
  ctx.font = font(size, emphasis);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}

/** Greedy word wrap measured with the real font, so captions never overflow a cell. */
function wrap(ctx, str, maxWidth, size, emphasis = "body") {
  if (!FONTS_AVAILABLE) return [];
  ctx.font = font(size, emphasis);
  const words = String(str).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// rendering — characters are rendered once and cached by spec, so the same
// selection used by two images is also the same pixels and the same credits.
// ---------------------------------------------------------------------------
/** @type {Map<string, Promise<{selections: object, canvas: import("@napi-rs/canvas").Canvas}>>} */
const renderCache = new Map();

async function renderCharacter(name, spec) {
  const key = JSON.stringify(spec);
  let cached = renderCache.get(key);
  if (!cached) {
    cached = (async () => {
      const bodyType = spec.bodyType ?? "male";
      const selections = normalizeSelections(catalog, bodyType, spec.selections ?? {}, spec.colors ?? {});
      const { canvas, warnings, layout } = await engine.renderCharacter({ bodyType, selections });
      for (const w of warnings) console.error(`[${name}] ${w}`);
      return { name, bodyType, selections, canvas, layout };
    })();
    renderCache.set(key, cached);
  }
  return cached;
}

/** One standard-animation frame (64px) cropped straight out of a rendered sheet. */
function sheetFrame(rendered, animation = "idle", direction = "down", index = 0) {
  return engine.extractFrame(rendered.canvas, animation, direction, index);
}

/** One frame of an appended custom-animation block (64/128/192px) from a sheet. */
function customBlockFrame(rendered, blockName, direction = "down", index = 0) {
  const block = rendered.layout.custom.find((c) => c.name === blockName);
  if (!block) throw new Error(`${rendered.name}: sheet has no custom block "${blockName}"`);
  const row = DIRECTIONS.indexOf(direction);
  if (row < 0) throw new Error(`unknown direction ${direction}`);
  const out = createCanvas(block.frameSize, block.frameSize);
  const ctx = ctxOf(out);
  ctx.drawImage(
    rendered.canvas,
    index * block.frameSize,
    block.yOffset + row * block.frameSize,
    block.frameSize,
    block.frameSize,
    0,
    0,
    block.frameSize,
    block.frameSize,
  );
  return out;
}

// ---------------------------------------------------------------------------
// attribution — every committed render carries its credits, same duty as the
// server's <name>-credits.csv sidecars. Keyed by asset path, sorted, stable.
// ---------------------------------------------------------------------------
const creditRows = new Map(); // fileName -> credit entry

function collectCredits(rendered, animations) {
  for (const animation of animations) {
    for (const credit of getAllCredits(catalog, rendered.selections, rendered.bodyType, animation)) {
      // keep only asset paths that really exist on disk: an animation name the item
      // does not ship would otherwise add a credit row for a file no one drew
      if (creditRows.has(credit.fileName) || !catalog.resolveSprite(`spritesheets/${credit.fileName}`)) continue;
      creditRows.set(credit.fileName, credit);
    }
  }
}

const written = []; // {file, width, height, bytes}

/**
 * Anything the README embeds must also fit the column it is shown in: if the
 * browser has to shrink it, it resamples it and the pixel art goes soft — the
 * exact failure this script exists to prevent. 1250 is the measured computed
 * `max-width` of `.markdown-body` on a live github.com repo page (2026-10-13),
 * not a guess — re-measure it there before raising this number, and never let a
 * README image exceed it. `embed: false` is for files uploaded somewhere else
 * instead (the 1280x640 social preview).
 */
const MAX_EMBED_W = 1250;
function writeImage(fileName, canvas, { embed = true } = {}) {
  if (embed && canvas.width > MAX_EMBED_W) {
    throw new Error(
      `${fileName} is ${canvas.width}px wide; a README-embedded image must stay at or under ` +
        `${MAX_EMBED_W}px so the browser renders it 1:1 instead of resampling it.`,
    );
  }
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(OUT_DIR, fileName), buffer);
  written.push({ file: fileName, width: canvas.width, height: canvas.height, bytes: buffer.length });
}

// ---------------------------------------------------------------------------
// the cast — each entry is a character plus the exact frame used, and the
// caption names the capability that frame proves.
// ---------------------------------------------------------------------------
/**
 * Discovery instead of guessing: resolve an item within a selection group for a
 * body type the way `list_items` does (`Catalog.getItemsByType`), preferring a
 * named item and falling back to the alphabetically first one that exists. Items
 * like the child shirt only exist for one body type, so hard-coding them would
 * break the moment the pack changes; this cannot silently break.
 */
function pick(typeName, bodyType, preferred) {
  const pool = catalog
    .getItemsByType(typeName, bodyType)
    .filter(Boolean)
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (pool.length === 0) {
    throw new Error(`no "${typeName}" item supports body type "${bodyType}" in this pack`);
  }
  if (preferred) {
    const hit = pool.find((i) => i.itemId === preferred || i.name === preferred);
    if (hit) return hit.itemId;
    console.error(
      `[showcase] "${preferred}" is not a ${bodyType} "${typeName}" item any more; using ${pool[0].itemId}`,
    );
  }
  return pool[0].itemId;
}

const CAST = {
  knight: {
    bodyType: "male",
    selections: {
      hair: "Bangs",
      armour: { itemId: "torso_armour_plate", recolor: "lpcr.steel" },
      legs: "legs_armour",
      shoes: "feet_boots_basic",
      shoulders: "shoulders_pauldrons",
      weapon: { itemId: "weapon_sword_arming", variant: "steel" },
      shield: "shield_heater_wood",
      shield_pattern: { itemId: "shield_heater_pattern_barry", recolor: "lpcr.garnet" },
    },
    colors: { body: "light", hair: "dark_brown" },
  },
  archer: {
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "Bangs",
      clothes: "Longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      hat: "Hood",
      weapon: { itemId: "weapon_ranged_bow_recurve", variant: "medium" },
    },
    colors: { body: "amber", hair: "red", clothes: "maroon", eyes: "green" },
  },
  mage: {
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
  teen: {
    bodyType: "teen",
    selections: {
      hair: { itemId: "hair_bangs", recolor: "ulpc.violet" },
      clothes: "Longsleeve",
      legs: "legs_shorts",
      shoes: "feet_shoes_basic",
    },
    colors: { body: "ivory", clothes: "lpcr.sky" },
  },
  child: {
    bodyType: "child",
    selections: {
      // every child-only item is discovered, not guessed: the child body ships a
      // separate, much smaller item set (and no run row, so never build a cell on run)
      head: pick("head", "child", "heads_human_child"),
      hair: pick("hair", "child", "hair_wavy_child"),
      clothes: pick("clothes", "child"),
      legs: pick("legs", "child"),
    },
    // the discovered child shirt ships no recolors, so colors.clothes is not offered
    colors: { body: "peach", hair: "strawberry" },
  },
  brute: {
    bodyType: "muscular",
    selections: {
      hair: pick("hair", "muscular", "hair_afro"),
      // muscular has no torso clothing group at all in the pack — that is the point
      legs: pick("legs", "muscular", "legs_widepants"),
      shoes: pick("shoes", "muscular", "feet_boots_basic"),
      weapon: "tool_axe",
    },
    colors: { body: "bronze", hair: "raven" },
  },
  lizard: {
    bodyType: "male",
    selections: {
      head: "heads_lizard_male",
      expression: "none",
      clothes: "Longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
    },
    colors: { head: "green", clothes: "lpcr.denim" },
  },
  zombie: {
    bodyType: "male",
    selections: {
      head: "heads_zombie",
      expression: "none",
      clothes: "Longsleeve",
      legs: "legs_pants",
      shoes: "feet_sandals",
    },
    colors: { body: "zombie_green", clothes: "lpcr.smoke" },
  },
  samurai: {
    bodyType: "male",
    selections: { hair: "Bangs", clothes: "Longsleeve", weapon: "Katana" },
    colors: { body: "bronze", hair: "black", clothes: "teal" },
  },
  wheelchair: {
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "Bangs",
      // dress_kimono is variant-driven, not recolor-driven: the variant IS the colour
      dress: { itemId: "dress_kimono", variant: "maroon" },
      legs: "none",
      shoes: "none",
      wheelchair: "wheelchair",
    },
    colors: { body: "pale_green", hair: "charcoal" },
  },
};

// Which frame of each character is used where, and which animations the
// attribution pass has to walk to cover it.
const FRAMES = {
  knight_idle: { character: "knight", animation: "idle", direction: "down", index: 0 },
  archer_shoot: { character: "archer", animation: "shoot", direction: "down", index: 0 },
  mage_idle: { character: "mage", animation: "idle", direction: "down", index: 0 },
  teen_idle: { character: "teen", animation: "idle", direction: "down", index: 0 },
  // child clothing ships walk sprites only, so the child cell is a walk frame
  child_walk: { character: "child", animation: "walk", direction: "down", index: 4 },
  brute_idle: { character: "brute", animation: "idle", direction: "down", index: 0 },
  lizard_idle: { character: "lizard", animation: "idle", direction: "down", index: 0 },
  zombie_idle: { character: "zombie", animation: "idle", direction: "down", index: 0 },
  katana_slash128: { character: "samurai", custom: "slash_128", direction: "down", index: 2 },
  wheelchair_block: { character: "wheelchair", custom: "wheelchair", direction: "down", index: 1 },
};

/**
 * Preflight: resolve every cast spec once. An item that left the pack, or a color
 * the chosen item does not offer, fails here with the whole list at once instead
 * of one crash per image.
 */
{
  const problems = [];
  for (const [name, spec] of Object.entries(CAST)) {
    try {
      normalizeSelections(catalog, spec.bodyType ?? "male", spec.selections ?? {}, spec.colors ?? {});
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  }
  if (problems.length) {
    console.error(`[showcase] ${problems.length} cast spec(s) do not resolve against this pack:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`[showcase] cast: ${Object.keys(CAST).length} characters resolve against the pack`);
}

/** Resolve a FRAMES entry to a native-size frame canvas + the scale to use for it. */
async function frameOf(key) {
  const frame = FRAMES[key];
  const rendered = await renderCharacter(frame.character, CAST[frame.character]);
  const canvas = frame.custom
    ? customBlockFrame(rendered, frame.custom, frame.direction, frame.index)
    : sheetFrame(rendered, frame.animation, frame.direction, frame.index);
  collectCredits(rendered, [frame.animation ?? null]);
  return { rendered, frame, canvas, size: canvas.width };
}

const TARGET_PX = 320; // gallery cell size
/**
 * Largest integer scale that keeps a native frame inside a TARGET_PX cell: a 64px
 * frame fills the cell at 5x, a 128px custom-animation frame sits centred in it at
 * 2x. Never a fractional fit — the cell is a layout box, not a resampling target.
 */
function fitFactor(pixelSize) {
  const factor = Math.floor(TARGET_PX / pixelSize);
  if (factor < 1) throw new Error(`frame of ${pixelSize}px does not fit a ${TARGET_PX}px cell`);
  return factor;
}

// ---------------------------------------------------------------------------
// hero.png — README banner: name, tagline, live counts, three characters
// ---------------------------------------------------------------------------
async function buildHero() {
  const keys = ["knight_idle", "archer_shoot", "mage_idle"];
  const labels = ["KNIGHT", "ARCHER", "MAGE"];
  const poses = [];
  for (const key of keys) poses.push(await frameOf(key));

  const SCALE = 5; // 64px art -> 320px, baked; see the crispness rule at the top
  const ART = FRAME_SIZE * SCALE;
  const PAD = 48;
  const GAP = 64; // PAD*2 + ART*3 + GAP*2 = 1184: the width README.md embeds this at
  const HEAD = 152;
  const LABEL_ROW = 56;
  const width = PAD * 2 + ART * 3 + GAP * 2;
  const height = HEAD + ART + LABEL_ROW + PAD;
  const { canvas, ctx } = card(width, height);

  // ground line the sprites stand on, plus a hairline in each gap
  ctx.fillStyle = INK.hairline;
  for (let i = 1; i < 3; i++) {
    ctx.fillRect(PAD + i * (ART + GAP) - GAP / 2, HEAD - 8, 1, ART + 16);
  }
  ctx.fillRect(PAD, HEAD + ART, width - PAD * 2, 2);

  text(ctx, "lpc-spritesheet-mcp", PAD, 66, { size: 50, color: INK.title });
  text(ctx, "Universal LPC spritesheets, composed and rendered headlessly by an MCP server", PAD, 100, {
    size: 20,
    color: INK.teal,
    emphasis: "body",
  });
  const meta = `${catalog.itemsById.size} items · ${BODY_TYPES.length} body types · ` +
    `${Object.keys(ANIMATION_CONFIGS).length} animation row blocks · sheet ${SHEET_WIDTH}×${SHEET_HEIGHT}px`;
  text(ctx, meta, PAD, 128, { size: 17, color: INK.muted, emphasis: "body" });

  // the universal layout as a glyph: 13 columns × 54 rows, one band per row block,
  // drawn as plain rects (no art scaling involved, so any cell size stays crisp)
  const COLS = SHEET_WIDTH / FRAME_SIZE;
  const cellW = 4;
  const cellH = 2;
  const gridW = COLS * cellW;
  const gridX = width - PAD - gridW;
  const gridY = 18;
  ctx.fillStyle = INK.grid;
  ctx.fillRect(gridX, gridY, gridW, 54 * cellH);
  let blockIndex = 0;
  for (const cfg of Object.values(ANIMATION_CONFIGS)) {
    ctx.fillStyle = blockIndex % 2 === 0 ? INK.muted : INK.amber;
    ctx.fillRect(gridX, gridY + cfg.row * cellH, gridW, cfg.num * cellH);
    blockIndex++;
  }
  ctx.fillStyle = INK.grid;
  for (let r = 1; r < 54; r++) ctx.fillRect(gridX, gridY + r * cellH, gridW, 1);

  let x = PAD;
  for (const [i, pose] of poses.entries()) {
    checker(ctx, x, HEAD, ART, ART, 8 * SCALE);
    blit(ctx, pose.canvas, x, HEAD, SCALE);
    text(ctx, labels[i], x + ART / 2, HEAD + ART + 34, { size: 20, color: INK.amber, align: "center" });
    x += ART + GAP;
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// walk-strip.png — one walk playback cycle, 2x, with the source column of each
// frame printed under it (walk ships 9 columns; the cycle plays 1..8)
// ---------------------------------------------------------------------------
async function buildWalkStrip() {
  const rendered = await renderCharacter("brute", CAST.brute);
  collectCredits(rendered, ["walk"]);
  const { canvas: strip, frames } = engine.extractPreviewStrip(rendered.canvas, "walk", "down");
  const SCALE = 2; // eight 64px frames at 2x = 1024px of art, one unbroken row
  const PAD = 20;
  const TOP = 34;
  const LABEL_ROW = 26;
  const cellW = FRAME_SIZE * SCALE;
  const cellH = strip.height * SCALE;
  const width = frames.length * cellW + PAD * 2;
  const height = TOP + PAD + cellH + LABEL_ROW + PAD;
  const { canvas, ctx } = card(width, height);

  text(ctx, "get_preview · walk · down · 8-frame playback cycle", PAD, 22, {
    size: 17,
    color: INK.teal,
  });
  const y = TOP + PAD;
  checker(ctx, PAD, y, frames.length * cellW, cellH, 8 * SCALE);
  blit(ctx, strip, PAD, y, SCALE);
  ctx.fillStyle = INK.hairline;
  for (let i = 1; i < frames.length; i++) ctx.fillRect(PAD + i * cellW, y, 1, cellH);
  for (const [i, frame] of frames.entries()) {
    text(ctx, String(frame), PAD + i * cellW + cellW / 2, height - PAD - 6, {
      size: 14,
      color: INK.muted,
      align: "center",
    });
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// sheet-katana.png — a real generated sheet, cropped to the blocks that make the
// Katana case interesting. No fractional downscale of the 832x3456 canvas (that is
// what made this file mushy before): the standard walk row is drawn at 2x and each
// 128px custom block at 1x, so every displayed cell is 128px and the rows line up
// column-for-column — 9 x 64 x 2 = 9 x 128 = 1152px of art.
// ---------------------------------------------------------------------------
async function buildSheet() {
  const rendered = await renderCharacter("samurai", CAST.samurai);
  collectCredits(rendered, ["walk", "slash", "idle", "walk_128", "slash_128"]);
  const { layout } = rendered;
  const PAD = 32;
  const HEAD = 58;
  const LABEL = 30;
  const ROW_GAP = 14;
  const CELL = 128; // the on-screen height of every strip: 64px at 2x, 128px at 1x

  const STRIPS = [
    {
      label: "walk · standard row block · 64px frames drawn at 2× (no Katana sprite exists here)",
      factor: 2, source: "sheet", animation: "walk",
      columns: 9, frameSize: FRAME_SIZE,
    },
    ...layout.custom.map((block) => ({
      label: `${block.name} · custom block below row 54 · ${block.frameSize}px frames at 1×`,
      factor: 1, source: "custom", name: block.name,
      columns: block.columns, frameSize: block.frameSize,
    })),
  ];

  const artW = Math.max(...STRIPS.map((s) => s.frameSize * s.factor * s.columns));
  const width = PAD * 2 + artW;
  const height = PAD + HEAD + STRIPS.length * (CELL + LABEL) + (STRIPS.length - 1) * ROW_GAP + PAD;
  const { canvas, ctx } = card(width, height);

  const header = `generate_spritesheet → ${rendered.canvas.width}×${rendered.canvas.height}px`;
  text(ctx, header, PAD, 24, { size: 18, color: INK.title });
  text(
    ctx,
    `${SHEET_WIDTH}×${SHEET_HEIGHT} universal grid (13 cols × 54 rows of 64px) + ` +
      `${layout.custom.length} ${layout.custom[0]?.frameSize}px custom-animation blocks appended below row 54`,
    PAD, 46, { size: 15, color: INK.muted, emphasis: "body" },
  );

  let y = PAD + HEAD;
  for (const strip of STRIPS) {
    text(ctx, strip.label, PAD, y + 18, { size: 15, color: INK.teal });
    const artY = y + LABEL;
    const cellPx = strip.frameSize * strip.factor;
    for (let col = 0; col < strip.columns; col++) {
      const src = strip.source === "custom"
        ? customBlockFrame(rendered, strip.name, "down", col)
        : sheetFrame(rendered, strip.animation, "down", col);
      blit(ctx, src, PAD + col * cellPx, artY, strip.factor);
      // the frame box, so an oversize frame reads as a frame and not as a small sprite
      ctx.strokeStyle = INK.hairline;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD + col * cellPx + 0.5, artY + 0.5, cellPx - 1, CELL - 1);
    }
    y = artY + CELL + LABEL / 2 + ROW_GAP;
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// gallery.png — nine characters, nine capabilities, captioned
// ---------------------------------------------------------------------------
const GALLERY = [
  {
    frame: "knight_idle",
    title: "Heraldic shield",
    caption: "shield_pattern barry in lpcr.garnet over shield_heater_wood, steel plate armour",
  },
  {
    frame: "archer_shoot",
    title: "Animation-scoped item",
    caption: "weapon Recurve ships shoot rows only, so this is a shoot frame, not idle",
  },
  {
    frame: "wheelchair_block",
    title: "Custom animation",
    caption: "item wheelchair adds its own 64px block below row 54; cell cropped from it",
  },
  {
    frame: "teen_idle",
    title: "Palette recolor",
    caption: "bodyType teen, hair Bangs at hair.ulpc violet, cloth lpcr sky",
  },
  {
    frame: "child_walk",
    title: "Child body type",
    caption: "heads_human_child; child clothing ships walk sprites only, hence a walk frame",
  },
  {
    frame: "brute_idle",
    title: "Muscular body type",
    caption: "bodyType muscular has no torso clothing at all: bare torso, hair_afro, axe",
  },
  {
    frame: "lizard_idle",
    title: "Non-human head",
    caption: "heads_lizard_male with head palette green; heads_* are ordinary itemIds",
  },
  {
    frame: "zombie_idle",
    title: "Undead + body palette",
    caption: "heads_zombie, body color zombie_green, face layer dropped (upstream gap)",
  },
  {
    frame: "katana_slash128",
    title: "128px weapon block",
    caption: "weapon Katana adds slash_128: 128px frames below row 54, drawn at 2x",
  },
];

async function buildGallery() {
  const cells = [];
  for (const entry of GALLERY) {
    const pose = await frameOf(entry.frame);
    // a 64px frame fills the 320px cell at 5x; a 128px custom-animation frame sits
    // centred in it at 2x. Both are integer multiples of their own source pixel.
    const factor = fitFactor(pose.size);
    cells.push({ entry, pose, factor, drawn: pose.size * factor });
  }

  const PAD = 48;
  const GAP = 48; // PAD*2 + TARGET_PX*3 + GAP*2 = 1152: the width README.md embeds this at
  const HEAD = 58;
  const TEXT_ROW = 78; // title line + up to three caption lines
  const CELL = TARGET_PX + TEXT_ROW;
  const cols = 3;
  const rows = Math.ceil(cells.length / cols);
  const width = PAD * 2 + cols * TARGET_PX + (cols - 1) * GAP;
  const height = PAD + HEAD + rows * CELL + (rows - 1) * GAP + PAD;
  const { canvas, ctx } = card(width, height);

  text(ctx, "Nine characters, nine capabilities", PAD, 24, { size: 21, color: INK.title });
  text(
    ctx,
    "every frame below is drawn at an integer multiple of its native size — `npm run showcase` rebuilds this image",
    PAD, 46, { size: 15, color: INK.muted, emphasis: "body" },
  );

  for (const [i, { entry, pose, factor, drawn }] of cells.entries()) {
    const x = PAD + (i % cols) * (TARGET_PX + GAP);
    const y = PAD + HEAD + Math.floor(i / cols) * (CELL + GAP);
    const off = (TARGET_PX - drawn) / 2;
    ctx.fillStyle = INK.bg;
    ctx.fillRect(x - 1, y - 1, TARGET_PX + 2, CELL + 2);
    checker(ctx, x, y, TARGET_PX, TARGET_PX, 8 * factor);
    blit(ctx, pose.canvas, x + off, y + off, factor);
    if (off) {
      // an oversize frame: show its box so it reads as a 128px frame, not a small sprite
      ctx.strokeStyle = INK.hairline;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + off + 0.5, y + off + 0.5, drawn - 1, drawn - 1);
    }
    text(ctx, entry.title, x, y + TARGET_PX + 24, { size: 17, color: INK.amber });
    const lines = wrap(ctx, entry.caption, TARGET_PX - 4, 14).slice(0, 3);
    lines.forEach((line, n) => {
      text(ctx, line, x, y + TARGET_PX + 44 + n * 16, { size: 14, color: INK.body, emphasis: "body" });
    });
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// social-preview.png — exactly 1280x640, opaque, must survive being shown small
// ---------------------------------------------------------------------------
async function buildSocialPreview() {
  const keys = ["knight_idle", "archer_shoot", "mage_idle"];
  const poses = [];
  for (const key of keys) poses.push(await frameOf(key));

  const WIDTH = 1280;
  const HEIGHT = 640;
  const { canvas, ctx } = card(WIDTH, HEIGHT);
  const SCALE = 5; // 64px frames -> 320px: the largest integer that still fits three
  const ART = FRAME_SIZE * SCALE;
  const GAP = 56;
  const rowW = ART * poses.length + GAP * (poses.length - 1);
  const rowY = HEIGHT - ART - 44;

  checker(ctx, 0, 0, WIDTH, HEIGHT, 32, INK.bg, INK.checker);
  ctx.fillStyle = INK.hairline;
  ctx.fillRect((WIDTH - rowW) / 2 - 24, rowY + ART + 16, rowW + 48, 3);

  text(ctx, "lpc-spritesheet-mcp", WIDTH / 2, 112, { size: 64, color: INK.title, align: "center" });
  text(ctx, "Universal LPC spritesheets from an MCP server — no browser", WIDTH / 2, 158, {
    size: 27, color: INK.teal, align: "center", emphasis: "body",
  });
  text(
    ctx,
    `${catalog.itemsById.size} items · ${BODY_TYPES.length} body types · palette recolor · ${SHEET_WIDTH}×${SHEET_HEIGHT} sheet`,
    WIDTH / 2, 194, { size: 20, color: INK.muted, align: "center", emphasis: "body" },
  );

  let x = (WIDTH - rowW) / 2;
  for (const pose of poses) {
    blit(ctx, pose.canvas, x, rowY, SCALE);
    x += ART + GAP;
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// logo.png — 400x400 emblem, readable at 64px: one knight, no text
// ---------------------------------------------------------------------------
async function buildLogo() {
  const pose = await frameOf("knight_idle");
  const SIZE = 400;
  const ART = 320; // 64px frame at 5x — one sprite, no text, so it survives 64px
  const { canvas, ctx } = card(SIZE, SIZE, INK.bg);
  checker(ctx, 40, 40, SIZE - 80, SIZE - 80, 20, INK.checker, INK.card);
  ctx.fillStyle = INK.amber; // outer frame
  ctx.fillRect(12, 12, SIZE - 24, 4);
  ctx.fillRect(12, SIZE - 16, SIZE - 24, 4);
  ctx.fillRect(12, 12, 4, SIZE - 24);
  ctx.fillRect(SIZE - 16, 12, 4, SIZE - 24);
  ctx.fillStyle = INK.hairline; // inner frame: the sprite cell the character sits in
  ctx.fillRect(40, 40, SIZE - 80, 2);
  ctx.fillRect(40, SIZE - 42, SIZE - 80, 2);
  ctx.fillRect(40, 40, 2, SIZE - 80);
  ctx.fillRect(SIZE - 42, 40, 2, SIZE - 80);
  blit(ctx, pose.canvas, (SIZE - ART) / 2, (SIZE - ART) / 2, ART / FRAME_SIZE);
  return canvas;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
console.log(`asset pack: ${ASSETS_DIR}`);
console.log(`label fonts: bold=${boldFontPath ?? "NONE"} regular=${sansFontPath ?? "NONE"}`);

const hero = await buildHero();
const walkStrip = await buildWalkStrip();
const sheet = await buildSheet();
const gallery = await buildGallery();
const socialPreview = await buildSocialPreview();
const logo = await buildLogo();

writeImage("hero.png", hero);
writeImage("walk-strip.png", walkStrip);
writeImage("sheet-katana.png", sheet);
writeImage("gallery.png", gallery);
writeImage("social-preview.png", socialPreview, { embed: false });
writeImage("logo.png", logo);

const credits = Array.from(creditRows.values()).sort((a, b) => a.fileName.localeCompare(b.fileName));
const csv = creditsToCsv(credits);
const txt = creditsToTxt(credits);
fs.writeFileSync(path.join(OUT_DIR, "showcase-credits.csv"), csv);
fs.writeFileSync(path.join(OUT_DIR, "showcase-credits.txt"), txt);
written.push(
  { file: "showcase-credits.csv", width: 0, height: 0, bytes: Buffer.byteLength(csv) },
  { file: "showcase-credits.txt", width: 0, height: 0, bytes: Buffer.byteLength(txt) },
);

console.log(`\nfiles written to ${OUT_DIR}${path.sep}:`);
for (const entry of written) {
  const dims = entry.width ? `${entry.width}x${entry.height}` : "n/a";
  console.log(`  ${entry.file.padEnd(24)} ${dims.padStart(11)}  ${String(entry.bytes).padStart(9)} B`);
}
console.log(`  attribution: ${credits.length} upstream asset entries covered by the CSV and TXT above`);

if (!FONTS_AVAILABLE) {
  console.error(
    "\nERROR: no bold system font registered (tried Windows, DejaVu, Liberation, Noto, macOS paths).\n" +
      "The images above were written WITHOUT their labels — install a bold sans-serif font and\n" +
      "re-run `npm run showcase`. Failing here keeps an unlabeled banner out of the README.",
  );
  process.exitCode = 1;
} else {
  console.log("\nshowcase images and attribution sidecars are up to date");
}
