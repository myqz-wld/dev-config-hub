import React, { useEffect, useRef, useState } from "react";
import { useScopedUiPrefs } from "./ui-prefs-context.tsx";

/**
 * Field 「⋯」popover 菜单（PR-CSv1）。
 *
 * 仅在 root level 字段渲染（ObjectField 给 root 子字段传 menu prop）。点 ⋯ 弹小窗，
 * 提供「隐藏此字段」按钮。隐藏后字段从 UI 消失，可在 SchemaScopeBody 顶部 toggle
 * 「显示隐藏字段 (N)」临时翻出。
 *
 * **设计取舍**：
 *   - 自管 open/close state（不引依赖；仅一种 popover 复用现有 .field-menu-* CSS）
 *   - click outside 监听挂在 document，effect cleanup 清理（避免 unmount 后还监听）
 *   - Esc 关闭（无障碍）
 *   - 不在 ScopedUiPrefsProvider 内 → useScopedUiPrefs 返 null → 渲染 null（容错）
 */
export function FieldMenu({ fieldKey }: { fieldKey: string }) {
  const ui = useScopedUiPrefs();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // click outside / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ui) return null;

  // 用户手动隐藏过这个 key？（注意：advanced=true 默认隐藏的字段不算「手动隐藏」，
  // 在「显示隐藏字段」模式下点「隐藏此字段」会把它加进 hiddenKeys 真正手动隐藏；
  // 反过来已经在 hiddenKeys 里的，菜单显示「取消隐藏」让用户能还原。）
  const isManuallyHidden = ui.hiddenKeys.has(fieldKey);

  return (
    <span className="field-menu" ref={wrapRef}>
      <button
        type="button"
        className="field-menu-button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="字段菜单"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div className="field-menu-popover" role="menu">
          <button
            type="button"
            className="field-menu-item"
            onClick={() => {
              ui.toggleHide(fieldKey);
              setOpen(false);
            }}
          >
            {isManuallyHidden ? "取消隐藏" : "隐藏此字段"}
          </button>
        </div>
      )}
    </span>
  );
}
