/** JSON Response helper shared by the route handlers, so each route does not
 *  redefine its own. Optional extra headers (e.g. Set-Cookie) merge in. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
