import { useState, memo } from "react";
import {
  dchProfile, type ProfileStore, type ToolKind,
  type HookResult,
  writeProfileConfigFile, normalizeProfileDir, getHomeDir,
} from "../bridge.ts";
import { defaultProfileDir } from "../../profiles/defaults.ts";
import { TOOLS, MAIN_CONFIG } from "./profile/helpers.ts";
import { ProfileCard } from "./profile/ProfileCard.tsx";
import { AddProfileModal } from "./profile/AddProfileModal.tsx";
import { HookOutputModal } from "./profile/HookOutputModal.tsx";
import { PreferencesEditor } from "./profile/PreferencesEditor.tsx";
import { ProfileStoreEditor } from "./profile/ProfileStoreEditor.tsx";
import { ExportBackupModal } from "./profile/ExportBackupModal.tsx";
import { RestoreBackupModal } from "./profile/RestoreBackupModal.tsx";
import { BackupHistoryModal } from "./profile/BackupHistoryModal.tsx";
import { DoodleIcon } from "./DoodleIcon.tsx";

const hookActionLabel = (which: "pre" | "post") => which === "pre" ? "切换前脚本" : "切换后脚本";

/**
 * CHANGELOG_13：ProfilePanel 改受控组件。
 *
 * 旧设计（CHANGELOG_10）：ProfilePanel 自己 useState store/active + 自挂 focus/visibilitychange
 * listener + 内部 reload。问题：与 App.tsx 的 listener 重复，外部切回 Tauri 窗口时同时 fire
 * focus + visibilitychange × 2 组件 = 4 次 reload trigger → 14 IPC 风暴砸 main thread。
 *
 * 新设计：store/active 由 App.tsx 单点持有 + 单点 listener 触发 reload；ProfilePanel 接 props
 * 渲染。`onReloadProfile` 给 handle/onUse 用（CRUD 后立即 silent reload 拿最新数据）。
 *
 * 不再需要 `onProfileChanged` —— App.tsx 内部 reloadProfile 会自动 propagate 新 store/active 下来。
 * profile use/init 会额外调用轻量的 onReloadConfigs，确保 symlink/junction 改变后配置页立即更新。
 */
interface Props {
  store: ProfileStore | null;
  active: Record<ToolKind, { id: string | null; rootPath: string; symlinkTarget: string | null }> | null;
  onToast: (msg: string, ok: boolean) => void;
  onReloadProfile: (silent?: boolean) => Promise<void>;
  onReloadConfigs: () => Promise<void>;
}

// memo：常驻挂载 + display 切换下，App 重渲染时隐藏的 ProfilePanel 也会跟着重渲染。
// store/active 仅在 profile reload 时变，三个 callback 在 App 已 useCallback 稳定。
export const ProfilePanel = memo(function ProfilePanel({
  store, active, onToast, onReloadProfile, onReloadConfigs,
}: Props) {
  const [tool, setTool] = useState<ToolKind>("claude");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showStoreEditor, setShowStoreEditor] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [exportPresetIds, setExportPresetIds] = useState<string[] | undefined>(undefined);
  const [restorePresetPath, setRestorePresetPath] = useState<string | undefined>(undefined);
  const [hookOutput, setHookOutput] = useState<{ id: string; which: string; result: HookResult | null } | null>(null);

  // store/active 在 App.tsx 的首屏 loadProfileData 失败时可能 null；panel 常驻必须永远 mount
  // （CHANGELOG_11），所以接受 null + 渲染 placeholder。Hook 必须在 early return 之前声明。
  const handle = async <T,>(
    action: () => Promise<T>,
    successMsg: string,
    refreshConfigs = false,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      onToast(successMsg, true);
      await Promise.all([
        onReloadProfile(),
        refreshConfigs ? onReloadConfigs() : Promise.resolve(),
      ]);
      return true;
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
      // 失败时也 reload：action 可能已经把部分状态落盘（如 profile 已建但配置文件写失败），
      // 不刷新会让 UI 列表跟实际状态错位。silent 模式避免 reload 失败时盖掉上面的 action toast。
      await onReloadProfile(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onUse = async (id: string) => {
    if (!store) return;
    setBusy(true);
    try {
      // REVIEW_7 H2：传 store.preferences.hookTimeoutMs 让 bridge 算 Rust 端 timeout
      // = 2 × hookTimeoutMs + 5s grace（pre + post hook）
      const r = await dchProfile.use(id, store.preferences.hookTimeoutMs);
      if (!r.ok) {
        onToast(r.message ?? `切换失败`, false);
        // PR-4 (#M11 / #R3-M2)：失败时弹 HookOutputModal 显示失败 hook 的完整 stdout/stderr。
        // 旧版只 toast r.message（如「preSwitch hook 失败 (exit 2)」），用户看不到 hook 内
        // echo 的诊断信息；CLI 端 fmtHookResult 完整打印，UI 此前独缺。
        const failedHook = r.hooks.find((h) => h.exitCode !== 0);
        if (failedHook) {
          setHookOutput({
            id,
            which: hookActionLabel(failedHook.hook === "preSwitch" ? "pre" : "post"),
            result: failedHook,
          });
        }
        return;
      }
      onToast(`已切换 → ${id}`, true);
      await Promise.all([onReloadProfile(), onReloadConfigs()]);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const onTestHook = async (id: string, which: "pre" | "post") => {
    if (!store) return;
    try {
      // REVIEW_7 H2：单 hook = hookTimeoutMs + 5s grace
      const r = await dchProfile.testHook(id, which, store.preferences.hookTimeoutMs);
      setHookOutput({ id, which: hookActionLabel(which), result: r });
      if (!r) onToast(`${id} 未配置${hookActionLabel(which)}`, true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    }
  };

  if (!store || !active) return <div className="empty">正在读取配置方案...</div>;

  const profiles = store.profiles.filter((p) => p.tool === tool);
  const toolActive = active[tool];

  return (
    <div className="panel profile-panel">
      <div className="panel-head">
        <h1>配置方案<span className="ver">{store.profiles.length} 个</span></h1>
        <p className="panel-desc">
          保存位置 <code>~/.dch/profiles.json</code> · 切换脚本超时 <code>{store.preferences.hookTimeoutMs}ms</code>
        </p>
      </div>

      <div className="profile-tabs">
        {TOOLS.map((t) => (
          <button
            key={t}
            className={`profile-tab ${t === tool ? "on" : ""}`}
            onClick={() => setTool(t)}
          >
            {t}
            <span className="profile-tab-count">{store.profiles.filter((p) => p.tool === t).length}</span>
          </button>
        ))}
        <div className="profile-tabs-spacer" />
        <button className="btn-sm" onClick={() => { setExportPresetIds(undefined); setShowExport(true); }} title="备份所有配置方案和共享资源">
          <DoodleIcon kind="export" />导出备份
        </button>
        <button className="btn-sm" onClick={() => setShowHistory(true)} title="查看、置顶、还原或删除备份">
          <DoodleIcon kind="history" />备份历史
        </button>
        <button className="btn-sm" onClick={() => { setRestorePresetPath(undefined); setShowRestore(true); }} title="从 .dchpack 导入为新的配置方案">
          <DoodleIcon kind="import" />导入备份
        </button>
        {/* PR-I 新入口：编辑 profiles.json */}
        <button className="btn-sm" onClick={() => setShowStoreEditor(true)} title="直接编辑 ~/.dch/profiles.json">
          高级编辑
        </button>
        <PreferencesEditor store={store} onChange={() => onReloadProfile()} onToast={onToast} />
      </div>

      <div className="profile-status">
        <div>
          <span className="profile-status-label">当前使用</span>
          <code>{toolActive.id ?? "<未设置>"}</code>
        </div>
        <div>
          <span className="profile-status-label">{toolActive.rootPath}</span>
          <code>{toolActive.symlinkTarget ?? "(尚未接管目录)"}</code>
        </div>
        {!toolActive.symlinkTarget && (
          <button
            className="btn ghost btn-init"
            disabled={busy}
            onClick={() => handle(() => dchProfile.init(tool), `已初始化 ${tool}`, true)}
          >
            初始化 {tool} 配置目录
          </button>
        )}
      </div>

      <div className="profile-list">
        {profiles.length === 0 ? (
          <div className="empty">暂无配置方案。点「+ 新建」或先初始化 {tool} 配置目录。</div>
        ) : (
          profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              isActive={p.id === toolActive.id}
              busy={busy}
              onUse={onUse}
              onDelete={(id) => handle(() => dchProfile.remove(id), `已删除 ${id}`)}
              onTestHook={onTestHook}
              onExport={(id) => { setExportPresetIds([id]); setShowExport(true); }}
            />
          ))
        )}
      </div>

      <div className="profile-actions">
        <button className="btn primary" onClick={() => setShowAdd(true)} disabled={busy}>
          + 新建配置方案
        </button>
      </div>

      {showAdd && (
        <AddProfileModal
          tool={tool}
          busy={busy}
          existing={store.profiles}
          onClose={() => setShowAdd(false)}
          onSubmit={async (form) => {
            // 注意：不传 from。applyClone 已把 src.{desc,env,hooks,configContent} 灌进 form，
            // 此处全部走 form 显式值。否则 CLI 端 cmdAdd 会再用 --from 的 base 给空字段兜底，
            // 把用户「清空 hook」的意图吞掉。
            const dir = form.dir || defaultProfileDir(form.tool, form.id);
            const main = MAIN_CONFIG[form.tool];
            // 直接用 textarea 内容；空则不创建配置文件（用户可在 ConfigPanel 补）
            const content = form.configContent.trim();
            // dir 撞车校验：拿 home 后 normalize 比较，避免 raw 字符串绕过（末尾 /、~/ vs 绝对路径、//）。
            // 不依赖 content 是否为空 — content 空也校验，避免 dch 系统里两条 profile 指向同一 configDir
            // 导致切换状态错乱。
            const home = await getHomeDir();
            const dirNorm = normalizeProfileDir(dir, home);
            const collision = store.profiles.find((p) => normalizeProfileDir(p.configDir, home) === dirNorm);
            if (collision) {
              onToast(
                `不能创建：${dir} 已被 ${collision.id} 使用。请换一个配置目录。`,
                false,
              );
              return;
            }
            const ok = await handle(
              async () => {
                await dchProfile.add(form.tool, form.id, {
                  dir: form.dir || undefined,
                  env: form.env,
                  description: form.description || undefined,
                  preHook: form.preHook.trim() || undefined,
                  postHook: form.postHook.trim() || undefined,
                });
                if (content) {
                  try {
                    await writeProfileConfigFile(dir, main.filename, content.endsWith("\n") ? content : content + "\n");
                  } catch (e) {
                    // profile 已落盘但配置文件没写成 — 给清晰指引而不是默默丢错
                    throw new Error(
                      `${form.id} 已创建，但写入 ${dir}/${main.filename} 失败：${e instanceof Error ? e.message : String(e)}。请到配置文件页手动补上，或删除后重新创建。`,
                    );
                  }
                }
              },
              `已新建 ${form.id}${content ? `，并写入 ${main.filename}` : ""}`,
            );
            // 失败保留 modal，让用户改完再提交；成功才关
            if (ok) setShowAdd(false);
          }}
        />
      )}

      {hookOutput && (
        <HookOutputModal
          data={hookOutput}
          onClose={() => setHookOutput(null)}
        />
      )}

      {showStoreEditor && (
        <ProfileStoreEditor
          onClose={() => setShowStoreEditor(false)}
          onSaved={() => onReloadProfile()}
          onToast={onToast}
        />
      )}

      {showExport && (
        <ExportBackupModal
          profiles={store.profiles}
          presetProfileIds={exportPresetIds}
          onClose={() => { setShowExport(false); setExportPresetIds(undefined); }}
          onToast={onToast}
        />
      )}

      {showRestore && (
        <RestoreBackupModal
          profiles={store.profiles}
          presetPackPath={restorePresetPath}
          onClose={() => { setShowRestore(false); setRestorePresetPath(undefined); }}
          onToast={onToast}
          onReloadProfile={onReloadProfile}
        />
      )}

      {showHistory && (
        <BackupHistoryModal
          onClose={() => setShowHistory(false)}
          onToast={onToast}
          onRestoreFile={(path) => {
            setShowHistory(false);
            setRestorePresetPath(path);
            setShowRestore(true);
          }}
        />
      )}
    </div>
  );
});
