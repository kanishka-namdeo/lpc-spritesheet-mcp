// Headless compositor — ports lpc-generator-src/sources/canvas/renderer.ts
// (runRenderCharacter + custom-animation areas) and draw-frames.ts onto
// @napi-rs/canvas. Produces the standard 832x3456 universal sheet plus any
// custom-animation blocks appended below, exactly like the web app.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ANIMATION_OFFSETS,
  ANIMATION_CONFIGS,
  ANIMATIONS,
  DIRECTIONS,
  FRAME_SIZE,
  ROW_BLOCK_ALIASES,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  STANDARD_ANIMATION_FRAMES_PER_ROW,
  resolveAnimationName,
  rowBlockFrames,
  rowBlockYOffset,
} from "./constants.js";
import {
  animationRowsLayout,
  customAnimations,
  customAnimationBase,
} from "./custom-animations.js";
import { createRecolorCache, getMultiRecolors } from "./recolor.js";

const variantToFilename = (variant) => String(variant).replaceAll(" ", "_");

const es6DynamicTemplate = (template, vars) =>
  template.replace(/\${(.*?)}/g, (_, g) => vars[g] ?? `\${${g}}`);

/** Port of replaceInPath: resolve ${typeName} placeholders from current selections. */
function replaceInPath(catalog, pathStr, selections, meta, bodyType) {
  if (!pathStr.includes("${")) return pathStr;
  const replacements = {};
  for (const [typeName, map] of Object.entries(meta.replaceInPath)) {
    if (!pathStr.includes(`\${${typeName}}`)) continue;
    const selection = selections[typeName];
    if (!selection) continue;
    const item = catalog.getItem(selection.itemId);
    if (!item) continue;
    const name = item.name.replaceAll(" ", "_");
    replacements[typeName] = map?.[name];
    if (!replacements[typeName]) {
      console.warn(`No replacement found for ${typeName}="${name}" in path template.`);
    }
  }
  return es6DynamicTemplate(pathStr, replacements);
}

/** Port of getSpritePath (path.ts). Returns the asset-relative sprite path or null. */
function getSpritePath(catalog, itemId, variant, recolors, bodyType, animName, layerNum, selections, meta) {
  const layerKey = `layer_${layerNum}`;
  const layer = meta.layers?.[layerKey];
  if (!layer) return null;

  let basePath = layer[bodyType];
  if (!basePath) return null;

  if (basePath.includes("${")) {
    basePath = replaceInPath(catalog, basePath, selections, meta, bodyType);
  }

  if (!variant && !recolors) {
    const parts = itemId.split("_");
    variant = parts[parts.length - 1];
  }

  const animation = ANIMATIONS.find((a) => a.value === animName);
  if (animation?.folderName) animName = animation.folderName;

  const fileName = !recolors ? `/${variantToFilename(variant)}` : "";
  return `spritesheets/${basePath}${animName}${fileName}.png`;
}

/** Animation-support gating (renderer.ts:428-451). */
function itemSupportsAnimation(itemMeta, animName) {
  if (animName === "combat_idle") return itemMeta.animations.includes("combat");
  if (animName === "thrust")
    return itemMeta.animations.includes("thrust") || itemMeta.animations.includes("watering");
  if (animName === "backslash")
    return itemMeta.animations.includes("1h_slash") || itemMeta.animations.includes("1h_backslash");
  if (animName === "halfslash") return itemMeta.animations.includes("1h_halfslash");
  return itemMeta.animations.includes(animName);
}

function animationSupportKey(itemMeta, animName) {
  // the item-metadata animation name that serves this row (for warnings)
  if (animName === "combat_idle") return "combat";
  if (animName === "thrust")
    return itemMeta.animations.includes("thrust") ? "thrust" : "watering";
  if (animName === "backslash")
    return itemMeta.animations.includes("1h_slash") ? "1h_slash" : "1h_backslash";
  if (animName === "halfslash") return "1h_halfslash";
  return animName;
}

export class SpriteEngine {
  /** @param {import('./catalog.js').Catalog} catalog */
  constructor(catalog) {
    this.catalog = catalog;
    this.imageCache = new Map(); // asset-relative path -> Promise<Image|Canvas>
    this.getImageToDraw = createRecolorCache();
  }

  loadSprite(relPath) {
    let p = this.imageCache.get(relPath);
    if (!p) {
      p = loadImage(`${this.catalog.assetsDir}/${relPath}`);
      this.imageCache.set(relPath, p);
      p.catch(() => this.imageCache.delete(relPath));
      if (this.imageCache.size > 1500) this.imageCache.clear();
    }
    return p;
  }

  /**
   * Render a full character sheet.
   * @param {object} opts { bodyType, selections, matchBodyColorEnabled }
   * @returns {Promise<{canvas, layout, warnings}>}
   */
  async renderCharacter({ bodyType, selections, matchBodyColorEnabled = true }) {
    const catalog = this.catalog;
    const warnings = [];
    // itemId -> set of row names whose sprites are missing (aggregated so a
    // bare-bones asset doesn't produce one message per PNG)
    const missingByItem = new Map();
    const noteMissing = (itemId, row) => {
      if (!missingByItem.has(itemId)) missingByItem.set(itemId, new Set());
      missingByItem.get(itemId).add(row);
    };

    // ---- build draw calls (renderer.ts:360-505) ----
    const drawCalls = [];
    const customAnimationItems = [];
    const addedCustomAnimations = new Set();

    for (const [groupName, selection] of Object.entries(selections)) {
      const meta = catalog.getItem(selection.itemId);
      if (!meta || selection.subId) continue;
      if (!meta.required.includes(bodyType)) continue;

      const recolors = getMultiRecolors(catalog, meta.itemId, selections, matchBodyColorEnabled);

      for (let layerNum = 1; layerNum < 10; layerNum++) {
        const layer = meta.layers?.[`layer_${layerNum}`];
        if (!layer) break;
        const zPos = layer.zPos ?? 100;

        if (layer.custom_animation) {
          addedCustomAnimations.add(layer.custom_animation);
          const basePath = layer[bodyType];
          if (!basePath) continue;
          const spritePath = `spritesheets/${basePath}${variantToFilename(selection.variant ?? "")}.png`;
          customAnimationItems.push({
            itemId: meta.itemId,
            variant: selection.variant ?? null,
            recolors,
            spritePath,
            zPos,
            layerNum,
            customAnimation: layer.custom_animation,
          });
          continue;
        }

        for (const [animName, yPos] of Object.entries(ANIMATION_OFFSETS)) {
          if (!meta.animations || meta.animations.length === 0) continue;
          if (!itemSupportsAnimation(meta, animName)) continue;

          const spritePath = getSpritePath(
            catalog, meta.itemId, selection.variant ?? null, recolors,
            bodyType, animName, layerNum, selections, meta,
          );
          if (!spritePath) {
            warnings.push(`No ${bodyType} path for ${meta.itemId} layer_${layerNum} (${animName})`);
            continue;
          }
          drawCalls.push({
            itemId: meta.itemId,
            variant: selection.variant ?? null,
            recolors,
            spritePath,
            zPos,
            layerNum,
            animation: animName,
            yPos,
          });
        }
      }
    }

    drawCalls.sort((a, b) => a.zPos - b.zPos);

    // ---- size canvas (renderer.ts:507-559) ----
    const currentCustomAnimations = {};
    const customAnimYPositions = {};
    let totalHeight = SHEET_HEIGHT;
    let totalWidth = SHEET_WIDTH;
    for (const customAnimName of addedCustomAnimations) {
      const def = customAnimations[customAnimName];
      if (!def) continue;
      totalHeight += def.frameSize * def.frames.length;
      totalWidth = Math.max(totalWidth, def.frameSize * def.frames[0].length);
      currentCustomAnimations[customAnimName] = def;
    }

    const canvas = createCanvas(totalWidth, totalHeight);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let currentY = SHEET_HEIGHT;
    for (const customAnimName of addedCustomAnimations) {
      const def = customAnimations[customAnimName];
      if (!def) continue;
      customAnimYPositions[customAnimName] = currentY;
      currentY += def.frameSize * def.frames.length;
    }

    // ---- load + draw standard rows in z order (renderer.ts:561-594) ----
    const loaded = await Promise.all(
      drawCalls.map(async (call) => {
        try {
          const img = await this.loadSprite(call.spritePath);
          return { call, img, success: true };
        } catch {
          noteMissing(call.itemId, call.animation);
          return { call, img: null, success: false };
        }
      }),
    );

    for (const { call, img, success } of loaded) {
      if (!success || !img) continue;
      const imageToDraw = await this.getImageToDraw(
        catalog, img, call.itemId, call.recolors, call.spritePath,
      );
      ctx.drawImage(imageToDraw, 0, call.yPos);
    }

    // ---- custom animation areas (renderer.ts:598-670) ----
    for (const customAnimName of addedCustomAnimations) {
      const customAnimDef = customAnimations[customAnimName];
      if (!customAnimDef) continue;
      const offsetY = customAnimYPositions[customAnimName];
      const baseAnim = customAnimationBase(customAnimDef);

      const areaItems = [];
      for (const item of customAnimationItems) {
        if (item.customAnimation === customAnimName) {
          areaItems.push({ type: "custom_sprite", ...item });
        }
      }
      if (baseAnim) {
        for (const call of drawCalls) {
          if (call.animation === baseAnim) {
            areaItems.push({ type: "extracted_frames", ...call });
          }
        }
      }
      areaItems.sort((a, b) => a.zPos - b.zPos);

      const loadedArea = await Promise.all(
        areaItems.map(async (item) => {
          try {
            const img = await this.loadSprite(item.spritePath);
            return { item, img, success: true };
          } catch {
            noteMissing(item.itemId, `custom:${customAnimName}`);
            return { item, img: null, success: false };
          }
        }),
      );

      for (const { item, img, success } of loadedArea) {
        if (!success || !img) continue;
        const imageToUse = await this.getImageToDraw(
          catalog, img, item.itemId, item.recolors, item.spritePath,
        );
        if (item.type === "custom_sprite") {
          if (customAnimDef.sourceSingleAnimation) {
            drawSingleAnimSpriteToCustomAnimation(ctx, customAnimDef, offsetY, imageToUse);
          } else {
            ctx.drawImage(imageToUse, 0, offsetY);
          }
        } else if (item.type === "extracted_frames") {
          drawFramesToCustomAnimation(ctx, customAnimDef, offsetY, imageToUse);
        }
      }
    }

    // Emit missing-asset warnings aggregated per item.
    for (const [itemId, rows] of missingByItem) {
      warnings.push(
        `${itemId}: no sprite for row(s) ${Array.from(rows).join(", ")} — those rows will be empty (${rows.size} missing)`,
      );
    }

    const layout = this.describeLayout(Object.keys(currentCustomAnimations));
    return { canvas, layout, warnings };
  }

  /** Static layout description; when customAnimNames given, includes their blocks. */
  describeLayout(customAnimNames = []) {
    const standard = {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      frameSize: FRAME_SIZE,
      columns: STANDARD_ANIMATION_FRAMES_PER_ROW,
      directions: DIRECTIONS,
      animations: {},
    };
    for (const [name, cfg] of Object.entries(ANIMATION_CONFIGS)) {
      const alias = ROW_BLOCK_ALIASES[name];
      standard.animations[name] = {
        row: cfg.row,
        rows: cfg.num,
        frames: rowBlockFrames(name),
        cycle: cfg.cycle,
        yOffset: rowBlockYOffset(name),
        ...(alias ? { note: `alias: shares the ${alias} row block` } : {}),
      };
    }
    const custom = [];
    let y = SHEET_HEIGHT;
    for (const name of customAnimNames) {
      const def = customAnimations[name];
      if (!def) continue;
      custom.push({
        name,
        yOffset: y,
        frameSize: def.frameSize,
        rows: def.frames.length,
        columns: def.frames[0].length,
        sourceSingleAnimation: Boolean(def.sourceSingleAnimation),
        baseAnimation: customAnimationBase(def),
      });
      y += def.frameSize * def.frames.length;
    }
    return { standard, custom };
  }

  /** Crop one standard animation row block from a rendered sheet. */
  extractAnimation(canvas, animationName) {
    const config = ANIMATION_CONFIGS[resolveAnimationName(animationName)];
    if (!config) {
      throw new Error(
        `Unknown animation: ${animationName}. Standard: ${Object.keys(ANIMATION_CONFIGS).join(", ")}. Custom: ${Object.keys(customAnimations).join(", ")}. See list_animations.`,
      );
    }
    const srcY = config.row * FRAME_SIZE;
    const srcHeight = config.num * FRAME_SIZE;
    const out = createCanvas(SHEET_WIDTH, srcHeight);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, srcY, SHEET_WIDTH, srcHeight, 0, 0, SHEET_WIDTH, srcHeight);
    return out;
  }

  /** Crop a custom-animation block from a rendered sheet. */
  extractCustomAnimation(canvas, layout, customName) {
    const block = layout.custom.find((c) => c.name === customName);
    if (!block) throw new Error(`No custom animation ${customName} in this sheet`);
    const out = createCanvas(block.frameSize * block.columns, block.frameSize * block.rows);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      canvas,
      0, block.yOffset, out.width, out.height,
      0, 0, out.width, out.height,
    );
    return out;
  }

  /**
   * Horizontal preview strip: the playback cycle of one animation for one
   * direction, cropped from a rendered sheet. Single-row blocks (hurt, climb)
   * have only one facing and accept any direction. Returns {canvas, frames}.
   */
  extractPreviewStrip(canvas, animationName, direction = "down", cycle = null) {
    const config = ANIMATION_CONFIGS[resolveAnimationName(animationName)];
    if (!config) {
      throw new Error(
        `Unknown animation: ${animationName}. Standard: ${Object.keys(ANIMATION_CONFIGS).join(", ")}. Custom: ${Object.keys(customAnimations).join(", ")}. See list_animations.`,
      );
    }
    let dirIndex = DIRECTIONS.indexOf(direction);
    if (dirIndex < 0) throw new Error(`Unknown direction: ${direction}. Valid: ${DIRECTIONS.join(", ")}`);
    if (config.num === 1) {
      dirIndex = 0; // single facing (hurt = down-only art, climb = up-only art)
    } else if (dirIndex >= config.num) {
      throw new Error(`Animation ${animationName} has only ${config.num} direction row(s); "${direction}" is not available.`);
    }
    const cycleFrames = cycle ?? config.cycle;
    const row = config.row + dirIndex;
    const out = createCanvas(cycleFrames.length * FRAME_SIZE, FRAME_SIZE);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < cycleFrames.length; i++) {
      const srcX = cycleFrames[i] * FRAME_SIZE;
      ctx.drawImage(canvas, srcX, row * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE, i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE);
    }
    return { canvas: out, frames: cycleFrames };
  }

  /** Single frame of a standard animation. */
  extractFrame(canvas, animationName, direction = "down", frameIndex = 0) {
    const config = ANIMATION_CONFIGS[resolveAnimationName(animationName)];
    if (!config) throw new Error(`Unknown animation: ${animationName}`);
    let dirIndex = DIRECTIONS.indexOf(direction);
    if (dirIndex < 0) throw new Error(`Unknown direction: ${direction}. Valid: ${DIRECTIONS.join(", ")}`);
    if (config.num === 1) {
      dirIndex = 0;
    } else if (dirIndex >= config.num) {
      throw new Error(`Direction ${direction} not available for ${animationName}`);
    }
    const out = createCanvas(FRAME_SIZE, FRAME_SIZE);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      canvas,
      frameIndex * FRAME_SIZE, (config.row + dirIndex) * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE,
      0, 0, FRAME_SIZE, FRAME_SIZE,
    );
    return out;
  }
}

// ---------------------------------------------------------------------------
// draw-frames.ts ports
// ---------------------------------------------------------------------------

function drawFrameToFrame(destCtx, destPos, destFrameSize, src, srcPos, srcFrameSize) {
  if (srcFrameSize === destFrameSize) {
    destCtx.drawImage(
      src, srcPos.x, srcPos.y, srcFrameSize, srcFrameSize,
      destPos.x, destPos.y, destFrameSize, destFrameSize,
    );
  } else {
    const offset = (destFrameSize - srcFrameSize) / 2;
    destCtx.drawImage(
      src, srcPos.x, srcPos.y, srcFrameSize, srcFrameSize,
      destPos.x + offset, destPos.y + offset, srcFrameSize, srcFrameSize,
    );
  }
}

function drawFramesToCustomAnimation(destCtx, customAnimationDefinition, offsetY, src) {
  const frameSize = customAnimationDefinition.frameSize;
  const isSingleAnimation = src.height <= 256;

  for (let i = 0; i < customAnimationDefinition.frames.length; ++i) {
    const frames = customAnimationDefinition.frames[i];
    for (let j = 0; j < frames.length; ++j) {
      const frameSpec = frames[j];
      const [srcRowName, srcColumnStr] = frameSpec.split(",");
      const srcColumn = parseInt(srcColumnStr);

      let srcRow;
      if (isSingleAnimation) {
        const direction = srcRowName.split("-")[1];
        const directionMap = { n: 0, w: 1, s: 2, e: 3 };
        srcRow = directionMap[direction] || 0;
      } else {
        srcRow = animationRowsLayout ? animationRowsLayout[srcRowName] : i;
      }

      const srcX = FRAME_SIZE * srcColumn;
      const srcY = FRAME_SIZE * srcRow;
      const destX = frameSize * j;
      const destY = frameSize * i + offsetY;

      drawFrameToFrame(destCtx, { x: destX, y: destY }, frameSize, src, { x: srcX, y: srcY }, FRAME_SIZE);
    }
  }
}

function drawSingleAnimSpriteToCustomAnimation(ctx, customAnimDef, offsetY, src) {
  const frameSize = customAnimDef.frameSize;
  const srcFrameSize = Math.round(src.height / 4);
  const directionMap = { n: 0, w: 1, s: 2, e: 3 };

  for (let i = 0; i < customAnimDef.frames.length; i++) {
    const frames = customAnimDef.frames[i];
    for (let j = 0; j < frames.length; j++) {
      const frameSpec = frames[j];
      const [srcRowName, srcColumnStr] = frameSpec.split(",");
      const srcColumn = parseInt(srcColumnStr);
      const direction = srcRowName.split("-")[1];
      const srcRow = directionMap[direction] ?? 0;

      const srcX = srcFrameSize * srcColumn;
      const srcY = srcFrameSize * srcRow;
      const destX = frameSize * j;
      const destY = frameSize * i + offsetY;

      drawFrameToFrame(ctx, { x: destX, y: destY }, frameSize, src, { x: srcX, y: srcY }, srcFrameSize);
    }
  }
}
