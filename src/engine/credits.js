// Credits collection — port of lpc-generator-src/sources/utils/credits.ts.
// Only includes credits for files actually used at the current body type.

function variantToFilename(variant) {
  return String(variant).replaceAll(" ", "_");
}

function replaceInPathSimple(catalog, pathStr, selections, meta) {
  if (!pathStr.includes("${")) return pathStr;
  const replacements = {};
  for (const [typeName, map] of Object.entries(meta.replaceInPath)) {
    const selection = selections[typeName];
    if (!selection) continue;
    const item = catalog.getItem(selection.itemId);
    if (!item) continue;
    replacements[typeName] = map?.[item.name.replaceAll(" ", "_")];
  }
  return pathStr.replace(/\${(.*?)}/g, (_, g) => replacements[g] ?? `\${${g}}`);
}

/**
 * @returns {Array<{fileName, file, notes, authors, licenses, urls}>}
 */
export function getAllCredits(catalog, selections, bodyType, selectedAnimation) {
  const allCredits = [];
  const seenFiles = new Set();

  for (const selection of Object.values(selections)) {
    const meta = catalog.getItem(selection.itemId);
    if (!meta || meta.credits.length === 0) continue;

    const usedPaths = new Set();
    for (let layerNum = 1; layerNum < 10; layerNum++) {
      const layer = meta.layers?.[`layer_${layerNum}`];
      if (!layer) break;
      let basePath = layer[bodyType];
      if (!basePath) continue;
      basePath = replaceInPathSimple(catalog, basePath, selections, meta);

      const animation =
        selectedAnimation ??
        (meta.animations.includes("walk") ? "walk" : meta.animations[0]);

      let fullPath = `${basePath}${animation}.png`;
      if (selection.variant) {
        fullPath = `${basePath}${animation}/${variantToFilename(selection.variant)}.png`;
      }
      usedPaths.add(fullPath);
    }

    for (const credit of meta.credits) {
      if (seenFiles.has(credit.file)) continue;
      let isUsed = false;
      let lastUsedPath = null;
      for (const usedPath of usedPaths) {
        if (usedPath === credit.file || usedPath.startsWith(credit.file + "/")) {
          isUsed = true;
          lastUsedPath = usedPath;
          break;
        }
      }
      if (isUsed && lastUsedPath !== null && !seenFiles.has(lastUsedPath)) {
        allCredits.push({ fileName: lastUsedPath, ...credit });
        seenFiles.add(lastUsedPath);
      }
    }
  }
  return allCredits;
}

export function creditsToCsv(allCredits) {
  const header = "filename,notes,authors,licenses,urls";
  let csvBody = header + "\n";
  allCredits.forEach((credit) => {
    const authors = credit.authors.join(", ");
    const licenses = credit.licenses.join(", ");
    const urls = credit.urls.join(", ");
    const notes = credit.notes || "";
    csvBody += `"${credit.fileName}","${notes}","${authors}","${licenses}","${urls}"\n`;
  });
  return csvBody;
}

export function creditsToTxt(allCredits) {
  let txt = "";
  allCredits.forEach((credit) => {
    txt += `${credit.fileName}\n`;
    if (credit.notes) txt += `\t- Note: ${credit.notes}\n`;
    txt += `\t- Licenses:\n\t\t- ${credit.licenses.join("\n\t\t- ")}\n`;
    txt += `\t- Authors:\n\t\t- ${credit.authors.join("\n\t\t- ")}\n`;
    txt += `\t- Links:\n\t\t- ${credit.urls.join("\n\t\t- ")}\n\n`;
  });
  return txt;
}
