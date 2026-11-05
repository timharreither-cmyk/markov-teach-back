# End-to-end test: clicks through both study conditions against the mock server.
#   node test/mock-server.mjs &   then   python3 test/e2e.py <vendor_dir> <shots_dir>
import json, sys, urllib.request
from playwright.sync_api import sync_playwright, expect

VENDOR, SHOTS = sys.argv[1], sys.argv[2]
BASE = "http://localhost:8787"
CDN = {
    "react.production.min.js": f"{VENDOR}/node_modules/react/umd/react.production.min.js",
    "react-dom.production.min.js": f"{VENDOR}/node_modules/react-dom/umd/react-dom.production.min.js",
    "babel.min.js": f"{VENDOR}/node_modules/@babel/standalone/babel.min.js",
}
TW = f"{VENDOR}/node_modules/@tailwindcss/browser/dist/index.global.js"

def route(page):
    def handler(r):
        u = r.request.url
        if "cdn.tailwindcss.com" in u:
            return r.fulfill(path=TW, content_type="text/javascript")
        for k, p in CDN.items():
            if u.endswith(k):
                return r.fulfill(path=p, content_type="text/javascript")
        return r.abort()
    page.route("https://**/*", handler)

def say(page, text):
    page.get_by_placeholder("Explain to Sam").fill(text)
    page.get_by_role("button", name="Send").click()
    page.wait_for_function("() => !document.body.innerText.includes('Sam is thinking')", timeout=10000)

def start(page, pid, g):
    page.goto(f"{BASE}/?pid={pid}&g={g}&code=test&api={BASE}")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Continue").click()
    page.get_by_role("button", name="Open the material").click()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])

    # ---------------- AI group ----------------
    page = b.new_page(viewport={"width": 1280, "height": 860})
    page.on("pageerror", lambda e: errors.append(str(e)))
    route(page)
    start(page, "A1", "ai")
    expect(page.get_by_text("Time left")).to_be_visible()
    page.get_by_role("button", name="I'm ready to teach").click()
    page.get_by_role("button", name="Start teaching").click()

    # Step 1: three hints, then the 4th "hint" must become a reveal
    for i in range(3):
        say(page, f"You draw the states and connect them, attempt {i+1}")
        expect(page.get_by_role("button", name="Next step")).to_have_count(0)
    say(page, "I still think no loops are needed")
    expect(page.get_by_text("I think I get it differently now")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/1_ai_step1.png")
    page.get_by_role("button", name="Next step").click()
    # Step 2: probe, then recap; reload resumes
    say(page, "rows are current states, columns next states")
    say(page, "each row is a full distribution so it sums to 1, zeros for impossible ones")
    page.reload()
    page.get_by_role("button", name="Next step").click()
    # Step 3: recap at once, then "Example done"
    say(page, "V1 = V0 T, V2 = V1 T")
    page.get_by_role("button", name="Example done").click()

    # Step 4: statement 1 needs a hint, statements 2-4 corrected at once
    expect(page.get_by_text("1/4: Ah okay, so from Playing")).to_be_visible()
    say(page, "That's right")
    expect(page.get_by_text("add up the arrows leaving P")).to_be_visible()
    say(page, "Wrong, P->P 0.5 is missing")
    expect(page.get_by_text("2/4:")).to_be_visible()
    say(page, "Rows sum to 1, not columns")
    say(page, "Row E column S is 0.4")
    page.screenshot(path=f"{SHOTS}/2_ai_statements.png")
    say(page, "You must add all paths: 0.51")
    page.get_by_role("button", name="See your feedback").click()
    expect(page.get_by_text("What went well")).to_be_visible(timeout=10000)
    page.get_by_role("button", name="Finish").click()
    expect(page.get_by_text("Thank you!")).to_be_visible()

    # ---------------- Control group (with timeouts) ----------------
    c = b.new_page(viewport={"width": 1280, "height": 860})
    c.on("pageerror", lambda e: errors.append(str(e)))
    route(c)
    c.clock.install()
    start(c, "C1", "control")
    c.clock.fast_forward("11:00")                  # material time runs out → step 1
    expect(c.get_by_text("time for the material is up")).to_be_visible()
    expect(c.get_by_text("Step 1 of 3")).to_be_visible()
    done1 = c.get_by_role("button", name="Answers done: next step")
    expect(done1).to_be_disabled()
    c.get_by_role("button", name="Show a hint (0/3 used)").click()
    c.get_by_role("button", name="Show a hint (1/3 used)").click()
    expect(c.get_by_text("Hint 2:")).to_be_visible()
    c.get_by_placeholder("Write your explanation here").fill("Each state is a node; arrows are one-step probabilities and leaving arrows sum to one.")
    c.screenshot(path=f"{SHOTS}/3_control_step1.png", full_page=True)
    done1.click()
    expect(c.get_by_text("Step 2 of 3")).to_be_visible()
    c.clock.fast_forward("16:00")                  # example time runs out → statements
    expect(c.get_by_text("time for the example is up")).to_be_visible()
    for i in range(4):
        c.get_by_placeholder("Is this statement correct?").fill("Wrong, here is my correction of the statement.")
        if i == 0:
            c.get_by_role("button", name="Show a hint (0/3 used)").click()
        c.get_by_role("button", name="Submit answer").click()
        expect(c.get_by_text("What is wrong:")).to_be_visible()
        if i == 0: c.screenshot(path=f"{SHOTS}/4_control_statement.png", full_page=True)
        c.get_by_role("button", name="Continue" if i == 3 else "Next statement").click()
    expect(c.get_by_text("Summary of the material")).to_be_visible()
    c.get_by_role("button", name="Finish").click()
    expect(c.get_by_text("Thank you!")).to_be_visible()

    # mobile view of the AI chat
    m = b.new_page(viewport={"width": 390, "height": 800}); route(m)
    start(m, "A2", "ai")
    m.get_by_role("button", name="I'm ready to teach").click(); m.get_by_role("button", name="Start teaching").click()
    m.screenshot(path=f"{SHOTS}/5_ai_mobile.png")

    for pg in (page, c):
        pg.wait_for_timeout(1500)
    b.close()

data = json.load(urllib.request.urlopen(f"{BASE}/__stored"))
ev = data["stored"]
summ = {}
for e in ev:
    if e["type"] == "summary":
        s = json.loads(e["summary"]); summ[s["sid"]] = s
print("page errors:", errors)
print("events stored:", len(ev), "model calls:", data["geminiCalls"])
print("event types:", sorted({e['type'] for e in ev}))
print("flags:", [e.get("flag") for e in ev if e.get("flag")])
for s in summ.values():
    print(json.dumps(s))
