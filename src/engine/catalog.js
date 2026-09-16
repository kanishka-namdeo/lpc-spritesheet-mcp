// Catalog loader — ports scripts/generateSources/{items,item-helper,palettes}.ts
// from Universal-LPC-Spritesheet-Character-Generator to read sheet_definitions/
// and palette_definitions/ JSON directly at runtime (no build step).
import fs from "node:fs";
import path from "node:path";
import { ANIMATION_DEFAULTS, BODY_TYPES } from "./constants.js";

export class Catalog {
  /**
   * @param {string} assetsDir root of the Universal-LPC-Spritesheet-Character-Generator clone
   */
  constructor(assetsDir) {
    this.assetsDir = assetsDir;
    this.sheetsDir = path.join(assetsDir, "sheet_definitions");
    this.palettesDir = path.join(assetsDir, "palette_definitions");
    this.spritesDir = path.join(assetsDir, "spritesheets");

    this.itemsById = new Map(); // itemId -> item meta
    this.byTypeName = new Map(); // type_name -> itemId[]
    /** @type {{ materials: Record<string, any>, versions: Record<string, any> }} */
    this.paletteMetadata = { materials: {}, versions: {} };

    this.#loadPalettes();
    this.#loadItems();
  }

  #loadPalettes() {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".json")) {
          this.#parsePalette(full, entry.name);
        }
      }
    };
    walk(this.palettesDir);
  }

  #parsePalette(fullPath, fileName) {
    const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const materials = this.paletteMetadata.materials;
    if (fileName.startsWith("meta_")) {
      const name = fileName.replace("meta_", "").replace(".json", "");
      if (json.type === "material") {
        if (!materials[name]) {
          materials[name] = { ...json, palettes: {} };
        } else {
          Object.assign(materials[name], json);
        }
      } else {
        this.paletteMetadata.versions[name] = json;
      }
      return;
    }
    const [material, version] = fileName.replace(".json", "").split("_");
    if (!materials[material]) materials[material] = { palettes: {} };
    if (!materials[material].palettes) materials[material].palettes = {};
    materials[material].palettes[version] = json;
  }

  #loadItems() {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".json") && !entry.name.startsWith("meta_")) {
          this.#parseItem(full, entry.name);
        }
      }
    };
    walk(this.sheetsDir);
  }

  #parseItem(fullPath, fileName) {
    const itemId = fileName.replace(".json", "");
    const def = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    if (def.ignore) return;

    const layers = {};
    for (let i = 1; i < 10; i++) {
      const layerDef = def[`layer_${i}`];
      if (layerDef) layers[`layer_${i}`] = layerDef;
      else break;
    }

    const required = [];
    const layer1 = def.layer_1 || {};
    for (const bodyType of BODY_TYPES) {
      if (layer1[bodyType]) required.push(bodyType);
    }

    const recolors = this.#normalizeRecolors(def);

    const item = {
      itemId,
      name: def.name ?? itemId,
      priority: def.priority || null,
      typeName: def.type_name ?? null,
      required,
      animations: def.animations ?? ANIMATION_DEFAULTS,
      variants: def.variants ?? [],
      matchBodyColor: Boolean(def.match_body_color),
      replaceInPath: def.replace_in_path ?? {},
      credits: def.credits ?? [],
      layers,
      recolors,
      treePath: path.relative(this.sheetsDir, path.dirname(fullPath)).split(path.sep),
    };
    this.itemsById.set(itemId, item);
    if (item.typeName) {
      if (!this.byTypeName.has(item.typeName)) this.byTypeName.set(item.typeName, []);
      this.byTypeName.get(item.typeName).push(itemId);
    }
  }

  /** Port of normalizeRecolors / expandRecolorPalettes (scripts/generateSources/item-helper.ts). */
  #normalizeRecolors(def) {
    const recolors = [];
    if (def.recolors === undefined) return recolors;
    for (let n = 1; n < 10; n++) {
      const colorDef = def.recolors[`color_${n}`];
      if (colorDef) recolors.push(colorDef);
      else break;
    }
    if (recolors.length === 0) recolors.push(def.recolors);

    const out = [];
    for (const recolor of recolors) {
      const materialMeta = this.paletteMetadata.materials[recolor.material];
      if (!materialMeta) {
        console.warn(`Material metadata not found for ${recolor.material}`);
        out.push(recolor);
        continue;
      }
      const normalized = { ...recolor };
      normalized.default = materialMeta.default;
      normalized.type_name = normalized.type_name ?? null;
      normalized.label =
        normalized.label ?? materialMeta.label ?? ucwords(normalized.material);
      if (!normalized.base) {
        normalized.base = `${materialMeta.default}.${materialMeta.base}`;
      } else if (!normalized.base.includes(".")) {
        normalized.base = `${materialMeta.default}.${normalized.base}`;
      }
      // expand palettes token list into a map "<material>.<version>" -> color names
      const colorPalettes = {};
      const colorVariants = new Set();
      for (const token of normalized.palettes) {
        let [material, version] = token.split(".");
        if (!version) {
          version = material;
          material = normalized.material;
        }
        const keys = Object.keys(this.paletteMetadata.materials[material].palettes[version]);
        colorPalettes[`${material}.${version}`] = keys;
        for (const key of keys) {
          const matPart = normalized.material !== material ? `${material}.` : "";
          const verPart = normalized.default !== version ? `${version}.` : "";
          colorVariants.add(`${matPart}${verPart}${key}`);
        }
      }
      normalized.palettes = colorPalettes;
      normalized.variants = Array.from(colorVariants);
      out.push(normalized);
    }
    return out;
  }

  getItem(itemId) {
    return this.itemsById.get(itemId) ?? null;
  }

  /** Items of a selection group, optionally filtered to a body type. */
  getItemsByType(typeName, bodyType = null) {
    const ids = this.byTypeName.get(typeName) ?? [];
    const items = ids.map((id) => this.itemsById.get(id));
    if (!bodyType) return items;
    return items.filter((i) => i.required.includes(bodyType));
  }

  listTypeNames() {
    return Array.from(this.byTypeName.keys());
  }

  /** Resolve an asset-relative path (e.g. "spritesheets/.../walk.png") on disk. */
  resolveSprite(relPath) {
    const full = path.join(this.assetsDir, relPath);
    return fs.existsSync(full) ? full : null;
  }
}

function ucwords(str) {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
