import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Profile, ToolKind } from "../../bridge.ts";
import { defaultProfileDir } from "../../../profiles/defaults.ts";
import {
  ENV_KEY_RE,
  TOOLS,
  hookToString,
  type ProfileFormData,
} from "./helpers.ts";
import { Select } from "../Select.tsx";

export function ProfileFormModal({
  tool,
  profile,
  busy,
  onClose,
  onSubmit,
}: {
  tool: ToolKind;
  profile?: Profile;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: ProfileFormData) => void;
}) {
  const editing = !!profile;
  const [form, setForm] = useState<ProfileFormData>(() => ({
    tool: profile?.tool ?? tool,
    id: profile?.id ?? "",
    dir: profile?.configDir ?? "",
    directoryMode: profile ? "manage-existing" : "create-empty",
    description: profile?.description ?? "",
    env: { ...(profile?.env ?? {}) },
    preHook: hookToString(profile?.hooks?.preSwitch),
    postHook: hookToString(profile?.hooks?.postSwitch),
    hookTimeoutMs: profile?.hookTimeoutMs ?? 30_000,
  }));
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [pickerError, setPickerError] = useState("");

  const dirPlaceholder = defaultProfileDir(form.tool, form.id || "<id>");
  const pickExistingDirectory = async () => {
    setPickerError("");
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择要纳入管理的配置目录",
      });
      if (typeof selected === "string") {
        setForm((current) => ({
          ...current,
          dir: selected,
          directoryMode: "manage-existing",
        }));
      }
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? `编辑方案 ${profile.id}` : "新建配置方案"}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>工具</label>
            {editing ? (
              <code>{form.tool}</code>
            ) : (
              <Select
                value={form.tool}
                options={TOOLS.map((item) => ({ value: item, label: item }))}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  tool: value as ToolKind,
                  dir: "",
                }))}
              />
            )}
          </div>

          <div className="form-row">
            <label>方案 ID *</label>
            <input
              type="text"
              value={form.id}
              disabled={editing}
              onChange={(event) => setForm({ ...form, id: event.target.value })}
              placeholder="claude-work / codex-personal"
            />
          </div>

          {!editing && (
            <div className="form-row form-row-block">
              <label>目录方式</label>
              <div className="profile-directory-modes">
                <label className={form.directoryMode === "create-empty" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={form.directoryMode === "create-empty"}
                    onChange={() => setForm({ ...form, directoryMode: "create-empty" })}
                  />
                  <span><strong>创建空目录</strong><small>只建立管理目录，不生成任何配置文件</small></span>
                </label>
                <label className={form.directoryMode === "manage-existing" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={form.directoryMode === "manage-existing"}
                    onChange={() => setForm({ ...form, directoryMode: "manage-existing" })}
                  />
                  <span><strong>管理已有目录</strong><small>保留目录内现有内容，不复制、不修改</small></span>
                </label>
              </div>
            </div>
          )}

          <div className="form-row">
            <label>配置目录 *</label>
            <div className="form-inline">
              <input
                type="text"
                value={form.dir}
                onChange={(event) => setForm({ ...form, dir: event.target.value })}
                placeholder={dirPlaceholder}
              />
              <button className="btn-sm" type="button" onClick={pickExistingDirectory}>
                选择已有目录
              </button>
            </div>
          </div>
          {pickerError && <p className="form-hint form-hint-error">{pickerError}</p>}

          <div className="form-row">
            <label>说明</label>
            <input
              type="text"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="可选说明"
            />
          </div>

          <div className="form-row">
            <label>脚本超时</label>
            <div className="form-inline">
              <input
                type="number"
                min={1}
                max={600}
                step={1}
                value={Math.round(form.hookTimeoutMs / 1_000)}
                onChange={(event) => setForm({
                  ...form,
                  hookTimeoutMs: Number(event.target.value) * 1_000,
                })}
              />
              <span>秒</span>
            </div>
          </div>

          <details className="profile-form-details">
            <summary>脚本与变量</summary>
            {editing && (
              typeof profile.hooks?.preSwitch === "object" ||
              typeof profile.hooks?.postSwitch === "object"
            ) && (
              <p className="form-hint">
                当前含分平台脚本对象：不修改会原样保留；修改对应文本会将该项改为单字符串。
                如需编辑各平台字段，请使用“高级编辑”。
              </p>
            )}
            <div className="form-row form-row-env">
              <label>脚本变量</label>
              <div className="form-env-block">
                {Object.entries(form.env).map(([key, value]) => (
                  <div key={key} className="form-env-item">
                    <code>{key}</code>=<code>{value}</code>
                    <button onClick={() => {
                      const next = { ...form.env };
                      delete next[key];
                      setForm({ ...form, env: next });
                    }}>×</button>
                  </div>
                ))}
                <div className="form-env-add">
                  <input
                    type="text"
                    placeholder="变量名"
                    value={envKey}
                    onChange={(event) => setEnvKey(event.target.value)}
                    className={envKey && !ENV_KEY_RE.test(envKey) ? "invalid" : undefined}
                  />
                  <input
                    type="text"
                    placeholder="值"
                    value={envValue}
                    onChange={(event) => setEnvValue(event.target.value)}
                  />
                  <button
                    className="btn-sm"
                    disabled={!envKey || !ENV_KEY_RE.test(envKey)}
                    onClick={() => {
                      setForm({ ...form, env: { ...form.env, [envKey]: envValue } });
                      setEnvKey("");
                      setEnvValue("");
                    }}
                  >+</button>
                </div>
                {envKey && !ENV_KEY_RE.test(envKey) && (
                  <p className="form-hint form-hint-error">
                    变量名不符合规则：请以字母或下划线开头，只使用字母、数字和下划线。
                  </p>
                )}
              </div>
            </div>
            <div className="form-row form-row-block">
              <label>切换前脚本</label>
              <textarea
                className="form-hook-input"
                value={form.preHook}
                onChange={(event) => setForm({ ...form, preHook: event.target.value })}
                rows={3}
                spellCheck={false}
              />
            </div>
            <div className="form-row form-row-block">
              <label>切换后脚本</label>
              <textarea
                className="form-hook-input"
                value={form.postHook}
                onChange={(event) => setForm({ ...form, postHook: event.target.value })}
                rows={3}
                spellCheck={false}
              />
            </div>
          </details>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button
            className="btn primary"
            disabled={
              busy ||
              !form.id ||
              !/^[a-zA-Z0-9_-]+$/.test(form.id) ||
              !Number.isInteger(form.hookTimeoutMs) ||
              form.hookTimeoutMs < 1_000 ||
              form.hookTimeoutMs > 600_000 ||
              (form.directoryMode === "manage-existing" && !form.dir)
            }
            onClick={() => onSubmit({
              ...form,
              dir: form.dir || dirPlaceholder,
            })}
          >
            {busy ? "提交中…" : editing ? "保存" : form.directoryMode === "manage-existing" ? "纳入管理" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Backward-compatible export name for focused component tests. */
export const AddProfileModal = ProfileFormModal;
