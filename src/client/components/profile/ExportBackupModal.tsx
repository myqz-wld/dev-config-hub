import { useEffect, useRef, useState } from "react";
import {
  dchProfile,
  type Manifest,
  type Profile,
} from "../../bridge.ts";
import { backupCache } from "../../backup-cache.ts";
import { formatBytes } from "../../format-bytes.ts";
import { DoodleIcon } from "../DoodleIcon.tsx";

type Prepared = {
  token: string;
  bytes: number;
  manifest: Manifest;
  expiresAt: string;
};

const POLICY_SOURCE_LABELS: Record<string, string> = {
  factory: "内置默认",
  tool: "工具自定义",
  "profile-snapshot": "方案独立快照",
  scripts: "切换脚本",
};

const SECRET_ACTION_LABELS: Record<string, string> = {
  placeholder: "替换为占位符",
  "exclude-file": "排除整个文件",
  "keep-original": "保留原值",
  ignore: "忽略命中",
};

export function ExportBackupModal({
  profiles,
  scriptsEnabled,
  presetProfileIds,
  presetKeep,
  onClose,
  onToast,
}: {
  profiles: Profile[];
  scriptsEnabled: boolean;
  presetProfileIds?: string[];
  presetKeep?: boolean;
  onClose: () => void;
  onToast: (message: string, ok: boolean) => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(presetProfileIds ?? profiles.map((profile) => profile.id)),
  );
  const [includeScripts, setIncludeScripts] = useState(scriptsEnabled);
  const [noPlaceholder, setNoPlaceholder] = useState(false);
  const [keep, setKeep] = useState(!!presetKeep);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [confirmRaw, setConfirmRaw] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "commit" | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{
    outFile: string;
    bytes: number;
    manifest: Manifest;
  } | null>(null);
  const pendingTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - start), 250);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => () => {
    const token = pendingTokenRef.current;
    if (token) void dchProfile.backupCancel(token).catch(() => {});
  }, []);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const close = async () => {
    if (busy) return;
    if (pendingTokenRef.current) {
      await dchProfile.backupCancel(pendingTokenRef.current).catch(() => {});
      pendingTokenRef.current = null;
    }
    onClose();
  };

  const prepare = async () => {
    if (selected.size === 0) {
      onToast("请至少选择一个配置方案", false);
      return;
    }
    setBusy("prepare");
    setElapsedMs(0);
    try {
      const next = await dchProfile.backupPrepare({
        profileIds: [...selected],
        noScripts: !includeScripts,
        noPlaceholder,
        keep,
      });
      pendingTokenRef.current = next.token;
      setPrepared(next);
      setConfirmRaw(false);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(null);
    }
  };

  const discardPreview = async () => {
    if (!prepared || busy) return;
    setBusy("commit");
    try {
      await dchProfile.backupCancel(prepared.token);
      pendingTokenRef.current = null;
      setPrepared(null);
      setConfirmRaw(false);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!prepared) return;
    const containsRaw = prepared.manifest.backup_audit?.contains_raw_secrets === true;
    if (containsRaw && !confirmRaw) {
      onToast("请确认明文密钥风险后再写入备份", false);
      return;
    }
    setBusy("commit");
    setElapsedMs(0);
    try {
      const committed = await dchProfile.backupCommit(prepared.token, confirmRaw);
      // Protocol invariant: commit must return the exact manifest shown in preview.
      if (JSON.stringify(committed.manifest) !== JSON.stringify(prepared.manifest)) {
        throw new Error("备份提交结果与预览不一致，已停止展示结果");
      }
      pendingTokenRef.current = null;
      setPrepared(null);
      setResult(committed);
      backupCache.clear();
      onToast(`已写入 ${committed.outFile}`, true);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal-wide backup-export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2><DoodleIcon kind="export" />导出备份</h2>
          <button className="modal-close" onClick={close} disabled={!!busy}>×</button>
        </div>
        <div className="modal-body">
          {busy ? (
            <BackupProgress mode={busy} elapsedMs={elapsedMs} />
          ) : result ? (
            <BackupResult result={result} keep={keep} />
          ) : prepared ? (
            <BackupPreview
              prepared={prepared}
              confirmRaw={confirmRaw}
              onConfirmRaw={setConfirmRaw}
            />
          ) : (
            <BackupConfiguration
              profiles={profiles}
              selected={selected}
              includeScripts={includeScripts}
              scriptsEnabled={scriptsEnabled}
              noPlaceholder={noPlaceholder}
              keep={keep}
              onToggle={toggle}
              onIncludeScripts={setIncludeScripts}
              onNoPlaceholder={setNoPlaceholder}
              onKeep={setKeep}
            />
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={result ? close : prepared ? discardPreview : close} disabled={!!busy}>
            {result ? "关闭" : prepared ? "放弃预览" : "取消"}
          </button>
          {!result && !prepared && (
            <button className="btn primary" onClick={prepare} disabled={selected.size === 0}>
              生成精确预览
            </button>
          )}
          {prepared && (
            <button
              className="btn primary"
              onClick={commit}
              disabled={
                prepared.manifest.backup_audit?.contains_raw_secrets === true &&
                !confirmRaw
              }
            >
              确认写入此快照
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BackupConfiguration({
  profiles,
  selected,
  includeScripts,
  scriptsEnabled,
  noPlaceholder,
  keep,
  onToggle,
  onIncludeScripts,
  onNoPlaceholder,
  onKeep,
}: {
  profiles: Profile[];
  selected: Set<string>;
  includeScripts: boolean;
  scriptsEnabled: boolean;
  noPlaceholder: boolean;
  keep: boolean;
  onToggle: (id: string) => void;
  onIncludeScripts: (value: boolean) => void;
  onNoPlaceholder: (value: boolean) => void;
  onKeep: (value: boolean) => void;
}) {
  return (
    <>
      <div className="form-row form-row-block">
        <label>选择配置方案（{selected.size}/{profiles.length}）</label>
        <div className="form-env-block">
          {profiles.map((profile) => (
            <label key={profile.id} className={`form-env-item backup-profile-choice${selected.has(profile.id) ? " selected" : ""}`}>
              <input type="checkbox" checked={selected.has(profile.id)} onChange={() => onToggle(profile.id)} />
              <code>{profile.id}</code>
              <span className="profile-desc">{profile.tool} · {profile.configDir}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>切换脚本</label>
        <label className="form-check">
          <input
            type="checkbox"
            checked={includeScripts}
            disabled={!scriptsEnabled}
            onChange={(event) => onIncludeScripts(event.target.checked)}
          />
          {scriptsEnabled ? "本次包含 " : "全局规则已停用 "}
          <code>~/.dch/scripts/**</code>
        </label>
      </div>
      <div className="form-row">
        <label>备份位置</label>
        <label className="form-check">
          <input type="checkbox" checked={keep} onChange={(event) => onKeep(event.target.checked)} />
          保留为独立历史备份，不覆盖 <code>latest.dchpack</code>
        </label>
      </div>
      <div className="form-row">
        <label>临时覆盖</label>
        <label className="form-check">
          <input type="checkbox" checked={noPlaceholder} onChange={(event) => onNoPlaceholder(event.target.checked)} />
          将“替换为占位符”临时改为“保留原值”
        </label>
      </div>
      {noPlaceholder && (
        <p className="policy-raw-warning">
          此选项不会放行被文件规则或“排除整个文件”规则拒绝的内容。实际是否含明文密钥以预览为准。
        </p>
      )}
      <p className="form-hint">
        文件范围和密钥处理请在配置方案页的“备份规则”中编辑。下一步会先生成不可变快照，
        显示逐文件规则命中，再由你确认写入。
      </p>
    </>
  );
}

function BackupPreview({
  prepared,
  confirmRaw,
  onConfirmRaw,
}: {
  prepared: Prepared;
  confirmRaw: boolean;
  onConfirmRaw: (value: boolean) => void;
}) {
  const audit = prepared.manifest.backup_audit;
  if (!audit) return <div className="empty">预览缺少审计信息，不能提交。</div>;
  return (
    <div className="backup-preview">
      <div className="backup-preview-summary">
        <span>包含文件 <strong>{audit.totals.included_files}</strong></span>
        <span>排除文件 <strong>{audit.totals.excluded_files}</strong></span>
        <span>占位符 <strong>{audit.totals.placeholder_hits}</strong></span>
        <span>密钥排除 <strong>{audit.totals.excluded_secret_hits}</strong></span>
        <span>保留明文 <strong>{audit.totals.retained_secret_hits}</strong></span>
        <span>忽略命中 <strong>{audit.totals.ignored_hits}</strong></span>
      </div>
      <div className="backup-policy-sources">
        {audit.policies.map((policy) => (
          <span key={policy.owner} className="tag">
            <code>{policy.owner}</code> · {POLICY_SOURCE_LABELS[policy.source] ?? policy.source} ·
            {policy.file_rule_count}/{policy.secret_rule_count} 条
          </span>
        ))}
      </div>
      {audit.contains_raw_secrets && (
        <div className="policy-raw-warning">
          <DoodleIcon kind="warning" />此快照包含规则保留的明文密钥。请仅在加密存储或加密渠道中使用。
          <label className="form-check">
            <input type="checkbox" checked={confirmRaw} onChange={(event) => onConfirmRaw(event.target.checked)} />
            我已了解风险，确认写入含明文密钥的备份
          </label>
        </div>
      )}
      <div className="rule-table-wrap backup-preview-files">
        <table className="rule-table">
          <thead>
            <tr><th>文件</th><th>结果</th><th>文件规则</th><th>密钥规则与动作</th><th>警告</th></tr>
          </thead>
          <tbody>
            {audit.files.map((file) => (
              <tr key={`${file.owner}:${file.relative_path}`}>
                <td><code>{file.owner}/{file.relative_path}</code></td>
                <td>{file.outcome === "included" ? "包含" : "排除"}</td>
                <td><code>{file.coverage_rule_id ?? "默认动作"}</code></td>
                <td>{file.secret_hits.length
                  ? file.secret_hits.map((hit) => (
                    `${hit.rule_id} → ${SECRET_ACTION_LABELS[hit.action] ?? hit.action} ×${hit.count}`
                  )).join("；")
                  : "—"}</td>
                <td>{file.warnings.join("；") || (file.unscannable ? "不可扫描" : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="form-hint">
        预览对应已准备的 {formatBytes(prepared.bytes)} 不可变快照；确认时不会重新扫描文件。
      </p>
    </div>
  );
}

function BackupResult({
  result,
  keep,
}: {
  result: { outFile: string; bytes: number; manifest: Manifest };
  keep: boolean;
}) {
  return (
    <div className="backup-result">
      <p>✓ 备份完成（{formatBytes(result.bytes)}）</p>
      <pre className="raw">{result.outFile}</pre>
      <p className="form-hint">
        {keep ? "已保留为历史备份" : "已写入默认备份位置"} ·
        包含 {result.manifest.profiles.length} 个配置方案和
        {result.manifest.shared.dch_scripts.length} 个切换脚本文件。
      </p>
    </div>
  );
}

function BackupProgress({
  mode,
  elapsedMs,
}: {
  mode: "prepare" | "commit";
  elapsedMs: number;
}) {
  return (
    <div className="backup-progress">
      <div className="spinner" />
      <strong>{mode === "prepare" ? "正在扫描、过滤并生成预览快照…" : "正在写入已确认的快照…"}</strong>
      <span>已耗时 <code>{(elapsedMs / 1_000).toFixed(1)}s</code></span>
    </div>
  );
}
