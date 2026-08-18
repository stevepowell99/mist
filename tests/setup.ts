// jsdom gaps that every component test would otherwise hit. jsdom implements no
// layout, so it has no scrollIntoView at all; a component that scrolls a panel
// into view (ThreadPanel, the aside sync) threw on mount rather than failing an
// assertion, which reads as a broken component instead of a missing stub.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
