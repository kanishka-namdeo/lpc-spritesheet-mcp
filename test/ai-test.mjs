// Tests for the opt-in AI character designer (src/ai.js).
// Every network call goes through a mock fetchImpl — the suite is fully offline
// and contains no real keys or endpoints.
import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/engine/catalog.js";
import { findAssetsDir } from "../src/assets-dir.js";
import { normalizeSelections } from "../src/engine/selection.js";
import {
  aiConfigFromEnv,
  buildCatalogDigest,
  chatCompletion,
  parseCharacterSpec,
  designCharacter,
  CHARACTER_SYSTEM_PROMPT,
  DEFAULT_AI_BASE_URL,
  VALID_AI_MODELS,
} from "../src/ai.js";

const ASSETS_DIR = findAssetsDir();
if (!ASSETS_DIR) {
  throw new Error(
    "No LPC asset pack found. Run `npm run setup-assets`, or set LPC_ASSETS_DIR to a clone of the pack.",
  );
}
const catalog = new Catalog(ASSETS_DIR);

/** A Response-like the module accepts: ok/status plus json() and/or text(). */
const okResponse = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});

// ---------------------------------------------------------------------------
// aiConfigFromEnv
// ---------------------------------------------------------------------------

test("aiConfigFromEnv: off without a key, defaults with one, errors on bad model", () => {
  assert.equal(aiConfigFromEnv({}), null, "no env at all → feature off");
  assert.equal(aiConfigFromEnv({ LPC_AI_MODEL: "gpt-9" }), null, "model is irrelevant when off");
  assert.equal(aiConfigFromEnv({ LPC_AI_API_KEY: "   " }), null, "blank key → feature off");

  assert.deepEqual(aiConfigFromEnv({ LPC_AI_API_KEY: "k" }), {
    apiKey: "k",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    model: "kimi-k2.5", // the fast default: ~6s vs 50-70s for the qwen models on this task
  });

  assert.deepEqual(
    aiConfigFromEnv({ LPC_AI_API_KEY: "k", LPC_AI_BASE_URL: "http://localhost:11434/v1", LPC_AI_MODEL: "kimi-k2.5" }),
    { apiKey: "k", baseUrl: "http://localhost:11434/v1", model: "kimi-k2.5" },
  );

  assert.throws(
    () => aiConfigFromEnv({ LPC_AI_API_KEY: "k", LPC_AI_MODEL: "gpt-9" }),
    (err) => {
      assert.match(err.message, /gpt-9/);
      for (const m of VALID_AI_MODELS) assert.ok(err.message.includes(m), `lists ${m}`);
      return true;
    },
  );
  assert.equal(DEFAULT_AI_BASE_URL, "https://coding-intl.dashscope.aliyuncs.com/v1");
});

// ---------------------------------------------------------------------------
// buildCatalogDigest
// ---------------------------------------------------------------------------

test("buildCatalogDigest: grounded, complete enough to design with, under budget", () => {
  const digest = buildCatalogDigest(catalog);
  assert.ok(
    digest.length < 7500,
    `digest drifted to ${digest.length} chars — pack bump? tighten the digest caps in src/ai.js`,
  );
  assert.match(digest, /bodyTypes: male, female, teen, child, muscular, pregnant/);
  assert.ok(digest.includes("hair_bangs"), "a usable hair itemId is listed");
  assert.ok(digest.includes("heads_human_female"), "human heads survive the head cap");
  assert.ok(digest.includes("weapon_ranged_bow_recurve"), "weapons reach the ranged family");
  assert.ok(digest.includes("face_neutral"), "expressions are listed");
  assert.ok(digest.includes("torso_aprons_apron"), "aprons are curated — briefs ask for them by name");
  assert.ok(digest.includes("…(+"), "truncated lists are marked, not silently cut");
  // body + hair palettes are complete (they drive skin/hair choices)
  for (const name of ["light", "amber", "bronze", "zombie"]) {
    assert.ok(digest.includes(name), `body color "${name}" is in the digest`);
  }
  assert.ok(/^hair: /m.test(digest) && digest.includes("strawberry"), "hair palette is listed in full");
  // every group still appears with a count even when not curated
  assert.match(digest, /beard:\d+/, "non-curated groups are indexed by name and count");
  assert.match(digest, /cape:\d+/, "more non-curated groups in the index");
  // apron/armour/dress graduated to curated: briefs ask for them by name
  assert.ok(digest.includes("torso_aprons_apron"), "apron itemIds are listed, not just counted");
  assert.ok(digest.includes("torso_armour_plate"), "armour itemIds are listed");
});

test("CHARACTER_SYSTEM_PROMPT pins the strict output schema and grounding rules", () => {
  for (const key of ["bodyType", "selections", "colors", "rationale"]) {
    assert.ok(CHARACTER_SYSTEM_PROMPT.includes(`"${key}"`), `schema names "${key}"`);
  }
  assert.match(CHARACTER_SYSTEM_PROMPT, /ONLY itemIds.*digest|digest.*ONLY itemIds/s);
  assert.match(CHARACTER_SYSTEM_PROMPT, /few items done well/);
});

// ---------------------------------------------------------------------------
// chatCompletion
// ---------------------------------------------------------------------------

test("chatCompletion: happy path posts to {baseUrl}/chat/completions with auth and json mode", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return okResponse('{"a":1}');
  };
  const messages = [{ role: "user", content: "hello" }];

  const content = await chatCompletion({
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "qwen3.7-plus",
    messages,
    fetchImpl,
  });

  assert.equal(content, '{"a":1}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "qwen3.7-plus");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.temperature, 0.4, "temperature default");
  assert.equal(body.max_tokens, 2000, "max_tokens default");
  assert.deepEqual(body.response_format, { type: "json_object" }, "json mode on by default");

  // a trailing slash on baseUrl must not double up
  const again = await chatCompletion({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "test-key",
    model: "qwen3.7-plus",
    messages,
    fetchImpl,
  });
  assert.equal(again, '{"a":1}');
  assert.equal(calls[1].url, "https://api.example.com/v1/chat/completions");
});

test("chatCompletion: a 400 about response_format is retried once without it", async () => {
  const bodies = [];
  let call = 0;
  const fetchImpl = async (url, init) => {
    call += 1;
    bodies.push(JSON.parse(init.body));
    if (call === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "response_format is not supported for this model" } }),
      };
    }
    return okResponse("recovered");
  };

  const content = await chatCompletion({
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "kimi-k2.5",
    messages: [{ role: "user", content: "hello" }],
    fetchImpl,
  });

  assert.equal(content, "recovered");
  assert.equal(call, 2, "exactly one retry");
  assert.deepEqual(bodies[0].response_format, { type: "json_object" }, "first attempt asked for json mode");
  assert.ok(!("response_format" in bodies[1]), "retry dropped response_format");
});

test("chatCompletion: other 400s and explicit responseFormat:false never retry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 400, json: async () => ({ error: { message: "invalid api key" } }) };
  };
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl }),
    /HTTP 400.*invalid api key/s,
  );
  assert.equal(calls, 1, "a 400 that is not about response_format is not retried");

  calls = 0;
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl, responseFormat: false }),
    /HTTP 400/s,
  );
  assert.equal(calls, 1, "responseFormat:false means no response_format and no retry path");
});

test("chatCompletion: non-2xx reports status and body excerpt", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ error: { message: "upstream exploded" } }),
  });
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl }),
    (err) => {
      assert.match(err.message, /HTTP 500/);
      assert.match(err.message, /upstream exploded/);
      assert.ok(err.message.length < 600, "the excerpt stays truncated");
      return true;
    },
  );
});

test("chatCompletion: network errors wrap the cause; timeouts abort and say so", async () => {
  const boom = new Error("ECONNREFUSED");
  const failing = async () => {
    throw boom;
  };
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl: failing }),
    (err) => {
      assert.match(err.message, /ECONNREFUSED/);
      assert.equal(err.cause, boom, "the original error rides along as cause");
      return true;
    },
  );

  // never settles on its own — honors the abort signal like real fetch
  const hanging = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
    });
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl: hanging, timeoutMs: 50 }),
    /timed out after 50ms/,
  );

  // and even a fetch that IGNORES the signal cannot hang the call
  const ignoring = () => new Promise(() => {});
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl: ignoring, timeoutMs: 50 }),
    /timed out after 50ms/,
  );
});

test("chatCompletion: a 200 without message content is a helpful error, and args are validated", async () => {
  const empty = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", messages: [{ role: "user", content: "x" }], fetchImpl: empty }),
    /no assistant message content/,
  );
  await assert.rejects(chatCompletion({ baseUrl: "", apiKey: "k", model: "m", messages: [{ role: "user", content: "x" }] }), /baseUrl/);
  await assert.rejects(chatCompletion({ baseUrl: "https://x/v1", apiKey: "", model: "m", messages: [{ role: "user", content: "x" }] }), /apiKey/);
  await assert.rejects(chatCompletion({ baseUrl: "https://x/v1", apiKey: "k", model: "qwen3.7-plus", messages: [] }), /messages/);
});

// ---------------------------------------------------------------------------
// parseCharacterSpec
// ---------------------------------------------------------------------------

test("parseCharacterSpec: plain JSON, fenced JSON, and prose-wrapped JSON all parse", () => {
  const spec = {
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: { itemId: "hair_bangs", recolor: "raven" },
      weapon: "weapon_ranged_bow_recurve",
    },
    colors: { body: "light", clothes: "teal" },
    rationale: "An archer.",
  };

  assert.deepEqual(parseCharacterSpec(JSON.stringify(spec)), {
    bodyType: "female",
    selections: spec.selections,
    colors: spec.colors,
    rationale: "An archer.",
  });

  const fenced = "```json\n" + JSON.stringify(spec, null, 2) + "\n```";
  assert.deepEqual(parseCharacterSpec(fenced).selections, spec.selections);

  const prose =
    'Sure thing! Here is your character {"bodyType": "male", "selections": {"hair": "hair_bangs"}, "colors": {}, "rationale": "braces { are } quoted"} — hope it helps!';
  const fromProse = parseCharacterSpec(prose);
  assert.equal(fromProse.bodyType, "male");
  assert.equal(fromProse.selections.hair, "hair_bangs");
  assert.equal(fromProse.rationale, "braces { are } quoted", "braces inside strings survive the scan");

  // description passes through when rationale is absent
  const described = parseCharacterSpec('{"selections": {}, "colors": {}, "description": "backup field"}');
  assert.equal(described.rationale, "backup field");

  // bodyType and colors are optional
  const minimal = parseCharacterSpec('{"selections": {"hair": "hair_bangs"}}');
  assert.equal(minimal.bodyType, null);
  assert.deepEqual(minimal.colors, {});
});

test("parseCharacterSpec: broken or wrong-shaped replies throw with the detail and an excerpt", () => {
  assert.throws(() => parseCharacterSpec('{"bodyType": "female", "selections": {'), /Raw reply:/);
  assert.throws(() => parseCharacterSpec('{"selections": {oops}}'), /could not be parsed|no JSON object/);
  assert.throws(() => parseCharacterSpec("no json here at all"), /no JSON object/);

  assert.throws(
    () => parseCharacterSpec('{"bodyType": "female", "selections": 42, "colors": {}}'),
    (err) => {
      assert.match(err.message, /selections must be an object/);
      assert.match(err.message, /Raw reply:/);
      return true;
    },
  );
  assert.throws(() => parseCharacterSpec('{"selections": {"hair": 42}}'), /selections\.hair/);
  assert.throws(() => parseCharacterSpec('{"bodyType": 5, "selections": {}}'), /bodyType must be a string/);
  assert.throws(() => parseCharacterSpec('{"selections": {"hair": "hair_bangs"}, "colors": {"hair": 7}}'), /colors\.hair/);
  assert.throws(() => parseCharacterSpec('{"colors": {}}'), /"selections" is missing/);

  // the excerpt is capped at 400 chars
  const long = "x".repeat(1000);
  try {
    parseCharacterSpec(`{"selections": ${long.length}}`);
  } catch (err) {
    assert.ok(err.message.length < 700, `error stays readable, got ${err.message.length}`);
  }
});

// ---------------------------------------------------------------------------
// designCharacter (end to end, mocked transport)
// ---------------------------------------------------------------------------

test("designCharacter: brief → grounded messages → validated spec the renderer accepts", async () => {
  const digest = buildCatalogDigest(catalog);
  const fixedSpec = {
    bodyType: "female",
    selections: {
      head: "heads_human_female",
      hair: { itemId: "hair_bangs", recolor: "raven" },
      expression: "face_neutral",
      clothes: "torso_clothes_longsleeve",
      legs: "legs_pants",
      shoes: "feet_boots_basic",
      weapon: "weapon_ranged_bow_recurve",
    },
    colors: { body: "light", clothes: "teal" },
    rationale: "A female archer with bangs and a recurve bow.",
  };
  const reply = "```json\n" + JSON.stringify(fixedSpec, null, 2) + "\n```";

  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return okResponse(reply);
  };

  const result = await designCharacter({
    prompt: "a female archer with dark bangs, a teal longsleeve shirt and a recurve bow",
    digest,
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "kimi-k2.5",
    fetchImpl,
  });

  // the request side: grounded system message, brief as user message, model echo
  assert.equal(captured.url, "https://api.example.com/v1/chat/completions");
  assert.equal(captured.body.model, "kimi-k2.5");
  assert.equal(captured.body.messages.length, 2);
  const [system, user] = captured.body.messages;
  assert.equal(system.role, "system");
  assert.ok(system.content.includes(CHARACTER_SYSTEM_PROMPT), "system message carries the design prompt");
  assert.ok(system.content.includes(digest), "system message carries the catalog digest");
  assert.equal(user.role, "user");
  assert.equal(user.content, "a female archer with dark bangs, a teal longsleeve shirt and a recurve bow");

  // the reply side: fenced JSON parsed into the exact pipeline shape
  assert.equal(result.model, "kimi-k2.5");
  assert.equal(result.bodyType, "female");
  assert.equal(result.selections.hair.itemId, "hair_bangs");
  assert.equal(result.selections.hair.recolor, "raven");
  assert.equal(result.selections.weapon, "weapon_ranged_bow_recurve");
  assert.equal(result.colors.clothes, "teal");
  assert.equal(result.rationale, "A female archer with bangs and a recurve bow.");

  // and that shape is directly consumable by the existing render pipeline
  const selections = normalizeSelections(catalog, result.bodyType, result.selections, result.colors);
  assert.equal(selections.weapon.itemId, "weapon_ranged_bow_recurve");
  assert.equal(selections.hair.recolor, "raven");
  assert.equal(selections.clothes.recolor, "teal", "teal is a valid cloth color");
  assert.equal(selections.body.recolor, "light");
});

test("designCharacter: argument errors and endpoint failures surface readably", async () => {
  await assert.rejects(designCharacter({ digest: "d", baseUrl: "b", apiKey: "k", model: "m" }), /prompt/);
  await assert.rejects(designCharacter({ prompt: "p", baseUrl: "b", apiKey: "k", model: "m" }), /digest/);

  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "overloaded" } }) });
  await assert.rejects(
    designCharacter({ prompt: "p", digest: "d", baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", fetchImpl }),
    /HTTP 503.*overloaded/s,
  );

  // a garbage reply is reported with the spec error, not a raw JSON parse crash
  const garbage = async () => okResponse("I could not find any items for that.");
  await assert.rejects(
    designCharacter({ prompt: "p", digest: "d", baseUrl: "https://api.example.com/v1", apiKey: "k", model: "qwen3.7-plus", fetchImpl: garbage }),
    /no JSON object/,
  );
});

// ---------------------------------------------------------------------------
// designCharacter repair round
// ---------------------------------------------------------------------------

test("designCharacter repair round feeds the failure and valid ids back to the model", async () => {
  const badSpec = {
    bodyType: "female",
    selections: { hair: "hair_bangs", apron: "apron_leather" },
    colors: {},
    rationale: "first try",
  };
  const goodSpec = {
    bodyType: "female",
    selections: { hair: "hair_bangs", apron: "torso_aprons_apron" },
    colors: {},
    rationale: "fixed the apron",
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(calls.length === 1 ? badSpec : goodSpec) } }] }),
    };
  };

  const first = await designCharacter({
    prompt: "a blacksmith with an apron",
    digest: "digest",
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "kimi-k2.5",
    fetchImpl,
  });
  assert.equal(first.selections.apron, "apron_leather");
  assert.equal(first.repaired, undefined);

  const second = await designCharacter({
    prompt: "a blacksmith with an apron",
    digest: "digest",
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "kimi-k2.5",
    fetchImpl,
    repair: {
      spec: badSpec,
      error: 'Unknown item "apron_leather" for group "apron".',
      validItems: { apron: ["torso_aprons_apron", "torso_aprons_apron_full", "torso_aprons_apron_half"] },
    },
  });
  assert.equal(second.selections.apron, "torso_aprons_apron");
  assert.equal(second.repaired, true);
  assert.equal(second.rationale, "fixed the apron");
  // the repair conversation carries the failed reply and the corrective user message
  assert.equal(calls.length, 2);
  const repairMessages = calls[1].messages;
  assert.equal(repairMessages.at(-2).role, "assistant");
  assert.match(repairMessages.at(-1).content, /failed validation: Unknown item "apron_leather"/);
  assert.match(repairMessages.at(-1).content, /torso_aprons_apron/);
});
