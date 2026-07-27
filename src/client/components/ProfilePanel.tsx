import { useState, memo } from "react";
import {
  dchProfile, type ProfileStore, type ToolKind,
  type HookResult, type Profile,
} from "../bridge.ts";
import { hookFromEditedText, TOOLS } from "./profile/helpers.ts";
import { ProfileCard } from "./profile/ProfileCard.tsx";
import { ProfileFormModal } from "./profile/AddProfileModal.tsx";
import { HookOutputModal } from "./profile/HookOutputModal.tsx";
import { ProfileStoreEditor } from "./profile/ProfileStoreEditor.tsx";
import { ExportBackupModal } from "./profile/ExportBackupModal.tsx";
import { RestoreBackupModal } from "./profile/RestoreBackupModal.tsx";
import { BackupHistoryModal } from "./profile/BackupHistoryModal.tsx";
import {
  BackupPolicyModal,
  type PolicyTarget,
} from "./profile/BackupPolicyModal.tsx";
import { ProfileModalPortal } from "./profile/ProfileModalPortal.tsx";
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

type ProfilePanelTab = ToolKind | "backups" | "advanced";

// memo：常驻挂载 + display 切换下，App 重渲染时隐藏的 ProfilePanel 也会跟着重渲染。
// store/active 仅在 profile reload 时变，三个 callback 在 App 已 useCallback 稳定。
export const ProfilePanel = memo(function ProfilePanel({
  store, active, onToast, onReloadProfile, onReloadConfigs,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProfilePanelTab>("claude");
  const [busy, setBusy] = useState(false);
  const [creatingTool, setCreatingTool] = useState<ToolKind | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showStoreEditor, setShowStoreEditor] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [policyTarget, setPolicyTarget] = useState<PolicyTarget | null>(null);
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
    const profile = store.profiles.find((item) => item.id === id);
    const hookTimeoutMs = profile?.hookTimeoutMs ?? 30_000;
    setBusy(true);
    try {
      const r = await dchProfile.use(id, hookTimeoutMs);
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
      const profile = store.profiles.find((item) => item.id === id);
      const r = await dchProfile.testHook(id, which, profile?.hookTimeoutMs ?? 30_000);
      setHookOutput({ id, which: hookActionLabel(which), result: r });
      if (!r) onToast(`${id} 未配置${hookActionLabel(which)}`, true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    }
  };

  if (!store || !active) return <div className="empty">正在读取配置方案...</div>;

  const tool = TOOLS.includes(activeTab as ToolKind)
    ? activeTab as ToolKind
    : null;
  const profiles = tool
    ? store.profiles.filter((profile) => profile.tool === tool)
    : [];
  const toolActive = tool ? active[tool] : null;

  return (
    <div className="panel profile-panel">
      <div className="panel-head">
        <h1>配置方案<span className="ver">{store.profiles.length} 个</span></h1>
        <p className="panel-desc">
          保存位置 <code>~/.dch/profiles.json</code> · 切换脚本超时由各方案单独设置
        </p>
      </div>

      <div className="profile-tabs">
        {TOOLS.map((t) => (
          <button
            key={t}
            className={`profile-tab ${t === activeTab ? "on" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
            <span className="profile-tab-count">{store.profiles.filter((p) => p.tool === t).length}</span>
          </button>
        ))}
        <span className="profile-tab-divider" aria-hidden="true" />
        <button
          className={`profile-tab profile-tab-workspace ${activeTab === "backups" ? "on" : ""}`}
          onClick={() => setActiveTab("backups")}
        >
          备份中心
        </button>
        <button
          className={`profile-tab profile-tab-workspace ${activeTab === "advanced" ? "on" : ""}`}
          onClick={() => setActiveTab("advanced")}
        >
          高级设置
        </button>
      </div>

      {tool && toolActive ? (
        <div className="profile-tool-workspace">
          <div className="profile-toolbar">
            <button className="btn primary" onClick={() => setCreatingTool(tool)} disabled={busy}>
              + 新建 {tool} 方案
            </button>
            <span className="profile-toolbar-separator" />
            <button className="btn-sm" onClick={() => setPolicyTarget({ scope: "tool", tool })}>
              {tool} 备份规则
            </button>
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
              <div className="empty">暂无 {tool} 配置方案。可以新建空目录，或纳入一个已有目录。</div>
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
                  onEdit={(profile) => setEditingProfile(profile)}
                  onBackupRules={(profile) => setPolicyTarget({ scope: "profile", profile })}
                />
              ))
            )}
          </div>
        </div>
      ) : activeTab === "backups" ? (
        <div className="profile-workspace">
          <div className="profile-workspace-head">
            <span className="profile-workspace-eyebrow">跨工具</span>
            <h2>备份中心</h2>
            <p>这里处理 Claude、Codex、Grok 和 Cursor 的组合备份，不隶属于任何一个工具页签。</p>
          </div>
          <div className="profile-operation-grid">
            <article>
              <DoodleIcon kind="export" />
              <div><h3>导出备份</h3><p>按工具分组选择方案，预览规则命中后再写入快照。</p></div>
              <button className="btn-sm" onClick={() => {
                setExportPresetIds(undefined);
                setShowExport(true);
              }}>开始导出</button>
            </article>
            <article>
              <DoodleIcon kind="history" />
              <div><h3>备份历史</h3><p>查看默认、置顶和历史备份，并可继续导入或清理。</p></div>
              <button className="btn-sm" onClick={() => setShowHistory(true)}>查看历史</button>
            </article>
            <article>
              <DoodleIcon kind="import" />
              <div><h3>导入备份</h3><p>读取 .dchpack 内容，确认改名和密钥后创建新方案。</p></div>
              <button className="btn-sm" onClick={() => {
                setRestorePresetPath(undefined);
                setShowRestore(true);
              }}>选择备份</button>
            </article>
          </div>
          <section className="profile-global-backup">
            <div>
              <span className="profile-global-label">DCH 全局</span>
              <strong>切换脚本备份</strong>
              <small>
                仅处理 <code>~/.dch/scripts/**</code>；方案直接填写内联切换命令时可忽略。
              </small>
            </div>
            <button
              className="btn-sm"
              onClick={() => setPolicyTarget({
                scope: "scripts",
                enabled: store.backup.scriptsEnabled !== false,
              })}
            >
              管理备份规则
            </button>
          </section>
        </div>
      ) : (
        <div className="profile-workspace">
          <div className="profile-workspace-head">
            <span className="profile-workspace-eyebrow">谨慎操作</span>
            <h2>高级设置</h2>
            <p>用于处理普通表单未覆盖的跨平台脚本对象和底层字段，修改会影响所有工具页签。</p>
          </div>
          <article className="profile-advanced-card">
            <div>
              <h3>直接编辑配置方案数据</h3>
              <p>
                打开 <code>~/.dch/profiles.json</code> 的结构化编辑器。日常修改请优先使用方案卡片上的“编辑”。
              </p>
            </div>
            <button className="btn-sm" onClick={() => setShowStoreEditor(true)}>
              打开高级编辑
            </button>
          </article>
        </div>
      )}

      <ProfileModalPortal>
        {creatingTool && (
          <ProfileFormModal
            tool={creatingTool}
            busy={busy}
            onClose={() => setCreatingTool(null)}
            onSubmit={async (form) => {
              const ok = await handle(
                () => dchProfile.add(form.tool, form.id, {
                  dir: form.dir,
                  existing: form.directoryMode === "manage-existing",
                  env: form.env,
                  description: form.description || undefined,
                  preHook: form.preHook.trim() || undefined,
                  postHook: form.postHook.trim() || undefined,
                  hookTimeoutMs: form.hookTimeoutMs,
                }),
                form.directoryMode === "manage-existing"
                  ? `已将 ${form.id} 纳入管理`
                  : `已创建 ${form.id} 的空目录`,
              );
              if (ok) setCreatingTool(null);
            }}
          />
        )}

        {editingProfile && (
          <ProfileFormModal
            tool={editingProfile.tool}
            profile={editingProfile}
            busy={busy}
            onClose={() => setEditingProfile(null)}
            onSubmit={async (form) => {
              const preSwitch = hookFromEditedText(
                editingProfile.hooks?.preSwitch,
                form.preHook,
              );
              const postSwitch = hookFromEditedText(
                editingProfile.hooks?.postSwitch,
                form.postHook,
              );
              const ok = await handle(
                () => dchProfile.update(editingProfile.id, {
                  configDir: form.dir,
                  description: form.description || null,
                  env: Object.keys(form.env).length ? form.env : null,
                  hooks: preSwitch || postSwitch
                    ? {
                      ...(preSwitch ? { preSwitch } : {}),
                      ...(postSwitch ? { postSwitch } : {}),
                    }
                    : null,
                  hookTimeoutMs: form.hookTimeoutMs,
                }),
                `已更新 ${editingProfile.id}`,
              );
              if (ok) setEditingProfile(null);
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
            scriptsEnabled={store.backup.scriptsEnabled !== false}
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

        {policyTarget && (
          <BackupPolicyModal
            target={policyTarget}
            onClose={() => setPolicyTarget(null)}
            onSaved={() => onReloadProfile()}
            onToast={onToast}
          />
        )}
      </ProfileModalPortal>
    </div>
  );
});
