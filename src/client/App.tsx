import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ToolConfig } from "../types.ts";
import {
  loadAllVersions, loadAllFiles, saveFile, saveFileIfMtime, isMtimeMismatch, getHomeDir,
  loadProfileDataDirect,
  type ToolVersions, type ProfileStore, type ProfileActive,
} from "./bridge.ts";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { ProfilePanel } from "./components/ProfilePanel.tsx";
import { PanelVisibilityProvider } from "./components/panel-visibility.tsx";

const ICONS: Record<string, string> = { terminal: ">_", claude: "C", codex: "X" };

type View = { kind: "tool"; index: number } | { kind: "profile" };

export function App() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [profileStore, setProfileStore] = useState<ProfileStore | null>(null);
  const [profileActive, setProfileActive] = useState<ProfileActive | null>(null);
  const [view, setView] = useState<View>({ kind: "tool", index: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // 单一 toast timer：连续 flash 时旧的必须清掉，否则 8s err toast 后立即 3s ok toast，
  // 旧 8s timer 会在第 8s 把 ok toast 也清掉（看起来 ok toast 提前消失）。
  const toastTimerRef = useRef<number | null>(null);

  // CHANGELOG_15：versions 缓存到首屏，focus reload 跳过 3 zsh spawn（每个 200-500ms）。
  // 用户外部 brew upgrade 是罕见事件，需要刷新版本只能重启 app（trade-off 已记 plan）。
  const versionsRef = useRef<ToolVersions | null>(null);

  // CHANGELOG_15：profile 数据走 fs 直读 (loadProfileDataDirect)，替代旧的 dchProfile.list +
  // current 双 bun spawn (~500ms × 2)。CRUD 写仍走 dch CLI（涉及锁 + hook 不能复刻），
  // 但纯读 bypass 直接读 ~/.dch/profiles.json + readlink ~/.{tool} = 0 spawn。
  const loadProfileData = useCallback(async (silent = false) => {
    try {
      const { store, active } = await loadProfileDataDirect();
      setProfileStore(store);
      setProfileActive(active);
    } catch (e) {
      if (silent) console.warn("loadProfileData silent fail:", e);
      else flash(`加载 profile 失败: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 完整 load：拉 versions（写 ref 缓存）+ 拉文件内容。首屏跑一次；focus reload 走 loadFilesOnly。
  // 失败时 versionsRef 不写，下次 loadFilesOnly 见 null 会 fallback 回这条路径再试。
  const load = useCallback(async () => {
    try {
      // CHANGELOG_10 review fix R_1·L1 (codex LOW)：清零 error，否则首次 load 失败 setError 后
      // focus reload 即便成功也跑不掉「if (error) return <error screen>」hard-block，UI 永远卡 error 页。
      setError(null);
      const home = await getHomeDir();
      const versions = await loadAllVersions();
      versionsRef.current = versions;
      const configs = await loadAllFiles(home, versions);
      setTools(configs);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // CHANGELOG_15：focus reload 快路径——只刷文件内容，跳过 versions（3 zsh spawn 大头）。
  // versionsRef 没缓存（首屏失败的极端情况）→ fallback 到完整 load。
  const loadFilesOnly = useCallback(async () => {
    if (!versionsRef.current) {
      // 首屏 load 失败的恢复路径，用完整 load 再试一次（会重新 spawn 3 zsh，但只这一次）
      await load();
      return;
    }
    try {
      setError(null);
      const home = await getHomeDir();
      const configs = await loadAllFiles(home, versionsRef.current);
      setTools(configs);
    } catch (e) {
      console.warn("loadFilesOnly silent fail:", e);
      // 不 setError —— focus reload 失败不应该把已渲染的 UI 推到 error 屏；下次 focus 再试
    }
  }, [load]);

  // CHANGELOG_15：focus listener 与首屏 load 共享 reloadingRef 防 race（Plan agent Q5）：
  // 首屏 load 还在跑时用户切走 + 切回 → onAppActive 触发 → versionsRef 还是 null →
  // fallback 跑全量 load 第二份 = 6 zsh spawn × 2 比修复前还差。首屏 load 期间 set
  // reloadingRef = true，onAppActive 直接 skip 这次。
  const lastReloadAtRef = useRef(0);
  const reloadingRef = useRef(false);

  // 首屏：configs + profile data 并发拿，进入主界面时 ProfilePanel 已有数据。
  useEffect(() => {
    reloadingRef.current = true;
    Promise.all([load(), loadProfileData()]).finally(() => {
      reloadingRef.current = false;
    });
  }, [load, loadProfileData]);

  // CHANGELOG_13：focus + visibilitychange 去重 + 同步刷 configs + profile。
  //
  // 旧设计两组件各挂双 listener，外部切回时同时 fire focus + visibilitychange × 两组件 = 4 次
  // reload trigger → 14 IPC 砸 × 2 = 主线程在 React commit 间频繁切，UI 慢。新设计：
  //   - 单点 listener（App.tsx 一处）
  //   - 100ms 窗口去重（focus + visibilitychange 同事件源算 1 次）
  //   - reloading guard（前一轮 IPC 没完，新 trigger 不入队；首屏 load 期间也算）
  //   - 同时刷 configs + profile（用户可能在外部改 settings.json 也可能改 ~/.dch/profiles.json）
  //
  // CHANGELOG_15：reload 路径换成 loadFilesOnly + loadProfileDataDirect，0 进程 spawn。
  useEffect(() => {
    const onAppActive = () => {
      if (reloadingRef.current) return;
      if (Date.now() - lastReloadAtRef.current < 100) return;
      lastReloadAtRef.current = Date.now();
      reloadingRef.current = true;
      Promise.all([loadFilesOnly(), loadProfileData(true)]).finally(() => {
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
  }, [loadFilesOnly, loadProfileData]);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [view]);

  const flash = useCallback((msg: string, ok: boolean) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ msg, ok });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, ok ? 3000 : 8000);
  }, []);

  /**
   * REVIEW_8 H7 / Group E2：onSave 接 expectedMtimeUs，走后端 mtime CAS（last-line defense）。
   *
   * - `expectedMtimeUs = number` → 走 `saveFileIfMtime`，后端 stat 比对失败抛 `MtimeMismatchError`
   *   / `MtimeMissingError`（caller catch 弹 banner / flash）
   * - `expectedMtimeUs = null`   → caller 显式放弃 CAS（如「保留我的改动」按钮主动覆盖语义） →
   *   仍走 `saveFileIfMtime` 但传 null 跳过 CAS
   * - `expectedMtimeUs = undefined`（旧 caller 没传） → 走 `saveFile` 老接口（atomic write，
   *   但不做 mtime check，与原行为兼容）
   *
   * 所有路径仍 rethrow 让 caller 知道失败（PR-4 #H2：旧版 fire-and-forget + 同步 setMode("view")
   * 让用户编辑内容直接丢失的回归保护）。
   */
  const onSave = async (path: string, content: string, expectedMtimeUs?: number | null) => {
    try {
      if (expectedMtimeUs === undefined) {
        await saveFile(path, content);
      } else {
        await saveFileIfMtime(path, content, expectedMtimeUs);
      }
      flash("保存成功", true);
      void loadFilesOnly();
    } catch (e) {
      // MtimeMismatchError 用专门的中文文案，让用户立刻明白要走 banner 决策路径
      // （走 isMtimeMismatch helper 而非 instanceof — 见 bridge.ts 注释里跨 module
      // mock 不兼容 instanceof 的原因）
      if (isMtimeMismatch(e)) {
        flash("文件已被外部修改，请走对话框决策", false);
        // REVIEW_8 R2 R2-7 / R3 G4：CAS 失败时主动 reload，让 scope.content / loadedMtimeUs 拿到
        // 磁盘最新值。否则用户在 banner 上点「重新加载」按钮只复用旧 scope（依赖 focus reload 触发
        // loadFilesOnly 但用户不一定切走切回） → 「重新加载」按钮 setBuf(scope.content) 仍是
        // CAS 之前的旧内容 + 旧 mtime → 用户改完保存继续撞同 CAS。
        // 注意：loadFilesOnly 异步，新 scope 推到 ConfigPanel 后由 useEffect 自动 setExternalChanged(true)
        // 弹 banner（与 focus reload 推 scope.content 变化触发的 banner 同款 UX）
        void loadFilesOnly();
      } else {
        flash(String(e), false);
      }
      // PR-4 (#H2)：rethrow 让 caller (ConfigPanel.Scope) 知道失败，否则
      // 旧版 fire-and-forget + 同步 setMode("view") 让用户编辑内容直接丢失
      throw e;
    }
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
          <div className="nav-row nav-row-profile">
            <button
              className={`nav-item nav-tag nav-item-profile tilt-right${view.kind === "profile" ? " on" : ""}`}
              onClick={() => setView({ kind: "profile" })}
            >
              <div className="nav-icon profiles">⇄</div>
              <div className="nav-text">
                <div className="nav-name">Profiles</div>
                <div className="nav-ver">快速切换 · hook</div>
              </div>
            </button>
          </div>
          <div className="nav-sep">工具配置</div>
          {tools.map((t, i) => (
            <div className="nav-row" key={t.name}>
              <button
                className={`nav-item nav-tag nav-tool-${t.icon} ${i % 2 === 0 ? "tilt-left" : "tilt-right"}${view.kind === "tool" && i === view.index ? " on" : ""}`}
                onClick={() => setView({ kind: "tool", index: i })}
              >
                <div className={`nav-icon ${t.icon}`}>{ICONS[t.icon]}</div>
                <div className="nav-text">
                  <div className="nav-name">{t.name}</div>
                  <div className="nav-ver">v{t.version}</div>
                </div>
                <div className="dots">{t.scopes.map((s, j) => <span key={j} className={`dot${s.exists ? "" : " off"}`} />)}</div>
              </button>
            </div>
          ))}
        </div>
      </nav>
      <main className="main" ref={mainRef}>
        {/* Panel 常驻渲染 + display 切换：消除 tab 切换时整个 ConfigPanel/ProfilePanel
            unmount/remount 卡顿（每次重 mount 会重发 N 次 readFileWithMtime IPC + 重建
            整棵字段树 + Markdown shiki 重渲染 + spawn dch CLI）。 */}
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
                <ConfigPanel tool={t} onSave={onSave} onToast={flash} />
              </div>
            </PanelVisibilityProvider>
          );
        })}
      </main>
      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.msg}</div>}
    </div>
  );
}
