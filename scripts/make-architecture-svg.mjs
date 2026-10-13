#!/usr/bin/env node
// Generates docs/img/architecture.svg — the system diagram used by README.md (and by
// npm, where mermaid would otherwise show up as raw source).
//
// Zero dependencies. Needs no asset pack, no network, no fonts read from disk, no
// absolute paths and no timestamps, so it behaves identically on Linux and Windows
// and emits byte-identical SVG for identical tables below.
//
//   npm run diagrams      ->  node scripts/make-architecture-svg.mjs
//
// The layout is hand-placed in explicit coordinates, then *asserted* by this script:
// canvas bounds, per-line text width, text inside its box, box overlap, edge
// endpoints on box borders, label collisions and edge crossings (at most one, the
// documented fan-in into constants.js). Edit the tables and re-run; never hand-edit
// the SVG.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs", "img", "architecture.svg");

const CANVAS = { width: 1000, height: 716 };
const MARGIN = { left: 32, top: 24, right: 32, bottom: 24 };

// Neutral, dark-on-light palette. The panel paints its own opaque background, so the
// picture never relies on a page colour: GitHub shows README images on both themes
// and npm always shows them on a light one.
const C = {
  panel: "#eef1f5",
  panelStroke: "#b6c1cf",
  group: "#e2e8f0",
  groupStroke: "#95a3b6",
  engine: "#e4eee7",
  engineStroke: "#7fa190",
  box: "#ffffff",
  boxStroke: "#77869a",
  renderBox: "#dce9f7",
  renderStroke: "#33546f",
  boundary: "#f5efe2",
  boundaryStroke: "#93835f",
  text: "#161f2b",
  dim: "#46566b",
  arrow: "#4a5a70",
};

/** Average advance of a proportional sans, as a fraction of the font size. */
const WIDTH_FACTOR = 0.6;

// ---------------------------------------------------------------------------
// Boxes: id, x, y, w, h, kind, lines
// ---------------------------------------------------------------------------

const NODES = [
  // --- band 1: the protocol spine ---------------------------------------
  n("client", 32, 88, 190, 112, "box", [
    t("MCP client", 13, "bold"),
    t("any stdio host:", 8.8, "normal", C.dim),
    t("Zed · Claude Code", 8.8, "normal", C.dim),
    t("test/mcp-client-test", 8.8, "normal", C.dim),
    t("tools/call · tools/list", 8.8, "normal", C.dim),
  ]),
  n("index", 266, 76, 306, 156, "group", [
    t("src/index.js", 12.5, "bold"),
    t("server bootstrap · stdio JSON-RPC · 7 tools", 8.8, "normal", C.dim),
  ], { children: ["tools_discovery", "tools_render"] }),
  n("tools_discovery", 280, 114, 278, 48, "box", [
    t("discovery tools", 8.9, "bold"),
    t("list_categories · list_items", 8.6, "normal", C.dim),
    t("list_palettes · list_animations", 8.6, "normal", C.dim),
  ]),
  n("tools_render", 280, 170, 278, 48, "render", [
    t("render tools", 8.9, "bold"),
    t("generate_spritesheet", 8.6, "normal", C.dim),
    t("get_animation · get_preview", 8.6, "normal", C.dim),
  ]),
  n("character", 616, 80, 186, 122, "box", [
    t("src/character.js", 11.5, "bold"),
    t("renderAndSave", 8.9, "bold", C.dim),
    t("normalize · render", 8.8, "normal", C.dim),
    t("extract · save", 8.8, "normal", C.dim),
    t("resolveOutputPath", 8.8, "normal", C.dim),
    t("fs.writeFileSync", 8.8, "normal", C.dim),
  ]),
  n("legend", 846, 80, 122, 122, "plain", [
    t("Legend", 9.5, "bold"),
    t("solid = module", 8.2, "normal", C.dim),
    t("dashed = external", 8.2, "normal", C.dim),
    t("shaded = grouping", 8.2, "normal", C.dim),
    t("blue = render path", 8.2, "normal", C.dim),
    t("arrows = edges", 8.2, "normal", C.dim),
  ]),

  // --- band 2 left: discovery of the pack, then the pack itself ----------
  n("assetsdir", 32, 240, 190, 92, "box", [
    t("src/assets-dir.js", 10.5, "bold"),
    t("locates the pack:", 8.4, "normal", C.dim),
    t("1 LPC_ASSETS_DIR", 8.2, "normal", C.dim),
    t("2 sibling clone", 8.2, "normal", C.dim),
    t("3 home dir", 8.2, "normal", C.dim),
    t("first hit wins", 8.2, "normal", C.dim),
  ]),
  n("assetpack", 32, 372, 190, 92, "boundary", [
    t("external asset pack", 9.5, "bold"),
    t("(never vendored)", 8.6, "normal", C.dim),
    t("sheet_definitions/", 8.4, "normal", C.dim),
    t("palette_definitions/", 8.4, "normal", C.dim),
    t("spritesheets/", 8.4, "normal", C.dim),
    t("read-only input", 8.2, "normal", C.dim),
  ]),

  // --- band 2: the engine ------------------------------------------------
  n("engine", 256, 240, 712, 250, "engine", [
    t("src/engine/ — import edges run downward · no MCP shapes, no filesystem", 8.8, "bold"),
  ], {
    children: ["catalog", "selection", "sheet", "credits", "constants", "recolor", "custanim"],
  }),
  n("catalog", 270, 276, 158, 54, "box", [
    t("catalog.js", 11, "bold"),
    t("item + palette index", 8.6, "normal", C.dim),
  ]),
  n("selection", 444, 276, 158, 54, "box", [
    t("selection.js", 11, "bold"),
    t("input → selections map", 8.6, "normal", C.dim),
  ]),
  n("sheet", 618, 276, 158, 54, "box", [
    t("sheet.js", 11, "bold"),
    t("renderCharacter", 8.6, "normal", C.dim),
    t("crop · extract · layout", 8.6, "normal", C.dim),
  ]),
  n("credits", 792, 276, 158, 54, "box", [
    t("credits.js", 11, "bold"),
    t("attribution CSV + TXT", 8.6, "normal", C.dim),
    t("used by character.js", 8.4, "normal", C.dim),
  ]),
  n("constants", 270, 398, 158, 54, "box", [
    t("constants.js", 11, "bold"),
    t("geometry · row blocks", 8.6, "normal", C.dim),
    t("frame counts · aliases", 8.6, "normal", C.dim),
  ]),
  n("recolor", 444, 398, 158, 54, "box", [
    t("recolor.js", 11, "bold"),
    t("palette resolve", 8.6, "normal", C.dim),
    t("CPU index-paired tint", 8.6, "normal", C.dim),
  ]),
  n("custanim", 618, 398, 158, 54, "box", [
    t("custom-animations.js", 9.4, "bold"),
    t("64 / 128 / 192 px blocks", 8.6, "normal", C.dim),
  ]),

  // --- band 3: backend + products ---------------------------------------
  n("canvas", 270, 528, 158, 52, "box", [
    t("@napi-rs/canvas", 11, "bold"),
    t("the only pixel backend", 8.4, "normal", C.dim),
  ]),
  n("outpanel", 500, 512, 468, 84, "group", [
    t("written beside the output path (default <repo>/output/)", 8.6, "bold"),
  ], { children: ["out_png", "out_credits", "out_char"] }),
  n("out_png", 514, 540, 138, 48, "box", [
    t("<name>.png", 11, "bold"),
    t("the spritesheet", 8.4, "normal", C.dim),
  ]),
  n("out_credits", 664, 540, 146, 48, "box", [
    t("<name>-credits.csv", 9.2, "bold"),
    t("<name>-credits.txt", 9.2, "bold"),
    t("attribution on by default", 8.2, "normal", C.dim),
  ]),
  n("out_char", 822, 540, 134, 48, "box", [
    t("<name>-", 9.6, "bold"),
    t("character.json", 9.6, "bold"),
    t("opt-in", 8.4, "normal", C.dim),
  ]),

  // --- band 4: contract footnotes ---------------------------------------
  n("note_protocol", 32, 626, 300, 64, "plain", [
    t("Protocol", 9.5, "bold", C.text, "start"),
    t("stdout carries JSON-RPC only; humans read console.error.", 8.4, "normal", C.dim, "start"),
    t("A missing pack fails at startup: stderr block, exit 1.", 8.4, "normal", C.dim, "start"),
    t("Tool errors are payloads, never a rejected handler.", 8.4, "normal", C.dim, "start"),
  ]),
  n("note_licence", 344, 626, 310, 64, "plain", [
    t("Licensing", 9.5, "bold", C.text, "start"),
    t("Assets (OGA-BY, CC-BY, CC-BY-SA, GPL) stay in the external", 8.4, "normal", C.dim, "start"),
    t("clone; this code is GPL-3.0-only. Every render ships its", 8.4, "normal", C.dim, "start"),
    t("credits files: attribution is a product feature.", 8.4, "normal", C.dim, "start"),
  ]),
  n("note_layout", 666, 626, 302, 64, "plain", [
    t("Universal sheet layout", 9.5, "bold", C.text, "start"),
    t("13 columns × 54 rows of 64 px frames = 832 × 3456,", 8.4, "normal", C.dim, "start"),
    t("15 canonical row blocks behind 17 config keys.", 8.4, "normal", C.dim, "start"),
    t("Custom blocks append below row 54 and may widen it.", 8.4, "normal", C.dim, "start"),
  ]),
];

// ---------------------------------------------------------------------------
// Edges: real call and import edges
// ---------------------------------------------------------------------------

const EDGES = [
  e("client", "index", "r", "l", {
    fromOffset: -14, toOffset: -16, label: "JSON-RPC", lx: 244, ly: 122,
  }),
  e("index", "client", "l", "r", {
    fromOffset: 24, toOffset: 34, label: "result", lx: 244, ly: 196,
  }),
  e("index", "character", "r", "l", {}),
  e("index", "assetsdir", "l", "r", { fromOffset: 60, via: [{ x: 242, y: 214 }, { x: 242, y: 286 }] }),
  e("assetsdir", "assetpack", "b", "t", {}),
  e("assetpack", "engine", "r", "l", { tp: { x: 256, y: 418 } }),
  e("character", "engine", "b", "t", { fromOffset: 0, toOffset: 97 }),
  // engine import edges (catalog + selection + sheet fan in)
  e("catalog", "constants", "b", "t", { toOffset: -12 }),
  e("selection", "constants", "b", "t", { fromOffset: -8, toOffset: 4 }),
  e("selection", "recolor", "b", "t", { fromOffset: 14, toOffset: -12 }),
  e("sheet", "constants", "b", "t", { fromOffset: -52, toOffset: 20 }),
  e("sheet", "recolor", "b", "t", { fromOffset: -17, toOffset: 12 }),
  e("sheet", "custanim", "b", "t", {}),
  // render products
  e("engine", "canvas", "b", "t", {
    fromOffset: -263, label: "drawImage", lx: 402, ly: 508,
  }),
  e("canvas", "outpanel", "r", "l", {}),
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function n(id, x, y, w, h, kind, lines, opts = {}) {
  return {
    id,
    x,
    y,
    w,
    h,
    kind,
    lines,
    anchor: opts.anchor ?? "middle",
    children: opts.children ?? [],
    right: x + w,
    bottom: y + h,
    cx: x + w / 2,
    cy: y + h / 2,
  };
}

function t(text, size, weight = "normal", fill = C.text, anchor) {
  return { text, size, weight, fill, anchor };
}

function e(from, to, fromSide, toSide, opts = {}) {
  return {
    from,
    to,
    fromSide,
    toSide,
    fromOffset: opts.fromOffset ?? 0,
    toOffset: opts.toOffset ?? 0,
    via: opts.via ?? [],
    tp: opts.tp ?? null,
    label: opts.label ?? null,
    lx: opts.lx ?? null,
    ly: opts.ly ?? null,
  };
}

const byId = new Map(NODES.map((node) => [node.id, node]));
const parentOf = new Map();
for (const node of NODES) for (const child of node.children) parentOf.set(child, node.id);

function anchor(node, side, offset) {
  switch (side) {
    case "l":
      return { x: node.x, y: node.cy + offset };
    case "r":
      return { x: node.right, y: node.cy + offset };
    case "t":
      return { x: node.cx + offset, y: node.y };
    case "b":
      return { x: node.cx + offset, y: node.bottom };
    default:
      throw new Error(`unknown side: ${side}`);
  }
}

function edgePoints(edge) {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  const start = anchor(from, edge.fromSide, edge.fromOffset);
  const end = edge.tp ?? anchor(to, edge.toSide, edge.toOffset);
  return [start, ...edge.via, end];
}

function baselines(node) {
  const out = [];
  let y = node.y + 18;
  for (const l of node.lines) {
    out.push(Math.round(y * 10) / 10);
    y += l.size >= 10.5 ? 14.5 : l.size >= 9.5 ? 13.5 : 12.5;
  }
  return out;
}

function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function widthOf(text, size) {
  return Math.ceil(text.length * size * WIDTH_FACTOR);
}

// ---------------------------------------------------------------------------
// Layout assertions
// ---------------------------------------------------------------------------

function validate() {
  const problems = [];
  const say = (m) => problems.push(m);
  const rightLimit = CANVAS.width - MARGIN.right;
  const bottomLimit = CANVAS.height - MARGIN.bottom;

  for (const node of NODES) {
    if (node.x < MARGIN.left) say(`${node.id}: x ${node.x} is inside the left margin`);
    if (node.y < MARGIN.top) say(`${node.id}: y ${node.y} is inside the top margin`);
    if (node.right > rightLimit) say(`${node.id}: right ${node.right} > ${rightLimit}`);
    if (node.bottom > bottomLimit) say(`${node.id}: bottom ${node.bottom} > ${bottomLimit}`);
    if (node.w < 50 || node.h < 30) say(`${node.id}: degenerate box ${node.w}x${node.h}`);

    for (const l of node.lines) {
      const budget = node.w - 16;
      const est = widthOf(l.text, l.size);
      if (est > budget) {
        say(`${node.id}: "${l.text}" needs ~${est}px but has ${budget}px at ${l.size}px`);
      }
      const kind = l.anchor ?? node.anchor;
      const reach = kind === "start" ? node.x + 10 + est : node.cx + est / 2;
      if (reach > node.right - 6) say(`${node.id}: "${l.text}" overflows the box on the right`);
    }
    for (const b of baselines(node)) {
      if (b + 3 > node.bottom || b - 5 < node.y) {
        say(`${node.id}: text baseline ${b} is outside ${node.y}..${node.bottom}`);
      }
    }
  }

  for (const node of NODES) {
    for (const childId of node.children) {
      const c = byId.get(childId);
      if (!c) {
        say(`${node.id}: unknown child ${childId}`);
        continue;
      }
      if (c.x <= node.x || c.right >= node.right || c.y <= node.y || c.bottom >= node.bottom) {
        say(`${node.id} does not strictly contain ${childId}`);
      }
    }
  }

  // sibling boxes must not overlap: same parent, or both parentless
  const siblings = NODES.filter((node) => !parentOf.has(node.id));
  for (let i = 0; i < siblings.length; i++) {
    for (let j = i + 1; j < siblings.length; j++) {
      const a = siblings[i];
      const b = siblings[j];
      if (isContainer(a) || isContainer(b)) continue;
      if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) {
        say(`overlap: ${a.id} ${rect(a)} vs ${b.id} ${rect(b)}`);
      }
    }
  }

  const segments = [];
  for (const edge of EDGES) {
    if (!byId.has(edge.from)) say(`edge ${edge.from}->${edge.to}: unknown source`);
    if (!byId.has(edge.to)) say(`edge ${edge.from}->${edge.to}: unknown target`);
    if (edge.label && (edge.lx == null || edge.ly == null)) {
      say(`${edge.from}->${edge.to}: label without a position`);
    }
    const pts = edgePoints(edge);
    const startBox = byId.get(edge.from);
    const endBox = byId.get(edge.to);
    for (const [p, box] of [[pts[0], startBox], [pts[pts.length - 1], endBox]]) {
      const onBorder =
        Math.abs(p.x - box.x) < 0.51 || Math.abs(p.x - box.right) < 0.51 ||
        Math.abs(p.y - box.y) < 0.51 || Math.abs(p.y - box.bottom) < 0.51;
      if (!onBorder) say(`${edge.from}->${edge.to}: endpoint ${p.x},${p.y} is not on ${box.id}`);
    }
    if (edge.label) {
      const half = widthOf(edge.label, 8.4) / 2;
      if (edge.lx - half < MARGIN.left || edge.lx + half > rightLimit) {
        say(`label "${edge.label}" runs off the canvas`);
      }
      for (const box of NODES) {
        if (isContainer(box)) continue;
        if (
          edge.lx + half > box.x && edge.lx - half < box.right &&
          edge.ly + 2 > box.y && edge.ly - 9 < box.bottom
        ) {
          say(`label "${edge.label}" sits on top of ${box.id}`);
        }
      }
    }
    for (let k = 1; k < pts.length; k++) {
      segments.push({ a: pts[k - 1], b: pts[k], tag: `${edge.from}->${edge.to}` });
    }
  }

  let crossings = 0;
  const crossingPairs = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const p = segments[i];
      const q = segments[j];
      if (p.tag === q.tag || sharesEndpoint(p, q)) continue;
      if (crosses(p, q)) {
        crossings++;
        crossingPairs.push(`${p.tag} x ${q.tag}`);
      }
    }
  }
  // One crossing is forced by the fan-in: catalog/selection/sheet all want
  // constants.js while selection and sheet also want recolor.js, so the bipartite
  // orderings conflict. More than one means the hand-placed coordinates drifted.
  if (crossings > 1) {
    say(`${crossings} edge crossings, expected 1: ${crossingPairs.join("; ")}`);
  }

  if (problems.length) {
    throw new Error(`architecture.svg layout rejected:\n - ${problems.join("\n - ")}`);
  }
  return { boxes: NODES.length, edges: EDGES.length, crossings, crossingPairs };
}

function isContainer(b) {
  return b.kind === "group" || b.kind === "engine";
}

function rect(b) {
  return `(${b.x},${b.y},${b.w}x${b.h})`;
}

function sharesEndpoint(p, q) {
  const eq = (r, s) => Math.abs(r.x - s.x) < 0.51 && Math.abs(r.y - s.y) < 0.51;
  return eq(p.a, q.a) || eq(p.a, q.b) || eq(p.b, q.a) || eq(p.b, q.b);
}

function crosses(p, q) {
  const d = (r, s, t) => (s.x - r.x) * (t.y - r.y) - (s.y - r.y) * (t.x - r.x);
  const d1 = d(q.a, q.b, p.a);
  const d2 = d(q.a, q.b, p.b);
  const d3 = d(p.a, p.b, q.a);
  const d4 = d(p.a, p.b, q.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function styleOf(kind) {
  switch (kind) {
    case "group":
      return { fill: C.group, stroke: C.groupStroke, dash: "", rx: 10 };
    case "engine":
      return { fill: C.engine, stroke: C.engineStroke, dash: "", rx: 10 };
    case "boundary":
      return { fill: C.boundary, stroke: C.boundaryStroke, dash: ' stroke-dasharray="6 4"', rx: 8 };
    case "render":
      return { fill: C.renderBox, stroke: C.renderStroke, dash: "", rx: 7 };
    case "plain":
      return { fill: C.panel, stroke: C.panelStroke, dash: "", rx: 7 };
    default:
      return { fill: C.box, stroke: C.boxStroke, dash: "", rx: 7 };
  }
}

function renderBoxes() {
  const out = [];
  for (const node of NODES) {
    const s = styleOf(node.kind);
    out.push(
      `    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${s.rx}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"${s.dash}/>`,
    );
    const ys = baselines(node);
    node.lines.forEach((l, i) => {
      const kind = l.anchor ?? node.anchor;
      const x = kind === "start" ? node.x + 10 : node.cx;
      out.push(
        `    <text x="${x}" y="${ys[i]}" text-anchor="${kind}" font-size="${l.size}" font-weight="${l.weight}" fill="${l.fill}">${esc(l.text)}</text>`,
      );
    });
  }
  return out;
}

function renderEdges() {
  const out = [];
  for (const edge of EDGES) {
    const pts = edgePoints(edge);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    out.push(
      `    <path d="${d}" fill="none" stroke="${C.arrow}" stroke-width="1.4" marker-end="url(#arrowhead)"/>`,
    );
    if (edge.label) {
      out.push(
        `    <text x="${edge.lx}" y="${edge.ly}" text-anchor="middle" font-size="8.4" fill="${C.dim}">${esc(edge.label)}</text>`,
      );
    }
  }
  return out;
}

function render() {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" font-family="${FONT}" role="img" aria-labelledby="arch-title arch-desc">`,
    `  <title id="arch-title">lpc-spritesheet-mcp system architecture</title>`,
    `  <desc id="arch-desc">An MCP client calls seven tools over stdio JSON-RPC. src/index.js sends discovery tools to the engine catalog and render tools through the shared src/character.js pipeline into src/engine, which composites character layers onto @napi-rs/canvas using the row layout in constants.js. src/assets-dir.js locates the external, read-only Universal LPC asset pack that supplies the definitions and sprite PNGs, and every render writes a spritesheet PNG plus credits files beside the output path.</desc>`,
    `  <defs>`,
    `    <marker id="arrowhead" markerWidth="9" markerHeight="9" refX="8" refY="3.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">`,
    `      <path d="M0 0 L8 3.5 L0 7 z" fill="${C.arrow}"/>`,
    `    </marker>`,
    `  </defs>`,
    `  <rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" rx="14" fill="${C.panel}" stroke="${C.panelStroke}" stroke-width="1.5"/>`,
    `  <text x="32" y="42" font-size="19" font-weight="bold" fill="${C.text}">lpc-spritesheet-mcp · system architecture</text>`,
    `  <text x="32" y="60" font-size="10" fill="${C.dim}">headless Universal LPC spritesheet compositor · plain ESM, no build step · every arrow is a real call or import edge</text>`,
    `  <g id="boxes">`,
    ...renderBoxes(),
    `  </g>`,
    `  <g id="edges">`,
    ...renderEdges(),
    `  </g>`,
    `  <text x="32" y="708" font-size="8.2" fill="${C.dim}">Regenerate with npm run diagrams (scripts/make-architecture-svg.mjs); the layout is asserted by that script, so edit the tables there rather than this file.</text>`,
    `</svg>`,
  ].join("\n") + "\n";
}

function main() {
  const stats = validate();
  const svg = render();
  const bytes = Buffer.byteLength(svg);
  if (bytes > 100_000) throw new Error(`architecture.svg is ${bytes} bytes; keep it under 100 KB`);
  // the committed file must not leak a machine path or a timestamp
  if (/[A-Za-z]:\\/.test(svg)) throw new Error("architecture.svg must not embed a Windows path");
  if (svg.includes(os.homedir())) throw new Error("architecture.svg must not embed the home directory");
  if (/\d{4}-\d{2}-\d{2}|GMT |UTC|[0-9a-f]{8}-[0-9a-f]{4}/i.test(svg)) {
    throw new Error("architecture.svg must not embed a timestamp, timezone or random id");
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg, "utf8");
  const rel = path.relative(ROOT, OUT).replaceAll("\\", "/");
  console.log(
    `[diagrams] wrote ${rel} — ${CANVAS.width}x${CANVAS.height}, ` +
      `${stats.boxes} boxes, ${stats.edges} edges, ${stats.crossings} crossing, ${bytes} bytes`,
  );
}

main();
