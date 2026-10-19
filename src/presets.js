// Preset library — named character archetypes a caller can render in one call
// (`preset: "knight"`) instead of assembling a dozen itemIds by hand.
//
// Every entry is expressed in TOOL-INPUT form (exactly what a caller passes as
// the `selections` and `colors` arguments): selections map a selection group to
// an itemId string or an object {itemId, variant?, recolor?}; colors map a
// group to a palette color name (see list_palettes). Both forms are validated
// by normalizeSelections, and every preset below is rendered by the test suite
// against the pinned asset pack — the walk cycle paints in all four directions
// and no selected item reports a missing `walk` row.
//
// Curation notes (verified against the pack at the pinned revision):
// - Bows (normal/great/recurve) declare `walk` art but ship none, so ranged
//   presets use the crossbow/slingshot which do ship walk sprites.
// - Only the nine human heads resolve the expression layer's `${head}` path
//   template, so presets with non-human heads (zombie, lizard) set
//   `expression: "none"` — those heads ship their own baked-in faces.
// - The child body type has no shoes and no expression items in the pack, and
//   the muscular body type has no torso clothes at all; those presets are
//   intentionally minimal and the exceptions are asserted in test/presets-test.mjs.
// - Palette-recolor shirts (e.g. Longsleeve) ship no pregnant art at all, so
//   the pregnant preset uses the variant-colored tank top; the wizard robe is
//   female-only, so the mage is an elderly witch.

/** @typedef {{itemId: string, variant?: string, recolor?: string}} PresetItem */

/**
 * @type {Array<{
 *   name: string,
 *   description: string,
 *   bodyType: string,
 *   selections: Record<string, string | PresetItem>,
 *   colors: Record<string, string>,
 * }>}
 */
const PRESETS = [
  {
    name: "villager",
    description: "Plain everyday villager: longsleeve shirt, pants and simple shoes.",
    bodyType: "male",
    selections: {
      head: "heads_human_male",
      hair: "hair_plain",
      expression: "face_neutral",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_shoes_basic",
    },
    colors: { body: "olive", hair: "chestnut", eyes: "brown", clothes: "tan", legs: "slate", shoes: "brown" },
  },
  {
    name: "knight",
    description:
      "Full plate knight: greathelm, steel plate armour, arming sword and an oak heater shield with steel trim and a maroon cross.",
    bodyType: "male",
    selections: {
      head: "heads_human_male",
      expression: "face_neutral",
      hat: "hat_helmet_greathelm",
      armour: "torso_armour_plate",
      legs: "legs_armour",
      shoes: "feet_armour",
      weapon: { itemId: "weapon_sword_arming", variant: "steel" },
      shield: "shield_heater_revised_wood",
      shield_trim: "shield_heater_revised_trim",
      shield_pattern: "shield_heater_revised_pattern_cross",
    },
    colors: {
      body: "light",
      hat: "steel",
      armour: "steel",
      legs: "steel",
      shoes: "steel",
      shield: "oak",
      shield_trim: "steel",
      shield_pattern: "maroon",
    },
  },
  {
    name: "ranger",
    description:
      "Forest ranger: cloth hood, quiver and a crossbow (the pack's bows ship no walk-cycle art, so this preset uses the crossbow).",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_high_ponytail",
      expression: "face_neutral",
      hat: "hat_hood_cloth",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: "weapon_ranged_crossbow",
      quiver: "quiver",
    },
    colors: { body: "amber", hair: "chestnut", eyes: "green", hat: "forest", clothes: "green", legs: "leather", shoes: "brown" },
  },
  {
    name: "mage",
    description:
      "Elderly witch: purple robe, navy wizard hat and a simple staff (the robe ships female-only art).",
    bodyType: "female",
    selections: {
      head: "heads_human_female_elderly",
      hair: "hair_bangs_bun",
      expression: "face_neutral",
      hat: { itemId: "hat_magic_wizard", variant: "navy" },
      clothes: { itemId: "torso_clothes_robe", variant: "purple" },
      legs: "legs_leggings",
      shoes: "feet_slippers",
      weapon: "weapon_magic_simple",
    },
    colors: { body: "light", hair: "white", eyes: "blue", legs: "charcoal", shoes: "charcoal" },
  },
  {
    name: "blacksmith",
    description:
      "Village blacksmith: leather apron over a sleeveless shirt, work boots and a hammer (with its hammer-swing animation block).",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_ponytail",
      expression: "face_neutral",
      clothes: { itemId: "torso_clothes_sleeveless", variant: "bluegray" },
      apron: { itemId: "torso_aprons_apron", variant: "leather" },
      legs: "legs_pants",
      shoes: "feet_boots_fold",
      weapon: "tool_hammer",
    },
    colors: { body: "amber", hair: "chestnut", eyes: "brown", legs: "brown", shoes: "brown", weapon: "iron" },
  },
  {
    name: "farmer",
    description:
      "Farmhand in a wide-brim hat with a watering can (waters crops via the watering animation).",
    bodyType: "male",
    selections: {
      head: "heads_human_male",
      hair: "hair_bedhead",
      expression: "face_neutral",
      hat: { itemId: "hat_magic_large", variant: "brown" },
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_fold",
      weapon: "tool_watering_can",
    },
    colors: { body: "bronze", hair: "sandy", eyes: "brown", clothes: "tan", legs: "blue", shoes: "brown", weapon: "oak" },
  },
  {
    name: "rogue",
    description: "Hooded rogue in blackened leather armour with a dagger.",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_bob",
      expression: "face_eyeroll",
      hat: "hat_hood_cloth",
      armour: "torso_armour_leather",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: "weapon_sword_dagger",
    },
    colors: { body: "olive", hair: "black", eyes: "green", hat: "charcoal", armour: "black", legs: "charcoal", shoes: "black" },
  },
  {
    name: "royal",
    description:
      "A king in formal white and gold: crown, maroon cape, epaulets and a silver necklace.",
    bodyType: "male",
    selections: {
      head: "heads_human_male",
      hair: "hair_page",
      expression: "face_neutral",
      hat: { itemId: "hat_formal_crown", variant: "crown_gold" },
      clothes: { itemId: "torso_clothes_longsleeve_formal", variant: "white" },
      legs: "legs_formal",
      shoes: "feet_shoes_revised",
      cape: "cape_solid",
      shoulders: "shoulders_epaulets",
      necklace: { itemId: "neck_necklace", variant: "silver" },
    },
    colors: { body: "light", hair: "dark_gray", eyes: "brown", legs: "black", shoes: "black", cape: "maroon", shoulders: "gold" },
  },
  {
    name: "child",
    description:
      "A kid in a red shirt and blue pants (child body type: the pack ships no child shoes or expressions, so this preset is intentionally minimal).",
    bodyType: "child",
    selections: {
      head: "heads_human_child",
      hair: "hair_wavy_child",
      clothes: { itemId: "torso_clothes_child_shirt", variant: "red" },
      legs: { itemId: "legs_childpants", variant: "blue" },
    },
    colors: { body: "light", hair: "chestnut", eyes: "blue" },
  },
  {
    name: "zombie",
    description:
      "Shambling undead: zombie head with green-rotted skin, unkempt hair, tattered cape (no expression — the zombie head ships its own face).",
    bodyType: "male",
    selections: {
      head: "heads_zombie",
      expression: "none",
      hair: "hair_unkempt",
      clothes: { itemId: "torso_clothes_longsleeve_laced", variant: "charcoal" },
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      cape: "cape_tattered",
    },
    colors: { body: "zombie_green", head: "zombie_green", hair: "dark_gray", legs: "charcoal", shoes: "charcoal", cape: "forest" },
  },
  {
    name: "lizardfolk",
    description:
      "Green-scaled lizardfolk warrior with tail, laced leather shirt and a bronze spear (no expression — the lizard head ships its own face).",
    bodyType: "male",
    selections: {
      head: "heads_lizard_male",
      expression: "none",
      tail: "tail_lizard",
      clothes: { itemId: "torso_clothes_longsleeve_laced", variant: "leather" },
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: { itemId: "weapon_polearm_spear", variant: "bronze" },
    },
    colors: { body: "green", legs: "brown", shoes: "brown" },
  },
  {
    name: "wheelchair-user",
    description:
      "Wheelchair user in casual clothes; the wheelchair adds a dedicated wheelchair animation block (it layers around the character, so the usual legs and shoes still render).",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_bob",
      expression: "face_happy",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_shoes_basic",
      wheelchair: { itemId: "wheelchair", variant: "blue" },
    },
    colors: { body: "light", hair: "platinum", eyes: "blue", clothes: "teal", legs: "slate", shoes: "white" },
  },
  {
    name: "squire",
    description:
      "Teen squire practicing with a bronze arming sword, kettle helm and a plain heater shield (the sword adds 128px slash animation blocks).",
    bodyType: "teen",
    selections: {
      head: "heads_human_male",
      hair: "hair_curtains",
      expression: "face_happy",
      hat: "hat_helmet_kettle",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: { itemId: "weapon_sword_arming", variant: "bronze" },
      shield: "shield_heater_revised_wood",
    },
    colors: { body: "light", hair: "redhead", eyes: "brown", hat: "steel", clothes: "sky", legs: "charcoal", shoes: "brown", shield: "oak" },
  },
  {
    name: "catfolk",
    description:
      "Catfolk scout: black cat ears and tail, forest longsleeve and a slingshot (bows ship no walk art).",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_bob",
      expression: "face_neutral",
      ears: "head_ears_zabos",
      tail: { itemId: "tail_cat", variant: "black" },
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: "weapon_ranged_slingshot",
    },
    colors: { body: "light", hair: "black", eyes: "green", ears: "black", clothes: "forest", legs: "leather", shoes: "brown" },
  },
  {
    name: "celestial",
    description:
      "Winged celestial: white feathered wings, silver tiara and necklace, and an all-white gown.",
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: "hair_xlong",
      expression: "face_blush",
      hat: { itemId: "hat_formal_tiara", variant: "tiara_silver" },
      wings: { itemId: "wings_feathered", variant: "white" },
      clothes: "torso_clothes_longsleeve",
      legs: "legs_skirt_belle",
      shoes: "feet_slippers",
      necklace: { itemId: "neck_necklace", variant: "silver" },
    },
    colors: { body: "light", hair: "platinum", eyes: "blue", clothes: "white", legs: "white", shoes: "white" },
  },
  {
    name: "expectant",
    description:
      "Expecting villager (pregnant body type): lavender tank top and maternity pants (palette-recolor shirts ship no pregnant art, so this preset uses the tank top).",
    bodyType: "pregnant",
    selections: {
      head: "heads_human_female",
      hair: "hair_bangs_bun",
      expression: "face_happy",
      clothes: { itemId: "torso_clothes_sleeveless_tanktop", variant: "lavender" },
      legs: { itemId: "legs_pregnantpants", variant: "blue" },
      shoes: "feet_boots_basic",
    },
    colors: { body: "amber", hair: "chestnut", eyes: "brown", shoes: "brown" },
  },
  {
    name: "angler",
    description:
      "Angler in shorts and a leather cap; the fishing rod adds a dedicated fishing animation block.",
    bodyType: "male",
    selections: {
      head: "heads_human_male",
      hair: "hair_swoop",
      expression: "face_neutral",
      hat: { itemId: "hat_cap_leather", variant: "brown" },
      clothes: "torso_clothes_shortsleeve",
      legs: "legs_shorts",
      shoes: "feet_boots_basic",
      weapon: "tool_rod",
    },
    colors: { body: "taupe", hair: "brown", eyes: "gray", clothes: "tan", legs: "leather", shoes: "brown" },
  },
  {
    name: "barbarian",
    description:
      "Muscular barbarian: bare chest (the pack has no muscular torso clothes), leather legion kilt, barbarian helm and a waraxe.",
    bodyType: "muscular",
    selections: {
      head: "heads_human_male",
      hair: "hair_long_messy",
      expression: "face_angry",
      hat: "hat_helmet_barbarian",
      legs: "legs_skirts_legion",
      shoes: "feet_boots_basic",
      weapon: "weapon_blunt_waraxe",
    },
    colors: { body: "bronze", hair: "black", eyes: "brown", hat: "iron", legs: "leather", shoes: "brown" },
  },
];

const byLowerName = new Map(PRESETS.map((preset) => [preset.name.toLowerCase(), preset]));

/**
 * All presets, list form. `groups` are the selection group names the preset
 * fills, in selection order.
 *
 * @returns {Array<{name: string, description: string, bodyType: string, groups: string[]}>}
 */
export function listPresets() {
  return PRESETS.map(({ name, description, bodyType, selections }) => ({
    name,
    description,
    bodyType,
    groups: Object.keys(selections),
  }));
}

/**
 * Full preset by name (case-insensitive), or null when no preset matches.
 * The returned object is a deep copy — mutating it never affects the library —
 * and is ready to feed straight into the generate_* tools:
 *
 *   const preset = getPreset("Knight");
 *   generate_spritesheet({ bodyType: preset.bodyType,
 *                          selections: preset.selections,
 *                          colors: preset.colors });
 *
 * @param {string} name
 * @returns {{name: string, description: string, bodyType: string,
 *            selections: Record<string, string | PresetItem>,
 *            colors: Record<string, string>} | null}
 */
export function getPreset(name) {
  if (typeof name !== "string") return null;
  const preset = byLowerName.get(name.trim().toLowerCase());
  return preset ? structuredClone(preset) : null;
}

/** Preset names, in library order. @returns {string[]} */
export function presetNames() {
  return PRESETS.map((preset) => preset.name);
}
