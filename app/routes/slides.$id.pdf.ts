import type { Route } from "./+types/slides.$id.pdf";
import { getCloudflare } from "~/lib/cloudflare.server";
import { printPdf } from "~/lib/pdf.server";

/**
 * A deck as a PDF file, printed by headless Chrome from the same
 * `/slides/:id?print-pdf` page the browser's own print uses (see pdf.server.ts).
 * Takes the same `k` / `token` / `combine-fragments` parameters as `/slides/:id`
 * and passes them through, so it is gated exactly as that page is.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const url = new URL(request.url);
  const deck = new URL(`/slides/${params.id}`, url.origin);
  for (const [k, v] of url.searchParams) if (k !== "render") deck.searchParams.set(k, v);
  deck.searchParams.set("print-pdf", "");
  return printPdf({
    env,
    request,
    page: deck,
    fallback: new URL(deck),
    noun: "deck",
    label: params.id,
    viewport: { width: 1280, height: 720 },
  });
}
