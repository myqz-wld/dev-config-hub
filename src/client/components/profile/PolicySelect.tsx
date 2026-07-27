import { Select, type SelectOption } from "../Select.tsx";

export function PolicySelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={`policy-select${className ? ` ${className}` : ""}`}
      popoverClassName="policy-select-popover"
      popoverMinWidth={164}
      portal
    />
  );
}
