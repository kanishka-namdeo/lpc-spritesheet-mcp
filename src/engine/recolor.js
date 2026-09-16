// Palette resolution + CPU recolor — ports of
// lpc-generator-src/sources/state/palettes.ts and
// lpc-generator-src/sources/canvas/palette-recolor.ts (CPU path only).
import { createCanvas } from "@napi-rs/canvas";

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function buildColorMap(sourcePalette, targetPalette) {
  const colorPairs = [];
  for (let i = 0; i < sourcePalette.length; i++) {
    const sourceRgb = hexToRgb(sourcePalette[i]);
    const targetRgb = hexToRgb(targetPalette[i]);
    if (sourceRgb && targetRgb) colorPairs.push({ source: sourceRgb, target: targetRgb });
  }
  return colorPairs;
}

function findMatchingColor(r, g, b, colorPairs, tolerance = 1) {
  for (const pair of colorPairs) {
    if (
      Math.abs(r - pair.source.r) <= tolerance &&
      Math.abs(g - pair.source.g) <= tolerance &&
      Math.abs(b - pair.source.b) <= tolerance
    ) {
      return pair.target;
    }
  }
  return null;
}

/**
 * Recolor an image via one or more {source: hex[], target: hex[]} palette
 * mappings in a single pass. Returns a new canvas (never mutates the source).
 */
export function recolorImageCPU(sourceImage, paletteMappings) {
  const canvas = createCanvas(sourceImage.width, sourceImage.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceImage, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  const colorPairs = [];
  for (const { source, target } of paletteMappings) {
    for (const p of buildColorMap(source, target)) colorPairs.push(p);
  }

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const newColor = findMatchingColor(pixels[i], pixels[i + 1], pixels[i + 2], colorPairs);
    if (newColor) {
      pixels[i] = newColor.r;
      pixels[i + 1] = newColor.g;
      pixels[i + 2] = newColor.b;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Palette resolution (ports of palettes.ts; catalog takes the CatalogReader role)
// ---------------------------------------------------------------------------

export function parseRecolorKey(catalog, recolorKey, palette) {
  if (!recolorKey) recolorKey = palette?.base ?? "";
  const [recolor, parsedVersion, parsedMaterial] = recolorKey.split(".").reverse();
  let version = parsedVersion;
  let material = parsedMaterial;

  if (!material) {
    if (version && catalog.paletteMetadata.materials?.[version]) {
      material = version;
      version = undefined;
    } else {
      material = palette?.material;
    }
  }
  if (!version) version = palette?.default;
  return [material, version, recolor];
}

export function getBasePalette(catalog, material, base = null, source = null) {
  const materialMeta = catalog.paletteMetadata.materials?.[material];
  if (!materialMeta) throw new Error(`Palettes for ${material} not found`);

  if (source !== null) {
    return [materialMeta.default, base ?? materialMeta.base, source];
  }
  const [version, recolor] = base ? base.split(".") : [materialMeta.default, materialMeta.base];
  const colors = materialMeta.palettes[version]?.[recolor];
  return [version, recolor, colors];
}

export function getTargetPalette(catalog, material, targetColor) {
  let materialMeta = catalog.paletteMetadata.materials?.[material];
  if (!materialMeta) throw new Error(`Palettes for ${material} not found`);

  const [newMat, version, recolor] = parseRecolorKey(catalog, targetColor, materialMeta);
  if (newMat) {
    const newMaterialMeta = catalog.paletteMetadata.materials?.[newMat];
    if (newMaterialMeta) {
      material = newMat;
      materialMeta = newMaterialMeta;
    }
  }
  const colors = version !== undefined ? materialMeta.palettes[version]?.[recolor] : null;
  if (!colors) throw new Error(`Palette colors for ${material}.${version}.${recolor} not found`);
  return colors;
}

export function getPalettesFromMeta(catalog, meta) {
  if (!meta || !meta.recolors) return null;
  const sources = {};
  for (const palette of meta.recolors) {
    const [version, source, colors] = getBasePalette(
      catalog,
      palette.material,
      palette.base ?? null,
      palette.source ?? null,
    );
    sources[palette.type_name ?? meta.typeName] = {
      material: palette.material,
      version: version || (palette.default ?? ""),
      source,
      colors,
    };
  }
  return sources;
}

/** Port of fixMissingRecolor. */
export function fixMissingRecolor(catalog, itemId, recolor, typeName = null) {
  const meta = catalog.getItem(itemId);
  if (!meta) throw new Error(`Item not found: ${itemId}`);

  const palette = meta.recolors.find((r) => r.type_name === typeName);
  if (!palette) return null;

  if (palette.variants?.includes(recolor)) return recolor;

  const materialMeta = catalog.paletteMetadata.materials?.[palette.material];
  const [, , parsedRecolor] = parseRecolorKey(catalog, recolor, materialMeta);

  for (const variant of palette.variants ?? []) {
    const parts = variant.split(".");
    if (parts.length > 1 && parts.includes(parsedRecolor ?? recolor)) return variant;
    if (parsedRecolor === variant) return variant;
  }
  return null;
}

/** Port of getBodyColor: find a match-body-color selection's recolor. */
export function getBodyColor(catalog, itemId, selections) {
  const meta = catalog.getItem(itemId);
  if (!meta || !meta.matchBodyColor) return null;
  for (const selection of Object.values(selections)) {
    const subMeta = catalog.getItem(selection.itemId);
    if (subMeta && subMeta.matchBodyColor && selection.recolor) {
      return selection.recolor;
    }
  }
  return null;
}

/**
 * Port of getMultiRecolors: build the recolor map for an item across current
 * selections — keyed by type_name, valued by recolor variant. null when none.
 */
export function getMultiRecolors(catalog, itemId, selections, matchBodyColorEnabled = true) {
  const meta = catalog.getItem(itemId);
  if (!meta) return null;
  const types = [meta.typeName];
  for (const recolor of meta.recolors) {
    if (recolor.type_name && !types.includes(recolor.type_name)) types.push(recolor.type_name);
  }

  const recolors = {};
  for (const selection of Object.values(selections)) {
    const subMeta = catalog.getItem(selection.itemId);
    const typeName =
      (selection.subId !== null && selection.subId !== undefined
        ? subMeta?.recolors?.[selection.subId]?.type_name
        : undefined) ??
      subMeta?.typeName ??
      meta.typeName;
    if (!subMeta || !subMeta.typeName || !types.includes(typeName) || !subMeta.recolors.length)
      continue;

    const verifiedRecolor = fixMissingRecolor(
      catalog,
      itemId,
      selection.recolor ?? "",
      !selection.subId ? null : typeName,
    );
    if (verifiedRecolor) {
      if (selection.subId) {
        recolors[typeName] = verifiedRecolor;
      } else if (selection.recolor) {
        recolors[subMeta.typeName] = verifiedRecolor;
      }
    }
  }

  if (meta.matchBodyColor && matchBodyColorEnabled) {
    const bodyColor = getBodyColor(catalog, itemId, selections);
    if (bodyColor) recolors[meta.typeName] = bodyColor;
  }

  return Object.keys(recolors).length > 0 ? recolors : null;
}

/** Build {source, target} palette mappings for an item from its resolved recolors. */
export function collectPaletteMappings(catalog, targetColors, sourcePalettes) {
  const mappings = [];
  for (const [typeName, palette] of Object.entries(sourcePalettes)) {
    const targetColor = targetColors[typeName];
    if (!targetColor || targetColor === "source") continue;
    const targetPalette = getTargetPalette(catalog, palette.material, targetColor);
    mappings.push({ source: palette.colors, target: targetPalette });
  }
  return mappings;
}

/**
 * Port of getImageToDraw: returns the (possibly recolored) image to draw.
 * Results memoized by spritePath+recolors.
 */
export function createRecolorCache() {
  const cache = new Map();

  return async function getImageToDraw(catalog, img, itemId, recolors, spritePath = null) {
    if (!recolors) return img;
    const meta = catalog.getItem(itemId);
    const paletteConfig = meta ? getPalettesFromMeta(catalog, meta) : null;
    if (!paletteConfig) return img;

    const cacheKey = spritePath ? `${spritePath}|${JSON.stringify(recolors)}` : null;
    if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

    let result;
    try {
      const mappings = collectPaletteMappings(catalog, recolors, paletteConfig);
      result = mappings.length > 0 ? recolorImageCPU(img, mappings) : img;
    } catch (e) {
      console.error(`Failed to recolor ${itemId} ${JSON.stringify(recolors)}:`, e.message);
      return img; // fallback to original on error
    }
    if (cacheKey) cache.set(cacheKey, result);
    if (cache.size > 400) cache.clear(); // simple cap for long-lived sessions
    return result;
  };
}
