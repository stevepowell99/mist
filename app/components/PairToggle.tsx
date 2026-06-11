import * as Switch from "@radix-ui/react-switch";

/**
 * A labelled two-state toggle: both words shown as equally valid choices, a
 * switch between them. The chosen side is bold and the switch carries that
 * side's signal colour. Neither label is greyed out, so it never reads as
 * enabled-vs-disabled. Used for Editor/Preview and Edit/Suggest so the two
 * controls look the same. leftFill/rightFill are Tailwind bg-* classes written
 * as literals at the call site so the JIT picks them up.
 */
export default function PairToggle({
  left,
  right,
  isRight,
  onChange,
  leftFill,
  rightFill,
  leftText,
  rightText,
  disabled = false,
}: {
  left: string;
  right: string;
  isRight: boolean;
  onChange: (right: boolean) => void;
  leftFill: string;
  rightFill: string;
  leftText: string;
  rightText: string;
  disabled?: boolean;
}) {
  const label = (active: boolean, color: string) =>
    `text-sm uppercase tracking-wider transition-all ${color} ${
      active ? "font-semibold opacity-100" : "font-normal opacity-50"
    } ${disabled ? "cursor-default" : "cursor-pointer hover:opacity-100"}`;

  return (
    <div className={`flex h-12 items-center justify-center gap-3 px-4 ${disabled ? "opacity-40" : ""}`}>
      <button type="button" disabled={disabled} onClick={() => onChange(false)} className={label(!isRight, leftText)}>
        {left}
      </button>
      <Switch.Root
        checked={isRight}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={`${left} or ${right}`}
        className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-ink/15 transition-colors disabled:cursor-default ${isRight ? rightFill : leftFill}`}
      >
        <Switch.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-paper shadow ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5" />
      </Switch.Root>
      <button type="button" disabled={disabled} onClick={() => onChange(true)} className={label(isRight, rightText)}>
        {right}
      </button>
    </div>
  );
}
