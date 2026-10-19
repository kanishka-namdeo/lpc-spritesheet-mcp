// Atlas dialect emitters: the cycle-correct playback map and the Aseprite / Godot /
// libGDX / Unity dialects (run: node --test test/atlas-formats-test.mjs).
//
// Fixtures are built from the real `standardRowBlocks()` table (what export.js feeds
// the emitters) plus a hand-written oversize custom block shaped like a rendered
// katana's walk_128 block.
import test from "node:test";
import assert from "node:assert/strict";
import {
  animationsMap,
  asepriteAtlas,
  godotSpriteFrames,
  libgdxAtlas,
  unityMeta,
} from "../src/atlas-formats.js";
import { standardRowBlocks } from "../src/export.js";
import { ANIMATION_CONFIGS, DIRECTIONS, FRAME_SIZE } from "../src/engine/constants.js";

const blocks = standardRowBlocks();
const customBlocks = [
  { name: "walk_128", frameSize: 128, rows: 4, columns: 9, yOffset: 54 * FRAME_SIZE },
];

// Frame list in sheet order, mirroring export.js `sheetFrames`: standard blocks,
// then custom ones. Small on purpose (walk + idle + the custom block) — emitters are
// pure and structure is what is asserted.
function frame(block, direction, col) {
  const dirIndex = block.directions.indexOf(direction);
  return {
    key: `${block.name}_${direction}_${col + 1}`,
    animation: block.name,
    direction,
    frame: col + 1,
    sourceSize: { w: block.frameSize, h: block.frameSize },
    frameRect: {
      x: col * block.frameSize,
      y: (block.row + dirIndex) * block.frameSize,
      w: block.frameSize,
      h: block.frameSize,
    },
  };
}
function customFrame(block, dirIndex, col) {
  const direction = DIRECTIONS[dirIndex];
  return {
    key: `${block.name}_${direction}_${col + 1}`,
    animation: block.name,
    direction,
    frame: col + 1,
    custom: true,
    frameSize: block.frameSize,
    sourceSize: { w: block.frameSize, h: block.frameSize },
    frameRect: {
      x: col * block.frameSize,
      y: block.yOffset + dirIndex * block.frameSize,
      w: block.frameSize,
      h: block.frameSize,
    },
  };
}

const walk = blocks.find((b) => b.name === "walk");
const idle = blocks.find((b) => b.name === "idle");
const frames = [
  ...walk.directions.flatMap((d) => Array.from({ length: walk.frames }, (_, c) => frame(walk, d, c))),
  ...idle.directions.flatMap((d) => Array.from({ length: idle.frames }, (_, c) => frame(idle, d, c))),
  ...Array.from({ length: 4 }, (_, di) =>
    Array.from({ length: customBlocks[0].columns }, (_, c) => customFrame(customBlocks[0], di, c)),
  ).flat(),
];
const IMAGE = { width: 1152, height: 54 * FRAME_SIZE + 4 * 128 };
const META = { serverVersion: "test", characterName: "atlas-fixture" };

test("animationsMap: cycle order with repeats, per direction", () => {
  const map = animationsMap(blocks, customBlocks);

  // The LPC walk cycle deliberately skips the standing pose: 8 keys, frames 2..9.
  assert.deepEqual(
    map.walk_down,
    ["walk_down_2", "walk_down_3", "walk_down_4", "walk_down_5", "walk_down_6", "walk_down_7", "walk_down_8", "walk_down_9"],
  );
  // idle holds frame 1 twice, then frame 2 — repeats stay repeated.
  assert.deepEqual(map.idle_up, ["idle_up_1", "idle_up_1", "idle_up_2"]);
  // sit/emote hold each frame five steps.
  const sit = blocks.find((b) => b.name === "sit");
  assert.equal(animationsMap([sit]).sit_down.length, ANIMATION_CONFIGS.sit.cycle.length);
  // single-row blocks expose only their facing direction
  assert.ok(map.hurt_down?.length === ANIMATION_CONFIGS.hurt.cycle.length);
  assert.equal(map.hurt_up, undefined);
  // custom blocks: every column in order, per direction
  assert.deepEqual(
    map.walk_128_down,
    Array.from({ length: 9 }, (_, c) => `walk_128_down_${c + 1}`),
  );
  // every standard block contributes every direction it ships
  for (const block of blocks) {
    for (const direction of block.directions) {
      assert.ok(map[`${block.name}_${direction}`], `missing ${block.name}_${direction}`);
    }
  }
});

test("asepriteAtlas: array frames + frameTags indices + animations map", () => {
  const doc = asepriteAtlas(frames, IMAGE, META);
  assert.ok(Array.isArray(doc.frames));
  assert.equal(doc.frames.length, frames.length);
  assert.equal(doc.frames[0].filename, "walk_up_1");
  assert.equal(doc.frames[0].duration, 100);
  assert.deepEqual(doc.frames[0].frame, { x: 0, y: 8 * FRAME_SIZE, w: 64, h: 64 });

  // frameTags from/to are indices into the frames array and cover their group span.
  // Directions are emitted up, left, down, right — walk_down is the third group.
  const walkDownTag = doc.meta.frameTags.find((t) => t.name === "walk_down");
  assert.equal(walkDownTag.from, walk.frames * 2);
  assert.equal(walkDownTag.to, walk.frames * 3 - 1);
  for (const tag of doc.meta.frameTags) {
    assert.ok(tag.from <= tag.to && tag.to < doc.frames.length, `tag ${tag.name} out of range`);
    for (let i = tag.from; i <= tag.to; i++) {
      assert.ok(doc.frames[i].filename.startsWith(`${tag.name}_`), `tag ${tag.name} frames mixed at ${i}`);
    }
  }
  // the cycle-correct playback map rides along in meta.animations
  assert.deepEqual(doc.meta.animations.walk_down, animationsMap([walk]).walk_down);
  // JSON round-trips (it is a file format)
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

test("godotSpriteFrames: tres header, one AtlasTexture per unique rect, cycle-ordered animations", () => {
  const tres = godotSpriteFrames(frames, blocks, customBlocks, IMAGE, META);
  assert.match(tres, /^\[gd_resource type="SpriteFrames" load_steps=\d+ format=3\]/);
  assert.match(tres, /\[ext_resource type="Texture2D" path="res:\/\/sheet\.png" id="1"\]/);

  const subCount = (tres.match(/\[sub_resource type="AtlasTexture"/g) ?? []).length;
  const uniqueRects = new Set(frames.map((f) => JSON.stringify(f.frameRect))).size;
  assert.equal(subCount, uniqueRects);
  assert.match(tres, new RegExp(`load_steps=${uniqueRects + 2} format=3\\]`));

  // every SubResource id referenced exists
  const defined = new Set([...tres.matchAll(/id="(Atlas_\d+)"/g)].map((m) => m[1]));
  for (const [, id] of tres.matchAll(/SubResource\("(Atlas_\d+)"\)/g)) {
    assert.ok(defined.has(id), `SubResource ${id} referenced but not defined`);
  }

  // walk_down animation: 8 frames in cycle order, looped
  const walkDown = tres.indexOf('"name": &"walk_down"');
  assert.ok(walkDown > -1, "walk_down animation missing");
  const clip = tres.slice(tres.lastIndexOf('"frames": [', walkDown), walkDown);
  const textures = [...clip.matchAll(/SubResource\("(Atlas_\d+)"\)/g)];
  assert.equal(textures.length, ANIMATION_CONFIGS.walk.cycle.length);
  assert.equal((clip.match(/"duration": 1\.0,/g) ?? []).length, textures.length);

  // deterministic
  assert.equal(godotSpriteFrames(frames, blocks, customBlocks, IMAGE, META), tres);
});

test("libgdxAtlas: page header + one region block per frame, top-left xy", () => {
  const atlas = libgdxAtlas(frames, IMAGE, META);
  const lines = atlas.split("\n");
  assert.equal(lines[0], "sheet.png");
  assert.ok(lines.includes("filter: Nearest,Nearest"));

  // region headers: non-indented, colon-free, non-empty lines — skipping the page name on line 0
  const regions = lines.filter(
    (l, i) => i > 0 && l && !l.startsWith(" ") && !l.includes(":"),
  );
  assert.equal(regions.length, frames.length);

  // the first region is walk_up_1: row 8 (up is walk's first direction), column 0
  const firstIdx = lines.indexOf("walk_up_1");
  assert.equal(lines[firstIdx + 1], "  rotate: false");
  assert.equal(lines[firstIdx + 2], `  xy: 0, ${8 * FRAME_SIZE}`);
  assert.equal(lines[firstIdx + 3], "  size: 64, 64");
  assert.equal(lines[firstIdx + 4], "  orig: 64, 64");
  assert.equal(lines[firstIdx + 5], "  offset: 0, 0");
  assert.equal(lines[firstIdx + 6], "  index: -1");

  // custom 128px frames keep their own size
  const customIdx = lines.indexOf("walk_128_up_1");
  assert.equal(lines[customIdx + 3], "  size: 128, 128");

  assert.equal(libgdxAtlas(frames, IMAGE, META), atlas); // deterministic
});

test("unityMeta: pre-sliced spriteSheet with bottom-left y flip + deterministic guid", () => {
  const meta = unityMeta(frames, IMAGE, META);
  assert.match(meta, /^fileFormatVersion: 2\nguid: [0-9a-f]{32}\nTextureImporter:/);
  assert.ok(meta.includes("spriteMode: 2"));
  assert.ok(meta.includes("filterMode: 0"));
  assert.ok(meta.includes(`spritePixelsToUnits: ${FRAME_SIZE}`));

  const sprites = [...meta.matchAll(/- name: (\S+)\n\s+rect: \{x: (\d+), y: (\d+), width: (\d+), height: (\d+)\}/g)];
  assert.equal(sprites.length, frames.length);

  // y flipped: unityY = imageHeight - y - h (walk_up_1 sits at top-left of the walk block)
  const walkUp1 = sprites.find((s) => s[1] === "walk_up_1");
  assert.deepEqual(
    [Number(walkUp1[2]), Number(walkUp1[3])],
    [0, IMAGE.height - 8 * FRAME_SIZE - FRAME_SIZE],
  );

  // userData carries the playback map as JSON
  const userData = meta.match(/userData: '(\{.*\})'/);
  assert.ok(userData, "userData missing");
  assert.deepEqual(JSON.parse(userData[1]).walk_down, animationsMap([walk]).walk_down);

  // deterministic guid: same character name + size → same guid; different name → different
  assert.equal(unityMeta(frames, IMAGE, META), meta);
  assert.notEqual(
    unityMeta(frames, IMAGE, { ...META, characterName: "other" }).match(/guid: ([0-9a-f]{32})/)[1],
    meta.match(/guid: ([0-9a-f]{32})/)[1],
  );
});
