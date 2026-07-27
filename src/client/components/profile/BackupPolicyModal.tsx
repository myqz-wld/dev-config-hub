import { useEffect, useMemo, useState } from "react";
import {
  dchProfile,
  type BackupPolicyV1,
  type BackupRuleSource,
  type Profile,
  type ToolKind,
} from "../../bridge.ts";
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
  const [policy, setPolicy] = useState<BackupPolicyV1 | null>(null);
  const [source, setSource] = useState<BackupRuleSource>("factory");
  const [raw, setRaw] = useState("");
  const [rawDirty, setRawDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [scriptsEnabled, setScriptsEnabled] = useState(
    target.scope === "scripts" ? target.enabled : true,
  );

  const title = target.scope === "tool"
    ? `${target.tool} 备份规则`
    : target.scope === "profile"
    ? `${target.profile.id} 方案备份规则`
    : "切换脚本备份规则";

  useEffect(() => {
    let current = true;
    const scope = target.scope;
    const id = scope === "tool"
      ? target.tool
      : scope === "profile"
      ? target.profile.id
      : undefined;
    dchProfile.resolveBackupPolicy(scope, id).then((result) => {
      if (!current) return;
      setPolicy(result.policy);
      setSource(result.source);
      setRaw(JSON.stringify(result.policy, null, 2));
    }).catch((error) => {
      if (current) onToast(error instanceof Error ? error.message : String(error), false);
    });
    return () => { current = false; };
  }, [target, onToast]);

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
      await onSaved();
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(false);
    }
  };

  const hasKeepOriginal = policy && [
    ...policy.secretRules.wholeFile,
    ...policy.secretRules.field,
    ...policy.secretRules.content,
  ].some((rule) => rule.enabled && rule.action === "keep-original");

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal modal-policy" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p className="form-hint">
              来源：<span className="policy-source-label">{SOURCE_LABELS[source]}</span>
              {" · "}{counts.files} 条文件规则，{counts.secrets} 条密钥规则
            </p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="modal-body backup-policy-body">
          {!policy ? <div className="empty">正在读取规则...</div> : (
            <>
              {target.scope === "profile" && source !== "profile-snapshot" && (
                <p className="policy-inheritance-note">
                  当前实时继承 {target.profile.tool} {source === "tool" ? "自定义备份规则" : "内置备份规则"}。
                  保存任何修改时会复制当前有效规则并建立独立快照，之后不再跟随该工具的规则变化。
                </p>
              )}
              <div className="policy-default-row">
                {target.scope === "scripts" && (
                  <label className="policy-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={scriptsEnabled}
                      onChange={(event) => setScriptsEnabled(event.target.checked)}
                    />
                    启用切换脚本备份
                  </label>
                )}
                <label>未命中文件</label>
                <select value={policy.defaultFileAction} onChange={(event) => updatePolicy({
                  ...policy,
                  defaultFileAction: event.target.value as BackupPolicyV1["defaultFileAction"],
                })}>
                  <option value="include">默认包含</option>
                  <option value="exclude">默认排除</option>
                </select>
                <label>二进制/不可扫描文件</label>
                <select value={policy.unscannableFileAction} onChange={(event) => updatePolicy({
                  ...policy,
                  unscannableFileAction: event.target.value as BackupPolicyV1["unscannableFileAction"],
                })}>
                  <option value="include-with-warning">包含并警告</option>
                  <option value="exclude">排除</option>
                </select>
              </div>
              {hasKeepOriginal && (
                <div className="policy-raw-warning">
                  ⚠ 已启用“保留原值”。匹配到的密钥会以明文进入备份，导出前必须再次确认。
                </div>
              )}
              <FileRuleTable policy={policy} sourceLabel={SOURCE_LABELS[source]} onChange={updatePolicy} />
              <SecretRuleTable policy={policy} sourceLabel={SOURCE_LABELS[source]} onChange={updatePolicy} />
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
