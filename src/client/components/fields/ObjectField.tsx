import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { renderField } from "./index.tsx";
import { resolveFieldAtPath } from "../../../schemas/helpers.ts";
import type { FieldSchema } from "../../../schemas/types.ts";

/**
 * Object 控件：嵌套对象的字段渲染器。
 *
 * - depth ≤ 2：默认展开
 * - depth > 2：默认折叠 + breadcrumb 路径头
 * - 按 schema.propertyOrder 顺序（缺省按 properties 定义顺序）
 * - 未知 key（不在 properties / additionalProperties 不是 schema）→ 走 UnknownField（renderField 调度）
 * - 写回 schema 不认识的 key 时也保留（PR-D patchJson 透明处理）
 */
export function ObjectField({ schema, value, onChange, path, errors, depth = 0, disabled }: FieldProps<Record<string, unknown>>) {
  const obj = value ?? {};
  const [collapsed, setCollapsed] = useState(depth > 2);

  const properties = schema.properties ?? {};
  const orderKeys = schema.propertyOrder ?? Object.keys(properties);
  const declaredKeys = new Set(orderKeys);
  // 拼接：先按 propertyOrder 列声明字段，再列未在声明里的 unknown key
  const allKeys = [
    ...orderKeys.filter((k) => k in properties),
    ...Object.keys(obj).filter((k) => !declaredKeys.has(k)),
  ];

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className={`field-object${collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="field-object-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "▶" : "▼"} {allKeys.length} 字段{depth > 2 ? `（depth ${depth}）` : ""}
        </button>
        {!collapsed && (
          <div className="field-object-body">
            {allKeys.map((key) => {
              const childSchema = resolveFieldAtPath(schema, [key]);
              const childPath = path ? `${path}.${key}` : key;
              const childValue = obj[key];
              const onChildChange = (next: unknown) => {
                const copy = { ...obj };
                if (next === undefined) {
                  delete copy[key];
                  onChange(Object.keys(copy).length > 0 ? copy : undefined);
                } else {
                  copy[key] = next;
                  onChange(copy);
                }
              };
              if (!childSchema) {
                // 未知 key：renderField 收 schema=null 时走 UnknownField
                return (
                  <UnknownKeyWrapper
                    key={key}
                    keyName={key}
                    value={childValue}
                    path={childPath}
                    depth={depth + 1}
                    disabled={disabled}
                    onChange={onChildChange}
                  />
                );
              }
              return (
                <React.Fragment key={key}>
                  {renderField({ schema: childSchema, value: childValue, onChange: onChildChange, path: childPath, depth: depth + 1, disabled })}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </FieldRow>
  );
}

function UnknownKeyWrapper({
  keyName,
  value,
  path,
  depth,
  disabled,
  onChange,
}: {
  keyName: string;
  value: unknown;
  path: string;
  depth: number;
  disabled?: boolean;
  onChange: (next: unknown) => void;
}) {
  // 用伪 schema 让 UnknownField 走 typeof 推断渲染
  const fauxSchema: FieldSchema = { type: "string", description: `未在 schema 内（key: \`${keyName}\`）` };
  void fauxSchema;
  return renderField({
    schema: { type: "string" },  // placeholder；renderField 会按 value typeof 走 UnknownField
    value,
    onChange,
    path,
    depth,
    disabled,
    // 这里靠 renderField 内部检测 schema.type === "string" + value 类型不匹配 → fallback unknown
  });
}
