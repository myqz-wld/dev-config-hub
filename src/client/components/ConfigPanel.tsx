import React, { useState, useEffect, useRef } from "react";
import type { ToolConfig, ConfigScope } from "../../types.ts";
import { CMEditor } from "./editor/CMEditor.tsx";
import { languageExtensionFor } from "./editor/languages.ts";
import { MarkdownView } from "./markdown/MarkdownView.tsx";

const Chev = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`chev${open ? " open" : ""}`}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Mode = "view" | "edit" | "render";

function defaultModeFor(format: ConfigScope["format"]): Mode {
  return format === "markdown" ? "render" : "view";
}

function Scope({
  scope,
  onSave,
  onToast: _onToast,
}: {
  scope: ConfigScope;
  onSave: (p: string, c: string) => Promise<void>;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>(defaultModeFor(scope.format));
  const [buf, setBuf] = useState("");
  const [saving, setSaving] = useState(false);

  // CHANGELOG_10 review fix R_1·H1（双方一致 ✅ HIGH）：edit 模式 + focus reload 联动 silent overwrite
  //
  // 问题：edit 活跃期 scope.content 会被外部 reload 推变；buf 只在点「编辑」按钮 setBuf(scope.content) 一次性
  // snapshot，再无回流。用户保存触发 onSave(buf) → fs::write(buf) 无 mtime check → 静默覆盖外部修改。
  //
  // 修法：进 edit 模式时记录 enterEditContent 基线；scope.content 后续变化（必然来自外部 reload）→ 设
  // externalChanged=true → banner 让用户决策 [重新加载 / 保留改动 / 取消编辑]。
  const [externalChanged, setExternalChanged] = useState(false);
  const enterEditRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== "edit") {
      enterEditRef.current = null;
      setExternalChanged(false);
      return;
    }
    if (enterEditRef.current === null) {
      enterEditRef.current = scope.content;
    } else if (scope.content !== enterEditRef.current) {
      setExternalChanged(true);
    } else {
      // CHANGELOG_10 R_2 R2-INFO-1：对称清零分支
      // 外部改了 → banner 弹 → 外部又撤销回基线 → scope.content === enterEditRef.current
      // 漏 else 分支会让 externalChanged 永久 true → banner 虚假残留
      setExternalChanged(false);
    }
  }, [mode, scope.content]);

  const fallbackMode: Mode = defaultModeFor(scope.format);

  const renderMarkdownToggleLabel = mode === "render" ? "源文件" : "渲染";
  const renderMarkdownToggleNext: Mode = mode === "render" ? "view" : "render";

  return (
    <section className="scope">
      <header className="scope-head" onClick={() => setOpen(!open)}>
        <div className="scope-left">
          <Chev open={open} />
          <span className={`badge ${scope.level}`}>{scope.level}</span>
          <code className="scope-path">{scope.label}</code>
          {!scope.exists && <span className="badge miss">不存在</span>}
        </div>
        <div className="scope-right">
          {scope.exists && mode !== "edit" && (
            <>
              {scope.format === "markdown" && (
                <button
                  className="btn-sm"
                  onClick={(e) => { e.stopPropagation(); setMode(renderMarkdownToggleNext); }}
                  title={mode === "render" ? "查看源文件" : "渲染 markdown"}
                >{renderMarkdownToggleLabel}</button>
              )}
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
            <div className="editor">
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
                readOnly={saving}
                maxHeight={500}
              />
              <div className="editor-bar">
                <button className="btn ghost" onClick={() => setMode(fallbackMode)} disabled={saving}>取消</button>
                <button
                  className="btn primary"
                  // CHANGELOG_10 R_2·H1-followup：banner 期间硬拦截 save，必须先点 banner 三按钮之一才能继续
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
          ) : mode === "render" && scope.format === "markdown" ? (
            <div className="markdown-scope-body">
              <MarkdownView source={scope.content} />
            </div>
          ) : (
            // view 模式：CMEditor 只读 + 语法高亮
            <CMEditor
              value={scope.content}
              readOnly
              language={languageExtensionFor(scope.format)}
              maxHeight={500}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function ConfigPanel({
  tool,
  onSave,
  onToast,
}: {
  tool: ToolConfig;
  onSave: (p: string, c: string) => Promise<void>;
  onToast: (msg: string, ok: boolean) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h1>{tool.name}<span className="ver">v{tool.version}</span></h1>
        <p className="panel-desc">{tool.description}</p>
      </div>
      {tool.scopes.map((s) => (
        <Scope
          key={s.filePath}
          scope={s}
          onSave={onSave}
          onToast={onToast}
        />
      ))}
    </div>
  );
}
