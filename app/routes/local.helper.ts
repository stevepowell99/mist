import type { Route } from "./+types/local.helper";
import { getCloudflare } from "~/lib/cloudflare.server";
import { openDriveRequest } from "~/lib/drive-access.server";
import { isLocalMode, localHelperAsk, localHelperCancel } from "~/lib/google.server";
import { json } from "~/lib/http.server";
import {
  HELPER_SCHEMA,
  HELPER_SYSTEM,
  MAX_DOCUMENT_CHARS,
  helperPrompt,
  parseHelperReply,
  type HelperRequest,
} from "~/lib/helper-prompt";

/**
 * One helper turn: the document and the ask in, the reply and its edits out.
 *
 * The edits are not applied here. The browser holds the document, and the user
 * may have typed while the model was thinking, so the panel applies them to the
 * editor as it is when the answer arrives (`planHelperEdits`). This route only
 * composes the prompt, runs the model through the sidecar and reads the reply.
 * A body of `{ cancel: id }` stops the run the panel started with that id.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!isLocalMode(env)) return json({ error: "the helper runs in local gmist only" }, 404);
  const gate = await openDriveRequest(request, env);
  if ("error" in gate) return json({ error: "forbidden" }, gate.error.status);

  let req: HelperRequest & { id?: string; cancel?: string };
  try {
    req = (await request.json()) as HelperRequest & { id?: string; cancel?: string };
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (typeof req?.cancel === "string") {
    try {
      return json(await localHelperCancel(env, req.cancel));
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "stop failed" }, 502);
    }
  }
  if (typeof req?.document !== "string" || typeof req.message !== "string" || !req.message.trim()) {
    return json({ error: "a document and a message are required" }, 400);
  }
  if (req.document.length > MAX_DOCUMENT_CHARS) {
    return json(
      { error: `This document is ${req.document.length.toLocaleString("en-GB")} characters, more than the helper's ${MAX_DOCUMENT_CHARS.toLocaleString("en-GB")}.` },
      413,
    );
  }

  const prompt = helperPrompt({
    name: String(req.name ?? ""),
    document: req.document,
    selection: typeof req.selection === "string" && req.selection ? req.selection : undefined,
    mode: req.mode === "suggest" ? "suggest" : "edit",
    history: Array.isArray(req.history) ? req.history.filter((m) => m && typeof m.text === "string") : [],
    message: req.message,
  });
  try {
    const id = typeof req.id === "string" ? req.id : undefined;
    const out = await localHelperAsk(env, { system: HELPER_SYSTEM, prompt, schema: HELPER_SCHEMA, id }, request.signal);
    return json({ ...parseHelperReply(out.text), durationMs: out.durationMs, model: out.model });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "the helper failed" }, 502);
  }
}
