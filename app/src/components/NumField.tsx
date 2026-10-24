import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** decimals shown */
  digits?: number;
  label: string;
  className?: string;
}

/** A number input that lets you type freely and only commits valid values. */
export function NumField({ value, onChange, min, max, digits = 0, label, className = 'field num' }: Props) {
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(digits) : '');
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    // follow outside changes (unit switches, reset) but never fight the user's typing
    if (Math.abs(parseFloat(text) - value) > 10 ** -(digits + 1) || text === '') setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={className}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      onBlur={() => setText(fmt(Math.min(max, Math.max(min, parseFloat(text) || value))))}
    />
  );
}
