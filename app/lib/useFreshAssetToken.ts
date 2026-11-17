import { useEffect, useState } from "react";

/** Ask for the next token well inside the six hours a deck token lasts
 *  (ASSET_TTL_SECONDS in session.server.ts). */
const REFRESH_AFTER_MS = 4 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * The deck token for an open document, replaced before it expires. The loader
 * mints one per page load; a tab that stays open past its expiry would lose
 * every image and stylesheet in the slides preview. The age is checked on a
 * timer and whenever the tab becomes visible, which covers a laptop that slept
 * through the timer.
 */
export function useFreshAssetToken(initial: string | null, deck: string | null | undefined): string | null {
  const [token, setToken] = useState(initial);

  useEffect(() => {
    setToken(initial);
    if (!initial || !deck) return;
    let mintedAt = Date.now();
    let busy = false;
    let stopped = false;

    const refresh = async () => {
      if (busy || Date.now() - mintedAt < REFRESH_AFTER_MS) return;
      busy = true;
      try {
        const res = await fetch(`/drive/asset-token?deck=${encodeURIComponent(deck)}`);
        const body = res.ok ? ((await res.json()) as { token?: string }) : null;
        if (stopped) return;
        if (body?.token) {
          setToken(body.token);
          mintedAt = Date.now();
        } else {
          console.warn(`[gmist] image token not refreshed (${res.status}); reload if images disappear`);
        }
      } catch (err) {
        console.warn("[gmist] image token not refreshed; reload if images disappear", err);
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(refresh, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initial, deck]);

  return token;
}
