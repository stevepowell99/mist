import type { Route } from "./+types/print.$id.pdf";
import { isValidDocumentId } from "~/shared/constants";
import { isLocalFileId } from "~/lib/localfs-ids";
import { resolveDoc } from "~/lib/doc-resolve.server";
import { getCloudflare } from "~/lib/cloudflare.server";
import { authorizeDoc, mintAssetTokenForDoc, type DriveSessionEnv } from "~/lib/drive-access.server";
import { printPdf } from "~/lib/pdf.server";

/**
 * A document as a PDF file, printed by headless Chrome from its `/print/:id`
 * page (see pdf.server.ts). The viewer asking must pass the file's Drive sharing,
 * as they must to open the page itself; the headless browser has no session, so
 * it is given a short-lived asset token in their place. The fallback sends the
 * viewer's own browser to the page with `autoprint`, and carries no token.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id) && !isLocalFileId(id)) return new Response("Not found.", { status: 404 });
  const { env } = getCloudflare(context);
  const sessionEnv = env as unknown as DriveSessionEnv;
  const url = new URL(request.url);
  const key = url.searchParams.get("k") ?? "";

  const { role, drive } = await resolveDoc(env, id, key);
  const auth = await authorizeDoc(sessionEnv, request, drive, role);
  if (auth.status === "badkey") return new Response("Not found.", { status: 404 });
  if (auth.status === "needsAuth") return new Response("Sign in to gmist to print this document.", { status: 401 });
  if (auth.status === "forbidden") return new Response("You do not have access to this file.", { status: 403 });

  const fallback = new URL(`/print/${id}`, url.origin);
  fallback.searchParams.set("k", key);
  const page = new URL(fallback);
  page.searchParams.set("token", (await mintAssetTokenForDoc(sessionEnv, true)) ?? "");
  fallback.searchParams.set("autoprint", "");
  return printPdf({
    env,
    request,
    page,
    fallback,
    noun: "document",
    label: id,
    // A4 at 96 dpi, so diagrams are drawn at the width they print at.
    viewport: { width: 794, height: 1123 },
  });
}
