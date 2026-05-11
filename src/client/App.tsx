import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ToolConfig } from "../types.ts";
import { loadAllConfigs, saveFile, getHomeDir, loadUiPrefs, type UiPrefs, dchProfile, type ProfileStore, type ToolKind } from "./bridge.ts";
import { applyCustomSchemas } from "../schemas/registry.ts";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { ProfilePanel } from "./components/ProfilePanel.tsx";
import { RootUiPrefsProvider } from "./components/fields/ui-prefs-context.tsx";
import { PanelVisibilityProvider } from "./components/panel-visibility.tsx";

const ICONS: Record<string, string> = { terminal: ">_", claude: "C", codex: "X", opencode: "O" };

type View = { kind: "tool"; index: number } | { kind: "profile" };
type ProfileActive = Record<ToolKind, { id: string | null; symlinkTarget: string | null }>;

export function App() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [profileStore, setProfileStore] = useState<ProfileStore | null>(null);
  const [profileActive, setProfileActive] = useState<ProfileActive | null>(null);
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

  // CHANGELOG_13：profile 数据上提到 App.tsx 单点持有；ProfilePanel 改受控组件接 props。
  // 旧设计 ProfilePanel 自管 store/active + 自挂 focus/visibility listener，与 App.tsx 同源
  // 重复 → 外部切回 Tauri 窗口同时 fire focus + visibilitychange × 两组件 = 14 IPC 风暴。
  const loadProfileData = useCallback(async (silent = false) => {
    try {
      const [s, a] = await Promise.all([dchProfile.list(), dchProfile.current()]);
      setProfileStore(s);
      setProfileActive(a);
    } catch (e) {
      if (silent) console.warn("loadProfileData silent fail:", e);
      else flash(`加载 profile 失败: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    // flash 在下面定义；useCallback deps 用 [] 因为 flash 自己也是 useCallback []，不会变。
    // 这里不能写 [flash] 因为定义顺序（hoisted 的 useCallback 引用要 lint 配合）—— 拿 ref 比较安全。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    try {
      // CHANGELOG_10 review fix R_1·L1 (codex LOW)：清零 error，否则首次 load 失败 setError 后
      // focus reload 即便成功也跑不掉「if (error) return <error screen>」hard-block，UI 永远卡 error 页。
      // 本 PR 之前 load 只在 mount 跑一次，error 一次性硬挂可接受；focus reload 落地后变成可重试路径。
      setError(null);
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

  // 首屏：configs + profile data 并发拿，进入主界面时 ProfilePanel 已有数据。
  useEffect(() => {
    void Promise.all([load(), loadProfileData()]);
  }, [load, loadProfileData]);

  // CHANGELOG_13：focus + visibilitychange 去重 + 同步刷 configs + profile。
  //
  // 旧设计两组件各挂双 listener，外部切回时同时 fire focus + visibilitychange × 两组件 = 4 次
  // reload trigger → 14 IPC 砸（4 version + N readFile + 2 dch CLI）× 2 = 主线程在 React commit
  // 间频繁切，UI「点按钮也慢」。新设计：
  //   - 单点 listener（App.tsx 一处）
  //   - 100ms 窗口去重（focus + visibilitychange 同事件源算 1 次）
  //   - reloading guard（前一轮 IPC 没完，新 trigger 不入队）
  //   - 同时刷 configs + profile（用户可能在外部改 settings.json 也可能改 ~/.dch/profiles.json）
  //
  // 不做 N 秒缓存：磁盘新鲜度优先级 > 微秒级 IPC 节流。
  const lastReloadAtRef = useRef(0);
  const reloadingRef = useRef(false);
  useEffect(() => {
    const onAppActive = () => {
      if (reloadingRef.current) return;
      if (Date.now() - lastReloadAtRef.current < 100) return;
      lastReloadAtRef.current = Date.now();
      reloadingRef.current = true;
      Promise.all([load(), loadProfileData(true)]).finally(() => {
        reloadingRef.current = false;
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onAppActive();
    };
    window.addEventListener("focus", onAppActive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onAppActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, loadProfileData]);

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
          {/* Panel 常驻渲染 + display 切换：消除 tab 切换时整个 ConfigPanel/ProfilePanel
              unmount/remount 卡顿（每次重 mount 会重发 N 次 readFileWithMtime IPC + 重建
              整棵字段树 + Markdown shiki 重渲染 + spawn dch CLI）。
              首屏多花一次性 mount 成本，之后切换近乎零延迟，且各 panel 内部 state（mode /
              open / collapsed / edit buf）也保留。
              PanelVisibilityProvider 让隐藏 panel 内的 SchemaScopeBody 5s mtime poll 暂停，
              避免 12-16 个 timer 后台空转。 */}
          <PanelVisibilityProvider visible={view.kind === "profile"}>
            <div className={view.kind === "profile" ? "panel-host" : "panel-host panel-hidden"}>
              <ProfilePanel
                store={profileStore}
                active={profileActive}
                onToast={flash}
                onReloadProfile={loadProfileData}
              />
            </div>
          </PanelVisibilityProvider>
          {tools.map((t, i) => {
            const isVisible = view.kind === "tool" && i === view.index;
            return (
              <PanelVisibilityProvider key={t.name} visible={isVisible}>
                <div className={isVisible ? "panel-host" : "panel-host panel-hidden"}>
                  <ConfigPanel tool={t} onSave={onSave} onPatchSave={onPatchSave} onToast={flash} />
                </div>
              </PanelVisibilityProvider>
            );
          })}
        </main>
        {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.msg}</div>}
      </div>
    </RootUiPrefsProvider>
  );
}
