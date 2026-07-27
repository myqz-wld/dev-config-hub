import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Profile, ToolKind } from "../../bridge.ts";
import { defaultProfileDir } from "../../../profiles/defaults.ts";
import {
  ENV_KEY_RE,
  hookToString,
  type ProfileFormData,
} from "./helpers.ts";

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
  const idInvalid = form.id.length > 0 && !/^[a-zA-Z0-9_-]+$/.test(form.id);
  const chooseDirectoryMode = (
    directoryMode: ProfileFormData["directoryMode"],
  ) => {
    setPickerError("");
    setForm((current) => ({ ...current, directoryMode, dir: "" }));
  };
  const pickExistingDirectory = async () => {
    setPickerError("");
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: editing ? "选择新的配置目录" : "选择要纳入管理的配置目录",
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
      <div className="modal modal-wide profile-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{editing ? `编辑方案 ${profile.id}` : `新建 ${tool} 配置方案`}</h2>
            <p className="profile-form-subtitle">
              {editing
                ? `日常设置 · ${profile.tool}`
                : `当前位于 ${tool} 页签，方案会固定归属到 ${tool}`}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body profile-form-body">
          {!editing && (
            <section className="profile-form-section profile-form-mode-section">
              <header>
                <span>1</span>
                <div>
                  <h3>先选择目录方式</h3>
                  <p>新建一个干净目录，或直接管理磁盘上已有的配置。</p>
                </div>
              </header>
              <div className="profile-directory-modes">
                <label className={form.directoryMode === "create-empty" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={form.directoryMode === "create-empty"}
                    onChange={() => chooseDirectoryMode("create-empty")}
                  />
                  <span>
                    <strong>创建空目录</strong>
                    <small>适合从零开始；只建立目录，不生成工具配置文件。</small>
                  </span>
                </label>
                <label className={form.directoryMode === "manage-existing" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={form.directoryMode === "manage-existing"}
                    onChange={() => chooseDirectoryMode("manage-existing")}
                  />
                  <span>
                    <strong>管理已有目录</strong>
                    <small>适合现有配置；保留目录内容，不复制也不修改。</small>
                  </span>
                </label>
              </div>
            </section>
          )}

          <section className="profile-form-section">
            <header>
              <span>{editing ? "1" : "2"}</span>
              <div>
                <h3>{editing ? "方案信息" : "填写基本信息"}</h3>
                <p>方案 ID 用于命令和备份识别，说明只用于界面展示。</p>
              </div>
            </header>
            <div className="profile-form-grid">
              <div className="profile-form-field">
                <label>所属工具</label>
                <div className="profile-form-tool-context">
                  <strong>{form.tool}</strong>
                  <small>{editing ? "创建后不可更改" : "跟随当前工具页签"}</small>
                </div>
              </div>
              <div className="profile-form-field">
                <label>方案 ID <em>*</em></label>
                <input
                  type="text"
                  value={form.id}
                  disabled={editing}
                  className={idInvalid ? "invalid" : undefined}
                  onChange={(event) => setForm({ ...form, id: event.target.value })}
                  placeholder={`${form.tool}-work`}
                  spellCheck={false}
                />
                {idInvalid && (
                  <small className="form-hint-error">只允许字母、数字、下划线和连字符。</small>
                )}
              </div>

              <div className="profile-form-field profile-form-field-wide">
                <label>
                  {form.directoryMode === "manage-existing" || editing
                    ? "已有配置目录"
                    : "新目录位置"}
                  {(form.directoryMode === "manage-existing" || editing) && <em> *</em>}
                </label>
                <div className="form-inline">
                  <input
                    type="text"
                    value={form.dir}
                    onChange={(event) => {
                      setPickerError("");
                      setForm({ ...form, dir: event.target.value });
                    }}
                    placeholder={dirPlaceholder}
                    spellCheck={false}
                  />
                  {(form.directoryMode === "manage-existing" || editing) && (
                    <button className="btn-sm profile-directory-picker" type="button" onClick={pickExistingDirectory}>
                      浏览目录
                    </button>
                  )}
                </div>
                <small>
                  {form.directoryMode === "create-empty" && !editing
                    ? <>留空时创建 <code>{dirPlaceholder}</code>；目标位置必须尚不存在。</>
                    : "必须选择真实目录；不会复制、移动或修改目录中的现有文件。"}
                </small>
                {pickerError && <small className="form-hint-error">{pickerError}</small>}
              </div>

              <div className="profile-form-field profile-form-field-wide">
                <label>说明</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="例如：工作账号、个人实验、离线环境"
                />
              </div>
            </div>
          </section>

          <details className="profile-form-details">
            <summary>
              <span>{editing ? "脚本、变量与超时" : "可选：脚本、变量与超时"}</span>
              <small>仅在切换方案时使用</small>
            </summary>
            <div className="profile-form-advanced">
              <div className="profile-form-field profile-timeout-field">
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

              {editing && (
                typeof profile.hooks?.preSwitch === "object" ||
                typeof profile.hooks?.postSwitch === "object"
              ) && (
                <p className="form-hint">
                  当前含分平台脚本对象：不修改会原样保留；修改对应文本会将该项改为单字符串。
                  如需编辑各平台字段，请使用“高级编辑”。
                </p>
              )}
              <div className="profile-form-field">
                <label>脚本变量</label>
                <div className="form-env-block">
                  {Object.entries(form.env).map(([key, value]) => (
                    <div key={key} className="form-env-item">
                      <code>{key}</code>=<code>{value}</code>
                      <button type="button" onClick={() => {
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
                      type="button"
                      disabled={!envKey || !ENV_KEY_RE.test(envKey)}
                      onClick={() => {
                        setForm({ ...form, env: { ...form.env, [envKey]: envValue } });
                        setEnvKey("");
                        setEnvValue("");
                      }}
                    >添加</button>
                  </div>
                  {envKey && !ENV_KEY_RE.test(envKey) && (
                    <p className="form-hint form-hint-error">
                      变量名不符合规则：请以字母或下划线开头，只使用字母、数字和下划线。
                    </p>
                  )}
                </div>
              </div>
              <div className="profile-form-field">
                <label>切换前脚本</label>
                <textarea
                  className="form-hook-input"
                  value={form.preHook}
                  onChange={(event) => setForm({ ...form, preHook: event.target.value })}
                  rows={3}
                  spellCheck={false}
                  placeholder="可选：切换前执行的命令"
                />
              </div>
              <div className="profile-form-field">
                <label>切换后脚本</label>
                <textarea
                  className="form-hook-input"
                  value={form.postHook}
                  onChange={(event) => setForm({ ...form, postHook: event.target.value })}
                  rows={3}
                  spellCheck={false}
                  placeholder="可选：切换完成后执行的命令"
                />
              </div>
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
