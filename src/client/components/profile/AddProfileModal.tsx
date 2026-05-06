import React, { useState, useEffect, useRef } from "react";
import {
  type Profile, type ToolKind,
  readProfileConfigFile,
} from "../../bridge.ts";
import { defaultProfileDir } from "../../../profiles/defaults.ts";
import {
  TOOLS, MAIN_CONFIG, REASONING_OPTIONS,
  type AddForm, hookToString, parseConfigCore,
} from "./helpers.ts";

export function AddProfileModal({
  tool, busy, existing, onClose, onSubmit,
}: {
  tool: ToolKind;
  busy: boolean;
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
    const findSrc = () => existingRef.current.find((p) => p.id === fromId);
    const initialSrc = findSrc();
    if (!initialSrc) return;
    let usedConfigDir = initialSrc.configDir;
    let usedFormat = MAIN_CONFIG[initialSrc.tool].format;
    let usedFilename = MAIN_CONFIG[initialSrc.tool].filename;
    let cloneContent = "";
    try {
      cloneContent = await readProfileConfigFile(usedConfigDir, usedFilename);
    } catch (e) {
      console.warn(`applyClone read ${usedFilename} failed:`, e);
    }
    if (latestFromRef.current !== fromId) return; // 用户已经又改过 from，丢弃
    // 重新拿 latest src：父级 reload 期间该 profile 可能被改过
    const src = findSrc();
    if (!src) return;
    // configDir / tool 在 await 期间变了 → 元数据用了 latest 但 cloneContent 还停在旧路径，
    // 元数据和内容会脱节。重读一遍并 race-check。
    if (src.configDir !== usedConfigDir || src.tool !== initialSrc.tool) {
      usedConfigDir = src.configDir;
      usedFormat = MAIN_CONFIG[src.tool].format;
      usedFilename = MAIN_CONFIG[src.tool].filename;
      try {
        cloneContent = await readProfileConfigFile(usedConfigDir, usedFilename);
      } catch (e) {
        console.warn(`applyClone re-read ${usedFilename} failed:`, e);
        cloneContent = "";
      }
      if (latestFromRef.current !== fromId) return;
    }
    const { cfgModel, cfgReasoning } = parseConfigCore(cloneContent, usedFormat);
    setForm((cur) => ({
      ...cur,
      from: fromId,
      tool: src.tool,
      // 注意：故意不灌 dir。否则用户没改 dir 直接 submit 会让 writeProfileConfigFile
      // 把源 profile 的 settings.json / config.toml 覆盖掉。dir 走默认 placeholder
      // `~/.${tool}-${id}` 才安全。
      description: cur.description || src.description || "",
      env: Object.keys(cur.env).length ? cur.env : { ...(src.env ?? {}) },
      preHook: cur.preHook || hookToString(src.hooks?.preSwitch),
      postHook: cur.postHook || hookToString(src.hooks?.postSwitch),
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
          <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button
            className="btn primary"
            disabled={busy || !form.id || !/^[a-zA-Z0-9_-]+$/.test(form.id)}
            onClick={() => onSubmit(form)}
          >{busy ? "提交中…" : "新建"}</button>
        </div>
      </div>
    </div>
  );
}
