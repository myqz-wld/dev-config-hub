import React from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { CMEditor } from "../editor/CMEditor.tsx";
import { languageByName } from "../editor/languages.ts";

/**
 * 代码字段：CMEditor 按 schema.codeLanguage 渲染（shell / json / toml / yaml / ts / regex / markdown）。
 *
 * 用于 hook script / regex / 多行配置片段等场景。
 *
 * - min-height 通过 maxHeight=400 间接限制（CM6 自身按内容自适配最小高）
 * - PR-G 之后接 JSON Schema lint（codeLanguage="json" 时通过 extraExtensions 注入）
 */
export function CodeField({ schema, value, onChange, path, errors, disabled, embedded, menu }: FieldProps<string>) {
  const lang = languageByName(schema.codeLanguage ?? "shell");
  const inner = (
    <div className="field-code">
      <CMEditor
        value={value ?? ""}
        language={lang}
        readOnly={disabled}
        maxHeight={400}
        onChange={(next) => onChange(next === "" ? undefined : next)}
      />
    </div>
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
    </FieldRow>
  );
}
