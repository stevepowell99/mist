import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { shareLink } from "~/components/ShareButton";

/**
 * Copy this room's share link on arrival, when the URL carries `?share=`.
 *
 * The point is a one-click "hand this file to someone" from an external tool.
 * TagFox cannot build a share link itself: it holds no gmist credentials by
 * design, and minting a room needs the browser's own session cookie. So the
 * round trip has to happen in the browser, and this is the browser's half of it
 * — `/open?file=<id>&share=suggest` lands here with the link already on the
 * clipboard, ready to paste into Slack.
 *
 * Never assume the copy worked. `navigator.clipboard` is absent in an insecure
 * context and a write without user activation is refused outright by some
 * browsers, so a failure shows the link with a manual button rather than a
 * cheerful message about a clipboard that holds something else.
 */

/** `1`, an empty value, or anything unrecognised means suggest. Suggest is the
 *  safe default: a reviewer who cannot rewrite the file underneath you. */
function wantedRole(raw: string): "edit" | "suggest" {
  return raw === "edit" ? "edit" : "suggest";
}

export default function ShareOnOpen() {
  const { role, docKey, suggestKey } = useDocument();
  const [link, setLink] = useState<string | null>(null);
  const [kind, setKind] = useState<"edit" | "suggest">("suggest");
  const [state, setState] = useState<"copied" | "manual">("manual");

  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("share");
    if (raw === null) return;

    // Strip the parameter before doing anything else, so a reload does not copy
    // again and the URL in the address bar is the ordinary room URL.
    url.searchParams.delete("share");
    window.history.replaceState(null, "", url.toString());

    // A suggest-role opener holds only their own key, so they can pass on only
    // what they have. An edit-role opener can hand out either.
    const want = wantedRole(raw);
    const key = role === "edit" ? (want === "edit" ? docKey : suggestKey ?? docKey) : docKey;
    const granted: "edit" | "suggest" = role === "edit" && want === "edit" ? "edit" : "suggest";
    const href = shareLink(url.toString(), key, false);
    setKind(granted);
    setLink(href);

    if (!navigator.clipboard) {
      setState("manual");
      return;
    }
    navigator.clipboard.writeText(href).then(
      () => setState("copied"),
      () => setState("manual"),
    );
  }, [role, docKey, suggestKey]);

  // Once it is on the clipboard the notice has done its job, so it goes away on
  // its own. A failed copy stays until dismissed, because the link is the only
  // copy of itself the user has.
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setLink(null), 6000);
    return () => clearTimeout(t);
  }, [state]);

  const copyAgain = useCallback(() => {
    if (!link || !navigator.clipboard) return;
    navigator.clipboard.writeText(link).then(
      () => setState("copied"),
      () => setState("manual"),
    );
  }, [link]);

  if (!link) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 border border-border bg-paper p-3 text-sm text-ink shadow-lg">
      <div className="flex items-center gap-3">
        <span>
          {state === "copied"
            ? `${kind === "edit" ? "Edit" : "Suggest"} link copied`
            : `${kind === "edit" ? "Edit" : "Suggest"} link ready, copy it by hand`}
        </span>
        <button
          onClick={() => setLink(null)}
          className="ml-auto cursor-pointer px-2 text-muted hover:text-ink"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {state === "manual" && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 border border-border bg-paper px-2 py-1 font-mono text-xs"
          />
          <button
            onClick={copyAgain}
            className="cursor-pointer border border-border px-2 py-1 text-xs uppercase tracking-wider hover:bg-border"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
