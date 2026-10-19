#!/usr/bin/env node
// lpc-spritesheet MCP server — headless Universal LPC character spritesheet
// generation using the LiberatedPixelCup asset pack.
//
// Tools:
//   list_categories   — selection groups (type_name) with item counts
//   list_items        — items in a category, with variants + valid colors (byte-budgeted)
//   list_palettes     — color palettes per material (body/hair/cloth/eye/…)
//   list_animations   — animation table incl. row layout + custom animations
//   generate_spritesheet — render the full universal sheet PNG
//   get_animation     — render + crop one animation (standard or custom)
//   get_preview       — render + crop a playback strip for one direction
//   export_character  — render + fan out into an engine-ready directory bundle
//   validate_sheet    — audit the port's tables, the pack, or one character; writes nothing
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { assetCandidates, hasAssets, packRevision } from "./assets-dir.js";
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
import { normalizeSelections } from "./engine/selection.js";
import { getAllCredits, creditsToCsv, creditsToTxt } from "./engine/credits.js";
import { generatorUrl } from "./spec.js";
import { renderAndSave, errorPayload, unknownArgWarnings, CharacterRequestError, buildSelections, describeSelections, DEFAULT_OUTPUT_DIR, timestamp } from "./character.js";
import { exportBundle, ATLAS_FORMATS } from "./export.js";
import { validateLayout, validateCharacter, validateCatalog, summarize } from "./validate.js";
import { listPresets, presetNames } from "./presets.js";
import { randomCharacter } from "./random.js";
import { encodeAnimatedGif, gifFrameDelay } from "./engine/gif.js";
import { aiConfigFromEnv, designCharacter as designCharacterWithAI, buildCatalogDigest, VALID_AI_MODELS as AI_MODELS } from "./ai.js";

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
      "[lpc-spritesheet]   1. Run: lpc-spritesheet-setup   (npm run setup-assets from a checkout)",
      "[lpc-spritesheet]      Clones into ~/.lpc-spritesheet/lpc-generator-src",
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

/** Per-item keys `list_items` can emit; also the full default field set. */
const LIST_ITEM_FIELDS = ["itemId", "name", "variants", "colors", "customAnimation"];

/**
 * Cap on the serialized `list_items` response. Measured against the live pack, an uncut `hat`
 * page is 24.4 KB (~6.8k tokens) and `head` 20.6 KB, which is more context than the render it is
 * being used to plan.
 */
const LIST_ITEMS_BYTE_BUDGET = 12_000;

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
  if (args.fields !== undefined) {
    if (!Array.isArray(args.fields) || args.fields.some((f) => !LIST_ITEM_FIELDS.includes(f))) {
      return {
        error: `fields must be an array of: ${LIST_ITEM_FIELDS.join(", ")}.`,
      };
    }
  }
  const fields = new Set(args.fields ?? LIST_ITEM_FIELDS);
  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  const page = items.slice(offset, offset + limit);

  /**
   * Assemble a response for exactly these items. Hoists recolor palettes out of the item list
   * (identical color lists are emitted once and referenced by id) and prunes them to what is kept,
   * so a budget cut cannot leave a palette entry that no returned item references.
   */
  const assemble = (kept) => {
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
      showing: { offset, count: kept.length },
      palettes,
      items: kept.map((item) => ({
        ...(fields.has("itemId") ? { itemId: item.itemId } : {}),
        ...(fields.has("name") ? { name: item.name } : {}),
        ...(fields.has("variants") && item.variants.length ? { variants: item.variants } : {}),
        ...(fields.has("colors") && item.recolors.length
          ? {
              colors: item.recolors.map((r) => ({
                slot: r.label,
                typeName: r.type_name ?? undefined,
                material: r.material,
                default: r.variants[0],
                palette: paletteRef(r),
                matchBodyColor: item.matchBodyColor || undefined,
              })),
            }
          : {}),
        ...(fields.has("customAnimation")
          ? { customAnimation: Object.values(item.layers).find((l) => l.custom_animation)?.custom_animation }
          : {}),
      })),
    };
  };

  // Trim from the end until the response fits the budget: a discovery call must not cost more
  // context than the render it is planning. One item is always returned, however big it is.
  let kept = page;
  let payload = finalizeItems(assemble(kept), kept.length, page.length, offset);
  while (kept.length > 1 && sizeOf(payload) > LIST_ITEMS_BYTE_BUDGET) {
    kept = kept.slice(0, -1);
    payload = finalizeItems(assemble(kept), kept.length, page.length, offset);
  }
  return payload;
}

/** Serialized size of a payload, as the tool envelope sends it. */
function sizeOf(payload) {
  return JSON.stringify(payload, null, 2).length;
}

/**
 * Add the budget keys, then the serialized size last — `bytes` must describe the response the
 * caller actually receives, including the cut notice itself. The two passes settle the digit count.
 */
function finalizeItems(payload, returned, requested, offset) {
  const truncated = returned < requested;
  if (truncated) {
    payload.truncated = true;
    payload.nextOffset = offset + returned;
  }
  if (returned === 1 && sizeOf(payload) > LIST_ITEMS_BYTE_BUDGET) payload.oversizedItem = true;
  if (truncated || payload.oversizedItem) {
    payload.note =
      `Response cut to fit ${LIST_ITEMS_BYTE_BUDGET} bytes. Ask for fewer fields (e.g. fields:["itemId","name"]) ` +
      "or continue with offset for the rest.";
  }
  let bytes = sizeOf({ ...payload, bytes: 0 });
  bytes = sizeOf({ ...payload, bytes });
  payload.bytes = bytes;
  return payload;
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
  const itemsByCustom = catalog.customAnimationProviders();
  const custom = Object.fromEntries(
    Object.entries(customAnimations).map(([name, def]) => [
      name,
      {
        frameSize: def.frameSize,
        rows: def.frames.length,
        columns: def.frames[0].length,
        baseAnimation: customAnimationBase(def),
        available: (itemsByCustom[name] ?? []).length > 0,
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
      "Custom blocks are appended below the standard 54-row sheet and can also widen the canvas (up to 1664px with 128/192px frames). They appear in a render only when the character includes an item from usedBy. Blocks with available:false are defined upstream but no item in this pack provides them, so no character can render them.",
  };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const SERVER_VERSION = "1.4.0";

const server = new Server(
  { name: "lpc-spritesheet", version: SERVER_VERSION },
  { capabilities: { tools: {}, prompts: {}, resources: {} } },
);

const CHARACTER_PROPS = {
  bodyType: {
    type: "string",
    enum: [...BODY_TYPES],
    description: "Body type. Default: male.",
  },
  preset: {
    type: "string",
    description: "Named starting character from list_presets (e.g. knight, mage, blacksmith). Its selections/colors/bodyType form the base; explicit selections/colors merge on top.",
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
    description: "Absolute or relative PNG output path (parents are created; relative resolves against the server's cwd). Default: lpc-spritesheet/<name>-<timestamp>.png under the OS temp directory.",
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

// export_character writes a directory, not one file, so `output_path` is deliberately not offered:
// a caller that passes it gets an unknown-argument warning naming output_dir instead of a silently
// ignored path.
const { output_path: _unusedOutputPath, ...BUNDLE_CHARACTER_PROPS } = CHARACTER_PROPS;
const BUNDLE_ARG_KEYS = [...Object.keys(BUNDLE_CHARACTER_PROPS), "output_dir", "mode", "atlas_format"];

// Preview-strip arguments shared by get_preview, random_character and design_character.
const PREVIEW_PROPS = {
  animation: { type: "string", description: "Standard animation name. Default: walk." },
  direction: { type: "string", enum: [...DIRECTIONS], description: "Default: down. (hurt/climb have a single facing; any direction is accepted.)" },
  scale: { type: "integer", minimum: 1, maximum: 8, description: "Nearest-neighbor upscale factor. Default 1 (2 for the random/design preview conveniences)." },
};

// Arguments random_character and generate_batch share.
const RANDOM_PROPS = {
  seed: { type: "string", description: "Any string; the same seed always produces the same character(s). Default: empty string." },
  gear: { type: "string", enum: ["bare", "civilian", "soldier", "fancy"], description: "Gear profile: how likely weapons/armour/hats are. Default: civilian." },
  complete_only: { type: "boolean", description: "Only pick items that paint both walk and idle rows for always-visible groups, so random characters never have empty core rows. Default: true." },
};

// validate_sheet renders but never writes, so the output and sidecar arguments are taken away too.
const {
  output_path: _validateNoPath,
  include_credits: _validateNoCredits,
  include_character_json: _validateNoJson,
  ...CHARACTER_ONLY_PROPS
} = CHARACTER_PROPS;

const TOOLS = [
  {
    name: "generate_spritesheet",
    description:
      "Generate a Universal LPC character spritesheet PNG: 13x54 grid of 64px frames (832x3456) with all standard animations (spellcast/thrust/walk/slash/shoot/hurt/climb/idle/jump/sit/emote/run/combat_idle/backslash/halfslash). Custom-animation blocks (wheelchair, oversize weapons) are appended below and can widen the canvas up to 1664px (13 columns of 128px) and grow it past 3456px — exact offsets, frame sizes and column counts come back in the result layout for engine integration.",
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
      "Generate a character and return a small horizontal strip PNG of one animation's playback cycle for one direction — quick visual check of a character design. format:gif returns the same cycle as a looping animated GIF (correct LPC playback order, transparency preserved) — small enough to come back inline so a character can be SEEN walking, not just inspected.",
    inputSchema: {
      type: "object",
      properties: {
        ...CHARACTER_PROPS,
        animation: { type: "string", description: "Standard animation name. Default: walk." },
        direction: { type: "string", enum: [...DIRECTIONS], description: "Default: down. (hurt/climb have a single facing; any direction is accepted.)" },
        scale: { type: "integer", minimum: 1, maximum: 8, description: "Nearest-neighbor upscale factor. Default 1." },
        format: { type: "string", enum: ["png", "gif"], description: "png = strip image (default). gif = looping animated GIF." },
        fps: { type: "number", minimum: 1, maximum: 30, description: "gif only: playback ticks per second. The LPC cycle already encodes per-frame holds (idle 0,0,1; sit holds 5 ticks), so one uniform tick rate is correct playback. Default 10 (= the web app's default)." },
      },
    },
  },
  {
    name: "export_character",
    description:
      "Generate a character and fan it out into a directory bundle an engine can import: sheet.png + a TexturePacker/Phaser JSON Hash atlas describing every frame rect, plus either one PNG per animation row block (mode=animation) or one PNG per frame (mode=frames), a manifest.json with the full layout and pack revision, and credits sidecars. No ZIP: consumers get paths.",
    inputSchema: {
      type: "object",
      properties: {
        ...BUNDLE_CHARACTER_PROPS,
        output_dir: {
          type: "string",
          description:
            "Directory to write the bundle into (created if missing). Default: lpc-<bodyType>-<mode>-<timestamp>/ under the OS temp directory.",
        },
        mode: {
          type: "string",
          enum: ["animation", "frames"],
          description: "animation = one PNG per row block (default). frames = one PNG per frame cell.",
        },
        atlas_format: {
          type: "string",
          enum: [...ATLAS_FORMATS],
          description: "Metadata dialect. Default texturepacker (JSON Hash), which Phaser and most importers read.",
        },
      },
    },
  },
  {
    name: "validate_sheet",
    description:
      "Audit the layout instead of rendering it: scope=layout checks the port's row-block tables against each other and against the pack's custom-animation blocks (no render, no files), scope=character renders one character in memory and compares painted columns per direction row against the declared frame counts, scope=catalog checks item definitions for animations this port does not know and layers that ship no art for a body type the item claims. Returns ok:false with a `checks` list naming what failed and why.",
    inputSchema: {
      type: "object",
      properties: {
        ...CHARACTER_ONLY_PROPS,
        scope: {
          type: "string",
          enum: ["layout", "character", "catalog"],
          description: "Default layout.",
        },
        category: { type: "string", description: "catalog scope: restrict to one selection group." },
        limit: { type: "integer", description: "catalog scope: max items to inspect. Default 50, max 200." },
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
    description:
      "List the selectable items of one category with exact itemIds, names, pre-sliced variants and valid recolor colors (colors are deduplicated into a response-level `palettes` map, referenced per item). Responses are byte-budgeted: check `truncated`/`nextOffset`, and pass `fields` to shrink them.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category (type_name) from list_categories. Required." },
        bodyType: { type: "string", enum: [...BODY_TYPES], description: "Only items supporting this body type." },
        search: { type: "string", description: "Case-insensitive substring filter on itemId or name." },
        limit: { type: "integer", description: "Default 50, max 200." },
        offset: { type: "integer", description: "Pagination offset." },
        fields: {
          type: "array",
          items: { type: "string", enum: [...LIST_ITEM_FIELDS] },
          description:
            'Which per-item keys to emit. Default: all. Use ["itemId","name"] to list a large category cheaply.',
        },
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
  {
    name: "list_presets",
    description: "List the curated character presets (knight, mage, blacksmith, farmer, ...) that any render tool accepts as preset: \"<name>\" — one call instead of a dozen discovery calls.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "random_character",
    description:
      "Roll a coherent random character from a seed: same seed → same character, forever. Returns ready-to-render selections/colors (feed them to generate_spritesheet/export_character), the upstream generator URL, and by default an inline walk preview strip so you can see it. Gear profiles (bare/civilian/soldier/fancy) tune how armed and fancy the roll is; complete_only keeps always-visible items to those that paint walk+idle.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANDOM_PROPS,
        bodyType: { type: "string", enum: [...BODY_TYPES], description: "Pin the body type instead of a weighted roll." },
        preview: { type: "boolean", description: "Also render a walk preview strip (inline PNG). Default: true." },
        ...PREVIEW_PROPS,
        output_path: { type: "string", description: "Optional PNG path for the preview strip. Default: lpc-spritesheet/lpc-random-<seed>-<animation>-<direction>.png under the OS temp directory." },
      },
    },
  },
  {
    name: "generate_batch",
    description:
      "Populate a village in one call: generate N random characters from one seed (character i uses seed \"<seed>:<i>\"), each rendered to its own directory with a full spritesheet, a walk preview, credits, plus a batch manifest.json, one rolled-up credits file, and index.png — a contact grid showing every character's walk frame. Same seed → same village.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANDOM_PROPS,
        count: { type: "integer", minimum: 1, maximum: 25, description: "How many characters. Default 5, max 25." },
        bodyType: { type: "string", enum: [...BODY_TYPES], description: "Pin every character to one body type. Default: weighted roll per character." },
        output_dir: { type: "string", description: "Directory for the batch (created if missing). Default: lpc-batch-<seed>-<timestamp>/ under the OS temp directory." },
        sheets: { type: "boolean", description: "Write a full 832x3456+ spritesheet PNG per character. Default: true." },
        previews: { type: "boolean", description: "Write a walk-down preview strip per character. Default: true." },
        index: { type: "boolean", description: "Write index.png (contact grid of every character's walk-down frame). Default: true." },
        include_credits: { type: "boolean", description: "Per-character credits sidecars plus one rolled-up batch-credits.csv/.txt. Default: true." },
      },
      required: ["count"],
    },
  },
  {
    name: "design_character",
    description:
      "Turn a natural-language brief (\"a tanned blacksmith with a leather apron and a hammer\") into ready-to-render selections/colors using an LLM grounded on this pack's catalog. OPT-IN: only available when LPC_AI_API_KEY is set in the server environment; without it the tool returns a clear setup error. Returns selections, colors, the model's rationale, the upstream generator URL, and by default an inline walk preview of the result.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The character brief in plain language. Required." },
        model: { type: "string", enum: [...AI_MODELS], description: "Per-call model override. Default: LPC_AI_MODEL env or qwen3.7-plus." },
        preview: { type: "boolean", description: "Also render a walk preview strip (inline PNG). Default: true." },
        ...PREVIEW_PROPS,
        output_path: { type: "string", description: "Optional PNG path for the preview strip." },
      },
      required: ["prompt"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool metadata: display titles, risk hints, and result schemas
//
// Annotations default to the unsafe end of the spectrum when they are absent — a client must
// assume a tool it has no hints about can destroy data and reach the network. Saying otherwise is
// the point. `outputSchema` is declared only where the payload shape is stable; the render tools
// return `layout`, which mirrors describeLayout, and a hand-written twin schema would rot.
// ---------------------------------------------------------------------------

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITES_FILE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const STR_SCHEMA = { type: "string" };
const INT_SCHEMA = { type: "integer" };
const BOOL_SCHEMA = { type: "boolean" };
const STRING_ARRAY = { type: "array", items: STR_SCHEMA };

const TOOL_META = {
  generate_spritesheet: { title: "Generate spritesheet", annotations: WRITES_FILE },
  get_animation: { title: "Crop one animation", annotations: WRITES_FILE },
  get_preview: { title: "Preview animation strip", annotations: WRITES_FILE },
  export_character: { title: "Export engine bundle", annotations: WRITES_FILE, outputSchema: {
    type: "object",
    properties: {
      mode: STR_SCHEMA,
      atlasFormat: STR_SCHEMA,
      outputDir: STR_SCHEMA,
      image: { type: "object", properties: { width: INT_SCHEMA, height: INT_SCHEMA, frameSize: INT_SCHEMA }, required: ["width", "height", "frameSize"] },
      frames: INT_SCHEMA,
      files: STRING_ARRAY,
      atlas: STR_SCHEMA,
      manifest: STR_SCHEMA,
      characterJson: STR_SCHEMA,
      warnings: STRING_ARRAY,
    },
    required: ["mode", "outputDir", "image", "files", "atlas", "manifest", "warnings"],
  } },
  validate_sheet: { title: "Validate sheet layout", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: {
      scope: STR_SCHEMA,
      ok: BOOL_SCHEMA,
      summary: { type: "object", properties: { fail: INT_SCHEMA, warn: INT_SCHEMA, pass: INT_SCHEMA }, required: ["fail", "warn", "pass"] },
      checks: { type: "array", items: { type: "object", properties: { id: STR_SCHEMA, status: { type: "string", enum: ["pass", "warn", "fail"] }, detail: STR_SCHEMA }, required: ["id", "status", "detail"] } },
      warnings: STRING_ARRAY,
    },
    required: ["scope", "ok", "summary", "checks", "warnings"],
  } },
  list_categories: { title: "List selection groups", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: {
      bodyTypes: STRING_ARRAY,
      note: STR_SCHEMA,
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: { category: STR_SCHEMA, items: INT_SCHEMA, colorable: INT_SCHEMA, example: STRING_ARRAY },
          required: ["category", "items", "colorable", "example"],
        },
      },
    },
    required: ["bodyTypes", "categories"],
  } },
  list_items: { title: "List items in a group", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: {
      category: STR_SCHEMA,
      total: INT_SCHEMA,
      unfilteredTotal: INT_SCHEMA,
      showing: { type: "object", properties: { offset: INT_SCHEMA, count: INT_SCHEMA }, required: ["offset", "count"] },
      palettes: { type: "object", additionalProperties: STRING_ARRAY },
      items: { type: "array", items: { type: "object" } },
      bytes: INT_SCHEMA,
      truncated: BOOL_SCHEMA,
      nextOffset: INT_SCHEMA,
      oversizedItem: BOOL_SCHEMA,
      note: STR_SCHEMA,
    },
    required: ["category", "total", "showing", "palettes", "items", "bytes"],
  } },
  list_palettes: { title: "List color palettes", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: { note: STR_SCHEMA, materials: { type: "object" } },
    required: ["note", "materials"],
  } },
  list_animations: { title: "List animations", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: {
      sheetLayout: STR_SCHEMA,
      standard: { type: "object" },
      custom: { type: "object" },
      customNote: STR_SCHEMA,
    },
    required: ["sheetLayout", "standard", "custom", "customNote"],
  } },
  list_presets: { title: "List character presets", annotations: READ_ONLY, outputSchema: {
    type: "object",
    properties: {
      note: STR_SCHEMA,
      presets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: STR_SCHEMA,
            description: STR_SCHEMA,
            bodyType: STR_SCHEMA,
            groups: STRING_ARRAY,
          },
          required: ["name", "description", "bodyType", "groups"],
        },
      },
    },
    required: ["note", "presets"],
  } },
  random_character: { title: "Roll a random character", annotations: WRITES_FILE },
  generate_batch: { title: "Generate an NPC batch", annotations: WRITES_FILE, outputSchema: {
    type: "object",
    properties: {
      count: INT_SCHEMA,
      seed: STR_SCHEMA,
      outputDir: STR_SCHEMA,
      characters: { type: "array", items: { type: "object" } },
      index: { type: "object" },
      manifest: STR_SCHEMA,
      credits: { type: "object" },
      warnings: STRING_ARRAY,
    },
    required: ["count", "seed", "outputDir", "characters", "manifest"],
  } },
  design_character: { title: "Design a character from a description", annotations: {
    // The one open-world tool: it calls an external AI endpoint, but only when the
    // operator configured LPC_AI_* env vars — the default server stays offline.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } },
};

for (const tool of TOOLS) {
  const meta = TOOL_META[tool.name];
  // A tool added without metadata would ship with no risk hints and no title: fail loudly at
  // startup instead. `test/mcp-client-test.mjs` pins the tool-name set, so this cannot go unseen.
  if (!meta) throw new Error(`Tool "${tool.name}" has no TOOL_META entry (title/annotations).`);
  Object.assign(tool, meta);
}

const SCHEMA_BY_TOOL = new Map(
  TOOLS.filter((t) => t.outputSchema).map((t) => [t.name, t.outputSchema]),
);

/** Ceiling on a PNG inlined as a `type:"image"` result block; see jsonResultWithImage. */
const MAX_INLINE_PNG_BYTES = 64 * 1024;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const schema = SCHEMA_BY_TOOL.get(name);
  try {
    switch (name) {
      case "list_categories":
        return jsonResult(listCategories(), schema);
      case "list_items":
        return jsonResultOrError(listItems(args), schema);
      case "list_palettes":
        return jsonResultOrError(listPalettes(args), schema);
      case "list_animations":
        return jsonResult(listAnimations(), schema);
      case "generate_spritesheet":
        return jsonResult(
          await renderAndSave(engine, args, {
            serverVersion: SERVER_VERSION,
            defaultName: "lpc-character",
            preWarnings: unknownArgWarnings(args, CHAR_ARG_KEYS),
            extract: ({ canvas, layout }) => ({ canvas, layout }),
          }),
          schema,
        );
      case "validate_sheet": {
        const scope = args.scope ?? "layout";
        const VALIDATE_ARG_KEYS = [
          ...Object.keys(CHARACTER_ONLY_PROPS),
          "scope",
          "category",
          "limit",
        ];
        const preWarnings = unknownArgWarnings(args, VALIDATE_ARG_KEYS);
        let result;
        if (scope === "layout") {
          result = validateLayout(catalog);
        } else if (scope === "catalog") {
          if (args.category && !catalog.byTypeName.has(args.category)) {
            return jsonError({
              error: `Unknown category "${args.category}".`,
              validCategories: catalog.listTypeNames(),
            });
          }
          result = validateCatalog(catalog, { category: args.category, limit: args.limit ?? 50 });
        } else if (scope === "character") {
          const { bodyType, selections } = buildSelections(engine, args);
          result = await validateCharacter(engine, args, { bodyType, selections });
        } else {
          return jsonError({ error: `Unknown scope "${scope}". Valid: layout, character, catalog.` });
        }
        const summary = result.summary ?? summarize(result.checks);
        return jsonResult({
          scope,
          ok: summary.fail === 0,
          pack: result.pack,
          summary,
          checks: result.checks,
          ...(result.character ? { character: result.character } : {}),
          ...(result.scope ? { inspected: result.scope } : {}),
          ...(result.rowBlocks !== undefined ? { rowBlocks: result.rowBlocks } : {}),
          warnings: [...preWarnings, ...(result.warnings ?? [])],
        }, schema);
      }
      case "export_character":
        return jsonResultOrError(
          await exportBundle(engine, args, {
            serverVersion: SERVER_VERSION,
            preWarnings: unknownArgWarnings(args, BUNDLE_ARG_KEYS),
          }),
          schema,
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
            serverVersion: SERVER_VERSION,
            defaultName: `lpc-${animation}`,
            preWarnings,
            extract: ({ canvas, layout }) => {
              if (isCustom) {
                const block = layout.custom.find((c) => c.name === animation);
                if (!block) {
                  if (!customAnimations[animation]) {
                    throw new CharacterRequestError(
                      `Unknown animation "${animation}". Standard names: ${Object.keys(ANIMATION_CONFIGS).join(", ")}. Custom names: ${engine.customAnimationNames().join(", ")}. See list_animations.`,
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
          schema,
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
        const format = args.format ?? "png";
        if (format !== "png" && format !== "gif") {
          throw new CharacterRequestError(`Unknown format "${format}". Valid: png, gif.`);
        }
        const fps = args.fps ?? 10;
        if (args.fps !== undefined && (typeof fps !== "number" || fps < 1 || fps > 30)) {
          throw new CharacterRequestError("fps must be a number between 1 and 30.");
        }
        return jsonResultWithImage(
          await renderAndSave(engine, args, {
            serverVersion: SERVER_VERSION,
            defaultName: `lpc-preview-${animation}-${direction}`,
            preWarnings: unknownArgWarnings(args, [...CHAR_ARG_KEYS, "animation", "direction", "scale", "format", "fps"]),
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
              // GIF: cut the (scaled) strip into per-frame canvases and encode with the
              // LPC cycle as the timing table — a uniform tick rate is correct playback
              // because the cycle already repeats held frames (idle 0,0,1, sit ×5).
              let gif = null;
              if (format === "gif") {
                const cell = FRAME_SIZE * scale;
                const frames = [];
                for (let i = 0; i < strip.frames.length; i++) {
                  const frameCanvas = createCanvas(cell, cell);
                  const frameCtx = frameCanvas.getContext("2d");
                  frameCtx.imageSmoothingEnabled = false;
                  frameCtx.drawImage(out, i * cell, 0, cell, cell, 0, 0, cell, cell);
                  frames.push({ canvas: frameCanvas, delayMs: gifFrameDelay(fps) });
                }
                gif = encodeAnimatedGif(frames);
              }
              return {
                canvas: out,
                gif,
                layout: null,
                inline: true,
                extra: {
                  animation,
                  direction,
                  scale,
                  ...(format === "gif" ? { fps, frames: strip.frames.length } : { frames: strip.frames }),
                  frameSize: FRAME_SIZE * scale,
                },
              };
            },
          }),
          schema,
        );
      }
      case "list_presets":
        return jsonResult({
          note: "Render any preset with preset: \"<name>\" on generate_spritesheet / get_animation / get_preview / export_character; explicit selections/colors merge on top of the preset.",
          presets: listPresets(),
        }, SCHEMA_BY_TOOL.get("list_presets"));
      case "random_character": {
        const payload = await randomCharacterTool(engine, args, catalog);
        return payload?.error ? jsonError(payload) : jsonResultWithImage(payload, SCHEMA_BY_TOOL.get("random_character"));
      }
      case "generate_batch":
        return jsonResultOrError(await generateBatchTool(engine, args, catalog), SCHEMA_BY_TOOL.get("generate_batch"));
      case "design_character": {
        const payload = await designCharacterTool(engine, args, catalog);
        return payload?.error ? jsonError(payload) : jsonResultWithImage(payload, SCHEMA_BY_TOOL.get("design_character"));
      }
      default:
        return jsonError({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return jsonError(errorPayload(err));
  }
});

/**
 * Responses are sent twice on purpose: pretty JSON text any client can read, and
 * `structuredContent` for clients that validate a declared `outputSchema`. The low-level Server
 * does not check conformance itself, so the pair is maintained here rather than hoped for.
 */
function jsonResult(payload, schema) {
  const { inlinePng, inlineImage, ...clean } = payload;
  return {
    content: [{ type: "text", text: JSON.stringify(clean, null, 2) }],
    ...(schema ? { structuredContent: clean } : {}),
  };
}

/**
 * `get_preview` crops are 2-4 KB, so the client can look at the character without opening a file.
 * A full sheet is 188-280 KB, which is not something to base64 into a conversation — the path is
 * the right primitive for those, so anything over the cap comes back as text only. The image
 * block is annotated `audience: ["user"]` + high priority: it is for the human to look at, not
 * for the model to reason over — though nothing stops a client from showing it either way.
 */
function jsonResultWithImage(payload, schema) {
  const result = jsonResult(payload, schema);
  const inline = payload.inlineImage ?? (payload.inlinePng ? { bytes: payload.inlinePng, mimeType: "image/png" } : null);
  if (inline && inline.bytes.length <= MAX_INLINE_PNG_BYTES) {
    result.content.push({
      type: "image",
      data: inline.bytes.toString("base64"),
      mimeType: inline.mimeType,
      annotations: { audience: ["user"], priority: 0.8 },
    });
  }
  return result;
}

function jsonError(payload) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function jsonResultOrError(payload, schema) {
  return payload?.error ? jsonError(payload) : jsonResult(payload, schema);
}

// ---------------------------------------------------------------------------
// random_character / generate_batch / design_character
// ---------------------------------------------------------------------------

/** Arguments the preview conveniences of random_character / design_character accept. */
const PREVIEW_CONVENIENCE_KEYS = ["preview", "animation", "direction", "scale", "output_path"];

/** Validate the shared preview-convenience args and return them normalized. */
function previewConvenienceArgs(args, defaults = {}) {
  const animation = args.animation ?? defaults.animation ?? "walk";
  if (typeof animation !== "string" || !ANIMATION_CONFIGS[resolveAnimationName(animation)]) {
    throw new CharacterRequestError(
      `animation must be a standard animation name (got "${animation}"). Standard: ${Object.keys(ANIMATION_CONFIGS).join(", ")}.`,
    );
  }
  const direction = args.direction ?? defaults.direction ?? "down";
  if (typeof direction !== "string" || !DIRECTIONS.includes(direction)) {
    throw new CharacterRequestError(`Unknown direction "${direction}". Valid: ${DIRECTIONS.join(", ")}.`);
  }
  const scale = args.scale ?? defaults.scale ?? 2;
  if (args.scale !== undefined && (!Number.isInteger(args.scale) || args.scale < 1 || args.scale > 8)) {
    throw new CharacterRequestError("scale must be an integer between 1 and 8.");
  }
  return { animation, direction, scale };
}

/**
 * Render a rolled/designed character config as a preview strip (the shared convenience of
 * random_character and design_character). Returns the render payload or null when disabled.
 */
async function renderPreviewOf(engine, args, character, { defaultName }) {
  const { animation, direction, scale } = previewConvenienceArgs(args);
  const preWarnings = unknownArgWarnings(args, [
    ...Object.keys(RANDOM_PROPS), "bodyType", ...PREVIEW_CONVENIENCE_KEYS,
  ]);
  return renderAndSave(engine, {
    bodyType: character.bodyType,
    selections: character.selections,
    colors: character.colors,
    output_path: args.output_path,
    animation,
    direction,
    scale,
  }, {
    serverVersion: SERVER_VERSION,
    defaultName,
    preWarnings,
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
        inline: true,
        extra: { animation, direction, scale, frames: strip.frames, frameSize: FRAME_SIZE * scale },
      };
    },
  });
}

/** random_character: roll from a seed, optionally render the preview inline. */
async function randomCharacterTool(engine, args, catalog) {
  let roll;
  try {
    roll = randomCharacter(catalog, {
      seed: args.seed,
      bodyType: args.bodyType ?? null,
      gear: args.gear,
      completeOnly: args.complete_only,
    });
  } catch (err) {
    return { error: err.message };
  }
  const payload = {
    seed: roll.seed,
    bodyType: roll.bodyType,
    selections: roll.selections,
    colors: roll.colors,
    generatorUrl: null, // filled after normalization below
    notes: roll.notes,
    note: "selections/colors are ready for generate_spritesheet / get_preview / export_character. Same seed → same character.",
  };
  if (args.preview !== false) {
    const preview = await renderPreviewOf(engine, args, roll, {
      defaultName: `lpc-random-${String(roll.seed).replace(/[^\w.-]+/g, "_") || "roll"}`,
    });
    payload.preview = preview;
    payload.generatorUrl = preview.generatorUrl;
    payload.inlineImage = preview.inlineImage;
    delete preview.inlineImage;
    delete preview.note;
  } else {
    const selections = normalizeSelections(catalog, roll.bodyType, roll.selections, roll.colors);
    payload.generatorUrl = generatorUrl(catalog, { bodyType: roll.bodyType, selections });
  }
  return payload;
}

/** generate_batch: a village in one call — N seeded characters, one bundle. */
async function generateBatchTool(engine, args, catalog) {
  const count = args.count;
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    return { error: "count must be an integer between 1 and 25." };
  }
  const seed = args.seed === undefined || args.seed === null ? "" : String(args.seed);
  const dir = path.resolve(
    args.output_dir || path.join(DEFAULT_OUTPUT_DIR, `lpc-batch-${seed.replace(/[^\w.-]+/g, "_") || "roll"}-${timestamp()}`),
  );
  fs.mkdirSync(dir, { recursive: true });

  const wantSheets = args.sheets !== false;
  const wantPreviews = args.previews !== false;
  const wantIndex = args.index !== false;
  const wantCredits = args.include_credits !== false;
  const preWarnings = unknownArgWarnings(args, [
    ...Object.keys(RANDOM_PROPS), "count", "bodyType", "output_dir", "sheets", "previews", "index", "include_credits",
  ]);

  /** Write a canvas as PNG, creating parent directories as needed. */
  const writePng = (file, canvas) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canvas.toBuffer("image/png"));
  };

  const characters = [];
  const sheets = []; // keep the rendered canvases so the index grid never re-renders
  const allCredits = new Map(); // fileName -> entry, rolled up across the batch
  for (let i = 0; i < count; i++) {
    const roll = randomCharacter(catalog, {
      seed: `${seed}:${i}`,
      bodyType: args.bodyType ?? null,
      gear: args.gear,
      completeOnly: args.complete_only,
    });
    const selections = normalizeSelections(catalog, roll.bodyType, roll.selections, roll.colors);
    const { canvas, warnings } = await engine.renderCharacter({
      bodyType: roll.bodyType,
      selections,
      matchBodyColorEnabled: true,
    });
    sheets.push(canvas);

    const sub = path.join(dir, String(i + 1).padStart(2, "0"));
    fs.mkdirSync(sub, { recursive: true });
    const files = {};
    if (wantSheets) {
      writePng(path.join(sub, "sheet.png"), canvas);
      files.sheet = path.join(sub, "sheet.png");
    }
    if (wantPreviews) {
      const strip = engine.extractPreviewStrip(canvas, "walk", "down");
      writePng(path.join(sub, "preview.png"), strip.canvas);
      files.preview = path.join(sub, "preview.png");
    }
    const credits = getAllCredits(catalog, selections, roll.bodyType);
    if (wantCredits && credits.length > 0) {
      fs.writeFileSync(path.join(sub, "character-credits.csv"), creditsToCsv(credits));
      fs.writeFileSync(path.join(sub, "character-credits.txt"), creditsToTxt(credits));
      files.creditsCsv = path.join(sub, "character-credits.csv");
      files.creditsTxt = path.join(sub, "character-credits.txt");
      for (const entry of credits) allCredits.set(entry.fileName, entry);
    }
    characters.push({
      index: i + 1,
      seed: roll.seed,
      bodyType: roll.bodyType,
      selections: roll.selections,
      colors: roll.colors,
      generatorUrl: generatorUrl(catalog, { bodyType: roll.bodyType, selections }),
      notes: roll.notes,
      warnings,
      files,
    });
  }

  // Contact grid: every character's walk-down standing frame (the pose that identifies
  // a design at a glance), laid out left-to-right, top-to-bottom. No labels are drawn:
  // the manifest carries cell -> character index instead.
  let index = null;
  if (wantIndex) {
    const cell = FRAME_SIZE;
    const columns = Math.min(count, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / columns);
    const grid = createCanvas(columns * cell, rows * cell);
    const ctx = grid.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    sheets.forEach((canvas, i) => {
      const frame = engine.extractFrame(canvas, "walk", "down", 0);
      ctx.drawImage(frame, (i % columns) * cell, Math.floor(i / columns) * cell);
    });
    writePng(path.join(dir, "index.png"), grid);
    index = { file: path.join(dir, "index.png"), columns, rows, cellSize: cell };
  }

  let creditsOut;
  if (wantCredits && allCredits.size > 0) {
    const entries = [...allCredits.values()];
    fs.writeFileSync(path.join(dir, "batch-credits.csv"), creditsToCsv(entries));
    fs.writeFileSync(path.join(dir, "batch-credits.txt"), creditsToTxt(entries));
    creditsOut = {
      csv: path.join(dir, "batch-credits.csv"),
      txt: path.join(dir, "batch-credits.txt"),
      entries: entries.length,
    };
  }

  const manifest = {
    generator: { name: "lpc-spritesheet-mcp", version: SERVER_VERSION },
    pack: { revision: packRevision(catalog.assetsDir) },
    seed,
    count,
    outputDir: dir,
    ...(index ? { index: { file: "index.png", columns: index.columns, rows: index.rows, cellSize: index.cellSize } } : {}),
    characters: characters.map(({ files, ...character }) => ({
      ...character,
      files: Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, path.relative(dir, v)]),
      ),
    })),
    credits: creditsOut && { entries: creditsOut.entries, files: ["batch-credits.csv", "batch-credits.txt"] },
    warnings: preWarnings,
  };
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    count,
    seed,
    outputDir: dir,
    characters,
    ...(index ? { index } : {}),
    manifest: manifestPath,
    ...(creditsOut ? { credits: creditsOut } : {}),
    warnings: preWarnings,
    note: `Each character's selections/colors render the same character again (seeds ${seed}:0..${count - 1}). index.png shows every walk frame; manifest.json indexes the batch.`,
  };
}

/**
 * design_character: natural language → selections/colors through an OpenAI-compatible
 * endpoint, then optionally render the preview inline. Strictly opt-in: without
 * LPC_AI_API_KEY the tool answers with a setup error instead of reaching the network.
 */
async function designCharacterTool(engine, args, catalog) {
  const prompt = args.prompt;
  if (!prompt || typeof prompt !== "string") {
    return { error: "prompt is required (a natural-language character brief)." };
  }
  const ai = aiConfigFromEnv(process.env);
  if (!ai) {
    return {
      error: "AI-assisted design is not configured on this server.",
      hint: "Set LPC_AI_API_KEY in the server's environment (MCP client env block) to enable it. Optional: LPC_AI_BASE_URL (default: Dashscope-compatible endpoint), LPC_AI_MODEL (one of " + AI_MODELS.join(", ") + "). The server stays fully offline without these.",
    };
  }
  const model = args.model ?? ai.model;
  const preWarnings = unknownArgWarnings(args, ["prompt", "model", ...PREVIEW_CONVENIENCE_KEYS]);

  const aiCall = (repair) => designCharacterWithAI({
    prompt,
    digest: buildCatalogDigest(catalog),
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model,
    ...(repair ? { repair } : {}),
  });

  let designed = await aiCall();

  // The model's picks are still just a proposal: normalize them so invalid itemIds or
  // colors surface as actionable errors, exactly like hand-written selections. One
  // self-healing round feeds the failure (plus the valid itemIds for the groups the
  // model used) back to the model — inventing ids is the classic failure and this
  // usually fixes it without bothering the caller.
  const normalizeOrError = (spec) => {
    try {
      return {
        ok: true,
        selections: normalizeSelections(catalog, spec.bodyType ?? "male", spec.selections, spec.colors ?? {}),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
  let normalized = normalizeOrError(designed);
  if (!normalized.ok) {
    const validItems = {};
    for (const group of Object.keys(designed.selections ?? {})) {
      if (!catalog.byTypeName.has(group)) continue;
      validItems[group] = catalog.getItemsByType(group).map((i) => i.itemId).slice(0, 80);
    }
    try {
      const repaired = await aiCall({
        spec: { bodyType: designed.bodyType, selections: designed.selections, colors: designed.colors },
        error: normalized.error,
        validItems,
      });
      const retry = normalizeOrError(repaired);
      if (retry.ok) {
        designed = { ...repaired, bodyType: repaired.bodyType ?? designed.bodyType };
        normalized = retry;
      }
    } catch {
      // the repair round itself failed (network, unparseable reply) — fall through
      // to the original error below
    }
  }
  if (!normalized.ok) {
    return {
      error: `The model proposed a character this pack cannot render: ${normalized.error}`,
      proposal: { bodyType: designed.bodyType, selections: designed.selections, colors: designed.colors },
      hint: "Rephrase the brief (simpler descriptions pick plainer items), or assemble the character by hand with list_categories / list_items.",
    };
  }
  const { selections } = normalized;
  const bodyType = designed.bodyType ?? "male";
  const payload = {
    model,
    rationale: designed.rationale ?? null,
    bodyType,
    selections: designed.selections,
    colors: designed.colors ?? {},
    resolved: describeSelections(selections),
    generatorUrl: generatorUrl(catalog, { bodyType, selections }),
    warnings: preWarnings,
    note: "selections/colors are ready for generate_spritesheet / get_preview / export_character.",
  };
  if (args.preview !== false) {
    const preview = await renderPreviewOf(
      engine,
      { ...args, seed: undefined },
      { bodyType, selections: designed.selections, colors: designed.colors ?? {} },
      { defaultName: "lpc-designed" },
    );
    payload.preview = preview;
    payload.inlineImage = preview.inlineImage;
    delete preview.inlineImage;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Prompts: scripted agent flows that chain the tools well (MCP prompts are
// client-visible; an agent that picks one gets the whole workflow in one shot).
// ---------------------------------------------------------------------------

const PROMPTS = [
  {
    name: "design-a-character",
    description: "Interview the user about a character, then render it: discover items, assemble selections, preview, iterate, and finish with a full spritesheet + engine bundle.",
    arguments: [
      { name: "brief", description: "Optional starting brief, e.g. 'a hooded ranger with a longbow'", required: false },
    ],
  },
  {
    name: "populate-a-village",
    description: "Generate a reproducible batch of NPC villagers (generate_batch) from one seed, show the contact grid, and export the keepers as engine bundles.",
    arguments: [
      { name: "count", description: "How many villagers (default 8)", required: false },
      { name: "seed", description: "Batch seed; same seed → same village", required: false },
    ],
  },
  {
    name: "export-for-my-engine",
    description: "Pick the right atlas format and bundle layout for a target engine (Phaser/PixiJS, Godot 4, Unity, libGDX, Aseprite/Bevy tooling) and run the export.",
    arguments: [
      { name: "engine", description: "Target engine or toolchain", required: false },
    ],
  },
];

const PROMPT_BODIES = {
  "design-a-character": (args) => `Design an LPC character with the user${args.brief ? ` — they already have a brief: "${args.brief}"` : " — interview them briefly first (role, vibe, one signature item)"}.

Workflow:
1) list_presets — offer a close preset as the starting point (presets render in one call and merge with overrides).
2) For anything custom: list_categories → list_items (search + fields:["itemId","name"] to stay small) → list_palettes for colors.
3) Assemble selections/colors and run get_preview (format:gif, scale:2, animation:walk) so the user can SEE the character walk.
4) Iterate on their feedback — get_preview again per change (renders are milliseconds).
5) Finish with export_character (mode:animation, atlas_format for their engine) and hand over the paths, the generatorUrl for tweaking in the web app, and the credits files (the asset licenses require keeping them with redistributed art).`,
  "populate-a-village": (args) => `Generate ${args.count || 8} NPC villagers reproducibly${args.seed ? ` from seed "${args.seed}"` : " (ask the user for a seed or pick a memorable one)"}.

Workflow:
1) generate_batch with that seed and count (gear:civilian; complete_only stays on so nobody has empty rows). Read index.png — it shows every villager at a glance.
2) Show the user the batch summary + the index image; let them pick keepers and call out re-rolls.
3) For each keeper: either re-render from its recorded selections/colors (same character, no reroll) or bump its own seed for a variation.
4) export_character the keepers (mode:animation) so each lands as an engine-ready bundle; remind about batch-credits.csv covering everyone.`,
  "export-for-my-engine": (args) => `Export a character for ${args.engine || "the user's engine"}.

Format guide:
- Phaser 3/4 or PixiJS → atlas_format "texturepacker" (JSON Hash + animations map: play walk as animations.walk_down, frames 2..9).
- Godot 4 → atlas_format "godot": sheet-spriteframes.tres with AtlasTextures + per-direction SpriteFrames animations (loop, 10 fps) — point an AnimatedSprite2D at it.
- Unity → atlas_format "unity": sheet.png.meta pre-slices sprites (Point filter, 64 px/unit, feet pivot); the cycle map rides in userData for scripting .anim clips.
- libGDX → atlas_format "libgdx": sheet.atlas text regions (Nearest filtering).
- Aseprite-adjacent tooling / Bevy sprite plugins → atlas_format "aseprite": frames + frameTags.
Workflow: confirm the engine, run export_character with mode:animation (or mode:frames if the engine prefers loose frame PNGs), then walk the consumer through what each file is (manifest.json explains the layout, offsets and custom blocks).`,
};

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const build = PROMPT_BODIES[name];
  if (!build) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown prompt: ${name}. Available: ${Object.keys(PROMPT_BODIES).join(", ")}.` }],
    };
  }
  return {
    description: PROMPTS.find((p) => p.name === name)?.description,
    messages: [{ role: "user", content: { type: "text", text: build(args) } }],
  };
});

// ---------------------------------------------------------------------------
// Resources: reference material agents can cite without a tool call.
// ---------------------------------------------------------------------------

const RESOURCES = [
  {
    uri: "lpc://sheet-layout",
    name: "Universal LPC sheet layout",
    description: "The stable 13x54 grid: every animation's row, direction rows, frame counts, playback cycles and custom-block rules. What an engine integrator needs to slice any LPC sheet.",
    mimeType: "application/json",
  },
  {
    uri: "lpc://licensing",
    name: "LPC asset licensing cheat sheet",
    description: "What the licenses on the art require (attribution, share-alike), what this server does about it (credits sidecars on every render), and what redistribution must keep.",
    mimeType: "text/plain",
  },
  {
    uri: "lpc://presets",
    name: "Character preset library",
    description: "The curated presets with their selections, colors and body types — renderable directly with preset: \"<name>\".",
    mimeType: "application/json",
  },
];

const LICENSING_TEXT = `LPC asset licensing cheat sheet
===============================

The sprites this server renders come from the Liberated Pixel Cup asset pack: a mix of
OGA-BY 3.0, CC-BY-SA 3.0, CC-BY 3.0/4.0 and GPL held by many artists. Two duties follow:

1. ATTRIBUTION is unconditional. Every render writes <name>-credits.csv/.txt beside the
   PNG naming the authors, licenses and links of the exact assets used. Keep those files
   with any art you redistribute — dropping them is a licensing violation.

2. SHARE-ALIKE (CC-BY-SA / GPL items) requires derivative art to ship under the same
   license. Code using the art is generally unaffected, but check each item's license in
   the credits file. Recolored palettes are still derivatives.

This server's own code is GPL-3.0-only; the art keeps its own licenses and the two are
never conflated. When in doubt, read the per-render credits CSV — it is the source of
truth for exactly what went into that PNG.`;

const RESOURCE_BODIES = {
  "lpc://sheet-layout": () => JSON.stringify(listAnimations(), null, 2),
  "lpc://licensing": () => LICENSING_TEXT,
  "lpc://presets": () => JSON.stringify(listPresets(), null, 2),
};

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const body = RESOURCE_BODIES[uri];
  if (!body) {
    throw new Error(`Unknown resource: ${uri}. Available: ${Object.keys(RESOURCE_BODIES).join(", ")}.`);
  }
  return {
    contents: [{ uri, mimeType: RESOURCES.find((r) => r.uri === uri)?.mimeType, text: body() }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[lpc-spritesheet] MCP server listening on stdio");
