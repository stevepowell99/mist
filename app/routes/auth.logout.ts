import type { Route } from "./+types/auth.logout";
import { clearSessionCookieHeader } from "~/lib/session.server";

/** Clear the session cookie. POST so a stray prefetch cannot log the user out. */
export async function action(_args: Route.ActionArgs) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookieHeader(),
    },
  });
}
