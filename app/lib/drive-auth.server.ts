/**
 * Interim access gate for the /drive/* endpoints. They run as the relay's Drive
 * identity, so until Google sign-in and the per-file ACL check land they are
 * guarded by one shared passphrase (the DRIVE_ACCESS_KEY Worker secret). The
 * client sends it as the X-Drive-Key header, or as a ?token= query param where a
 * header cannot be set (the slides iframe's asset links). See plans/live-collab.md.
 */
export function driveKeyOk(request: Request, env: { DRIVE_ACCESS_KEY?: string }): boolean {
  const expected = env.DRIVE_ACCESS_KEY;
  if (!expected) return false; // fail closed until the secret is configured
  const provided =
    request.headers.get("x-drive-key") ??
    new URL(request.url).searchParams.get("token");
  return provided === expected;
}

/** A 401 response for a missing or wrong Drive passphrase. */
export function driveUnauthorized(): Response {
  return new Response(JSON.stringify({ error: "drive access denied" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
