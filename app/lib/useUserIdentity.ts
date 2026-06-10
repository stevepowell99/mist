import { useState, useEffect, useCallback } from "react";
import { USER_COLOURS } from "~/shared/constants";
import type { UserInfo } from "~/shared/types";

const STORAGE_KEY = "mist-user";

interface StoredUser extends UserInfo {
  /** True once the user has deliberately set their own name */
  named?: boolean;
}

function randomUser(): StoredUser {
  const c = USER_COLOURS[Math.floor(Math.random() * USER_COLOURS.length)];
  return {
    name: `User ${Math.floor(Math.random() * 1000)}`,
    color: c.color,
    colorLight: c.light,
    named: false,
  };
}

// Deterministic first paint so server and client markup agree; the real
// identity is loaded from localStorage (or generated) after hydration.
const PLACEHOLDER: UserInfo = {
  name: "User",
  color: USER_COLOURS[0].color,
  colorLight: USER_COLOURS[0].light,
};

/**
 * Persistent per-browser identity (name and colour) used for collaboration
 * cursors and comment authorship. Shared across all documents. `needsName` is
 * true until the user has chosen a name, so the UI can prompt on first visit.
 */
export function useUserIdentity() {
  const [user, setUser] = useState<UserInfo>(PLACEHOLDER);
  const [needsName, setNeedsName] = useState(false);

  useEffect(() => {
    let initial: StoredUser;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      initial = stored ? (JSON.parse(stored) as StoredUser) : randomUser();
    } catch {
      initial = randomUser();
    }
    setUser({ name: initial.name, color: initial.color, colorLight: initial.colorLight }); // eslint-disable-line react-hooks/set-state-in-effect
    setNeedsName(!initial.named);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  }, []);

  const persist = useCallback((u: UserInfo) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...u, named: true }));
  }, []);

  const setName = useCallback(
    (name: string) => {
      setUser((prev) => {
        const next = { ...prev, name: name.trim() || prev.name };
        persist(next);
        return next;
      });
      setNeedsName(false);
    },
    [persist],
  );

  // Keep the generated identity but stop prompting (user dismissed the prompt)
  const dismissNamePrompt = useCallback(() => {
    setUser((prev) => {
      persist(prev);
      return prev;
    });
    setNeedsName(false);
  }, [persist]);

  return { user, setName, needsName, dismissNamePrompt };
}
