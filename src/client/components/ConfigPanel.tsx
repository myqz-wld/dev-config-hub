import React, { useState } from "react";
import type { ToolConfig, ConfigScope, ConfigEntry } from "../../types.ts";

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

function Scope({ scope, onSave }: { scope: ConfigScope; onSave: (p: string, c: string) => Promise<void> }) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<"view" | "raw" | "edit">("view");
  const [buf, setBuf] = useState("");
  const [saving, setSaving] = useState(false);

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
          {scope.exists && (
            <>
              <button className={`btn-sm${mode === "raw" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); setMode(mode === "raw" ? "view" : "raw"); }}>源文件</button>
              <button className="btn-sm" onClick={(e) => { e.stopPropagation(); setBuf(scope.content); setMode("edit"); }}>编辑</button>
            </>
          )}
          <span className="fmt">{scope.format}</span>
        </div>
      </header>
      {open && scope.exists && (
        <div className="scope-body">
          {mode === "edit" ? (
            <div className="editor">
              <textarea value={buf} onChange={(e) => setBuf(e.target.value)} spellCheck={false} disabled={saving} />
              <div className="editor-bar">
                <button className="btn ghost" onClick={() => setMode("view")} disabled={saving}>取消</button>
                {/* PR-4 (#H2)：必须 await 成功才 setMode；失败时 catch（App 已 toast）保留 edit 模式，
                    让用户看到错误后能继续改 textarea 或重试，编辑内容（buf）不丢失 */}
                <button
                  className="btn primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try { await onSave(scope.filePath, buf); setMode("view"); }
                    catch { /* App.tsx onSave 内已 flash 错误 toast；保留 edit 模式 */ }
                    finally { setSaving(false); }
                  }}
                >{saving ? "保存中…" : "保存"}</button>
              </div>
            </div>
          ) : mode === "raw" ? (
            <pre className="raw">{scope.content}</pre>
          ) : scope.format === "dotfile" || scope.format === "markdown" ? (
            <pre className="raw">{scope.content}</pre>
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

export function ConfigPanel({ tool, onSave }: { tool: ToolConfig; onSave: (p: string, c: string) => Promise<void> }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h1>{tool.name}<span className="ver">v{tool.version}</span></h1>
        <p className="panel-desc">{tool.description}</p>
      </div>
      {tool.scopes.map((s) => <Scope key={s.filePath} scope={s} onSave={onSave} />)}
    </div>
  );
}
