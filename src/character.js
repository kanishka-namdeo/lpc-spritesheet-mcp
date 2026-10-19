// Shared character-request pipeline for the generate_* tools: normalize input,
// render, save PNG (+credits/character JSON), and build the JSON result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeSelections, SelectionError } from "./engine/selection.js";
import { getAllCredits, creditsToCsv, creditsToTxt } from "./engine/credits.js";
import { packRevision } from "./assets-dir.js";
import { buildCharacterSpec, readSavedCharacter, generatorUrl } from "./spec.js";
import { getPreset, presetNames } from "./presets.js";

// Not the package directory: an installed package lives under node_modules/, which the next
// `npm install` replaces and a root-owned global prefix does not let us write into.
export const DEFAULT_OUTPUT_DIR = path.join(os.tmpdir(), "lpc-spritesheet");

export class CharacterRequestError extends Error {}

/**
 * Normalize the character-defining args shared by generate_spritesheet /
 * get_animation / get_preview.
 *
 * A named preset (`args.preset`) or a saved-character JSON (v2) provides the BASE
 * selections; explicit args.selections / args.colors always merge on top, in that
 * order (explicit args win over the character document, which wins over the preset).
 */
export function buildSelections(engine, args) {
  let bodyType = args.bodyType ?? null;
  let base = {};
  let baseColors = {};
  let characterWarnings = [];

  if (args.preset !== undefined) {
    if (typeof args.preset !== "string") {
      throw new CharacterRequestError("preset must be a preset name string (see list_presets).");
    }
    const preset = getPreset(args.preset);
    if (!preset) {
      throw new CharacterRequestError(
        `Unknown preset "${args.preset}". Available: ${presetNames().join(", ")}.`,
      );
    }
    base = { ...preset.selections };
    baseColors = { ...preset.colors };
    bodyType = bodyType ?? preset.bodyType;
    characterWarnings.push(`Preset "${preset.name}" applied as the base character.`);
  }

  if (args.character !== undefined) {
    let char = args.character;
    if (typeof char === "string") {
      char = char.trim();
      if (!char.startsWith("#") && !char.includes("&")) {
        try {
          char = JSON.parse(char);
        } catch (e) {
          throw new CharacterRequestError(
            `character is not valid JSON: ${e.message}. Pass the parsed object, the exact output of the app's "Save character as JSON" export, or a "#sex=...&hair=..." state hash.`,
          );
        }
      }
    }
    let read;
    try {
      read = readSavedCharacter(engine.catalog, char);
    } catch (e) {
      throw new CharacterRequestError(e.message);
    }
    base = read.selections;
    characterWarnings = read.warnings;
    if (read.bodyType) bodyType = bodyType ?? read.bodyType;
  }

  bodyType = bodyType ?? "male";
  const selections = normalizeSelections(
    engine.catalog, bodyType, { ...base, ...(args.selections ?? {}) },
    { ...baseColors, ...(args.colors ?? {}) },
  );
  return { bodyType, selections, characterWarnings };
}

/**
 * Echo the resolved selections back to the caller in one readable line per group:
 * `itemId [variant] (recolor)`, or the sub-selection form when a color slot was addressed
 * directly. Shared by the render tools and the bundle export so both say the same thing.
 */
export function describeSelections(selections) {
  return Object.fromEntries(
    Object.entries(selections).map(([group, sel]) => [
      group,
      sel.subId != null
        ? `${sel.itemId} [${sel.recolor}] (color sub-selection)`
        : `${sel.itemId}${sel.variant ? ` [${sel.variant}]` : ""}${sel.recolor ? ` (${sel.recolor})` : ""}`,
    ]),
  );
}

export function resolveOutputPath(outputPath, defaultName, ext = ".png") {
  let p = outputPath
    ? path.resolve(String(outputPath))
    : path.join(DEFAULT_OUTPUT_DIR, `${defaultName}-${timestamp()}${ext}`);
  // An explicit path with the wrong extension would misname the bytes that land
  // there, so the extension always follows the format being written.
  if (path.extname(p) !== ext) p = p.slice(0, p.length - path.extname(p).length) + ext;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

export function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Render + save a character. `extract` receives the render result and returns
 * {canvas, suffix?, layout?, extra?} so generate_spritesheet / get_animation /
 * get_preview share one save path. `preWarnings` (e.g. unknown-argument
 * notices) are merged into the result's warnings.
 */
export async function renderAndSave(engine, args, { defaultName, extract, preWarnings = [], serverVersion }) {
  const { bodyType, selections, characterWarnings = [] } = buildSelections(engine, args);
  const matchBodyColorEnabled = args.match_body_color !== false;

  const { canvas, layout, warnings: renderWarnings, layers } = await engine.renderCharacter({
    bodyType,
    selections,
    matchBodyColorEnabled,
  });
  const warnings = [...preWarnings, ...characterWarnings, ...renderWarnings];

  let result = extract({ canvas, layout });
  const suffix = result.suffix ?? "";
  const isGif = Boolean(result.gif);
  const outPath = resolveOutputPath(
    args.output_path, `${defaultName}${suffix}`, isGif ? ".gif" : ".png",
  );

  const bytes = isGif ? result.gif : result.canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, bytes);

  const payload = {
    output: outPath,
    format: isGif ? "gif" : "png",
    bodyType,
    generatorUrl: generatorUrl(engine.catalog, { bodyType, selections }),
    pack: { revision: packRevision(engine.catalog.assetsDir) },
    image: {
      width: result.canvas.width,
      height: result.canvas.height,
      frameSize: result.extra?.frameSize ?? layout.standard.frameSize,
    },
    ...(result.extra ?? {}),
    ...(result.layout ? { layout: result.layout } : {}),
    warnings,
    selections: describeSelections(selections),
  };

  const baseName = path.basename(outPath, path.extname(outPath));
  const outDir = path.dirname(outPath);
  const credits = getAllCredits(engine.catalog, selections, bodyType);
  if (args.include_credits !== false && credits.length > 0) {
    const csvPath = path.join(outDir, `${baseName}-credits.csv`);
    const txtPath = path.join(outDir, `${baseName}-credits.txt`);
    fs.writeFileSync(csvPath, creditsToCsv(credits));
    fs.writeFileSync(txtPath, creditsToTxt(credits));
    payload.credits = { csv: csvPath, txt: txtPath, entries: credits.length };
  }
  if (args.include_character_json) {
    const jsonPath = path.join(outDir, `${baseName}-character.json`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        buildCharacterSpec(engine.catalog, {
          bodyType,
          selections,
          layers,
          credits,
          generator: { name: "lpc-spritesheet-mcp", version: serverVersion ?? "dev" },
          pack: payload.pack,
        }),
        null,
        2,
      ),
    );
    payload.characterJson = jsonPath;
  }
  // The crop the caller asked for, kept as bytes so the tool envelope can decide whether to also
  // send it inline. Never serialized into `payload` — that would double the text.
  if (result.inline) {
    payload.inlineImage = {
      bytes,
      mimeType: isGif ? "image/gif" : "image/png",
    };
  }
  return payload;
}

/** Warn about unrecognized top-level arguments (typo protection). */
export function unknownArgWarnings(args, knownKeys) {
  const known = new Set(knownKeys);
  const warnings = [];
  for (const key of Object.keys(args)) {
    if (known.has(key)) continue;
    const suggestion = knownKeys.find(
      (k) => k.startsWith(key.slice(0, 3)) || key.startsWith(k.slice(0, 3)),
    );
    warnings.push(
      `Unknown argument "${key}" was ignored${suggestion ? ` — did you mean "${suggestion}"?` : ""}.`,
    );
  }
  return warnings;
}

export function errorPayload(err) {
  if (err instanceof SelectionError || err instanceof CharacterRequestError) {
    return { error: err.message, hint: "Fix the arguments; use list_categories / list_items / list_palettes to discover valid values." };
  }
  return { error: err.message };
}
