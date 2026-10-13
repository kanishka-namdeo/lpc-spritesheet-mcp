#!/usr/bin/env node
// lpc-spritesheet MCP server — headless Universal LPC character spritesheet
// generation using the LiberatedPixelCup asset pack.
//
// Tools:
//   list_categories   — selection groups (type_name) with item counts
//   list_items        — items in a category, with variants + valid colors
//   list_palettes     — color palettes per material (body/hair/cloth/eye/…)
//   list_animations   — animation table incl. row layout + custom animations
//   generate_spritesheet — render the full universal sheet PNG
//   get_animation     — render + crop one animation (standard or custom)
//   get_preview       — render + crop a playback strip for one direction
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createCanvas } from "@napi-rs/canvas";
import { assetCandidates, hasAssets } from "./assets-dir.js";
import { Catalog } from "./engine/catalog.js";
import { SpriteEngine } from "./engine/sheet.js";
import {
  BODY_TYPES,
  DIRECTIONS,
  FRAME_SIZE,
  ANIMATION_CONFIGS,
  ROW_BLOCK_ALIASES,
  SHEET_WIDTH,
  SINGLE_ROW_DIRECTION,
  resolveAnimationName,
  rowBlockFrames,
  rowBlockYOffset,
} from "./engine/constants.js";
import { customAnimations, customAnimationBase } from "./engine/custom-animations.js";
import { renderAndSave, errorPayload, unknownArgWarnings, CharacterRequestError } from "./character.js";

/**
 * Locate the Universal-LPC-Spritesheet-Character-Generator asset clone
 * (order lives in `src/assets-dir.js`). Missing assets fail here, on stderr,
 * before the transport connects — the phrase below is asserted by CI.
 */
function resolveAssetsDir() {
  const candidates = assetCandidates();
  const found = candidates.find(hasAssets);
  if (found) return found;
  console.error(
    [
      "[lpc-spritesheet] ERROR: the LPC asset pack is not installed. This server does not",
      "[lpc-spritesheet] bundle the ~350MB of game assets; it reads them from a local clone of",
      "[lpc-spritesheet] https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator",
      "[lpc-spritesheet]",
      "[lpc-spritesheet] Fix (pick one):",
      "[lpc-spritesheet]   1. Run: npm run setup-assets   (clones into ~/.lpc-spritesheet/lpc-generator-src)",
      "[lpc-spritesheet]   2. Clone it yourself next to this package as 'lpc-generator-src', or anywhere, then set",
      "[lpc-spritesheet]      the LPC_ASSETS_DIR environment variable to that folder in your MCP client config.",
      "[lpc-spritesheet] Searched: " + candidates.join(", "),
    ].join("\n"),
  );
  process.exit(1);
}

const ASSETS_DIR = resolveAssetsDir();

console.error(`[lpc-spritesheet] loading catalog from ${ASSETS_DIR} ...`);
const catalog = new Catalog(ASSETS_DIR);
const engine = new SpriteEngine(catalog);
console.error(
  `[lpc-spritesheet] ready: ${catalog.itemsById.size} items, ${catalog.byTypeName.size} groups`,
);

// ---------------------------------------------------------------------------
// Catalog tool payloads
// ---------------------------------------------------------------------------

function listCategories() {
  const categories = [];
  for (const [typeName, ids] of catalog.byTypeName) {
    const items = ids.map((id) => catalog.getItem(id));
    const withRecolor = items.filter((i) => i.recolors.length > 0).length;
    categories.push({
      category: typeName,
      items: items.length,
      colorable: withRecolor,
      example: items.slice(0, 3).map((i) => i.itemId),
    });
  }
  categories.sort((a, b) => b.items - a.items);
  return {
    bodyTypes: BODY_TYPES,
    note: "Use list_items(category=...) for options. Items with colorable>0 take colors.<category> values.",
    categories,
  };
}

function listItems(args) {
  const category = args.category;
  if (!category || typeof category !== "string") {
    return {
      error: "category is required",
      validCategories: catalog.listTypeNames(),
    };
  }
  if (!catalog.byTypeName.has(category)) {
    return {
      error: `Unknown category "${category}".`,
      validCategories: catalog.listTypeNames(),
    };
  }
  if (args.bodyType !== undefined && !BODY_TYPES.includes(args.bodyType)) {
    return {
      error: `Unknown bodyType "${args.bodyType}".`,
      validBodyTypes: BODY_TYPES,
    };
  }

  const unfiltered = catalog.getItemsByType(category, args.bodyType ?? null);
  let items = unfiltered;
  if (args.search) {
    if (typeof args.search !== "string") {
      return { error: "search must be a string." };
    }
    const q = args.search.toLowerCase();
    items = items.filter(
      (i) => i.itemId.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
    );
  }

  if (!Number.isInteger(args.limit) && args.limit !== undefined) {
    return { error: "limit must be an integer." };
  }
  if (!Number.isInteger(args.offset) && args.offset !== undefined) {
    return { error: "offset must be an integer." };
  }
  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  const page = items.slice(offset, offset + limit);

  // Hoist recolor palettes out of the item list: identical color lists are
  // emitted once and referenced by id, keeping responses small.
  /** @type {Record<string, string[]>} */
  const palettes = {};
  const refCache = new Map();
  const paletteRef = (recolorEntry) => {
    const json = recolorEntry.variants.join("|");
    if (!refCache.has(json)) {
      const ref = `${recolorEntry.material}.${recolorEntry.base}`;
      refCache.set(json, ref);
      palettes[ref] = recolorEntry.variants;
    }
    return refCache.get(json);
  };

  return {
    category,
    total: items.length,
    ...(items.length !== unfiltered.length ? { unfilteredTotal: unfiltered.length } : {}),
    showing: { offset, count: page.length },
    palettes,
    items: page.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      variants: item.variants.length ? item.variants : undefined,
      colors: item.recolors.length
        ? item.recolors.map((r) => ({
            slot: r.label,
            typeName: r.type_name ?? undefined,
            material: r.material,
            default: r.variants[0],
            palette: paletteRef(r),
            matchBodyColor: item.matchBodyColor || undefined,
          }))
        : undefined,
      customAnimation: Object.values(item.layers).find((l) => l.custom_animation)?.custom_animation,
    })),
  };
}

function listPalettes(args) {
  const materials = catalog.paletteMetadata.materials;
  const wanted = args.material;
  if (wanted !== undefined && (typeof wanted !== "string" || !materials[wanted])) {
    return {
      error: `Unknown material "${wanted}".`,
      validMaterials: Object.keys(materials),
    };
  }
  const out = {};
  for (const [name, mat] of Object.entries(materials)) {
    if (wanted && name !== wanted) continue;
    out[name] = {
      label: mat.label,
      default: mat.default,
      base: mat.base,
      versions: Object.fromEntries(
        Object.entries(mat.palettes).map(([version, colors]) => [version, Object.keys(colors)]),
      ),
    };
  }
  return {
    note: "Color names are used in colors.<group> or selections.<group>.recolor. Version prefixes (e.g. lpcr.white) select a different palette version.",
    materials: out,
  };
}

function listAnimations() {
  const standard = {};
  for (const [name, cfg] of Object.entries(ANIMATION_CONFIGS)) {
    const alias = ROW_BLOCK_ALIASES[name];
    standard[name] = {
      label: name,
      row: cfg.row,
      directionRows: cfg.num,
      directions: cfg.num === 1 ? [SINGLE_ROW_DIRECTION[name] ?? DIRECTIONS[0]] : DIRECTIONS,
      frames: rowBlockFrames(name),
      cycle: cfg.cycle,
      yOffset: rowBlockYOffset(name),
      notes: alias
        ? `alias: shares the ${alias} row block`
        : name === "combat"
          ? "canonical name of the combat_idle row block (get_animation and get_preview also accept combat_idle)"
          : undefined,
    };
  }
  const itemsByCustom = {};
  for (const item of catalog.itemsById.values()) {
    for (const layer of Object.values(item.layers)) {
      if (layer.custom_animation && !itemsByCustom[layer.custom_animation]?.includes(item.itemId)) {
        (itemsByCustom[layer.custom_animation] ??= []).push(item.itemId);
      }
    }
  }
  const custom = Object.fromEntries(
    Object.entries(customAnimations).map(([name, def]) => [
      name,
      {
        frameSize: def.frameSize,
        rows: def.frames.length,
        columns: def.frames[0].length,
        baseAnimation: customAnimationBase(def),
        usedBy: itemsByCustom[name] ?? [],
      },
    ]),
  );
  return {
    sheetLayout:
      "13 columns x 54 rows of 64px frames (832x3456); each animation occupies `directionRows` rows starting at `row` (64px each); directions order = up,left,down,right; frames are actually-present frame columns.",
    standard,
    custom,
    customNote:
      "Custom blocks are appended below the standard 54-row sheet and can also widen the canvas (128/192px frames). They appear in a render only when the character includes an item from usedBy.",
  };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "lpc-spritesheet", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

const CHARACTER_PROPS = {
  bodyType: {
    type: "string",
    enum: [...BODY_TYPES],
    description: "Body type. Default: male.",
  },
  selections: {
    type: "object",
    description:
      'Selection groups (type_name from list_categories) -> itemId | "none" | {itemId, variant?, recolor?}. Defaults: body=light, head=human male, expression=neutral. Use list_items to discover itemIds.',
    additionalProperties: true,
  },
  colors: {
    type: "object",
    description:
      'Color overrides per selection group, e.g. {body:"amber", hair:"blonde", clothes:"red", eyes:"blue"}. Color names from list_palettes / list_items.',
    additionalProperties: { type: "string" },
  },
  character: {
    type: "object",
    description:
      "Alternatively, a saved-character JSON (app export, {version:2, selections}) as the base. Explicit selections/colors merge on top.",
    additionalProperties: true,
  },
  match_body_color: {
    type: "boolean",
    description: "Propagate body color to head/face/ears. Default true.",
  },
  output_path: {
    type: "string",
    description: "Absolute or relative PNG output path. Default: <server dir>/output/<name>-<timestamp>.png",
  },
  include_credits: {
    type: "boolean",
    description: "Also write <name>-credits.csv/.txt with per-asset attribution (required by the asset licenses). Default true.",
  },
  include_character_json: {
    type: "boolean",
    description: "Also write <name>-character.json with the resolved selections. Default false.",
  },
};

const CHAR_ARG_KEYS = Object.keys(CHARACTER_PROPS);

const TOOLS = [
  {
    name: "generate_spritesheet",
    description:
      "Generate a Universal LPC character spritesheet PNG: 13x54 grid of 64px frames (832x3456) with all standard animations (spellcast/thrust/walk/slash/shoot/hurt/climb/idle/jump/sit/emote/run/combat_idle/backslash/halfslash). Custom-animation blocks (wheelchair, oversize weapons) are appended below and can widen the canvas (e.g. 1152/1536px) — exact offsets come back in the result layout for engine integration.",
    inputSchema: { type: "object", properties: CHARACTER_PROPS },
  },
  {
    name: "get_animation",
    description:
      "Generate a character and crop ONE animation into its own sheet PNG (e.g. walk = 832x256, 9 frames x 4 directions up/left/down/right). Accepts standard animations or custom ones (wheelchair, slash_128, tool_axe, ...).",
    inputSchema: {
      type: "object",
      properties: {
        ...CHARACTER_PROPS,
        animation: { type: "string", description: "Animation name from list_animations (standard or custom). Required." },
      },
      required: ["animation"],
    },
  },
  {
    name: "get_preview",
    description:
      "Generate a character and return a small horizontal strip PNG of one animation's playback cycle for one direction — quick visual check of a character design.",
    inputSchema: {
      type: "object",
      properties: {
        ...CHARACTER_PROPS,
        animation: { type: "string", description: "Standard animation name. Default: walk." },
        direction: { type: "string", enum: [...DIRECTIONS], description: "Default: down. (hurt/climb have a single facing; any direction is accepted.)" },
        scale: { type: "integer", minimum: 1, maximum: 8, description: "Nearest-neighbor upscale factor. Default 1." },
      },
    },
  },
  {
    name: "list_categories",
    description: "List all customizable selection groups (body, hair, head, ears, clothes, legs, shoes, weapon, hat, shield, tail, wings, ...) with item counts. Start here to discover what a character can wear.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_items",
    description: "List the selectable items of one category with exact itemIds, names, pre-sliced variants and valid recolor colors (colors are deduplicated into a response-level `palettes` map, referenced per item).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category (type_name) from list_categories. Required." },
        bodyType: { type: "string", enum: [...BODY_TYPES], description: "Only items supporting this body type." },
        search: { type: "string", description: "Case-insensitive substring filter on itemId or name." },
        limit: { type: "integer", description: "Default 50, max 200." },
        offset: { type: "integer", description: "Pagination offset." },
      },
      required: ["category"],
    },
  },
  {
    name: "list_palettes",
    description: "List color palettes per material (body=skintone, hair, cloth, eye, metal, wood, all) with the exact color names usable in colors.*",
    inputSchema: {
      type: "object",
      properties: { material: { type: "string", description: "Optional material filter." } },
    },
  },
  {
    name: "list_animations",
    description: "List all animations with their row layout on the universal sheet (rows, frame counts, playback cycles) and the custom-animation definitions.",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "list_categories":
        return jsonResult(listCategories());
      case "list_items":
        return jsonResultOrError(listItems(args));
      case "list_palettes":
        return jsonResultOrError(listPalettes(args));
      case "list_animations":
        return jsonResult(listAnimations());
      case "generate_spritesheet":
        return jsonResult(
          await renderAndSave(engine, args, {
            defaultName: "lpc-character",
            preWarnings: unknownArgWarnings(args, CHAR_ARG_KEYS),
            extract: ({ canvas, layout }) => ({ canvas, layout }),
          }),
        );
      case "get_animation": {
        const animation = args.animation;
        if (!animation || typeof animation !== "string") {
          throw new CharacterRequestError("animation is required (a name from list_animations).");
        }
        const isCustom = !ANIMATION_CONFIGS[resolveAnimationName(animation)];
        const preWarnings = unknownArgWarnings(args, [...CHAR_ARG_KEYS, "animation"]);
        return jsonResult(
          await renderAndSave(engine, args, {
            defaultName: `lpc-${animation}`,
            preWarnings,
            extract: ({ canvas, layout }) => {
              if (isCustom) {
                const block = layout.custom.find((c) => c.name === animation);
                if (!block) {
                  if (!customAnimations[animation]) {
                    throw new CharacterRequestError(
                      `Unknown animation "${animation}". Standard names: ${Object.keys(ANIMATION_CONFIGS).join(", ")}. Custom names: ${Object.keys(customAnimations).join(", ")}. See list_animations.`,
                    );
                  }
                  const usingItems = [];
                  for (const item of catalog.itemsById.values()) {
                    if (Object.values(item.layers).some((l) => l.custom_animation === animation)) {
                      usingItems.push(item.itemId);
                    }
                  }
                  throw new CharacterRequestError(
                    usingItems.length > 0
                      ? `Custom animation "${animation}" is not part of this character. Add a selections item that uses it, e.g.: ${usingItems.join(", ")}`
                      : `"${animation}" is a valid custom animation but no catalog item currently provides it. See list_animations for available ones.`,
                  );
                }
                const cropped = engine.extractCustomAnimation(canvas, layout, animation);
                return {
                  canvas: cropped,
                  layout: {
                    croppedAnimation: animation,
                    frameSize: block.frameSize,
                    rows: block.rows,
                    columns: block.columns,
                    yOffsetInFullSheet: block.yOffset,
                  },
                  extra: { animation, frameSize: block.frameSize },
                  suffix: `-${animation}`,
                };
              }
              const animKey = resolveAnimationName(animation);
              const config = ANIMATION_CONFIGS[animKey];
              const cropped = engine.extractAnimation(canvas, animation);
              return {
                canvas: cropped,
                layout: {
                  croppedAnimation: animation,
                  frameSize: FRAME_SIZE,
                  width: SHEET_WIDTH,
                  height: config.num * FRAME_SIZE,
                  row: config.row,
                  rows: config.num,
                  frames: rowBlockFrames(animKey),
                  cycle: config.cycle,
                  yOffsetInFullSheet: rowBlockYOffset(animKey),
                },
                extra: { animation },
                suffix: `-${animation}`,
              };
            },
          }),
        );
      }
      case "get_preview": {
        const animation = args.animation ?? "walk";
        if (typeof animation !== "string" || !ANIMATION_CONFIGS[resolveAnimationName(animation)]) {
          throw new CharacterRequestError(
            `get_preview takes a standard animation (got "${animation}"). For custom animations use get_animation. Standard: ${Object.keys(ANIMATION_CONFIGS).join(", ")}.`,
          );
        }
        const direction = args.direction ?? "down";
        if (typeof direction !== "string" || !DIRECTIONS.includes(direction)) {
          throw new CharacterRequestError(
            `Unknown direction "${direction}". Valid: ${DIRECTIONS.join(", ")}.`,
          );
        }
        const scale = args.scale ?? 1;
        if (args.scale !== undefined && (!Number.isInteger(args.scale) || args.scale < 1 || args.scale > 8)) {
          throw new CharacterRequestError("scale must be an integer between 1 and 8.");
        }
        return jsonResult(
          await renderAndSave(engine, args, {
            defaultName: `lpc-preview-${animation}-${direction}`,
            preWarnings: unknownArgWarnings(args, [...CHAR_ARG_KEYS, "animation", "direction", "scale"]),
            extract: ({ canvas }) => {
              const strip = engine.extractPreviewStrip(canvas, animation, direction);
              let out = strip.canvas;
              if (scale > 1) {
                const scaled = createCanvas(out.width * scale, out.height * scale);
                const ctx = scaled.getContext("2d");
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(out, 0, 0, scaled.width, scaled.height);
                out = scaled;
              }
              return {
                canvas: out,
                layout: null,
                extra: {
                  animation,
                  direction,
                  scale,
                  frames: strip.frames,
                  frameSize: FRAME_SIZE * scale,
                },
              };
            },
          }),
        );
      }
      default:
        return jsonError({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return jsonError(errorPayload(err));
  }
});

function jsonResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function jsonError(payload) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function jsonResultOrError(payload) {
  return payload?.error ? jsonError(payload) : jsonResult(payload);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[lpc-spritesheet] MCP server listening on stdio");
