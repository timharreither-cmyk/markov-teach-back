// =====================================================================
// app.jsx: study flow for "Learning by Teaching: Markov Chains".
// Flow (documentation section 6):
//   AI group:      consent → intro → material → T1 → T2 → T3 → error → feedback → done
//   Control group: consent → intro → material → 3 aloud prompts → error example → summary → done
// The flow and the hint rules live HERE, not in the model. The model only
// assesses each message and writes Sam's reply (see content.js).
// =====================================================================

const { useState, useEffect, useRef, useCallback } = React;
const C = window.STUDY;
const params = new URLSearchParams(location.search);
const WORKER = (params.get("api") || window.CONFIG.WORKER_URL).replace(/\/$/, "");
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36);

// ------------------------------------------------------------------
// Persistence: one state object per participant in localStorage, so a
// reload or a dropped connection resumes where the participant was.
// ------------------------------------------------------------------
const storeKey = (pid) => `mtb_state_${pid}`;
function loadState(pid) {
  try { return JSON.parse(localStorage.getItem(storeKey(pid))); } catch (e) { return null; }
}
function saveState(s) {
  try { localStorage.setItem(storeKey(s.pid), JSON.stringify(s)); } catch (e) {}
}
function freshState(pid, group, code) {
  return {
    v: C.version, pid, group, code, sid: uid(), startedAt: now(),
    phase: "consent", phaseStarts: { consent: now() },
    topicIdx: 0,
    topics: C.topics.map((t) => ({
      id: t.id, covered: [], hints: 0, turns: 0, outcome: null, start: null, end: null,
      misconceptions: [], messages: [{ role: "sam", text: t.opener }]
    })),
    err: { found: [], hints: 0, turns: 0, outcome: null, verdict: "none", start: null, end: null,
           misconceptions: [], messages: [{ role: "sam", text: C.errorTask.opener }] },
    feedback: null,
    control: { idx: 0, times: C.control.prompts.map(() => ({ start: null, end: null })) },
    counters: { tabHidden: 0, pasteBlocked: 0, apiErrors: 0 }
  };
}

// ------------------------------------------------------------------
// Logging: events are queued in localStorage and sent to the Worker,
// which forwards them to the Google Sheet. Nothing is lost if offline.
// ------------------------------------------------------------------
const QKEY = "mtb_log_queue";
let flushing = false;
function queue() { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch (e) { return []; } }
function setQueue(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} }
async function flushLog() {
  if (flushing) return;
  const q = queue();
  if (!q.length) return;
  flushing = true;
  const batch = q.slice(0, 50);
  let sent = false;
  try {
    const r = await fetch(WORKER + "/log", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ code: batch[0].code, events: batch.map(({ code, ...e }) => e) })
    });
    if (r.ok) sent = true;
    if (r.ok) setQueue(queue().slice(batch.length));
  } catch (e) { /* retried on the next event or by the 15 s timer */ }
  flushing = false;
  if (sent && queue().length) flushLog();   // events queued while we were sending
}
setInterval(flushLog, 15000);

function makeLogger(s) {
  return (type, data = {}) => {
    const ev = {
      ts: new Date().toISOString(), code: s.code, pid: s.pid, group: s.group, sid: s.sid,
      type, phase: s.phase, ...data
    };
    setQueue([...queue(), ev]);
    flushLog();
  };
}

// Session summary: one row per participant in the "sessions" sheet.
function buildSummary(s) {
  const sec = (a, b) => (a && b ? Math.round((b - a) / 1000) : "");
  const row = {
    pid: s.pid, group: s.group, sid: s.sid, version: s.v,
    started: new Date(s.startedAt).toISOString(),
    phase_now: s.phase,
    material_sec: sec(s.phaseStarts.material, s.phaseStarts[s.group === "ai" ? "teach" : "c_teach"]),
    tab_hidden: s.counters.tabHidden, paste_blocked: s.counters.pasteBlocked, api_errors: s.counters.apiErrors
  };
  if (s.group === "ai") {
    s.topics.forEach((t) => {
      row[`${t.id}_hints`] = t.hints;
      row[`${t.id}_turns`] = t.turns;
      row[`${t.id}_outcome`] = t.outcome || "";
      row[`${t.id}_covered`] = t.covered.join(" ");
      row[`${t.id}_sec`] = sec(t.start, t.end);
    });
    row.ERR_hints = s.err.hints; row.ERR_turns = s.err.turns; row.ERR_outcome = s.err.outcome || "";
    row.ERR_found = s.err.found.join(" "); row.ERR_sec = sec(s.err.start, s.err.end);
    row.total_hints = s.topics.reduce((a, t) => a + t.hints, 0) + s.err.hints;
  } else {
    s.control.times.forEach((t, i) => { row[`C${i + 1}_sec`] = sec(t.start, t.end); });
    row.ERR_read_sec = sec(s.phaseStarts.c_error, s.phaseStarts.summary);
  }
  row.finished = s.phase === "done" ? new Date(s.phaseStarts.done).toISOString() : "";
  row.total_min = s.phaseStarts.done ? Math.round((s.phaseStarts.done - s.startedAt) / 600) / 100 : "";
  return row;
}

// ------------------------------------------------------------------
// Model calls via the Worker
// ------------------------------------------------------------------
function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}
async function callModel(s, system, history, schema, temperature = 0.4) {
  // Gemini expects the conversation to start with a user turn.
  const messages = [{ role: "user", text: "(The session starts. Sam speaks first.)" }]
    .concat(history.map((m) => ({ role: m.role === "sam" ? "model" : "user", text: m.text })));
  const t0 = now();
  const r = await fetch(WORKER + "/chat", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ code: s.code, sid: s.sid, pid: s.pid, system, messages, schema, temperature })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return { data: j.data, latency: now() - t0, model: j.model };
}

// ==================================================================
// UI building blocks
// ==================================================================
function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 ${className}`}>{children}</div>;
}
function Btn({ children, onClick, disabled, kind = "primary", className = "" }) {
  const k = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white",
    green: "bg-emerald-600 hover:bg-emerald-700 text-white",
    ghost: "bg-slate-100 hover:bg-slate-200 text-slate-700"
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${k} font-semibold py-3 px-6 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed ${className}`}>
      {children}
    </button>
  );
}
function Page({ children, wide }) {
  return <div className={`${wide ? "max-w-5xl" : "max-w-2xl"} mx-auto px-4 py-8 sm:py-12 fade-in`}>{children}</div>;
}
function Pre({ children, mono }) {
  return <div className={`whitespace-pre-wrap text-sm leading-relaxed text-slate-700 ${mono ? "font-mono text-[13px]" : ""}`}>{children}</div>;
}
function ProblemCard({ title, text, extra, extraTitle }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800">
        <span>{open ? "▾" : "▸"}</span>{title}
      </button>
      {open && (
        <div className="mt-2 max-h-[38vh] overflow-y-auto pr-2">
          <Pre>{text}</Pre>
          {extra && (
            <div className="mt-3 bg-white/70 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-bold text-amber-800 mb-1">{extraTitle}</p>
              <Pre mono>{extra}</Pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Summary() {
  return (
    <Card className="p-6 sm:p-8">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Summary of the material</h2>
      <div className="space-y-4">
        {C.summary.map((x) => (
          <div key={x.h}>
            <h3 className="font-semibold text-indigo-800">{x.h}</h3>
            <p className="text-slate-700 leading-relaxed">{x.p}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ==================================================================
// Screens
// ==================================================================
function ConsentScreen({ s, go, log }) {
  const [ok, setOk] = useState(false);
  const [pre, setPre] = useState(!window.CONFIG.PRETEST_URL);
  return (
    <Page>
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Welcome</h1>
        <div className="space-y-3 text-slate-700 leading-relaxed">
          <p>This study is part of a course project on <b>learning by teaching</b> (Digital Education, CS-411). It takes about 30 to 60 minutes.</p>
          <p>Your participant ID is <b className="font-mono">{s.pid}</b>. We store your answers and the time you spend on each part under this ID only; no name or e-mail is collected in this app.</p>
          {s.group === "ai" && (
            <p>You will chat with an AI peer. Your messages are sent to an AI language model (run on Cloudflare Workers AI) to generate the replies. Please do not type personal information into the chat.</p>
          )}
          <p>Participation is voluntary and you can stop at any time. Contact: {window.CONFIG.CONTACT}.</p>
        </div>
        {window.CONFIG.PRETEST_URL && (
          <div className="mt-6 p-4 bg-indigo-50 rounded-xl">
            <p className="text-sm text-slate-700 mb-2">Before you start, please complete the short pre-test (use your ID <b className="font-mono">{s.pid}</b>).</p>
            <a href={window.CONFIG.PRETEST_URL} target="_blank" rel="noopener" className="text-indigo-700 underline font-semibold">Open the pre-test</a>
            <label className="flex items-center gap-2 mt-3 text-sm"><input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} /> I have submitted the pre-test.</label>
          </div>
        )}
        <label className="flex items-start gap-2 mt-6 text-slate-700">
          <input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>I am 18 or older, I have read the information above and I agree to take part.</span>
        </label>
        <div className="mt-6"><Btn disabled={!ok || !pre} onClick={() => { log("consent", { pretest_confirmed: pre }); go("intro"); }}>Continue</Btn></div>
      </Card>
    </Page>
  );
}

function IntroScreen({ s, go }) {
  const ai = s.group === "ai";
  return (
    <Page>
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Learn it so you can teach it</h1>
        <div className="space-y-3 text-slate-700 leading-relaxed">
          <p>You will first study a short text on <b>Markov chains</b>. Study it with one goal in mind: <b>afterwards you will have to teach it</b>.</p>
          <p>{ai
            ? <>You will explain it to <b>Sam</b>, a fellow student who missed the lecture. Sam will ask questions and try things out on an example.</>
            : <>You will explain it out loud, as if to a fellow student who missed the lecture, while your camera records.</>}</p>
          <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg"><b>Important:</b> once you press "I'm ready to teach", the material is closed and you <b>cannot open it again</b>. Please do not use other websites, notes or AI tools during the study. Paper and pen for calculations are fine.</p>
        </div>
        <div className="mt-6"><Btn onClick={() => go("material")}>Open the material</Btn></div>
      </Card>
    </Page>
  );
}

function MaterialScreen({ s, go }) {
  const [confirm, setConfirm] = useState(false);
  const next = s.group === "ai" ? "teach" : "c_teach";
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 fade-in">
      <div className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur py-3 mb-4 flex justify-between items-center gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Learning material</h1>
        <Btn kind="green" onClick={() => setConfirm(true)}>I'm ready to teach</Btn>
      </div>
      <Card className="p-3 sm:p-6">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <img key={n} src={`material/page-${n}.png`} alt={`10.1: Introduction to Markov Chains, page ${n} of 7`} className="block w-full h-auto" />
        ))}
        <p className="text-xs text-slate-500 mt-6 pt-4 border-t">
          Source: <a className="text-indigo-600 underline" target="_blank" rel="noopener noreferrer" href="https://math.libretexts.org/Bookshelves/Applied_Mathematics/Applied_Finite_Mathematics_(Sekhon_and_Bloom)/10%3A_Markov_Chains/10.01%3A_Introduction_to_Markov_Chains">10.1: Introduction to Markov Chains</a> by Rupinder Sekhon and Roberta Bloom, LibreTexts, <a className="text-indigo-600 underline" target="_blank" rel="noopener noreferrer" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Content unchanged; page header and footer removed.
        </p>
      </Card>
      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
          <Card className="p-6 max-w-md">
            <h2 className="text-lg font-bold mb-2">Close the material?</h2>
            <p className="text-slate-700 mb-5">You will not be able to see the material again. Start teaching now?</p>
            <div className="flex gap-3 justify-end">
              <Btn kind="ghost" onClick={() => setConfirm(false)}>Keep studying</Btn>
              <Btn kind="green" onClick={() => go(next)}>Start teaching</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Chat (AI group): used for Topics 1-3 and for the error task
// ------------------------------------------------------------------
function Steps({ s }) {
  const items = [
    ...C.topics.map((t, i) => ({ label: t.title, done: !!s.topics[i].outcome, active: s.phase === "teach" && s.topicIdx === i })),
    { label: "Check Sam's solution", done: !!s.err.outcome, active: s.phase === "error" },
    { label: "Feedback", done: s.phase === "done", active: s.phase === "feedback" }
  ];
  return (
    <ol className="space-y-2">
      {items.map((x, i) => (
        <li key={i} className={`flex items-center gap-3 p-3 rounded-xl border text-sm ${x.active ? "bg-indigo-50 border-indigo-200 font-semibold text-indigo-900" : x.done ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-white border-slate-200 text-slate-500"}`}>
          <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${x.done ? "bg-emerald-500 text-white" : x.active ? "bg-indigo-600 text-white" : "bg-slate-200"}`}>{x.done ? "✓" : i + 1}</span>
          {x.label}
        </li>
      ))}
    </ol>
  );
}

function ChatScreen({ s, update, log, go }) {
  const isErr = s.phase === "error";
  const part = isErr ? s.err : s.topics[s.topicIdx];
  const topic = isErr ? null : C.topics[s.topicIdx];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const endRef = useRef(null);
  const finished = !!part.outcome;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" }); }, [part.messages.length, busy]);
  useEffect(() => {
    if (!part.start) {
      update((d) => { const p = isErr ? d.err : d.topics[d.topicIdx]; p.start = now(); });
      log("part_start", { part: isErr ? "ERR" : topic.id });
    }
  }, [s.phase, s.topicIdx]);

  const R = C.rules;
  async function send() {
    const msg = text.trim();
    if (!msg || busy || finished) return;
    setText(""); setError(null); setBusy(true);
    const partId = isErr ? "ERR" : topic.id;
    const history = [...part.messages, { role: "student", text: msg }];
    const turns = part.turns + 1;
    const exhausted = part.hints >= R.hintBudget || turns >= R.maxTurnsPerPart;
    const budgetRule = exhausted
      ? "The hint budget is USED UP. If anything is still missing or wrong after this message, your move MUST be REVEAL (no more hints). If everything is covered now, use RECAP."
      : "REVEAL is NOT allowed yet. Use PROBE, HINT, or RECAP (if everything is covered).";
    update((d) => { const p = isErr ? d.err : d.topics[d.topicIdx]; p.messages.push({ role: "student", text: msg, ts: now() }); });
    log("message", { part: partId, role: "student", text: msg, turn: turns });

    let system, schema;
    if (isErr) {
      system = fill(C.prompts.error, {
        problem: C.errorTask.problem, faulty: C.errorTask.faultySolution,
        mistakes: C.errorTask.mistakes.map((m) => `${m.id}: ${m.text}`).join("\n"),
        correct: C.errorTask.correctSolution,
        found: part.found.length ? part.found.join(", ") : "none",
        hints: part.hints, budgetRule
      });
      schema = C.schemas.error;
    } else {
      system = fill(C.prompts.teach, {
        topicTitle: topic.title, topicTask: topic.task,
        rubric: topic.rubric.map((r) => `${r.id}: ${r.text}`).join("\n"),
        reference: topic.reference, problem: C.catProblem.text, solution: C.catProblem.solution,
        covered: part.covered.length ? part.covered.join(", ") : "none",
        hints: part.hints, budgetRule
      });
      schema = C.schemas.teach;
    }

    try {
      const { data, latency, model } = await callModel(s, system, history, schema);
      let move = ["probe", "hint", "recap", "reveal"].includes(data.move) ? data.move : "probe";
      let reply = String(data.message || "").trim() || "Hmm, could you say that again in other words?";
      let flag = "";
      // Code-side enforcement of the hint budget (documentation 6.1).
      if (exhausted && move === "hint") {
        move = "reveal"; flag = "forced_reveal";
        reply += "\n\nOkay, I think I need to look at it differently. " + (isErr ? C.errorTask.correctSolution : topic.reference);
      }
      if (!exhausted && move === "reveal") flag = "early_reveal";
      const validIds = isErr ? C.errorTask.mistakes.map((m) => m.id) : topic.rubric.map((r) => r.id);
      const claimed = ((isErr ? data.found_mistakes : data.covered_items) || []).filter((x) => validIds.includes(x));
      const done = move === "recap" || move === "reveal";

      update((d) => {
        const p = isErr ? d.err : d.topics[d.topicIdx];
        p.turns = turns;
        if (move === "hint") p.hints += 1;
        const key = isErr ? "found" : "covered";
        p[key] = Array.from(new Set([...p[key], ...claimed])).sort();
        p.misconceptions.push(...(data.misconceptions || []));
        if (isErr && data.verdict_given && data.verdict_given !== "none") p.verdict = data.verdict_given;
        p.messages.push({ role: "sam", text: reply, move, ts: now() });
        if (done) { p.outcome = move; p.end = now(); }
      });
      log("message", {
        part: partId, role: "sam", text: reply, turn: turns, move,
        assessment: data.assessment || data.verdict_given || "",
        hint_count: part.hints + (move === "hint" ? 1 : 0),
        covered: claimed.join(" "), misconceptions: (data.misconceptions || []).join(" | "),
        latency_ms: latency, model, flag
      });
      if (done) log("part_end", { part: partId, outcome: move });
    } catch (e) {
      // Roll back the student's message so the turn can be retried.
      update((d) => { const p = isErr ? d.err : d.topics[d.topicIdx]; p.messages.pop(); d.counters.apiErrors += 1; });
      setText(msg);
      setError("Sam couldn't answer (connection problem). Please press Send again.");
      log("api_error", { part: partId, error: String(e.message || e) });
    }
    setBusy(false);
  }

  function next() {
    if (isErr) go("feedback");
    else if (s.topicIdx < C.topics.length - 1) update((d) => { d.topicIdx += 1; });
    else go("error");
  }

  function onPaste(e) {
    e.preventDefault();
    update((d) => { d.counters.pasteBlocked += 1; });
    log("paste_blocked", { part: isErr ? "ERR" : topic.id });
    setToast("Pasting is disabled. Please explain in your own words.");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row overflow-hidden fade-in">
      <aside className="hidden md:flex md:w-72 lg:w-80 shrink-0 flex-col bg-white border-r border-slate-200 p-5 gap-5 overflow-y-auto">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Your teaching session</p>
          <Steps s={s} />
        </div>
        <div className="mt-auto text-xs text-slate-500 leading-relaxed">
          Explain in your own words, as if to a friend. Sam only knows what you teach. Short, step-by-step messages work best.
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-0 min-w-0 bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-xl">🧑‍🎓</div>
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800 leading-tight">Sam <span className="font-normal text-slate-500 text-sm">· your AI peer</span></h2>
            <p className="text-xs text-slate-500 truncate">{isErr ? "Check Sam's solution: true or false? Fix the mistakes." : `Part ${s.topicIdx + 1} of 3: ${topic.task}`}</p>
          </div>
          <span className="ml-auto md:hidden text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">{isErr ? "4/5" : `${s.topicIdx + 1}/5`}</span>
        </header>

        {isErr
          ? <ProblemCard title={C.errorTask.title} text={C.errorTask.problem} extra={C.errorTask.faultySolution} extraTitle="Sam's solution" />
          : <ProblemCard title={C.catProblem.title} text={C.catProblem.text} />}

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {part.messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === "sam" ? "items-start" : "items-end"}`}>
              <span className="text-[11px] font-semibold text-slate-400 mb-1 px-1">{m.role === "sam" ? "Sam" : "You"}</span>
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm whitespace-pre-wrap leading-relaxed ${m.role === "sam" ? "bg-white border border-slate-200 text-slate-800" : "bg-indigo-600 text-white"}`}>{m.text}</div>
            </div>
          ))}
          {busy && <div className="text-sm text-slate-400 px-1 animate-pulse">Sam is thinking…</div>}
          <div ref={endRef} />
        </div>

        <footer className="bg-white border-t border-slate-200 p-3 sm:p-4">
          {error && <p className="text-sm text-rose-600 mb-2">{error}</p>}
          {toast && <p className="text-sm text-amber-700 mb-2">{toast}</p>}
          {finished ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">{isErr ? "Done with Sam's solution." : "This part is done."}</p>
              <Btn kind="green" onClick={next}>{isErr ? "See your feedback" : s.topicIdx < C.topics.length - 1 ? "Next part" : "Continue"}</Btn>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <textarea
                value={text} rows={2} disabled={busy}
                onChange={(e) => setText(e.target.value)}
                onPaste={onPaste} onDrop={(e) => e.preventDefault()}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Explain to Sam… (Enter to send, Shift+Enter for a new line)"
                className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-100"
              />
              <Btn onClick={send} disabled={busy || !text.trim()} className="py-3">Send</Btn>
            </div>
          )}
        </footer>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------
// Feedback (AI group, documentation 6.1.3)
// ------------------------------------------------------------------
function FeedbackScreen({ s, update, log, go }) {
  const [state, setState] = useState(s.feedback ? "ok" : "loading");
  const tried = useRef(false);

  const load = useCallback(async () => {
    setState("loading");
    const parts = [
      ...s.topics.map((t, i) => ({ name: `${t.id} ${C.topics[i].title}`, p: t })),
      { name: "ERR Checking Sam's faulty solution", p: s.err }
    ];
    const stats = parts.map(({ name, p }) => `${name}: hints=${p.hints}, messages=${p.turns}, outcome=${p.outcome || "unfinished"}`).join("\n");
    const transcripts = parts.map(({ name, p }) =>
      `### ${name}\n` + p.messages.map((m) => `${m.role === "sam" ? "Sam" : "Student"}: ${m.text}`).join("\n")
    ).join("\n\n").slice(-24000);
    try {
      const { data, latency } = await callModel(s, fill(C.prompts.feedback, { stats, transcripts }),
        [{ role: "student", text: "Please write my feedback report." }], C.schemas.feedback, 0.3);
      const fb = {
        strengths: (data.strengths || []).slice(0, 3),
        weaknesses: (data.weaknesses || []).slice(0, 3),
        focus: (data.focus || []).slice(0, 2)
      };
      update((d) => { d.feedback = fb; });
      log("feedback", { text: JSON.stringify(fb), latency_ms: latency });
      setState("ok");
    } catch (e) {
      update((d) => { d.counters.apiErrors += 1; });
      log("api_error", { part: "FEEDBACK", error: String(e.message || e) });
      setState("error");
    }
  }, [s]);

  useEffect(() => { if (!s.feedback && !tried.current) { tried.current = true; load(); } }, []);
  const fb = s.feedback;
  return (
    <Page wide>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-6">Your feedback</h1>
      {state === "loading" && <Card className="p-8 text-slate-500 animate-pulse">Writing your feedback report…</Card>}
      {state === "error" && (
        <Card className="p-6">
          <p className="text-slate-700 mb-4">The feedback report could not be generated. Please try again; if it keeps failing, continue to the summary.</p>
          <div className="flex gap-3"><Btn onClick={load}>Try again</Btn><Btn kind="ghost" onClick={() => setState("skip")}>Continue without report</Btn></div>
        </Card>
      )}
      {state === "ok" && fb && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Card className="p-6">
            <h2 className="font-bold text-emerald-700 mb-3">What went well</h2>
            <ul className="space-y-3 text-slate-700 leading-relaxed list-disc pl-5">{fb.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </Card>
          <Card className="p-6">
            <h2 className="font-bold text-amber-700 mb-3">What to work on</h2>
            <ul className="space-y-3 text-slate-700 leading-relaxed list-disc pl-5">{fb.weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </Card>
          {fb.focus.length > 0 && (
            <Card className="p-6 md:col-span-2 bg-indigo-50/50">
              <h2 className="font-bold text-indigo-800 mb-3">A closer look at what was tricky for you</h2>
              <div className="space-y-3 text-slate-700 leading-relaxed">{fb.focus.map((x, i) => <p key={i}>{x}</p>)}</div>
            </Card>
          )}
        </div>
      )}
      {(state === "ok" || state === "skip") && (
        <>
          <Summary />
          <div className="mt-6 flex justify-end"><Btn kind="green" onClick={() => go("done")}>Finish</Btn></div>
        </>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------
// Control group (documentation 6.2)
// ------------------------------------------------------------------
function ControlTeachScreen({ s, update, log, go }) {
  const i = s.control.idx;
  const t = s.control.times[i];
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(h); }, []);
  const elapsed = t.start ? Math.floor((now() - t.start) / 1000) : 0;
  const min = C.control.minSecondsPerPrompt;
  const mmss = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`;

  function start() {
    update((d) => { d.control.times[i].start = now(); });
    log("control_prompt_start", { part: `C${i + 1}` });
  }
  function done() {
    update((d) => { d.control.times[i].end = now(); });
    log("control_prompt_end", { part: `C${i + 1}`, seconds: elapsed });
    if (i < C.control.prompts.length - 1) update((d) => { d.control.idx += 1; });
    else go("c_error");
  }
  return (
    <Page wide>
      <p className="text-sm font-semibold text-indigo-700 mb-2">Part {i + 1} of {C.control.prompts.length}</p>
      {i === 0 && !t.start && <Card className="p-5 mb-4 bg-indigo-50/60 text-slate-700 leading-relaxed">{C.control.intro}</Card>}
      <Card className="p-6 sm:p-8 mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 leading-snug">{C.control.prompts[i]}</h1>
      </Card>
      <Card className="mb-6 overflow-hidden"><ProblemCard title={C.catProblem.title} text={C.catProblem.text} /></Card>
      <div className="flex items-center justify-between gap-4">
        <div className="text-3xl font-mono text-slate-700 tabular-nums">{mmss(elapsed)}</div>
        {!t.start
          ? <Btn onClick={start}>Start explaining</Btn>
          : <Btn kind="green" disabled={elapsed < min} onClick={done}>{elapsed < min ? `Keep explaining (${min - elapsed}s)` : "I'm done with this part"}</Btn>}
      </div>
    </Page>
  );
}

function ControlErrorScreen({ s, go }) {
  const E = C.errorTask;
  return (
    <Page wide>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Worked example with mistakes</h1>
      <p className="text-slate-600 mb-6">{C.control.errorIntro}</p>
      <div className="space-y-4">
        <Card className="p-6"><h2 className="font-bold text-slate-800 mb-2">Problem</h2><Pre>{E.problem}</Pre></Card>
        <Card className="p-6"><h2 className="font-bold text-slate-800 mb-2">A student's (faulty) solution</h2><Pre mono>{E.faultySolution}</Pre></Card>
        <Card className="p-6 bg-rose-50/50">
          <h2 className="font-bold text-rose-800 mb-2">The two mistakes</h2>
          <ol className="list-decimal pl-5 space-y-2 text-slate-700">{E.mistakes.map((m) => <li key={m.id}>{m.text}</li>)}</ol>
        </Card>
        <Card className="p-6 bg-emerald-50/50"><h2 className="font-bold text-emerald-800 mb-2">Correct solution</h2><Pre mono>{E.correctSolution}</Pre></Card>
      </div>
      <div className="mt-6 flex justify-end"><Btn kind="green" onClick={() => go("summary")}>Continue</Btn></div>
    </Page>
  );
}

function SummaryScreen({ go }) {
  return (
    <Page wide>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-6">Review</h1>
      <Summary />
      <div className="mt-6 flex justify-end"><Btn kind="green" onClick={() => go("done")}>Finish</Btn></div>
    </Page>
  );
}

function DoneScreen({ s }) {
  function download() {
    const blob = new Blob([JSON.stringify({ summary: buildSummary(s), state: s }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `session_${s.pid}.json`; a.click();
  }
  return (
    <Page>
      <Card className="p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-3">Thank you!</h1>
        <p className="text-slate-700 mb-6">You have finished the learning part. {window.CONFIG.POSTTEST_URL ? "Please complete the final test now, without notes." : "Please continue with the final test as instructed."}</p>
        {window.CONFIG.POSTTEST_URL && (
          <a href={window.CONFIG.POSTTEST_URL} target="_blank" rel="noopener" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-xl">Open the final test</a>
        )}
        <p className="text-sm text-slate-500 mt-6">Your participant ID: <b className="font-mono">{s.pid}</b></p>
        <button onClick={download} className="text-xs text-slate-400 underline mt-8">Download session data (for researchers)</button>
      </Card>
    </Page>
  );
}

// ------------------------------------------------------------------
// Link generator for experimenters: ?admin=1
// ------------------------------------------------------------------
function AdminScreen() {
  const [code, setCode] = useState("");
  const [rows, setRows] = useState("P01,ai\nP02,control");
  const base = location.origin + location.pathname;
  const links = rows.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((r) => r[0] && ["ai", "control"].includes(r[1]))
    .map(([pid, g]) => `${pid}\t${g}\t${base}?pid=${encodeURIComponent(pid)}&g=${g}&code=${encodeURIComponent(code)}`);
  return (
    <Page wide>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Participant links</h1>
      <Card className="p-6 space-y-4">
        <label className="block text-sm font-semibold text-slate-700">Study access code (the STUDY_CODE secret of your Worker)
          <input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block text-sm font-semibold text-slate-700">One participant per line: ID,group (group = ai or control)
          <textarea value={rows} onChange={(e) => setRows(e.target.value)} rows={8} className="mt-1 w-full border rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block text-sm font-semibold text-slate-700">Links (copy into your spreadsheet or e-mails)
          <textarea readOnly value={links.join("\n")} rows={8} className="mt-1 w-full border rounded-lg px-3 py-2 font-mono text-xs bg-slate-50" /></label>
        <p className="text-xs text-slate-500">Add <span className="font-mono">&amp;reset=1</span> to a link to wipe that participant's progress on the current browser (for pilots).</p>
      </Card>
    </Page>
  );
}

// ==================================================================
// App: routing between phases
// ==================================================================
function App() {
  if (params.get("admin")) return <AdminScreen />;
  const pid = (params.get("pid") || "").trim();
  const group = params.get("g");
  const code = params.get("code") || "";
  if (!pid || !["ai", "control"].includes(group) || !code) {
    return (
      <Page>
        <Card className="p-8">
          <h1 className="text-xl font-bold mb-2">Invalid link</h1>
          <p className="text-slate-700">Please open the personal link you received from the study team.</p>
        </Card>
      </Page>
    );
  }
  return <Study pid={pid} group={group} code={code} />;
}

function Study({ pid, group, code }) {
  const [s, setS] = useState(() => {
    if (params.get("reset")) {
      localStorage.removeItem(storeKey(pid));
      window.history.replaceState(null, "", location.href.replace(/&reset=1/, ""));
    }
    const old = loadState(pid);
    return old && old.group === group ? old : freshState(pid, group, code);
  });
  const sRef = useRef(s); sRef.current = s;
  const log = useCallback((type, data) => makeLogger(sRef.current)(type, data), []);

  const update = useCallback((fn) => {
    setS((prev) => {
      const d = JSON.parse(JSON.stringify(prev));
      fn(d);
      saveState(d);
      return d;
    });
  }, []);

  const go = useCallback((phase) => {
    update((d) => { d.phase = phase; d.phaseStarts[phase] = now(); });
    window.scrollTo(0, 0);
  }, [update]);

  // Log every phase change, and refresh the session summary row whenever
  // a phase or a part changes (the Apps Script upserts it by sid).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    log("phase", { to: s.phase });
  }, [s.phase]);
  useEffect(() => {
    log("summary", { summary: JSON.stringify(buildSummary(s)) });
  }, [s.phase, s.topicIdx, s.err.outcome, s.control.idx, s.topics.map((t) => t.outcome).join()]);

  useEffect(() => {
    saveState(s);
    if (s.phase === "consent" && !s.logged) { update((d) => { d.logged = true; }); log("session_start", { ua: navigator.userAgent }); }
    const onVis = () => {
      if (document.visibilityState === "hidden" && !["consent", "intro", "material", "done"].includes(sRef.current.phase)) {
        update((d) => { d.counters.tabHidden += 1; });
        log("tab_hidden", {});
        flushLog();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const props = { s, update, log, go };
  const screen = {
    consent: <ConsentScreen {...props} />,
    intro: <IntroScreen {...props} />,
    material: <MaterialScreen {...props} />,
    teach: <ChatScreen key={"t" + s.topicIdx} {...props} />,
    error: <ChatScreen key="err" {...props} />,
    feedback: <FeedbackScreen {...props} />,
    c_teach: <ControlTeachScreen key={"c" + s.control.idx} {...props} />,
    c_error: <ControlErrorScreen {...props} />,
    summary: <SummaryScreen {...props} />,
    done: <DoneScreen {...props} />
  }[s.phase];

  return (
    <div className="min-h-[100dvh] bg-slate-100 text-slate-900">
      {/YOUR-SUBDOMAIN/.test(WORKER) && (
        <div className="bg-rose-600 text-white text-center text-xs py-1">Setup incomplete: set WORKER_URL in config.js (see SETUP.md)</div>
      )}
      {screen}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
