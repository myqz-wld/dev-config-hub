import { useEffect, useMemo, useRef, useState } from "react";
import {
  dchProfile,
  type BackupPolicyV1,
  type BackupRuleSource,
  type Profile,
  type ToolKind,
} from "../../bridge.ts";
import {
  BACKUP_POLICY_CACHE_TTL_MS,
  backupPolicyCache,
} from "../../backup-cache.ts";
import { FileRuleTable, SecretRuleTable } from "./BackupRuleTable.tsx";

type PolicyTarget =
  | { scope: "tool"; tool: ToolKind }
  | { scope: "profile"; profile: Profile }
  | { scope: "scripts"; enabled: boolean };

const SOURCE_LABELS: Record<BackupRuleSource, string> = {
  factory: "内置默认",
  tool: "工具自定义",
  "profile-snapshot": "方案独立快照",
  scripts: "切换脚本",
};

export function BackupPolicyModal({
  target,
  onClose,
  onSaved,
  onToast,
}: {
  target: PolicyTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onToast: (message: string, ok: boolean) => void;
}) {
  const targetId = target.scope === "tool"
    ? target.tool
    : target.scope === "profile"
    ? target.profile.id
    : undefined;
  const cachedRef = useRef(backupPolicyCache.get(target.scope, targetId));
  const cached = cachedRef.current;
  const editedRef = useRef(false);
  const [policy, setPolicy] = useState<BackupPolicyV1 | null>(cached?.policy ?? null);
  const [source, setSource] = useState<BackupRuleSource>(cached?.source ?? "factory");
  const [raw, setRaw] = useState(
    cached ? JSON.stringify(cached.policy, null, 2) : "",
  );
  const [rawDirty, setRawDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [scriptsEnabled, setScriptsEnabled] = useState(
    target.scope === "scripts" ? target.enabled : true,
  );

  const title = target.scope === "tool"
    ? `${target.tool} 备份规则`
    : target.scope === "profile"
    ? `${target.profile.id} 方案备份规则`
    : "DCH 全局 · 切换脚本备份规则";

  useEffect(() => {
    if (
      cached &&
      Date.now() - cached.fetchedAt < BACKUP_POLICY_CACHE_TTL_MS
    ) {
      return;
    }
    let current = true;
    const scope = target.scope;
    if (cached) setRefreshing(true);
    dchProfile.resolveBackupPolicy(scope, targetId).then((result) => {
      if (!current) return;
      backupPolicyCache.set(scope, targetId, result.policy, result.source);
      if (!editedRef.current) {
        setPolicy(result.policy);
        setSource(result.source);
        setRaw(JSON.stringify(result.policy, null, 2));
      }
    }).catch((error) => {
      if (!current) return;
      if (cached) {
        console.warn("BackupPolicyModal silent refresh failed:", error);
      } else {
        onToast(error instanceof Error ? error.message : String(error), false);
      }
    }).finally(() => {
      if (current) setRefreshing(false);
    });
    return () => { current = false; };
  }, [cached, onToast, target, targetId]);

  const counts = useMemo(() => {
    if (!policy) return { files: 0, secrets: 0 };
    return {
      files: policy.fileRules.length,
      secrets: policy.secretRules.wholeFile.length +
        policy.secretRules.field.length +
        policy.secretRules.content.length,
    };
  }, [policy]);

  const updatePolicy = (next: BackupPolicyV1) => {
    editedRef.current = true;
    setPolicy(next);
    if (!rawDirty) setRaw(JSON.stringify(next, null, 2));
  };

  const save = async () => {
    if (!policy) return;
    let next = policy;
    if (rawDirty) {
      try {
        next = JSON.parse(raw) as BackupPolicyV1;
      } catch (error) {
        onToast(`原始 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`, false);
        return;
      }
    }
    setBusy(true);
    try {
      if (target.scope === "tool") {
        await dchProfile.setBackupPolicy("tool", next, target.tool);
      } else if (target.scope === "profile") {
        await dchProfile.setBackupPolicy("profile", next, target.profile.id);
      } else {
        await dchProfile.setBackupPolicy("scripts", next);
        await dchProfile.setScriptsBackupEnabled(scriptsEnabled);
      }
      backupPolicyCache.clear();
      backupPolicyCache.set(
        target.scope,
        targetId,
        next,
        target.scope === "tool"
          ? "tool"
          : target.scope === "profile"
          ? "profile-snapshot"
          : "scripts",
      );
      await onSaved();
      onToast("备份规则已保存", true);
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    try {
      if (target.scope === "profile") {
        await dchProfile.inheritProfileBackupPolicy(target.profile.id);
        onToast(`已恢复继承 ${target.profile.tool} 备份规则`, true);
      } else if (target.scope === "tool") {
        await dchProfile.resetBackupPolicy("tool", target.tool);
        onToast("已恢复工具内置规则", true);
      } else {
        await dchProfile.resetBackupPolicy("scripts");
        onToast("切换脚本已恢复内置规则", true);
      }
      backupPolicyCache.clear();
      await onSaved();
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal modal-policy" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p className="form-hint">
              来源：<span className="policy-source-label">{SOURCE_LABELS[source]}</span>
              {" · "}{counts.files} 条文件规则，{counts.secrets} 条密钥规则
              {refreshing && <span className="policy-cache-refresh"> · 正在同步…</span>}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="modal-body backup-policy-body">
          {!policy ? <div className="empty">正在读取规则...</div> : (
            <>
              {target.scope === "scripts" && (
                <p className="policy-inheritance-note">
                  这是 DCH 全局规则，只处理 <code>~/.dch/scripts/**</code>，与当前选择的
                  Claude、Codex、Grok 或 Cursor 无关。没有从方案脚本中引用该目录时可停用。
                </p>
              )}
              {target.scope === "profile" && source !== "profile-snapshot" && (
                <p className="policy-inheritance-note">
                  当前实时继承 {target.profile.tool} {source === "tool" ? "自定义备份规则" : "内置备份规则"}。
                  保存任何修改时会复制当前有效规则并建立独立快照，之后不再跟随该工具的规则变化。
                </p>
              )}
              {target.scope === "scripts" && (
                <div className="policy-default-row">
                  <label className="policy-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={scriptsEnabled}
                      onChange={(event) => {
                        editedRef.current = true;
                        setScriptsEnabled(event.target.checked);
                      }}
                    />
                    启用切换脚本备份
                  </label>
                </div>
              )}
              <FileRuleTable policy={policy} onChange={updatePolicy} />
              <SecretRuleTable policy={policy} onChange={updatePolicy} />
              <details className="backup-policy-advanced">
                <summary>高级：正则捕获组与原始 JSON</summary>
                <p className="form-hint">
                  可在此编辑 caseSensitive、secretCaptureGroup、placeholderName 和批量顺序。
                  保存时会执行完整 schema、Glob 与正则校验。
                </p>
                <textarea
                  className="raw policy-raw-json"
                  value={raw}
                  onChange={(event) => {
                    editedRef.current = true;
                    setRaw(event.target.value);
                    setRawDirty(true);
                  }}
                  rows={18}
                  spellCheck={false}
                />
                {rawDirty && (
                  <button className="btn-sm" onClick={() => {
                    try {
                      const parsed = JSON.parse(raw) as BackupPolicyV1;
                      setPolicy(parsed);
                      setRawDirty(false);
                      onToast("原始 JSON 已应用到表格，尚未保存", true);
                    } catch (error) {
                      onToast(`原始 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`, false);
                    }
                  }}>应用到表格</button>
                )}
              </details>
            </>
          )}
        </div>
        <div className="modal-foot">
          <div className="modal-foot-left">
            <button className="btn ghost" disabled={busy || !policy} onClick={reset}>
              {confirmReset
                ? target.scope === "profile" ? "确认恢复继承" : "确认恢复内置规则"
                : target.scope === "profile" ? "恢复继承" : "恢复默认"}
            </button>
            {confirmReset && <span className="form-hint">再次点击确认；已保存的覆盖会被删除。</span>}
          </div>
          <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={save} disabled={busy || !policy}>
            {busy ? "保存中…" : "保存规则"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { PolicyTarget };
