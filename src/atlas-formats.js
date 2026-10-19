// Multi-engine atlas dialect emitters: the same rendered LPC sheet (and its frame list)
// fanned out into the import formats real game engines and pixel-art tooling read natively.
//
// Everything here is a pure function of its arguments: no filesystem, no clock, no random —
// two calls with the same inputs produce byte-identical output (a tested claim). The frame
// model consumed is the one `export.js` builds (its unexported `sheetFrames`): a flat array
// in sheet order, standard row blocks first, then custom (oversize) blocks.
//
// Format sources verified while writing this module (fetched and read, not paraphrased):
// - Aseprite JSON data export: https://aseprite.org/docs/cli/ (`--data` writes the sprite
//   sheet metadata, `--format json-hash` default / `--format json-array` array form;
//   `meta.frameTags` entries are {name, from, to, direction} with from/to frame indices).
// - Godot 4 `.tres` SpriteFrames: real Godot-4-saved files from
//   https://github.com/godotengine/godot-demo-projects (`2d/isometric/player/goblin.tscn`
//   carries a SpriteFrames with the exact `animations = [{...}]`/`&"name"`/AtlasTexture
//   shape, `2d/platformer/player/player.tscn` and `2d/isometric/tileset/tileset.tres` show
//   the `[gd_resource ... format=3]` header and string ext_resource ids), the docs
//   https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html
//   ("Sprite sheet with AnimatedSprite2D") and
//   https://docs.godotengine.org/en/stable/classes/class_spriteframes.html, and the
//   LPC-specific plugin https://github.com/alextrevisan/LPCAnimatedSprite2D.
// - libGDX TextureAtlas text format: https://libgdx.com/wiki/tools/texturepacker and the
//   parser itself, https://github.com/libgdx/libgdx/blob/master/gdx/src/com/badlogic/gdx/graphics/g2d/TextureAtlas.java
//   (see the libgdxAtlas doc comment for the y-axis finding).
// - Unity TextureImporter `.png.meta` YAML:
//   https://docs.unity3d.com/ScriptReference/TextureImporter.html and
//   https://docs.unity3d.com/ScriptReference/Rect.html (y origin at the BOTTOM-left),
//   cross-checked against a working tool's emitter (kyuza1/lpc-character-mcp exporters.py).
// - Playback cycles are cross-validated by three independent implementations that agree
//   with src/engine/constants.js ANIMATION_CONFIGS: upstream's custom-animations table,
//   LPCAnimatedSprite2D's LPCAnimationData.gd, and kyuza1's CYCLES table.

import { createHash } from "node:crypto";
import { ANIMATION_CONFIGS, DIRECTIONS, FRAME_SIZE } from "./engine/constants.js";

/** Default sheet image file name, matching export.js's STANDARD_PNG. */
const DEFAULT_IMAGE_NAME = "sheet.png";

/** Aseprite's default frame duration in milliseconds (its own exports write 100). */
const ASEPRITE_FRAME_DURATION_MS = 100;

/**
 * @typedef {Object} AtlasFrame
 * @property {string} key frame id, e.g. "walk_down_2" or "walk_128_down_9"
 * @property {string} animation owning animation name ("walk", "1h_backslash", "walk_128"…)
 * @property {string} direction one of up/left/down/right
 * @property {number} frame 1-based column within the row
 * @property {boolean} [custom] true for appended oversize blocks (absent on standard frames)
 * @property {number} [frameSize] present on custom frames (128/192)
 * @property {{w: number, h: number}} sourceSize original (untrimmed) frame size
 * @property {{x: number, y: number, w: number, h: number}} frameRect top-left rect in the sheet
 */

/**
 * @typedef {Object} StandardRowBlock output of export.js `standardRowBlocks()`
 * @property {string} name
 * @property {number} row
 * @property {number} rows
 * @property {number} frames
 * @property {number[]} cycle 0-based playback columns, repeats included
 * @property {number} yOffset
 * @property {number} frameSize
 * @property {string[]} directions
 */

/**
 * @typedef {Object} CustomBlock appended oversize block (export.js `layout.custom`)
 * @property {string} name
 * @property {number} frameSize 128 or 192
 * @property {number} rows direction rows painted
 * @property {number} columns frames per row
 * @property {number} yOffset top of the block in the sheet
 */

/**
 * Cycle-correct playback sequences in the TexturePacker/PixiJS `meta.animations` convention:
 * `{ "walk_down": ["walk_down_2", …, "walk_down_9"], … }`.
 *
 * For each standard block × direction the keys are the block's `cycle` in order — repeats stay
 * repeated because that is the honest playback order (idle's [0, 0, 1] holds frame 1 twice;
 * sit/emote hold each frame five steps). The LPC walk cycle deliberately skips the standing
 * pose (cycle starts at column 1), which is why `walk_down` has 8 keys, not 9.
 *
 * Custom (oversize) blocks have no cycle table upstream: they play every column in order, one
 * entry per direction row in DIRECTIONS order (capped at the block's row count).
 *
 * The cycles were cross-checked against LPCAnimatedSprite2D's LPCAnimationData.gd
 * (custom_frames) and kyuza1/lpc-character-mcp's CYCLES — three independent tables agree.
 *
 * @param {StandardRowBlock[]} blocks standard row blocks (export.js `standardRowBlocks()`)
 * @param {CustomBlock[]} [customBlocks] appended oversize blocks
 * @returns {Record<string, string[]>} clip name → ordered frame keys
 */
export function animationsMap(blocks, customBlocks = []) {
  const map = {};
  for (const block of blocks) {
    for (const direction of block.directions) {
      map[`${block.name}_${direction}`] = block.cycle.map(
        (col) => `${block.name}_${direction}_${col + 1}`,
      );
    }
  }
  for (const block of customBlocks) {
    const rows = Math.min(block.rows ?? DIRECTIONS.length, DIRECTIONS.length);
    for (let dirIndex = 0; dirIndex < rows; dirIndex++) {
      const direction = DIRECTIONS[dirIndex] ?? DIRECTIONS[0];
      const keys = [];
      for (let col = 0; col < block.columns; col++) {
        keys.push(`${block.name}_${direction}_${col + 1}`);
      }
      map[`${block.name}_${direction}`] = keys;
    }
  }
  return map;
}

/** Group a frame list into animation×direction clips, preserving sheet order. */
function groupFramesByClip(frames) {
  const groups = new Map();
  for (const frame of frames) {
    const name = `${frame.animation}_${frame.direction}`;
    let group = groups.get(name);
    if (!group) {
      group = { name, animation: frame.animation, byNumber: new Map(), custom: false };
      groups.set(name, group);
    }
    if (frame.custom) group.custom = true;
    group.byNumber.set(frame.frame, frame.key);
  }
  return groups;
}

/**
 * Playback sequence for one clip, derived from the frames that actually rendered: standard
 * clips replay ANIMATION_CONFIGS cycles (columns missing from the sheet are skipped — the
 * honest sequence of what exists), custom clips play every column in order.
 */
function playbackSequence(group) {
  const cycle = group.custom ? null : ANIMATION_CONFIGS[group.animation]?.cycle;
  if (cycle) {
    return cycle
      .filter((col) => group.byNumber.has(col + 1))
      .map((col) => group.byNumber.get(col + 1));
  }
  return [...group.byNumber.keys()]
    .sort((a, b) => a - b)
    .map((n) => group.byNumber.get(n));
}

/**
 * `animationsMap` equivalent derived from a frame list alone (used where the block tables
 * are not at hand — the Aseprite `meta.animations` extra and Unity's `userData`).
 */
function playbackMapFromFrames(frames) {
  const map = {};
  for (const group of groupFramesByClip(frames).values()) {
    map[group.name] = playbackSequence(group);
  }
  return map;
}

/**
 * Aseprite tag list: one tag per animation×direction group, `from`/`to` being indices into
 * the ordered frames array (Aseprite semantics). Tags mark the group's full span — the
 * cycle-ordered playback lives in `meta.animations`, so repeats are NOT expressed here.
 */
function asepriteFrameTags(frames) {
  const groups = new Map();
  frames.forEach((frame, index) => {
    const name = `${frame.animation}_${frame.direction}`;
    const tag = groups.get(name);
    if (!tag) {
      groups.set(name, { name, from: index, to: index });
    } else {
      if (index < tag.from) tag.from = index;
      if (index > tag.to) tag.to = index;
    }
  });
  return [...groups.values()].map((tag) => ({
    name: tag.name,
    from: tag.from,
    to: tag.to,
    direction: "forward",
  }));
}

/**
 * Aseprite data-export JSON (what `aseprite --sheet sheet.png --data file.json --format
 * json-array` writes), so pixel-art tooling and Aseprite-native consumers — including Bevy
 * plugins such as bevy_asepritesheet and bevy_spritesheet_animation, which read
 * `meta.frameTags` — import the sheet with tags prebuilt.
 *
 * Verified against https://aseprite.org/docs/cli/ (the `--data`/`--format` options) and the
 * field set Aseprite itself writes: frame/spriteSourceSize/sourceSize rects, rotated/trimmed
 * flags, per-frame `duration` in ms, and `meta.frameTags` entries {name, from, to,
 * direction} where from/to are indices into the frames array. The array form (each entry
 * carrying a `filename`) is used because the frame order — and therefore tag indices — must
 * be explicit; Aseprite offers it as `--format json-array`.
 *
 * Two extensions beyond stock Aseprite output, documented here so consumers are not
 * surprised: `meta.app`/`meta.version` describe this server (Aseprite writes its own URL),
 * and `meta.animations` carries the cycle-correct playback map (the same shape as
 * `animationsMap`) because Aseprite tags cannot express held/repeated frames — the map is
 * the playback authority, the tags only mark group spans.
 *
 * @param {AtlasFrame[]} frames frame list in sheet order
 * @param {{width: number, height: number}} image sheet pixel size
 * @param {{serverVersion?: string, imageName?: string}} [meta]
 * @returns {object} JSON-serialisable Aseprite atlas document
 */
export function asepriteAtlas(frames, image, meta = {}) {
  return {
    frames: frames.map((frame) => ({
      filename: frame.key,
      frame: {
        x: frame.frameRect.x,
        y: frame.frameRect.y,
        w: frame.frameRect.w,
        h: frame.frameRect.h,
      },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.sourceSize.w, h: frame.sourceSize.h },
      sourceSize: { w: frame.sourceSize.w, h: frame.sourceSize.h },
      duration: ASEPRITE_FRAME_DURATION_MS,
    })),
    meta: {
      app: "lpc-spritesheet-mcp",
      version: meta.serverVersion,
      image: meta.imageName ?? DEFAULT_IMAGE_NAME,
      format: "RGBA8888",
      size: { w: image.width, h: image.height },
      scale: "1",
      frameTags: asepriteFrameTags(frames),
      animations: playbackMapFromFrames(frames),
    },
  };
}

/** Sub-resource id for a frame rect, allocated once per unique rect. */
class RectTable {
  constructor() {
    this.byRect = new Map();
    this.entries = [];
  }

  /** @returns {string} the sub-resource id for the rect, creating it on first sight */
  id(frameRect) {
    const key = `${frameRect.x},${frameRect.y},${frameRect.w},${frameRect.h}`;
    let id = this.byRect.get(key);
    if (!id) {
      id = `Atlas_${this.entries.length + 1}`;
      this.byRect.set(key, id);
      this.entries.push({ id, rect: frameRect });
    }
    return id;
  }
}

/** Animation entries (name + ordered frame keys) for the Godot/Unity emitters. */
function clipEntries(blocks, customBlocks) {
  const entries = [];
  const rowSorted = [...blocks].sort((a, b) => a.row - b.row);
  for (const block of rowSorted) {
    const directions = [...block.directions].sort(
      (a, b) => DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b),
    );
    for (const direction of directions) {
      entries.push({
        name: `${block.name}_${direction}`,
        keys: block.cycle.map((col) => `${block.name}_${direction}_${col + 1}`),
      });
    }
  }
  for (const block of customBlocks ?? []) {
    const rows = Math.min(block.rows ?? DIRECTIONS.length, DIRECTIONS.length);
    for (let dirIndex = 0; dirIndex < rows; dirIndex++) {
      const direction = DIRECTIONS[dirIndex] ?? DIRECTIONS[0];
      const keys = [];
      for (let col = 0; col < block.columns; col++) {
        keys.push(`${block.name}_${direction}_${col + 1}`);
      }
      entries.push({ name: `${block.name}_${direction}`, keys });
    }
  }
  return entries;
}

/**
 * Godot 4 `.tres` SpriteFrames text resource (format=3) for an `AnimatedSprite2D` node:
 * one AtlasTexture sub-resource per unique frame rect, one animation per animation×
 * direction with frames in cycle order.
 *
 * Verified against Godot's own saved files (godot-demo-projects `goblin.tscn`, which
 * carries a SpriteFrames exactly this shape, and `player.tscn`/`tileset.tres` for the
 * header and string resource ids) and the docs
 * https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html and
 * https://docs.godotengine.org/en/stable/classes/class_spriteframes.html. The
 * LPC-specific plugin LPCAnimatedSprite2D and kyuza1/lpc-character-mcp both generate the
 * same shape; kyuza's emitter independently confirms `load_steps = sub_resources + 2`
 * (1 ext_resource + n sub_resources + the resource itself).
 *
 * Shape notes, all matching Godot's writer: `animations` is an array of dictionaries with
 * `&"name"` StringNames (Godot 4 syntax), `duration` in seconds, and `speed` in fps.
 * Cycle repeats reference the same AtlasTexture sub-resource (idle's [0,0,1] cycle
 * references two sub-resources from three frames). `loop` is true for every clip — engines
 * that must play-and-stop (hurt, slash) can flip it on load; this file's job is the frame
 * order. Animations are listed standard blocks in sheet row order, then custom blocks,
 * directions in DIRECTIONS order (up, left, down, right).
 *
 * @param {AtlasFrame[]} frames frame list in sheet order
 * @param {StandardRowBlock[]} blocks standard row blocks (standardRowBlocks())
 * @param {CustomBlock[]} customBlocks appended oversize blocks
 * @param {{width: number, height: number}} image sheet pixel size (unused in the dialect;
 *   accepted for signature parity with the other emitters)
 * @param {{imageName?: string}} [meta] `imageName` overrides the texture's res:// name
 * @returns {string} `.tres` file contents
 */
export function godotSpriteFrames(frames, blocks, customBlocks = [], image, meta = {}) {
  const imageName = meta.imageName ?? DEFAULT_IMAGE_NAME;
  const rects = new RectTable();
  const keyToId = new Map(frames.map((frame) => [frame.key, rects.id(frame.frameRect)]));

  const entries = clipEntries(blocks, customBlocks)
    .map((entry) => ({
      name: entry.name,
      ids: entry.keys.filter((key) => keyToId.has(key)).map((key) => keyToId.get(key)),
    }))
    .filter((entry) => entry.ids.length > 0);

  const lines = [
    `[gd_resource type="SpriteFrames" load_steps=${rects.entries.length + 2} format=3]`,
    "",
    `[ext_resource type="Texture2D" path="res://${imageName}" id="1"]`,
  ];
  for (const { id, rect } of rects.entries) {
    lines.push("");
    lines.push(`[sub_resource type="AtlasTexture" id="${id}"]`);
    lines.push('atlas = ExtResource("1")');
    lines.push(`region = Rect2(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h})`);
  }
  lines.push("");
  lines.push("[resource]");
  lines.push(
    `animations = [${entries
      .map(
        (entry) =>
          `{\n"frames": [${entry.ids
            .map((id) => `{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`)
            .join(", ")}],\n"loop": true,\n"name": &"${entry.name}",\n"speed": 10.0\n}`,
      )
      .join(", ")}]`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * libGDX TextureAtlas text format (the `.atlas` file TexturePacker writes for libGDX).
 *
 * Verified against https://libgdx.com/wiki/tools/texturepacker and the parser itself,
 * TextureAtlas.java (libgdx master, gdx/src/com/badlogic/gdx/graphics/g2d/TextureAtlas.java):
 * the first non-empty line is the page image name, the following `key: value` page fields
 * are format/filter/repeat (an optional `size:` page line exists in modern TexturePacker
 * output but only feeds Page.width/height, which region lookups never read, so it is
 * omitted), then one block per region: `rotate`, `xy`, `size`, `orig`, `offset`, `index`.
 *
 * Y-axis finding (from the parser source): `xy` populates Region.left/Region.top and is
 * passed straight into `new AtlasRegion(texture, left, top, w, h)` — i.e. `xy` is the
 * TOP-LEFT of the region in the image file, exactly our frameRect coordinates, and libGDX
 * flips it internally when building the TextureRegion. No conversion is done here.
 * `index: -1` on every region keeps TextureAtlas's index-sorting path (`hasIndexes`)
 * switched off, which is what we want: our region names are already unique.
 *
 * `filter: Nearest,Nearest` is baked in because these are pixel-art sheets — linear
 * filtering would smear the 64px grid.
 *
 * @param {AtlasFrame[]} frames frame list in sheet order (regions are emitted in this order)
 * @param {{width: number, height: number}} image sheet pixel size (unused; see doc above)
 * @param {{imageName?: string}} [meta] `imageName` overrides the page image name
 * @returns {string} `.atlas` file contents
 */
export function libgdxAtlas(frames, image, meta = {}) {
  const lines = [
    meta.imageName ?? DEFAULT_IMAGE_NAME,
    "format: RGBA8888",
    "filter: Nearest,Nearest",
    "repeat: none",
  ];
  for (const frame of frames) {
    lines.push(frame.key);
    lines.push("  rotate: false");
    lines.push(`  xy: ${frame.frameRect.x}, ${frame.frameRect.y}`);
    lines.push(`  size: ${frame.frameRect.w}, ${frame.frameRect.h}`);
    lines.push(`  orig: ${frame.sourceSize.w}, ${frame.sourceSize.h}`);
    lines.push("  offset: 0, 0");
    lines.push("  index: -1");
  }
  return `${lines.join("\n")}\n`;
}

/** Smallest Unity maxTextureSize tier that can hold the sheet without a downscale. */
function unityMaxTextureSize(image) {
  const need = Math.max(image.width, image.height);
  for (const tier of [2048, 4096, 8192, 16384]) {
    if (need <= tier) return tier;
  }
  return 16384;
}

/**
 * Unity `.png.meta` TextureImporter YAML with the sprite sheet pre-sliced (Sprite Mode:
 * Multiple), so the PNG can be dropped into Assets/ and every frame is already a named
 * sprite.
 *
 * Verified against https://docs.unity3d.com/ScriptReference/TextureImporter.html and
 * cross-checked with a working tool's emitter (kyuza1/lpc-character-mcp). Unity's sprite
 * rect origin is the BOTTOM-left of the texture (https://docs.unity3d.com/ScriptReference/Rect.html),
 * so y is flipped from our top-left frameRect: unityY = imageHeight - y - h.
 *
 * Determinism and re-import sanity:
 * - `guid` is the first 32 hex chars of SHA-256(character name + sheet size) — stable
 *   across runs so a regenerated sheet keeps its identity (and existing .anim/.controller
 *   references keep resolving). Two characters of the same name and size intentionally
 *   collide; pass a distinguishing `meta.characterName`.
 * - `maxTextureSize` is derived from the sheet (smallest tier that fits) so a tall
 *   custom-block sheet (e.g. 1152×4480) is never silently downscaled off the 64px grid.
 * - each sprite uses `alignment: 9` (Custom) with `pivot: {x: 0.5, y: 0}` — feet at the
 *   bottom of the cell, the natural LPC anchor for ground placement.
 * - `userData` carries the animations map (compact JSON, same shape as `animationsMap`)
 *   so users can script .anim clips from the cycle order without re-deriving it.
 *
 * The template's key names were normalised to the ones Unity itself writes (`mipmaps:`,
 * `bumpMap:`; the duplicate `maxTextureSize` and the non-existent `spriteGenerateSlice`
 * key were dropped) — unknown keys are ignored by Unity's importer anyway, but clean YAML
 * is easier to diff. `filterMode: 0` (Point) and `nPOTScale: 0` keep pixel art crisp on
 * the sheet's non-power-of-two dimensions.
 *
 * @param {AtlasFrame[]} frames frame list in sheet order
 * @param {{width: number, height: number}} image sheet pixel size
 * @param {{characterName?: string}} [meta] seeds the deterministic guid
 * @returns {string} `.png.meta` file contents
 */
export function unityMeta(frames, image, meta = {}) {
  const characterName = meta.characterName ?? "lpc-character";
  const guid = createHash("sha256")
    .update(`${characterName}\n${image.width}x${image.height}`)
    .digest("hex")
    .slice(0, 32);
  const maxTextureSize = unityMaxTextureSize(image);

  const lines = [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "TextureImporter:",
    "  fileIDToRecycleName: {}",
    "  externalObjects: {}",
    "  serializedVersion: 9",
    "  mipmaps:",
    "    mipMapMode: 0",
    "    enableMipMap: 0",
    "    sRGBTexture: 1",
    "    linearTexture: 0",
    "    fadeOut: 0",
    "    borderMipMap: 0",
    "    mipMapsPreserveCoverage: 0",
    "    alphaTestReferenceValue: 0.5",
    "    mipMapFadeDistanceStart: 1",
    "    mipMapFadeDistanceEnd: 3",
    "  bumpMap:",
    "    convertToNormalMap: 0",
    "    externalNormalMap: 0",
    "    heightScale: 0.25",
    "    normalMapFilter: 0",
    "  isReadable: 0",
    "  streamingMipmaps: 0",
    "  streamingMipmapsPriority: 0",
    "  grayScaleToAlpha: 0",
    "  generateCubemap: 6",
    "  cubemapConvolution: 0",
    "  seamlessCubemap: 0",
    "  textureFormat: 1",
    `  maxTextureSize: ${maxTextureSize}`,
    "  textureSettings:",
    "    serializedVersion: 2",
    "    filterMode: 0",
    "    aniso: 1",
    "    mipBias: 0",
    "    wrapU: 1",
    "    wrapV: 1",
    "    wrapW: 1",
    "  nPOTScale: 0",
    "  lightmap: 0",
    "  compressionQuality: 50",
    "  spriteMode: 2",
    "  spriteExtrude: 1",
    "  spriteMeshType: 1",
    "  alignment: 0",
    "  spritePivot: {x: 0.5, y: 0.5}",
    `  spritePixelsToUnits: ${FRAME_SIZE}`,
    "  spriteBorder: {x: 0, y: 0, z: 0, w: 0}",
    "  alphaUsage: 1",
    "  alphaIsTransparency: 1",
    "  spriteTessellationDetail: -1",
    "  textureType: 8",
    "  textureShape: 1",
    "  singleChannelComponent: 0",
    "  spriteSheet:",
    "    serializedVersion: 2",
    "    sprites:",
  ];
  for (const frame of frames) {
    const unityY = image.height - frame.frameRect.y - frame.frameRect.h;
    lines.push(`    - name: ${frame.key}`);
    lines.push(
      `      rect: {x: ${frame.frameRect.x}, y: ${unityY}, width: ${frame.frameRect.w}, height: ${frame.frameRect.h}}`,
    );
    lines.push("      alignment: 9");
    lines.push("      pivot: {x: 0.5, y: 0}");
    lines.push("      border: {x: 0, y: 0, z: 0, w: 0}");
    lines.push("      outline: []");
    lines.push("      physicsShape: []");
  }
  lines.push("  spritePackingTag:");
  lines.push("  pSDRemoveMatte: 0");
  lines.push("  pSDShowRemoveMatteOption: 0");
  lines.push(`  userData: '${JSON.stringify(playbackMapFromFrames(frames))}'`);
  lines.push("  assetBundleName:");
  lines.push("  assetBundleVariant:");
  return `${lines.join("\n")}\n`;
}
