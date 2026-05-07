import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { renderField } from "./index.tsx";
import { resolveFieldAtPath } from "../../../schemas/helpers.ts";
import type { FieldSchema } from "../../../schemas/types.ts";

import { UnknownField } from "./UnknownField.tsx";
import { useScopedUiPrefs } from "./ui-prefs-context.tsx";
import { FieldMenu } from "./FieldMenu.tsx";

/**
 * Object 控件：嵌套对象的字段渲染器。
 *
 * - depth ≤ 2：默认展开
 * - depth > 2：默认折叠 + breadcrumb 路径头
 * - 按 schema.propertyOrder 顺序（缺省按 properties 定义顺序）
 * - 未知 key（不在 properties / additionalProperties 不是 schema）→ 走 UnknownField（renderField 调度）
 * - 写回 schema 不认识的 key 时也保留（PR-D patchJson 透明处理）
 *
 * **PR-CSv1 root level 隐藏过滤**：path === "" 时（root 级别）按 ScopedUiPrefs 过滤
 * 隐藏字段（手动 + advanced），并给每个 root 子字段挂 `<FieldMenu>` 让用户能隐藏。
 * 嵌套 ObjectField（path 非空）不过滤、不挂 menu，避免嵌套字段也被隐藏（plan 限定 root only）。
 */
export function ObjectField({ schema, value, onChange, path, errors, depth = 0, disabled, embedded, menu }: FieldProps<Record<string, unknown>>) {
  const obj = value ?? {};
  const [collapsed, setCollapsed] = useState(depth > 2);
  const ui = useScopedUiPrefs();
  const isRoot = path === "" && ui != null;

  const properties = schema.properties ?? {};
  const orderKeys = schema.propertyOrder ?? Object.keys(properties);
  const declaredKeys = new Set(orderKeys);
  // 拼接：先按 propertyOrder 列声明字段，再列未在声明里的 unknown key
  const allKeys = [
    ...orderKeys.filter((k) => k in properties),
    ...Object.keys(obj).filter((k) => !declaredKeys.has(k)),
  ];
  // root 级别 + 用户没切「显示隐藏」 → 过滤 hidden / advanced；嵌套不过滤
  const visibleKeys = isRoot
    ? allKeys.filter((k) => !ui.isHidden(k, properties[k]))
    : allKeys;

  const inner = (
    <div className={`field-object${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="field-object-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? "▶" : "▼"} {visibleKeys.length} 字段{depth > 2 ? `（depth ${depth}）` : ""}
      </button>
      {!collapsed && (
        <div className="field-object-body">
          {visibleKeys.map((key) => {
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
            // root 级别每个子字段挂 ⋯ 菜单（让用户能隐藏）。嵌套字段不挂。
            const childMenu = isRoot ? <FieldMenu fieldKey={key} /> : undefined;
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
                  menu={childMenu}
                />
              );
            }
            return (
              <React.Fragment key={key}>
                {renderField({ schema: childSchema, value: childValue, onChange: onChildChange, path: childPath, depth: depth + 1, disabled, menu: childMenu })}
              </React.Fragment>
            );
          })}
        </div>
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

function UnknownKeyWrapper({
  keyName,
  value,
  path,
  depth,
  disabled,
  onChange,
  menu,
}: {
  keyName: string;
  value: unknown;
  path: string;
  depth: number;
  disabled?: boolean;
  onChange: (next: unknown) => void;
  menu?: React.ReactNode;
}) {
  // 之前写死 `renderField({ schema: {type:"string"}, ... })`，让 unknown key 强行走 StringField；
  // value 是 array/object 时被 `String(value)` 转成 `"[object Object]"`（reviews/REVIEW_5.md follow-up #3）。
  // 改成直接走 UnknownField：内部按 typeof 分流（boolean→toggle / number-string→input / object→只读 JSON pre）
  // 至少展示原始数据结构，让用户知道这里有什么 + 走 raw 模式编辑。
  const fauxSchema: FieldSchema = {
    type: "string",
    description: `未在 schema 内（key: \`${keyName}\`）`,
  };
  return (
    <UnknownField
      schema={fauxSchema}
      value={value}
      onChange={onChange}
      path={path}
      depth={depth}
      disabled={disabled}
      menu={menu}
    />
  );
}
