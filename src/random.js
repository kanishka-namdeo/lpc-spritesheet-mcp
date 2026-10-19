// Deterministic seeded random character generator — the "surprise me" feature.
//
// randomCharacter(catalog, {seed}) rolls a coherent, render-ready character from
// ONE canonical PRNG stream derived from the seed: the same seed produces the
// same character in every process, forever. The result is in tool-input form —
// `selections` maps group → itemId | {itemId, variant} and `colors` maps
// group → color name — exactly the shape `normalizeSelections(catalog,
// bodyType, selections, colors)` accepts, so the output can be fed straight to
// generate_spritesheet / export_character.
//
// Determinism contract: no Math.random, no Date, no environment input. The
// catalog's maps are built by sorted directory walks, so their iteration order
// is stable for a given pack revision and safe to draw from.
//
// Every emitted color is verified with fixMissingRecolor and every emitted item
// is drawn from a bodyType-filtered pool, so the output never throws in
// normalizeSelections. Pack-coverage surprises (relaxed completeness filters,
// skipped groups, melee-less soldiers) are reported as human-readable `notes`.

import { BODY_TYPES } from "./engine/constants.js";
import { fixMissingRecolor } from "./engine/recolor.js";

// ---------------------------------------------------------------------------
// PRNG — all three by bryc (https://github.com/bryc/code), public domain (CC0).
// Pure 32-bit integer math (Math.imul, >>>): bit-stable across Node versions
// and platforms, unlike anything seeded from Math.random or Date.
// ---------------------------------------------------------------------------

/** cyrb128: string → 128-bit hash as four 32-bit words. */
export function cyrb128(str) {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** xmur3: string → () => fresh 32-bit seed per call. */
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32: 32-bit seed → PRNG returning floats in [0, 1). */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The canonical per-character stream: cyrb128's first word drives mulberry32. */
export function rngForSeed(seed) {
  return mulberry32(cyrb128(String(seed))[0]);
}

// ---------------------------------------------------------------------------
// Generation tables
// ---------------------------------------------------------------------------

/** Weighted body-type draw (weights sum to 1). */
export const BODY_TYPE_WEIGHTS = [
  ["male", 0.3],
  ["female", 0.3],
  ["teen", 0.12],
  ["child", 0.1],
  ["muscular", 0.12],
  ["pregnant", 0.06],
];

/**
 * Per-group chance that an optional gear slot is filled, by gear profile.
 * Shields additionally require a melee weapon in the same roll (see below);
 * everything else rolls independently.
 */
export const GEAR_PROFILES = {
  bare: { weapon: 0.0, hat: 0.15, shield: 0.0, belt: 0.1, ears: 0.1, tail: 0.05, wings: 0.0 },
  civilian: { weapon: 0.25, hat: 0.4, shield: 0.0, belt: 0.25, ears: 0.15, tail: 0.05, wings: 0.0 },
  soldier: { weapon: 0.9, hat: 0.2, shield: 0.5, belt: 0.4, ears: 0.1, tail: 0.05, wings: 0.0 },
  fancy: { weapon: 0.2, hat: 0.65, shield: 0.0, belt: 0.5, ears: 0.25, tail: 0.1, wings: 0.15 },
};

/** Groups that are visible whenever selected; completeOnly requires their
 * items to paint both the walk and idle rows so a random character never has
 * empty core rows. */
const ALWAYS_VISIBLE_GROUPS = new Set([
  "head", "expression", "hair", "clothes", "legs", "shoes", "hat",
]);

/** Fixed processing order — the rng draw sequence is part of the contract. */
const GEAR_GROUP_ORDER = ["weapon", "hat", "shield", "belt", "ears", "tail", "wings"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Uniform pick from a non-empty array. */
function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** An item with no declared animations paints nothing (custom-animation-only
 * items declare their block in `animations`, so this keeps them eligible). */
function isVisible(item) {
  return item.animations.length > 0;
}

/** The completeness gate: paints both core rows. */
function isComplete(item) {
  return item.animations.includes("walk") && item.animations.includes("idle");
}

/** Does this weapon paint melee (slash-family) art? Only two items carry the
 * plain "slash" row; the rest of the melee art lives in slash_128 /
 * slash_oversize / slash_reverse_oversize custom blocks, so the whole family
 * counts as melee. */
function isMeleeWeapon(item) {
  return item.animations.some((a) => a.startsWith("slash") || a.startsWith("1h_"));
}

/** The primary recolor slot (type_name null) — the one colors.<group> reaches. */
function primaryColorSlot(item) {
  return item.recolors.find((r) => r.type_name === null && r.variants?.length > 0) ?? null;
}

/** Tool-input value for an item: the plain itemId, or {itemId, variant} when
 * the item ships variants (a random one — the app default is variants[0]). */
function selectionValue(rng, item) {
  return item.variants.length > 0
    ? { itemId: item.itemId, variant: choice(rng, item.variants) }
    : item.itemId;
}

/**
 * Mirror of the renderer's replaceInPath resolution: an expression whose layer
 * paths carry `${head}` only ships art for the heads its table names — 12 of
 * the 15 faces are human-head-only, the other 3 live in `faces/global/` and
 * fit any head. A templated face on a beast head would leave the template
 * unresolved and every face row empty, so the pool must be filtered.
 */
function expressionFitsHead(exprItem, headItem) {
  const headKey = headItem.name.replaceAll(" ", "_");
  for (const layer of Object.values(exprItem.layers)) {
    for (const value of Object.values(layer)) {
      if (typeof value !== "string" || !value.includes("${")) continue;
      for (const [typeName, map] of Object.entries(exprItem.replaceInPath)) {
        if (value.includes(`\${${typeName}}`) && !map?.[headKey]) return false;
      }
    }
  }
  return true;
}

/**
 * The recolor slot `colors.eyes` addresses: the renderer attaches the eye
 * color to the head when it carries an "eyes" slot, else to the expression.
 * Beast heads have their eyes baked in and many faces have no slot either —
 * then there is nothing to color.
 */
function eyesSlotOf(headItem, exprItem) {
  for (const item of [headItem, exprItem]) {
    if (!item) continue;
    const slot = item.recolors.find((r) => r.type_name === "eyes");
    if (slot?.variants?.length) return { item, slot };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Roll one deterministic character.
 *
 * @param {import('./engine/catalog.js').Catalog} catalog
 * @param {{seed?: string, bodyType?: string|null, gear?: "bare"|"civilian"|"soldier"|"fancy",
 *          completeOnly?: boolean}} [opts] seed defaults to "" and is ALWAYS
 *   the identity of the character — same seed, same character.
 * @returns {{bodyType: string, selections: Record<string, string|object>,
 *            colors: Record<string,string>, seed: string, notes: string[]}}
 *   Output is in tool-input form: selections = {group: itemId | {itemId,
 *   variant?}} and colors = {group: colorName} — exactly what
 *   normalizeSelections(catalog, bodyType, selections, colors) accepts.
 * @throws {TypeError} on an unknown bodyType or gear profile.
 */
export function randomCharacter(catalog, opts = {}) {
  const seed = opts.seed === undefined || opts.seed === null ? "" : String(opts.seed);
  const rng = rngForSeed(seed);
  const notes = [];
  const selections = {};
  const colors = {};

  // ---- bodyType (one draw against the fixed weight table, unless forced) ----
  let bodyType = opts.bodyType ?? null;
  if (bodyType === null) {
    let roll = rng();
    bodyType = BODY_TYPE_WEIGHTS[BODY_TYPE_WEIGHTS.length - 1][0];
    for (const [bt, weight] of BODY_TYPE_WEIGHTS) {
      if (roll < weight) {
        bodyType = bt;
        break;
      }
      roll -= weight;
    }
  } else if (!BODY_TYPES.includes(bodyType)) {
    throw new TypeError(`Unknown bodyType "${bodyType}". Valid: ${BODY_TYPES.join(", ")}.`);
  }

  const gearName = opts.gear ?? "civilian";
  if (!Object.hasOwn(GEAR_PROFILES, gearName)) {
    throw new TypeError(
      `Unknown gear profile "${gearName}". Valid: ${Object.keys(GEAR_PROFILES).join(", ")}.`,
    );
  }
  const gear = GEAR_PROFILES[gearName];
  const completeOnly = opts.completeOnly === undefined ? true : Boolean(opts.completeOnly);

  /**
   * Pool for a group on this bodyType. `gate` applies the walk+idle
   * completeness requirement (always-visible groups), relaxing with a note
   * when the pack has no complete item rather than dropping the group.
   */
  const pickItem = (group, gate = false) => {
    let pool = catalog.getItemsByType(group, bodyType).filter(isVisible);
    if (pool.length === 0) {
      notes.push(`${group}: no item supports bodyType ${bodyType} — group skipped`);
      return null;
    }
    if (completeOnly && gate) {
      const complete = pool.filter(isComplete);
      if (complete.length > 0) {
        pool = complete;
      } else {
        notes.push(
          `${group}: no complete (walk+idle) item for bodyType ${bodyType} — relaxed completeness filter`,
        );
      }
    }
    return choice(rng, pool);
  };

  /**
   * Record an item: its tool-input value (with a random variant when it ships
   * any) plus a verified random color from the primary recolor slot. Pass
   * `uncolored` for items whose color follows the body tone (matchBodyColor).
   */
  const select = (group, item, { uncolored = false } = {}) => {
    if (!item) return;
    selections[group] = selectionValue(rng, item);
    if (uncolored) return;
    const slot = primaryColorSlot(item);
    if (slot) {
      const color = fixMissingRecolor(catalog, item.itemId, choice(rng, slot.variants), null);
      if (color) colors[group] = color;
    }
  };

  // ---- body + skin tone (the `body` item's palette, fantasy tones included) ----
  selections.body = "body";
  const bodyPalette = catalog.getItem("body")?.recolors[0]?.variants ?? [];
  if (bodyPalette.length > 0) {
    const tone = fixMissingRecolor(catalog, "body", choice(rng, bodyPalette), null);
    if (tone) colors.body = tone;
  }

  // ---- head: 70% human, 30% any head in the category (beast/undead/…) ----
  const heads = catalog.getItemsByType("head", bodyType).filter(isVisible);
  if (heads.length === 0) {
    notes.push(`head: no item supports bodyType ${bodyType} — group skipped`);
  }
  let headPool = heads;
  if (heads.length > 0 && rng() < 0.7) {
    const humans = heads.filter((h) => h.itemId.startsWith("heads_human"));
    if (humans.length > 0) headPool = humans;
  }
  const headItem = heads.length > 0 ? choice(rng, headPool) : null;
  // No colors.head: heads follow the body tone via matchBodyColor.
  select("head", headItem, { uncolored: true });

  // ---- expression: any face the chosen head can wear ----
  // When nothing supports the bodyType (child), the group is left unset —
  // normalizeSelections' default face_neutral stays and the renderer skips it
  // for that body type (an explicit pick would throw in normalizeSelections).
  let exprPool = catalog
    .getItemsByType("expression", bodyType)
    .filter(isVisible)
    .filter((e) => headItem === null || expressionFitsHead(e, headItem));
  let exprItem = null;
  if (exprPool.length === 0) {
    notes.push(
      `expression: no item supports bodyType ${bodyType} — the normalizeSelections default (face_neutral) stays, hidden on this body type`,
    );
  } else {
    if (completeOnly) {
      const complete = exprPool.filter(isComplete);
      if (complete.length > 0) exprPool = complete;
      else {
        notes.push(
          `expression: no complete (walk+idle) item for bodyType ${bodyType} — relaxed completeness filter`,
        );
      }
    }
    exprItem = choice(rng, exprPool);
    selections.expression = selectionValue(rng, exprItem);
  }

  // ---- hair ----
  select("hair", pickItem("hair", true));

  // ---- eyes: a random eye color when the head (or face) carries the slot ----
  const eyesTarget = eyesSlotOf(headItem, exprItem);
  if (eyesTarget) {
    const color = fixMissingRecolor(
      catalog, eyesTarget.item.itemId, choice(rng, eyesTarget.slot.variants), "eyes",
    );
    if (color) colors.eyes = color;
  }

  // ---- core outfit ----
  for (const group of ["clothes", "legs", "shoes"]) {
    select(group, pickItem(group, true));
  }

  // ---- optional gear: one roll per group, in a fixed order ----
  let weaponItem = null;
  for (const group of GEAR_GROUP_ORDER) {
    if (!(rng() < gear[group])) continue;

    if (group === "weapon") {
      let pool = catalog.getItemsByType("weapon", bodyType).filter(isVisible);
      if (pool.length === 0) {
        notes.push(`weapon: no item supports bodyType ${bodyType} — group skipped`);
        continue;
      }
      if (completeOnly) {
        // Soldier bias: prefer melee weapons when the pack has any.
        const melee = pool.filter(isMeleeWeapon);
        if (melee.length > 0) pool = melee;
        else {
          notes.push(
            `weapon: no melee (slash-capable) item for bodyType ${bodyType} — picked from all weapons`,
          );
        }
      }
      weaponItem = choice(rng, pool);
      select("weapon", weaponItem);
      continue;
    }

    if (group === "shield" && (!weaponItem || !isMeleeWeapon(weaponItem))) {
      // A shield only makes sense in the off-hand of a melee fighter; bows
      // and bare hands carry none. (A shield+weapon combo whose art is
      // missing only warns — acceptable.)
      continue;
    }

    select(group, pickItem(group, ALWAYS_VISIBLE_GROUPS.has(group)));
  }

  return { bodyType, selections, colors, seed, notes };
}

/**
 * Batch helper: character i uses seed `${seed}:${i}`, so a whole batch of
 * NPCs is one reproducible unit — regenerate the village by re-running the
 * same call.
 *
 * @param {import('./engine/catalog.js').Catalog} catalog
 * @param {{seed?: string, count?: number, bodyType?: string|null,
 *          gear?: "bare"|"civilian"|"soldier"|"fancy", completeOnly?: boolean}} [opts]
 * @returns {ReturnType<typeof randomCharacter>[]}
 * @throws {TypeError} on a negative or non-integer count, or the same values
 *   randomCharacter rejects.
 */
export function randomCharacters(catalog, { seed = "", count = 5, ...opts } = {}) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`count must be a non-negative integer, got ${count}`);
  }
  return Array.from({ length: n }, (_, i) =>
    randomCharacter(catalog, { ...opts, seed: `${seed}:${i}` }),
  );
}
