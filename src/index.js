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
import { renderAndSave, errorPayload, unknownArgWarnings, CharacterRequestError, buildSelections } from "./character.js";
import { exportBundle, ATLAS_FORMATS } from "./export.js";
import { validateLayout, validateCharacter, validateCatalog, summarize } from "./validate.js";

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

const SERVER_VERSION = "1.3.0";

const server = new Server(
  { name: "lpc-spritesheet", version: SERVER_VERSION },
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
        return jsonResultWithImage(
          await renderAndSave(engine, args, {
            serverVersion: SERVER_VERSION,
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
                inline: true,
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
          schema,
        );
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
  const { inlinePng, ...clean } = payload;
  return {
    content: [{ type: "text", text: JSON.stringify(clean, null, 2) }],
    ...(schema ? { structuredContent: clean } : {}),
  };
}

/**
 * `get_preview` crops are 2-4 KB, so the client can look at the character without opening a file.
 * A full sheet is 188-280 KB, which is not something to base64 into a conversation — the path is
 * the right primitive for those, so anything over the cap comes back as text only.
 */
function jsonResultWithImage(payload, schema) {
  const result = jsonResult(payload, schema);
  if (payload.inlinePng && payload.inlinePng.length <= MAX_INLINE_PNG_BYTES) {
    result.content.push({
      type: "image",
      data: payload.inlinePng.toString("base64"),
      mimeType: "image/png",
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[lpc-spritesheet] MCP server listening on stdio");
