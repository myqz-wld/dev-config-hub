import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ToolConfig } from "../types.ts";
import { loadAllConfigs, saveFile } from "./bridge.ts";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { ProfilePanel } from "./components/ProfilePanel.tsx";

const ICONS: Record<string, string> = { terminal: ">_", claude: "C", codex: "X", opencode: "O" };

type View = { kind: "tool"; index: number } | { kind: "profile" };

export function App() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [view, setView] = useState<View>({ kind: "tool", index: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    loadAllConfigs().then(setTools).catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [view]);

  const flash = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const onSave = async (path: string, content: string) => {
    try { await saveFile(path, content); flash("保存成功", true); load(); }
    catch (e) { flash(String(e), false); }
  };

  if (loading) return <div className="center"><div className="spinner" /><span>读取配置中...</span></div>;
  if (error) return <div className="center error-text">加载失败: {error}</div>;

  return (
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
          ? <ProfilePanel onToast={flash} />
          : tools[view.index] && <ConfigPanel tool={tools[view.index]!} onSave={onSave} />}
      </main>
      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.msg}</div>}
    </div>
  );
}
