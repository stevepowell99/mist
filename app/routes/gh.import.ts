import type { Route } from "./+types/gh.import";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GitHub import is disabled (14 June 2026): mist must not sync via git when a
 * file also lives in Google Drive (it was double-syncing and corrupting files).
 * Drive is the only path. Re-enable when the document model is proven safe.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  return json({ error: "GitHub import is disabled; open files from Google Drive instead" }, 410);
}
