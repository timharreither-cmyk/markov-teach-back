// Local test harness: serves the app and runs the REAL worker.js, with
// Gemini and the Apps Script replaced by scripted fakes.
//   node test/mock-server.mjs   →  http://localhost:8787/?pid=T1&g=ai&code=test&api=http://localhost:8787
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import worker from "../backend/worker.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  STUDY_CODE: "test", LOG_URL: "https://script.fake/exec", LOG_TOKEN: "tok",
  ALLOWED_ORIGINS: "https://example.github.io", MODEL: "fake-model"
};
const geminiLog = [];
export const stored = [];
// Fake Workers AI binding (the default provider): exercises JSON-mode fallback and both answer shapes.
let aiCalls = 0;
env.AI = {
  async run(model, input) {
    aiCalls++;
    geminiLog.push(input);
    if (aiCalls === 1 && input.response_format) throw new Error("JSON Mode couldn't be met");
    const obj = fakeReply({ systemInstruction: { parts: [{ text: input.messages[0].content }] } });
    return aiCalls % 2 ? { response: obj } : { response: "Here you go:\n" + JSON.stringify(obj) };
  }
};
let firstSchemaRejected = false;
const counters = { teach: {}, error: 0 };

function fakeReply(payload) {
  const sys = payload.systemInstruction.parts[0].text;
  if (/end-of-session feedback/.test(sys)) {
    return { strengths: ["You explained the graph step by step.", "You used Miso consistently."], weaknesses: ["You first squared each entry of T."], focus: ["T² is the matrix product T·T: entry (i,j) adds up all two-step paths i→k→j."] };
  }
  if (/CURRENT STATEMENT/.test(sys)) {
    const stmt = (sys.match(/CURRENT STATEMENT \(what you, Sam, just said\):\n(.*)/) || [])[1] || "";
    counters.error++;
    if (stmt.includes("from Playing") && !/Hints already given for this statement: 1/.test(sys))
      return { verdict_given: "false", corrected: false, misconceptions: [], move: "hint", message: "Hmm, can you add up the arrows leaving P for me?" };
    return { verdict_given: "false", corrected: true, misconceptions: [], move: "recap", message: "Right, thanks! Now I see my mistake." };
  }
  const topic = (sys.match(/CURRENT TOPIC: (.*)/) || [])[1];
  counters.teach[topic] = (counters.teach[topic] || 0) + 1;
  const n = counters.teach[topic];
  if (topic.startsWith("Transition graph")) {
    // always "hint": the app must force a reveal once the budget is used up
    return { assessment: "incorrect", covered_items: ["g1"], misconceptions: ["arrows only between different states"], move: "hint", message: `Hint ${n}: what about Miso staying asleep?` };
  }
  if (topic.startsWith("Transition matrix")) {
    if (n === 1) return { assessment: "partially_correct", covered_items: ["m1", "m2"], misconceptions: [], move: "probe", message: "Why does each row add up to 1?" };
    return { assessment: "correct", covered_items: ["m1", "m2", "m3", "m4"], misconceptions: [], move: "recap", message: "Got it: row = now, column = next. Thanks!" };
  }
  return { assessment: "correct", covered_items: ["s1", "s2", "s3", "s4", "bogus"], misconceptions: [], move: "recap", message: "So V2 = V0·T·T = [0.46 0.195 0.345]. Thanks!" };
}

globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("generativelanguage")) {
    const payload = JSON.parse(init.body);
    geminiLog.push(payload);
    if (payload.generationConfig.responseSchema && !firstSchemaRejected) {
      firstSchemaRejected = true;
      return new Response(JSON.stringify({ error: { message: "schema not supported" } }), { status: 400 });
    }
    const obj = fakeReply(payload);
    // every 3rd call wraps the JSON in a code fence to exercise the parser
    const text = geminiLog.length % 3 === 0 ? "```json\n" + JSON.stringify(obj) + "\n```" : JSON.stringify(obj);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text }] } }], usageMetadata: { totalTokenCount: 1 } }), { status: 200 });
  }
  if (url.startsWith("https://script.fake")) {
    const b = JSON.parse(init.body);
    if (b.token !== "tok") return new Response(JSON.stringify({ ok: false }), { status: 200 });
    stored.push(...b.events);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};

const types = { ".html": "text/html", ".js": "text/javascript", ".jsx": "text/babel", ".png": "image/png", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:8787");
  if (u.pathname === "/__stored") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ stored, geminiCalls: geminiLog.length })); }
  if (u.pathname === "/chat" || u.pathname === "/log" || req.method === "OPTIONS") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request("http://w" + u.pathname, {
      method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined
    }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  const f = path.join(ROOT, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "text/plain" });
  fs.createReadStream(f).pipe(res);
});
server.listen(8787, () => console.log("mock on http://localhost:8787"));
