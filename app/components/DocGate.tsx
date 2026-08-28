import { Link } from "react-router";
import { APP_NAME } from "~/shared/constants";
import GoogleSignIn from "~/components/GoogleSignIn";

/**
 * Sign-in / no-access screen shown instead of a document when the viewer is not
 * authorised for the underlying Drive file. The WebSocket is gated server-side
 * regardless, so this is the friendly face of that gate.
 *
 * Shared by `/docs/:id` and `/open`. Both are links a collaborator receives from
 * someone else, so both must land a signed-out visitor on something they can act
 * on. `/open` used to answer a bare 401 with a JSON body, which reads as a broken
 * link to whoever was sent it.
 */
export default function DocGate({ kind }: { kind: "needsAuth" | "forbidden" }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-paper p-6 text-center">
      <Link to="/" className="rounded bg-ink px-3 py-1.5 font-medium text-paper hover:bg-chartreuse hover:text-[#1a1a1a]">
        {APP_NAME}
      </Link>
      {kind === "needsAuth" ? (
        <>
          <p className="max-w-sm text-ink">
            This file is private. Sign in with the Google account it is shared with to open it.
          </p>
          <GoogleSignIn onSignedIn={() => window.location.reload()} />
        </>
      ) : (
        <p className="max-w-sm text-ink">
          You do not have access to this file. Ask the owner to share it with your Google
          account in Google Drive, then reload.
        </p>
      )}
    </div>
  );
}
