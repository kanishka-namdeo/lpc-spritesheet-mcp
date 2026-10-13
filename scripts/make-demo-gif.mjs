#!/usr/bin/env node
// Regenerates docs/img/demo.gif — an animated GIF of a REAL session with the real
// MCP server, for the README.
//
//   npm run demo        (needs the asset pack: `npm run setup-assets`, or LPC_ASSETS_DIR)
//
// What is real and what is authored:
//   - REAL: the sprite pixels, the tool names, every payload value, the server's
//     stderr startup lines, and the credits files. `src/index.js` is spawned as a
//     child process and driven over stdio with the MCP SDK client, exactly like
//     test/mcp-client-test.mjs does. No displayed output text is typed by hand.
//   - AUTHORED: only the timing (how long each frame shows) and the terminal
//     chrome (panel, colors, cursor). Frames are painted with @napi-rs/canvas and
//     encoded with gifenc — no browser and no screenshot tool is involved.
//   - SANITIZED: the payload echoes an absolute `output` path, so displayed paths
//     keep the real basename behind a leading "…". With fixed arguments that makes
//     the same pack re-encode to byte-identical bytes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// gifenc's package main is a CJS bundle, so its named exports are not statically
// analyzable from ESM; take the namespace object instead.
import gifenc from "gifenc";
import { findAssetsDir } from "../src/assets-dir.js";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const REPO = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(REPO, "docs", "img");
const GIF_PATH = path.join(OUT_DIR, "demo.gif");
const POSTER_PATH = path.join(OUT_DIR, "demo-poster.png");
const CREDITS_CSV = path.join(OUT_DIR, "demo-credits.csv");
const CREDITS_TXT = path.join(OUT_DIR, "demo-credits.txt");

// ---------------------------------------------------------------------------
// The recorded session. These are the only arguments the server gets, and the
// rendered request text is generated from this object, never re-typed. Chosen
// because it renders with an empty `warnings` array and a legible side-on walk
// cycle, and because `scale: 2` keeps every cell an integer multiple of the
// 64px LPC frame.
// ---------------------------------------------------------------------------
const RENDER_BASENAME = "hooded-walk.png";
const PREVIEW_ARGS = {
  bodyType: "female",
  selections: {
    head: "heads_human_female",
    hair: "Bangs",
    clothes: "Longsleeve",
    legs: "Pants",
    shoes: "feet_boots_basic",
    hat: "Hood",
  },
  colors: { body: "amber", hair: "red", clothes: "teal", eyes: "green" },
  animation: "walk",
  direction: "right",
  scale: 2,
};

// ---------------------------------------------------------------------------
// Panel geometry. Every sprite pixel is drawn at an integer multiple of the
// server's cell, and the server's cell is an integer multiple of 64px.
// ---------------------------------------------------------------------------
const W = 880;
const H = 560;
const HEADER_H = 30;
const PAD = 14;
const FONT_PX = 15;
const LINE_H = 19;
const CELL_PX = 64 * PREVIEW_ARGS.scale; // what get_preview must return
const DISPLAY_SCALE = 2; // 128px cell -> 256px on screen
const STAGE_PAD = 12;
const STAGE_BOX = CELL_PX * DISPLAY_SCALE + STAGE_PAD * 2;
const CAPTION_LINES = 3;
const CAPTION_PITCH = 19;
const STAGE_BLOCK = STAGE_BOX + 12 + CAPTION_LINES * CAPTION_PITCH + 16; // box + captions + ticks
const TEXT_X = PAD + 4;
const TEXT_Y = HEADER_H + 22;
const TEXT_H = H - PAD - TEXT_Y;
const MAX_LINES = Math.floor(TEXT_H / LINE_H);
const STAGE_X = W - PAD - STAGE_BOX;
const STAGE_Y = TEXT_Y + Math.max(0, Math.floor((TEXT_H - STAGE_BLOCK) / 2));

const MAX_TOTAL_MS = 6000;
const MAX_GIF_BYTES = 1024 * 1024;

// Terminal theme. These exact colors are forced into the GIF palette so text
// never drifts; only sprite pixels go through the quantizer.
const C = {
  bg: "#0d1117",
  header: "#1b2333",
  panel: "#12161f",
  border: "#2a3346",
  fg: "#d5dbe6",
  green: "#7ee787",
  violet: "#d2a8ff",
  blue: "#79b8ff",
  dim: "#7c8698",
  amber: "#ffdf7e",
};
const TEXT_W = STAGE_X - 12 - TEXT_X;

// ---------------------------------------------------------------------------
// Real session over stdio
// ---------------------------------------------------------------------------

/** Displayed form of a server-echoed absolute path: portable, still the real name. */
function portable(p) {
  return `…/${path.basename(String(p))}`;
}

async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const payload = JSON.parse(text);
  if (res.isError) throw new Error(`Tool "${name}" returned an error: ${text}`);
  return payload;
}

/** Spawn the actual server and record what it really says. */
async function recordSession(assetsDir, scratchDir) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, "src", "index.js")],
    stderr: "pipe",
    // StdioClientTransport inherits only a small env allowlist, so the child
    // loses LPC_ASSETS_DIR and would exit at startup without this.
    env: { LPC_ASSETS_DIR: assetsDir },
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const client = new Client({ name: "lpc-demo-gif", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const layout = await callTool(client, "list_animations", {});
    const preview = await callTool(client, "get_preview", {
      ...PREVIEW_ARGS,
      include_credits: true,
      output_path: path.join(scratchDir, RENDER_BASENAME),
    });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let stderr flush
    // The startup banner echoes the absolute pack path, so any line carrying a
    // machine-specific path is dropped rather than displayed.
    const stderr = stderrChunks
      .join("")
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() && !l.includes(assetsDir));
    return { toolNames: tools.map((t) => t.name), layout, preview, stderr };
  } finally {
    await client.close();
  }
}

/** Read creditsToTxt() output back into structured entries (real bytes on disk). */
function parseCreditsTxt(txt) {
  const entries = [];
  let current = null;
  let section = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (!line.startsWith("\t")) {
      current = { file: line, licenses: [], authors: [] };
      entries.push(current);
      section = null;
    } else if (!line.startsWith("\t\t")) {
      section = line.includes("Licenses") ? "licenses" : line.includes("Authors") ? "authors" : null;
    } else if (current && section) {
      current[section].push(line.replace(/^\t\t- /, "").trim());
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Font: pick a monospace family that is actually installed. Deliberately no
// absolute font file paths (the showcase script's wart), and never a hard
// failure: the generic fallback is still checked for clipping below.
// ---------------------------------------------------------------------------
const MONO_CANDIDATES = [
  "Cascadia Mono",
  "Consolas",
  "JetBrains Mono",
  "Roboto Mono",
  "Lucida Console",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Menlo",
  "Courier New",
  "monospace",
];

function pickMonospace(ctx) {
  for (const family of MONO_CANDIDATES) {
    ctx.font = `${FONT_PX}px "${family}"`;
    const i = ctx.measureText("i").width;
    if (i > 0 && i === ctx.measureText("W").width) return family;
  }
  return "monospace";
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

/** Word-wrap `text` to at most `cols` characters, hard-breaking unbreakable runs. */
function wrap(text, cols) {
  const out = [];
  let cur = "";
  for (const word of text.split(/(?<=\s)/)) {
    let rest = word;
    while (rest.length > cols) {
      if (cur) {
        out.push(cur.trimEnd());
        cur = "";
      }
      out.push(rest.slice(0, cols));
      rest = rest.slice(cols);
    }
    if ((cur + rest).trimEnd().length > cols && cur) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += rest;
  }
  out.push(cur.trimEnd());
  return out.filter((l) => l.length);
}

function makeLayout() {
  const ctx = createCanvas(8, 8).getContext("2d");
  const family = pickMonospace(ctx);
  const font = `${FONT_PX}px "${family}"`;
  ctx.font = font;
  const advance = ctx.measureText("M").width;
  return {
    family,
    font,
    advance,
    cols: Math.max(8, Math.floor(TEXT_W / advance)),
    measure: (s) => {
      ctx.font = font;
      return ctx.measureText(s).width;
    },
  };
}

/**
 * Builds the frame list. `lines` is the whole script; each frame records how many
 * lines are on screen and how much of the last one is revealed, so both typing
 * and output arrival animate.
 */
function makeTimeline(layout) {
  const lines = [];
  const frames = [];
  let stage = null;

  function pushLine(prefix, prefixColor, text, color) {
    lines.push({ parts: [{ text: prefix, color: prefixColor }, { text, color }] });
    return lines.length - 1;
  }
  function snap(delay, { chars = null, cursorOn = true } = {}) {
    if (lines.length) frames.push({ count: lines.length, chars, stage, cursorOn, delay });
  }

  return {
    lines,
    frames,
    /** Type a request line out in chunks: at most 5 keystroke frames per line. */
    type(prefix, prefixColor, text, color, chunk, delay) {
      for (const [i, phys] of wrap(text, layout.cols - prefix.length).entries()) {
        const indent = i === 0 ? prefix : " ".repeat(prefix.length);
        const idx = pushLine(indent, prefixColor, phys, color);
        const step = Math.max(chunk, Math.ceil(phys.length / 5));
        for (let n = step; n < phys.length; n += step) snap(delay, { chars: { line: idx, n } });
        snap(Math.max(20, Math.round(delay / 2)));
      }
    },
    /** Reveal real output, one wrapped line per frame. `cell` also steps the stage. */
    out(text, color, delay, prefix = "->  ", cell) {
      const phys = wrap(text, layout.cols - prefix.length);
      for (const [i, chunk] of phys.entries()) {
        pushLine(i === 0 ? prefix : " ".repeat(prefix.length), C.dim, chunk, color);
        if (cell !== undefined && i === phys.length - 1) stage = cell;
        snap(delay);
      }
    },
    /** Point the stage at a cell index (null = nothing rendered yet). */
    setStage(cell, delay = 120) {
      stage = cell;
      snap(delay);
    },
    hold(delay, { cursorOn = true } = {}) {
      snap(delay, { cursorOn });
    },
  };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function drawText(ctx, layout, tl, frame) {
  ctx.font = layout.font;
  ctx.textBaseline = "top";
  let endX = TEXT_X;
  for (let i = 0; i < frame.count; i++) {
    const line = tl.lines[i];
    const partial = frame.chars && frame.chars.line === i ? frame.chars.n : null;
    let x = TEXT_X;
    for (const [p, part] of line.parts.entries()) {
      const text = partial !== null && p === 1 ? part.text.slice(0, partial) : part.text;
      if (!text) continue;
      ctx.fillStyle = part.color;
      ctx.fillText(text, x, TEXT_Y + i * LINE_H);
      x += ctx.measureText(text).width;
    }
    endX = x;
  }
  return endX;
}

function drawStage(ctx, strip, o) {
  const inner = o.cellPx * DISPLAY_SCALE;
  // A solid panel, not a checkerboard: a 16px checker is ~10k LZW runs per frame
  // and would double the GIF for no information gain.
  ctx.fillStyle = C.panel;
  ctx.fillRect(STAGE_X, STAGE_Y, STAGE_BOX, STAGE_BOX);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(STAGE_X + 0.5, STAGE_Y + 0.5, STAGE_BOX - 1, STAGE_BOX - 1);

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.font = `${FONT_PX}px "${o.family}"`;
  const cx = STAGE_X + STAGE_BOX / 2;
  if (o.stage === null) {
    ctx.fillStyle = C.dim;
    ctx.fillText("awaiting render", cx, STAGE_Y + STAGE_BOX / 2 - FONT_PX / 2);
  } else {
    // One real cell of the real PNG, integer nearest-neighbor upscale.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(strip, o.stage * o.cellPx, 0, o.cellPx, o.cellPx, STAGE_X + STAGE_PAD, STAGE_Y + STAGE_PAD, inner, inner);
  }

  let y = STAGE_Y + STAGE_BOX + 12;
  for (const line of o.caption) {
    ctx.fillStyle = line.color;
    const w = ctx.measureText(line.text).width;
    if (w > STAGE_BOX) {
      throw new Error(`Stage caption overflows: "${line.text}" is ${w.toFixed(1)}px > ${STAGE_BOX}px`);
    }
    ctx.fillText(line.text, cx, y);
    y += CAPTION_PITCH;
  }
  // Ticks sit on a fixed anchor so the layout never shifts when the stage is empty.
  const tickY = STAGE_Y + STAGE_BOX + 12 + CAPTION_LINES * CAPTION_PITCH + 4;
  if (o.stage !== null) {
    const tickW = Math.floor((STAGE_BOX - (o.frameCount - 1) * 4) / o.frameCount);
    for (let i = 0; i < o.frameCount; i++) {
      ctx.fillStyle = i === o.stage ? C.amber : C.border;
      ctx.fillRect(STAGE_X + i * (tickW + 4), tickY, tickW, 8);
    }
  }
  ctx.textAlign = "left";
}

function renderFrame(strip, layout, tl, frame, chrome) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = C.header;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.textBaseline = "middle";
  ctx.font = `${FONT_PX}px "${layout.family}"`;
  ctx.fillStyle = C.fg;
  ctx.fillText(chrome.title, PAD, HEADER_H / 2 + 1);
  const titleW = ctx.measureText(chrome.title).width;
  ctx.fillStyle = C.dim;
  const rightW = ctx.measureText(chrome.headerRight).width;
  if (PAD + titleW + 16 + PAD + rightW > W) {
    throw new Error(`Header bar overflows: "${chrome.title}" + "${chrome.headerRight}" exceed ${W}px`);
  }
  ctx.fillText(chrome.headerRight, W - PAD - rightW, HEADER_H / 2 + 1);

  const caretX = drawText(ctx, layout, tl, frame);
  if (frame.cursorOn) {
    ctx.fillStyle = C.fg;
    ctx.fillRect(caretX + 2, TEXT_Y + (frame.count - 1) * LINE_H + 3, 8, FONT_PX - 4);
  }
  drawStage(ctx, strip, { ...chrome, family: layout.family, stage: frame.stage });
  return canvas;
}

// ---------------------------------------------------------------------------
// GIF encoding
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * One global palette for the whole animation. The UI colors are pinned so text
 * never drifts; the rest is quantized from every sprite cell flattened onto the
 * stage panel, i.e. only colors that can actually appear on screen.
 */
function buildPalette(strip, cellPx, frameCount) {
  const inner = cellPx * DISPLAY_SCALE;
  const ref = createCanvas(inner, inner * frameCount);
  const ctx = ref.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, ref.width, ref.height);
  for (let i = 0; i < frameCount; i++) {
    ctx.drawImage(strip, i * cellPx, 0, cellPx, cellPx, 0, i * inner, inner, inner);
  }
  const spriteColors = quantize(
    ctx.getImageData(0, 0, ref.width, ref.height).data,
    256 - Object.keys(C).length,
    { format: "rgb565" },
  );
  return [...Object.values(C).map(hexToRgb), ...spriteColors];
}

/**
 * Hard-snap every pixel outside the sprite rect to one of the UI colors. Skia
 * anti-aliases glyphs, and a GIF full of per-glyph blend colors costs about half
 * again as much as the same panel with terminal-crisp two-tone text - which also
 * looks right for a terminal.
 */
function snapUiRegion(data, uiColors, skip) {
  const cache = new Map();
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const x = p % W;
    const y = (p / W) | 0;
    if (x >= skip[0] && x < skip[0] + skip[2] && y >= skip[1] && y < skip[1] + skip[3]) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let hit = cache.get(key);
    if (hit === undefined) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < uiColors.length; c++) {
        const [r, g, b] = uiColors[c];
        const d = (r - data[i]) ** 2 + (g - data[i + 1]) ** 2 + (b - data[i + 2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      hit = best;
      cache.set(key, hit);
    }
    const [r, g, b] = uiColors[hit];
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

function encodeGif(painted, palette) {
  const gif = GIFEncoder();
  for (const { canvas, delay } of painted) {
    const { data } = canvas.getContext("2d").getImageData(0, 0, W, H);
    const index = applyPalette(data, palette, "rgb565");
    gif.writeFrame(index, W, H, { palette, delay, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Replace any absolute path with a portable ellipsis (defensive; usually a no-op). */
function scrub(text, dirs) {
  let out = text;
  for (const dir of dirs) {
    if (!dir) continue;
    out = out.split(dir).join("…");
    const alt = dir.split(path.sep).join("/");
    if (alt !== dir) out = out.split(alt).join("…");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const assetsDir = findAssetsDir();
  if (!assetsDir) {
    throw new Error(
      "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
    );
  }
  console.log(`asset pack: ${assetsDir}`);

  // The render is scratch, so it stays outside the repo; docs/img is the only
  // tracked place this script writes.
  const scratchDir = path.join(os.tmpdir(), "lpc-spritesheet-mcp-demo-scratch");
  fs.rmSync(scratchDir, { recursive: true, force: true });
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("recording a real session against src/index.js (stdio) ...");
  const { toolNames, layout: animLayout, preview, stderr } = await recordSession(assetsDir, scratchDir);
  console.log(`  tools/list -> ${toolNames.length} tools: ${toolNames.join(", ")}`);
  console.log(`  tools/call -> list_animations, get_preview (${portable(preview.output)})`);

  // Guard so the GIF can only claim what actually happened.
  const cellPx = preview.image.frameSize;
  if (cellPx !== CELL_PX) {
    throw new Error(`get_preview returned frameSize ${cellPx}, expected ${CELL_PX} for scale ${PREVIEW_ARGS.scale}`);
  }
  if (preview.image.height !== cellPx || preview.frames.length * cellPx !== preview.image.width) {
    throw new Error(
      `strip ${preview.image.width}x${preview.image.height} is not ${preview.frames.length} cells of ${cellPx}px`,
    );
  }
  const strip = await loadImage(fs.readFileSync(preview.output));
  if (strip.width !== preview.image.width || strip.height !== preview.image.height) {
    throw new Error("Rendered PNG on disk disagrees with the payload image size");
  }
  // The GIF shows upstream art, so it must ship the attribution the server wrote.
  if (!preview.credits?.csv || !preview.credits?.txt) {
    throw new Error("get_preview returned no credits payload; a render of upstream art without attribution is a licensing regression");
  }

  const creditEntries = parseCreditsTxt(fs.readFileSync(preview.credits.txt, "utf8"));
  const licenses = [...new Set(creditEntries.flatMap((e) => e.licenses))];
  const authors = [...new Set(creditEntries.flatMap((e) => e.authors))];
  const walkRow = animLayout.standard[preview.animation];

  // --- the script: typed requests, revealed real responses -----------------
  const layout = makeLayout();
  const tl = makeTimeline(layout);

  tl.type("$ ", C.green, "node src/index.js", C.fg, 5, 60);
  for (const line of stderr) tl.out(line, C.blue, 140, "");
  tl.type("> ", C.violet, "tools/list", C.fg, 4, 50);
  tl.out(`tools: ${toolNames.join(", ")}`, C.fg, 140);
  tl.type("> ", C.violet, "tools/call list_animations {}", C.fg, 7, 40);
  tl.out(
    `${preview.animation}: row ${walkRow.row}, ${walkRow.frames} frames x ${walkRow.directionRows} facings, cycle [${walkRow.cycle.join(",")}]`,
    C.fg,
    140,
  );
  tl.type("> ", C.violet, "tools/call get_preview", C.fg, 6, 40);
  // The argument object is long, so it appears as a pasted block rather than
  // keystroke by keystroke - still the exact bytes the server received.
  tl.out(JSON.stringify(PREVIEW_ARGS), C.fg, 95, "    ");
  const responses = [
    { text: `output ${portable(preview.output)}`, color: C.fg },
    { text: `image ${preview.image.width}x${preview.image.height}, frameSize ${cellPx}, scale ${preview.scale}`, color: C.fg },
    { text: `frames [${preview.frames.join(",")}], direction ${preview.direction}`, color: C.fg },
    { text: `warnings ${JSON.stringify(preview.warnings)}`, color: preview.warnings.length ? C.amber : C.fg },
    { text: `credits ${portable(preview.credits.csv)} + .txt, ${preview.credits.entries} files`, color: C.fg },
    { text: `attribution: ${authors.length} authors, ${licenses.length} licenses (${licenses.join(", ")})`, color: C.amber },
  ];
  const cells = preview.frames.length;
  responses.forEach((r, i) => {
    // The sprite starts cycling on the frame that reports `output`: the render is
    // real the moment it is named, and the walk keeps stepping while the rest of
    // the payload arrives.
    tl.out(r.text, r.color, 110, "->  ", i % cells);
  });
  for (let i = 0; i < cells; i++) tl.setStage((responses.length + i) % cells, 120);
  tl.setStage(0, 280); // settle on the first cell of the cycle
  tl.hold(400, { cursorOn: false });

  // Fail loudly rather than ship clipped text.
  const tooWide = [];
  for (const line of tl.lines) {
    const flat = line.parts.map((p) => p.text).join("");
    const width = layout.measure(flat);
    if (width > TEXT_W) tooWide.push(`"${flat}" (${width.toFixed(1)}px)`);
  }
  if (tooWide.length) {
    throw new Error(
      `Text would be clipped in the ${TEXT_W}px column (font "${layout.family}", ${tl.lines.length} lines): ${tooWide.join(", ")}`,
    );
  }
  if (tl.lines.length > MAX_LINES) {
    throw new Error(
      `Script needs ${tl.lines.length} lines but the panel fits ${MAX_LINES} (font "${layout.family}", ${layout.advance.toFixed(2)}px advance)`,
    );
  }

  // Nothing about the cycle is captioned before it exists: the stage stays bare
  // until the render actually arrives.
  const captionFor = (stage) =>
    stage === null
      ? []
      : [
          { text: `get_preview ${preview.animation}`, color: C.fg },
          { text: `${preview.direction} - scale ${preview.scale}`, color: C.dim },
          { text: `cell ${stage + 1}/${preview.frames.length} (col ${preview.frames[stage]})`, color: C.dim },
        ];
  const chrome = {
    title: "lpc-spritesheet-mcp",
    headerRight: "MCP server over stdio",
    cellPx,
    frameCount: preview.frames.length,
  };

  console.log(`painting ${tl.frames.length} frames at ${W}x${H} with font "${layout.family}" ...`);
  const painted = tl.frames.map((frame) => ({
    canvas: renderFrame(strip, layout, tl, frame, { ...chrome, caption: captionFor(frame.stage) }),
    delay: frame.delay,
  }));

  const totalMs = painted.reduce((s, f) => s + f.delay, 0);
  if (totalMs > MAX_TOTAL_MS) throw new Error(`Animation is ${totalMs}ms; budget is ${MAX_TOTAL_MS}ms`);

  // Snap the chrome to the theme before encoding, so the GIF and the poster show
  // exactly the same pixels. Only the sprite rect keeps its anti-aliased blends.
  const uiColors = Object.values(C).map(hexToRgb);
  const spriteRect = [
    STAGE_X + STAGE_PAD,
    STAGE_Y + STAGE_PAD,
    CELL_PX * DISPLAY_SCALE,
    CELL_PX * DISPLAY_SCALE,
  ];
  for (const frame of painted) {
    const ctx = frame.canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, W, H);
    snapUiRegion(img.data, uiColors, spriteRect);
    ctx.putImageData(img, 0, 0);
  }

  const palette = buildPalette(strip, cellPx, preview.frames.length);
  if (palette.length > 256) throw new Error(`Palette has ${palette.length} colors (>256)`);
  const bytes = encodeGif(painted, palette);
  if (bytes.length >= MAX_GIF_BYTES) {
    throw new Error(`demo.gif is ${bytes.length} bytes; budget is ${MAX_GIF_BYTES} - trim frames or the panel`);
  }
  fs.writeFileSync(GIF_PATH, bytes);

  // Poster = the final frame as a still (non-animated README fallback).
  const poster = painted[painted.length - 1].canvas;
  const posterPng = poster.toBuffer("image/png");
  fs.writeFileSync(POSTER_PATH, posterPng);

  // --- attribution: the server's own credit files, verbatim ----------------
  const rawCsv = fs.readFileSync(preview.credits.csv, "utf8");
  const rawTxt = fs.readFileSync(preview.credits.txt, "utf8");
  const dirs = [scratchDir, assetsDir, path.dirname(preview.output)];
  const csv = scrub(rawCsv, dirs);
  const txt = scrub(rawTxt, dirs);
  if (csv !== rawCsv || txt !== rawTxt) {
    console.log("note: an absolute path was scrubbed out of the credits sidecars");
  }
  fs.writeFileSync(CREDITS_CSV, csv);
  fs.writeFileSync(CREDITS_TXT, txt);
  fs.rmSync(scratchDir, { recursive: true, force: true });

  const rel = (p) => path.relative(REPO, p);
  console.log(
    `wrote ${rel(GIF_PATH)}: ${W}x${H}, ${painted.length} frames, ${totalMs}ms, ` +
      `${bytes.length} bytes, loops forever`,
  );
  console.log(`wrote ${rel(POSTER_PATH)}: ${poster.width}x${poster.height}, ${posterPng.length} bytes`);
  console.log(
    `wrote ${rel(CREDITS_CSV)}: ${creditEntries.length} asset rows, ${Buffer.byteLength(csv)} bytes`,
  );
  console.log(
    `wrote ${rel(CREDITS_TXT)}: ${creditEntries.length} assets, ${authors.length} authors, ` +
      `${Buffer.byteLength(txt)} bytes (licenses: ${licenses.join(", ")})`,
  );
}

main().catch((err) => {
  console.error(`[make-demo-gif] FAILED: ${err?.stack || err}`);
  process.exitCode = 1;
});
