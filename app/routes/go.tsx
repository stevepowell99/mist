import type { Route } from "./+types/go";
import { APP_NAME } from "~/shared/constants";
import { QuickOpen } from "~/components/QuickOpen";

/**
 * Bare launcher page: nothing but the Spotlight quick-open palette, full screen
 * and autofocused. An OS hotkey (see scripts/gmist-launcher.ahk) opens this URL;
 * the signed-in browser session handles auth and the import, so the launcher
 * itself holds no credentials. Opening a file navigates this tab to the room.
 */

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Open: ${APP_NAME}` }];
}

export default function Go(_props: Route.ComponentProps) {
  // No onClose: this page IS the palette, so there is nothing to close back to.
  return <QuickOpen />;
}
