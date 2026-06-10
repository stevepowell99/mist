import * as Switch from "@radix-ui/react-switch";

/**
 * A labelled two-state toggle: both words shown, a switch between them, the
 * active side emphasized. Used for Editor/Preview and Edit/Suggest so the two
 * controls look the same.
 */
export default function PairToggle({
  left,
  right,
  isRight,
  onChange,
  disabled = false,
}: {
  left: string;
  right: string;
  isRight: boolean;
  onChange: (right: boolean) => void;
  disabled?: boolean;
}) {
  const label = (text: string, active: boolean) =>
    `text-sm uppercase tracking-wider transition-colors ${
      active ? "font-medium text-ink" : "text-muted"
    } ${disabled ? "cursor-default" : "cursor-pointer hover:text-ink"}`;

  return (
    <div className={`flex h-12 items-center justify-center gap-3 px-4 ${disabled ? "opacity-40" : ""}`}>
      <button type="button" disabled={disabled} onClick={() => onChange(false)} className={label(left, !isRight)}>
        {left}
      </button>
      <Switch.Root
        checked={isRight}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={`${left} or ${right}`}
        className="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border transition-colors data-[state=checked]:bg-ink disabled:cursor-default"
      >
        <Switch.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-paper shadow ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
      </Switch.Root>
      <button type="button" disabled={disabled} onClick={() => onChange(true)} className={label(right, isRight)}>
        {right}
      </button>
    </div>
  );
}
