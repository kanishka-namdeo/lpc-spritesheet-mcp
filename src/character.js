// Shared character-request pipeline for the generate_* tools: normalize input,
// render, save PNG (+credits/character JSON), and build the JSON result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeSelections, SelectionError } from "./engine/selection.js";
import { getAllCredits, creditsToCsv, creditsToTxt } from "./engine/credits.js";

// Not the package directory: an installed package lives under node_modules/, which the next
// `npm install` replaces and a root-owned global prefix does not let us write into.
export const DEFAULT_OUTPUT_DIR = path.join(os.tmpdir(), "lpc-spritesheet");

export class CharacterRequestError extends Error {}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalize the character-defining args shared by generate_spritesheet /
 * get_animation / get_preview.
 *
 * A saved-character JSON (v2) provides the BASE selections; explicit
 * args.selections / args.colors always merge on top of it.
 */
export function buildSelections(engine, args) {
  let bodyType = args.bodyType ?? null;
  let base = {};

  if (args.character !== undefined) {
    let char = args.character;
    if (typeof char === "string") {
      try {
        char = JSON.parse(char);
      } catch (e) {
        throw new CharacterRequestError(
          `character is not valid JSON: ${e.message}. Pass the parsed object or the exact output of the app's "Save character as JSON" export.`,
        );
      }
    }
    if (!isPlainObject(char) || char.version !== 2 || !isPlainObject(char.selections)) {
      throw new CharacterRequestError(
        "character must be a saved-character JSON with {version: 2, selections: {group: {itemId, subId, variant, recolor}}} (the app's 'Save character as JSON' export shape).",
      );
    }
    for (const [group, sel] of Object.entries(char.selections)) {
      if (!isPlainObject(sel) || typeof sel.itemId !== "string") {
        throw new CharacterRequestError(
          `character.selections.${group} must be an object with at least {itemId}.`,
        );
      }
      base[group] = {
        itemId: sel.itemId,
        subId: sel.subId ?? null,
        variant: sel.variant ?? null,
        recolor: sel.recolor ?? null,
      };
    }
    if (char.bodyType) {
      if (typeof char.bodyType !== "string") {
        throw new CharacterRequestError(
          `character.bodyType must be a string; got ${typeof char.bodyType}.`,
        );
      }
      bodyType = bodyType ?? char.bodyType;
    }
  }

  bodyType = bodyType ?? "male";
  const selections = normalizeSelections(
    engine.catalog, bodyType, { ...base, ...(args.selections ?? {}) }, args.colors ?? {},
  );
  return { bodyType, selections };
}

export function resolveOutputPath(outputPath, defaultName) {
  const p = outputPath
    ? path.resolve(String(outputPath))
    : path.join(DEFAULT_OUTPUT_DIR, `${defaultName}-${timestamp()}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

function timestamp() {
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
export async function renderAndSave(engine, args, { defaultName, extract, preWarnings = [] }) {
  const { bodyType, selections } = buildSelections(engine, args);
  const matchBodyColorEnabled = args.match_body_color !== false;

  const { canvas, layout, warnings: renderWarnings } = await engine.renderCharacter({
    bodyType,
    selections,
    matchBodyColorEnabled,
  });
  const warnings = [...preWarnings, ...renderWarnings];

  let result = extract({ canvas, layout });
  const suffix = result.suffix ?? "";
  const pngPath = resolveOutputPath(args.output_path, `${defaultName}${suffix}`);

  fs.writeFileSync(pngPath, result.canvas.toBuffer("image/png"));

  const payload = {
    output: pngPath,
    bodyType,
    image: {
      width: result.canvas.width,
      height: result.canvas.height,
      frameSize: result.extra?.frameSize ?? layout.standard.frameSize,
    },
    ...(result.extra ?? {}),
    ...(result.layout ? { layout: result.layout } : {}),
    warnings,
    selections: Object.fromEntries(
      Object.entries(selections).map(([group, sel]) => [
        group,
        sel.subId != null
          ? `${sel.itemId} [${sel.recolor}] (color sub-selection)`
          : `${sel.itemId}${sel.variant ? ` [${sel.variant}]` : ""}${sel.recolor ? ` (${sel.recolor})` : ""}`,
      ]),
    ),
  };

  const baseName = path.basename(pngPath, path.extname(pngPath));
  const outDir = path.dirname(pngPath);
  if (args.include_credits !== false) {
    const credits = getAllCredits(engine.catalog, selections, bodyType);
    if (credits.length > 0) {
      const csvPath = path.join(outDir, `${baseName}-credits.csv`);
      const txtPath = path.join(outDir, `${baseName}-credits.txt`);
      fs.writeFileSync(csvPath, creditsToCsv(credits));
      fs.writeFileSync(txtPath, creditsToTxt(credits));
      payload.credits = { csv: csvPath, txt: txtPath, entries: credits.length };
    }
  }
  if (args.include_character_json) {
    const jsonPath = path.join(outDir, `${baseName}-character.json`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          version: 2,
          bodyType,
          selections: Object.fromEntries(
            Object.entries(selections).map(([k, v]) => [k, { ...v }]),
          ),
        },
        null,
        2,
      ),
    );
    payload.characterJson = jsonPath;
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
