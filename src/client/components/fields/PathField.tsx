import React, { useState, useEffect, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { getHomeDir } from "../../bridge.ts";

/**
 * 路径字段：text input + 「📁」按钮调 Tauri dialog（PR-J follow-up #1 完整化 + REVIEW_4 M7+M8 + R_2 L3）。
 *
 * 行为：
 *   - schema.pathKind === "directory" → dialog.open({ directory: true })；其他走 file picker
 *   - schema.expandHome=true（默认）：UI 显示折叠为 `~/...`；commit 时展开为绝对路径写盘
 *   - 「📁」按钮调用失败：通过 console.error + 字段下方 inline 错误提示，不静默
 *
 * **R_2 L3**：home 目录通过 Tauri `getHomeDir` IPC 异步拿（之前用 `process.env.HOME` 在 Bun browser bundle
 * 永远 undefined → expandHome 不生效）。home 加载前 expandHome 行为 noop，加载后切换显示。
 */

function collapseHome(p: string, home: string | null): string {
  if (!home || !p.startsWith(home + "/")) return p;
  return "~" + p.slice(home.length);
}

function expandHomePath(p: string, home: string | null): string {
  if (!home) return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return home + p.slice(1);
  return p;
}

export function PathField({ schema, value, onChange, path, errors, scopeContext, disabled }: FieldProps<string>) {
  const [home, setHome] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>(value ?? "");
  const [pickError, setPickError] = useState<string | null>(null);
  // REVIEW_4 R_2 R-M1：openDialog 异步 await 期间组件可能 unmount；mounted ref 守门避免幽灵 onChange + setState
  // React 19 移除 unmount setState warning，没了「console 噪音提醒」，必须显式守门
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // R_2 L3：异步从 Tauri 拿真 HOME（process.env.HOME 在 browser bundle 没用）
  useEffect(() => {
    let cancelled = false;
    getHomeDir().then((h) => { if (!cancelled) setHome(h || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const display = (v: string | undefined): string => {
    if (!v) return "";
    return schema.expandHome ? collapseHome(v, home) : v;
  };

  useEffect(() => {
    setDraft(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, schema.expandHome, home]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(undefined);
      return;
    }
    // expandHome=true 时把 ~/foo → /home/user/foo 再写盘
    const expanded = schema.expandHome ? expandHomePath(trimmed, home) : trimmed;
    if (expanded !== value) onChange(expanded);
  };

  const onPick = async () => {
    setPickError(null);
    try {
      const opts: Parameters<typeof openDialog>[0] = {
        directory: schema.pathKind === "directory",
        multiple: false,
        title: schema.pathKind === "directory" ? "选择目录" : "选择文件",
      };
      // 优先用 scopeContext.filePath 的目录作为起始；fallback 让系统决定
      if (scopeContext?.filePath) {
        const lastSlash = scopeContext.filePath.lastIndexOf("/");
        if (lastSlash > 0) opts.defaultPath = scopeContext.filePath.slice(0, lastSlash);
      }
      const picked = await openDialog(opts);
      if (!mountedRef.current) return;  // R_2 R-M1：组件已卸载，幽灵 onChange 静默改盘 → 阻止
      if (typeof picked === "string" && picked) {
        onChange(picked);
        setDraft(display(picked));
      }
      // 用户取消 / 多选模式（本组件不支持） → 静默
    } catch (e) {
      if (!mountedRef.current) return;
      // REVIEW_4 M7：dev unit test 仍静默（Tauri 不可用），但生产环境抛错时 inline 提示用户
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("PathField dialog 失败:", e);
      setPickError(`打开对话框失败：${msg}`);
    }
  };

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className="field-path">
        <input
          type="text"
          className="field-input"
          value={draft}
          disabled={disabled}
          placeholder={schema.pathKind === "directory" ? "目录路径或点击 📁 选择…" : "文件路径或点击 📁 选择…"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
        <button
          type="button"
          className="field-path-pick"
          disabled={disabled}
          title={`选择${schema.pathKind === "directory" ? "目录" : "文件"}`}
          onClick={onPick}
        >
          📁
        </button>
      </div>
      {pickError && <span className="field-error error">{pickError}</span>}
    </FieldRow>
  );
}
