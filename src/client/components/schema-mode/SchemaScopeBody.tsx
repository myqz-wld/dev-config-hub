import React, { useState, useEffect, useMemo, useRef } from "react";
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
 * 用户是否正在输入控件中（focus 在 input/textarea/contenteditable）。
 *
 * CHANGELOG_10 review fix R_1·M1 (claude MED)：5s mtime poll silent setParsed 会让
 * fields/{StringField,NumberField,PathField,SensitiveField}.tsx 的 useEffect [value]
 * 触发 setDraft(value)，把用户中途打字未 blur 的 draft 擦掉。poll 触发 reload 前调本函数
 * → 命中跳过本次覆盖，等用户 blur 后下次 poll 间隔自然 reload（磁盘新内容不会丢失）。
 *
 * **export 仅给单测用**（CHANGELOG_10 R_3 N3·5 必修 test #2 + #4 测 helper 直接行为）；
 * 生产代码不应直接 import，sync prop-sync useEffect 与 5s poll 的 isUserTyping guard 保持单一来源。
 */
export function isUserTyping(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

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
  //
  // CHANGELOG_10 review fix R_1·双方一致 MED（claude R1 ❓ + codex M1 ✅）：
  //   原 deps 含 [saving] → saving 从 true→false 时 effect 重跑；若 focus reload 在 doSave 期间到达
  //   把 stale scope.parsed/scope.content 推过来，doSave 完成 setSaving(false) 那一帧 effect 用
  //   stale prop 反转 setParsed/setContent → UI 回退到 save 前内容（磁盘已新，UI 旧，下次 focus 才自愈）。
  //   修法：saving 从 deps 移除 + savingRef 镜像。effect 只在 scope.parsed/scope.content 真变化时跑，
  //   不再因 saving 转换额外重跑；ref 拿到的是 effect 触发那一刻 React commit 后的最新 saving 值。
  //
  // CHANGELOG_10 review fix R_2·N-conflict-lost（双方一致 ✅ MED）：
  //   sync effect 不检 conflict → focus reload 在 PR-G TOCTOU banner 显示期间触发会
  //   setConflict(null) 静默清掉 banner + setParsed/setContent 应用外部内容 → 用户待保存的
  //   newParsed/newContent（藏在 conflict 对象里）永久丢失。conflict 清零只应由用户三按钮触发
  //   （onConflictReload/Overwrite/Cancel）。修法：加 conflictRef 镜像 + effect 加 conflict guard。
  //
  // CHANGELOG_10 review fix R_2·M1-followup（claude MED）：
  //   M1 (Round 1 fix) isUserTyping guard 只盖 5s poll，不盖 prop-sync 路径（focus reload → setTools
  //   → ConfigPanel 推 scope.parsed prop → SchemaScopeBody prop-sync setParsed → 字段 useEffect[value]
  //   触发 setDraft → 用户中途打字未 blur 被擦）。修法：prop-sync 内同样加 isUserTyping() guard。
  const savingRef = useRef(saving);
  const conflictRef = useRef(conflict);
  // R_2·R1-residual：独立 writingRef，不被 ref-sync useEffect 覆盖；handleRootChange try/finally 显式管理
  // 用于 hold prop-sync 在「optimistic setParsed → await TOCTOU stat → doSave 内 setSaving(true)」窗口期间
  const writingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
    conflictRef.current = conflict;
  });

  useEffect(() => {
    // R-M3 saving 中跳过同步；ref 拿当前最新值，不靠 deps
    if (savingRef.current) return;
    // R_2·R1-residual：handleRootChange optimistic→IPC→doSave 全程 hold（writingRef 不被 ref-sync 覆盖）
    if (writingRef.current) return;
    // R_2 N-conflict-lost：PR-G TOCTOU banner 期间不接受 prop-sync，避免静默清 conflict + 丢用户改动
    if (conflictRef.current) return;
    // R_2 M1-followup：用户正在 input/textarea 中打字未 blur，prop-sync 也会触发 field useEffect[value]
    // 擦掉 draft；与 5s poll 同 guard 对齐
    if (isUserTyping()) return;
    setParsed(scope.parsed);
    setContent(scope.content);
    setConflict(null);
  }, [scope.content, scope.parsed]);

  // mount + scope 变化时刷新 mtime（PR-G TOCTOU）
  useEffect(() => {
    readFileWithMtime(scope.filePath)
      .then((r) => setLoadedMtimeUs(r.mtimeUs))
      .catch(() => setLoadedMtimeUs(null));
  }, [scope.filePath, scope.content]);

  // 自动刷新：5s 周期 mtime poll → 检测外部修改 → safe state 下 silent 重新 parse 同步本地。
  //
  // **safe state**：!saving && !conflict && loadedMtimeUs != null（基准已建立）
  //   - saving 中：等 doSave 内部 setLoadedMtimeUs 跟上，此次 poll 跳过
  //   - conflict 中：用户正在 resolve banner，不能背后改本地
  //   - loadedMtimeUs == null：mount mtime 还没拿到（pre-1970 / metadata 失败），跳过
  //
  // **不会覆盖自己 save**：doSave 成功后已 setLoadedMtimeUs(after.mtimeUs)，下次 poll 比对相等 → return。
  // 仅当 r.mtimeUs !== loadedMtimeUs 才认定外部修改 → reload。
  //
  // **parse 失败静默 return**：磁盘上半成品（用户手编了一半未存）让 schema 模式不闪到空，
  // 等用户下次主动改字段时走 handleRootChange → save 前 stat → conflict banner。
  //
  // **stale closure 防御**：用 ref 镜像 saving/conflict/loadedMtimeUs，interval 只在
  // [scope.filePath, scope.format] 变化时重启（避免每次 save 后清重 setInterval 让 poll 时钟漂移）。
  // ref sync useEffect 无 deps 每次 render 后 commit 跑一次：5s 间隔下 ref 永远 fresh enough。
  const pollStateRef = useRef({ saving, conflict, loadedMtimeUs });
  useEffect(() => { pollStateRef.current = { saving, conflict, loadedMtimeUs }; });

  useEffect(() => {
    const id = window.setInterval(() => {
      const before = pollStateRef.current;
      if (before.saving || before.conflict || before.loadedMtimeUs == null) return;
      readFileWithMtime(scope.filePath).then((r) => {
        // 二次检查：readFileWithMtime 在飞期间用户可能开始 save / 弹 conflict / loadedMtimeUs 已被自己 save 推进
        const now = pollStateRef.current;
        if (now.saving || now.conflict) return;
        if (r.mtimeUs == null || r.mtimeUs === now.loadedMtimeUs) return;
        // CHANGELOG_10 review fix R_1·M1 (claude MED)：5s poll 静默 setParsed 会让 fields/StringField 等
        // 4 个文本控件的 useEffect [value] 触发 setDraft(value)，把用户中途打字未 blur 的 draft 擦掉。
        // 修法：poll 触发覆盖前检查 document.activeElement，若用户正在 input/textarea/contenteditable 中
        // → 跳过本次 silent 覆盖，等用户 blur 后下次 poll 间隔自然 reload。
        // 数据完整性：磁盘新内容不会丢失，下次 poll（5s）/ user blur / focus reload 都能拿到最新 mtime。
        if (isUserTyping()) return;
        // 外部修改：silent 重新 parse + 覆盖本地
        let reparsed: Record<string, unknown> = {};
        try {
          if (scope.format === "toml") reparsed = parseToml(r.content) as Record<string, unknown>;
          else reparsed = JSON.parse(r.content);
        } catch {
          return;  // 半成品文件，等用户操作再处理
        }
        setParsed(reparsed);
        setContent(r.content);
        setLoadedMtimeUs(r.mtimeUs);
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [scope.filePath, scope.format]);

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
    // CHANGELOG_10 review fix R_2·R1-residual（claude MED *未验证* + lead 代码路径实证）：
    //   原 saving guard 修了 saving false→true 的 React commit 延迟，但 handleRootChange 内
    //   optimistic setParsed → await readFileWithMtime（5-50ms IPC）→ doSave 内 setSaving(true) 之间
    //   savingRef 仍是 false（doSave 触发的 setSaving 要等 React commit 后 ref-sync 才同步）。期间若
    //   focus reload 推 prop → prop-sync setParsed(stale scope.parsed) 覆盖刚写的 newParsed → doSave
    //   完成后本地 parsed 永久停留 pre-save 旧值（磁盘正确，UI 旧）。
    //   修法：独立 writingRef（不被 ref-sync useEffect 覆盖；try/finally 显式管理），prop-sync 加
    //   writingRef check。语义：「handleRootChange 整段执行期间 prop-sync 都 hold」。
    //   conflict / save 路径退出后由 conflictRef / savingRef 接力 hold（ref-sync 跟 React commit 同步），
    //   不存在 ref handoff race（React 同步代码不 yield；commit phase ref-sync useEffect 按 source order 先于 prop-sync 跑）。
    writingRef.current = true;
    try {
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
    } finally {
      writingRef.current = false;
    }
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
