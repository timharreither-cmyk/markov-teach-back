// =====================================================================
// app.jsx: study flow for "Learning by Teaching: Markov Chains".
//
//   Both groups: consent → intro → material (max 10 min)
//     → steps 1-3 with the Miso example (max 15 min)
//     → step 4: check wrong statements (max 10 min)
//   AI group:      steps 1-4 are chats with Sam, then a feedback report + summary
//   Control group: steps 1-3 written alone (textbook hint button),
//                  step 4 as cards with hint button and solution, then the summary
//
// The flow, the time limits and the hint rules live HERE, not in the model.
// The model only assesses each message and writes Sam's reply (content.js).
// =====================================================================

const { useState, useEffect, useRef, useCallback } = React;
const C = window.STUDY;
const params = new URLSearchParams(location.search);
const WORKER = (params.get("api") || window.CONFIG.WORKER_URL).replace(/\/$/, "");
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36);
const NS = C.statements.length;

// Time limits per phase (seconds); the same for both groups.
const LIMIT = {
  material: C.timing.material * 60,
  teach: C.timing.example * 60, c_teach: C.timing.example * 60,
  error: C.timing.error * 60, c_error: C.timing.error * 60
};
const NEXT_ON_TIMEOUT = { material: null, teach: "error", c_teach: "c_error", error: "feedback", c_error: "summary" };
const TIMEOUT_NOTICE = {
  material: "The time for the material is up. Let's start teaching.",
  teach: "The time for the example is up. Let's continue with the next part.",
  c_teach: "The time for the example is up. Let's continue with the next part.",
  error: "The time for checking the statements is up.",
  c_error: "The time for checking the statements is up."
};
const stmtText = (i) => `${i + 1}/${NS}: ${C.statements[i].text} Is that right?`;

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
    phase: "consent", phaseStarts: { consent: now() }, notice: null,
    topicIdx: 0,
    topics: C.topics.map((t) => ({
      id: t.id, covered: [], hints: 0, turns: 0, outcome: null, start: null, end: null,
      misconceptions: [], messages: [{ role: "sam", text: t.opener }]
    })),
    err: {
      idx: 0, done: false,
      messages: [{ role: "sam", text: C.statementsIntro }, { role: "sam", text: stmtText(0), stmt: 0 }],
      items: C.statements.map((st, i) => ({
        id: st.id, hints: 0, turns: 0, outcome: null, verdict: "none", corrected: false,
        start: null, end: null, misconceptions: [], msgStart: i === 0 ? 1 : null
      }))
    },
    ctl: {
      idx: 0,
      items: C.topics.map((t) => ({ id: t.id, text: "", hints: 0, start: null, end: null, outcome: null })),
      eidx: 0,
      eitems: C.statements.map((st) => ({ id: st.id, text: "", hints: 0, submitted: false, start: null, end: null, outcome: null }))
    },
    feedback: null,
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
    if (r.ok) { sent = true; setQueue(queue().slice(batch.length)); }
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
// Hint counts use the same column names in both groups (Sam's hints vs.
// textbook hints), so the two conditions can be compared directly.
function buildSummary(s) {
  const sec = (a, b) => (a && b ? Math.round((b - a) / 1000) : "");
  const ai = s.group === "ai";
  const P = s.phaseStarts;
  const row = {
    pid: s.pid, group: s.group, sid: s.sid, version: s.v,
    started: new Date(s.startedAt).toISOString(),
    phase_now: s.phase,
    material_sec: sec(P.material, P[ai ? "teach" : "c_teach"]),
    example_sec: sec(P[ai ? "teach" : "c_teach"], P[ai ? "error" : "c_error"]),
    error_sec: sec(P[ai ? "error" : "c_error"], P[ai ? "feedback" : "summary"]),
    tab_hidden: s.counters.tabHidden, paste_blocked: s.counters.pasteBlocked, api_errors: s.counters.apiErrors
  };
  let total = 0;
  C.topics.forEach((t, i) => {
    const p = ai ? s.topics[i] : s.ctl.items[i];
    row[`${t.id}_hints`] = p.hints; total += p.hints;
    row[`${t.id}_outcome`] = p.outcome || "";
    row[`${t.id}_sec`] = sec(p.start, p.end);
    if (ai) { row[`${t.id}_turns`] = p.turns; row[`${t.id}_covered`] = p.covered.join(" "); }
    else row[`${t.id}_chars`] = p.text.trim().length;
  });
  C.statements.forEach((st, i) => {
    const p = ai ? s.err.items[i] : s.ctl.eitems[i];
    row[`${st.id}_hints`] = p.hints; total += p.hints;
    row[`${st.id}_outcome`] = p.outcome || "";
    row[`${st.id}_sec`] = sec(p.start, p.end);
    if (ai) { row[`${st.id}_turns`] = p.turns; row[`${st.id}_verdict`] = p.verdict; }
    else row[`${st.id}_chars`] = p.text.trim().length;
  });
  row.total_hints = total;
  row.finished = s.phase === "done" ? new Date(P.done).toISOString() : "";
  row.total_min = P.done ? Math.round((P.done - s.startedAt) / 600) / 100 : "";
  return row;
}

// ------------------------------------------------------------------
// Model calls via the Worker
// ------------------------------------------------------------------
function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}
async function callModel(s, system, history, schema, temperature = 0.4) {
  // The conversation must start with a user turn.
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
const MOVES = ["probe", "hint", "recap", "reveal"];

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
    amber: "bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300",
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
function ProblemCard({ title, text }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800">
        <span>{open ? "▾" : "▸"}</span>{title}
      </button>
      {open && <div className="mt-2 max-h-[34vh] overflow-y-auto pr-2"><Pre>{text}</Pre></div>}
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
function secondsLeft(s) {
  const lim = LIMIT[s.phase];
  if (!lim || !s.phaseStarts[s.phase]) return null;
  return Math.max(0, Math.ceil((s.phaseStarts[s.phase] + lim * 1000 - now()) / 1000));
}
function TimeLeft({ s, label = "Time left" }) {
  const left = secondsLeft(s);
  if (left === null) return null;
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums px-3 py-1.5 rounded-full ${left <= 60 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
      ⏱ <span className="hidden sm:inline font-normal">{label}</span> {mm}
    </span>
  );
}
function Notice({ s, update }) {
  if (!s.notice) return null;
  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-sm px-4 py-2 flex items-center justify-between gap-3">
      <span>{s.notice}</span>
      <button className="font-bold" onClick={() => update((d) => { d.notice = null; })}>✕</button>
    </div>
  );
}
function NoPasteArea({ value, onChange, onPasteBlocked, rows = 6, placeholder, disabled, onKeyDown, className = "" }) {
  return (
    <textarea
      value={value} rows={rows} disabled={disabled} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
      onPaste={(e) => { e.preventDefault(); onPasteBlocked(); }} onDrop={(e) => e.preventDefault()}
      className={`w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-100 ${className}`}
    />
  );
}

// ==================================================================
// Screens shared by both groups
// ==================================================================
function ConsentScreen({ s, go, log }) {
  const [ok, setOk] = useState(false);
  const [pre, setPre] = useState(!window.CONFIG.PRETEST_URL);
  return (
    <Page>
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Welcome</h1>
        <div className="space-y-3 text-slate-700 leading-relaxed">
          <p>This study is part of a course project on <b>learning by teaching</b> (Digital Education, CS-411). The learning part takes at most 35 minutes.</p>
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
  const T = C.timing;
  return (
    <Page>
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Learn it so you can teach it</h1>
        <div className="space-y-3 text-slate-700 leading-relaxed">
          <p>You will first study a short text on <b>Markov chains</b>. Study it with one goal in mind: <b>afterwards you will have to teach it</b>.</p>
          <p>{ai
            ? <>You will explain it to <b>Sam</b>, a fellow student who missed the lecture, using an example. Then Sam will tell you what Sam understood, and you check whether it is right.</>
            : <>You will explain it in writing, as if to a fellow student who missed the lecture, using an example. Then you will check some statements about it.</>}</p>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
            <p className="font-semibold mb-1">Time limits</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Material: up to {T.material} minutes</li>
              <li>Teaching with the example (3 steps): up to {T.example} minutes</li>
              <li>Checking statements: up to {T.error} minutes</li>
            </ul>
            <p className="mt-1 text-slate-500">When a time limit is reached, the study moves on automatically.</p>
          </div>
          <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg"><b>Important:</b> once you press "I'm ready to teach" (or the time is up), the material is closed and you <b>cannot open it again</b>. Please do not use other websites, notes or AI tools during the study. Paper and pen for calculations are fine.</p>
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
      <div className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur py-3 mb-4 flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Learning material</h1>
        <div className="flex items-center gap-3">
          <TimeLeft s={s} />
          <Btn kind="green" onClick={() => setConfirm(true)}>I'm ready to teach</Btn>
        </div>
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

// ==================================================================
// AI group: chat with Sam (steps 1-3 and step 4)
// ==================================================================
function Steps({ s }) {
  const errDone = s.err.items.filter((x) => x.outcome).length;
  const items = [
    ...C.topics.map((t, i) => ({ label: t.title, done: !!s.topics[i].outcome, active: s.phase === "teach" && s.topicIdx === i })),
    { label: `Check Sam's statements (${errDone}/${NS})`, done: s.err.done || ["feedback", "done"].includes(s.phase), active: s.phase === "error" },
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

function ChatLayout({ s, update, subtitle, badge, messages, busy, error, toast, input, setInput, onSend, footerDone }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" }); }, [messages.length, busy]);
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
        <Notice s={s} update={update} />
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 bg-indigo-100 rounded-full flex items-center justify-center text-xl">🧑‍🎓</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-slate-800 leading-tight">Sam <span className="font-normal text-slate-500 text-sm">· your AI peer</span></h2>
            <p className="text-xs text-slate-500 truncate">{subtitle}</p>
          </div>
          <span className="md:hidden text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">{badge}</span>
          <TimeLeft s={s} />
        </header>

        <ProblemCard title={C.catProblem.title} text={C.catProblem.text} />

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === "sam" ? "items-start" : "items-end"}`}>
              <span className="text-[11px] font-semibold text-slate-400 mb-1 px-1">{m.role === "sam" ? "Sam" : "You"}</span>
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm whitespace-pre-wrap leading-relaxed ${m.role === "sam" ? (m.stmt !== undefined ? "bg-amber-50 border border-amber-300 text-slate-800" : "bg-white border border-slate-200 text-slate-800") : "bg-indigo-600 text-white"}`}>{m.text}</div>
            </div>
          ))}
          {busy && <div className="text-sm text-slate-400 px-1 animate-pulse">Sam is thinking…</div>}
          <div ref={endRef} />
        </div>

        <footer className="bg-white border-t border-slate-200 p-3 sm:p-4">
          {error && <p className="text-sm text-rose-600 mb-2">{error}</p>}
          {toast && <p className="text-sm text-amber-700 mb-2">{toast}</p>}
          {footerDone ? footerDone : (
            <div className="flex gap-2 items-end">
              <NoPasteArea
                value={input} rows={2} disabled={busy} onChange={setInput}
                onPasteBlocked={() => input !== null && onSend.pasteBlocked()}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                placeholder="Explain to Sam… (Enter to send, Shift+Enter for a new line)"
                className="flex-1"
              />
              <Btn onClick={onSend} disabled={busy || !input.trim()} className="py-3">Send</Btn>
            </div>
          )}
        </footer>
      </main>
    </div>
  );
}

function useChatHelpers(update, log, partId) {
  const [toast, setToast] = useState(null);
  const pasteBlocked = () => {
    update((d) => { d.counters.pasteBlocked += 1; });
    log("paste_blocked", { part: partId });
    setToast("Pasting is disabled. Please explain in your own words.");
    setTimeout(() => setToast(null), 3000);
  };
  return { toast, pasteBlocked };
}

function budgetRuleFor(hints, turns) {
  const exhausted = hints >= C.rules.hintBudget || turns >= C.rules.maxTurnsPerPart;
  return {
    exhausted,
    text: exhausted
      ? "The hint budget is USED UP. If anything is still missing or wrong after this message, your move MUST be REVEAL (no more hints). If everything is covered now, use RECAP."
      : "REVEAL is NOT allowed yet. Use PROBE, HINT, or RECAP (if everything is covered)."
  };
}

// Steps 1-3: teaching the example
function TeachChat({ s, sRef, update, log, go }) {
  const part = s.topics[s.topicIdx];
  const topic = C.topics[s.topicIdx];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { toast, pasteBlocked } = useChatHelpers(update, log, topic.id);

  useEffect(() => {
    if (!part.start) {
      update((d) => { d.topics[d.topicIdx].start = now(); });
      log("part_start", { part: topic.id });
    }
  }, [s.topicIdx]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy || part.outcome) return;
    setText(""); setError(null); setBusy(true);
    const idx = s.topicIdx;
    const history = [...part.messages, { role: "student", text: msg }];
    const turns = part.turns + 1;
    const budget = budgetRuleFor(part.hints, turns);
    update((d) => { d.topics[idx].messages.push({ role: "student", text: msg, ts: now() }); });
    log("message", { part: topic.id, role: "student", text: msg, turn: turns });

    const system = fill(C.prompts.teach, {
      topicTitle: topic.title, topicTask: topic.task,
      rubric: topic.rubric.map((r) => `${r.id}: ${r.text}`).join("\n"),
      reference: topic.reference, problem: C.catProblem.text, solution: C.catProblem.solution,
      covered: part.covered.length ? part.covered.join(", ") : "none",
      hints: part.hints, budgetRule: budget.text
    });
    try {
      const { data, latency, model } = await callModel(s, system, history, C.schemas.teach);
      if (sRef.current.phase !== "teach" || sRef.current.topicIdx !== idx) return; // time ran out meanwhile
      let move = MOVES.includes(data.move) ? data.move : "probe";
      let reply = String(data.message || "").trim() || "Hmm, could you say that again in other words?";
      let flag = "";
      if (budget.exhausted && move === "hint") {             // enforce the hint budget
        move = "reveal"; flag = "forced_reveal";
        reply += "\n\nOkay, I think I get it differently now. " + topic.reference;
      }
      if (!budget.exhausted && move === "reveal") flag = "early_reveal";
      const ids = topic.rubric.map((r) => r.id);
      const claimed = (data.covered_items || []).filter((x) => ids.includes(x));
      const done = move === "recap" || move === "reveal";
      update((d) => {
        const p = d.topics[idx];
        p.turns = turns;
        if (move === "hint") p.hints += 1;
        p.covered = Array.from(new Set([...p.covered, ...claimed])).sort();
        p.misconceptions.push(...(data.misconceptions || []));
        p.messages.push({ role: "sam", text: reply, move, ts: now() });
        if (done) { p.outcome = move; p.end = now(); }
      });
      log("message", {
        part: topic.id, role: "sam", text: reply, turn: turns, move,
        assessment: data.assessment || "", hint_count: part.hints + (move === "hint" ? 1 : 0),
        covered: claimed.join(" "), misconceptions: (data.misconceptions || []).join(" | "),
        latency_ms: latency, model, flag
      });
      if (done) log("part_end", { part: topic.id, outcome: move });
    } catch (e) {
      update((d) => { d.topics[idx].messages.pop(); d.counters.apiErrors += 1; });
      setText(msg);
      setError("Sam couldn't answer (connection problem). Please press Send again.");
      log("api_error", { part: topic.id, error: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }
  send.pasteBlocked = pasteBlocked;

  const last = s.topicIdx === C.topics.length - 1;
  const footerDone = part.outcome && (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{last ? "All three steps are done." : "This step is done."}</p>
      <Btn kind="green" onClick={() => last ? go("error") : update((d) => { d.topicIdx += 1; })}>
        {last ? "Example done → check Sam's statements" : "Next step"}
      </Btn>
    </div>
  );
  return (
    <ChatLayout s={s} update={update} subtitle={`Step ${s.topicIdx + 1} of 3: ${topic.task}`} badge={`${s.topicIdx + 1}/4`}
      messages={part.messages} busy={busy} error={error} toast={toast}
      input={text} setInput={setText} onSend={send} footerDone={footerDone} />
  );
}

// Step 4: Sam's wrong statements, one after another in one chat
function StatementChat({ s, sRef, update, log, go }) {
  const E = s.err;
  const i = E.idx;
  const item = E.items[i];
  const st = C.statements[i];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { toast, pasteBlocked } = useChatHelpers(update, log, st.id);

  useEffect(() => {
    if (!item.start) {
      update((d) => { d.err.items[d.err.idx].start = now(); });
      log("part_start", { part: st.id });
    }
  }, [i]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy || E.done) return;
    setText(""); setError(null); setBusy(true);
    const history = [...E.messages.slice(item.msgStart), { role: "student", text: msg }];
    const turns = item.turns + 1;
    const budget = budgetRuleFor(item.hints, turns);
    update((d) => { d.err.messages.push({ role: "student", text: msg, ts: now() }); });
    log("message", { part: st.id, role: "student", text: msg, turn: turns });

    const system = fill(C.prompts.statement, {
      problem: C.catProblem.text, solution: C.catProblem.solution,
      statement: st.text, mistake: st.mistake, correction: st.correction,
      hints: item.hints, budgetRule: budget.text
    });
    try {
      const { data, latency, model } = await callModel(s, system, history, C.schemas.statement);
      if (sRef.current.phase !== "error" || sRef.current.err.idx !== i) return;
      let move = MOVES.includes(data.move) ? data.move : "probe";
      let reply = String(data.message || "").trim() || "Hmm, can you explain that a bit more?";
      let flag = "";
      if (budget.exhausted && move === "hint") {
        move = "reveal"; flag = "forced_reveal";
        reply += "\n\nWait, I think I see it now: " + st.mistake;
      }
      if (!budget.exhausted && move === "reveal") flag = "early_reveal";
      const done = move === "recap" || move === "reveal";
      update((d) => {
        const p = d.err.items[i];
        p.turns = turns;
        if (move === "hint") p.hints += 1;
        if (data.verdict_given && data.verdict_given !== "none") p.verdict = data.verdict_given;
        if (data.corrected) p.corrected = true;
        p.misconceptions.push(...(data.misconceptions || []));
        d.err.messages.push({ role: "sam", text: reply, move, ts: now() });
        if (done) {
          p.outcome = move; p.end = now();
          if (i < NS - 1) {
            d.err.messages.push({ role: "sam", text: stmtText(i + 1), stmt: i + 1, ts: now() });
            d.err.idx = i + 1;
            d.err.items[i + 1].msgStart = d.err.messages.length - 1;
            d.err.items[i + 1].start = now();
          } else d.err.done = true;
        }
      });
      log("message", {
        part: st.id, role: "sam", text: reply, turn: turns, move,
        assessment: data.verdict_given || "", hint_count: item.hints + (move === "hint" ? 1 : 0),
        covered: data.corrected ? "corrected" : "", misconceptions: (data.misconceptions || []).join(" | "),
        latency_ms: latency, model, flag
      });
      if (done) log("part_end", { part: st.id, outcome: move });
    } catch (e) {
      update((d) => { d.err.messages.pop(); d.counters.apiErrors += 1; });
      setText(msg);
      setError("Sam couldn't answer (connection problem). Please press Send again.");
      log("api_error", { part: st.id, error: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }
  send.pasteBlocked = pasteBlocked;

  const footerDone = E.done && (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-slate-600">You checked all of Sam's statements.</p>
      <Btn kind="green" onClick={() => go("feedback")}>See your feedback</Btn>
    </div>
  );
  return (
    <ChatLayout s={s} update={update} subtitle={`Step 4: Is Sam right? Statement ${Math.min(i + 1, NS)} of ${NS}. If it's wrong, correct it.`} badge="4/4"
      messages={E.messages} busy={busy} error={error} toast={toast}
      input={text} setInput={setText} onSend={send} footerDone={footerDone} />
  );
}

// Step 5 (AI group): feedback report and summary
function FeedbackScreen({ s, update, log, go }) {
  const [state, setState] = useState(s.feedback ? "ok" : "loading");
  const tried = useRef(false);

  const load = useCallback(async () => {
    setState("loading");
    const stats = [
      ...C.topics.map((t, i) => { const p = s.topics[i]; return `${t.id} ${t.title}: hints=${p.hints}, messages=${p.turns}, outcome=${p.outcome || "unfinished"}`; }),
      ...C.statements.map((st, i) => { const p = s.err.items[i]; return `${st.id} statement on ${st.category}: hints=${p.hints}, messages=${p.turns}, outcome=${p.outcome || "unfinished"}`; })
    ].join("\n");
    const transcripts = [
      ...C.topics.map((t, i) => `### ${t.id} ${t.title}\n` + s.topics[i].messages.map((m) => `${m.role === "sam" ? "Sam" : "Student"}: ${m.text}`).join("\n")),
      "### Step 4: checking Sam's wrong statements\n" + s.err.messages.map((m) => `${m.role === "sam" ? "Sam" : "Student"}: ${m.text}`).join("\n")
    ].join("\n\n").slice(-24000);
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
    <>
      <Notice s={s} update={update} />
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
    </>
  );
}

// ==================================================================
// Control group (no AI): written explanations with textbook hints
// ==================================================================
function HintBox({ hints, used, onMore, label = "Show a hint" }) {
  return (
    <div className="mt-3">
      {used > 0 && (
        <ol className="space-y-2 mb-3">
          {hints.slice(0, used).map((h, k) => (
            <li key={k} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-slate-700"><b className="text-amber-800">Hint {k + 1}:</b> {h}</li>
          ))}
        </ol>
      )}
      <Btn kind="amber" onClick={onMore} disabled={used >= hints.length} className="py-2 px-4 text-sm">
        {used >= hints.length ? "No more hints" : `${label} (${used}/${hints.length} used)`}
      </Btn>
    </div>
  );
}

function ControlTeachScreen({ s, update, log, go }) {
  const i = s.ctl.idx;
  const item = s.ctl.items[i];
  const topic = C.topics[i];
  const [toast, setToast] = useState(null);
  const last = i === C.topics.length - 1;
  const enough = item.text.trim().length >= C.control.minChars;

  useEffect(() => {
    if (!item.start) { update((d) => { d.ctl.items[d.ctl.idx].start = now(); }); log("part_start", { part: topic.id }); }
  }, [i]);

  function hint() {
    update((d) => { d.ctl.items[i].hints += 1; });
    log("hint_shown", { part: topic.id, hint_count: item.hints + 1 });
  }
  function done() {
    update((d) => {
      const p = d.ctl.items[i]; p.end = now(); p.outcome = "done";
      if (!last) d.ctl.idx += 1;
    });
    log("control_answer", { part: topic.id, text: item.text, hint_count: item.hints, extra: JSON.stringify({ chars: item.text.trim().length }) });
    if (last) go("c_error");
    window.scrollTo(0, 0);
  }
  function pasteBlocked() {
    update((d) => { d.counters.pasteBlocked += 1; });
    log("paste_blocked", { part: topic.id });
    setToast("Pasting is disabled. Please explain in your own words.");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      <Notice s={s} update={update} />
      <Page wide>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-indigo-700">Step {i + 1} of 3: {topic.title}</p>
          <TimeLeft s={s} label="Time left for the example" />
        </div>
        {i === 0 && !item.text && <Card className="p-5 mb-4 bg-indigo-50/60 text-slate-700 leading-relaxed">{C.control.intro}</Card>}
        <Card className="mb-4 overflow-hidden"><ProblemCard title={C.catProblem.title} text={C.catProblem.text} /></Card>
        <Card className="p-6">
          <h1 className="text-lg sm:text-xl font-bold text-slate-800 leading-snug mb-4">{topic.task}</h1>
          <NoPasteArea value={item.text} rows={8} onPasteBlocked={pasteBlocked}
            onChange={(v) => update((d) => { d.ctl.items[i].text = v; })}
            placeholder="Write your explanation here, in your own words…" />
          {toast && <p className="text-sm text-amber-700 mt-2">{toast}</p>}
          <HintBox hints={topic.textbookHints} used={item.hints} onMore={hint} />
          <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-4 border-t">
            <p className="text-xs text-slate-500">{enough ? "" : `Please write at least ${C.control.minChars} characters.`}</p>
            <Btn kind="green" disabled={!enough} onClick={done}>{last ? "Answers done: example done" : "Answers done: next step"}</Btn>
          </div>
        </Card>
      </Page>
    </>
  );
}

function ControlErrorScreen({ s, update, log, go }) {
  const i = s.ctl.eidx;
  const item = s.ctl.eitems[i];
  const st = C.statements[i];
  const [toast, setToast] = useState(null);
  const last = i === NS - 1;

  useEffect(() => {
    if (!item.start) { update((d) => { d.ctl.eitems[d.ctl.eidx].start = now(); }); log("part_start", { part: st.id }); }
  }, [i]);

  function hint() {
    update((d) => { d.ctl.eitems[i].hints += 1; });
    log("hint_shown", { part: st.id, hint_count: item.hints + 1 });
  }
  function submit() {
    update((d) => { d.ctl.eitems[i].submitted = true; d.ctl.eitems[i].outcome = "submitted"; });
    log("control_answer", { part: st.id, text: item.text, hint_count: item.hints, extra: JSON.stringify({ chars: item.text.trim().length }) });
  }
  function next() {
    update((d) => { d.ctl.eitems[i].end = now(); if (!last) d.ctl.eidx += 1; });
    if (last) go("summary");
    window.scrollTo(0, 0);
  }
  function pasteBlocked() {
    update((d) => { d.counters.pasteBlocked += 1; });
    log("paste_blocked", { part: st.id });
    setToast("Pasting is disabled. Please answer in your own words.");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      <Notice s={s} update={update} />
      <Page wide>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-indigo-700">Step 4: Check the statements ({i + 1} of {NS})</p>
          <TimeLeft s={s} label="Time left" />
        </div>
        {i === 0 && !item.text && <Card className="p-5 mb-4 bg-indigo-50/60 text-slate-700 leading-relaxed">{C.control.errorIntro}</Card>}
        <Card className="mb-4 overflow-hidden"><ProblemCard title={C.catProblem.title} text={C.catProblem.text} /></Card>
        <Card className="p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 mb-2">Statement {i + 1}: {st.category}</p>
          <blockquote className="border-l-4 border-amber-400 bg-amber-50 rounded-r-lg px-4 py-3 text-slate-800 leading-relaxed mb-4">“{st.text}”</blockquote>
          <NoPasteArea value={item.text} rows={5} disabled={item.submitted} onPasteBlocked={pasteBlocked}
            onChange={(v) => update((d) => { d.ctl.eitems[i].text = v; })}
            placeholder="Is this statement correct? If not, what is wrong, and what is correct?" />
          {toast && <p className="text-sm text-amber-700 mt-2">{toast}</p>}
          {!item.submitted && <HintBox hints={st.textbookHints} used={item.hints} onMore={hint} />}
          {item.submitted && (
            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="font-bold text-emerald-800 mb-1">Solution</p>
              <p className="text-slate-700 leading-relaxed mb-2"><b>What is wrong:</b> {st.mistake}</p>
              <p className="text-slate-700 leading-relaxed"><b>Correct:</b> {st.correction}</p>
            </div>
          )}
          <div className="flex justify-end mt-6 pt-4 border-t">
            {!item.submitted
              ? <Btn disabled={item.text.trim().length < 15} onClick={submit}>Submit answer</Btn>
              : <Btn kind="green" onClick={next}>{last ? "Continue" : "Next statement"}</Btn>}
          </div>
        </Card>
      </Page>
    </>
  );
}

function SummaryScreen({ s, update, go }) {
  return (
    <>
      <Notice s={s} update={update} />
      <Page wide>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-6">Review</h1>
        <Summary />
        <div className="mt-6 flex justify-end"><Btn kind="green" onClick={() => go("done")}>Finish</Btn></div>
      </Page>
    </>
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
// App: routing between phases, timers, logging
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
    return old && old.group === group && old.v === C.version ? old : freshState(pid, group, code);
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
    update((d) => { d.phase = phase; d.phaseStarts[phase] = now(); d.notice = null; });
    window.scrollTo(0, 0);
  }, [update]);

  // Timers: tick every second; when a phase's time is up, move on.
  const [, setTick] = useState(0);
  const timedOut = useRef({});
  useEffect(() => {
    const h = setInterval(() => {
      setTick((x) => x + 1);
      const cur = sRef.current;
      const left = secondsLeft(cur);
      if (left === 0 && !timedOut.current[cur.phase]) {
        const phase = cur.phase;
        timedOut.current[phase] = true;
        const next = NEXT_ON_TIMEOUT[phase] || (cur.group === "ai" ? "teach" : "c_teach");
        update((d) => {
          const t = now();
          const close = (p) => { if (!p.outcome) { p.outcome = p.start ? "timeout" : "not_reached"; p.start = p.start || t; p.end = t; } else if (!p.end) p.end = t; };
          if (phase === "teach") d.topics.forEach(close);
          if (phase === "error") { d.err.items.forEach(close); d.err.done = true; }
          if (phase === "c_teach") d.ctl.items.forEach(close);
          if (phase === "c_error") d.ctl.eitems.forEach(close);
          d.phase = next; d.phaseStarts[next] = t; d.notice = TIMEOUT_NOTICE[phase];
        });
        log("timeout", { part: phase });
        window.scrollTo(0, 0);
      }
    }, 1000);
    return () => clearInterval(h);
  }, []);

  // Log every phase change, and refresh the session summary row whenever
  // a phase or a part changes (the Apps Script upserts it by sid).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    log("phase", { to: s.phase });
  }, [s.phase]);
  useEffect(() => {
    log("summary", { summary: JSON.stringify(buildSummary(s)) });
  }, [s.phase, s.topicIdx, s.err.idx, s.err.done, s.ctl.idx, s.ctl.eidx,
      s.topics.map((t) => t.outcome).join(), s.ctl.eitems.map((t) => t.submitted).join()]);

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

  const props = { s, sRef, update, log, go };
  const screen = {
    consent: <ConsentScreen {...props} />,
    intro: <IntroScreen {...props} />,
    material: <MaterialScreen {...props} />,
    teach: <TeachChat key={"t" + s.topicIdx} {...props} />,
    error: <StatementChat key="err" {...props} />,
    feedback: <FeedbackScreen {...props} />,
    c_teach: <ControlTeachScreen key={"c" + s.ctl.idx} {...props} />,
    c_error: <ControlErrorScreen key={"e" + s.ctl.eidx} {...props} />,
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
