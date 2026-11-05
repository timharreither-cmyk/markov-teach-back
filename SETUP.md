# Teach Sam: Markov Chains (working implementation)

Learning-by-teaching study app for the CS-411 project of Tim Harreither, Krishna Pranathi Naidu and Zoi Koukouve. It implements section 6 of the project documentation: the AI condition (teach the AI peer "Sam", error detection, feedback) and the control condition (teach aloud without an audience, worked error example, summary), with full interaction logging for the analysis.

## How it fits together

```
Participant browser (GitHub Pages: index.html + app.jsx + content.js + config.js)
        │  POST /chat, /log   (with the study access code from the link)
        ▼
Cloudflare Worker (backend/worker.js)  ← checks origin, access code, size, call limit
        │                         │
        ▼                         ▼
Workers AI (free model)     Google Apps Script (backend/Code.gs) → Google Sheet
                                                                    ├─ events   (every message, phase, hint…)
                                                                    └─ sessions (one row per participant)
```

| File | What it is |
|---|---|
| `index.html` | Page shell (React, Babel and Tailwind from CDNs, versions pinned) |
| `app.jsx` | Study flow, hint rules, logging. **The flow is enforced here, not by the model.** |
| `content.js` | All texts: Miso example, topics and hidden checklists, error task, summary, control prompts, prompts for Sam. Edit here. |
| `config.js` | Worker URL and optional pre/post-test links (public, no secrets) |
| `backend/worker.js` | Cloudflare Worker |
| `backend/Code.gs` | Apps Script that writes to the Google Sheet |
| `prototype.html` | The earlier Wizard-of-Oz prototype, kept for the record |
| `test/` | Local test harness (mock model) and the pilot script |

## Setup (about 30 minutes, once)

### 1. The AI model: free, nothing to pay

The app uses **Cloudflare Workers AI**: open-weight models that run inside your Cloudflare Worker. On the Workers **Free** plan you get 10,000 "neurons" per day for free; when they are used up, calls fail until the reset at 00:00 UTC (01:00 Swiss winter time). Nothing is ever charged unless you yourselves upgrade to the paid plan.

- **Default model:** Gemma 4 26B (`@cf/google/gemma-4-26b-a4b-it`). Cheap in neurons, roughly **10 to 15 AI sessions per day**. Control-group sessions use no AI at all.
- **If Sam's answers are too weak in the pilot:** switch `MODEL` to Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). Better, but only about 3 to 4 AI sessions per day.
- The exact model IDs are in the Cloudflare dashboard under **AI → Workers AI → Models**; copy them from there if an ID above has changed.
- Plan the AI sessions over several days, and keep pilots small, since they use the same daily budget.

### 2. Google Sheet + Apps Script (log storage)

1. Create a new Google Sheet, e.g. "Markov study data".
2. **Extensions → Apps Script.** Delete the sample code and paste `backend/Code.gs`.
3. Replace `CHANGE-ME-to-a-long-random-string` with a long random string (this is `LOG_TOKEN` below).
4. Select the function `testSetup` → **Run** → allow the permissions. The sheet now has `events` and `sessions` tabs with a TEST row; delete those test rows.
5. **Deploy → New deployment →** type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL that ends in `/exec` (this is `LOG_URL`).
   After any later change to Code.gs: Deploy → Manage deployments → edit → new version.

### 3. Cloudflare Worker (backend + free AI)

1. Free account at [dash.cloudflare.com](https://dash.cloudflare.com) (no credit card needed for the Free plan) → **Workers & Pages → Create → Create Worker** → name it `markov-teach-back` → Deploy.
2. **Edit code**, replace everything with `backend/worker.js`, **Deploy**.
3. **Settings → Bindings → Add → Workers AI**, variable name **`AI`** (exactly this). Save.
4. **Settings → Variables and Secrets**, add:

| Name | Type | Value |
|---|---|---|
| `STUDY_CODE` | Secret | an access code you choose, e.g. `miso-2026-x7k` (goes into every participant link) |
| `LOG_URL` | Secret | the `/exec` URL from step 2 |
| `LOG_TOKEN` | Secret | the random string from step 2 |
| `ALLOWED_ORIGINS` | Text | `https://timharreither-cmyk.github.io` |
| `MODEL` | Text | optional, see step 1 (leave out for Gemma 4) |

5. Open the Worker URL in a browser: it should show `{"ok":true,"service":"markov-teach-back"}`.

*Alternative (costs a little):* Google Gemini via `GEMINI_API_KEY` instead of the `AI` binding. In Switzerland/EU Google only allows the paid tier for apps used by other people, so this needs billing; the free path above does not.

### 4. Frontend on GitHub Pages

1. In `config.js` set `WORKER_URL` to the Worker URL (no trailing slash). Optionally add the Google Forms links for `PRETEST_URL` and `POSTTEST_URL`.
2. Copy all files of this folder into the repository `markov-teach-back` (this replaces `index.html`; the old version is `prototype.html`) and push. GitHub Pages is already enabled, so the existing link keeps working.
3. If the red "Setup incomplete" bar shows, `config.js` still has the placeholder URL.

### 5. Participant links

Open `https://timharreither-cmyk.github.io/markov-teach-back/?admin=1`, enter the `STUDY_CODE`, list participants as `ID,group` (`ai` or `control`, balanced using your screening questionnaire), and copy the generated links. Each link looks like:

```
https://timharreither-cmyk.github.io/markov-teach-back/?pid=P07&g=ai&code=miso-2026-x7k
```

Use the same ID in the pre- and post-test Google Forms, so you can join the data.

### 6. Pilot

Do one AI and one control run yourselves, then work through `test/pilot-personas.md`. Add `&reset=1` to a link to start that ID over on the same browser. Check that rows arrive in the sheet (a few seconds delay is normal).

## Running a session (remote)

1. Participant fills in the pre-test (Google Form, with their ID).
2. Participant opens their personal link. Consent → intro (teaching expectancy, material will close) → material → "I'm ready to teach".
3. **AI group:** three teaching chats with Sam (graph, matrix, state vector), Sam's faulty solution to check, then the feedback report and the summary.
   **Control group:** three prompts to explain aloud (timer, at least 45 s each). Record them on your video call, as the documentation specifies a camera. Then the worked error example with both mistakes and the correct solution, then the same summary.
4. Post-test (Google Form). Paper, pen and a basic calculator are allowed throughout.

If the browser is closed or reloaded, the link resumes where the participant left off (progress is kept in the browser). The material cannot be reopened after "Ready".

## What is enforced in code

- **Hint budget:** Sam may give at most **3 hints per part** (each topic and the error task). After that, if the explanation is still incomplete, Sam must reveal the correct method. If the model tries a 4th hint anyway, the app turns it into a reveal and appends the reference method from `content.js` (logged as `flag = forced_reveal`). This is our reading of "does not provide the correct methodology until 3 corrects".
- **Completion:** a part ends with RECAP (the student covered every checklist item; Sam restates the correct method) or REVEAL. Safety net: at most 12 student messages per part.
- **No outside help:** pasting into the chat is blocked and counted (`paste_blocked`); leaving the tab after the material is counted (`tab_hidden`), following Wang et al. (2026) on managing circumvention.
- **Fairness:** both groups see the same material, the same Miso example, the same error problem (the control group with the solution) and the same summary.

## The data

**`sessions` sheet (one row per participant):** `T1_hints`, `T2_hints`, `T3_hints`, `ERR_hints`, `total_hints`, `*_turns`, `*_outcome` (recap/reveal), `*_covered` (checklist items the student covered), `*_sec` (time per part), `material_sec`, `tab_hidden`, `paste_blocked`, `C1_sec`–`C3_sec` for the control group, start and finish times.

**`events` sheet:** every message with `move` (probe/hint/recap/reveal), `assessment`, `hint_count`, `covered`, `misconceptions`, `latency_ms`, plus phase changes.

Join both with your Google Forms export by participant ID to compute the learning gain and the normalized gain per learning goal, and relate the gains to the hints per topic (documentation, evaluation section). Each participant can also download their full session as JSON from the final screen as a backup.

## Changing content

Everything participants read and everything Sam is told is in `content.js`: Miso example and its ground truth, topic tasks, the hidden checklists (`rubric`), the reference methods, the error task with its two mistakes, the summary, the control prompts, and the three prompts (`teach`, `error`, `feedback`). The numbers were checked with numpy; if you change a problem, recompute its `solution` and `correctSolution`.

## Testing locally without a model

```
node test/mock-server.mjs
# then open http://localhost:8787/?pid=T1&g=ai&code=test&api=http://localhost:8787
```

The mock server runs the real `worker.js` with a scripted fake model and a fake sheet (`/__stored` shows what was logged). `test/e2e.py` clicks through both conditions with Playwright.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Sam couldn't answer" | Worker unreachable, wrong `STUDY_CODE` in the link, or a model error. Open the Worker → Logs. |
| Sam stops answering for everyone | The free daily AI budget is used up; it resets at 00:00 UTC. Check Workers AI usage in the dashboard. |
| Worker returns `origin not allowed` | `ALLOWED_ORIGINS` must match exactly, e.g. `https://timharreither-cmyk.github.io` (no path, no slash). |
| `model error` with "model not found" | `MODEL` ID does not exist; copy it from the Workers AI model list. |
| No rows in the sheet | `LOG_URL`/`LOG_TOKEN` mismatch, or the Apps Script was not redeployed after editing. |
| Blank page | A CDN is blocked on that network; try another network. |
