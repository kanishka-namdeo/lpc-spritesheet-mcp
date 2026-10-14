// validate_sheet: audits the port's own layout tables, the live pack, and a rendered character.
//
// The upstream maintainer asked for "a PR to test animation alignment in an automated fashion
// that runs within our CI" after a shipped strip disagreed with its own definition. This is that
// check, pointed at the two things that can actually drift apart here: the tables in
// src/engine/constants.js and the pack they describe.
import {
  ANIMATION_CONFIGS,
  ANIMATION_FRAME_COUNTS,
  ANIMATION_OFFSETS,
  DIRECTIONS,
  FRAME_SIZE,
  ROW_BLOCK_ALIASES,
  SHEET_HEIGHT,
  SINGLE_ROW_DIRECTION,
  STANDARD_ANIMATION_FRAMES_PER_ROW,
  rowBlockFolder,
} from "./engine/constants.js";
import { customAnimations, customAnimationBase } from "./engine/custom-animations.js";
import { packRevision } from "./assets-dir.js";

const CHECKS_MAX_CATEGORY = 100;

function check(id, status, detail, extra = {}) {
  return { id, status, detail, ...extra };
}

/**
 * @returns {{checks: object[], pack: {revision: string|null}}}
 */
export function validateLayout(catalog) {
  const checks = [];
  const blocks = [];
  const seen = new Set();
  for (const [name, cfg] of Object.entries(ANIMATION_CONFIGS)) {
    if (ROW_BLOCK_ALIASES[name]) continue;
    const key = `${cfg.row}-${cfg.num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ name, row: cfg.row, num: cfg.num });
  }

  if (blocks.length !== Object.keys(ANIMATION_FRAME_COUNTS).length) {
    checks.push(check(
      "row-block-count",
      "fail",
      `${blocks.length} canonical row blocks declared but ${Object.keys(ANIMATION_FRAME_COUNTS).length} frame-count entries; the universal sheet is 54 rows of 13 columns.`,
      { blocks: blocks.length, frameCounts: Object.keys(ANIMATION_FRAME_COUNTS).length },
    ));
  } else {
    checks.push(check("row-block-count", "pass", `${blocks.length} canonical row blocks, one frame-count entry each.`));
  }

  const occupied = new Map();
  for (const { name, row, num } of blocks) {
    const end = row + num;
    if (end > SHEET_HEIGHT / FRAME_SIZE) {
      checks.push(check("row-block-bounds", "fail", `${name} occupies rows ${row}..${end - 1}, past row ${SHEET_HEIGHT / FRAME_SIZE - 1}.`));
    }
    for (let r = row; r < end; r++) {
      if (occupied.has(r)) {
        checks.push(check("row-block-overlap", "fail", `rows ${r}: "${occupied.get(r)}" and "${name}" both claim it.`));
      } else occupied.set(r, name);
    }
    const folder = rowBlockFolder(name);
    if (!(folder in ANIMATION_FRAME_COUNTS)) {
      checks.push(check("frame-count-key", "fail", `${name} resolves to table key "${folder}", which has no ANIMATION_FRAME_COUNTS entry.`));
    }
    const frames = ANIMATION_FRAME_COUNTS[folder];
    if (!Number.isInteger(frames) || frames < 1 || frames > STANDARD_ANIMATION_FRAMES_PER_ROW) {
      checks.push(check("frame-count-range", "fail", `${name} declares ${frames} frames per row; the sheet is ${STANDARD_ANIMATION_FRAMES_PER_ROW} columns wide.`));
    }
    const offset = ANIMATION_OFFSETS[name] ?? ANIMATION_OFFSETS[folder];
    if (offset !== row * FRAME_SIZE) {
      checks.push(check("y-offset-agrees", "fail", `${name}: ANIMATION_OFFSETS says ${offset}, row ${row} x ${FRAME_SIZE} says ${row * FRAME_SIZE}.`));
    }
    if (num !== 1 && num !== DIRECTIONS.length) {
      checks.push(check("direction-rows", "fail", `${name} declares ${num} direction rows; must be 1 (single facing) or ${DIRECTIONS.length}.`));
    }
  }
  if (!checks.some((c) => c.id === "row-block-bounds" || c.id === "row-block-overlap")) {
    checks.push(check("row-block-grid", "pass", `${occupied.size} rows covered without overlap.`));
  }

  // An alias names the row block it borrows frames from by that block's *folder* name
  // (`1h_slash` -> `backslash`), which is not necessarily a key of ANIMATION_CONFIGS.
  for (const [alias, target] of Object.entries(ROW_BLOCK_ALIASES)) {
    const owner = blocks.find((b) => rowBlockFolder(b.name) === target);
    if (!owner) {
      checks.push(check("alias-resolves", "fail", `${alias} aliases to row block "${target}", which no animation owns.`));
      continue;
    }
    const cfg = ANIMATION_CONFIGS[alias];
    if (!cfg) {
      checks.push(check("alias-resolves", "fail", `${alias} is listed as an alias but has no ANIMATION_CONFIGS entry.`));
      continue;
    }
    if (cfg.row !== owner.row || cfg.num !== owner.num) {
      checks.push(check("alias-row-agreement", "fail", `${alias} aliases to ${target} (rows ${owner.row}+${owner.num}) but declares rows ${cfg.row}+${cfg.num}.`));
    }
  }

  // Custom blocks: shape, base animation, reachability, and two-way drift with the pack.
  const defined = Object.keys(customAnimations);
  const provided = catalog.customAnimationProviders();
  for (const [name, def] of Object.entries(customAnimations)) {
    const widths = new Set(def.frames.map((rowFrames) => rowFrames.length));
    if (widths.size !== 1) {
      checks.push(check("custom-rectangular", "fail", `${name} rows are not equal length: ${[...widths].join(", ")} columns.`));
    }
    if (!(def.frameSize > 0)) {
      checks.push(check("custom-frame-size", "fail", `${name} declares frameSize ${def.frameSize}.`));
    }
    // Frames tables name the base by its row-block folder (`backslash`), which is not a
    // ANIMATION_CONFIGS key the way `1h_backslash` is — resolve it the same way the engine does.
    const base = customAnimationBase(def);
    const baseOk = base in ANIMATION_CONFIGS || blocks.some((b) => rowBlockFolder(b.name) === base);
    if (!baseOk) {
      checks.push(check("custom-base", "fail", `${name} is derived from "${base}", which owns no row block.`));
    }
  }
  const unreachable = defined.filter((n) => !(provided[n]?.length));
  const unknown = Object.keys(provided).filter((n) => !customAnimations[n]);
  if (unknown.length) {
    checks.push(check("custom-unknown-to-port", "fail", `the pack provides custom blocks this port does not define: ${unknown.join(", ")}. Renders will silently omit them.`, { unknown }));
  }
  if (unreachable.length) {
    checks.push(check("custom-unreachable", "warn", `defined upstream but no item in this pack provides them: ${unreachable.join(", ")}.`, { unreachable }));
  }
  checks.push(check(
    "custom-reachability",
    unknown.length ? "fail" : "pass",
    `${defined.length - unreachable.length}/${defined.length} defined custom blocks are reachable from pack items.`,
  ));

  return {
    checks,
    pack: { revision: packRevision(catalog.assetsDir) },
    summary: summarize(checks),
    rowBlocks: blocks.length,
  };
}

/** Alpha-opaque pixel count per frame cell of one row of the rendered sheet. */
function paintedColumns(ctx, y, columns, frameSize = FRAME_SIZE) {
  const counts = [];
  for (let col = 0; col < columns; col++) {
    const data = ctx.getImageData(col * frameSize, y, frameSize, frameSize).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    counts.push(painted);
  }
  return counts;
}

/** hurt and climb ship one direction row; the engine's table records which facing. */
function singleRowIndex(name) {
  return Math.max(0, DIRECTIONS.indexOf(SINGLE_ROW_DIRECTION[name] ?? DIRECTIONS[0]));
}

export async function validateCharacter(engine, args, { bodyType, selections }) {
  const { canvas, layout, warnings } = await engine.renderCharacter({
    bodyType,
    selections,
    matchBodyColorEnabled: args.match_body_color !== false,
  });
  const ctx = canvas.getContext("2d");
  const checks = [];
  let emptyRows = 0;
  let overdrawn = 0;

  for (const [name, cfg] of Object.entries(ANIMATION_CONFIGS)) {
    if (ROW_BLOCK_ALIASES[name]) continue;
    const declared = ANIMATION_FRAME_COUNTS[rowBlockFolder(name)];
    const rows = cfg.num === 1 ? [singleRowIndex(name)] : [0, 1, 2, 3].slice(0, cfg.num);
    for (const dirIndex of rows) {
      const counts = paintedColumns(ctx, (cfg.row + dirIndex) * FRAME_SIZE, STANDARD_ANIMATION_FRAMES_PER_ROW);
      const painted = counts.filter((n) => n > 0).length;
      if (painted === 0) {
        emptyRows++;
        continue;
      }
      if (painted > declared) {
        overdrawn++;
        checks.push(check("painted-beyond-declared", "fail", `${name} row ${cfg.row + dirIndex} paints ${painted} columns but the table declares ${declared}.`));
      }
    }
  }
  if (!checks.some((c) => c.id === "painted-beyond-declared")) {
    checks.push(check("painted-beyond-declared", "pass", "no standard row paints more columns than its declared frame count."));
  }
  // An empty row is the documented upstream-gap path, not a port bug: it means the selected items
  // ship no art for that animation. Report it as a warning and defer to the render's own warnings.
  if (emptyRows) {
    checks.push(check("empty-rows", "warn", `${emptyRows} standard direction row(s) came back fully transparent — expected when a selected item ships no art for that animation (see warnings).`, { emptyRows }));
  } else {
    checks.push(check("empty-rows", "pass", "every standard direction row has painted pixels."));
  }

  for (const block of layout.custom) {
    const counts = paintedColumns(ctx, block.yOffset, block.columns, block.frameSize, canvas.width);
    const painted = counts.filter((n) => n > 0).length;
    if (painted === 0) {
      checks.push(check("custom-block-empty", "warn", `${block.name} block at y ${block.yOffset} is empty despite being requested.`, { block: block.name }));
    } else if (painted < block.columns) {
      checks.push(check("custom-block-partial", "warn", `${block.name} paints ${painted}/${block.columns} columns.`, { block: block.name }));
    } else {
      checks.push(check("custom-block", "pass", `${block.name} paints all ${block.columns} ${block.frameSize}px columns.`, { block: block.name }));
    }
  }
  checks.push(check("sheet-dimensions", "pass", `${canvas.width}x${canvas.height}, ${layout.custom.length} custom block(s) appended.`, { width: canvas.width, height: canvas.height }));

  return {
    checks,
    warnings,
    pack: { revision: packRevision(engine.catalog.assetsDir) },
    summary: summarize(checks),
    character: { bodyType, customBlocks: layout.custom.map((b) => b.name) },
  };
}

/** Item definitions vs the port's tables: the cheap, no-render audit. */
export function validateCatalog(catalog, { category, limit = 50 }) {
  const checks = [];
  const names = category ? [category] : catalog.listTypeNames();
  const cappedNames = names.slice(0, CHECKS_MAX_CATEGORY);
  const maxItems = Math.max(1, Math.min(limit, 200));
  let unknownAnimations = 0;
  let partialLayers = 0;
  let noBodyType = 0;
  const offenders = [];
  let items = 0;
  outer: for (const name of cappedNames) {
    for (const item of catalog.getItemsByType(name, null)) {
      if (items >= maxItems) break outer;
      items++;
      for (const anim of item.animations ?? []) {
        // An item may declare a custom block name (wheelchair, walk_128) instead of a row block.
        if ((anim in ANIMATION_CONFIGS) || (anim in customAnimations)) continue;
        unknownAnimations++;
        if (unknownAnimations <= 10) {
          offenders.push(`${item.itemId} declares "${anim}"`);
        }
      }
      const bodyTypes = item.required;
      if (!bodyTypes.length) {
        noBodyType++;
        continue;
      }
      for (const [layerNum, layer] of Object.entries(item.layers)) {
        if (layerNum === "layer_1") continue;
        const missing = bodyTypes.filter((b) => !layer[b]);
        if (missing.length) {
          partialLayers++;
          if (partialLayers <= 10) {
            checks.push(check("item-layer-partial", "warn", `${item.itemId} ${layerNum} ships no art for ${missing.join(", ")} of the body types the item claims; that layer disappears for them.`));
          }
        }
      }
    }
  }
  if (unknownAnimations) {
    checks.push(check(
      "item-animation-unknown",
      "fail",
      `${unknownAnimations} animation declaration(s) name neither a row block nor a custom block this port knows: ${offenders.join("; ")}.`,
      { unknownAnimations },
    ));
  } else {
    checks.push(check("item-animation-unknown", "pass", `${items} item definitions checked; every declared animation resolves in the port's tables.`));
  }
  if (!partialLayers) {
    checks.push(check("item-layer-partial", "pass", "every checked item's layers cover every body type the item claims."));
  }
  if (noBodyType) {
    checks.push(check("item-bodytype-none", "fail", `${noBodyType} checked item(s) declare no supported body type at all, so they can never render.`));
  } else {
    checks.push(check("item-bodytype-none", "pass", "every checked item supports at least one body type."));
  }
  return {
    checks,
    pack: { revision: packRevision(catalog.assetsDir) },
    summary: summarize(checks),
    scope: { categoriesChecked: cappedNames.length, itemsChecked: items, limit: maxItems },
  };
}

export function summarize(checks) {
  return {
    fail: checks.filter((c) => c.status === "fail").length,
    warn: checks.filter((c) => c.status === "warn").length,
    pass: checks.filter((c) => c.status === "pass").length,
  };
}
