import { useDocument } from "~/lib/DocumentContext";
import PairToggle from "~/components/PairToggle";

export default function ModeToggle() {
  const { mode, toggleMode, role, showPreview } = useDocument();

  // Suggest-link users are locked to suggest mode; no toggle
  if (role !== "edit") return null;

  const isSuggest = mode === "suggest";

  return (
    <PairToggle
      left="Edit"
      right="Suggest"
      isRight={isSuggest}
      onChange={(suggest) => {
        if (suggest !== isSuggest) toggleMode();
      }}
      disabled={showPreview}
    />
  );
}
