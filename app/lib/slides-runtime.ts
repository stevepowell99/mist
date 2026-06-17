/**
 * The in-iframe runtime for the slides deck: reveal init, the cursor-driven
 * goto sync, in-place rerender (destroy + reinitialize), the overview wheel
 * scroll, the entrance-animation replay and the modifier-chord forwarding. Split
 * out of slides-build.ts (which now only assembles the HTML shell) so each half
 * stays readable. Returns the <script> body as a string; the three interpolated
 * values are the only deck-specific config.
 */
export function deckRuntimeScript(opts: {
  slideNumber: string;
  navigationMode: string;
  separateFragments: boolean;
}): string {
  const { slideNumber, navigationMode, separateFragments } = opts;
  return `// scrollActivationWidth:null stops reveal v5 auto-switching to scroll view in a
// narrow pane (the split), which in a sandboxed iframe hits sessionStorage and
// blanks the deck.
// width/height fix a 16:9 widescreen slide that reveal scales as a unit, so the
// preview letterboxes instead of reflowing to the pane shape.
// Keep reveal's own controls, progress bar, overview (O) and keyboard
// shortcuts (F fullscreen, S notes, arrows) on, and add the hamburger menu
// plugin if it loaded (best-effort, like Quarto's decks).
var revealPlugins=[RevealMarkdown,RevealNotes];
// Cursor-driven sync: the editor posts {type:"mist-goto", h} as the cursor
// moves and after each rebuild. Buffer the target so a message that arrives
// before reveal is ready (e.g. right after the iframe reloads) still lands,
// which is what keeps an edit from snapping the deck back to slide 1.
var pendingGoto = null, pendingFrag = -1, revealReady = false;
// The deck and waiter overlay are set up by the early script above (hidden while
// embedded). showDeck() lifts the waiter and reveals the deck once it has
// rendered and jumped to the right slide, so the cover slide never flashes.
var deckEl = document.querySelector('.reveal');
var loadingEl = document.getElementById('mist-loading');
var deckShown = false;
// Replay the entrance animations (.flare, standalone .cascade) on the current
// slide. The deck is hidden behind the waiter while it loads and jumps to the
// cursor's slide, and again during every in-place rebuild, so a flare's intro
// plays unseen and the deck appears with it already filled (the "flares don't
// animate" report). Re-run them once the deck is actually visible / on a slide
// change: toggling animation off, forcing a reflow, then back restarts the
// CSS-defined animation from the start.
function replayEntrance(){
  try {
    var slide = Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    if (!slide) return;
    var els = slide.querySelectorAll('.flare, .cascade-2, .cascade-3, .cascade-4, .cascade-5');
    for (var i = 0; i < els.length; i++) {
      els[i].style.animation = 'none';
      void els[i].offsetWidth; // force reflow so the restart takes
      els[i].style.animation = '';
    }
  } catch (e) {}
}
function showDeck(){
  if (deckShown || !revealReady) return;
  deckShown = true;
  if (deckEl) deckEl.style.visibility = '';
  if (loadingEl) loadingEl.style.display = 'none';
  requestAnimationFrame(replayEntrance);
}
// The editor sends a flat slide index (its split is flat). With 2D nesting a
// flat index is not reveal's horizontal index, so map it through the slide
// element to reveal's (h,v). f is the reveal fragment to reveal up to (the
// editor's cursor fragment), or <0 for none, so the deck follows the cursor down
// to the fragment being edited.
function gotoFlat(n, f){
  var slides = Reveal.getSlides();
  if (!slides.length) return;
  if (n < 0) n = 0; else if (n >= slides.length) n = slides.length - 1;
  var idx = Reveal.getIndices(slides[n]);
  var cur = Reveal.getIndices();
  // Only navigate when the slide actually changes, and then with no transition
  // (the cursor-driven follow should snap, not animate). Re-navigating the same
  // slide would reset its fragments and flash.
  if (cur.h !== idx.h || cur.v !== idx.v) {
    document.body.classList.add('no-anim');
    Reveal.slide(idx.h, idx.v);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ document.body.classList.remove('no-anim'); }); });
  }
  // Drive fragments explicitly. Reveal.slide's fragment argument only lands on a
  // slide change, so moving the cursor between fragments of the SAME slide needs
  // this. navigateFragment(index) jumps straight to a fragment index (reveal v5);
  // fall back to stepping with next/prevFragment. Both act on the current slide.
  var target = (typeof f === 'number') ? f : -1;
  if (typeof Reveal.navigateFragment === 'function') {
    Reveal.navigateFragment(target);
  } else {
    var fi = Reveal.getIndices().f; if (typeof fi !== 'number') fi = -1;
    var guard = 0;
    while (fi < target && guard++ < 500 && Reveal.nextFragment()) fi++;
    while (fi > target && guard++ < 500 && Reveal.prevFragment()) fi--;
  }
}
function applyGoto(){ if (revealReady && pendingGoto != null) gotoFlat(pendingGoto, pendingFrag); }
// Mermaid is best-effort and must never block reveal. Skip the import entirely
// unless the deck actually has a mermaid block, which saves loading and running
// a large module on a deck that has none. Reused by init and in-place rerender.
async function runMermaid(){
  if (!document.querySelector("code.language-mermaid")) return 0;
  var mt = performance.now ? performance.now() : 0;
  try {
    const m = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    m.default.initialize({ startOnLoad: false, theme: "neutral" });
    document.querySelectorAll("code.language-mermaid").forEach(function (c) {
      const d = document.createElement("div");
      d.className = "mermaid";
      d.textContent = c.textContent || "";
      (c.closest("pre") || c).replaceWith(d);
    });
    await m.default.run({ querySelector: ".mermaid" });
    Reveal.layout();
  } catch (e) { /* slides render fine without mermaid */ }
  return Math.round((performance.now ? performance.now() : 0) - mt);
}
// Shared reveal config and handlers, used by both the initial boot and the
// in-place rebuild so both produce an identical deck.
// center:false matches Quarto (reveal's own default is true). With centring on,
// every slide's content block is vertically centred, which drags a
// bottom-pinned .shot-cap caption up to the middle; off, slides top-align.
// keyboard:{27:null} unbinds Esc so it no longer toggles overview: in fullscreen
// the browser swallows Esc (it exits fullscreen), so leaving Esc on overview made
// it work in one place and not the other. Overview is now O only (reveal default).
var REVEAL_CONFIG = {plugins:revealPlugins,hash:false,controls:true,progress:true,slideNumber:${slideNumber},keyboard:{27:null},overview:true,center:false,navigationMode:'${navigationMode}',pdfSeparateFragments:${separateFragments},scrollActivationWidth:null,width:1280,height:720};
function relayout(){ try { Reveal.layout(); } catch (e) {} }
// Re-run layout across a few frames. In a sandboxed iframe reveal can init
// before the pane has its real size, leaving the deck unscaled; these catch it.
function relayoutBurst(){ relayout(); requestAnimationFrame(relayout); setTimeout(relayout, 120); setTimeout(relayout, 400); }
// Report the current slide to the parent as a flat index (matching the editor's
// flat split) so the URL ?slide= round-trips through 2D nesting.
var slideChangedHandler = function(){ try { parent.postMessage({ type: 'mist-slide', h: Reveal.getSlides().indexOf(Reveal.getCurrentSlide()) }, '*'); } catch (e) {} replayEntrance(); };

// In-place rebuild: swap the .slides markup, then DESTROY and re-initialise
// reveal, so the deck is rebuilt by the EXACT same path as a fresh load. Running
// only the markdown plugin (md.init) re-processed the sections wrongly and
// inflated the slide count, which shifted every index; a full re-init produces
// the same slide list the reload path does. The CDN scripts stay loaded, so it
// is still far cheaper than reloading the iframe.
var rerendering = false;
// The latest render that arrived before reveal was ready (or while a rebuild was
// in flight). Buffer it instead of dropping it, so content posted in the gap
// after a reload (deploy / stale-tab reconnect) is not lost, which showed as a
// blank preview that needed several reloads. Drained when ready / on finish.
var pendingRender = null;
function drainRender(){
  if (pendingRender) { var pr = pendingRender; pendingRender = null; rerender(pr.html, pr.target); }
}
async function rerender(html, target){
  if (!revealReady || rerendering) { pendingRender = { html: html, target: target }; return; }
  var slidesEl = document.querySelector(".slides");
  if (!slidesEl) return;
  rerendering = true;
  // Where the deck shows now, captured before the rebuild. For a content edit
  // (slide count unchanged) we return to exactly this slide.
  var before = Reveal.getSlides().length;
  var shown = Reveal.getSlides().indexOf(Reveal.getCurrentSlide());
  // Hide the deck while it re-initialises: destroy + initialize resets reveal to
  // slide 0 and paints it before we jump back, which flashes the cover slide.
  // Revealing only after the jump means the rebuild lands silently on the right
  // slide. Width/height are preserved (visibility, not display), so layout holds.
  if (deckEl) deckEl.style.visibility = 'hidden';
  revealReady = false;
  // try/finally so a throw in destroy/initialize/goto can never leave the deck
  // hidden (which showed as no preview at all). The deck is always revealed.
  try {
    try { Reveal.off('slidechanged', slideChangedHandler); } catch (e) {}
    try { await Reveal.destroy(); } catch (e) {}
    slidesEl.innerHTML = html;
    await Reveal.initialize(REVEAL_CONFIG);
    if (Reveal.sync) Reveal.sync();
    Reveal.on('slidechanged', slideChangedHandler);
    relayoutBurst();
    var after = Reveal.getSlides().length;
    // Content edit: keep the shown slide. Structural edit (count changed): the
    // shown index has shifted, so use the parent's cursor-derived target.
    var dest = (after === before && shown >= 0)
      ? shown
      : (typeof target === "number" && target >= 0 ? target : shown);
    if (dest >= 0) { pendingGoto = dest; gotoFlat(dest); }
    Reveal.layout();
  } catch (e) {
    // best-effort: leave whatever rendered rather than wedging the deck
  } finally {
    revealReady = true;
    if (deckEl) deckEl.style.visibility = '';
    requestAnimationFrame(replayEntrance); // animate flares now the deck is visible
    rerendering = false;
  }
  await runMermaid();
  drainRender(); // apply a render that arrived during this rebuild
}
window.addEventListener("message", function(e){
  if (!e.data) return;
  if (e.data.type === "mist-goto" && typeof e.data.h === "number") {
    pendingGoto = e.data.h; pendingFrag = (typeof e.data.f === "number") ? e.data.f : -1; applyGoto(); showDeck();
  } else if (e.data.type === "mist-render" && typeof e.data.sections === "string") {
    rerender(e.data.sections, typeof e.data.goto === "number" ? e.data.goto : null);
  }
});
// Forward mod+alt layout shortcuts to the parent: this sandboxed iframe has its
// own window, so its key events never reach the app otherwise. Reveal's own keys
// carry no modifier, so they are untouched.
window.addEventListener("keydown", function(e){
  var alt = e.altKey || (e.getModifierState && e.getModifierState("AltGraph"));
  if (!(e.ctrlKey || e.metaKey) || !alt) return;
  var c = e.code, chord = null;
  if (c.indexOf("Key") === 0) chord = c.slice(3).toLowerCase();
  else if (c.indexOf("Digit") === 0) chord = c.slice(5);
  else if (c.indexOf("Numpad") === 0 && /\\d$/.test(c)) chord = c.slice(-1);
  else if (c === "BracketLeft") chord = "[";
  else if (c === "BracketRight") chord = "]";
  else if (c === "Minus") chord = "-";
  else if (c === "Equal") chord = "=";
  else if (c === "Slash") chord = "/";
  if (chord) {
    // Stop reveal's own keydown (S notes, F fullscreen, O overview) from also
    // firing on the same chord; we are in capture, so this pre-empts it.
    e.preventDefault();
    e.stopImmediatePropagation();
    parent.postMessage({ type: "mist-key", chord: chord }, "*");
  }
}, true);
// In overview, let the mouse wheel scroll through slides. Reveal navigates the
// overview grid by arrow keys only and the pane has no scrollbar, so a plain
// wheel does nothing. Accumulate scroll distance and step one slide per notch's
// worth (~100px), so a fast scroll flies through many slides rather than crawling
// one-per-throttle-tick. deltaMode 1 (lines) / 2 (pages) report small numbers, so
// scale them up to the pixel threshold.
var wheelAccum = 0;
window.addEventListener("wheel", function(e){
  if (!(Reveal.isOverview && Reveal.isOverview())) return;
  e.preventDefault();
  var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  wheelAccum += d;
  while (wheelAccum >= 100) { Reveal.next(); wheelAccum -= 100; }
  while (wheelAccum <= -100) { Reveal.prev(); wheelAccum += 100; }
}, { passive: false });
Reveal.initialize(REVEAL_CONFIG).then(async function(){
  // Rebuild slide backgrounds: the markdown plugin sets data-background-image
  // (from the <!-- .slide: --> comment) during init, after reveal first built
  // its background layer, so without a sync the backgrounds come up blank.
  if (Reveal.sync) Reveal.sync();
  revealReady = true; applyGoto();
  // Reveal only once we are on the right slide, so the cover slide never flashes.
  // If the goto already arrived, reveal now. Otherwise ASK the parent for the
  // slide to open on (a pull, reliable because our listener is attached) and
  // reveal when it answers (handled in the message listener). A long safety
  // timeout reveals regardless, so a missing answer can never leave a rendered
  // deck hidden behind the white overlay.
  if (pendingGoto != null) {
    showDeck();
  } else {
    try { parent.postMessage({ type: "mist-need-goto" }, "*"); } catch (e) {}
    setTimeout(showDeck, 1500);
  }
  Reveal.on('slidechanged', slideChangedHandler);
  relayoutBurst();
  // ResizeObserver / resize live on body+window (not cleared by Reveal.destroy),
  // so attach them once here, not on every in-place rebuild.
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(document.body);
  window.addEventListener("resize", relayout);
  await runMermaid();
  drainRender(); // apply any render that arrived before reveal finished booting
});`;
}
