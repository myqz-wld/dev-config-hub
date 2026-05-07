import React, { useState, useEffect, useMemo } from "react";
import { parse as parseToml } from "smol-toml";
import type { ConfigScope } from "../../../types.ts";
import type { ToolSchema, FieldSchema } from "../../../schemas/types.ts";
import { renderField } from "../fields/index.tsx";
import { FieldErrorsProvider } from "../fields/errors-context.tsx";
import { ScopedUiPrefsProvider, useScopedUiPrefs } from "../fields/ui-prefs-context.tsx";
import { patchJson } from "../../../schemas/json-patcher.ts";
import { patchToml } from "../../../schemas/toml-patcher.ts";
import { diffPatches } from "../../../schemas/diff.ts";
import { validate } from "../../../schemas/validator.ts";
import { readFileWithMtime } from "../../bridge.ts";

/**
 * Schema-driven scope body：把 ToolSchema + ConfigScope 接到 fields/renderField 调度器，
 * 字段级 onChange → diffPatches → patcher（json / toml）→ onPatchSave 写盘 + 本地 setState 乐观更新。
 *
 * **数据完整性铁律**（REVIEW_3）：
 *   - JSON 写回严格走 `patchJson`（jsonc-parser 字段级 modify），不全量序列化
 *   - TOML 写回严格走 `patchToml`（行级 in-place + fallback 重新 stringify）
 *   - 未知 key 永远保留；scope 头部汇总「N 个 unknown」让用户心理预期
 *   - 失败回滚（外部 onPatchSave throw 时 setState 回滚到旧值）
 *
 * **TOCTOU 完整 banner**（PR-G）：mount + scope 变化时 `readFileWithMtime` 拿当前 mtime（us 精度）；
 * save 前再 stat 比对，不一致 → 弹内联 banner「文件已被外部修改 [重新加载 / 强制覆盖 / 取消]」，
 * 不直接写盘。这是 user-space 经典 TOCTOU 解 —— stat 与 save 之间仍有窗口（业内乐观策略接受）。
 *
 * **乐观 UI 策略**：不 reload 全量 loadAllConfigs；外部 scope.content 变化通过 useEffect 同步本地。
 */

interface ConflictState {
  freshContent: string;
  freshMtimeUs: number | null;
  newContent: string;
  newParsed: Record<string, unknown>;
  oldContent: string;
  oldParsed: Record<string, unknown>;
  // REVIEW_4 R_2 L1：TOML fallback 重新 stringify 注释丢失提示，需在 conflict 解决（onConflictOverwrite）后透传给 doSave
  fallbackReason?: string;
}

export function SchemaScopeBody({
  scope,
  toolSchema,
  onPatchSave,
  flash,
}: {
  scope: ConfigScope;
  toolSchema: ToolSchema;
  onPatchSave: (path: string, content: string) => Promise<void>;
  flash: (msg: string, ok: boolean) => void;
}) {
  const [parsed, setParsed] = useState<Record<string, unknown>>(scope.parsed);
  const [content, setContent] = useState<string>(scope.content);
  const [saving, setSaving] = useState(false);
  const [loadedMtimeUs, setLoadedMtimeUs] = useState<number | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // 外部 scope 变化（reload 触发）→ 同步本地
  // REVIEW_4 R_2 R-M3：saving 期间 reload 会覆盖乐观更新中的 newParsed 让 in-flight 改动丢失；
  // 加 saving guard：保存中时不接受外部 reload（用户的 in-flight 改动 > 磁盘旧值）
  useEffect(() => {
    if (saving) return;  // R-M3 saving 中跳过同步，等 doSave finally setSaving(false) 后下次 reload 触发
    setParsed(scope.parsed);
    setContent(scope.content);
    setConflict(null);
  }, [scope.content, scope.parsed, saving]);

  // mount + scope 变化时刷新 mtime（PR-G TOCTOU）
  useEffect(() => {
    readFileWithMtime(scope.filePath)
      .then((r) => setLoadedMtimeUs(r.mtimeUs))
      .catch(() => setLoadedMtimeUs(null));
  }, [scope.filePath, scope.content]);

  const declaredKeys = new Set(Object.keys(toolSchema.rootSchema.properties ?? {}));
  const unknownKeys = Object.keys(parsed).filter((k) => !declaredKeys.has(k));

  // PR-J：ajv runtime 校验（toolSchema + parsed 变化时重算；validator 内部缓存 compile）
  const diagnostics = useMemo(() => validate(toolSchema, parsed), [toolSchema, parsed]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const computePatched = (newParsed: Record<string, unknown>) => {
    const patches = diffPatches(parsed, newParsed);
    if (patches.length === 0) return null;
    if (scope.format === "toml") {
      const r = patchToml(content, patches);
      return { newContent: r.patched, fallbackReason: r.fallback ? r.reason : undefined };
    }
    return { newContent: patchJson(content, patches), fallbackReason: undefined };
  };

  const doSave = async (
    newContent: string,
    newParsed: Record<string, unknown>,
    oldContent: string,
    oldParsed: Record<string, unknown>,
    fallbackReason?: string,
  ) => {
    setSaving(true);
    try {
      await onPatchSave(scope.filePath, newContent);
      // save 成功，刷新 mtime 防下次 TOCTOU 误报
      const after = await readFileWithMtime(scope.filePath).catch(() => ({ mtimeUs: null }));
      setLoadedMtimeUs(after.mtimeUs);
      if (fallbackReason) flash(`已重新序列化（注释将丢失）：${fallbackReason}`, false);
    } catch (e) {
      // REVIEW_4 M1：之前 catch 静默回滚，用户感知不到 save 失败
      flash(`保存失败：${e instanceof Error ? e.message : String(e)}`, false);
      setParsed(oldParsed);
      setContent(oldContent);
    } finally {
      setSaving(false);
    }
  };

  const handleRootChange = async (next: Record<string, unknown> | undefined) => {
    const newParsed = next ?? {};
    let computed: { newContent: string; fallbackReason?: string } | null;
    try {
      computed = computePatched(newParsed);
    } catch (e) {
      flash(`patch 失败：${(e as Error).message}`, false);
      return;
    }
    if (!computed) return;
    const { newContent, fallbackReason } = computed;

    // 乐观更新本地
    const oldParsed = parsed;
    const oldContent = content;
    setParsed(newParsed);
    setContent(newContent);

    // PR-G TOCTOU：save 前 stat 比对（仅当 loadedMtimeUs 已知）
    if (loadedMtimeUs != null) {
      try {
        const fresh = await readFileWithMtime(scope.filePath);
        if (fresh.mtimeUs != null && fresh.mtimeUs !== loadedMtimeUs) {
          setConflict({
            freshContent: fresh.content,
            freshMtimeUs: fresh.mtimeUs,
            newContent,
            newParsed,
            oldContent,
            oldParsed,
            fallbackReason,  // REVIEW_4 R_2 L1：透传给 onConflictOverwrite → doSave
          });
          return;
        }
      } catch {
        // stat 失败不阻塞 save，继续
      }
    }

    await doSave(newContent, newParsed, oldContent, oldParsed, fallbackReason);
  };

  const onConflictReload = () => {
    if (!conflict) return;
    // REVIEW_4 H1：按 scope.format 分流 parser；之前硬编 JSON.parse → TOML 文本必 throw → catch 块 setParsed({}) 让 codex config 整面板变空
    let reparsed: Record<string, unknown> = {};
    try {
      if (scope.format === "toml") {
        reparsed = parseToml(conflict.freshContent) as Record<string, unknown>;
      } else {
        reparsed = JSON.parse(conflict.freshContent);
      }
    } catch (e) {
      // REVIEW_4 R_2 M1：之前 catch 后无 return，会继续 setParsed({}) + setConflict(null) 让 UI 空 + banner 消失
      flash(`重新加载解析失败（${scope.format}）：${(e as Error).message}`, false);
      return;
    }
    setParsed(reparsed);
    setContent(conflict.freshContent);
    // R_2 R-L1：freshMtimeUs 可能 null（pre-1970 / FS 不支持）→ 之后跳 stat。fallback 到 mount useEffect 重新拿一次
    if (conflict.freshMtimeUs != null) {
      setLoadedMtimeUs(conflict.freshMtimeUs);
    } else {
      readFileWithMtime(scope.filePath).then((r) => setLoadedMtimeUs(r.mtimeUs)).catch(() => {});
    }
    setConflict(null);
  };

  const onConflictOverwrite = async () => {
    if (!conflict) return;
    const c = conflict;
    setConflict(null);
    // REVIEW_4 R_2 L1：透传 fallbackReason → doSave 仍能 flash「TOML 注释将丢失」提示
    await doSave(c.newContent, c.newParsed, c.oldContent, c.oldParsed, c.fallbackReason);
  };

  const onConflictCancel = () => {
    if (!conflict) return;
    // 回滚本地 state 到 oldContent / oldParsed（用户主动放弃这次改动）
    setParsed(conflict.oldParsed);
    setContent(conflict.oldContent);
    setConflict(null);
  };

  return (
    <ScopedUiPrefsProvider scopeKind={toolSchema.scopeKind}>
      <SchemaScopeBodyInner
        scope={scope}
        toolSchema={toolSchema}
        parsed={parsed}
        diagnostics={diagnostics}
        showDiagnostics={showDiagnostics}
        setShowDiagnostics={setShowDiagnostics}
        unknownKeys={unknownKeys}
        conflict={conflict}
        onConflictReload={onConflictReload}
        onConflictOverwrite={onConflictOverwrite}
        onConflictCancel={onConflictCancel}
        saving={saving}
        handleRootChange={handleRootChange}
      />
    </ScopedUiPrefsProvider>
  );
}

interface InnerProps {
  scope: ConfigScope;
  toolSchema: ToolSchema;
  parsed: Record<string, unknown>;
  diagnostics: ReturnType<typeof validate>;
  showDiagnostics: boolean;
  setShowDiagnostics: (v: boolean) => void;
  unknownKeys: string[];
  conflict: ConflictState | null;
  onConflictReload: () => void;
  onConflictOverwrite: () => void;
  onConflictCancel: () => void;
  saving: boolean;
  handleRootChange: (next: Record<string, unknown> | undefined) => Promise<void>;
}

/**
 * Inner body：必须在 ScopedUiPrefsProvider 内才能 useScopedUiPrefs。
 * 拆出来是为了让 hidden-toggle / hiddenCount 在 provider 内消费 context（外层组件
 * 在 provider 之外，调 hook 会拿 null）。
 */
function SchemaScopeBodyInner({
  scope,
  toolSchema,
  parsed,
  diagnostics,
  showDiagnostics,
  setShowDiagnostics,
  unknownKeys,
  conflict,
  onConflictReload,
  onConflictOverwrite,
  onConflictCancel,
  saving,
  handleRootChange,
}: InnerProps) {
  const ui = useScopedUiPrefs();
  // 计算当前 scope 隐藏的字段数（手动 + advanced）。仅 root level properties 参与统计。
  const rootProps = (toolSchema.rootSchema.properties ?? {}) as Record<string, FieldSchema>;
  const hiddenCount = ui ? ui.countHidden(rootProps) : 0;

  return (
    <div className="schema-scope-body">
      {hiddenCount > 0 && ui && (
        <div className="schema-hidden-toggle">
          <button
            type="button"
            className="schema-hidden-toggle-btn"
            onClick={() => ui.setShowHidden(!ui.showHidden)}
          >
            {ui.showHidden
              ? `▾ 收起隐藏字段（${hiddenCount}）`
              : `▸ 显示隐藏字段（${hiddenCount}）`}
          </button>
        </div>
      )}
      {conflict && (
        <div className="schema-conflict">
          <div className="schema-conflict-msg">
            ⚠️ 文件已被外部修改（mtime 变化）。继续保存会覆盖外部改动。
          </div>
          <div className="schema-conflict-actions">
            <button className="btn-sm" onClick={onConflictReload}>重新加载（放弃我的改动）</button>
            <button className="btn-sm danger" onClick={onConflictOverwrite}>强制覆盖</button>
            <button className="btn-sm" onClick={onConflictCancel}>取消编辑</button>
          </div>
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="schema-diagnostics">
          <button
            type="button"
            className="schema-diagnostics-head"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
          >
            {showDiagnostics ? "▼" : "▶"} ⚠ {diagnostics.length} 个 schema 校验问题（点击{showDiagnostics ? "收起" : "展开"}）
          </button>
          {showDiagnostics && (
            <ul className="schema-diagnostics-list">
              {diagnostics.slice(0, 20).map((d, i) => (
                <li key={i} className={`schema-diagnostic ${d.level}`}>
                  <code>{d.path}</code>: {d.message}
                </li>
              ))}
              {diagnostics.length > 20 && (
                <li className="schema-diagnostic info">…还有 {diagnostics.length - 20} 个，详见 raw 模式 lint gutter</li>
              )}
            </ul>
          )}
        </div>
      )}
      {unknownKeys.length > 0 && (
        <div className="schema-unknown-summary">
          ⓘ 包含 <strong>{unknownKeys.length}</strong> 个未在 schema 内的字段（已保留）：
          <code>{unknownKeys.slice(0, 5).join(", ")}</code>
          {unknownKeys.length > 5 && <span> 等 {unknownKeys.length} 个</span>}
        </div>
      )}
      {saving && <div className="schema-saving">保存中…</div>}
      <FieldErrorsProvider diagnostics={diagnostics}>
        {renderField({
          schema: toolSchema.rootSchema,
          value: parsed,
          onChange: handleRootChange as (next: unknown) => void,
          path: "",
          scopeContext: { level: scope.level, filePath: scope.filePath },
          depth: 0,
        })}
      </FieldErrorsProvider>
    </div>
  );
}
