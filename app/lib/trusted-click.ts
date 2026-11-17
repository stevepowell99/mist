/**
 * A click handler that runs only for a click a person made. Browser extensions
 * that dismiss cookie banners click any button labelled "Reject" or "Accept" as
 * soon as it appears, with a synthetic event (`isTrusted` false), and a
 * suggestion's Reject button looks exactly like one: every pending suggestion
 * was rejected a moment after the page loaded, and the loss then autosaved.
 * Every Accept and Reject control goes through this.
 */
export function trustedClick(run: () => void): (e: { isTrusted: boolean }) => void {
  return (e) => {
    if (e.isTrusted) run();
  };
}
