// Animated-GIF encoding for spritesheet preview strips (64px pixel-art frames,
// possibly upscaled, transparent background). The repo's other GIF producer,
// scripts/make-demo-gif.mjs, bakes an opaque terminal panel behind the sprite
// and so can quantize plain RGB. Sprites have transparent backgrounds, so this
// module carries alpha end to end:
//
//   1. quantize() with { format: "rgba4444", oneBitAlpha: true } keeps alpha in
//      the palette and snaps every alpha to 0 or 255; gifenc's clearAlpha
//      default additionally zeroes the RGB of transparent entries, so ALL
//      transparent pixels collapse onto one [0, 0, 0, 0] palette entry.
//   2. applyPalette(data, palette, "rgba4444") maps each pixel to its nearest
//      palette entry in RGBA space — transparent pixels land on that entry.
//   3. writeFrame() gets { transparent: true, transparentIndex } so the graphic
//      control extension flags the entry as this frame's transparent color.
//      GIF color tables are RGB-only; transparency lives in the GCE, not in
//      the palette bytes.
//
// The output is deterministic: gifenc is pure computation and this module adds
// no randomness, dates, or environment-dependent values, so the same input
// canvases always re-encode to byte-identical GIF89a bytes.

// gifenc's package main is a CJS bundle, so its named exports are not
// statically analyzable from ESM; take the namespace object instead (same
// pattern as scripts/make-demo-gif.mjs).
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const DEFAULT_MAX_COLORS = 255; // GIF caps a color table at 256 entries; keep one slot free
const DEFAULT_DELAY_MS = 100;
const MAX_DELAY_MS = 655350; // the GIF delay field is 16-bit centiseconds

// See the header comment: rgba4444 + oneBitAlpha (+ gifenc's clearAlpha
// default) is what makes 1-bit transparency land in a single palette entry.
const QUANTIZE_OPTS = { format: "rgba4444", oneBitAlpha: true };

/** Human-safe type name for TypeError messages. */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Validate and return frame i's canvas, or throw a TypeError naming the exact
 * problem. Frames may be of any (positive) size — GIF supports per-frame
 * dimensions — but a frame without a real canvas cannot be encoded.
 */
function requireCanvas(frame, index) {
  const where = `encodeAnimatedGif: frames[${index}]`;
  if (frame === null || typeof frame !== "object" || Array.isArray(frame)) {
    throw new TypeError(`${where} must be an object like { canvas, delayMs? }, got ${describe(frame)}`);
  }
  const { canvas } = frame;
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError(`${where}.canvas is missing — each frame needs a @napi-rs/canvas canvas, got ${describe(canvas)}`);
  }
  if (typeof canvas.width !== "number" || !(canvas.width > 0) || typeof canvas.height !== "number" || !(canvas.height > 0)) {
    throw new TypeError(`${where}.canvas has no positive width/height (${canvas.width}x${canvas.height})`);
  }
  return canvas;
}

/** maxColors default 255; must stay an integer in [1, 256] (GIF table cap). */
function normalizeMaxColors(raw) {
  if (raw === undefined || raw === null) return DEFAULT_MAX_COLORS;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 256) {
    throw new TypeError(
      `encodeAnimatedGif: opts.maxColors must be an integer between 1 and 256, got ${describe(raw)}`,
    );
  }
  return raw;
}

/** Per-frame delay in ms: default 100, non-numeric falls back to the default,
 *  and the value is clamped to what the 16-bit centisecond field can hold. */
function frameDelayMs(delayMs) {
  const n = delayMs === undefined || delayMs === null ? DEFAULT_DELAY_MS : Number(delayMs);
  if (!Number.isFinite(n)) return DEFAULT_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(0, n));
}

/** Count distinct RGBA colors — the retry budget for quantizeFrame(). */
function countUniqueRgba(data) {
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    seen.add(((data[i + 3] << 24) | (data[i + 2] << 16) | (data[i + 1] << 8) | data[i]) >>> 0);
  }
  return seen.size;
}

/**
 * Quantize one frame to an RGBA palette. Frames with fewer colors than
 * maxColors are fine (the quantizer just returns fewer entries), but the PNN
 * merger can still refuse exotic tiny inputs at a large color budget — in
 * that case retry once at the frame's true unique-color count.
 */
function quantizeFrame(data, maxColors) {
  try {
    return quantize(data, maxColors, QUANTIZE_OPTS);
  } catch (err) {
    const unique = countUniqueRgba(data);
    if (unique >= 1 && unique < maxColors) return quantize(data, unique, QUANTIZE_OPTS);
    throw err;
  }
}

/**
 * Index of the transparent palette entry, or -1 when the frame is fully
 * opaque. With oneBitAlpha + clearAlpha there is at most one entry whose
 * alpha byte is 0 (every transparent color collapses to [0, 0, 0, 0]), and
 * applyPalette maps transparent pixels onto it, so that is the index to flag.
 */
function transparentIndexOf(palette) {
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if (color.length >= 4 && color[3] === 0) return i;
  }
  return -1;
}

/**
 * Encode canvas frames into a looping animated GIF.
 * @param {Array<{canvas: import("@napi-rs/canvas").Canvas, delayMs?: number}>} frames
 *   Each canvas is one animation frame (RGBA, alpha preserved). delayMs default 100.
 * @param {{ maxColors?: number }} [opts] maxColors default 255 (one slot kept
 *   free under GIF's hard 256-entry table cap)
 * @returns {Buffer} GIF89a bytes: infinite loop (NETSCAPE2.0 repeat 0),
 *   per-frame palettes, transparency preserved via each frame's GCE
 * @throws {TypeError} if frames is not a non-empty array, a frame's canvas is
 *   missing or has no positive width/height, or maxColors is out of range
 */
export function encodeAnimatedGif(frames, opts = {}) {
  if (!Array.isArray(frames)) {
    throw new TypeError(
      `encodeAnimatedGif: frames must be an array of { canvas, delayMs? } objects, got ${describe(frames)}`,
    );
  }
  if (frames.length === 0) {
    throw new TypeError("encodeAnimatedGif: frames must contain at least one frame");
  }
  const maxColors = normalizeMaxColors((opts ?? {}).maxColors);

  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const canvas = requireCanvas(frame, i);
    const { width, height } = canvas;
    const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
    const palette = quantizeFrame(data, maxColors);
    const index = applyPalette(data, palette, "rgba4444");
    const transparentIndex = transparentIndexOf(palette);
    gif.writeFrame(index, width, height, {
      // Per-frame color table: frame 0's palette becomes the global table,
      // later frames get local tables (their colors differ per frame).
      palette,
      delay: frameDelayMs(frame.delayMs),
      // Flag transparency only when a transparent entry exists — pointing the
      // flag at a real color would render that color invisible.
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      // The NETSCAPE2.0 loop extension rides the first frame; repeat 0 loops forever.
      ...(i === 0 ? { repeat: 0 } : {}),
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/**
 * Convert a playback rate into a GIF frame delay in milliseconds.
 * The GIF spec's minimum delay is 20ms and browsers promote anything lower to
 * 100ms, so the result is clamped to [20, 1000].
 * @param {number} [fps] frames per second, default 10
 * @returns {number} delay in ms
 * @throws {TypeError} if fps is not a positive number
 */
export function gifFrameDelay(fps = 10) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n <= 0) {
    throw new TypeError(`gifFrameDelay: fps must be a positive number, got ${describe(fps)}`);
  }
  return Math.min(1000, Math.max(20, Math.round(1000 / n)));
}
