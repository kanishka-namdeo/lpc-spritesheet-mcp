// Tests for src/engine/gif.js — the transparent animated-GIF encoder.
// Fixtures are tiny synthetic canvases built with @napi-rs/canvas; the asset
// pack is not needed (unlike the render tests, this is a pure codec check).
import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { encodeAnimatedGif, gifFrameDelay } from "../src/engine/gif.js";

// ---------------------------------------------------------------------------
// Fixtures: transparent surround + solid color squares, like sprite frames.
// Pure primaries survive gifenc's rgba4444 rounding exactly.
// ---------------------------------------------------------------------------

function squareFrame(size, color, x = 16, y = 16, w = 32, h = 32) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  return canvas; // everything outside the square stays fully transparent
}

/** 8x8 frame with exactly three colors + transparency (the tiny-palette case). */
function tinyFrame() {
  const canvas = createCanvas(8, 8);
  const ctx = canvas.getContext("2d");
  for (const [color, x, y] of [["#00ff00", 1, 1], ["#ffff00", 4, 1], ["#ff00ff", 1, 4]]) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 2, 2);
  }
  return canvas;
}

/** Fresh frames each call: identical content, distinct canvas objects. */
function makeFrames() {
  return [
    { canvas: squareFrame(64, "#ff0000") }, // delayMs default 100
    { canvas: squareFrame(64, "#0000ff"), delayMs: 250 },
    { canvas: tinyFrame(), delayMs: 60 },
  ];
}

// ---------------------------------------------------------------------------
// Minimal GIF89a walker: counts image descriptors and returns each frame's
// graphic-control extension plus where its color table lives. It only walks
// block boundaries — never decodes pixels — and throws on unknown blocks.
// ---------------------------------------------------------------------------

function parseGif(buf) {
  let i = 6; // header "GIF89a"
  const screen = {
    width: buf[i] | (buf[i + 1] << 8),
    height: buf[i + 2] | (buf[i + 3] << 8),
    packed: buf[i + 4],
  };
  i += 7; // logical screen descriptor
  let gctSize = 0;
  const gctOffset = i;
  if (screen.packed & 0x80) {
    gctSize = 2 << (screen.packed & 0x07); // entries = 2^(sizeField+1)
    i += gctSize * 3;
  }
  const frames = [];
  let gce = null;
  while (i < buf.length) {
    const block = buf[i++];
    if (block === 0x3b) return { screen, frames }; // trailer
    if (block === 0x21) {
      // extension: label, then sub-blocks until a 0x00 terminator
      const label = buf[i++];
      let size = buf[i++];
      const payload = [];
      while (size !== 0) {
        payload.push(...buf.subarray(i, i + size));
        i += size;
        size = buf[i++];
      }
      if (label === 0xf9) {
        gce = {
          packed: payload[0],
          delayCs: payload[1] | (payload[2] << 8),
          transparentIndex: payload[3],
        };
      }
    } else if (block === 0x2c) {
      // image descriptor: 9 bytes, optional local color table, LZW sub-blocks
      const packed = buf[i + 8];
      const lctSize = packed & 0x80 ? 2 << (packed & 0x07) : 0;
      frames.push({
        gce,
        width: buf[i + 4] | (buf[i + 5] << 8),
        height: buf[i + 6] | (buf[i + 7] << 8),
        paletteSize: lctSize || gctSize,
        paletteOffset: lctSize ? i + 9 : gctOffset,
      });
      i += 9 + lctSize * 3;
      i++; // LZW minimum code size
      let size = buf[i++];
      while (size !== 0) {
        i += size;
        size = buf[i++];
      }
      gce = null;
    } else {
      throw new Error(`parseGif: unknown block 0x${block.toString(16)} at byte ${i - 1}`);
    }
  }
  return { screen, frames };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("encodeAnimatedGif emits a looping, deterministic, transparent GIF89a", () => {
  const frames = makeFrames();
  const bytes = encodeAnimatedGif(frames);

  // 1. header + size
  assert.equal(bytes.subarray(0, 6).toString("latin1"), "GIF89a");
  assert.ok(bytes.length > 100, `expected >100 bytes, got ${bytes.length}`);

  // 2. infinite-loop extension
  assert.ok(bytes.includes("NETSCAPE2.0"), "NETSCAPE2.0 loop extension present");

  // 3. determinism: same canvases again, and fresh identical canvases
  assert.equal(Buffer.compare(bytes, encodeAnimatedGif(frames)), 0, "re-encode of the same canvases is byte-identical");
  assert.equal(Buffer.compare(bytes, encodeAnimatedGif(makeFrames())), 0, "fresh identical canvases encode byte-identically");

  // 4. frame count and per-frame geometry
  const parsed = parseGif(bytes);
  assert.equal(parsed.screen.width, 64);
  assert.equal(parsed.screen.height, 64);
  assert.equal(parsed.frames.length, 3, "one image descriptor per frame");
  assert.deepEqual(
    parsed.frames.map((f) => [f.width, f.height]),
    [[64, 64], [64, 64], [8, 8]],
  );

  // 5. transparency: every frame's GCE flags a transparent index inside its palette
  for (const [n, frame] of parsed.frames.entries()) {
    assert.ok(frame.gce, `frame ${n} has a graphic control extension`);
    assert.equal(frame.gce.packed & 0x01, 1, `frame ${n} transparent flag set`);
    assert.ok(frame.gce.transparentIndex < frame.paletteSize, `frame ${n} transparentIndex ${frame.gce.transparentIndex} < palette size ${frame.paletteSize}`);
  }
  // ... and the flagged slot is the cleared-black entry alpha collapsed onto
  const first = parsed.frames[0];
  const slot = first.paletteOffset + first.gce.transparentIndex * 3;
  assert.deepEqual([...bytes.subarray(slot, slot + 3)], [0, 0, 0], "transparent slot is the clearAlpha-cleared entry");

  // per-frame delays landed (GIF stores centiseconds)
  assert.equal(parsed.frames[0].gce.delayCs, 10, "default 100ms");
  assert.equal(parsed.frames[1].gce.delayCs, 25, "250ms");
  assert.equal(parsed.frames[2].gce.delayCs, 6, "60ms");
});

test("an 8x nearest-neighbor upscale still encodes with transparency", () => {
  const small = squareFrame(64, "#ff0000", 8, 8, 48, 48);
  const big = createCanvas(512, 512);
  const ctx = big.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, 512, 512);
  const { frames } = parseGif(encodeAnimatedGif([{ canvas: big }]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].width, 512);
  assert.equal(frames[0].height, 512);
  assert.equal(frames[0].gce.packed & 0x01, 1, "upscaled frame keeps its transparent surround");
});

test("a fully opaque frame does not claim a transparent color", () => {
  const canvas = createCanvas(16, 16);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#123456";
  ctx.fillRect(0, 0, 16, 16);
  const { frames } = parseGif(encodeAnimatedGif([{ canvas }]));
  assert.equal(frames.length, 1);
  assert.ok(frames[0].gce);
  assert.equal(frames[0].gce.packed & 0x01, 0, "no transparent index flagged when no pixel is transparent");
});

test("maxColors is validated; tiny budgets still encode the tiny-palette frame", () => {
  assert.throws(() => encodeAnimatedGif(makeFrames(), { maxColors: 0 }), TypeError);
  assert.throws(() => encodeAnimatedGif(makeFrames(), { maxColors: 300 }), TypeError);
  assert.throws(() => encodeAnimatedGif(makeFrames(), { maxColors: "many" }), TypeError);
  const bytes = encodeAnimatedGif(makeFrames(), { maxColors: 4 });
  assert.ok(bytes.length > 100);
  assert.equal(parseGif(bytes).frames.length, 3);
});

test("gifFrameDelay converts fps, clamped to the playable range", () => {
  assert.equal(gifFrameDelay(), 100, "default fps 10");
  assert.equal(gifFrameDelay(10), 100);
  assert.equal(gifFrameDelay(50), 20, "1000/50 is exactly the 20ms floor");
  assert.equal(gifFrameDelay(100), 20, "10ms is clamped up to 20ms");
  assert.equal(gifFrameDelay(2), 500);
  assert.equal(gifFrameDelay(1), 1000);
  assert.equal(gifFrameDelay(0.5), 1000, "2000ms is clamped to 1s");
  assert.throws(() => gifFrameDelay(0), TypeError);
  assert.throws(() => gifFrameDelay(-3), TypeError);
  assert.throws(() => gifFrameDelay(Number.NaN), TypeError);
});

test("encodeAnimatedGif validates its input with TypeErrors", () => {
  assert.throws(() => encodeAnimatedGif([]), { name: "TypeError", message: /frames/ });
  assert.throws(() => encodeAnimatedGif("nope"), { name: "TypeError", message: /frames/ });
  assert.throws(() => encodeAnimatedGif([{}]), { name: "TypeError", message: /canvas/ });
  assert.throws(() => encodeAnimatedGif([null]), { name: "TypeError", message: /frames\[0\]/ });
  assert.throws(() => encodeAnimatedGif([{ canvas: {} }]), { name: "TypeError", message: /canvas/ });
});
