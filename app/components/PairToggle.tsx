import * as Switch from "@radix-ui/react-switch";

/**
 * A labelled two-state toggle: both words shown as equally valid choices, a
 * switch between them. The chosen side is bold and the switch carries its
 * colour (chartreuse on the left, coral on the right). Neither label is
 * greyed out, so it never reads as enabled-vs-disabled. Used for Editor/Preview
 * and Edit/Suggest so the two controls look the same.
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
  const label = (active: boolean) =>
    `text-sm uppercase tracking-wider text-ink transition-all ${
      active ? "font-semibold" : "font-normal opacity-60"
    } ${disabled ? "cursor-default" : "cursor-pointer hover:opacity-100"}`;

  return (
    <div className={`flex h-12 items-center justify-center gap-3 px-4 ${disabled ? "opacity-40" : ""}`}>
      <button type="button" disabled={disabled} onClick={() => onChange(false)} className={label(!isRight)}>
        {left}
      </button>
      <Switch.Root
        checked={isRight}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={`${left} or ${right}`}
        className="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-ink/15 bg-chartreuse transition-colors data-[state=checked]:bg-coral disabled:cursor-default"
      >
        <Switch.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-paper shadow ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5" />
      </Switch.Root>
      <button type="button" disabled={disabled} onClick={() => onChange(true)} className={label(isRight)}>
        {right}
      </button>
    </div>
  );
}
