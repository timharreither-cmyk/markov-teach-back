// =====================================================================
// Cloudflare Worker: the backend of the study app.
//
//   POST /chat  → one model call, returns the parsed JSON answer
//   POST /log   → forwards log events to the Google Apps Script (Sheet)
//
// MODEL PROVIDER
//   Default (free): Cloudflare Workers AI. Add a Workers AI binding named "AI"
//   (dashboard → Worker → Settings → Bindings → Add → Workers AI). No API key,
//   no payment: 10,000 free "neurons" per day on the Workers Free plan.
//   Optional: Google Gemini (paid tier only for users in CH/EU): set GEMINI_API_KEY
//   and remove the AI binding.
//
// Variables (dashboard → Worker → Settings → Variables and Secrets):
//   STUDY_CODE       (secret)  access code that is part of every participant link
//   LOG_URL          (secret)  URL of the Apps Script web app
//   LOG_TOKEN        (secret)  same random string as TOKEN in Code.gs
//   ALLOWED_ORIGINS  (text)    e.g. https://timharreither-cmyk.github.io
//   MODEL            (text, optional) Workers AI default: @cf/google/gemma-4-26b-a4b-it
//   MAX_CALLS_PER_SESSION (text, optional) default 80
//   GEMINI_API_KEY   (secret, optional) only if you use Gemini instead
// =====================================================================

const MAX_BODY = 120_000;           // bytes per request
const calls = new Map();            // best-effort per-session call counter (per isolate)

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : (allowed[0] || ""),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return reply({ ok: true, service: "markov-teach-back" });
    if (request.method !== "POST") return reply({ ok: false, error: "method" }, 405);
    if (!originOk) return reply({ ok: false, error: "origin not allowed" }, 403);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply({ ok: false, error: "request too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ ok: false, error: "bad json" }, 400); }
    if (!env.STUDY_CODE || body.code !== env.STUDY_CODE) return reply({ ok: false, error: "invalid access code" }, 401);

    if (url.pathname === "/chat") return reply(...(await chat(body, env)));
    if (url.pathname === "/log") return reply(...(await forwardLog(body, env)));
    return reply({ ok: false, error: "not found" }, 404);
  }
};

async function chat(body, env) {
  const sid = String(body.sid || "anon");
  const n = (calls.get(sid) || 0) + 1;
  calls.set(sid, n);
  if (n > Number(env.MAX_CALLS_PER_SESSION || 80)) return [{ ok: false, error: "call limit for this session reached" }, 429];

  const messages = (Array.isArray(body.messages) ? body.messages.slice(-60) : [])
    .map((m) => ({ role: m.role === "model" ? "model" : "user", text: String(m.text || "").slice(0, 4000) }));
  const system = String(body.system || "").slice(0, 40_000);
  const temperature = typeof body.temperature === "number" ? Math.min(Math.max(body.temperature, 0), 1) : 0.4;

  const res = env.AI
    ? await workersAI(env, system, messages, body.schema, temperature)
    : await geminiChat(env, system, messages, body.schema, temperature);
  if (!res.ok) return [{ ok: false, error: `model error ${res.status}`, detail: res.detail }, 502];

  const data = typeof res.text === "object" && res.text ? res.text : parseJson(res.text);
  if (!data) return [{ ok: false, error: "model returned no valid JSON" }, 502];
  return [{ ok: true, data, model: res.model, usage: res.usage }, 200];
}

// ---------------- Cloudflare Workers AI (free tier) ----------------
async function workersAI(env, system, messages, schema, temperature) {
  const model = env.MODEL || "@cf/google/gemma-4-26b-a4b-it";
  const input = {
    messages: [
      { role: "system", content: system + "\n\nAnswer with a single JSON object only, no other text." },
      ...messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))
    ],
    temperature,
    max_tokens: 1500
  };
  // JSON mode first; if the model does not support it (or cannot meet it), retry as plain text.
  const tries = schema ? [{ ...input, response_format: { type: "json_schema", json_schema: schema } }, input] : [input];
  let last = "";
  for (const req of tries) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await env.AI.run(model, req);
        const text = extractText(out);
        const parsed = typeof text === "object" ? text : parseJson(text);
        if (parsed) return { ok: true, text: parsed, model, usage: out && out.usage ? out.usage : null };
        last = "unparseable output";
        break;                                   // try the next variant
      } catch (e) {
        last = String(e && e.message || e);
        if (/neuron|limit|quota|4006|capacity/i.test(last)) return { ok: false, status: 429, detail: last };
        await new Promise((ok) => setTimeout(ok, 600));
      }
    }
  }
  return { ok: false, status: 502, detail: last };
}

// Workers AI models answer in different shapes; take the text (or object) from any of them.
function extractText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (out.response !== undefined) return out.response;                       // classic models
  const c = out.choices && out.choices[0];
  if (c && c.message) return c.message.content || "";                         // OpenAI-style
  if (Array.isArray(out.output)) {                                            // Responses-style
    return out.output.flatMap((o) => o.content || []).filter((p) => p.text).map((p) => p.text).join("");
  }
  return "";
}

// ---------------- Google Gemini (optional, paid tier) ----------------
async function geminiChat(env, system, messages, schema, temperature) {
  const model = env.MODEL || "gemini-3.6-flash";
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: "application/json" }
  };
  if (schema) payload.generationConfig.responseSchema = schema;
  let res = await gemini(model, payload, env);
  if (res.status === 400 && payload.generationConfig.responseSchema) {   // schema rejected: JSON mode only
    delete payload.generationConfig.responseSchema;
    res = await gemini(model, payload, env);
  }
  return { ...res, model };
}

async function gemini(model, payload, env) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(payload)
    });
    if (r.status === 429 || r.status >= 500) {             // rate limit / overload: back off and retry
      await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, detail: j.error?.message || "" };
    const parts = j.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    return { ok: true, status: 200, text, usage: j.usageMetadata || null };
  }
  return { ok: false, status: 503, detail: "model busy, retries exhausted" };
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);              // tolerate ```json fences or stray text
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function forwardLog(body, env) {
  const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
  if (!events.length) return [{ ok: true, stored: 0 }, 200];
  if (!env.LOG_URL) return [{ ok: false, error: "LOG_URL not set" }, 500];
  const r = await fetch(env.LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ token: env.LOG_TOKEN, events }),
    redirect: "follow"
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.ok) return [{ ok: false, error: "log store failed" }, 502];
  return [{ ok: true, stored: events.length }, 200];
}
