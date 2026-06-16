import { useState, useEffect, useMemo, useRef } from "react";
import type { ToolConfig, ConfigScope } from "../../types.ts";
import { CMEditor } from "./editor/CMEditor.tsx";
import { languageExtensionFor } from "./editor/languages.ts";
import { MarkdownView } from "./markdown/MarkdownView.tsx";
import { isMtimeMismatch, isMtimeMissing } from "../bridge.ts";

const Chev = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`chev${open ? " open" : ""}`}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Mode = "view" | "edit" | "render";

const SCOPE_LEVEL_LABEL: Record<ConfigScope["level"], string> = {
  global: "全局",
  user: "个人",
  project: "项目",
  local: "本地",
};

const SCOPE_FORMAT_LABEL: Record<ConfigScope["format"], string> = {
  json: "JSON",
  toml: "TOML",
  dotfile: "文本",
  markdown: "Markdown",
};

function defaultModeFor(format: ConfigScope["format"]): Mode {
  return format === "markdown" ? "render" : "view";
}

function Scope({
  scope,
  onSave,
  onToast: _onToast,
}: {
  scope: ConfigScope;
  onSave: (p: string, c: string, expectedMtimeUs?: number | null) => Promise<void>;
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
  // REVIEW_8 H7 / Group E2：进 edit 时 snapshot 当时的 mtime；save 时透传给后端做 CAS。
  // - undefined：旧 reader 路径（loadedMtimeUs 字段没填） → 跳过 CAS（向后兼容）
  // - null：CAS 弃权（用户主动「保留我的改动」点击 → 后续 save 强制覆盖）
  // - number：正常 CAS，后端 stat 比对失败抛 MtimeMismatchError
  const enterEditMtimeRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (mode !== "edit") {
      enterEditRef.current = null;
      enterEditMtimeRef.current = undefined;
      setExternalChanged(false);
      return;
    }
    if (enterEditRef.current === null) {
      enterEditRef.current = scope.content;
      enterEditMtimeRef.current = scope.loadedMtimeUs;
    } else if (scope.content !== enterEditRef.current) {
      setExternalChanged(true);
    } else {
      // CHANGELOG_10 R_2 R2-INFO-1：对称清零分支
      // 外部改了 → banner 弹 → 外部又撤销回基线 → scope.content === enterEditRef.current
      // 漏 else 分支会让 externalChanged 永久 true → banner 虚假残留
      setExternalChanged(false);
      // REVIEW_8 R2 R2-8 / R3 G4：touch-only 修复 — 外部 `touch` 推 mtime 变化但 content 不变时
      // 必须同步最新 mtime 到 enterEditMtimeRef，否则下次 save 透传 stale enterEditMtime
      // → 后端 CAS stat 拿到新 mtime → 抛 MtimeMismatchError → 用户莫名其妙看到 banner
      // (用户认知：「我没看到任何外部内容变化，为什么提示外部修改？」)
      // 修：content 与基线一致时 mtime 基线 follow 最新值（与「重新加载」按钮 line 132 同款语义）
      enterEditMtimeRef.current = scope.loadedMtimeUs;
    }
  }, [mode, scope.content, scope.loadedMtimeUs]);

  const fallbackMode: Mode = defaultModeFor(scope.format);

  // REVIEW_8 H8 / Group E5：caller 必须 useMemo 稳定 language Extension 引用，否则
  // CMEditor extraCompartment / langCompartment 每次 render 收到新引用都 reconfigure
  // 一次（哪怕内容相同），大文件性能差。
  const langExt = useMemo(() => languageExtensionFor(scope.format), [scope.format]);

  const renderMarkdownToggleLabel = mode === "render" ? "源文件" : "预览";
  const renderMarkdownToggleNext: Mode = mode === "render" ? "view" : "render";

  return (
    <section className="scope">
      <header className="scope-head" onClick={() => setOpen(!open)}>
        <div className="scope-left">
          <Chev open={open} />
          <span className={`badge ${scope.level}`}>{SCOPE_LEVEL_LABEL[scope.level]}</span>
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
                  title={mode === "render" ? "查看源文件" : "查看预览"}
                >{renderMarkdownToggleLabel}</button>
              )}
              <button
                className="btn-sm"
                onClick={(e) => { e.stopPropagation(); setBuf(scope.content); setMode("edit"); }}
              >编辑</button>
            </>
          )}
          <span className="fmt">{SCOPE_FORMAT_LABEL[scope.format]}</span>
        </div>
      </header>
      {open && scope.exists && (
        <div className="scope-body">
          {mode === "edit" ? (
            <div className="editor">
              {externalChanged && (
                <div className="schema-conflict">
                  <div className="schema-conflict-msg">
                    ⚠️ 这份文件刚刚被其他程序修改。继续保存会覆盖对方的改动。
                  </div>
                  <div className="schema-conflict-actions">
                    <button
                      className="btn-sm"
                      disabled={saving}
                      onClick={() => {
                        setBuf(scope.content);
                        enterEditRef.current = scope.content;
                        // REVIEW_8 H7 / Group E2：拿父级 reload 推下来的最新 mtime 当基线，
                        // 让下次 save 用新 mtime 做 CAS（一致 → 通过；外部又改一次 → 再撞 mismatch）
                        enterEditMtimeRef.current = scope.loadedMtimeUs;
                        setExternalChanged(false);
                      }}
                    >使用磁盘版本（放弃我的改动）</button>
                    <button
                      className="btn-sm danger"
                      // CHANGELOG_10 R_2·H1-followup（双方一致 ✅ HIGH）：buf 没动过时禁用「保留我的改动」
                      // 语义错位：用户进 edit 只看不改 → buf === enterEditRef.current；点此按钮等于「我没改但要覆盖外部」
                      disabled={saving || buf === enterEditRef.current}
                      onClick={() => {
                        // 用户主动接受「保存覆盖」语义；重置基线避免反复弹
                        enterEditRef.current = scope.content;
                        // REVIEW_8 H7 / Group E2：用户主动放弃 CAS（强制覆盖语义） →
                        // 后续 save 传 null 跳过后端 mtime 校验
                        enterEditMtimeRef.current = null;
                        setExternalChanged(false);
                      }}
                    >保留我的改动（保存时覆盖）</button>
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
                language={langExt}
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
                    try {
                      // REVIEW_8 H7 / Group E2：透传 enter-edit 时 snapshot 的 mtime 给后端 CAS。
                      // undefined（旧 reader 没填 loadedMtimeUs） → App.onSave 走旧 saveFile，跳过 CAS。
                      // null（用户「保留我的改动」点击后） → 走 saveFileIfMtime 但传 null 跳 CAS。
                      // number → 走 saveFileIfMtime 真做 CAS。
                      await onSave(scope.filePath, buf, enterEditMtimeRef.current);
                      setMode(fallbackMode);
                    } catch (e) {
                      // App.tsx onSave 内已 flash 错误 toast；保留 edit 模式
                      // REVIEW_8 H7 / Group E2：mtime CAS 失败 → 弹 banner 走「重新加载/保留改动/取消」三按钮
                      // 路径，与父级 reload 推 scope.content 变化触发的 banner 同款 UX
                      // （走 isMtimeMismatch / isMtimeMissing helper 而非 instanceof：
                      //  bun mock.module 替换 module exports 后 class identity 跨 module 不一致，
                      //  instanceof 在测试 mock 场景会 false-negative；改用 e.name 字符串判断兜底）
                      if (isMtimeMismatch(e) || isMtimeMissing(e)) {
                        setExternalChanged(true);
                      }
                    }
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
              language={langExt}
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
  onSave: (p: string, c: string, expectedMtimeUs?: number | null) => Promise<void>;
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
