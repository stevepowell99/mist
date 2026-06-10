import { useState, useEffect, useCallback } from "react";
import { USER_COLOURS } from "~/shared/constants";
import type { UserInfo } from "~/shared/types";

const STORAGE_KEY = "mist-user";

function randomUser(): UserInfo {
  const c = USER_COLOURS[Math.floor(Math.random() * USER_COLOURS.length)];
  return {
    name: `User ${Math.floor(Math.random() * 1000)}`,
    color: c.color,
    colorLight: c.light,
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
 * cursors and comment authorship. Shared across all documents.
 */
export function useUserIdentity() {
  const [user, setUser] = useState<UserInfo>(PLACEHOLDER);

  useEffect(() => {
    let initial: UserInfo;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      initial = stored ? (JSON.parse(stored) as UserInfo) : randomUser();
    } catch {
      initial = randomUser();
    }
    setUser(initial); // eslint-disable-line react-hooks/set-state-in-effect
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  }, []);

  const setName = useCallback((name: string) => {
    setUser((prev) => {
      const next = { ...prev, name: name.trim() || prev.name };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { user, setName };
}
