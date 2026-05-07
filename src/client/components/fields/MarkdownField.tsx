import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { CMEditor } from "../editor/CMEditor.tsx";
import { languageByName } from "../editor/languages.ts";
import { MarkdownView } from "../markdown/MarkdownView.tsx";

/**
 * Markdown 字段（PR-H 完整化）：默认渲染视图 + 「编辑」按钮切 CM6 markdown 编辑模式。
 *
 * 用于 schema 标注 `type: "markdown"` 的大段富文本字段（如 systemPrompt / instructions / 段落式 description）。
 *
 * **渲染栈**：MarkdownView（react-markdown + GFM + sanitize + shiki lazy 高亮）。
 */
export function MarkdownField({ schema, value, onChange, path, errors, disabled, embedded, menu }: FieldProps<string>) {
  const [mode, setMode] = useState<"render" | "edit">(value ? "render" : "edit");

  const switchEdit = () => setMode("edit");
  const switchRender = () => setMode("render");

  const inner = (
    <div className="field-markdown">
      <div className="field-markdown-toolbar">
        <button
          type="button"
          className={`btn-sm${mode === "render" ? " active" : ""}`}
          onClick={switchRender}
          disabled={disabled}
        >渲染</button>
        <button
          type="button"
          className={`btn-sm${mode === "edit" ? " active" : ""}`}
          onClick={switchEdit}
          disabled={disabled}
        >编辑</button>
      </div>
      {mode === "render" ? (
        value ? <MarkdownView source={value} /> : <span className="field-empty">空（点编辑添加 markdown）</span>
      ) : (
        <CMEditor
          value={value ?? ""}
          language={languageByName("markdown")}
          readOnly={disabled}
          maxHeight={400}
          onChange={(next) => onChange(next === "" ? undefined : next)}
        />
      )}
    </div>
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
    </FieldRow>
  );
}
