// Saved-character documents: what a render was made of, and how to read one back.
//
// Upstream's `character.json` carries the layer inventory (z-order, per-layer animation support,
// recolor slots) plus credits; this port used to write only the resolved selections, which meant a
// saved file could not answer "why is this row empty". Here the layer list is taken from the draw
// calls the engine actually painted, so it cannot disagree with the PNG it describes.
import { BODY_TYPES } from "./engine/constants.js";
import { resolveItem } from "./engine/selection.js";
import { fixMissingRecolor } from "./engine/recolor.js";

/**
 * Full v2 document for `<name>-character.json`.
 * @param {import('./engine/catalog.js').Catalog} catalog
 * @param {object} params { bodyType, selections, layers, credits, warnings, generator, pack }
 */
export function buildCharacterSpec(catalog, { bodyType, selections, layers, credits = [], generator, pack }) {
  const layerDocs = layers.map((entry) => {
    const meta = catalog.getItem(entry.itemId);
    const group = groupOf(selections, entry.itemId);
    const selection = group ? selections[group] : null;
    return {
      itemId: entry.itemId,
      name: meta?.name ?? entry.itemId,
      typeName: meta?.typeName ?? group ?? null,
      layerNum: entry.layerNum,
      zPos: entry.zPos,
      variant: selection?.variant ?? null,
      recolor: selection?.recolor ?? null,
      subId: selection?.subId ?? null,
      needsRecolor: Boolean(selection?.recolor) && (meta?.recolors.length ?? 0) > 0,
      recolorSlots: (meta?.recolors ?? []).map((r) => ({
        slot: r.label,
        material: r.material,
        type: r.type_name ?? null,
        default: r.variants[0],
      })),
      // Row blocks this layer contributed art to. A group the item claims but does not paint here
      // is an upstream asset gap, and this is the field that proves it.
      supportedAnimations: entry.animations,
      customAnimation: entry.customAnimation ?? null,
    };
  });

  return {
    version: 2,
    bodyType,
    generatedBy: generator,
    pack,
    selections: Object.fromEntries(
      Object.entries(selections).map(([group, sel]) => [group, { ...sel }]),
    ),
    layers: layerDocs,
    credits,
    flags: {
      matchBodyColor: true,
      selectedAnimation: "idle",
      showTransparencyGrid: false,
      applyTransparencyMask: false,
      compactDisplay: false,
    },
  };
}

function groupOf(selections, itemId) {
  for (const [group, sel] of Object.entries(selections)) {
    if (sel.itemId === itemId && sel.subId == null) return group;
  }
  for (const [group, sel] of Object.entries(selections)) {
    if (sel.itemId === itemId) return group;
  }
  return null;
}

/**
 * Read a saved-character document, a URL hash, or a bare `#...` string into
 * `{ bodyType, selections, warnings }` for `normalizeSelections` to finish.
 *
 * v2 is the app's "Save character as JSON" shape and round-trips exactly. v1 carries a `url`
 * state hash of `#sex=male&<type_name>=Name[_variant][_recolor]`; the names are resolved through
 * the same resolver as tool input, and anything this pack cannot name becomes a warning rather
 * than a failed request — an old bookmark is expected to be partly stale.
 */
export function readSavedCharacter(catalog, doc) {
  if (typeof doc === "string") {
    const text = doc.trim();
    if (text.startsWith("#") || text.includes("&")) return fromHash(catalog, text);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new TypeError(`character is not valid JSON: ${e.message}.`);
    }
    return readSavedCharacter(catalog, parsed);
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new TypeError(
      "character must be a saved-character object ({version:2, selections}) or a v1 document with a state `url`.",
    );
  }

  if (doc.version === 1 || (doc.url && !doc.selections)) {
    const fromUrl = fromHash(catalog, doc.url ?? "");
    if (doc.sex ?? doc.bodyType) {
      const body = doc.sex ?? doc.bodyType;
      if (BODY_TYPES.includes(body)) fromUrl.bodyType = body;
    }
    return fromUrl;
  }

  if (doc.version !== 2 || !isPlain(doc.selections)) {
    throw new TypeError(
      "character must be a saved-character JSON with {version: 2, selections: {group: {itemId, subId, variant, recolor}}} (the app's 'Save character as JSON' export shape).",
    );
  }

  const selections = {};
  for (const [group, sel] of Object.entries(doc.selections)) {
    if (!isPlain(sel) || typeof sel.itemId !== "string") {
      throw new TypeError(`character.selections.${group} must be an object with at least {itemId}.`);
    }
    selections[group] = {
      itemId: sel.itemId,
      subId: sel.subId ?? null,
      variant: sel.variant ?? null,
      recolor: sel.recolor ?? null,
    };
  }
  const bodyType = doc.bodyType ?? doc.sex ?? null;
  if (bodyType !== null && typeof bodyType !== "string") {
    throw new TypeError(`character.bodyType must be a string; got ${typeof bodyType}.`);
  }
  return { bodyType, selections, warnings: [] };
}

function fromHash(catalog, url) {
  const hash = String(url ?? "").replace(/^.*#/, "");
  const selections = {};
  const warnings = [];
  let bodyType = null;

  for (const pair of hash.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue);

    if (key === "sex" || key === "bodyType") {
      if (BODY_TYPES.includes(value)) bodyType = value;
      else if (value) warnings.push(`State hash body type "${value}" is not one of ${BODY_TYPES.join(", ")}; using the default.`);
      continue;
    }
    if (!catalog.byTypeName.has(key)) {
      warnings.push(`State hash group "${key}" is not a selection group in this pack; ignored.`);
      continue;
    }
    if (value === "" || value === "none" || value === "_none") {
      selections[key] = "none";
      continue;
    }
    const resolved = resolveHashValue(catalog, key, value, warnings);
    if (!resolved) {
      warnings.push(`State hash ${key}="${value}" matches no item in this pack; ignored.`);
      continue;
    }
    selections[key] = resolved;
  }
  return { bodyType, selections, warnings };
}

/**
 * A hash value is `Name`, `Name_variant` or `Name_variant_recolor`, but names themselves contain
 * underscores, so peel trailing segments off until one resolves as an item. A tail that is not a
 * real variant or color of that item is dropped with a warning: an old bookmark is expected to be
 * partly stale, and one dead color name must not fail the whole render.
 */
function resolveHashValue(catalog, group, value, warnings) {
  const parts = value.split("_");
  for (let take = parts.length; take > 0; take--) {
    const name = parts.slice(0, take).join("_");
    let item;
    try {
      item = resolveItem(catalog, name, group);
    } catch {
      continue;
    }
    const rest = parts.slice(take);
    const out = { itemId: item.itemId, subId: null, variant: null, recolor: null };
    const tail = rest.length >= 2 ? [rest[0], rest[1]] : rest.length === 1 ? [pickTail(item, rest[0])] : [];
    if (rest.length >= 2) {
      out.variant = item.variants.includes(rest[0]) ? rest[0] : null;
      out.recolor = rest[1];
      if (!item.variants.includes(rest[0])) {
        warnings.push(`State hash ${group}="${value}" variant "${rest[0]}" is not a variant of ${item.itemId}; ignored.`);
      }
    } else if (rest.length === 1) {
      if (tail[0] === "variant") out.variant = rest[0];
      else if (tail[0] === "recolor") out.recolor = rest[0];
      else {
        warnings.push(`State hash ${group}="${value}" tail "${rest[0]}" is neither a variant nor a color of ${item.itemId}; ignored.`);
      }
    }
    if (out.recolor && item.recolors.length) {
      const ok = fixMissingRecolor(catalog, item.itemId, out.recolor, null);
      if (!ok) {
        warnings.push(`State hash ${group}="${value}" color "${out.recolor}" is not offered by ${item.itemId}; ignored.`);
        out.recolor = null;
      }
    } else if (out.recolor) {
      warnings.push(`State hash ${group}="${value}" asked to color ${item.itemId}, which has no recolor slots; ignored.`);
      out.recolor = null;
    }
    return out;
  }
  return null;
}

/** With one trailing segment, the item decides whether it reads as a variant or a color. */
function pickTail(item, tail) {
  if (item.variants.includes(tail)) return "variant";
  if (item.recolors.length) return "recolor";
  return "unknown";
}

function isPlain(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Upstream shareable-URL encoding — the writer half of `fromHash` above.
//
// Reference: sources/state/hash.ts in the Universal-LPC-Spritesheet-Character-Generator
// web app. `getHashParamsforSelections` (hash.ts:181–249) builds the params:
//   - `sex=<bodyType>` comes first, spelled "sex" for old-URL compatibility (hash.ts:189);
//   - key  = subMeta?.type_name ?? meta.type_name (hash.ts:231): a selection group is the
//     item's type_name, and a color sub-selection (e.g. the head's eye-color slot) becomes
//     its OWN param keyed by the recolor slot's type_name;
//   - name part = (subMeta?.label ?? meta.name) with spaces→underscores (hash.ts:235)
//     — the item DISPLAY NAME, never the itemId;
//   - value = namePart + "_" + variant + "|" + recolor, with "_" only when a tail exists
//     and "|" only when both exist (hash.ts:237–242). Variant/recolor strings are written
//     raw: a variant like "dark brown" encodes as `dark%20brown`, which upstream's decoder
//     accepts alongside the old underscore spelling (issue #296);
//   - `createHashStringFromParams` (hash.ts:116–125) joins `encodeURIComponent(key)=
//     encodeURIComponent(value)` with "&" (the browser adds the leading "#").
//
// EYES FINDING: upstream has a dedicated `eyes=` param. Head and expression items carry a
// second recolor slot `{type_name: "eyes", label: "Eye Color"}`, and a selection of that
// slot encodes as `eyes=Eye_Color_<color>` — the slot LABEL is the name part (upstream's
// own test tests/state/hash_spec.js:160–195 shows label "Eyes" → `eyes=Eyes_blue`).
// Upstream decodes it with a sub-item fallback (hash.ts:354–411): params that resolve to
// no item are matched against the recolor slots of the already-selected items, so
// `eyes=Eye_Color_green` reopens as the eye color "green" on the selected head. This
// port's `fromHash` has no such fallback, so `eyes=` (and other slot params such as
// `handle=` on axes) decode to a warning and are dropped — a documented limit of the HASH
// path here. The URL itself opens correctly in the real web app (the product goal), and
// the v2 JSON path carries sub-selections losslessly.
//
// Deliberate divergences from upstream:
//   - Groups are emitted sorted by param name. Upstream has no canonical order (it
//     serializes selection-map insertion order); both decoders are order-independent, so
//     a sorted canonical string is chosen for stability.
//   - Upstream's alias pass (hash.ts:196–222) only fires for items without type_name —
//     none exist in this pack — so it is not ported.
//   - Tails are validated against the catalog (a variant must be one of the item's
//     variants, matched exactly or via upstream's space/underscore-insensitive comparison;
//     a color must pass `fixMissingRecolor`) and dropped when they do not verify, so a
//     generated URL never re-opens with decoder warnings about its own values. Upstream
//     writes tails unvalidated; valid selections encode byte-identically either way.
// ---------------------------------------------------------------------------

/** Live upstream web app (its README "Try it here" link) — the target these URLs open in. */
export const GENERATOR_APP_URL =
  "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/";

/**
 * Mirrors upstream `normalizeVariantForHashMatch` (resolve-hash-param.ts:272–280) minus
 * the URI-decode step (our input is a selection string, not URL text): "dark brown",
 * "dark_brown" and "Dark_Brown" all compare equal, so a caller's variant spelling still
 * encodes as the item's canonical variant.
 */
function normalizeVariantForMatch(value) {
  return String(value).replaceAll(" ", "_").toLowerCase();
}

/**
 * Serialize to the upstream state-hash format: "#sex=female&hair=Bangs_red&..." using
 * upstream's exact encoding (names, not itemIds; spaces→underscores; variant/color tails).
 *
 * `character.selections` is serialized exactly as given — pass `normalizeSelections()`
 * output or a v2 document's `selections` for a full character. `character.colors`
 * (group → color name) is folded into each selection's recolor tail first, because the
 * hash format has no separate color section; the special "eyes" group folds onto the
 * eyes sub-selection the same way.
 *
 * Never throws on odd input: entries whose itemId does not resolve (stale items, "none"
 * leftovers, junk shapes) are skipped — they were warnings when the character was read.
 *
 * @param {import('./engine/catalog.js').Catalog} catalog
 * @param {{bodyType: string, selections: Record<string,{itemId,subId,variant,recolor}>, colors?: Record<string,string>}} character
 * @returns {string} hash starting with "#"
 */
export function toStateHash(catalog, character) {
  const c = character ?? {};
  const selections = isPlain(c.selections) ? { ...c.selections } : {};

  // Fold the color map into the selections (on the copy — the caller's object is never
  // mutated), verifying each color the same way normalizeSelections does.
  for (const [group, color] of Object.entries(isPlain(c.colors) ? c.colors : {})) {
    const sel = selections[group];
    if (!isPlain(sel) || typeof sel.itemId !== "string" || typeof color !== "string") continue;
    const item = catalog.getItem(sel.itemId);
    if (!item) continue;
    const slot = sel.subId != null ? item.recolors[sel.subId] : item.recolors[0];
    if (!slot) continue; // nothing recolorable to fold onto
    const verified = fixMissingRecolor(catalog, item.itemId, color, slot.type_name ?? null);
    if (verified) selections[group] = { ...sel, recolor: verified };
    // An unofferable color is skipped, not emitted: the URL must not carry a value its
    // own decoder would warn about.
  }

  /** @type {Record<string, string>} */
  const params = {};
  if (typeof c.bodyType === "string" && c.bodyType) params.sex = c.bodyType;

  for (const group of Object.keys(selections).sort()) {
    const sel = selections[group];
    if (!isPlain(sel) || typeof sel.itemId !== "string") continue; // "none" strings / junk never encode
    const item = catalog.getItem(sel.itemId);
    if (!item || !item.typeName) continue; // stale itemId or unhashable group

    // Color sub-selections (subId != null): keyed by the slot's type_name, named by the
    // slot's label — exactly hash.ts:225–244.
    const subMeta = sel.subId != null ? item.recolors[sel.subId] : undefined;
    const key = subMeta?.type_name ?? item.typeName;
    const namePart = (subMeta?.label ?? item.name).replaceAll(" ", "_");

    const variantPart =
      typeof sel.variant === "string" && sel.variant
        ? item.variants.find(
            (v) => v === sel.variant || normalizeVariantForMatch(v) === normalizeVariantForMatch(sel.variant),
          ) ?? ""
        : "";
    let recolorPart = "";
    if (typeof sel.recolor === "string" && sel.recolor) {
      const slot = subMeta ?? item.recolors[0];
      if (slot) {
        recolorPart = fixMissingRecolor(catalog, item.itemId, sel.recolor, slot.type_name ?? null) ?? "";
      }
    }

    params[key] =
      namePart +
      (variantPart || recolorPart ? "_" : "") +
      variantPart +
      (variantPart && recolorPart ? "|" : "") +
      recolorPart;
  }

  return (
    "#" +
    Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&")
  );
}

/**
 * Full upstream web-app URL: `"<live app URL>#sex=..."` — open it in a browser to
 * continue tweaking the exact character in the real generator.
 *
 * @param {import('./engine/catalog.js').Catalog} catalog
 * @param {{bodyType: string, selections: Record<string,{itemId,subId,variant,recolor}>, colors?: Record<string,string>}} character
 * @returns {string} absolute URL whose fragment is the state hash
 */
export function generatorUrl(catalog, character) {
  return GENERATOR_APP_URL + toStateHash(catalog, character);
}
