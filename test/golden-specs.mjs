// The canonical character specs behind test/golden.json and the determinism gate.
//
// Shared by scripts/make-golden.mjs (which writes the manifest) and test/golden-test.mjs (which
// re-renders and compares), because a gate whose inputs differ from the generator's proves nothing.
// Item names are the friendly ones the resolver accepts, so a pack that renames an item fails here
// loudly rather than silently re-baselining.

export const GOLDEN_SPECS = [
  {
    name: "default-male",
    bodyType: "male",
    selections: {},
    colors: {},
    proves: "the bare defaults: 832x3456, no warnings",
  },
  {
    name: "styled-female",
    bodyType: "female",
    selections: {
      hair: "Bangs",
      clothes: "Longsleeve",
      legs: "Pants",
      shoes: "Basic Boots",
      weapon: "Rapier",
      head: "Human Female",
    },
    colors: { body: "amber", hair: "red", clothes: "maroon", legs: "navy", eyes: "green" },
    proves: "multi-group recolor including the eyes sub-selection",
  },
  {
    name: "katana-male",
    bodyType: "male",
    selections: { hair: "hair_bangs", clothes: "Longsleeve", weapon: "Katana" },
    colors: { body: "bronze", hair: "black", clothes: "teal" },
    proves: "128px custom blocks widening the canvas to 1152",
  },
  {
    name: "dragonspear",
    bodyType: "male",
    selections: { weapon: "weapon_polearm_dragonspear" },
    colors: {},
    proves: "two stacked oversize custom blocks (walk_128 + thrust_oversize)",
  },
  {
    name: "wheelchair",
    bodyType: "male",
    selections: { wheelchair: "Wheelchair" },
    colors: {},
    proves: "a 64px custom block appended below row 54",
  },
  {
    name: "child-default",
    bodyType: "child",
    selections: {},
    colors: {},
    proves: "the aggregated missing-row warnings for a body the pack under-supports",
  },
  {
    name: "universal-skintone",
    bodyType: "male",
    selections: {},
    colors: { body: "lpcr.ivory" },
    proves: "a version-prefixed palette name resolving through the recolor path",
  },
];
