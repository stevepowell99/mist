"""Stress test a gmist room through its SUGGEST link: three visitors with no
sign-in, all suggesters, as colleagues sent a link would be.
Usage: PYTHONIOENCODING=utf-8 python scripts/stress-live-suggest.py <suggest link>
For a Drive-bound room it also waits for the save and reads the sync log.
Prints one PASS/FAIL line per check."""
import json
import re
import sys
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

RESULTS = []
VIEW = "document.querySelector('.cm-content').cmTile.view"
DOC = "(() => { const c = document.querySelector('.cm-content'); return c && c.cmTile ? c.cmTile.view.state.doc.toString() : null; })()"


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (("  | " + str(detail)[:300]) if detail else ""), flush=True)


def text(page):
    return page.evaluate(DOC)


def wait_text(page, timeout=40000):
    t0 = time.time()
    page.wait_for_function(DOC + " !== null && " + DOC + ".length > 0", timeout=timeout)
    return time.time() - t0


def converge(pages, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        ts = [text(p) for p in pages]
        if all(t == ts[0] for t in ts):
            return True, ts[0]
        time.sleep(0.4)
    return False, [text(p) for p in pages]


def client(browser, name, colour):
    ctx = browser.new_context(viewport={"width": 1500, "height": 850})
    ctx.add_init_script(
        "try { localStorage.setItem('mist-user', JSON.stringify({name: %s, color: %s, colorLight: %s, named: true})); } catch (e) {}"
        % (json.dumps(name), json.dumps(colour), json.dumps(colour + "33"))
    )
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("  [pageerror %s] %s" % (name, str(e)[:200]), flush=True))
    return ctx, page


def cursor(page, needle, at_end=True):
    """Put the cursor at the end (or start) of the first line containing needle."""
    page.evaluate(
        "([needle, atEnd]) => { const v = %s; const d = v.state.doc; for (let n = 1; n <= d.lines; n++) { const l = d.line(n); if (l.text.includes(needle)) { v.dispatch({ selection: { anchor: atEnd ? l.to : l.from }, scrollIntoView: true }); v.focus(); return; } } throw new Error('no line with ' + needle); }" % VIEW,
        [needle, at_end],
    )


def line(page, needle):
    hits = [l for l in text(page).split("\n") if needle in l]
    return hits[0] if hits else None


def status(page):
    return page.inner_text("body")[:140].replace("\n", "|")


def strip_suggestions(t):
    """The text as it would read with every suggestion rejected."""
    t = re.sub(r"\{\+\+[\s\S]*?\+\+\}", "", t)
    t = re.sub(r"\{--([\s\S]*?)--\}", r"\1", t)
    t = re.sub(r"\{==([\s\S]*?)==\}", r"\1", t)
    return re.sub(r"\{>>[\s\S]*?<<\}", "", t)


url = sys.argv[1]
u = urlparse(url)
doc_id = u.path.split("/")[2]
key = parse_qs(u.query)["k"][0]
base = f"{u.scheme}://{u.netloc}"
stamp = time.strftime("%H%M%S")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA, A = client(b, "Ana", "#E57373")
    ctxB, B = client(b, "Ben", "#64B5F6")
    ctxC, C = client(b, "Cy", "#81C784")

    t0 = time.time()
    A.goto(url)
    try:
        tA = wait_text(A)
    except Exception:
        check("a visitor with no sign-in opens the link", False, status(A))
        sys.exit(1)
    check("a visitor with no sign-in opens the link", True, f"{time.time() - t0:.1f}s")
    meta = A.evaluate("async ([id, k]) => (await fetch(`/agents/document-agent/${id}?k=${encodeURIComponent(k)}`)).json()", [doc_id, key])
    drive_bound = bool(meta.get("drive"))
    check("the link's role is suggest", meta.get("role") == "suggest", {k: v for k, v in meta.items() if k != "suggestKey"})
    check("opens in Suggesting", "SUGGESTING" in status(A).upper(), status(A)[:80])
    original = strip_suggestions(text(A))

    B.goto(url)
    C.goto(url)
    wait_text(B)
    wait_text(C)
    ok, t = converge([A, B, C])
    check("three visitors see the same text", ok)
    first_body = [l for l in t.split("\n") if l.strip() and not l.startswith("#") and not l.startswith("---")][0]
    anchor = first_body[:25]

    # --- simultaneous typing, three suggesters ---------------------------
    cursor(A, anchor)
    A.keyboard.type(f" [A{stamp}]")
    ok, t = converge([A, B, C])
    cursor(B, anchor)
    B.keyboard.press("Enter")
    B.keyboard.type(f"B{stamp} line")
    ok, t = converge([A, B, C])
    cursor(C, f"B{stamp} line")
    C.keyboard.press("Enter")
    C.keyboard.type(f"C{stamp} line")
    ok, t = converge([A, B, C])
    check("each visitor's first suggestion reaches the others", ok and all(x in t for x in (f"[A{stamp}]", f"B{stamp} line", f"C{stamp} line")))

    cursor(A, f"[A{stamp}]")
    cursor(B, f"B{stamp} line")
    cursor(C, f"C{stamp} line")
    pa = " " + " ".join(f"a{i}" for i in range(50))
    pb = " " + " ".join(f"b{i}" for i in range(50))
    pc = " " + " ".join(f"c{i}" for i in range(50))
    for i in range(max(len(pa), len(pb), len(pc))):
        if i < len(pa):
            A.keyboard.type(pa[i])
        if i < len(pb):
            B.keyboard.type(pb[i])
        if i < len(pc):
            C.keyboard.type(pc[i])
    ok, t = converge([A, B, C])
    check("simultaneous typing by three suggesters converges", ok)
    if ok:
        check("all three typed runs arrived whole", pa.strip() in t and pb.strip() in t and pc.strip() in t)
        check("the original text is untouched under the suggestions", strip_suggestions(t) == original, "" if strip_suggestions(t) == original else repr(strip_suggestions(t)[:200]))
        check("no nested or broken markers", not re.search(r"\{-\{|\{\+\{|\{--\{--|-\}--\}|\{\+\+\{\+\+", t))

    # --- keys on original text -------------------------------------------
    # Backspace over a whole word of original text, in a line the run has not touched.
    probe = "First line"
    if probe in t:
        A.evaluate("(needle) => { const v = %s; const d = v.state.doc.toString(); const i = d.indexOf(needle) + needle.length; v.dispatch({ selection: { anchor: i } }); v.focus(); }" % VIEW, probe)
        for _ in range(4):
            A.keyboard.press("Backspace")
        ok, t = converge([A, B, C])
        got = line(A, "First ")
        check("Backspace x4 on original text is one tidy deletion", ok and "First {--line--}" in got, got[:120])
    cursor(B, anchor, at_end=False)
    for _ in range(3):
        B.keyboard.press("Delete")
    ok, t = converge([A, B, C])
    got = line(B, first_body[3:20])
    check("Delete x3 at the line start is one tidy deletion", ok and got.startswith("{--" + first_body[:3] + "--}"), got[:80])
    check("the original text is still recoverable", strip_suggestions(t) == original)

    # --- comment and reply between suggesters -----------------------------
    try:
        C.evaluate("(needle) => { const v = %s; const d = v.state.doc.toString(); const i = d.indexOf(needle); v.dispatch({ selection: { anchor: i, head: i + needle.length }, scrollIntoView: true }); v.focus(); }" % VIEW, first_body[8:18])
        C.wait_for_selector(".cm-sel-btn", timeout=5000)
        C.locator(".cm-sel-btn", has_text="Comment").click()
        C.get_by_placeholder("Add a comment...").fill(f"Cy asks {stamp}")
        C.get_by_text("Save", exact=True).click()
        ok, t = converge([A, B, C])
        check("a suggester's comment reaches the others", ok and f"{{>>Cy asks {stamp}<<}}" in t)
        A.wait_for_function(f"document.body.innerText.includes('Cy asks {stamp}')", timeout=8000)
        card = A.locator("div", has_text=f"Cy asks {stamp}").last
        A.get_by_text("Reply", exact=True).last.click()
        A.get_by_placeholder("Reply...").fill(f"Ana replies {stamp}")
        A.get_by_placeholder("Reply...").press("Enter")
        B.wait_for_function(f"document.body.innerText.includes('Ana replies {stamp}')", timeout=8000)
        C.wait_for_function(f"document.body.innerText.includes('Ana replies {stamp}')", timeout=8000)
        check("another suggester's reply reaches everyone", True)
        body = A.inner_text("body")
        check("suggesters are not offered Accept or Reject", "ACCEPT" not in body.upper().replace("ACCEPTED", ""), "")
    except Exception as e:
        check("comment and reply between suggesters", False, str(e)[:200])

    # --- reload storm ------------------------------------------------------
    times = []
    cursor(A, f"[A{stamp}]")
    for i in range(6):
        A.keyboard.type(f" r{i}")
        t0 = time.time()
        B.reload()
        try:
            wait_text(B, timeout=40000)
            times.append(time.time() - t0)
        except Exception:
            times.append(None)
    ok, t = converge([A, B, C], timeout=25)
    check("reload storm: nothing lost", ok and all(f" r{i}" in t for i in range(6)))
    good = [x for x in times if x is not None]
    check("each reload shows text within 8s", len(good) == 6 and max(good) < 8, ", ".join("timeout" if x is None else f"{x:.1f}s" for x in times))

    # --- offline -----------------------------------------------------------
    ctxB.set_offline(True)
    cursor(B, f"B{stamp} line")
    B.keyboard.type(" offline-ben")
    cursor(A, f"[A{stamp}]")
    A.keyboard.type(" online-ana")
    time.sleep(2)
    ctxB.set_offline(False)
    ok, t = converge([A, B, C], timeout=45)
    check("offline suggestions merge after reconnect", ok and "offline-ben" in t and "online-ana" in t)

    # --- a long pasted suggestion -------------------------------------------
    big = " ".join(f"word{i}" for i in range(3000))
    cursor(C, f"C{stamp} line")
    C.evaluate("(t) => { const v = %s; const pos = v.state.selection.main.head; v.dispatch({ changes: { from: pos, insert: ' ' + t }, userEvent: 'input.paste' }); }" % VIEW, big)
    ok, t = converge([A, B, C], timeout=30)
    check("a 23k-character pasted suggestion reaches everyone", ok and "word2999" in t, f"{len(t)} chars")
    check("the original text is still recoverable after everything", strip_suggestions(t) == original)

    # --- late joiner ---------------------------------------------------------
    ctxD, D = client(b, "Dee", "#BA68C8")
    t0 = time.time()
    D.goto(url)
    try:
        wait_text(D)
        ok, _ = converge([A, D], timeout=15)
        check("a fourth visitor joins late and sees everything", ok, f"{time.time() - t0:.1f}s")
    except Exception as e:
        check("a fourth visitor joins late", False, str(e)[:200])

    # --- Drive save ------------------------------------------------------------
    if drive_bound:
        end = time.time() + 60
        while time.time() < end and "SYNCED" not in status(A).upper():
            time.sleep(2)
        sts = [status(x)[:60] for x in (A, B, C)]
        check("every visitor shows Synced after the edits", all("SYNCED" in s.upper() for s in sts), sts)
        log = A.evaluate("async ([id, k]) => (await fetch(`/agents/document-agent/${id}?synclog=1&k=${encodeURIComponent(k)}`)).json()", [doc_id, key])
        events = [e["event"] + " " + e["detail"] for e in log.get("log", [])][:14]
        bad = [e for e in events if not (e.startswith("open") or e.startswith("save "))]
        check("sync log shows only opens and saves", not bad, events[:6])
        final = text(A)
        print("FINAL_LENGTH", len(final), "MARKERS", final.count("{++"), final.count("{--"), final.count("{>>"), flush=True)
        print("STAMP", stamp, flush=True)

    b.close()

fails = [r for r in RESULTS if not r[1]]
print(f"\n{len(RESULTS) - len(fails)} passed, {len(fails)} failed out of {len(RESULTS)} checks")
