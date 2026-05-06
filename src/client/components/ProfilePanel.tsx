import React, { useState, useEffect, useCallback } from "react";
import {
  dchProfile, type ProfileStore, type ToolKind,
  type HookResult,
  writeProfileConfigFile, normalizeProfileDir, getHomeDir,
} from "../bridge.ts";
import { defaultProfileDir } from "../../profiles/defaults.ts";
import { TOOLS, MAIN_CONFIG, generateMinimalConfig } from "./profile/helpers.ts";
import { ProfileCard } from "./profile/ProfileCard.tsx";
import { AddProfileModal } from "./profile/AddProfileModal.tsx";
import { HookOutputModal } from "./profile/HookOutputModal.tsx";
import { PreferencesEditor } from "./profile/PreferencesEditor.tsx";
import { ProfileStoreEditor } from "./profile/ProfileStoreEditor.tsx";

interface Props {
  onToast: (msg: string, ok: boolean) => void;
  onProfileChanged?: () => void;
}

/**
 * Profile 主面板。PR-I 拆分后保留主框架（reload / handle / onUse / onTestHook + UI 编排），
 * ProfileCard / AddProfileModal / HookOutputModal / PreferencesEditor / ProfileStoreEditor 都在 profile/ 子目录。
 */
export function ProfilePanel({ onToast, onProfileChanged }: Props) {
  const [store, setStore] = useState<ProfileStore | null>(null);
  const [tool, setTool] = useState<ToolKind>("claude");
  const [active, setActive] = useState<Record<ToolKind, { id: string | null; symlinkTarget: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showStoreEditor, setShowStoreEditor] = useState(false);
  const [hookOutput, setHookOutput] = useState<{ id: string; which: string; result: HookResult | null } | null>(null);

  const reload = useCallback(async (silent = false) => {
    try {
      const [s, a] = await Promise.all([dchProfile.list(), dchProfile.current()]);
      setStore(s);
      setActive(a);
    } catch (e) {
      // silent=true 是给 handle catch 块用的：原 action 已经 toast 了一个错误，
      // 这里 reload 自身再失败时不能再 toast，否则会盖掉原错误让用户根本看不到根因。
      if (silent) console.warn("reload silent fail:", e);
      else onToast(`加载失败: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }, [onToast]);

  useEffect(() => { reload(); }, [reload]);

  const handle = async <T,>(action: () => Promise<T>, successMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      onToast(successMsg, true);
      await reload();
      onProfileChanged?.();
      return true;
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
      // 失败时也 reload：action 可能已经把部分状态落盘（如 profile 已建但配置文件写失败），
      // 不刷新会让 UI 列表跟实际状态错位。silent 模式避免 reload 失败时盖掉上面的 action toast。
      await reload(true);
      onProfileChanged?.();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onUse = async (id: string) => {
    setBusy(true);
    try {
      const r = await dchProfile.use(id);
      if (!r.ok) {
        onToast(r.message ?? `切换失败`, false);
        // PR-4 (#M11 / #R3-M2)：失败时弹 HookOutputModal 显示失败 hook 的完整 stdout/stderr。
        // 旧版只 toast r.message（如「preSwitch hook 失败 (exit 2)」），用户看不到 hook 内
        // echo 的诊断信息；CLI 端 fmtHookResult 完整打印，UI 此前独缺。
        const failedHook = r.hooks.find((h) => h.exitCode !== 0);
        if (failedHook) {
          setHookOutput({
            id,
            which: failedHook.hook === "preSwitch" ? "pre" : "post",
            result: failedHook,
          });
        }
        return;
      }
      onToast(`已切换 → ${id}`, true);
      await reload();
      onProfileChanged?.();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const onTestHook = async (id: string, which: "pre" | "post") => {
    try {
      const r = await dchProfile.testHook(id, which);
      setHookOutput({ id, which, result: r });
      if (!r) onToast(`profile ${id} 未配置 ${which}Switch hook`, true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    }
  };

  if (!store || !active) return <div className="empty">读取 profile 中...</div>;

  const profiles = store.profiles.filter((p) => p.tool === tool);
  const toolActive = active[tool];

  return (
    <div className="panel profile-panel">
      <div className="panel-head">
        <h1>Profiles<span className="ver">{store.profiles.length} 个</span></h1>
        <p className="panel-desc">
          状态文件 <code>~/.dch/profiles.json</code> · hook 超时 <code>{store.preferences.hookTimeoutMs}ms</code>
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
        {/* PR-I 新入口：编辑 profiles.json */}
        <button className="btn-sm" onClick={() => setShowStoreEditor(true)} title="编辑 ~/.dch/profiles.json (schema-aware)">
          编辑 store
        </button>
        <PreferencesEditor store={store} onChange={reload} onToast={onToast} />
      </div>

      <div className="profile-status">
        <div>
          <span className="profile-status-label">当前 active</span>
          <code>{toolActive.id ?? "<未设置>"}</code>
        </div>
        <div>
          <span className="profile-status-label">~/.{tool}</span>
          <code>{toolActive.symlinkTarget ?? "(非 symlink)"}</code>
        </div>
        {!toolActive.symlinkTarget && (
          <button
            className="btn ghost btn-init"
            disabled={busy}
            onClick={() => handle(() => dchProfile.init(tool), `已 init ${tool}`)}
          >
            init {tool} (转 symlink)
          </button>
        )}
      </div>

      <div className="profile-list">
        {profiles.length === 0 ? (
          <div className="empty">无 profile。点「+ 新建」或先「init {tool}」</div>
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
            />
          ))
        )}
      </div>

      <div className="profile-actions">
        <button className="btn primary" onClick={() => setShowAdd(true)} disabled={busy}>
          + 新建 profile
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
            // textarea 优先；textarea 空且核心字段非空时，生成最小骨架
            let content = form.configContent.trim();
            if (!content) {
              content = generateMinimalConfig(form.tool, {
                model: form.cfgModel.trim(),
                reasoning: form.cfgReasoning.trim(),
              });
            }
            // dir 撞车校验：拿 home 后 normalize 比较，避免 raw 字符串绕过（末尾 /、~/ vs 绝对路径、//）。
            // 不依赖 content 是否为空 — content 空也校验，避免 dch 系统里两条 profile 指向同一 configDir
            // 导致切换状态错乱。
            const home = await getHomeDir();
            const dirNorm = normalizeProfileDir(dir, home);
            const collision = store.profiles.find((p) => normalizeProfileDir(p.configDir, home) === dirNorm);
            if (collision) {
              onToast(
                `拒绝创建：${dir} 已被 profile ${collision.id} 占用 (configDir 必须唯一)。请改 configDir。`,
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
                      `profile ${form.id} 已建，但写 ${dir}/${main.filename} 失败：${e instanceof Error ? e.message : String(e)}。请到 ConfigPanel 手动补，或删除该 profile 重建。`,
                    );
                  }
                }
              },
              `已添加 ${form.id}${content ? ` + ${main.filename}` : ""}`,
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
          onSaved={reload}
          onToast={onToast}
        />
      )}
    </div>
  );
}
