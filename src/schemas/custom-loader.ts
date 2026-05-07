import type { ScopeKind, ToolSchema, FieldSchema } from "./types.ts";
import { readDir } from "../client/bridge.ts";
import { invoke } from "@tauri-apps/api/core";

/**
 * 自定义 schema 加载器（PR-CSv1）。
 *
 * 用户在 `~/.dch/schemas/<scopeKind>.json` 放字段级 override JSON；本模块加载、校验、
 * 与内置 schema 合并。设计场景：当 dch 内置 schema 误判 / 落后于上游 / 用户想本地
 * 加私有字段时，能本地覆盖，不用等主线 release（reviews/REVIEW_5.md 的 enabledPlugins
 * 误判教训驱动）。
 *
 * **scopeKind 限定**：文件名 stem 必须是已知 ScopeKind（claude-settings / claude-mcp /
 * codex-config / opencode-config / dch-store），其他文件跳过 + warn。
 *
 * **错误隔离**：单文件 parse / validate 失败 → console.warn + 跳过，不影响其他文件 /
 * 不阻塞 app 启动。
 *
 * **CLI 不依赖本模块**：CLI readers 不读 schema，custom schema 是 UI-only feature。
 */

const KNOWN_SCOPES: ReadonlySet<ScopeKind> = new Set<ScopeKind>([
  "claude-settings",
  "claude-settings-local",
  "claude-mcp",
  "claude-md",
  "codex-config",
  "opencode-config",
  "shell-rc",
  "dch-store",
]);

/**
 * 从 `~/.dch/schemas/*.json` 加载所有自定义 schema override。
 *
 * 返回 `Map<ScopeKind, Partial<ToolSchema>>`：文件 → 解析后的 partial schema。
 * 目录不存在返空 map（不报错）。
 */
export async function loadCustomSchemas(home: string): Promise<Map<ScopeKind, Partial<ToolSchema>>> {
  const dir = `${home}/.dch/schemas`;
  const out = new Map<ScopeKind, Partial<ToolSchema>>();

  let entries: { name: string; isFile: boolean }[];
  try {
    entries = await readDir(dir);
  } catch (e) {
    console.warn(`[custom-schema] readDir(${dir}) 失败:`, e);
    return out;
  }

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".json")) continue;

    const stem = entry.name.slice(0, -".json".length);
    if (!KNOWN_SCOPES.has(stem as ScopeKind)) {
      console.warn(`[custom-schema] 跳过 ${entry.name}：文件名 stem 不是已知 ScopeKind（已知：${[...KNOWN_SCOPES].join(", ")}）`);
      continue;
    }

    let content: string;
    try {
      content = await invoke<string>("read_file", { path: `${dir}/${entry.name}` });
    } catch (e) {
      console.warn(`[custom-schema] 读 ${entry.name} 失败:`, e);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn(`[custom-schema] ${entry.name} JSON 解析失败:`, e);
      continue;
    }

    const violation = validatePartialToolSchema(parsed);
    if (violation) {
      console.warn(`[custom-schema] ${entry.name} 形状不合法：${violation}`);
      continue;
    }

    out.set(stem as ScopeKind, parsed as Partial<ToolSchema>);
  }

  return out;
}

/**
 * 字段级合并内置 + 自定义 schema。
 *
 * 合并语义（plan A3 已确认）：
 *   - 顶层 `description` / `$source` / `fetchedAt`：override 优先（如果有）
 *   - `rootSchema.properties`：dict-level shallow merge —— 同 key 的 FieldSchema 整体替换
 *     （**不递归深合并**，避免 enum / valueSchema 等嵌套 merge 复杂度爆炸）；
 *     新 key 添加；missing key 保留 builtin
 *   - `rootSchema.propertyOrder`：override 优先；不在 override 列表的 builtin keys 追加在末尾
 *   - 顶层 `additionalProperties` 永远 true（数据完整性铁律 — 用户实际 JSON 里有什么都不丢）
 *
 * 不修改 builtin 入参对象（产出新对象，避免 ajv WeakMap cache 拿 stale validator）。
 */
export function mergeSchemas(builtin: ToolSchema, override: Partial<ToolSchema>): ToolSchema {
  const overrideRoot = override.rootSchema as FieldSchema | undefined;
  const overrideProps = (overrideRoot?.properties ?? {}) as Record<string, FieldSchema>;
  const builtinProps = (builtin.rootSchema.properties ?? {}) as Record<string, FieldSchema>;

  // shallow merge：override 同 key 整体替换
  const mergedProps: Record<string, FieldSchema> = { ...builtinProps, ...overrideProps };

  // propertyOrder：override 优先，剩余 builtin 追加（去重）
  const overrideOrder = overrideRoot?.propertyOrder ?? [];
  const builtinOrder = builtin.rootSchema.propertyOrder ?? [];
  const seen = new Set<string>();
  const mergedOrder: string[] = [];
  for (const k of overrideOrder) {
    if (!seen.has(k)) { mergedOrder.push(k); seen.add(k); }
  }
  for (const k of builtinOrder) {
    if (!seen.has(k)) { mergedOrder.push(k); seen.add(k); }
  }
  // 新 override-only key 也补进 order（避免漏渲）
  for (const k of Object.keys(mergedProps)) {
    if (!seen.has(k)) { mergedOrder.push(k); seen.add(k); }
  }

  return {
    $id: builtin.$id,                           // 不允许 override（runtime 唯一标识）
    $source: override.$source ?? builtin.$source,
    fetchedAt: override.fetchedAt ?? builtin.fetchedAt,
    scopeKind: builtin.scopeKind,               // 不允许 override（与文件名绑定）
    rootSchema: {
      ...builtin.rootSchema,
      ...(overrideRoot ?? {}),                  // 顶层 description / additionalProperties 等
      properties: mergedProps,
      propertyOrder: mergedOrder.length ? mergedOrder : undefined,
      additionalProperties: true,               // 强制 true，保数据完整性
    },
  };
}

/**
 * 校验自定义 schema partial 形状（最小校验，只校 critical invariants）。
 *
 * 不做完整 ajv ToolSchema meta-schema 校验（太重，且 ToolSchema 类型本身没 JSON Schema），
 * 只校以下关键不变量：
 *   - 必须是 plain object
 *   - 如果有 rootSchema，必须是 object 且 rootSchema.properties（如有）也是 plain object
 *   - 不能尝试改 $id / scopeKind（保留这两个字段会被合并时忽略，但提示用户）
 *
 * 返 null 表示通过；返 string 是错误描述。
 */
function validatePartialToolSchema(v: unknown): string | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return `根必须是 object，实际是 ${v === null ? "null" : Array.isArray(v) ? "array" : typeof v}`;
  }
  const obj = v as Record<string, unknown>;

  if ("rootSchema" in obj) {
    const rs = obj.rootSchema;
    if (rs === null || typeof rs !== "object" || Array.isArray(rs)) {
      return `rootSchema 必须是 object`;
    }
    const rsObj = rs as Record<string, unknown>;
    if ("properties" in rsObj) {
      const p = rsObj.properties;
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        return `rootSchema.properties 必须是 object`;
      }
    }
    if ("propertyOrder" in rsObj) {
      const po = rsObj.propertyOrder;
      if (!Array.isArray(po) || po.some((x) => typeof x !== "string")) {
        return `rootSchema.propertyOrder 必须是 string[]`;
      }
    }
  }

  if ("$id" in obj || "scopeKind" in obj) {
    // 不阻塞，只 warn — 这两字段会被合并时忽略
    console.warn(`[custom-schema] $id / scopeKind 字段会被忽略（运行时由内置 schema 决定）`);
  }

  return null;
}
