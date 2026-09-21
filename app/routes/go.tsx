import type { Route } from "./+types/go";
import { APP_NAME } from "~/shared/constants";
import { QuickOpen } from "~/components/QuickOpen";

/**
 * Bare launcher page: nothing but the Spotlight quick-open palette, full screen
 * and autofocused. An OS hotkey opens this URL (Steve's is Ctrl+Alt+K, bound in
 * stevekeys.ahk); the signed-in browser session handles auth and the import, so
 * the launcher itself holds no credentials. Opening a file navigates this tab to
 * the room.
 */

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Open: ${APP_NAME}` }];
}

export default function Go(_props: Route.ComponentProps) {
  // `?q=` prefills the search. Local-fs mode's Online button sends the file's
  // name here: a Drive-mirrored path carries no Drive id (mirror mode writes no
  // `:user.drive.id` stream), and local mode holds no Drive credentials to look
  // one up with, so the name is all it can pass. The palette then resolves it
  // in the browser, which IS signed in.
  const q = typeof window === "undefined" ? "" : new URL(window.location.href).searchParams.get("q") ?? "";
  // No onClose: this page IS the palette, so there is nothing to close back to.
  return <QuickOpen initialQuery={q} />;
}
