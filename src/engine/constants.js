// Layout constants ported verbatim from
// lpc-generator-src/sources/state/constants.ts (Universal-LPC-Spritesheet-Character-Generator)

export const FRAME_SIZE = 64; // Size of each frame in the spritesheet

/** Frames per row on the standard universal LPC animation sheet (13 × FRAME_SIZE wide per row). */
export const STANDARD_ANIMATION_FRAMES_PER_ROW = 13;

// Body types supported by sheet metadata and UI selectors
export const BODY_TYPES = ["male", "female", "teen", "child", "muscular", "pregnant"];

// LPC sheet row order: matches ANIMATION_CONFIGS rows
export const DIRECTIONS = ["up", "left", "down", "right"];

// Standard sheet is 13 columns × 54 rows of 64px frames
export const SHEET_WIDTH = STANDARD_ANIMATION_FRAMES_PER_ROW * FRAME_SIZE; // 832
export const SHEET_HEIGHT = 54 * FRAME_SIZE; // 3456

// Animation list — `folderName` remaps where the on-disk folder differs from the
// canonical row name; `noExport` marks row names that are served by another row.
export const ANIMATIONS = [
  { value: "spellcast", label: "Spellcast" },
  { value: "thrust", label: "Thrust" },
  { value: "walk", label: "Walk" },
  { value: "slash", label: "Slash" },
  { value: "shoot", label: "Shoot" },
  { value: "hurt", label: "Hurt" },
  { value: "climb", label: "Climb" },
  { value: "idle", label: "Idle" },
  { value: "jump", label: "Jump" },
  { value: "sit", label: "Sit" },
  { value: "emote", label: "Emote" },
  { value: "run", label: "Run" },
  { value: "watering", label: "Watering", noExport: true },
  { value: "combat", label: "Combat Idle", folderName: "combat_idle" },
  { value: "1h_slash", label: "1-Handed Slash", folderName: "backslash", noExport: true },
  { value: "1h_backslash", label: "1-Handed Backslash", folderName: "backslash" },
  { value: "1h_halfslash", label: "1-Handed Halfslash", folderName: "halfslash" },
];

// Default animations used when a sheet definition omits an explicit animations list
export const ANIMATION_DEFAULTS = [
  "spellcast",
  "thrust",
  "walk",
  "slash",
  "shoot",
  "hurt",
  "watering",
];

// y-pixel offset of each animation row block on the standard sheet
export const ANIMATION_OFFSETS = {
  spellcast: 0,
  thrust: 4 * FRAME_SIZE,
  walk: 8 * FRAME_SIZE,
  slash: 12 * FRAME_SIZE,
  shoot: 16 * FRAME_SIZE,
  hurt: 20 * FRAME_SIZE,
  climb: 21 * FRAME_SIZE,
  idle: 22 * FRAME_SIZE,
  jump: 26 * FRAME_SIZE,
  sit: 30 * FRAME_SIZE,
  emote: 34 * FRAME_SIZE,
  run: 38 * FRAME_SIZE,
  combat_idle: 42 * FRAME_SIZE,
  backslash: 46 * FRAME_SIZE,
  halfslash: 50 * FRAME_SIZE,
};

// Row block (starting row + number of direction rows) and the playback frame cycle
export const ANIMATION_CONFIGS = {
  spellcast: { row: 0, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6] },
  thrust: { row: 4, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7] },
  walk: { row: 8, num: 4, cycle: [1, 2, 3, 4, 5, 6, 7, 8] },
  slash: { row: 12, num: 4, cycle: [0, 1, 2, 3, 4, 5] },
  shoot: { row: 16, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  hurt: { row: 20, num: 1, cycle: [0, 1, 2, 3, 4, 5] },
  climb: { row: 21, num: 1, cycle: [0, 1, 2, 3, 4, 5] },
  idle: { row: 22, num: 4, cycle: [0, 0, 1] },
  jump: { row: 26, num: 4, cycle: [0, 1, 2, 3, 4, 1] },
  sit: { row: 30, num: 4, cycle: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2] },
  emote: { row: 34, num: 4, cycle: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2] },
  run: { row: 38, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7] },
  watering: { row: 4, num: 4, cycle: [0, 1, 4, 4, 4, 4, 5] },
  combat: { row: 42, num: 4, cycle: [0, 0, 1] },
  "1h_slash": { row: 46, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6] },
  "1h_backslash": { row: 46, num: 4, cycle: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] },
  "1h_halfslash": { row: 50, num: 4, cycle: [0, 1, 2, 3, 4, 5] },
};

// Frames actually present per direction row for each canonical row block
// (verified against the shipped PNG strip widths).
export const ANIMATION_FRAME_COUNTS = {
  spellcast: 7,
  thrust: 8,
  walk: 9,
  slash: 6,
  shoot: 13,
  hurt: 6,
  climb: 6,
  idle: 2,
  jump: 5,
  sit: 3,
  emote: 3,
  run: 8,
  combat_idle: 2,
  backslash: 13,
  halfslash: 6,
};

// Canonical row-block name for each animation key (aliases included).
export function resolveAnimationName(name) {
  return name === "combat_idle" ? "combat" : name;
}

// Which direction each single-row block faces (hurt ships only the down-facing
// row, climb only the up-facing row).
export const SINGLE_ROW_DIRECTION = {
  hurt: "down",
  climb: "up",
};
