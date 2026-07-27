import { useState, useEffect } from "react";
import type { Profile } from "../../bridge.ts";
import { hookToString, maskValue } from "./helpers.ts";
import { DoodleIcon } from "../DoodleIcon.tsx";

export function ProfileCard({
  profile, isActive, busy, onUse, onDelete, onTestHook, onExport, onEdit,
  onBackupRules,
}: {
  profile: Profile;
  isActive: boolean;
  busy: boolean;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
  onTestHook: (id: string, which: "pre" | "post") => void;
  onExport?: (id: string) => void;
  onEdit?: (profile: Profile) => void;
  onBackupRules?: (profile: Profile) => void;
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
          {profile.isDefault && <span className="badge default">默认</span>}
        </div>
        <div className="profile-card-meta">
          {envCount > 0 && <span className="badge env">变量 {envCount}</span>}
          {hasPreHook && <span className="badge hook">切换前</span>}
          {hasPostHook && <span className="badge hook">切换后</span>}
          <span className="badge">{(profile.hookTimeoutMs ?? 30_000) / 1_000}s</span>
        </div>
      </div>
      <div className="profile-card-body">
        <div className="profile-row">
          <span className="profile-row-label">配置目录</span>
          <code>{profile.configDir}</code>
        </div>
        {profile.description && (
          <div className="profile-row">
            <span className="profile-row-label">说明</span>
            <span className="profile-desc">{profile.description}</span>
          </div>
        )}
        {(envCount > 0 || hasPreHook || hasPostHook) && (
          <details className="profile-card-details">
            <summary>查看脚本与变量</summary>
            {envCount > 0 && (
              <div className="profile-row">
                <span className="profile-row-label">脚本变量</span>
                <div className="profile-env-list">
                  {Object.entries(profile.env ?? {}).map(([k, v]) => (
                    <span key={k} className="tag"><code>{k}</code>=<code>{maskValue(k, v)}</code></span>
                  ))}
                </div>
              </div>
            )}
            {hasPreHook && (
              <div className="profile-row">
                <span className="profile-row-label">切换前脚本</span>
                <pre className="profile-hook-script">{hookToString(profile.hooks!.preSwitch)}</pre>
              </div>
            )}
            {hasPostHook && (
              <div className="profile-row">
                <span className="profile-row-label">切换后脚本</span>
                <pre className="profile-hook-script">{hookToString(profile.hooks!.postSwitch)}</pre>
              </div>
            )}
          </details>
        )}
      </div>
      <div className="profile-card-actions">
        <button className="btn primary" disabled={busy} onClick={() => onUse(profile.id)}>
          <DoodleIcon kind="switch" />切换到此方案
        </button>
        {hasPreHook && (
          <button className="btn-sm" disabled={busy} onClick={() => onTestHook(profile.id, "pre")}>
            测试切换前
          </button>
        )}
        {hasPostHook && (
          <button className="btn-sm" disabled={busy} onClick={() => onTestHook(profile.id, "post")}>
            测试切换后
          </button>
        )}
        {onExport && (
          <button className="btn-sm" disabled={busy} onClick={() => onExport(profile.id)} title="只备份此方案和切换脚本">
            <DoodleIcon kind="export" />导出
          </button>
        )}
        {onEdit && (
          <button className="btn-sm" disabled={busy} onClick={() => onEdit(profile)}>
            编辑
          </button>
        )}
        {onBackupRules && (
          <button className="btn-sm" disabled={busy} onClick={() => onBackupRules(profile)}>
            备份规则
          </button>
        )}
        <div className="profile-card-actions-spacer" />
        {!confirmingDel ? (
          <button className="btn-sm danger" disabled={busy} onClick={() => setConfirmingDel(true)}>
            删除
          </button>
        ) : (
          <>
            <span className="profile-confirm-hint">确认删除？配置目录不会被删除</span>
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
