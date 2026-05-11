import React, { useState, useEffect, useMemo, useRef } from "react";
import type { ToolConfig, ConfigScope, ConfigEntry } from "../../types.ts";
import { CMEditor } from "./editor/CMEditor.tsx";
import { languageExtensionFor } from "./editor/languages.ts";
import { buildSchemaExtensions } from "./editor/schema-lint.ts";
import { SchemaScopeBody } from "./schema-mode/SchemaScopeBody.tsx";
import { MarkdownView } from "./markdown/MarkdownView.tsx";
import { detectScope, getSchemaForScope } from "../../schemas/registry.ts";
import type { ToolSchema } from "../../schemas/types.ts";
import { getHomeDir } from "../bridge.ts";

const Chev = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`chev${open ? " open" : ""}`}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Val({ value, type }: { value: unknown; type: string }) {
  if (value == null) return <span className="v dim">null</span>;
  if (typeof value === "boolean") return <span className={`pill ${value ? "on" : "off"}`}>{String(value)}</span>;
  if (typeof value === "number") return <span className="v v-num">{value}</span>;
  if (typeof value === "string") {
    if (type === "path" || type === "command" || type === "alias" || type === "raw" || type === "markdown")
      return <span className="v v-raw">{value}</span>;
    return <span className="v v-str">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="v dim">[]</span>;
    if (value.every((v) => typeof v === "string") && value.length <= 6)
      return <span className="tags">{value.map((v, i) => <span key={i} className="tag">{v as string}</span>)}</span>;
  }
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

function Item({ item }: { item: ConfigEntry }) {
  return (
    <div className="item">
      <div className="item-key">
        <code>{item.key}</code>
        {item.description && <span className="item-desc">{item.description}</span>}
      </div>
      <div className="item-val"><Val value={item.value} type={item.type} /></div>
    </div>
  );
}

type Mode = "schema" | "render" | "view" | "raw" | "edit";

function defaultModeFor(toolSchema: ToolSchema | null, format: ConfigScope["format"]): Mode {
  if (toolSchema) return "schema";
  if (format === "markdown") return "render";
  return "view";
}

function Scope({
  scope,
  toolSchema,
  onSave,
  onPatchSave,
  onToast,
}: {
  scope: ConfigScope;
  toolSchema: ToolSchema | null;
  onSave: (p: string, c: string) => Promise<void>;
  onPatchSave: (p: string, c: string) => Promise<void>;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>(defaultModeFor(toolSchema, scope.format));
  const [buf, setBuf] = useState("");
  const [saving, setSaving] = useState(false);

  // CHANGELOG_10 review fix R_1·H1（双方一致 ✅ HIGH）：edit 模式 + focus reload 联动 silent overwrite
  //
  // 问题：CHANGELOG_10 加 focus / visibilitychange 后，edit 活跃期 scope.content 会被外部 reload 推变；
  // 但 buf 只在点「编辑」按钮 setBuf(scope.content) 一次性 snapshot，再无回流 → CMEditor 始终显示旧 buf。
  // 用户保存触发 onSave(buf) → fs::write(buf) 无 mtime check → **静默覆盖外部修改 5 步必中复现**。
  //
  // 修法：进 edit 模式时记录 enterEditContent 基线；scope.content 后续变化（必然来自外部 reload，
  // 因为 onSave 成功后已 setMode 退出 edit）→ 设 externalChanged=true → 顶部 banner 让用户决策
  // [重新加载放弃改动 / 保留改动（保存覆盖）/ 取消编辑]，与 SchemaScopeBody PR-G TOCTOU banner 风格一致。
  //
  // 不在 save 前 stat 比对（方案 A）：那种是「最后一刻才提示」，用户白打字风险更大；
  // 改用 reactive 监测，让用户在打字过程中就能看到 banner，主动决定怎么处理。
  const [externalChanged, setExternalChanged] = useState(false);
  const enterEditRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== "edit") {
      enterEditRef.current = null;
      setExternalChanged(false);
      return;
    }
    if (enterEditRef.current === null) {
      // 第一次进 edit（onClick 那一帧）：记录基线（与 setBuf(scope.content) 同源）
      enterEditRef.current = scope.content;
    } else if (scope.content !== enterEditRef.current) {
      // 基线已存 + scope.content 变了 = 外部 reload 推过来的
      setExternalChanged(true);
    } else {
      // CHANGELOG_10 R_2 R2-INFO-1 (codex INFO)：对称清零分支
      // 场景：外部改了 → banner 弹 → 外部又撤销回基线（如 git checkout）→ scope.content === enterEditRef.current
      // 之前漏 else 分支 → externalChanged 永久 true → banner 虚假残留
      setExternalChanged(false);
    }
  }, [mode, scope.content]);

  // PR-G：稳定的 schema-driven CM6 extensions（含 lint + hover + completion）
  // useMemo 稳定引用避免 CMEditor extraCompartment reconfigure 触发 noop transaction（R_2 D3）
  // 仅 JSON 走 schema lint；TOML / dotfile / markdown 不走 codemirror-json-schema
  const schemaExtras = useMemo(
    () => (scope.format === "json" ? buildSchemaExtensions(toolSchema) : []),
    [toolSchema, scope.format],
  );

  const fallbackMode: Mode = toolSchema ? "schema" : scope.format === "markdown" ? "render" : "view";

  return (
    <section className="scope">
      <header className="scope-head" onClick={() => setOpen(!open)}>
        <div className="scope-left">
          <Chev open={open} />
          <span className={`badge ${scope.level}`}>{scope.level}</span>
          <code className="scope-path">{scope.label}</code>
          {!scope.exists && <span className="badge miss">不存在</span>}
          {toolSchema && <span className="badge schema">schema</span>}
        </div>
        <div className="scope-right">
          {scope.exists && (
            <>
              {toolSchema && (
                <button
                  className={`btn-sm${mode === "schema" ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setMode("schema"); }}
                  title="Schema-driven 行内编辑"
                >Schema</button>
              )}
              {scope.format === "markdown" && (
                // PR-H：CLAUDE.md / 类 markdown 文件渲染按钮
                <button
                  className={`btn-sm${mode === "render" ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setMode("render"); }}
                  title="Markdown 渲染（GFM + 代码高亮）"
                >渲染</button>
              )}
              {!toolSchema && scope.format !== "markdown" && (
                <button
                  className={`btn-sm${mode === "view" ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setMode("view"); }}
                  title="只读列表展示"
                >列表</button>
              )}
              <button
                className={`btn-sm${mode === "raw" ? " active" : ""}`}
                onClick={(e) => { e.stopPropagation(); setMode(mode === "raw" ? fallbackMode : "raw"); }}
              >源文件</button>
              <button
                className="btn-sm"
                onClick={(e) => { e.stopPropagation(); setBuf(scope.content); setMode("edit"); }}
              >编辑</button>
            </>
          )}
          <span className="fmt">{scope.format}</span>
        </div>
      </header>
      {open && scope.exists && (
        <div className="scope-body">
          {mode === "edit" ? (
            // PR-G：edit 模式 textarea → CMEditor + 注入 schema lint/hover/completion
            <div className="editor">
              {/* CHANGELOG_10 R_1·H1 fix：外部 reload 推过来 scope.content 变化时 banner 让用户决策 */}
              {externalChanged && (
                <div className="schema-conflict">
                  <div className="schema-conflict-msg">
                    ⚠️ 文件已被外部修改。继续保存会覆盖外部改动。
                  </div>
                  <div className="schema-conflict-actions">
                    <button
                      className="btn-sm"
                      disabled={saving}
                      onClick={() => {
                        setBuf(scope.content);
                        enterEditRef.current = scope.content;
                        setExternalChanged(false);
                      }}
                    >重新加载（放弃我的改动）</button>
                    <button
                      className="btn-sm danger"
                      // CHANGELOG_10 R_2·H1-followup（双方一致 ✅ HIGH）：buf 没动过时禁用「保留我的改动」
                      // 语义错位：用户进 edit 只看不改 → buf === enterEditRef.current；点此按钮等于「我没改但要覆盖外部」
                      disabled={saving || buf === enterEditRef.current}
                      onClick={() => {
                        // 用户主动接受「保存覆盖」语义；重置基线避免反复弹
                        enterEditRef.current = scope.content;
                        setExternalChanged(false);
                      }}
                    >保留我的改动（保存会覆盖）</button>
                    <button
                      className="btn-sm"
                      disabled={saving}
                      onClick={() => setMode(fallbackMode)}
                    >取消编辑</button>
                  </div>
                </div>
              )}
              <CMEditor
                value={buf}
                onChange={setBuf}
                language={languageExtensionFor(scope.format)}
                extraExtensions={schemaExtras}
                readOnly={saving}
                maxHeight={500}
              />
              <div className="editor-bar">
                <button className="btn ghost" onClick={() => setMode(fallbackMode)} disabled={saving}>取消</button>
                {/* PR-4 (#H2)：必须 await 成功才 setMode；失败时 catch（App 已 toast）保留 edit 模式 */}
                <button
                  className="btn primary"
                  // CHANGELOG_10 R_2·H1-followup（双方一致 ✅ HIGH）：banner 是装饰品 → 加 || externalChanged
                  // 让 banner 真正「拦截」save。用户必须先点 banner 三按钮之一才能继续保存
                  // 与 SchemaScopeBody PR-G conflict 「硬 gate」语义对齐
                  disabled={saving || externalChanged}
                  onClick={async () => {
                    setSaving(true);
                    try { await onSave(scope.filePath, buf); setMode(fallbackMode); }
                    catch { /* App.tsx onSave 内已 flash 错误 toast；保留 edit 模式 */ }
                    finally { setSaving(false); }
                  }}
                >{saving ? "保存中…" : "保存"}</button>
              </div>
            </div>
          ) : mode === "raw" ? (
            // PR-F + PR-G：只读 CodeMirror 6 + schema hover（让用户在 raw 模式也能 hover 看 schema 描述）
            <CMEditor
              value={scope.content}
              readOnly
              language={languageExtensionFor(scope.format)}
              extraExtensions={schemaExtras}
            />
          ) : mode === "render" && scope.format === "markdown" ? (
            // PR-H：markdown 文件（CLAUDE.md 等）默认渲染（GFM + 代码块 shiki 高亮 + sanitize）
            <div className="markdown-scope-body">
              <MarkdownView source={scope.content} />
            </div>
          ) : mode === "schema" && toolSchema ? (
            // PR-D：schema-driven 行内编辑（用户感知第一波）
            <SchemaScopeBody
              scope={scope}
              toolSchema={toolSchema}
              onPatchSave={onPatchSave}
              flash={onToast}
            />
          ) : scope.format === "dotfile" || scope.format === "markdown" ? (
            <CMEditor value={scope.content} readOnly language={languageExtensionFor(scope.format)} />
          ) : scope.categories.length === 0 ? (
            <div className="empty">无配置项</div>
          ) : (
            scope.categories.map((cat) => cat.items.map((item, i) => <Item key={`${item.key}-${i}`} item={item} />))
          )}
        </div>
      )}
    </section>
  );
}

export function ConfigPanel({
  tool,
  onSave,
  onPatchSave,
  onToast,
}: {
  tool: ToolConfig;
  onSave: (p: string, c: string) => Promise<void>;
  onPatchSave: (p: string, c: string) => Promise<void>;
  onToast: (msg: string, ok: boolean) => void;
}) {
  // detectScope 需要 home；一次性拿，所有 scope 共享
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    getHomeDir().then(setHome).catch(() => setHome(""));
  }, []);

  return (
    <div className="panel">
      <div className="panel-head">
        <h1>{tool.name}<span className="ver">v{tool.version}</span></h1>
        <p className="panel-desc">{tool.description}</p>
      </div>
      {tool.scopes.map((s) => {
        const scopeKind = home != null ? detectScope(s.filePath, home) : null;
        const toolSchema = scopeKind ? getSchemaForScope(scopeKind) : null;
        return (
          <Scope
            key={s.filePath}
            scope={s}
            toolSchema={toolSchema}
            onSave={onSave}
            onPatchSave={onPatchSave}
            onToast={onToast}
          />
        );
      })}
    </div>
  );
}
