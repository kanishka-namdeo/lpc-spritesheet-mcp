// Locates the external Universal LPC asset pack. The server and the dev tooling
// (test/, scripts/) share this one implementation so the documented discovery
// order can never diverge between them.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A valid pack is a directory holding both sheet_definitions/ and spritesheets/. */
export function hasAssets(dir) {
  return (
    fs.existsSync(path.join(dir, "sheet_definitions")) &&
    fs.existsSync(path.join(dir, "spritesheets"))
  );
}

/**
 * Candidate pack locations, in discovery order:
 * 1. $LPC_ASSETS_DIR
 * 2. sibling of this package (`<workspace>/lpc-generator-src`, the dev-checkout convention)
 * 3. `~/.lpc-spritesheet/lpc-generator-src` (where `npm run setup-assets` clones)
 */
export function assetCandidates() {
  const candidates = [];
  if (process.env.LPC_ASSETS_DIR) candidates.push(path.resolve(process.env.LPC_ASSETS_DIR));
  candidates.push(path.resolve(import.meta.dirname, "..", "..", "lpc-generator-src"));
  candidates.push(path.join(os.homedir(), ".lpc-spritesheet", "lpc-generator-src"));
  return candidates;
}

export function findAssetsDir() {
  return assetCandidates().find(hasAssets) ?? null;
}

const revisionByDir = new Map();

/**
 * Commit the pack clone is checked out at, or null when it is not a git checkout.
 * Attribution and reproducibility both hinge on knowing which asset revision produced a
 * render, and `npm run setup-assets` clones unpinned, so results report what was actually read.
 * Never throws: a hand-copied pack directory is a supported install.
 */
export function packRevision(assetsDir) {
  if (revisionByDir.has(assetsDir)) return revisionByDir.get(assetsDir);
  let revision = null;
  try {
    const res = spawnSync("git", ["-C", assetsDir, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (res.status === 0 && /^[0-9a-f]{40}$/.test(res.stdout.trim())) revision = res.stdout.trim();
  } catch {
    revision = null;
  }
  revisionByDir.set(assetsDir, revision);
  return revision;
}
