import { useState, useEffect, useRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 自定义下拉框：button + popover。
 * 替代原生 <select> 在 macOS 上的灰色 system look，统一深色主题。
 *
 * - click 外部 / Esc 关闭
 * - 键盘 ↑↓ Enter 导航（基础可用，未做完整 a11y）
 * - placeholder 在 value 为空 / 不在 options 中时显示
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);
  const displayLabel = current?.label ?? placeholder ?? "";

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHoverIdx((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHoverIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && hoverIdx >= 0) {
        e.preventDefault();
        const opt = options[hoverIdx];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hoverIdx, options, onChange]);

  // 打开时把 hover 定位到当前值
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setHoverIdx(idx);
  }, [open, options, value]);

  return (
    <div ref={rootRef} className={`select-root${open ? " open" : ""}${disabled ? " disabled" : ""} ${className}`}>
      <button
        type="button"
        className="select-button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`select-value${current ? "" : " placeholder"}`}>{displayLabel}</span>
        <svg className="select-chev" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="select-popover" role="listbox">
          {options.length === 0 && (
            <li className="select-empty">无选项</li>
          )}
          {options.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`select-item${opt.value === value ? " on" : ""}${i === hoverIdx ? " hover" : ""}`}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseDown={(e) => {
                // mousedown 而不是 click：避免触发 mousedown 关闭 popover 后 click 不到 item
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span className="select-item-label">{opt.label}</span>
              {opt.value === value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
