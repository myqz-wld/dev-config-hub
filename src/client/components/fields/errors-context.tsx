import React, { createContext, useContext, useMemo } from "react";
import type { Diagnostic } from "../../../schemas/types.ts";

/**
 * 字段控件 errors 透传 Context（PR-J follow-up #3）。
 *
 * **设计**：
 *   - SchemaScopeBody 跑 ajv `validate()` 拿到全量 `Diagnostic[]`，按 dotted path 分组
 *     成 Map 传入 Provider
 *   - 字段控件（FieldRow）调 `useFieldErrors(path)` 拿当前 path 的 errors
 *   - 这避免 ObjectField / ArrayField / KVMapField 等 container 透传 errors prop 的 drilling
 *
 * **path 匹配规则**：精确匹配 dotted path
 *   - ajv instancePath `/permissions/allow/0` → Diagnostic.path `permissions.allow.0`
 *   - 字段控件接收的 path 也是 dotted（renderField 调用方按嵌套层逐级拼出）
 *   - 顶层错误（ajv instancePath ""）→ Diagnostic.path "" → FieldRow root path "" 直接命中
 *     （REVIEW_4 M6 修复后从 "<root>" 改为 ""）
 *
 * **性能取舍**（REVIEW_4 L1）：每次 diagnostics array 引用变 → 重建 Map → Context value 变 →
 * 所有 useFieldErrors 消费者 re-render。25 字段场景，每次改一字段触发 ~24 次额外 re-render。
 * 实测在 React 19 concurrent mode 下 sub-frame 完成（< 16ms 单帧）；接受。
 * 大 schema (200+ 字段) 再优化（如：路径前缀分段 / pubsub 模式）。
 */

const ErrorsContext = createContext<ReadonlyMap<string, readonly Diagnostic[]> | null>(null);

export function FieldErrorsProvider({
  diagnostics,
  children,
}: {
  diagnostics: readonly Diagnostic[];
  children: React.ReactNode;
}) {
  const byPath = useMemo(() => {
    const m = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) {
      const arr = m.get(d.path);
      if (arr) arr.push(d);
      else m.set(d.path, [d]);
    }
    return m;
  }, [diagnostics]);

  return <ErrorsContext.Provider value={byPath}>{children}</ErrorsContext.Provider>;
}

/**
 * 拿当前字段 path 上的 Diagnostic[]（不含子字段；ObjectField 子字段在自己的 FieldRow 里取）。
 *
 * 不在 Provider 内调返 undefined（让 FieldRow 优先用显式 props.errors，向后兼容）。
 */
export function useFieldErrors(path: string): readonly Diagnostic[] | undefined {
  const map = useContext(ErrorsContext);
  if (!map) return undefined;
  return map.get(path);
}
