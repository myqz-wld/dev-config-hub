import { useState, useEffect, useRef } from "react";
import {
  dchProfile, type Profile, type Manifest, type AppliedProfile,
  type ApplyBackupResult, type PlaceholderEntry,
  type SecretLogicalEntry, type ApplyBackupWithSecretsResult,
  PartialRestoreError,
} from "../../bridge.ts";
import { RestoreSecretsBody, computeSecretsButton, type SecretsState } from "./RestoreSecretsBody.tsx";
import {
  CloseConfirm, RestorePreviewBody, RestoreReportBody,
} from "./restore-modal-bodies.tsx";
import {
  decideAttemptClose, countFilledSecrets, nextSecretsStateAfterIPC,
} from "./restore-modal-helpers.ts";

/**
 * 导入备份 modal：3-4 步流程（CHANGELOG_18 / Step 7）
 * 1. 输入 .dchpack 路径 → 读取预览（presetPackPath 时自动触发）
 * 2. 看冲突 / 改名（每个 profile 的 finalId 用户可覆盖）→ Next
 * 3. **填 K 个 secret**（仅 manifest.secrets_index.entries 非空时） → Restore
 * 4. 看还原报告 + 占位符清单（点击跳转编辑）→ 关闭
 *
 * step 3 跳过条件：旧 dchpack（无 secrets_index） / 新 pack 但 entries 为空 → 直接 step 2 → 4，
 * 走 dchProfile.restoreApply（占位符原样保留，与 fall back 行为一致）。
 *
 * 撞名处理：dry-run 已经算好 default 后缀（claude-pro → claude-pro-restored-TS），
 * 用户可在 input 改 finalId；UI 端做基础格式校验（^[a-zA-Z0-9_-]+$）+ 撞名实时提示。
 *
 * secret 安全：用户填的 realValue 仅在 secretsState 内存里，最后通过 dchProfile
 * .restoreApplyWithSecrets 一次性走 Rust tempfile route（mode 0600 + drop guard），
 * 不写 console / localStorage / 任何旁路 IPC。
 *
 * REVIEW_9 D-HIGH-2 (D-claude H2 + D-codex M4 双方独立): step 3 任何关闭路径都丢全部 secret 输入,
 * 无 confirm。修法：包 attemptClose() 函数：phase === "secrets" && filledCount > 0 → 弹内联
 * confirm（CHANGELOG_5 不能用 window.confirm）；3 入口（backdrop / X / cancel）统一走。
 *
 * REVIEW_9 D-MED-1 (D-claude H1 → D-codex 反驳降 MED): 还原成功后 secret 仍以明文残留 React state,
 * 直到「关闭」按钮 unmount 才 GC。修法：setResult(r) 后立即 setSecretsState({secretsMap:{},skipMap:{}})
 * （成功 + 失败两个分支都加），把窗口最小化到 IPC in-flight 那 N 秒。
 *
 * REVIEW_9 D-MED-7: secrets 清单（preview 预告）走共用 UniqueSecretsList。
 * REVIEW_9 D-claude LOW 4: step 2 加「← 重选文件」按钮回 step 1 改路径。
 */
export function RestoreBackupModal({
  profiles, presetPackPath, onClose, onToast, onReloadProfile, onRevealPlaceholder,
}: {
  profiles: Profile[];
  /** 预填 packPath（来自 BackupHistoryModal 还原跳转），mount 后自动 preview */
  presetPackPath?: string;
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
  onReloadProfile: (silent?: boolean) => Promise<void>;
  /** 跳转到 profile + configFile 的编辑器；configFile 是相对 configDir 的路径 */
  onRevealPlaceholder?: (profileId: string, configFile: string) => void;
}) {
  const [packPath, setPackPath] = useState(presetPackPath ?? "");
  const [preview, setPreview] = useState<{ manifest: Manifest; plan: ApplyBackupResult } | null>(null);
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});
  /** 来自 manifest.secrets_index.entries；null = 旧 pack / 新 pack 但 entries 为空 → 跳过 step 3 */
  const [secretEntries, setSecretEntries] = useState<SecretLogicalEntry[] | null>(null);
  const [secretsState, setSecretsState] = useState<SecretsState>({ secretsMap: {}, skipMap: {} });
  /** 仅当 hasSecrets 时有意义：rename = step 2，secrets = step 3。无 secrets 时 phase 始终 rename */
  const [phase, setPhase] = useState<"rename" | "secrets">("rename");
  const [result, setResult] = useState<ApplyBackupResult | (ApplyBackupWithSecretsResult & { manifest: Manifest }) | null>(null);
  const [busy, setBusy] = useState(false);
  /** REVIEW_9 D-HIGH-2: secrets phase 关 modal 时弹内联 confirm（不能用 window.confirm，CHANGELOG_5） */
  const [confirmClose, setConfirmClose] = useState(false);

  const hasSecrets = secretEntries !== null && secretEntries.length > 0;

  /**
   * REVIEW_9 D-HIGH-2: 中央关闭逻辑。secrets phase + 已填至少 1 个 secret → 弹内联 confirm；
   * 其他场景（rename / report / secrets phase 但全空）→ 直接 onClose()。
   *
   * 调用方：modal-backdrop / 右上角 ✕ / footer 取消按钮 三处统一走。
   * busy 中也调用（footer 已 disabled，但 backdrop / X 仍可触发 — 由 attemptClose 内拦截）。
   *
   * **REVIEW_9 G12 / D-MED-3**: 决策逻辑抽 `decideAttemptClose` pure helper 给 invariant test
   * 覆盖(busy / secrets phase + filled / phase mismatch 各分支)。component handler 仅做
   * filledCount 计算 + 按决策结果 dispatch (setConfirmClose / onClose)。
   */
  const attemptClose = () => {
    const filledCount = hasSecrets
      ? countFilledSecrets(secretEntries!, secretsState)
      : 0;
    const decision = decideAttemptClose({ busy, phase, hasSecrets, filledCount });
    if (decision === "noop") return;
    if (decision === "confirm") {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const onPreview = async () => {
    if (!packPath.trim()) {
      onToast("请输入 .dchpack 文件路径", false);
      return;
    }
    setBusy(true);
    try {
      const r = await dchProfile.restorePreview(packPath.trim());
      setPreview({ manifest: r.manifest, plan: r.plan });
      // 初始化 renameMap：dry-run 的 finalId 作为默认值
      const map: Record<string, string> = {};
      for (const ap of r.plan.appliedProfiles) {
        map[ap.originalId] = ap.finalId;
      }
      setRenameMap(map);
      // 提取 secrets_index entries（直接从 preview 的 manifest 拿，不做第二次 IPC）
      const entries = r.manifest.secrets_index?.entries;
      setSecretEntries(entries && entries.length > 0 ? entries : null);
      // 重置 secretsState（避免重 preview 时残留旧值）
      setSecretsState(nextSecretsStateAfterIPC());
      setPhase("rename");
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  // mount 时若有 presetPackPath，自动触发 preview（来自 BackupHistoryModal 还原跳转）
  // 用 ref 防 React 19 StrictMode 双 mount 重复 preview。
  const autoPreviewedRef = useRef(false);
  useEffect(() => {
    if (presetPackPath && !autoPreviewedRef.current) {
      autoPreviewedRef.current = true;
      void onPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * REVIEW_9 D-claude LOW 4: 「← 重选文件」回 step 1。重置 preview / renameMap / secretEntries
   * / secretsState / phase / autoPreviewedRef，但保留 packPath 让用户能在 input 里直接改。
   */
  const onBackToStep1 = () => {
    if (busy) return;
    setPreview(null);
    setRenameMap({});
    setSecretEntries(null);
    setSecretsState(nextSecretsStateAfterIPC());
    setPhase("rename");
    autoPreviewedRef.current = false;
  };

  const updateName = (originalId: string, newId: string) => {
    setRenameMap((m) => ({ ...m, [originalId]: newId }));
  };

  const renameError = (originalId: string, finalId: string): string | null => {
    if (!finalId) return "方案 ID 不能为空";
    if (!/^[a-zA-Z0-9_-]+$/.test(finalId)) return "只允许字母 / 数字 / _ / -";
    // 跟现有 profile 撞名（除了被还原的同名 profile 自身 — 还原是新建非覆盖）
    if (profiles.some((p) => p.id === finalId)) return `已存在同名方案 ${finalId}`;
    // 跟同批其他还原 profile 撞名
    const others = Object.entries(renameMap).filter(([k]) => k !== originalId).map(([, v]) => v);
    if (others.includes(finalId)) return "和本次导入中的另一个方案重名";
    return null;
  };

  // step 2 rename 阶段错误：每个 profile 改名校验
  const renameHasError = preview
    ? preview.plan.appliedProfiles.some((ap) => renameError(ap.originalId, renameMap[ap.originalId] ?? "") !== null)
    : false;

  // step 3 secrets 阶段错误：未填且未跳过的 entry
  const secretsButton = hasSecrets ? computeSecretsButton(secretEntries!, secretsState) : { label: "", hasError: false };

  // 当前 step 是否阻塞 Next 按钮
  const hasError = phase === "rename" ? renameHasError : secretsButton.hasError;

  const onApply = async () => {
    if (!preview || hasError) return;

    // phase rename + 有 secrets：仅切到 step 3，不调 IPC
    if (phase === "rename" && hasSecrets) {
      setPhase("secrets");
      return;
    }

    setBusy(true);
    try {
      // phase rename + 无 secrets（旧 pack 或新 pack 但 entries 空）→ 走原 restoreApply
      if (phase === "rename") {
        const r = await dchProfile.restoreApply(packPath.trim(), { renameMap });
        setResult(r);
        // REVIEW_9 D-MED-1: 成功 / 失败 / partial 三分支统一在外层 finally 清 secretsState
        if (r.errors.length > 0) {
          onToast(`导入完成，但有 ${r.errors.length} 个错误`, false);
        } else {
          onToast(`已导入 ${r.appliedProfiles.length} 个配置方案`, true);
        }
      } else {
        // phase secrets：调 restoreApplyWithSecrets。skip 项不入 secretsMap，让 CLI 走 user-skip 语义。
        // REVIEW_9 D-MED-1: 构造完 filledMap 后立刻清 secretsState（最小化暴露窗口到 IPC in-flight 那 N 秒）。
        const filledMap: Record<string, string> = {};
        for (const e of secretEntries ?? []) {
          if (secretsState.skipMap[e.name]) continue;
          const v = secretsState.secretsMap[e.name];
          if (v && v.length > 0) filledMap[e.name] = v;
        }
        setSecretsState(nextSecretsStateAfterIPC());
        const r = await dchProfile.restoreApplyWithSecrets(packPath.trim(), {
          renameMap,
          secretsMap: filledMap,
        });
        setResult(r);
        if (r.errors.length > 0) {
          onToast(`导入完成，但有 ${r.errors.length} 个错误`, false);
        } else {
          onToast(`已导入 ${r.appliedProfiles.length} 个配置方案，已填入 ${r.secretsApplied} 处密钥`, true);
        }
      }
      await onReloadProfile();
    } catch (e) {
      // REVIEW_9 D-HIGH-1: partial restore 走 PartialRestoreError 分支 → 渲染部分还原报告 +
      // reload profile（让 ~/.dch-restored/ 已写的 N-1 个 profile 在主 panel 里立即可见）
      if (e instanceof PartialRestoreError) {
        setResult(e.result as ApplyBackupResult);
        onToast(`部分导入：${e.result.errors.length} 个错误，已导入 ${e.result.appliedProfiles.length} 个配置方案`, false);
        await onReloadProfile();
      } else {
        onToast(e instanceof Error ? e.message : String(e), false);
      }
    } finally {
      setBusy(false);
      // REVIEW_9 D-MED-1: 兜底再清一次 secretsState（任何分支 failed/success/partial 都到这里）
      setSecretsState(nextSecretsStateAfterIPC());
    }
  };

  // 把 placeholder.hostPath 拆成 (profileId, relativeConfigFile) 给 onRevealPlaceholder
  const computeRevealTarget = (
    ph: PlaceholderEntry,
    appliedById: Record<string, AppliedProfile>,
  ): { profileId: string; configFile: string } | null => {
    // packPath 形如 profiles/<originalId>/configDir/<rel> 或 profiles/<originalId>/_meta.json
    const m = ph.packPath.match(/^profiles\/([^/]+)\/(?:configDir\/(.+)|_meta\.json)$/);
    if (!m) return null;
    const originalId = m[1]!;
    const ap = appliedById[originalId];
    if (!ap) return null;
    if (m[2]) return { profileId: ap.finalId, configFile: m[2] };
    return null; // _meta.json 不在 ConfigPanel 里编辑（要用编辑 store）
  };

  return (
    <div className="modal-backdrop" onClick={attemptClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📥 导入备份</h2>
          <button className="modal-close" onClick={attemptClose}>×</button>
        </div>
        <div className="modal-body">
          {confirmClose && (
            <CloseConfirm
              filledCount={
                secretEntries
                  ? secretEntries.filter((e) => !secretsState.skipMap[e.name] && (secretsState.secretsMap[e.name] ?? "").length > 0).length
                  : 0
              }
              onCancel={() => setConfirmClose(false)}
              onConfirm={() => {
                // 用户确认放弃 → 立即清 secretsState 再关 modal（防关闭过渡帧 React DevTools 还能看到）
                setSecretsState(nextSecretsStateAfterIPC());
                setConfirmClose(false);
                onClose();
              }}
            />
          )}
          {!preview ? (
            <>
              <div className="form-row form-row-block">
                <label>.dchpack 文件路径</label>
                <input
                  type="text"
                  value={packPath}
                  onChange={(e) => setPackPath(e.target.value)}
                  placeholder="~/.dch/backups/dch-backup-20260513-143025.dchpack 或 /tmp/example.dchpack"
                  spellCheck={false}
                  disabled={busy}
                />
                <p className="form-hint">
                  支持 <code>~/...</code> 或绝对路径。查看内容不会写入任何文件。
                </p>
              </div>
            </>
          ) : !result ? (
            phase === "rename" ? (
              <RestorePreviewBody
                manifest={preview.manifest}
                plan={preview.plan}
                renameMap={renameMap}
                renameError={renameError}
                onUpdate={updateName}
                busy={busy}
                secretEntries={secretEntries}
              />
            ) : (
              <RestoreSecretsBody
                entries={secretEntries!}
                state={secretsState}
                onChange={setSecretsState}
                busy={busy}
              />
            )
          ) : (
            <RestoreReportBody
              result={result}
              appliedById={Object.fromEntries(result.appliedProfiles.map((a: AppliedProfile) => [a.originalId, a]))}
              onReveal={onRevealPlaceholder}
              computeRevealTarget={computeRevealTarget}
              secretsMetrics={"secretsApplied" in result ? {
                applied: result.secretsApplied,
                skipped: result.secretsSkipped,
                unknown: result.secretsUnknown,
              } : undefined}
            />
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={attemptClose} disabled={busy}>
            {result ? "关闭" : "取消"}
          </button>
          {!preview && (
            <button className="btn primary" onClick={onPreview} disabled={busy || !packPath.trim()}>
              {busy ? "读取中…" : "查看内容"}
            </button>
          )}
          {preview && !result && phase === "rename" && (
            <button className="btn ghost" onClick={onBackToStep1} disabled={busy}>
              ← 重选文件
            </button>
          )}
          {preview && !result && phase === "secrets" && (
            <button className="btn ghost" onClick={() => setPhase("rename")} disabled={busy}>
              ← 上一步
            </button>
          )}
          {preview && !result && (
            <button className="btn primary" onClick={onApply} disabled={busy || hasError}>
              {busy
                ? "还原中…"
                : phase === "rename"
                  ? hasSecrets
                    ? `下一步：填写 ${secretEntries!.length} 个密钥`
                    : "开始导入"
                  : secretsButton.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
