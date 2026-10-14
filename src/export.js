// export_character: fan one rendered character out into a directory tree an engine can
// import, instead of one PNG the consumer has to slice themselves.
//
// Upstream's browser app does this through four ZIP download modes; there is no ZIP here on
// purpose (the MCP client is co-located, a path is already the primitive this server returns,
// and the package carries two dependencies). The bundle is a directory plus a manifest.
import fs from "node:fs";
import path from "node:path";
import {
  ANIMATION_CONFIGS,
  DIRECTIONS,
  FRAME_SIZE,
  ROW_BLOCK_ALIASES,
  SINGLE_ROW_DIRECTION,
  rowBlockFrames,
} from "./engine/constants.js";
import { getAllCredits, creditsToCsv, creditsToTxt } from "./engine/credits.js";
import { packRevision } from "./assets-dir.js";
import { buildSelections, describeSelections, DEFAULT_OUTPUT_DIR, timestamp } from "./character.js";
import { buildCharacterSpec } from "./spec.js";

/** TexturePacker "JSON Hash" is the dialect Phaser, LibGDX and most importers read. */
export const ATLAS_FORMATS = ["texturepacker"];

const STANDARD_PNG = "sheet.png";

/**
 * Canonical standard row blocks, deduplicated onto the rows they actually paint.
 * `watering`/`1h_slash` are aliases and `1h_backslash`/`1h_halfslash` re-read the backslash and
 * halfslash rows, so emitting each name separately would describe the same pixels twice.
 */
export function standardRowBlocks() {
  const blocks = [];
  const seen = new Set();
  for (const [name, cfg] of Object.entries(ANIMATION_CONFIGS)) {
    if (ROW_BLOCK_ALIASES[name]) continue;
    const key = `${cfg.row}-${cfg.num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({
      name,
      row: cfg.row,
      rows: cfg.num,
      frames: rowBlockFrames(name),
      cycle: cfg.cycle,
      yOffset: cfg.row * FRAME_SIZE,
      frameSize: FRAME_SIZE,
      directions: cfg.num === 1 ? [SINGLE_ROW_DIRECTION[name] ?? DIRECTIONS[0]] : DIRECTIONS,
    });
  }
  return blocks;
}

/** Frame rects of a rendered sheet: standard blocks plus any custom blocks it appended. */
function sheetFrames(layout) {
  const frames = [];
  for (const block of standardRowBlocks()) {
    for (const [dirIndex, direction] of block.directions.entries()) {
      for (let col = 0; col < block.frames; col++) {
        frames.push({
          key: `${block.name}_${direction}_${col + 1}`,
          animation: block.name,
          direction,
          frame: col + 1,
          sourceSize: { w: FRAME_SIZE, h: FRAME_SIZE },
          frameRect: {
            x: col * FRAME_SIZE,
            y: (block.row + dirIndex) * FRAME_SIZE,
            w: FRAME_SIZE,
            h: FRAME_SIZE,
          },
        });
      }
    }
  }
  for (const block of layout.custom) {
    for (let dirIndex = 0; dirIndex < block.rows; dirIndex++) {
      const direction = DIRECTIONS[dirIndex] ?? DIRECTIONS[0];
      for (let col = 0; col < block.columns; col++) {
        frames.push({
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
        });
      }
    }
  }
  return frames;
}

/**
 * TexturePacker JSON Hash. `rotated` and `trimmed` are honest false: this engine paints whole
 * fixed-size grid cells and never packs. `anchor`/pivot is the one invention — the LPC grid has
 * no per-frame hot spot, so every frame is centred and the manifest says so.
 */
function texturepackerAtlas(frames, image, meta) {
  return {
    frames: Object.fromEntries(
      frames.map((f) => [
        f.key,
        {
          frame: { x: f.frameRect.x, y: f.frameRect.y, w: f.frameRect.w, h: f.frameRect.h },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: f.sourceSize.w, h: f.sourceSize.h },
          sourceSize: f.sourceSize,
          anchor: { x: 0.5, y: 0.5 },
        },
      ]),
    ),
    meta: {
      app: "lpc-spritesheet-mcp",
      version: meta.serverVersion,
      image: STANDARD_PNG,
      format: "RGBA8888",
      size: { w: image.width, h: image.height },
      scale: 1,
      packRevision: meta.packRevision,
      pivotNote:
        "anchor 0.5,0.5 is a local default: the universal LPC grid carries no per-frame hot spot, so frames are cell-centred. Rotate or offset in your engine if it needs feet/bottom anchoring.",
    },
  };
}

function writePng(file, canvas) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
}

/**
 * @param {import('./engine/sheet.js').SpriteEngine} engine
 * @param {object} args tool arguments (character args + mode + output_dir)
 * @param {{ serverVersion: string, preWarnings?: string[] }} meta
 */
export async function exportBundle(engine, args, { serverVersion, preWarnings = [] }) {
  const mode = args.mode ?? "animation";
  if (mode !== "animation" && mode !== "frames") {
    return {
      error: `Unknown mode "${args.mode ?? ""}". Valid: animation, frames.`,
    };
  }
  const atlasFormat = args.atlas_format ?? "texturepacker";
  if (!ATLAS_FORMATS.includes(atlasFormat)) {
    return {
      error: `Unknown atlas_format "${atlasFormat}". Valid: ${ATLAS_FORMATS.join(", ")}.`,
    };
  }

  const { bodyType, selections } = buildSelections(engine, args);
  const { canvas, layout, warnings: renderWarnings, layers } = await engine.renderCharacter({
    bodyType,
    selections,
    matchBodyColorEnabled: args.match_body_color !== false,
  });
  const warnings = [...preWarnings, ...renderWarnings];

  const dir = path.resolve(
    args.output_dir || path.join(DEFAULT_OUTPUT_DIR, `lpc-${bodyType}-${mode}-${timestamp()}`),
  );
  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  const sheetPath = path.join(dir, STANDARD_PNG);
  writePng(sheetPath, canvas);
  files.push(STANDARD_PNG);

  const frames = sheetFrames(layout);
  const atlasName = `sheet.atlas.${atlasFormat}.json`;
  const atlas = texturepackerAtlas(frames, { width: canvas.width, height: canvas.height }, {
    serverVersion,
    packRevision: packRevision(engine.catalog.assetsDir),
  });
  fs.writeFileSync(path.join(dir, atlasName), JSON.stringify(atlas, null, 2));
  files.push(atlasName);

  // Per-animation strips, or per-frame cells. Orthogonal on purpose: `frames` is what an
  // importer that wants one file per image asked for, and re-emitting strips there would
  // double the file count for no new information.
  const crops = [];
  if (mode === "animation") {
    for (const block of standardRowBlocks()) {
      const name = `standard/${block.name}.png`;
      writePng(path.join(dir, name), engine.extractAnimation(canvas, block.name));
      files.push(name);
      crops.push({ animation: block.name, file: name, rows: block.rows, frames: block.frames });
    }
    for (const block of layout.custom) {
      const name = `custom/${block.name}.png`;
      writePng(path.join(dir, name), engine.extractCustomAnimation(canvas, layout, block.name));
      files.push(name);
      crops.push({
        animation: block.name,
        file: name,
        custom: true,
        rows: block.rows,
        frames: block.columns,
        frameSize: block.frameSize,
      });
    }
  } else {
    for (const [dirIndex, direction] of DIRECTIONS.entries()) {
      for (const block of standardRowBlocks()) {
        if (dirIndex >= block.rows) continue;
        for (let col = 0; col < block.frames; col++) {
          const name = `standard/${block.name}/${direction}-${col + 1}.png`;
          writePng(path.join(dir, name), engine.extractFrame(canvas, block.name, direction, col));
          files.push(name);
        }
      }
    }
    for (const block of layout.custom) {
      for (let dirIndex = 0; dirIndex < block.rows && dirIndex < DIRECTIONS.length; dirIndex++) {
        const direction = DIRECTIONS[dirIndex];
        for (let col = 0; col < block.columns; col++) {
          const name = `custom/${block.name}/${direction}-${col + 1}.png`;
          writePng(path.join(dir, name), engine.extractCustomFrame(canvas, layout, block.name, direction, col));
          files.push(name);
        }
      }
    }
  }

  const credits = getAllCredits(engine.catalog, selections, bodyType);
  let creditsOut;
  if (args.include_credits !== false && credits.length > 0) {
    const csv = path.join(dir, "sheet-credits.csv");
    const txt = path.join(dir, "sheet-credits.txt");
    fs.writeFileSync(csv, creditsToCsv(credits));
    fs.writeFileSync(txt, creditsToTxt(credits));
    files.push("sheet-credits.csv", "sheet-credits.txt");
    creditsOut = { csv, txt, entries: credits.length };
  }

  let characterJson;
  if (args.include_character_json) {
    characterJson = path.join(dir, "sheet-character.json");
    fs.writeFileSync(
      characterJson,
      JSON.stringify(
        buildCharacterSpec(engine.catalog, {
          bodyType,
          selections,
          layers,
          credits,
          generator: { name: "lpc-spritesheet-mcp", version: serverVersion },
          pack: { revision: packRevision(engine.catalog.assetsDir) },
        }),
        null,
        2,
      ),
    );
    files.push("sheet-character.json");
  }

  files.push("manifest.json");
  const manifest = {
    generator: { name: "lpc-spritesheet-mcp", version: serverVersion },
    pack: { revision: packRevision(engine.catalog.assetsDir) },
    mode,
    bodyType,
    sheet: { file: STANDARD_PNG, width: canvas.width, height: canvas.height },
    layout,
    crops,
    frameCount: frames.length,
    files,
    warnings,
    credits: creditsOut && { entries: credits.length, files: ["sheet-credits.csv", "sheet-credits.txt"] },
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    mode,
    outputDir: dir,
    image: { width: canvas.width, height: canvas.height, frameSize: FRAME_SIZE },
    frames: frames.length,
    files,
    layout,
    atlas: path.join(dir, atlasName),
    manifest: path.join(dir, "manifest.json"),
    ...(characterJson ? { characterJson } : {}),
    credits: creditsOut,
    warnings,
    selections: describeSelections(selections),
  };
}
