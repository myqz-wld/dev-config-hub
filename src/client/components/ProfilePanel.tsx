import React, { useState, useEffect, useCallback } from "react";
import {
  dchProfile, type Profile, type ProfileStore, type ToolKind,
  type HookResult,
} from "../bridge.ts";

const TOOLS: ToolKind[] = ["claude", "codex"];

interface Props {
  onToast: (msg: string, ok: boolean) => void;
  onProfileChanged?: () => void;
}

export function ProfilePanel({ onToast, onProfileChanged }: Props) {
  const [store, setStore] = useState<ProfileStore | null>(null);
  const [tool, setTool] = useState<ToolKind>("claude");
  const [active, setActive] = useState<Record<ToolKind, { id: string | null; symlinkTarget: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [hookOutput, setHookOutput] = useState<{ id: string; which: string; result: HookResult | null } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([dchProfile.list(), dchProfile.current()]);
      setStore(s);
      setActive(a);
    } catch (e) {
      onToast(`加载失败: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }, [onToast]);

  useEffect(() => { reload(); }, [reload]);

  const handle = async <T,>(action: () => Promise<T>, successMsg: string) => {
    setBusy(true);
    try {
      await action();
      onToast(successMsg, true);
      await reload();
      onProfileChanged?.();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const onUse = async (id: string) => {
    setBusy(true);
    try {
      const r = await dchProfile.use(id);
      if (!r.ok) throw new Error(r.message);
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
          状态文件 <code>{`~/.dch/profiles.json`}</code> · hook 超时 <code>{store.preferences.hookTimeoutMs}ms</code>
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
              onDelete={(id) => {
                if (!confirm(`删除 profile ${id}? configDir 不会被删除。`)) return;
                handle(() => dchProfile.remove(id), `已删除 ${id}`);
              }}
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
          existing={store.profiles}
          onClose={() => setShowAdd(false)}
          onSubmit={async (form) => {
            await handle(
              () => dchProfile.add(form.tool, form.id, {
                dir: form.dir || undefined,
                env: form.env,
                description: form.description || undefined,
                from: form.from || undefined,
              }),
              `已添加 ${form.id}`,
            );
            setShowAdd(false);
          }}
        />
      )}

      {hookOutput && (
        <HookOutputModal
          data={hookOutput}
          onClose={() => setHookOutput(null)}
        />
      )}
    </div>
  );
}

function ProfileCard({
  profile, isActive, busy, onUse, onDelete, onTestHook,
}: {
  profile: Profile;
  isActive: boolean;
  busy: boolean;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
  onTestHook: (id: string, which: "pre" | "post") => void;
}) {
  const envCount = Object.keys(profile.env ?? {}).length;
  const hasPreHook = !!profile.hooks?.preSwitch;
  const hasPostHook = !!profile.hooks?.postSwitch;

  return (
    <div className={`profile-card ${isActive ? "active" : ""}`}>
      <div className="profile-card-head">
        <div className="profile-card-id">
          {isActive && <span className="profile-active-dot" />}
          <code>{profile.id}</code>
          {profile.isDefault && <span className="badge default">default</span>}
        </div>
        <div className="profile-card-meta">
          {envCount > 0 && <span className="badge env">env:{envCount}</span>}
          {hasPreHook && <span className="badge hook">pre</span>}
          {hasPostHook && <span className="badge hook">post</span>}
        </div>
      </div>
      <div className="profile-card-body">
        <div className="profile-row">
          <span className="profile-row-label">configDir</span>
          <code>{profile.configDir}</code>
        </div>
        {profile.description && (
          <div className="profile-row">
            <span className="profile-row-label">desc</span>
            <span className="profile-desc">{profile.description}</span>
          </div>
        )}
        {envCount > 0 && (
          <div className="profile-row">
            <span className="profile-row-label">env</span>
            <div className="profile-env-list">
              {Object.entries(profile.env ?? {}).map(([k, v]) => (
                <span key={k} className="tag"><code>{k}</code>=<code>{maskValue(k, v)}</code></span>
              ))}
            </div>
          </div>
        )}
        {hasPreHook && (
          <div className="profile-row">
            <span className="profile-row-label">preSwitch</span>
            <pre className="profile-hook-script">{profile.hooks!.preSwitch}</pre>
          </div>
        )}
        {hasPostHook && (
          <div className="profile-row">
            <span className="profile-row-label">postSwitch</span>
            <pre className="profile-hook-script">{profile.hooks!.postSwitch}</pre>
          </div>
        )}
      </div>
      <div className="profile-card-actions">
        <button className="btn primary" disabled={busy} onClick={() => onUse(profile.id)}>
          🔗 切换到此 profile
        </button>
        {hasPreHook && (
          <button className="btn-sm" disabled={busy} onClick={() => onTestHook(profile.id, "pre")}>
            test pre
          </button>
        )}
        {hasPostHook && (
          <button className="btn-sm" disabled={busy} onClick={() => onTestHook(profile.id, "post")}>
            test post
          </button>
        )}
        <button className="btn-sm danger" disabled={busy} onClick={() => onDelete(profile.id)}>
          删除
        </button>
      </div>
    </div>
  );
}

function maskValue(k: string, v: string): string {
  // 简单遮蔽看起来像 key/token 的值（仅显示）
  if (/key|token|secret|password/i.test(k) && v.length > 8) {
    return v.slice(0, 4) + "•••" + v.slice(-4);
  }
  return v;
}

interface AddForm {
  tool: ToolKind;
  id: string;
  dir: string;
  description: string;
  from: string;
  env: Record<string, string>;
}

function AddProfileModal({
  tool, existing, onClose, onSubmit,
}: {
  tool: ToolKind;
  existing: Profile[];
  onClose: () => void;
  onSubmit: (form: AddForm) => void;
}) {
  const [form, setForm] = useState<AddForm>({
    tool, id: "", dir: "", description: "", from: "", env: {},
  });
  const [envKey, setEnvKey] = useState("");
  const [envVal, setEnvVal] = useState("");

  const dirPlaceholder = `~/.${form.tool}-${form.id || "<id>"}`;
  const sameTooLProfiles = existing.filter((p) => p.tool === form.tool);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>新建 profile</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>tool</label>
            <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value as ToolKind })}>
              {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>id *</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="claude-api / codex-plus"
            />
          </div>
          <div className="form-row">
            <label>configDir</label>
            <input
              type="text"
              value={form.dir}
              onChange={(e) => setForm({ ...form, dir: e.target.value })}
              placeholder={dirPlaceholder}
            />
          </div>
          <div className="form-row">
            <label>description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="可选说明"
            />
          </div>
          <div className="form-row">
            <label>从已有 profile clone</label>
            <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
              <option value="">（不 clone）</option>
              {sameTooLProfiles.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </div>
          <div className="form-row form-row-env">
            <label>env</label>
            <div className="form-env-block">
              {Object.entries(form.env).map(([k, v]) => (
                <div key={k} className="form-env-item">
                  <code>{k}</code>=<code>{v}</code>
                  <button onClick={() => {
                    const next = { ...form.env };
                    delete next[k];
                    setForm({ ...form, env: next });
                  }}>×</button>
                </div>
              ))}
              <div className="form-env-add">
                <input type="text" placeholder="KEY" value={envKey} onChange={(e) => setEnvKey(e.target.value)} />
                <input type="text" placeholder="VALUE" value={envVal} onChange={(e) => setEnvVal(e.target.value)} />
                <button
                  className="btn-sm"
                  disabled={!envKey || !envVal}
                  onClick={() => {
                    setForm({ ...form, env: { ...form.env, [envKey]: envVal } });
                    setEnvKey(""); setEnvVal("");
                  }}
                >+</button>
              </div>
              <p className="form-hint">
                提示：env 仅在 pre/post hook 脚本里生效（用于 hook 内的 curl / shell 命令），不会注入给 claude / codex 进程。
              </p>
            </div>
          </div>
          <div className="form-hint">
            hooks (preSwitch / postSwitch) 暂时通过 <code>dch profile edit {form.id || "&lt;id&gt;"}</code> 编辑 ~/.dch/profiles.json 添加。
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button
            className="btn primary"
            disabled={!form.id || !/^[a-zA-Z0-9_-]+$/.test(form.id)}
            onClick={() => onSubmit(form)}
          >新建</button>
        </div>
      </div>
    </div>
  );
}function HookOutputModal({
  data, onClose,
}: {
  data: { id: string; which: string; result: HookResult | null };
  onClose: () => void;
}) {
  const r = data.result;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Hook 输出 — {data.id} / {data.which}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!r ? (
            <p>未配置该 hook。</p>
          ) : (
            <>
              <div className="form-row">
                <label>退出码</label>
                <code className={r.exitCode === 0 ? "ok" : "fail"}>{r.exitCode}{r.timedOut ? " (超时)" : ""}</code>
              </div>
              <div className="form-row">
                <label>耗时</label>
                <code>{r.durationMs} ms</code>
              </div>
              {r.stdout && (
                <div className="form-row form-row-block">
                  <label>stdout</label>
                  <pre className="raw">{r.stdout}</pre>
                </div>
              )}
              {r.stderr && (
                <div className="form-row form-row-block">
                  <label>stderr</label>
                  <pre className="raw">{r.stderr}</pre>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function PreferencesEditor({
  store, onChange, onToast,
}: {
  store: ProfileStore;
  onChange: () => void;
  onToast: (m: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  const update = async (k: "hookTimeoutMs", v: number) => {
    try {
      await dchProfile.config(k, v);
      onToast(`${k} = ${v}`, true);
      onChange();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    }
  };

  return (
    <div className="prefs">
      <button className="btn-sm" onClick={() => setOpen(!open)}>设置 ⚙</button>
      {open && (
        <div className="prefs-popover">
          <div className="form-row">
            <label>hook 超时(ms)</label>
            <input
              type="number"
              defaultValue={store.preferences.hookTimeoutMs}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n > 0 && n !== store.preferences.hookTimeoutMs) update("hookTimeoutMs", n);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
