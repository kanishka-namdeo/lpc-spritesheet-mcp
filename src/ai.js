// Opt-in AI-assisted character designer for lpc-spritesheet-mcp.
//
// CONTRACT (read before wiring): the MCP server in src/index.js is offline and
// inert by default — no network calls, no env reads beyond LPC_ASSETS_DIR. This
// module is the ONE deliberate exception, and it is opt-in: nothing here runs
// unless the operator sets LPC_AI_API_KEY (plus optional LPC_AI_BASE_URL /
// LPC_AI_MODEL) in the server's environment. This module NEVER reads
// process.env itself — the caller (src/index.js tool wiring) reads its env once,
// calls aiConfigFromEnv(env), and only mounts the AI tool when it returns a
// config. With no API key the feature is off and this file is dead code to the
// server. All network traffic goes to an OpenAI-compatible chat-completions
// endpoint; the default base URL is the repo owner's documented Dashscope
// endpoint (a public URL, not a secret). No API key is ever hardcoded — the key
// arrives via the injected config object and is used only as a Bearer header.
//
// Dependencies: Node builtins + globalThis.fetch only (repo two-deps rule).
// Every function here is pure/injectable so the test suite runs fully offline
// via a mock fetchImpl.
//
// Flow: aiConfigFromEnv → buildCatalogDigest(catalog) → designCharacter() →
// chatCompletion() → parseCharacterSpec() → {bodyType, selections, colors,
// rationale} — exactly the shape normalizeSelections()/render_character accept.

import { BODY_TYPES } from "./engine/constants.js";

// ---------------------------------------------------------------------------
// Config (opt-in gate)
// ---------------------------------------------------------------------------

/** Documented owner endpoint (a URL, not a secret): Dashscope's OpenAI-compatible API. */
export const DEFAULT_AI_BASE_URL = "https://coding-intl.dashscope.aliyuncs.com/v1";

/**
 * Default chat model. Measured on the character-design task (7.3k-char digest,
 * ~800-char reply): kimi-k2.5 answers in ~6s where the qwen3.*-plus models take
 * 50-70s — an order of magnitude that decides whether the tool fits inside an
 * MCP client's default 60s request timeout, so the fast model is the default.
 * The qwen models remain fully selectable (LPC_AI_MODEL / per-call `model`).
 */
export const DEFAULT_AI_MODEL = "kimi-k2.5";

/** Models the owner has validated against the endpoint. An unknown LPC_AI_MODEL is a config error. */
export const VALID_AI_MODELS = ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"];

/** Default request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Read the AI feature config from an env object (pass process.env from the caller —
 * this module never touches process.env itself).
 *
 * Returns null when LPC_AI_API_KEY is absent or blank: the feature is OFF and the
 * server stays offline. Otherwise returns {apiKey, baseUrl, model} where baseUrl
 * defaults to DEFAULT_AI_BASE_URL and model to DEFAULT_AI_MODEL. An unknown
 * LPC_AI_MODEL throws (a silently-wrong model surfaces as baffling endpoint 400s).
 *
 * @param {Record<string, string>} env environment mapping, e.g. process.env
 * @returns {{ apiKey: string, baseUrl: string, model: string } | null}
 */
export function aiConfigFromEnv(env) {
  const rawKey = env?.LPC_AI_API_KEY;
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!apiKey) return null; // feature off — everything else is irrelevant

  const baseUrl =
    (typeof env.LPC_AI_BASE_URL === "string" ? env.LPC_AI_BASE_URL.trim() : "") ||
    DEFAULT_AI_BASE_URL;
  const model =
    (typeof env.LPC_AI_MODEL === "string" ? env.LPC_AI_MODEL.trim() : "") ||
    DEFAULT_AI_MODEL;
  if (!VALID_AI_MODELS.includes(model)) {
    throw new Error(
      `Unknown LPC_AI_MODEL "${model}". Valid models: ${VALID_AI_MODELS.join(", ")}. ` +
        `Unset LPC_AI_MODEL to use the default ("${DEFAULT_AI_MODEL}").`,
    );
  }
  return { apiKey, baseUrl, model };
}

// ---------------------------------------------------------------------------
// Catalog digest (grounding text for the LLM)
// ---------------------------------------------------------------------------

/**
 * Selection groups that get a full itemId listing in the digest. These cover the
 * decisions a natural-language brief actually drives. "body" is excluded — it is
 * always the default "body" item and only its color varies.
 */
const CURATED_GROUPS = [
  "head", "expression", "hair", "clothes", "legs", "shoes", "hat", "weapon",
  "shield", "belt", "ears", "tail", "wings", "apron", "armour", "dress",
];

/**
 * Per-group itemId caps for curated groups ("…(+N more)" marks every cut).
 * The digest has a hard ~7000-char budget (test gate 7500), which the pack's
 * real sizes make binding: head alone is 45 items and hair 91. The caps are
 * chosen so every HUMAN head (they sit at the tail of the head group's pack
 * order), every tool/bow/sword, and the common clothes survive the window —
 * while honest truncation markers tell the model that more exist. Monster-only
 * heads beyond the window are still reachable: zombie/vampire looks come via
 * body colors ("zombie"), and the MCP flow iterates with list_items.
 */
const GROUP_ITEM_CAPS = {
  head: 36, expression: 15, hair: 56, clothes: 14, legs: 21, shoes: 12,
  hat: 14, weapon: 38, shield: 5, belt: 5, ears: 5, tail: 5, wings: 5,
  apron: 4, armour: 3, dress: 4,
};
const DEFAULT_GROUP_ITEM_CAP = 60;

/** Color names listed per palette material (body + hair are always listed in full). */
const PALETTE_COLOR_CAP = 12;
const FULL_COLOR_MATERIALS = new Set(["body", "hair"]);

/**
 * Build the compact grounding text for the LLM: itemIds per curated selection
 * group, every group name with its item count, palette color names per material,
 * and the notes an LLM needs to produce a renderable spec. Deterministic for a
 * given asset pack. The design budget is ~7000 chars; on the pinned pack the
 * real group sizes (hair 91, head 45, clothes 35, hat 50, weapon 40, 92 groups
 * total) put the achievable floor for full-coverage grounding at ~7.3k, which
 * the test suite hard-asserts stays < 7500. If a pack bump grows the digest,
 * GROUP_ITEM_CAPS is the lever.
 *
 * Structure:
 * - bodyTypes line
 * - non-curated groups: "name:count" index (curated ones headline their own sections)
 * - curated groups: up to GROUP_ITEM_CAPS itemIds, "…(+N more)" when truncated
 * - palettes: per material the color names (body + hair complete, others capped)
 * - notes: defaults, name-vs-itemId, variants, colors rules
 *
 * @param {import("./engine/catalog.js").Catalog} catalog loaded catalog
 * @returns {string} digest text (~7.3k chars on the pinned pack, < 7500 by design)
 */
export function buildCatalogDigest(catalog) {
  const lines = [];
  lines.push(`LPC character catalog digest (${catalog.itemsById.size} items).`);
  lines.push(`bodyTypes: ${BODY_TYPES.join(", ")}`);

  // Group index: every group name + item count. Curated groups get their own
  // sections below, so the index only needs the rest. One-item groups are
  // listed bare (the label says so) to hold the character budget.
  const otherGroups = catalog
    .listTypeNames()
    .sort((a, b) => a.localeCompare(b))
    .filter((g) => !CURATED_GROUPS.includes(g) && g !== "body");
  lines.push(
    `Other selection groups (name:count when more than 1): ${otherGroups
      .map((g) => {
        const n = catalog.byTypeName.get(g).length;
        return n > 1 ? `${g}:${n}` : g;
      })
      .join(", ")}.`,
  );
  lines.push("");
  lines.push("Curated groups (…(+N more) = list truncated):");

  for (const group of CURATED_GROUPS) {
    const ids = catalog.byTypeName.get(group);
    if (!ids?.length) continue; // "whatever exists" — skip groups this pack lacks
    const cap = GROUP_ITEM_CAPS[group] ?? DEFAULT_GROUP_ITEM_CAP;
    const shown = ids.slice(0, cap);
    const rest = ids.length - shown.length;
    lines.push(
      `${group} (${ids.length}): ${shown.join(", ")}${rest > 0 ? ` …(+${rest} more)` : ""}`,
    );
  }

  // Palettes: color names per material, default version's names first.
  lines.push("");
  lines.push("Palettes (valid recolor / colors values):");
  const materials = catalog.paletteMetadata?.materials ?? {};
  for (const material of Object.keys(materials).sort((a, b) => a.localeCompare(b))) {
    const meta = materials[material];
    if (!meta?.palettes) continue;
    const versions = Object.keys(meta.palettes);
    const ordered = [
      meta.default,
      ...versions.filter((v) => v !== meta.default),
    ].filter((v) => v && meta.palettes[v]);
    const names = [];
    for (const version of ordered) {
      for (const name of Object.keys(meta.palettes[version])) {
        if (!names.includes(name)) names.push(name);
      }
    }
    const full = FULL_COLOR_MATERIALS.has(material);
    const shown = full ? names : names.slice(0, PALETTE_COLOR_CAP);
    const rest = names.length - shown.length;
    lines.push(
      `${material}: ${shown.join(", ")}${rest > 0 ? ` …(+${rest} more)` : ""}`,
    );
  }

  lines.push("");
  lines.push("Notes:");
  lines.push(
    '- Defaults: body (item "body") + a head + expression "face_neutral" are always drawn; pick a head matching the bodyType (heads_human_female for female).',
  );
  lines.push(
    '- Selection values: exact itemId (preferred) or the item\'s display name; some items have variants — set "variant" only when needed.',
  );
  lines.push(
    '- colors.<group> recolors that selected group ("eyes" = eye color). Body + hair colors above are complete; other lists may be truncated.',
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Chat completions (OpenAI-compatible)
// ---------------------------------------------------------------------------

/**
 * POST {baseUrl}/chat/completions and return the assistant message content.
 *
 * - Auth: `Authorization: Bearer {apiKey}`; body: {model, messages, temperature,
 *   max_tokens, response_format?}.
 * - opts.responseFormat (default true) requests `response_format:
 *   {type:"json_object"}`. Some models reject it, so a 400 whose body mentions
 *   response_format/json is retried ONCE without it.
 * - opts.timeoutMs (default 60000) aborts the request via AbortController and
 *   rejects with a "timed out" error (works even if fetchImpl ignores the signal).
 * - opts.fetchImpl (default globalThis.fetch) is injectable so tests never touch
 *   the network.
 * - Non-2xx → Error with the status and a 300-char body excerpt. Network failure
 *   → Error with the cause attached.
 *
 * @param {{
 *   baseUrl: string, apiKey: string, model: string,
 *   messages: {role: string, content: string}[],
 *   temperature?: number, maxTokens?: number,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, responseFormat?: boolean,
 * }} opts
 * @returns {Promise<string>} assistant message content
 */
export async function chatCompletion(opts) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    temperature = 0.4,
    maxTokens = 2000,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseFormat = true,
  } = opts;

  if (!baseUrl || typeof baseUrl !== "string") {
    throw new Error("chatCompletion: baseUrl is required (e.g. https://…/v1).");
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error(
      "chatCompletion: apiKey is required — the AI designer is opt-in via LPC_AI_API_KEY.",
    );
  }
  if (!model || typeof model !== "string") {
    throw new Error(`chatCompletion: model is required (valid: ${VALID_AI_MODELS.join(", ")}).`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("chatCompletion: messages must be a non-empty array of {role, content}.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "chatCompletion: no fetch available — pass fetchImpl or run on Node >= 20.11 (globalThis.fetch).",
    );
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  /** @param {boolean} wantResponseFormat */
  const buildPayload = (wantResponseFormat) => ({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(wantResponseFormat ? { response_format: { type: "json_object" } } : {}),
  });

  let wantResponseFormat = responseFormat !== false;
  let response = await postJson(fetchImpl, url, headers, buildPayload(wantResponseFormat), timeoutMs);

  if (!response.ok) {
    let bodyText = await responseText(response);
    if (response.status === 400 && wantResponseFormat && /response_format|json/i.test(bodyText)) {
      // Some models reject response_format — one retry without it.
      wantResponseFormat = false;
      response = await postJson(fetchImpl, url, headers, buildPayload(false), timeoutMs);
      if (!response.ok) bodyText = await responseText(response);
    }
    if (!response.ok) {
      throw new Error(
        `chat completions request failed: HTTP ${response.status} from POST ${url} — ${truncate(bodyText, 300)}`,
      );
    }
  }

  const payload = await responsePayload(response);
  const content = payload.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(
      `chat completions response had no assistant message content (HTTP ${response.status}) — ${truncate(payload.text, 300)}`,
    );
  }
  return content;
}

/**
 * POST JSON with an abort-based timeout. Rejects with a "timed out" error when
 * timeoutMs elapses (whether fetchImpl honors the signal or not), otherwise with
 * a network error carrying the cause.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {unknown} payload
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function postJson(fetchImpl, url, headers, payload, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer; // cleared once the race settles, or a late abort/rejection would leak
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  const request = Promise.resolve().then(() =>
    fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }),
  );
  request.catch(() => {}); // if the race is lost, a late rejection must stay handled
  try {
    return await Promise.race([request, timeout]);
  } catch (err) {
    if (timedOut) {
      throw new Error(
        `chat completions request timed out after ${timeoutMs}ms (POST ${url})`,
        { cause: err },
      );
    }
    throw new Error(`chat completions request failed (POST ${url}): ${errorMessage(err)}`, {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a Response-like's payload once, tolerating mocks that provide only
 * json() or only text(): returns {text, data} where data is the parsed JSON
 * when parseable.
 *
 * @param {Response} response
 * @returns {Promise<{ text: string, data: any }>}
 */
async function responsePayload(response) {
  let text = "";
  if (typeof response.text === "function") text = await response.text();
  let data = null;
  if (typeof response.json === "function") {
    try {
      data = await response.json();
    } catch {
      // body already consumed via text(), or not JSON — fall through
    }
  }
  if (data === null && text) {
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON — data stays null
    }
  }
  if (!text && data !== null && data !== undefined) {
    text = typeof data === "string" ? data : JSON.stringify(data);
  }
  return { text: text ?? "", data };
}

/** @param {Response} response @returns {Promise<string>} */
async function responseText(response) {
  return (await responsePayload(response)).text;
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

/**
 * Extract the character spec {bodyType?, selections, colors} from an LLM reply.
 * The reply may be bare JSON, fenced (```json …```), or wrapped in prose.
 *
 * Finds balanced {...} objects in order and uses the first that parses as JSON
 * (preferring one carrying "selections"); a prose "{" that parses to nothing is
 * skipped. Validation: selections is a plain object whose values are strings or
 * {itemId|item, variant?, recolor?}; colors is a plain object of strings;
 * bodyType is an optional string. A `rationale` (or `description`) string field
 * passes through. Anything invalid throws an Error naming the offending detail
 * plus the raw reply truncated to 400 chars — these messages surface directly
 * in the MCP tool result, so they must be self-sufficient.
 *
 * @param {string} text assistant reply
 * @returns {{ bodyType: string | null, selections: Record<string, any>, colors: Record<string, string>, rationale: string | null }}
 */
export function parseCharacterSpec(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`AI reply was empty (${typeof text}). Raw reply: ${truncate(text, 400)}`);
  }
  let firstParseable = null; // {obj, raw}
  let parseError = null;
  for (const candidate of balancedObjects(text)) {
    let obj;
    try {
      obj = JSON.parse(candidate);
    } catch (err) {
      parseError ??= err;
      continue;
    }
    if (firstParseable === null) firstParseable = { obj, raw: candidate };
    if (isPlainObject(obj) && obj.selections !== undefined) {
      return validateCharacterSpec(obj, candidate);
    }
  }
  if (firstParseable) return validateCharacterSpec(firstParseable.obj, firstParseable.raw);
  if (parseError) {
    throw new Error(
      `AI reply contained a JSON object that could not be parsed (${errorMessage(parseError)}). ` +
        `Raw reply: ${truncate(text, 400)}`,
    );
  }
  throw new Error(
    `AI reply contained no JSON object. Raw reply: ${truncate(text, 400)}`,
  );
}

/**
 * Validate a parsed spec object against the schema and normalize it. Throws with
 * the offending detail + raw text on any violation.
 *
 * @param {any} obj parsed JSON
 * @param {string} raw the exact JSON substring the object came from
 */
function validateCharacterSpec(obj, raw) {
  const fail = (detail) => {
    throw new Error(
      `AI character spec invalid: ${detail} Raw reply: ${truncate(raw, 400)}`,
    );
  };
  if (!isPlainObject(obj)) {
    fail(`expected a JSON object, got ${Array.isArray(obj) ? "an array" : `a ${typeof obj}`}.`);
  }

  let bodyType = null;
  if (obj.bodyType !== undefined && obj.bodyType !== null) {
    if (typeof obj.bodyType !== "string") {
      fail(`bodyType must be a string, got ${JSON.stringify(obj.bodyType)}.`);
    }
    bodyType = obj.bodyType;
  }

  if (obj.selections === undefined) fail('required key "selections" is missing.');
  if (!isPlainObject(obj.selections)) {
    fail(
      `selections must be an object mapping group -> itemId | "none" | {itemId, variant?, recolor?}; ` +
        `got ${Array.isArray(obj.selections) ? "an array" : `a ${typeof obj.selections}`}.`,
    );
  }
  for (const [group, value] of Object.entries(obj.selections)) {
    if (value === null || value === "none" || typeof value === "string") continue;
    if (isPlainObject(value)) {
      const id = value.itemId ?? value.item;
      if (typeof id !== "string" || id.length === 0) {
        fail(
          `selections.${group} must name an item via "itemId" (or "item"); got ${JSON.stringify(value)}.`,
        );
      }
      for (const key of ["variant", "recolor"]) {
        if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") {
          fail(`selections.${group}.${key} must be a string, got ${JSON.stringify(value[key])}.`);
        }
      }
      continue;
    }
    fail(
      `selections.${group} must be an itemId string, "none", or {itemId, variant?, recolor?}; ` +
        `got ${JSON.stringify(value)}.`,
    );
  }

  let colors = {};
  if (obj.colors !== undefined && obj.colors !== null) {
    if (!isPlainObject(obj.colors)) {
      fail(`colors must be an object mapping group -> color name string; got ${typeof obj.colors}.`);
    }
    for (const [group, color] of Object.entries(obj.colors)) {
      if (typeof color !== "string") {
        fail(`colors.${group} must be a color name string; got ${JSON.stringify(color)}.`);
      }
    }
    colors = obj.colors;
  }

  const rationale =
    typeof obj.rationale === "string"
      ? obj.rationale
      : typeof obj.description === "string"
        ? obj.description
        : null;
  return { bodyType, selections: obj.selections, colors, rationale };
}

/**
 * All balanced top-level {...} substrings of `text`, in order. String literals
 * (with escapes) are respected so braces inside rationale strings don't break
 * the scan.
 *
 * @param {string} text
 * @returns {string[]}
 */
function balancedObjects(text) {
  const found = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          found.push(text.slice(start, i + 1));
          start = i; // continue scanning after this object
          break;
        }
      }
    }
    // An unterminated object (text ended mid-object) simply yields nothing; the
    // outer update rescans from the next "{" inside it, which is harmless.
  }
  return found;
}

// ---------------------------------------------------------------------------
// The design flow
// ---------------------------------------------------------------------------

/**
 * System prompt for the character designer. Kept module-level and exported so
 * the tool wiring (and the tests) can assert the exact contract the model is
 * held to: strict JSON schema, digest-only ids/colors, few items done well.
 */
export const CHARACTER_SYSTEM_PROMPT = `You are an expert character designer for the Universal LPC Spritesheet Character Generator. The user sends a short natural-language brief (e.g. "a tanned blacksmith with a leather apron and a hammer"); you reply with ONE character the generator can actually render.

Reply with a single JSON object and nothing else — no markdown fences, no prose before or after. Strict output schema:
{
  "bodyType": "male" | "female" | "teen" | "child" | "muscular" | "pregnant",
  "selections": { "<group>": "<itemId>" | { "itemId": "<itemId>", "variant": "<variant>", "recolor": "<colorName>" } },
  "colors": { "<group>": "<colorName>" },
  "rationale": "<one short paragraph: how the brief mapped to items and colors>"
}

Rules:
- Use ONLY itemIds, group names and color names that appear in the catalog digest. Never invent one: a single unknown id fails the whole render.
- Prefer few items done well: body, a head matching the bodyType, hair, an expression, clothes, legs, shoes — plus only the equipment the brief actually asks for (weapon, hat, shield, …). Omitting a group is always safe.
- Put an item's own color in that selection's "recolor"; use the top-level "colors" object only for groups you also selected — the one exception is "colors.eyes", which sets eye color.
- Skin tone goes in "colors.body" using the body palette names from the digest.
- Some items have variants; pass "variant" only when the digest or the brief demands one.
- Colors only for groups you selected, and only color names from the digest's palettes.`;

/**
 * Full AI design flow: brief → chat completion → validated spec.
 *
 * The system message is CHARACTER_SYSTEM_PROMPT plus the catalog digest (the
 * model may only use ids/colors that appear there); the user message is the
 * brief. Returns {bodyType, selections, colors, rationale, model} — the exact
 * shape the existing render pipeline (normalizeSelections → render_character)
 * accepts, so the MCP tool can pass it straight through.
 *
 * `repair` enables one self-healing round: when the caller validated the first
 * proposal and it failed (unknown itemId, bad color, wrong bodyType), passing
 * { spec: <the first raw reply>, error: <the validation error>, validItems:
 * {group: [itemIds]} } appends the failed reply plus a corrective user message
 * naming the valid options, so the model can fix its own mistake instead of
 * failing the whole design.
 *
 * @param {{
 *   prompt: string, digest: string,
 *   baseUrl: string, apiKey: string, model: string,
 *   temperature?: number, fetchImpl?: typeof fetch, timeoutMs?: number,
 *   repair?: { spec: object, error: string, validItems: Record<string, string[]> },
 * }} opts
 * @returns {Promise<{ bodyType: string | null, selections: Record<string, any>, colors: Record<string, string>, rationale: string | null, model: string }>}
 */
export async function designCharacter(opts) {
  const { prompt, digest, baseUrl, apiKey, model, temperature, fetchImpl, timeoutMs, repair } = opts;
  if (!prompt || typeof prompt !== "string") {
    throw new Error('designCharacter: "prompt" (the character brief) is required.');
  }
  if (!digest || typeof digest !== "string") {
    throw new Error('designCharacter: "digest" is required — build it with buildCatalogDigest(catalog).');
  }
  const messages = [
    { role: "system", content: `${CHARACTER_SYSTEM_PROMPT}\n\n--- Catalog digest ---\n${digest}` },
    { role: "user", content: prompt },
  ];
  if (repair) {
    messages.push({ role: "assistant", content: JSON.stringify(repair.spec) });
    messages.push({
      role: "user",
      content:
        `That proposal failed validation: ${repair.error}\n` +
        `Valid options for the groups you used (use these exact itemIds):\n` +
        `${JSON.stringify(repair.validItems)}\n` +
        `Reply with the corrected character JSON only — same schema, ids strictly from these lists or the digest.`,
    });
  }
  const content = await chatCompletion({
    baseUrl,
    apiKey,
    model,
    messages,
    temperature,
    fetchImpl,
    timeoutMs,
    responseFormat: true,
  });
  const spec = parseCharacterSpec(content);
  return {
    bodyType: spec.bodyType,
    selections: spec.selections,
    colors: spec.colors,
    rationale: spec.rationale,
    model,
    ...(repair ? { repaired: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** @param {unknown} v */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {string} str @param {number} n */
function truncate(str, n) {
  const s = String(str ?? "");
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** @param {unknown} err */
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
