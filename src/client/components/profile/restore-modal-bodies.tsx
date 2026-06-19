// **REVIEW_9 D-MED-4 / D-claude I1 升**: 从 RestoreBackupModal.tsx 拆出 5 个 sub-component
// (RestorePreviewBody / RestoreReportBody / SharedActionsList / PlaceholdersList /
// CloseConfirm),让 RestoreBackupModal.tsx 顶 500 LOC 护栏。
//
// 各 component 都是无状态展示组件,接收主 modal 算好的 props (renameMap / renameError /
// secretEntries / result / appliedById 等),不持 state 不调 IPC,纯渲染。这样 modal 主文件
// 聚焦状态机 + IPC 调度,展示细节单独维护。
//
// 顺手一并删 RestoreBackupModal.tsx 旧 dead code `type _UnusedToolKind = ToolKind`
// (`ToolKind` import 仅本类型定义引用,删后整个 import 也清理)。

import type {
  Manifest, AppliedProfile, SharedAction, PlaceholderEntry, ApplyBackupResult,
  SecretLogicalEntry,
} from "../../bridge.ts";
import { UniqueSecretsList } from "./UniqueSecretsList.tsx";
import { DoodleIcon } from "../DoodleIcon.tsx";

/**
 * REVIEW_9 D-HIGH-2: secrets phase 关 modal 内联 confirm UI。覆盖在 modal-body 顶部，
 * cancel = 留在 modal 继续填；confirm = 清 secretsState + onClose()。
 */
export function CloseConfirm({ filledCount, onCancel, onConfirm }: {
  filledCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="form-row form-row-block"
      style={{
        padding: "12px 16px",
        background: "rgba(227,179,65,.10)",
        borderLeft: "3px solid var(--yellow)",
        borderRadius: 2,
        marginBottom: 12,
      }}
    >
      <p className="form-hint" style={{ color: "var(--yellow)", margin: 0, fontSize: 14 }}>
        <DoodleIcon kind="warning" />已填写 <strong>{filledCount}</strong> 个密钥。关闭将丢弃所有输入，之后需要重新填写。
      </p>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="btn-sm" onClick={onCancel}>留下继续填</button>
        <button className="btn-sm danger danger-solid" onClick={onConfirm}>放弃并关闭</button>
      </div>
    </div>
  );
}

export function RestorePreviewBody({
  manifest, plan, renameMap, renameError, onUpdate, busy, secretEntries,
}: {
  manifest: Manifest;
  plan: ApplyBackupResult;
  renameMap: Record<string, string>;
  renameError: (originalId: string, finalId: string) => string | null;
  onUpdate: (originalId: string, newId: string) => void;
  busy: boolean;
  /** null = 旧 pack / no-placeholder，跳过 step 3；非 null = 显示完整清单预告 */
  secretEntries: SecretLogicalEntry[] | null;
}) {
  const hasSecrets = secretEntries !== null && secretEntries.length > 0;
  const totalOcc = hasSecrets ? secretEntries!.reduce((s, e) => s + e.count, 0) : 0;
  return (
    <>
      <div className="form-row">
        <label>来源</label>
        <span>{manifest.source_user}@{manifest.source_host} · {new Date(manifest.created_at).toLocaleString()} · DCH v{manifest.dch_version}</span>
      </div>
      {manifest.options.no_placeholder && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>
            <DoodleIcon kind="warning" />这个备份包含未脱敏的密钥。
          </p>
        </div>
      )}
      {hasSecrets && (
        <div className="form-row form-row-block">
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(88,166,255,.08)",
              color: "var(--blue)",
              borderLeft: "3px solid var(--blue)",
              borderRadius: 2,
            }}
          >
            <p className="form-hint" style={{ margin: 0, color: "var(--blue)" }}>
              <DoodleIcon kind="key" />下一步将填写 <strong>{secretEntries!.length}</strong> 个不同密钥项，并自动填入所有 {totalOcc} 处使用位置。
            </p>
            <UniqueSecretsList
              entries={secretEntries!}
              summaryPrefix={<><DoodleIcon kind="key" />清单</>}
              footerHint={null}
            />
          </div>
        </div>
      )}

      <div className="form-section-title">将导入的配置方案（{plan.appliedProfiles.length}）</div>
      {plan.appliedProfiles.map((ap) => {
        const finalId = renameMap[ap.originalId] ?? ap.finalId;
        const errMsg = renameError(ap.originalId, finalId);
        return (
          <div key={ap.originalId} className="form-row form-row-block">
            <label>
              {ap.originalId}
              {ap.conflict !== "none" && <span className="badge env" style={{ marginLeft: 8 }}>{ap.conflict}</span>}
            </label>
            <input
              type="text"
              value={finalId}
              onChange={(e) => onUpdate(ap.originalId, e.target.value)}
              disabled={busy}
              spellCheck={false}
              style={errMsg ? { borderColor: "var(--red)" } : undefined}
            />
            {errMsg && <p className="form-hint" style={{ color: "var(--red)" }}>{errMsg}</p>}
            <p className="form-hint">配置目录 → <code>{ap.configDir}</code></p>
          </div>
        );
      })}

      {plan.sharedActions.length > 0 && (
        <>
          <div className="form-section-title">共享资源（{plan.sharedActions.length}）</div>
          <div className="form-row form-row-block">
            <SharedActionsList items={plan.sharedActions} />
          </div>
        </>
      )}

      {plan.placeholders.length > 0 && (
        <>
          <div className="form-section-title">还需要手动填写的密钥（{plan.placeholders.length}）</div>
          <div className="form-row form-row-block">
            <PlaceholdersList items={plan.placeholders} />
          </div>
        </>
      )}

      {plan.errors.length > 0 && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>错误：</p>
          {plan.errors.map((e, i) => <p key={i} className="form-hint" style={{ color: "var(--red)" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

export function RestoreReportBody({
  result, appliedById, onReveal, computeRevealTarget, secretsMetrics,
}: {
  result: ApplyBackupResult;
  appliedById: Record<string, AppliedProfile>;
  onReveal?: (profileId: string, configFile: string) => void;
  computeRevealTarget: (
    ph: PlaceholderEntry,
    appliedById: Record<string, AppliedProfile>,
  ) => { profileId: string; configFile: string } | null;
  /** 仅当本次 restore 走 restoreApplyWithSecrets 时传，控制底部 secrets metrics 段渲染 */
  secretsMetrics?: { applied: number; skipped: string[]; unknown: string[] };
}) {
  const { plainTextFillFiles, otherErrors } = splitErrorsForReport(result.errors);

  return (
    <>
      <div className="form-row form-row-block">
        <p className="form-hint">✓ 已导入 {result.appliedProfiles.length} 个配置方案（共享资源 {result.sharedActions.length} 项）。</p>
        {secretsMetrics && (
          <p className="form-hint" style={{ color: secretsMetrics.applied > 0 ? "var(--green)" : "var(--fg2)" }}>
            <DoodleIcon kind="key" />已填入 {secretsMetrics.applied} 处 · 跳过 {secretsMetrics.skipped.length} 个密钥项
            {secretsMetrics.unknown.length > 0 && ` · ${secretsMetrics.unknown.length} 个未知项已忽略`}
          </p>
        )}
      </div>

      <div className="form-section-title">已导入配置方案</div>
      {result.appliedProfiles.map((ap) => (
        <div key={ap.originalId} className="form-row">
          <code>{ap.originalId}</code>
          <span> → </span>
          <code>{ap.finalId}</code>
          <span className="profile-desc"> ({ap.configDir})</span>
          {ap.conflict !== "none" && <span className="badge env" style={{ marginLeft: 8 }}>{ap.conflict}</span>}
        </div>
      ))}

      {result.placeholders.length > 0 && (
        <>
          <div className="form-section-title">还需要手动填写的密钥（{result.placeholders.length}）</div>
          <p className="form-hint">
            填完真实密钥后再切换到新方案；也可以运行 <code>dch profile use &lt;id&gt;</code>。
            点占位符旁的「编辑」按钮直接打开对应文件。
          </p>
          {result.placeholders.map((ph, i) => {
            const tgt = computeRevealTarget(ph, appliedById);
            return (
              <div key={i} className="form-row">
                <span><code>{ph.fieldName}</code></span>
                <span className="profile-desc"> {ph.hint}</span>
                <span className="profile-desc"> · {ph.hostPath ?? ph.packPath}</span>
                {tgt && onReveal && (
                  <button
                    className="btn-sm"
                    onClick={() => onReveal(tgt.profileId, tgt.configFile)}
                    style={{ marginLeft: 8 }}
                  >
                    编辑
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* F4: plain-text 文件 fill 友好段 — 提示用户手动编辑 */}
      {plainTextFillFiles.length > 0 && (
        <div
          className="form-row form-row-block"
          data-testid="plain-text-fill-warning"
          style={{
            padding: "8px 12px",
            background: "rgba(227,179,65,.08)",
            borderLeft: "3px solid var(--yellow)",
            borderRadius: 2,
            marginTop: 8,
          }}
        >
          <p className="form-hint" style={{ margin: 0, color: "var(--yellow)" }}>
            <DoodleIcon kind="key" /><strong>{plainTextFillFiles.length}</strong> 个普通文本文件（如 <code>.md</code> / <code>.sh</code>）无法自动写回密钥。请手动编辑这些文件：
          </p>
          {plainTextFillFiles.map((f, i) => (
            <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4, color: "var(--yellow)" }}>
              • <code>{f}</code>
            </p>
          ))}
        </div>
      )}

      {otherErrors.length > 0 && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>错误（{otherErrors.length}）：</p>
          {otherErrors.map((e, i) => <p key={i} className="form-hint" style={{ color: "var(--red)" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

export function SharedActionsList({ items }: { items: SharedAction[] }) {
  const actionLabel = (action: SharedAction["action"] | string) => ({
    created: "已新增",
    "skipped-same": "已存在且相同",
    overwritten: "已覆盖",
    "backed-up-then-overwritten": "已先备份再覆盖",
  } as Record<string, string>)[action] ?? action;
  const categoryLabel = (category: SharedAction["category"] | string) => ({
    dch_script: "脚本文件",
    agents: "Agents 资源",
  } as Record<string, string>)[category] ?? category;
  // 按 action 聚合：created N / overwritten M / skipped K
  const grouped = items.reduce<Record<string, number>>((acc, x) => {
    const label = actionLabel(x.action);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(grouped).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return (
    <details>
      <summary className="form-hint">{summary}</summary>
      {items.map((x, i) => (
        <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4 }}>
          [{categoryLabel(x.category)}] {x.relPath} → {actionLabel(x.action)}
        </p>
      ))}
    </details>
  );
}

export function PlaceholdersList({ items }: { items: PlaceholderEntry[] }) {
  return (
    <details open>
      <summary className="form-hint">点击展开 / 收起</summary>
      {items.map((p, i) => (
        <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4 }}>
          <code>{p.fieldName}</code> — {p.hint}<br />
          <span style={{ color: "var(--fg3)" }}>{p.hostPath ?? p.packPath}</span>
        </p>
      ))}
    </details>
  );
}

/**
 * **REVIEW_9 follow-up F4**: 把 result.errors[] 拆分成「plain-text fill 失败(友好提示)」 +
 * 「其他错误(原样显示)」两组,让 RestoreReportBody 单独渲染前者。
 *
 * R1 G1 已让 field-path.ts:fillSingleFile 报清晰 error("文件后缀非 .json/.toml,不支持自动
 * fill"),但只到 secretsErrors[] + 镜像加 `secrets-fill: ` 前缀进 result.errors[] 里堆所有
 * error 一起显示 — 用户可能不知道这意味着「写到 .md/.sh 等 plain-text 文件的占位符没自动
 * 填,请手动编辑文件填回真值」。本 helper 提取后缀拒型 error 让 UI 单独友好显示,其他 error
 * 原样保留进 errors 段。
 *
 * 匹配后缀拒 error 文案与 field-path.ts:261 同源 — 改 field-path.ts 文案需同步本 RE。
 *
 * pure 函数(无副作用)便于 unit test;export 方便 RestoreReportBody.test.tsx 直接 cover。
 */
const SUFFIX_REJECT_RE = /^secrets-fill: (.+?): 文件后缀非 \.json\/\.toml/;

export function splitErrorsForReport(errors: string[]): {
  plainTextFillFiles: string[];
  otherErrors: string[];
} {
  const plainTextFillFiles: string[] = [];
  const otherErrors: string[] = [];
  for (const e of errors) {
    const m = e.match(SUFFIX_REJECT_RE);
    if (m) plainTextFillFiles.push(m[1]!);
    else otherErrors.push(e);
  }
  return { plainTextFillFiles, otherErrors };
}
