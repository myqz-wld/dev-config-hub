import React from "react";
import type { FieldProps } from "./types.ts";
import { BooleanField } from "./BooleanField.tsx";
import { NumberField } from "./NumberField.tsx";
import { EnumField } from "./EnumField.tsx";
import { StringField } from "./StringField.tsx";
import { PathField } from "./PathField.tsx";
import { ArrayField } from "./ArrayField.tsx";
import { ObjectField } from "./ObjectField.tsx";
import { KVMapField } from "./KVMapField.tsx";
import { SensitiveField } from "./SensitiveField.tsx";
import { MarkdownField } from "./MarkdownField.tsx";
import { CodeField } from "./CodeField.tsx";
import { UnknownField } from "./UnknownField.tsx";

/**
 * 字段控件调度器：按 schema.type 派发到对应控件。
 *
 * 调用方只用一个 renderField()，schema 决定渲染什么。
 *
 * **优先级**：
 *   1. schema.sensitive=true → SensitiveField（覆盖 type=string 的默认 StringField）
 *   2. schema.type 直接命中 → 对应控件
 *   3. fallback → UnknownField（按 typeof 推断）
 *
 * **类型一致性陷阱**：value 类型与 schema.type 不一致时（caller 传错 / 文件被外部改），
 * 不强行 coerce，让控件 onChange 以 undefined 兜底重置。
 */
export function renderField(props: FieldProps): React.ReactNode {
  const { schema } = props;

  // sensitive 优先（不论 type 是 string / url / sensitive 都走 mask）
  if (schema.sensitive) {
    return <SensitiveField {...(props as FieldProps<string>)} />;
  }

  switch (schema.type) {
    case "boolean":
      return <BooleanField {...(props as FieldProps<boolean>)} />;
    case "number":
    case "integer":
    case "duration":
      return <NumberField {...(props as FieldProps<number>)} />;
    case "enum":
      return <EnumField {...(props as FieldProps<string | number>)} />;
    case "string":
    case "url":
    case "regex":
    case "color":
      return <StringField {...(props as FieldProps<string>)} />;
    case "path":
      return <PathField {...(props as FieldProps<string>)} />;
    case "array":
      return <ArrayField {...(props as FieldProps<unknown[]>)} />;
    case "object":
      return <ObjectField {...(props as FieldProps<Record<string, unknown>>)} />;
    case "kv-map":
      return <KVMapField {...(props as FieldProps<Record<string, unknown>>)} />;
    case "markdown":
      return <MarkdownField {...(props as FieldProps<string>)} />;
    case "code":
      return <CodeField {...(props as FieldProps<string>)} />;
    default: {
      // exhaustive check + fallback to UnknownField
      const _exhaustive: never = schema.type;
      void _exhaustive;
      return <UnknownField {...props} />;
    }
  }
}

export type { FieldProps, ScopeContext } from "./types.ts";
export { FieldRow } from "./FieldRow.tsx";
export { BooleanField } from "./BooleanField.tsx";
export { NumberField } from "./NumberField.tsx";
export { EnumField } from "./EnumField.tsx";
export { StringField } from "./StringField.tsx";
export { PathField } from "./PathField.tsx";
export { ArrayField } from "./ArrayField.tsx";
export { ObjectField } from "./ObjectField.tsx";
export { KVMapField } from "./KVMapField.tsx";
export { SensitiveField } from "./SensitiveField.tsx";
export { MarkdownField } from "./MarkdownField.tsx";
export { CodeField } from "./CodeField.tsx";
export { UnknownField } from "./UnknownField.tsx";
