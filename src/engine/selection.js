// Selection normalization: converts tool input into the app's Selections map
// ({type_name: {itemId, subId, variant, recolor}}), with defaults and color
// convenience handling mirroring the web app's UI behavior.
import { BODY_TYPES } from "./constants.js";
import { fixMissingRecolor } from "./recolor.js";

/** Underscored lookup keys for an item: itemId, name, and lowercased variants. */
function nameKey(str) {
  return String(str).toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

export class SelectionError extends Error {}

const GROUP_TRAPS =
  'Note: shirts are group "clothes", boots are group "shoes" — see list_categories for all groups.';

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {import('./catalog.js').Catalog} catalog
 * @param {string} bodyType
 * @param {Record<string, string|object>|undefined} selectionsInput
 *   group -> itemId | "none" | {itemId, subId?, variant?, recolor?, eyes?}
 * @param {Record<string, string>|undefined} colorsInput
 *   group -> color name (special group "eyes" = eye color on head/expression)
 * @returns {Record<string, {itemId, subId, variant, recolor}>}
 */
export function normalizeSelections(catalog, bodyType, selectionsInput = {}, colorsInput = {}) {
  if (!BODY_TYPES.includes(bodyType)) {
    throw new SelectionError(
      `Unknown bodyType "${bodyType}". Valid: ${BODY_TYPES.join(", ")}`,
    );
  }
  if (selectionsInput !== undefined && !isPlainObject(selectionsInput)) {
    throw new SelectionError(
      "selections must be an object mapping group names to itemIds, e.g. {hair: \"hair_bangs\"} or {clothes: {itemId: \"torso_clothes_longsleeve\", recolor: \"maroon\"}}.",
    );
  }
  if (colorsInput !== undefined && !isPlainObject(colorsInput)) {
    throw new SelectionError(
      "colors must be an object mapping group names to color name strings, e.g. {body: \"amber\", hair: \"red\"}. See list_palettes.",
    );
  }

  /** @type {Record<string, {itemId, subId, variant, recolor}>} */
  const selections = {};

  // The app's selectDefaults(): bare-bones character is body + head + face.
  for (const [group, itemId, recolor] of [
    ["body", "body", "light"],
    ["head", "heads_human_male", "light"],
    ["expression", "face_neutral", "light"],
  ]) {
    const item = catalog.getItem(itemId);
    if (item) selections[group] = { itemId, subId: null, variant: null, recolor };
  }

  // ---- explicit selections ----
  for (const [key, value] of Object.entries(selectionsInput)) {
    if (value === "none" || value === null) {
      delete selections[key];
      continue;
    }
    if (!catalog.byTypeName.has(key)) {
      throw new SelectionError(
        `Unknown selection group "${key}". Valid groups: ${catalog.listTypeNames().join(", ")}. ${GROUP_TRAPS}`,
      );
    }

    const wanted = isPlainObject(value) ? (value.itemId ?? value.item ?? value.id) : value;
    if (!wanted || typeof wanted !== "string") {
      throw new SelectionError(
        `selections.${key} must be an itemId string, "none", or an object like {itemId: "...", variant: "...", recolor: "..."}.`,
      );
    }
    const item = resolveItem(catalog, wanted, key);

    if (!item.required.includes(bodyType)) {
      throw new SelectionError(
        `Item "${item.itemId}" does not support body type "${bodyType}". Supported: ${item.required.join(", ")}`,
      );
    }

    // Sub-selection entries (e.g. an imported character JSON's "eyes" color)
    // are recolor info keyed by their recolor slot's type_name; the renderer
    // skips them when building draw calls.
    if (isPlainObject(value) && value.subId != null) {
      const recolorEntry = item.recolors[value.subId];
      if (!recolorEntry) {
        throw new SelectionError(
          `selections.${key}: item "${item.itemId}" has no recolor slot ${value.subId}.`,
        );
      }
      const wantedRecolor = value.recolor || recolorEntry.variants?.[0];
      const verified = fixMissingRecolor(catalog, item.itemId, wantedRecolor, recolorEntry.type_name);
      if (!verified) {
        throw new SelectionError(
          `selections.${key}: "${wantedRecolor}" is not a valid color for "${item.itemId}" slot "${recolorEntry.label}". ` +
            colorNamesHint(wantedRecolor, recolorEntry.variants),
        );
      }
      selections[recolorEntry.type_name ?? item.typeName ?? item.itemId] = {
        itemId: item.itemId,
        subId: value.subId,
        variant: null,
        recolor: verified,
      };
      continue;
    }

    const selection = { itemId: item.itemId, subId: null, variant: null, recolor: null };

    const wantedVariant = isPlainObject(value) ? value.variant || null : null;
    const wantedRecolor = isPlainObject(value) ? value.recolor || null : null;

    if (item.variants.length > 0) {
      selection.variant = wantedVariant ?? item.variants[0];
      if (!item.variants.includes(selection.variant)) {
        throw new SelectionError(
          `Item "${item.itemId}" has no variant "${selection.variant}". Valid: ${item.variants.join(", ")}`,
        );
      }
    }
    if (item.recolors.length > 0 && item.recolors[0].variants?.length) {
      // Upstream defaults to the first palette entry of the slot (state.ts selectItem).
      const fallback = item.recolors[0].variants[0];
      selection.recolor = wantedRecolor ?? fallback;
      const verified = fixMissingRecolor(catalog, item.itemId, selection.recolor, null);
      if (!verified) {
        throw new SelectionError(
          `Item "${item.itemId}" has no color "${selection.recolor}". ` +
            colorNamesHint(selection.recolor, item.recolors[0].variants),
        );
      }
      selection.recolor = verified;
    }
    if (isPlainObject(value) && value.eyes) {
      applyEyeColor(catalog, selections, item, value.eyes);
    }

    selections[item.typeName ?? item.itemId] = selection;
  }

  // ---- color convenience map ----
  for (const [group, color] of Object.entries(colorsInput)) {
    if (typeof color !== "string") {
      throw new SelectionError(
        `colors.${group} must be a color name string (see list_palettes); got ${typeof color}.`,
      );
    }
    if (group === "eyes") {
      applyEyeColorToSelections(catalog, selections, color);
      continue;
    }
    const selection = selections[group];
    if (!selection) {
      const selectedGroups = Object.keys(selections).join(", ");
      throw new SelectionError(
        `colors.${group}: no "${group}" item is selected, so there is nothing to color.` +
          (selectedGroups ? ` Selected groups: ${selectedGroups}.` : "") +
          ` ${GROUP_TRAPS}`,
      );
    }
    const item = catalog.getItem(selection.itemId);
    if (!item?.recolors.length) {
      throw new SelectionError(`colors.${group}: selected item "${selection.itemId}" has no recolorable colors.`);
    }
    const verified = fixMissingRecolor(catalog, item.itemId, color, selection.subId != null ? group : null);
    if (!verified) {
      const recolorEntry =
        selection.subId != null ? item.recolors[selection.subId] : item.recolors[0];
      throw new SelectionError(
        `colors.${group}: "${color}" is not a valid color for "${item.itemId}". ` +
          colorNamesHint(color, recolorEntry.variants),
      );
    }
    selection.recolor = verified;
  }

  return selections;
}

/** How many color names an invalid-color error may list before pointing at list_palettes. */
const COLOR_HINT_CAP = 15;

/**
 * A material's variant list reaches ~93 names once palette versions are folded in, which made a
 * single typo cost more text than the payload it was correcting. Name the nearest candidate and
 * cap the enumeration instead.
 */
function colorNamesHint(wanted, variants) {
  const w = String(wanted).toLowerCase();
  const suggestion = variants.find(
    (v) => v.toLowerCase().startsWith(w.slice(0, 4)) || w.startsWith(v.toLowerCase().slice(0, 4)),
  );
  const shown = variants.slice(0, COLOR_HINT_CAP);
  const rest = variants.length - shown.length;
  return (
    `Valid: ${shown.join(", ")}${rest > 0 ? `… (${rest} more)` : ""}.` +
    (suggestion ? ` Did you mean "${suggestion}"?` : " See list_palettes.")
  );
}

/**
 * Resolve a user- or hash-supplied item name inside a selection group: exact itemId, then the
 * underscored display name, then a unique partial. Exported so the saved-character readers share
 * this one resolution path instead of inventing their own.
 */
export function resolveItem(catalog, wanted, groupName) {
  const direct = catalog.getItem(wanted);
  if (direct) return direct;

  const byKey = nameKey(wanted);
  const items = catalog.getItemsByType(groupName);
  const pool = items.length > 0 ? items : Array.from(catalog.itemsById.values());

  let match = pool.find((i) => i.itemId.toLowerCase() === byKey || nameKey(i.name) === byKey);
  if (match) return match;
  const partial = pool.filter((i) => i.itemId.toLowerCase().includes(byKey) || nameKey(i.name).includes(byKey));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new SelectionError(
      `"${wanted}" is ambiguous for group "${groupName}". Matches: ${partial.slice(0, 8).map((i) => i.itemId).join(", ")}. Use an exact itemId from list_items.`,
    );
  }
  throw new SelectionError(
    `Unknown item "${wanted}" for group "${groupName}". Use list_items with category="${groupName}" to discover valid itemIds.`,
  );
}

/** Set the eye color on one item as a separate "eyes" sub-selection entry. */
function applyEyeColor(catalog, selections, item, color) {
  const idx = item.recolors.findIndex((r) => r.type_name === "eyes");
  if (idx === -1) {
    throw new SelectionError(`Item "${item.itemId}" has no eye-color slot.`);
  }
  const verified = fixMissingRecolor(catalog, item.itemId, color, "eyes");
  if (!verified) {
    throw new SelectionError(
      `"${color}" is not a valid eye color for "${item.itemId}". ` +
        colorNamesHint(color, item.recolors[idx].variants),
    );
  }
  selections["eyes"] = {
    itemId: item.itemId,
    subId: idx,
    variant: null,
    recolor: verified,
  };
}

/**
 * Apply colors.eyes: attach an eyes sub-selection to the selected head item
 * (falls back to the expression item). Other items with an eyes recolor pick
 * this up through getMultiRecolors' cross-selection matching.
 */
function applyEyeColorToSelections(catalog, selections, color) {
  const head = selections.head ?? selections.expression;
  if (!head) {
    throw new SelectionError("colors.eyes: no head or expression item is selected.");
  }
  const item = catalog.getItem(head.itemId);
  const hasEyes = item.recolors.some((r) => r.type_name === "eyes");
  if (!hasEyes) {
    const expr = selections.expression
      ? catalog.getItem(selections.expression.itemId)
      : null;
    if (expr && expr.recolors.some((r) => r.type_name === "eyes")) {
      applyEyeColor(catalog, selections, expr, color);
      return;
    }
    throw new SelectionError(`colors.eyes: selected head "${head.itemId}" has no eye-color slot.`);
  }
  applyEyeColor(catalog, selections, item, color);
}
