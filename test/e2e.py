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

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--force-prefers-reduced-motion"])

    # ---------------- AI group ----------------
    page = b.new_page(viewport={"width": 1280, "height": 860})
    page.on("pageerror", lambda e: errors.append(str(e)))
    route(page)
    page.goto(f"{BASE}/?pid=A1&g=ai&code=test&api={BASE}")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Continue").click()
    page.get_by_role("button", name="Open the material").click()
    page.get_by_role("button", name="I'm ready to teach").click()
    page.get_by_role("button", name="Start teaching").click()

    # Topic 1: three hints, then the 4th "hint" must be turned into a reveal by the app
    for i in range(3):
        say(page, f"You draw the states and connect them, attempt {i+1}")
        expect(page.get_by_role("button", name="Next part")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/1_ai_topic1.png")
    say(page, "I still think no loops are needed")
    expect(page.get_by_text("Okay, I think I need to look at it differently")).to_be_visible()
    # paste must be blocked
    page.get_by_role("button", name="Next part").click()
    ta = page.get_by_placeholder("Explain to Sam")
    ta.focus()
    page.evaluate("""() => { const t=document.querySelector('textarea'); const dt=new DataTransfer(); dt.setData('text/plain','pasted'); t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); }""")
    expect(page.get_by_text("Pasting is disabled")).to_be_visible()

    # Topic 2: probe, then recap
    say(page, "rows are current states, columns next states")
    say(page, "each row is a full distribution so it sums to 1, zeros for impossible ones")
    # reload mid-study: must resume in Topic 2 (done) and not show material again
    page.reload()
    expect(page.get_by_role("button", name="Next part")).to_be_visible()
    page.get_by_role("button", name="Next part").click()

    # Topic 3: recap at once
    say(page, "V1 = V0 T, V2 = V1 T")
    page.get_by_role("button", name="Continue").click()

    # Error task: hint, then recap
    page.screenshot(path=f"{SHOTS}/2_ai_error.png")
    say(page, "False. The train row should be 0.2 0 0.8")
    say(page, "And T squared is T times T, not squared entries")
    page.get_by_role("button", name="See your feedback").click()
    expect(page.get_by_text("What went well")).to_be_visible(timeout=10000)
    page.screenshot(path=f"{SHOTS}/3_ai_feedback.png", full_page=True)
    page.get_by_role("button", name="Finish").click()
    expect(page.get_by_text("Thank you!")).to_be_visible()

    # mobile view of a chat
    m = b.new_page(viewport={"width": 390, "height": 800})
    route(m)
    m.goto(f"{BASE}/?pid=A2&g=ai&code=test&api={BASE}")
    m.get_by_role("checkbox").check(); m.get_by_role("button", name="Continue").click()
    m.get_by_role("button", name="Open the material").click()
    m.get_by_role("button", name="I'm ready to teach").click(); m.get_by_role("button", name="Start teaching").click()
    m.screenshot(path=f"{SHOTS}/4_ai_mobile.png")

    # ---------------- Control group ----------------
    c = b.new_page(viewport={"width": 1280, "height": 860})
    c.on("pageerror", lambda e: errors.append(str(e)))
    route(c)
    c.clock.install()
    c.goto(f"{BASE}/?pid=C1&g=control&code=test&api={BASE}")
    c.get_by_role("checkbox").check(); c.get_by_role("button", name="Continue").click()
    c.get_by_role("button", name="Open the material").click()
    c.get_by_role("button", name="I'm ready to teach").click(); c.get_by_role("button", name="Start teaching").click()
    for i in range(3):
        c.get_by_role("button", name="Start explaining").click()
        expect(c.get_by_role("button", name="Keep explaining")).to_be_disabled()
        if i == 0: c.screenshot(path=f"{SHOTS}/5_control_teach.png")
        c.clock.fast_forward("01:00")
        c.get_by_role("button", name="I'm done with this part").click()
    expect(c.get_by_text("The two mistakes")).to_be_visible()
    c.screenshot(path=f"{SHOTS}/6_control_error.png", full_page=True)
    c.get_by_role("button", name="Continue").click()
    c.get_by_role("button", name="Finish").click()
    expect(c.get_by_text("Thank you!")).to_be_visible()

    # invalid link + admin
    x = b.new_page(); route(x)
    x.goto(f"{BASE}/?pid=Z"); expect(x.get_by_text("Invalid link")).to_be_visible()
    x.goto(f"{BASE}/?admin=1"); expect(x.get_by_text("Participant links")).to_be_visible()

    for pg in (page, c):
        pg.wait_for_timeout(1500)
        pg.evaluate("() => 0")
    b.close()

data = json.load(urllib.request.urlopen(f"{BASE}/__stored"))
ev = data["stored"]
summ = {}
for e in ev:
    if e["type"] == "summary":
        s = json.loads(e["summary"]); summ[s["sid"]] = s
print("page errors:", errors)
print("events stored:", len(ev), "gemini calls:", data["geminiCalls"])
print("event types:", sorted({e['type'] for e in ev}))
print("flags:", [e.get("flag") for e in ev if e.get("flag")])
for s in summ.values():
    print(json.dumps(s))
