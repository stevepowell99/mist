import type { Route } from "./+types/drive.asset-token";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  canAccessFile,
  driveForbidden,
  mintDeckToken,
  openDriveRequest,
  type DriveSessionEnv,
} from "~/lib/drive-access.server";
import { json } from "~/lib/http.server";

/**
 * A fresh deck token for a document that is already open. The token the page
 * loader mints lasts six hours, and the sandboxed slides preview can load the
 * file's images and css only with it, so a tab left open longer loses every
 * image until it is reloaded. The open page asks here for the next token (see
 * useFreshAssetToken). The check is the one the loader made: a signed-in viewer
 * the file's Drive sharing admits.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const sessionEnv = env as unknown as DriveSessionEnv;
  const gate = await openDriveRequest(request, sessionEnv);
  if ("error" in gate) return gate.error;

  const deck = new URL(request.url).searchParams.get("deck");
  if (!deck) return json({ error: "missing deck" }, 400);
  const email = gate.access.email;
  if (!(await canAccessFile(sessionEnv, deck, email))) return driveForbidden();

  const token = await mintDeckToken(sessionEnv, deck, email);
  if (!token) return json({ error: "no token" }, 501);
  return json({ token });
}
