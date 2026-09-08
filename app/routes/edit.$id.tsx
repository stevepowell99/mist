import { data } from "react-router";
import type { Route } from "./+types/edit.$id";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { driveGetMeta, getDriveAccessToken, isLocalMode } from "~/lib/google.server";
import { isLocalFileId } from "~/lib/localfs-ids";
import PlainEditor from "~/components/PlainEditor";

/**
 * The plain local editor: a file, and a buffer that is a view of it.
 *
 * Deliberately its own route rather than a mode of /docs/:id. That page carries
 * a Yjs document, an awareness protocol and a save machine built for a shared
 * Drive room, and every one of them assumes the document lives in the app with
 * the file as somewhere to push it. This one assumes the opposite, and the two
 * assumptions cannot share a component. See plans/local-editor.md.
 */
export function meta({ data: d }: Route.MetaArgs) {
  const name = d && "name" in d ? d.name : "gmist";
  return [{ title: name }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) throw data("the plain editor is local-mode only", { status: 404 });

  const gate = await openDriveRequest(request, env);
  if ("error" in gate) throw data("forbidden", { status: gate.error.status });

  const id = params.id;
  if (!isLocalFileId(id)) throw data("not a local file", { status: 404 });

  try {
    const meta = await driveGetMeta(await getDriveAccessToken(env), id);
    return { id, name: meta.name };
  } catch {
    throw data("file not found", { status: 404 });
  }
}

export default function EditPage({ loaderData }: Route.ComponentProps) {
  return <PlainEditor fileId={loaderData.id} name={loaderData.name} />;
}
