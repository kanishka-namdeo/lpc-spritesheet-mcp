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

const REPO = "https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git";

const hasAssets = (dir) =>
  fs.existsSync(path.join(dir, "sheet_definitions")) && fs.existsSync(path.join(dir, "spritesheets"));

let target;
if (process.env.LPC_ASSETS_DIR) {
  target = path.resolve(process.env.LPC_ASSETS_DIR);
  if (hasAssets(target)) {
    console.log(`Assets already present at ${target} — nothing to do.`);
    process.exit(0);
  }
} else {
  const sibling = path.resolve(import.meta.dirname, "..", "..", "lpc-generator-src");
  if (hasAssets(sibling)) {
    console.log(`Assets already present at ${sibling} — nothing to do.`);
    process.exit(0);
  }
  target = path.join(os.homedir(), ".lpc-spritesheet", "lpc-generator-src");
  if (hasAssets(target)) {
    console.log(`Assets already present at ${target} — nothing to do.`);
    process.exit(0);
  }
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
console.log(`\nDone. The server will find the assets automatically; restart your MCP client if it is already running.`);
