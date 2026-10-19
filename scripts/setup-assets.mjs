#!/usr/bin/env node
// One-time setup: clone the Universal-LPC-Spritesheet-Character-Generator
// asset pack (~350 MB) into the location this server looks for by default.
//
// Target resolution order:
//   1. $LPC_ASSETS_DIR (if set and not yet populated)
//   2. already-present sibling checkout (../lpc-generator-src) — nothing to do
//   3. ~/.lpc-spritesheet/lpc-generator-src
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetCandidates, hasAssets, packRevision } from "../src/assets-dir.js";

const REPO = "https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git";

let target;
if (process.env.LPC_ASSETS_DIR) {
  target = path.resolve(process.env.LPC_ASSETS_DIR);
  if (hasAssets(target)) {
    console.log(`Assets already present at ${target} — nothing to do.`);
    console.log(`Pack revision: ${packRevision(target) ?? "not a git checkout"}`);
    process.exit(0);
  }
} else {
  const present = assetCandidates().find(hasAssets);
  if (present) {
    console.log(`Assets already present at ${present} — nothing to do.`);
    console.log(`Pack revision: ${packRevision(present) ?? "not a git checkout"}`);
    process.exit(0);
  }
  target = path.join(os.homedir(), ".lpc-spritesheet", "lpc-generator-src");
}

try {
  execSync("git --version", { stdio: "ignore" });
} catch {
  console.error("ERROR: git is required to clone the asset pack (https://git-scm.com).");
  process.exit(1);
}

console.log(`Cloning the LPC asset pack into ${target} ...`);
console.log("(shallow clone, ~350 MB — this can take a few minutes)");
fs.mkdirSync(path.dirname(target), { recursive: true });
execSync(`git clone --depth 1 "${REPO}" "${target}"`, { stdio: "inherit" });

// test/golden.json hashes renders made from one pack revision, so a reproducible install can pin it.
const ref = process.env.LPC_ASSETS_REF;
if (ref) {
  console.log(`Checking out pinned revision ${ref} ...`);
  execSync(`git -C "${target}" fetch --depth 1 origin "${ref}"`, { stdio: "inherit" });
  execSync(`git -C "${target}" checkout --detach FETCH_HEAD`, { stdio: "inherit" });
}

console.log(`\nPack revision now installed: ${packRevision(target) ?? "not a git checkout"}`);
console.log("Done. The server will find the assets automatically; restart your MCP client if it is already running.");
