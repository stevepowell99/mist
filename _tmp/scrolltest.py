import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1]

# A document like the ones being reviewed: long prose sections, comments and
# CriticMarkup that inflate the source but not the render.
paras = []
for s in range(1, 7):
    paras.append(f"## Section {s} heading")
    for p in range(4):
        body = (
            f"Paragraph {p} of section {s}. " + "Lorem ipsum dolor sit amet, consectetur adipiscing elit, "
            "sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " * 3
        )
        if p == 1:
            body += " {--a redundant clause here--}{>>SP: duplicate, already said this two paragraphs up and the next paragraph makes the point in full<<}"
        if p == 2:
            body += " {~~old wording~>new wording~~}{>>SP: tighter<<}"
        paras.append(body)
DOC = "# Test document\n\n" + "\n\n".join(paras) + "\n"

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
    # split view (Ctrl+Alt+2)
    page.keyboard.press("Control+Alt+Digit2")
    time.sleep(2)

    probe = """() => {
      const ed = document.querySelector('main');
      const pvEl = document.querySelector('.preview');
      const pv = pvEl ? pvEl.parentElement : null;
      const heads = pv ? [...pv.querySelectorAll('h1,h2,h3,h4,h5,h6')] : [];
      const cmHeads = [...document.querySelectorAll('.cm-content .cm-line')].filter(l => /^#{1,6}\\s/.test(l.textContent||''));
      return {
        edScroll: ed ? ed.scrollTop : null, edH: ed ? ed.scrollHeight : null,
        pvScroll: pv ? pv.scrollTop : null, pvH: pv ? pv.scrollHeight : null,
        pvHeadCount: heads.length,
        cmRenderedHeadCount: cmHeads.length,
        // what is at the top of each viewport
        edTopLine: (() => {
          if (!ed) return null;
          const y = ed.getBoundingClientRect().top + 4;
          const el = document.elementsFromPoint(400, y).find(e => e.classList && e.classList.contains('cm-line'));
          return el ? (el.textContent||'').slice(0, 60) : null;
        })(),
        pvTopEl: (() => {
          if (!pv) return null;
          const r = pv.getBoundingClientRect();
          const el = document.elementsFromPoint(r.left + r.width/2, r.top + 4).find(e => e.parentElement && e.parentElement.classList.contains('preview'));
          return el ? (el.textContent||'').slice(0, 60) : null;
        })(),
      };
    }"""

    print("heads(preview) vs rendered cm heads:", page.evaluate(probe))
    ed_h = page.evaluate("document.querySelector('main').scrollHeight")
    for frac in [0.0, 0.2, 0.4, 0.6, 0.8, 0.95]:
        page.evaluate(f"document.querySelector('main').scrollTop = {frac} * (document.querySelector('main').scrollHeight - document.querySelector('main').clientHeight)")
        time.sleep(0.6)
        r = page.evaluate(probe)
        print(f"\nfrac {frac}")
        print("  editor top:", r["edTopLine"])
        print("  preview top:", r["pvTopEl"])
    page.screenshot(path="_tmp/split.png", full_page=False)
    b.close()
