import React, { useState, useEffect, useCallback, useRef } from "react";
import { parse as parseToml } from "smol-toml";
import {
  dchProfile, type Profile, type ProfileStore, type ToolKind,
  type HookResult,
  readProfileConfigFile, writeProfileConfigFile,
  normalizeProfileDir, getHomeDir,
} from "../bridge.ts";
import { defaultProfileDir } from "../../profiles/defaults.ts";

const TOOLS: ToolKind[] = ["claude", "codex"];

const MAIN_CONFIG: Record<ToolKind, {
  filename: string;
  format: "json" | "toml";
  placeholder: string;
}> = {
  claude: {
    filename: "settings.json",
    format: "json",
    placeholder: '{\n  "env": {\n    "DISABLE_TELEMETRY": "1"\n  },\n  "permissions": {\n    "allow": ["mcp__*"]\n  }\n}\n',
  },
  codex: {
    filename: "config.toml",
    format: "toml",
    placeholder: 'model = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n\n[projects."/Users/apple"]\ntrust_level = "trusted"\n',
  },
};

const REASONING_OPTIONS = ["", "minimal", "low", "medium", "high", "xhigh"];

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
      // 不刷新会让 UI 列表跟实际状态错位。
      await reload();
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
  const [confirmingDel, setConfirmingDel] = useState(false);

  useEffect(() => {
    if (!confirmingDel) return;
    const t = setTimeout(() => setConfirmingDel(false), 4000);
    return () => clearTimeout(t);
  }, [confirmingDel]);

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
        <div className="profile-card-actions-spacer" />
        {!confirmingDel ? (
          <button className="btn-sm danger" disabled={busy} onClick={() => setConfirmingDel(true)}>
            删除
          </button>
        ) : (
          <>
            <span className="profile-confirm-hint">确认删除？configDir 不会动</span>
            <button className="btn-sm" disabled={busy} onClick={() => setConfirmingDel(false)}>
              取消
            </button>
            <button
              className="btn-sm danger danger-solid"
              disabled={busy}
              onClick={() => { setConfirmingDel(false); onDelete(profile.id); }}
            >
              确认删除
            </button>
          </>
        )}
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
  preHook: string;
  postHook: string;
  configContent: string;     // settings.json / config.toml 完整内容
  cfgModel: string;          // 核心字段：model（claude/codex 都支持）
  cfgReasoning: string;      // 核心字段：仅 codex（model_reasoning_effort）
}

// TOML basic string escape：\ → \\, " → \", control chars → \uXXXX。
// 顺序很重要：必须先转 \ 再转 ", 否则后转的会把前转出来的 \ 再吃一次。
function tomlBasicString(s: string): string {
  const esc = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${esc}"`;
}

function generateMinimalConfig(
  tool: ToolKind, fields: { model: string; reasoning: string },
): string {
  if (tool === "claude") {
    const obj: Record<string, unknown> = {};
    if (fields.model) obj.model = fields.model;
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "";
  }
  // codex toml — 用 tomlBasicString 完整转义，避免特殊字符（反斜杠 / 控制字符 / 换行）
  // 生成无效 TOML 让工具下次启动报错。
  const lines: string[] = [];
  if (fields.model) lines.push(`model = ${tomlBasicString(fields.model)}`);
  if (fields.reasoning) lines.push(`model_reasoning_effort = ${tomlBasicString(fields.reasoning)}`);
  return lines.join("\n");
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
    tool, id: "", dir: "", description: "", from: "", env: {}, preHook: "", postHook: "",
    configContent: "", cfgModel: "", cfgReasoning: "",
  });
  const [envKey, setEnvKey] = useState("");
  const [envVal, setEnvVal] = useState("");

  const dirPlaceholder = defaultProfileDir(form.tool, form.id || "<id>");
  const sameTooLProfiles = existing.filter((p) => p.tool === form.tool);
  const main = MAIN_CONFIG[form.tool];
  // 防 applyClone 异步竞态：用户连点 from=A → from=B 时，记录最新选择，
  // 滞后到达的旧 promise 不能再回写 form。
  const latestFromRef = useRef<string>("");
  // existing 是 props，会随父级 reload 变。await readProfileConfigFile 期间它可能更新；
  // setForm 时要拿最新的 existing 找 src，否则灌进表单的 src 内容已过期。
  const existingRef = useRef(existing);
  useEffect(() => { existingRef.current = existing; }, [existing]);

  const applyClone = async (fromId: string) => {
    latestFromRef.current = fromId;
    if (!fromId) {
      setForm((cur) => ({ ...cur, from: "" }));
      return;
    }
    const initialSrc = existingRef.current.find((p) => p.id === fromId);
    if (!initialSrc) return;
    const srcMain = MAIN_CONFIG[initialSrc.tool];
    let cloneContent = "";
    let cfgModel = "";
    let cfgReasoning = "";
    try {
      cloneContent = await readProfileConfigFile(initialSrc.configDir, srcMain.filename);
      if (cloneContent) {
        if (srcMain.format === "json") {
          const parsed = JSON.parse(cloneContent) as Record<string, unknown>;
          if (typeof parsed.model === "string") cfgModel = parsed.model;
        } else {
          const parsed = parseToml(cloneContent) as Record<string, unknown>;
          if (typeof parsed.model === "string") cfgModel = parsed.model;
          if (typeof parsed.model_reasoning_effort === "string") cfgReasoning = parsed.model_reasoning_effort;
        }
      }
    } catch (e) {
      // 解析失败不阻塞 clone，继续把 raw 内容灌进 textarea；warn 出来便于排查
      console.warn(`applyClone parse ${srcMain.filename} failed:`, e);
    }
    if (latestFromRef.current !== fromId) return; // 用户已经又改过 from，丢弃本次结果
    // 重新从最新 existing 找 src：父级 reload 期间该 profile 可能被改过
    const src = existingRef.current.find((p) => p.id === fromId);
    if (!src) return;
    setForm((cur) => ({
      ...cur,
      from: fromId,
      tool: src.tool,
      // 注意：故意不灌 dir。否则用户没改 dir 直接 submit 会让 writeProfileConfigFile
      // 把源 profile 的 settings.json / config.toml 覆盖掉。dir 走默认 placeholder
      // `~/.${tool}-${id}` 才安全。
      description: cur.description || src.description || "",
      env: Object.keys(cur.env).length ? cur.env : { ...(src.env ?? {}) },
      preHook: cur.preHook || src.hooks?.preSwitch || "",
      postHook: cur.postHook || src.hooks?.postSwitch || "",
      configContent: cur.configContent || cloneContent,
      cfgModel: cur.cfgModel || cfgModel,
      cfgReasoning: cur.cfgReasoning || cfgReasoning,
    }));
  };

  const onChangeTool = (t: ToolKind) => {
    // 切换 tool 时清掉跟 tool 绑定的字段（dir 占位、configContent 格式、cfgReasoning 仅 codex 用）
    setForm((cur) => ({
      ...cur,
      tool: t,
      from: "",
      configContent: "",
      cfgReasoning: t === "codex" ? cur.cfgReasoning : "",
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>新建 profile</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>tool</label>
            <select value={form.tool} onChange={(e) => onChangeTool(e.target.value as ToolKind)}>
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
            <select value={form.from} onChange={(e) => applyClone(e.target.value)}>
              <option value="">（不 clone）</option>
              {sameTooLProfiles.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </div>

          <div className="form-section-title">模型配置 — 写入 <code>{form.dir || dirPlaceholder}/{main.filename}</code></div>
          <div className="form-row">
            <label>model</label>
            <input
              type="text"
              value={form.cfgModel}
              onChange={(e) => setForm({ ...form, cfgModel: e.target.value })}
              placeholder={form.tool === "claude" ? "claude-opus-4-7 / claude-sonnet-4-6" : "gpt-5.5 / gpt-5.4-mini"}
            />
          </div>
          {form.tool === "codex" && (
            <div className="form-row">
              <label>reasoning_effort</label>
              <select
                value={form.cfgReasoning}
                onChange={(e) => setForm({ ...form, cfgReasoning: e.target.value })}
              >
                {REASONING_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r || "(默认)"}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row form-row-block">
            <label>{main.filename} 完整内容（可选；非空则覆盖上面的 model 字段）</label>
            <textarea
              className="form-hook-input form-config-input"
              value={form.configContent}
              onChange={(e) => setForm({ ...form, configContent: e.target.value })}
              placeholder={main.placeholder}
              rows={8}
              spellCheck={false}
            />
            <p className="form-hint">
              留空则不创建 <code>{main.filename}</code>。
            </p>
          </div>

          <div className="form-section-title">profile 元信息</div>
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
                env 仅在 pre/post hook 子进程里可见；要让 claude / codex 进程拿到，参考 README「Shell wrapper」。
              </p>
            </div>
          </div>
          <div className="form-row form-row-block">
            <label>preSwitch hook (bash)</label>
            <textarea
              className="form-hook-input"
              value={form.preHook}
              onChange={(e) => setForm({ ...form, preHook: e.target.value })}
              placeholder="bash $HOME/.dch/scripts/ensure-proxy.sh"
              rows={3}
              spellCheck={false}
            />
          </div>
          <div className="form-row form-row-block">
            <label>postSwitch hook (bash)</label>
            <textarea
              className="form-hook-input"
              value={form.postHook}
              onChange={(e) => setForm({ ...form, postHook: e.target.value })}
              placeholder="bash $HOME/.dch/scripts/health-check.sh"
              rows={3}
              spellCheck={false}
            />
          </div>
          <p className="form-hint">
            hook 通过 <code>bash -lc</code> 运行，可注入变量：
            <code>DCH_PROFILE_ID</code> / <code>DCH_PROFILE_TOOL</code> / <code>DCH_PROFILE_CONFIG_DIR</code> /
            <code>DCH_SWITCH_TO</code> / <code>DCH_SWITCH_FROM</code>，以及 profile.env。
          </p>
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
