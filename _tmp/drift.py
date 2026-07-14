import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1]

paras = []
for s in range(1, 7):
    paras.append(f"## Section {s} heading")
    for p in range(4):
        body = (
            f"Paragraph {p} of section {s}. "
            + "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " * 3
        )
        if p == 1:
            body += " {--a redundant clause here--}{>>SP: duplicate, already said this two paragraphs up and the next paragraph makes the point in full<<}"
        if p == 2:
            body += " {~~old wording~>new wording~~}{>>SP: tighter<<}"
        paras.append(body)
DOC = "# Test document\n\n" + "\n\n".join(paras) + "\n"

SETUP = """() => {
  const ed = document.querySelector('main');
  const pvEl = document.querySelector('.preview');
  window.__ed = ed; window.__pv = pvEl ? pvEl.parentElement : null;
  return !!(ed && window.__pv);
}"""

# Put the editor's heading `label` at the top of its viewport (iteratively, since
# CodeMirror only renders lines near the viewport), then report where the matching
# preview heading landed relative to the preview viewport top. 0 = perfect sync.
ALIGN = """(label) => {
  const ed = window.__ed, pv = window.__pv;
  const find = () => [...document.querySelectorAll('.cm-content .cm-line')]
      .find(l => (l.textContent||'').trim() === '## ' + label);
  ed.scrollTop = 0;
  for (let i = 0; i < 80; i++) {
    const el = find();
    if (!el) { ed.scrollTop += 250; continue; }
    const delta = el.getBoundingClientRect().top - ed.getBoundingClientRect().top;
    if (Math.abs(delta) < 2) return {found: true, edScroll: Math.round(ed.scrollTop)};
    ed.scrollTop += delta;
  }
  return {found: !!find(), edScroll: Math.round(ed.scrollTop)};
}"""

REPORT = """(label) => {
  const ed = window.__ed, pv = window.__pv;
  const h = [...pv.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(e => (e.textContent||'').trim() === label);
  if (!h) return {err: 'no preview heading'};
  return {
    drift: Math.round(h.getBoundingClientRect().top - pv.getBoundingClientRect().top),
    edScroll: Math.round(ed.scrollTop), edMax: Math.round(ed.scrollHeight - ed.clientHeight),
    pvScroll: Math.round(pv.scrollTop), pvMax: Math.round(pv.scrollHeight - pv.clientHeight),
    wantPvScroll: Math.round(h.getBoundingClientRect().top - pv.getBoundingClientRect().top + pv.scrollTop),
  };
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 1600, "height": 900})
    page.goto(URL)
    time.sleep(4)
    try:
        page.click("text=Skip", timeout=4000)
    except Exception:
        pass
    page.wait_for_selector(".cm-content", timeout=20000)
    page.click(".cm-content")
    page.keyboard.insert_text(DOC)
    time.sleep(1)
    page.keyboard.press("Control+Alt+Digit2")
    time.sleep(2)
    print("panes found:", page.evaluate(SETUP))

    DELTA = """(label) => {
      const ed = window.__ed;
      const el = [...document.querySelectorAll('.cm-content .cm-line')]
        .find(l => (l.textContent||'').trim() === '## ' + label);
      if (!el) return null;
      return el.getBoundingClientRect().top - ed.getBoundingClientRect().top;
    }"""
    for s in range(1, 7):
        label = f"Section {s} heading"
        page.evaluate("window.__ed.scrollTop = 0")
        time.sleep(0.4)
        ok = False
        for _ in range(40):
            d = page.evaluate(DELTA, label)
            if d is None:
                page.evaluate("window.__ed.scrollTop += 400")
                time.sleep(0.2)
                continue
            if abs(d) < 3:
                ok = True
                break
            page.evaluate(f"window.__ed.scrollTop += {d}")
            time.sleep(0.25)
        time.sleep(0.8)
        print(label, "aligned" if ok else "ALIGN FAILED", page.evaluate(REPORT, label))
    # mid-section: align the editor on a paragraph line, measure the matching <p>
    PDELTA = """(t) => {
      const ed = window.__ed;
      const el = [...document.querySelectorAll('.cm-content .cm-line')]
        .find(l => (l.textContent||'').trim().startsWith(t));
      if (!el) return null;
      return el.getBoundingClientRect().top - ed.getBoundingClientRect().top;
    }"""
    PREPORT = """(t) => {
      const pv = window.__pv;
      const el = [...pv.querySelectorAll('p')].find(e => (e.textContent||'').trim().startsWith(t));
      if (!el) return {err: 'not found'};
      return {drift: Math.round(el.getBoundingClientRect().top - pv.getBoundingClientRect().top)};
    }"""
    print()
    for t in ["Paragraph 2 of section 2.", "Paragraph 3 of section 3.", "Paragraph 1 of section 5."]:
        page.evaluate("window.__ed.scrollTop = 0")
        time.sleep(0.4)
        for _ in range(40):
            d = page.evaluate(PDELTA, t)
            if d is None:
                page.evaluate("window.__ed.scrollTop += 400"); time.sleep(0.2); continue
            if abs(d) < 3: break
            page.evaluate(f"window.__ed.scrollTop += {d}"); time.sleep(0.25)
        time.sleep(0.8)
        print("mid-section", t, page.evaluate(PREPORT, t))

    # reverse: scroll the preview, check the editor followed
    print()
    RREPORT = """(t) => {
      const ed = window.__ed;
      const el = [...document.querySelectorAll('.cm-content .cm-line')]
        .find(l => (l.textContent||'').trim().startsWith(t));
      if (!el) return {err: 'line not rendered'};
      return {editorDrift: Math.round(el.getBoundingClientRect().top - ed.getBoundingClientRect().top)};
    }"""
    for t in ["Section 3 heading", "Section 5 heading"]:
        page.evaluate("""(t) => {
          const pv = window.__pv;
          const h = [...pv.querySelectorAll('h1,h2')].find(e => (e.textContent||'').trim() === t);
          pv.scrollTop += h.getBoundingClientRect().top - pv.getBoundingClientRect().top;
        }""", t)
        time.sleep(1.0)
        print("reverse", t, page.evaluate(RREPORT, "## " + t))

    page.screenshot(path="_tmp/split.png")
    b.close()
