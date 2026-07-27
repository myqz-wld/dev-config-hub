import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 自定义下拉框：button + popover。
 * 替代原生 <select> 在 macOS 上无法主题化的 system look。
 *
 * - click 外部 / Esc 关闭
 * - 键盘 ↑↓ Enter 导航（基础可用，未做完整 a11y）
 * - placeholder 在 value 为空 / 不在 options 中时显示
 * - portal 模式可越过横向滚动表格的裁剪边界
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className = "",
  popoverClassName = "",
  portal = false,
  popoverMinWidth = 0,
  ariaLabel,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  popoverClassName?: string;
  portal?: boolean;
  popoverMinWidth?: number;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const [portalStyle, setPortalStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const current = options.find((o) => o.value === value);
  const displayLabel = current?.label ?? placeholder ?? "";

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
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

  const updatePortalPosition = useCallback(() => {
    if (!portal || !open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const gap = 5;
    const viewportPadding = 8;
    const preferredWidth = Math.max(rect.width, popoverMinWidth);
    const viewportWidth = window.innerWidth - viewportPadding * 2;
    const width = viewportWidth > 0
      ? Math.min(preferredWidth, viewportWidth)
      : preferredWidth;
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const contentHeight = Math.min(popoverRef.current?.scrollHeight || 240, 240);
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const placeAbove = spaceBelow < contentHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(72, placeAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(240, availableHeight);
    const top = placeAbove
      ? Math.max(viewportPadding, rect.top - gap - Math.min(contentHeight, maxHeight))
      : rect.bottom + gap;

    setPortalStyle({
      position: "fixed",
      left,
      top,
      width,
      maxHeight,
    });
  }, [open, popoverMinWidth, portal]);

  useLayoutEffect(() => {
    if (!open || !portal) return;
    updatePortalPosition();
    const update = () => updatePortalPosition();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, portal, updatePortalPosition]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const popover = (
    <ul
      ref={popoverRef}
      id={listboxId}
      className={`select-popover${portal ? " select-popover-portal" : ""}${popoverClassName ? ` ${popoverClassName}` : ""}`}
      role="listbox"
      style={portal ? portalStyle : undefined}
    >
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
  );

  return (
    <div ref={rootRef} className={`select-root${open ? " open" : ""}${disabled ? " disabled" : ""} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="select-button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
      >
        <span className={`select-value${current ? "" : " placeholder"}`}>{displayLabel}</span>
        <svg className="select-chev" width="14" height="10" viewBox="0 0 18 12" fill="none">
          <path d="M2.2 3.1 C4.8 5.2 6.8 7.5 9.1 9.4 C11.4 7.1 13.5 5.1 16 2.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 2.2 C5.1 4.4 7.1 6.6 9.2 8.3 C11.8 5.8 13.4 4.3 15.2 2.2" stroke="currentColor" strokeOpacity=".28" strokeWidth=".65" strokeLinecap="round" />
        </svg>
      </button>
      {open && (portal ? createPortal(popover, document.body) : popover)}
    </div>
  );
}
