/** JSON Response helper shared by the route handlers, so each route does not
 *  redefine its own. Optional extra headers (e.g. Set-Cookie) merge in. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Never cached by default. These responses are the current state of a file
    // or a folder, asked for again precisely because it may have changed; a
    // browser heuristically caching one shows the editor an older version of the
    // document than the one on disk, and silences the poll that watches for
    // outside edits. A route that genuinely wants caching passes its own header.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
