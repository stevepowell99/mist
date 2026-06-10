import * as Switch from "@radix-ui/react-switch";
import { useDocument } from "~/lib/DocumentContext";

export default function ModeToggle() {
  const { mode, toggleMode, role } = useDocument();
  const isSuggest = mode === "suggest";

  // Suggest-link users are locked to suggest mode; no toggle
  if (role !== "edit") return null;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm uppercase tracking-wider text-muted">
        {isSuggest ? "Suggest changes" : "Edit mode"}
      </span>
      <Switch.Root
        checked={isSuggest}
        onCheckedChange={toggleMode}
        className="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border transition-colors data-[state=checked]:bg-coral"
        aria-label="Toggle suggest mode"
      >
        <Switch.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-paper shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
      </Switch.Root>
    </div>
  );
}
