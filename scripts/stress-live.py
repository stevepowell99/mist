"""Stress test gmist on the deployed worker: three clients in one room.
Usage: python scripts/stress-live.py            (makes a throwaway unbound room)
       python scripts/stress-live.py <edit-url> (uses an existing room, e.g. a Drive doc)
Prints one PASS/FAIL line per check."""
import json
import sys
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "https://mist.broad-smoke-cc64.workers.dev"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  | " + str(detail)[:300]) if detail else ""), flush=True)


DOC = "(() => { const c = document.querySelector('.cm-content'); return c && c.cmTile ? c.cmTile.view.state.doc.toString() : null; })()"


def text(page):
    return page.evaluate(DOC)


def wait_text(page, timeout=30000):
    t0 = time.time()
    page.wait_for_function(DOC + " !== null && " + DOC + ".length > 0", timeout=timeout)
    return time.time() - t0


def converge(pages, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        ts = [text(p) for p in pages]
        if all(t == ts[0] for t in ts):
            return True, ts[0]
        time.sleep(0.4)
    return False, [text(p) for p in pages]


def new_client(browser, name, colour):
    ctx = browser.new_context(viewport={"width": 1500, "height": 850})
    ctx.add_init_script(
        "try { localStorage.setItem('mist-user', JSON.stringify({name: %s, color: %s, colorLight: %s, named: true})); } catch (e) {}"
        % (json.dumps(name), json.dumps(colour), json.dumps(colour + "33"))
    )
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("  [pageerror %s] %s" % (name, str(e)[:200]), flush=True))
    return ctx, page


def goto_line_end(page, line_no):
    # Place the cursor by document line, not by arrow keys: a long line wraps
    # on screen and ArrowDown moves by visual line.
    page.evaluate(
        "(n) => { const v = document.querySelector('.cm-content').cmTile.view; const l = v.state.doc.line(n); v.dispatch({ selection: { anchor: l.to }, scrollIntoView: true }); v.focus(); }",
        line_no,
    )


def plain(url):
    # source view: predictable keyboard navigation
    return url.replace("&view=live", "").replace("?view=live&", "?")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA, A = new_client(b, "Alice", "#E57373")
    ctxB, B = new_client(b, "Bob", "#64B5F6")
    ctxC, C = new_client(b, "Carol", "#81C784")

    if len(sys.argv) > 1:
        edit_url = plain(sys.argv[1])
        A.goto(edit_url)
    else:
        A.goto(BASE + "/")
        A.get_by_text("New blank document").click()
        A.wait_for_url("**/docs/**", timeout=30000)
        edit_url = plain(A.url)
        A.goto(edit_url)
    wait_text(A)
    u = urlparse(edit_url)
    doc_id = u.path.split("/")[2]
    key = parse_qs(u.query)["k"][0]
    meta = A.evaluate("async ([id, k]) => (await fetch(`/agents/document-agent/${id}?k=${encodeURIComponent(k)}`)).json()", [doc_id, key])
    suggest_key = meta.get("suggestKey")
    check("edit link reports a suggest key", bool(suggest_key), {k: v for k, v in meta.items() if k not in ("suggestKey",)})
    suggest_url = f"{BASE}/docs/{doc_id}?k={suggest_key}"
    drive_bound = bool(meta.get("drive"))
    print("room", doc_id, "drive-bound" if drive_bound else "unbound", flush=True)

    # --- seed -----------------------------------------------------------
    A.click(".cm-content")
    A.keyboard.press("Control+a")
    A.keyboard.type("# Stress test\n\nAlice line.\n\nBob line.\n\nCarol line.\n\nShared paragraph with several words in it for selecting.\n")
    B.goto(edit_url)
    C.goto(suggest_url)
    tB = wait_text(B)
    tC = wait_text(C)
    ok, t = converge([A, B, C])
    check("three clients load the same text", ok, f"B {tB:.1f}s, C {tC:.1f}s")
    mode_badge = C.inner_text("body")[:200]
    check("suggest link opens in Suggesting", "SUGGESTING" in mode_badge.upper(), mode_badge.replace("\n", "|")[:80])

    # --- simultaneous typing ---------------------------------------------
    goto_line_end(A, 3)
    goto_line_end(B, 5)
    goto_line_end(C, 7)
    pa = " " + " ".join(f"a{i}" for i in range(60))
    pb = " " + " ".join(f"b{i}" for i in range(60))
    pc = " " + " ".join(f"c{i}" for i in range(60))
    # interleave keystrokes across the three pages
    for i in range(max(len(pa), len(pb), len(pc))):
        if i < len(pa):
            A.keyboard.type(pa[i])
        if i < len(pb):
            B.keyboard.type(pb[i])
        if i < len(pc):
            C.keyboard.type(pc[i])
    ok, t = converge([A, B, C])
    check("simultaneous typing converges", ok, "" if ok else [x[-120:] for x in t])
    if ok:
        check("Alice's and Bob's typing all arrived", pa.strip() in t and pb.strip() in t)
        check("Carol's typing arrived as one suggestion", "{++" + pc + "++}" in t, t[t.find("Carol line"):][:120])

    # --- suggester cannot edit plainly ------------------------------------
    before = text(A)
    C.click(".cm-content")
    C.keyboard.press("Control+Home")
    C.keyboard.press("End")
    for _ in range(4):
        C.keyboard.press("Backspace")
    ok, t = converge([A, B, C])
    check("suggester's deletion is a tracked deletion", ok and t.split("\n")[0] == "# Stress {--test--}", t.split("\n")[0])

    # --- suggester's keys: Backspace, Delete, Enter ------------------------
    def keys_line():
        hits = [l for l in text(C).split("\n") if "alpha beta gamma" in l]
        return hits[0] if hits else None

    A.click(".cm-content")
    A.keyboard.press("Control+End")
    A.keyboard.type("\nKEYS alpha beta gamma delta\n")
    ok, t = converge([A, B, C])
    line_no = t.split("\n").index("KEYS alpha beta gamma delta") + 1
    goto_line_end(C, line_no)
    for _ in range(5):
        C.keyboard.press("Backspace")
    check("suggester: Backspace x5 is one tidy deletion", keys_line() == "KEYS alpha beta gamma {--delta--}", keys_line())
    C.evaluate("(n) => { const v = document.querySelector('.cm-content').cmTile.view; v.dispatch({ selection: { anchor: v.state.doc.line(n).from } }); v.focus(); }", line_no)
    for _ in range(4):
        C.keyboard.press("Delete")
    check("suggester: Delete x4 is one tidy deletion", keys_line() == "{--KEYS--} alpha beta gamma {--delta--}", keys_line())
    C.keyboard.type("NEW")
    check("suggester: typing after a deletion is an addition", keys_line() == "{--KEYS--}{++NEW++} alpha beta gamma {--delta--}", keys_line())
    C.keyboard.press("Backspace")
    check("suggester: Backspace trims own addition", keys_line() == "{--KEYS--}{++NE++} alpha beta gamma {--delta--}", keys_line())
    goto_line_end(C, line_no)
    C.keyboard.press("Enter")
    C.keyboard.type("next")
    tt = text(C)
    tail_ = tt[tt.find("{--delta"):][:60]
    check("suggester: Enter is tracked, not a plain line break", tail_.startswith("{--delta--}{++\nnext++}"), repr(tail_))
    ok, t = converge([A, B, C])
    import re as _re
    stripped = _re.sub(r"\{\+\+[\s\S]*?\+\+\}", "", t)
    stripped = _re.sub(r"\{--([\s\S]*?)--\}", r"\1", stripped)
    check("suggester: rejecting everything would restore the original line", "KEYS alpha beta gamma delta" in stripped, "")
    check("suggester: no nested or broken markers anywhere", not _re.search(r"\{-\{|\{\+\{|\{--\{--|-\}--\}", t), "")

    # --- comment by suggester, reply by editor ----------------------------
    C.get_by_text("selecting", exact=False).first.dblclick()
    C.wait_for_selector(".cm-sel-btn", timeout=5000)
    C.locator(".cm-sel-btn", has_text="Comment").click()
    C.get_by_placeholder("Add a comment...").fill("Carol asks: is this right?")
    C.get_by_text("Save", exact=True).click()
    ok, t = converge([A, B, C])
    check("suggester's comment reaches everyone", ok and "{>>Carol asks: is this right?<<}" in t)
    try:
        A.wait_for_function("document.body.innerText.includes('Carol asks: is this right?')", timeout=8000)
        panelA = A.inner_text("body")
        check("comment shows in the editor's panel with its author", "Carol" in panelA)
        A.get_by_text("Reply", exact=True).first.click()
        A.get_by_placeholder("Reply...").fill("Alice: yes, keep it.")
        A.get_by_placeholder("Reply...").press("Enter")
        B.wait_for_function("document.body.innerText.includes('Alice: yes, keep it.')", timeout=8000)
        C.wait_for_function("document.body.innerText.includes('Alice: yes, keep it.')", timeout=8000)
        check("reply reaches the other two", True)
    except Exception as e:
        check("comment thread and reply", False, str(e)[:200])

    # --- accept one suggestion, synthetic click on Reject does nothing ----
    n_before = text(A).count("{++")
    markers_before = text(A).count("{++") + text(A).count("{--")
    fired = A.evaluate("(() => { const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Reject'); b.forEach(x => x.click()); return b.length; })()")
    time.sleep(1)
    check("synthetic click on Reject changes nothing", fired > 0 and text(A).count("{++") == n_before, f"{fired} buttons clicked by script")
    try:
        A.get_by_text("Accept", exact=True).first.click()
        ok, t = converge([A, B, C])
        check("a real Accept applies and converges", ok and t.count("{++") + t.count("{--") == markers_before - 1, f"markers {markers_before} -> {t.count('{++') + t.count('{--')}")
    except Exception as e:
        check("a real Accept applies", False, str(e)[:200])

    # --- reload storm while another types ---------------------------------
    goto_line_end(A, 3)
    load_times = []
    for i in range(6):
        A.keyboard.type(f" r{i}")
        t0 = time.time()
        B.reload()
        try:
            wait_text(B, timeout=40000)
            load_times.append(time.time() - t0)
        except Exception:
            load_times.append(None)
    ok, t = converge([A, B, C], timeout=20)
    check("reload storm: nothing lost, all converge", ok and all(f" r{i}" in t for i in range(6)), "")
    lt = [x for x in load_times if x is not None]
    check("reloads show text within 8s each", len(lt) == 6 and max(lt) < 8, "times: " + ", ".join("timeout" if x is None else f"{x:.1f}s" for x in load_times))

    # --- offline edits merge ----------------------------------------------
    ctxB.set_offline(True)
    goto_line_end(B, 5)
    B.keyboard.type(" offline-bob")
    goto_line_end(A, 3)
    A.keyboard.type(" online-alice")
    time.sleep(2)
    ctxB.set_offline(False)
    ok, t = converge([A, B, C], timeout=40)
    check("offline edits merge after reconnect", ok and "offline-bob" in t and "online-alice" in t, "" if ok else "did not converge in 40s")

    # --- large paste ------------------------------------------------------
    big = "\n".join(f"Paragraph {i}: " + "lorem ipsum dolor sit amet " * 8 for i in range(250))
    A.click(".cm-content")
    A.keyboard.press("Control+End")
    t0 = time.time()
    A.evaluate("(t) => { const v = document.querySelector('.cm-content').cmTile.view; v.dispatch({ changes: { from: v.state.doc.length, insert: '\\n' + t }, userEvent: 'input.paste' }); }", big)
    ok, t = converge([A, B, C], timeout=30)
    check("60k-character paste reaches everyone", ok and "Paragraph 249" in t, f"{len(t)} chars in {time.time() - t0:.1f}s")

    # --- typing still responsive in the big doc ---------------------------
    goto_line_end(B, 5)
    t0 = time.time()
    B.keyboard.type(" after-big")
    ok, t = converge([A, B, C], timeout=15)
    check("typing after the paste converges", ok and "after-big" in t, f"{time.time() - t0:.1f}s")

    # --- late joiner ------------------------------------------------------
    ctxD, D = new_client(b, "Dave", "#BA68C8")
    t0 = time.time()
    D.goto(suggest_url)
    try:
        wait_text(D, timeout=40000)
        ok, t = converge([A, D], timeout=15)
        check("a fourth visitor joins late and sees everything", ok, f"{time.time() - t0:.1f}s")
    except Exception as e:
        check("a fourth visitor joins late", False, str(e)[:200])

    # --- Drive save -------------------------------------------------------
    if drive_bound:
        for pg in (A, B):
            if pg.get_by_text("Edited", exact=True).count():
                pg.get_by_text("Edited", exact=True).first.click()
        time.sleep(8)
        status = A.inner_text("body")[:120].replace("\n", "|")
        check("Drive doc reaches Synced after the edits", "SYNCED" in status.upper(), status)
        log = A.evaluate("async ([id, k]) => (await fetch(`/agents/document-agent/${id}?synclog=1&k=${encodeURIComponent(k)}`)).json()", [doc_id, key])
        events = [e["event"] for e in log.get("log", [])][:30]
        bad = [e for e in events if e not in ("open", "save")]
        check("sync log shows only opens and saves", not bad, events[:12])

    b.close()

print()
fails = [r for r in RESULTS if not r[1]]
print(f"{len(RESULTS) - len(fails)} passed, {len(fails)} failed out of {len(RESULTS)} checks")
