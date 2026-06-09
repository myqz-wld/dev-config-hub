import { useState, useEffect } from "react";
import type { Profile } from "../../bridge.ts";
import { hookToString, maskValue } from "./helpers.ts";

export function ProfileCard({
  profile, isActive, busy, onUse, onDelete, onTestHook, onExport,
}: {
  profile: Profile;
  isActive: boolean;
  busy: boolean;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
  onTestHook: (id: string, which: "pre" | "post") => void;
  onExport?: (id: string) => void;
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
            <pre className="profile-hook-script">{hookToString(profile.hooks!.preSwitch)}</pre>
          </div>
        )}
        {hasPostHook && (
          <div className="profile-row">
            <span className="profile-row-label">postSwitch</span>
            <pre className="profile-hook-script">{hookToString(profile.hooks!.postSwitch)}</pre>
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
        {onExport && (
          <button className="btn-sm" disabled={busy} onClick={() => onExport(profile.id)} title="只导出此 profile + 共享资源">
            📦 导出
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
