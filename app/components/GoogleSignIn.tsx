import { useEffect, useRef, useState } from "react";

/**
 * Google sign-in control. Renders the Google Identity Services button when
 * sign-in is configured (GOOGLE_SIGNIN_CLIENT_ID set) and the user is signed
 * out, the signed-in email plus a sign-out link when signed in, and nothing at
 * all when sign-in is not configured (so the passphrase flow is unaffected).
 */
type GsiId = {
  initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, string>) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

export default function GoogleSignIn() {
  const [email, setEmail] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);

  // Load the current session and the configured client id.
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/google")
      .then((r) => r.json() as Promise<{ email: string | null; clientId: string | null }>)
      .then((d) => {
        if (cancelled) return;
        setEmail(d.email);
        setClientId(d.clientId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // When configured and signed out, load the GIS script and render the button.
  useEffect(() => {
    if (!clientId || email) return;
    let removed = false;
    const render = () => {
      const id = window.google?.accounts?.id;
      if (!id || !btnRef.current || removed) return;
      id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          if (!resp.credential) return;
          const r = await fetch("/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: resp.credential }),
          });
          if (r.ok) {
            const d = (await r.json()) as { email?: string };
            setEmail(d.email ?? null);
          }
        },
      });
      id.renderButton(btnRef.current, { type: "standard", size: "medium", theme: "outline", text: "signin_with" });
    };

    if (window.google?.accounts?.id) {
      render();
      return;
    }
    let script = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.id = "gsi-script";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => {
      removed = true;
      script?.removeEventListener("load", render);
    };
  }, [clientId, email]);

  const signOut = async () => {
    await fetch("/auth/logout", { method: "POST" });
    setEmail(null);
  };

  if (!clientId) return null; // sign-in not configured: passphrase mode, no UI
  if (email) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="max-w-[14rem] truncate" title={email}>
          {email}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="cursor-pointer underline-offset-2 hover:text-ink hover:underline"
        >
          Sign out
        </button>
      </div>
    );
  }
  return <div ref={btnRef} />;
}
