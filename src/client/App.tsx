import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ToolConfig } from "../types.ts";
import { loadAllConfigs, saveFile, getHomeDir, loadUiPrefs, type UiPrefs } from "./bridge.ts";
import { applyCustomSchemas } from "../schemas/registry.ts";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { ProfilePanel } from "./components/ProfilePanel.tsx";
import { RootUiPrefsProvider } from "./components/fields/ui-prefs-context.tsx";

const ICONS: Record<string, string> = { terminal: ">_", claude: "C", codex: "X", opencode: "O" };

type View = { kind: "tool"; index: number } | { kind: "profile" };

export function App() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [view, setView] = useState<View>({ kind: "tool", index: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>({ hiddenFields: {} });
  const mainRef = useRef<HTMLElement>(null);
  // 单一 toast timer：连续 flash 时旧的必须清掉，否则 8s err toast 后立即 3s ok toast，
  // 旧 8s timer 会在第 8s 把 ok toast 也清掉（看起来 ok toast 提前消失）；
  // 反过来 ok 后立即 err，3s timer 会把 err 在第 3s 清掉，用户读不完。
  const toastTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      // 1) 先拿 home + 应用自定义 schema（影响 loadAllConfigs 内部 detectScope→getSchemaForScope 拿到的 schema）
      //    串行：自定义 schema 文件少 + 解析快，不并行避免 race
      const home = await getHomeDir();
      try {
        const r = await applyCustomSchemas(home);
        if (r.applied.length) {
          console.info(`[custom-schema] 已合并 ${r.applied.length} 个：${r.applied.join(", ")}`);
        }
      } catch (e) {
        console.warn("[custom-schema] applyCustomSchemas 失败（保留内置 schema）:", e);
      }
      // 2) 并发：configs + ui-prefs
      const [configs, prefs] = await Promise.all([loadAllConfigs(), loadUiPrefs()]);
      setTools(configs);
      setUiPrefs(prefs);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [view]);

  const flash = useCallback((msg: string, ok: boolean) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ msg, ok });
    // 错误 toast 多停留几秒，避免 4 段拼起来的 error message 用户来不及看完
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, ok ? 3000 : 8000);
  }, []);

  const onSave = async (path: string, content: string) => {
    try { await saveFile(path, content); flash("保存成功", true); void load(); }
    catch (e) {
      flash(String(e), false);
      // PR-4 (#H2)：rethrow 让 caller (ConfigPanel.Scope) 知道失败，否则
      // 旧版 fire-and-forget + 同步 setMode("view") 让用户编辑内容直接丢失
      throw e;
    }
  };

  // PR-D：schema-driven 字段级编辑用。**不**调 load() 避免每改一字段全 panel 闪烁；
  // SchemaScopeBody 自行管理本地 setState（外部 reload 通过 useEffect [scope.content] 同步）。
  // 失败时不 toast（schema 控件自管错误显示），但 throw 让 caller 回滚 setState。
  const onPatchSave = async (path: string, content: string) => {
    try { await saveFile(path, content); }
    catch (e) {
      flash(String(e), false);
      throw e;
    }
  };

  if (loading) return <div className="center"><div className="spinner" /><span>读取配置中...</span></div>;
  if (error) return <div className="center error-text">加载失败: {error}</div>;

  return (
    <RootUiPrefsProvider initial={uiPrefs}>
      <div className="app">
        <nav className="sidebar">
          <div className="sidebar-head">
            <div className="logo">D</div>
            <div><div className="logo-title">Dev Config Hub</div><div className="logo-sub">配置中心</div></div>
          </div>
          <div className="nav-list">
            <button
              className={`nav-item nav-item-profile${view.kind === "profile" ? " on" : ""}`}
              onClick={() => setView({ kind: "profile" })}
            >
              <div className="nav-icon profiles">⇄</div>
              <div className="nav-text">
                <div className="nav-name">Profiles</div>
                <div className="nav-ver">快速切换 · hook</div>
              </div>
            </button>
            <div className="nav-sep">工具配置</div>
            {tools.map((t, i) => (
              <button
                key={t.name}
                className={`nav-item${view.kind === "tool" && i === view.index ? " on" : ""}`}
                onClick={() => setView({ kind: "tool", index: i })}
              >
                <div className={`nav-icon ${t.icon}`}>{ICONS[t.icon]}</div>
                <div className="nav-text">
                  <div className="nav-name">{t.name}</div>
                  <div className="nav-ver">v{t.version}</div>
                </div>
                <div className="dots">{t.scopes.map((s, j) => <span key={j} className={`dot${s.exists ? "" : " off"}`} />)}</div>
              </button>
            ))}
          </div>
        </nav>
        <main className="main" ref={mainRef}>
          {view.kind === "profile"
            ? <ProfilePanel onToast={flash} onProfileChanged={() => void load()} />
            : tools[view.index] && <ConfigPanel tool={tools[view.index]!} onSave={onSave} onPatchSave={onPatchSave} onToast={flash} />}
        </main>
        {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.msg}</div>}
      </div>
    </RootUiPrefsProvider>
  );
}
