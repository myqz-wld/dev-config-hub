import type { FieldSchema, EnumOption, EnumValue } from "./types.ts";

/**
 * 用于 buildFieldIndex 输出的「类型化」段标识。
 * 真实运行时 path 段是具体 key / 数字下标；这里的 [] / <key> / * 是模板段。
 */
const ARRAY_SEG = "[]";
const KV_SEG = "<key>";
const ANY_PROP_SEG = "*";

/**
 * 把 root schema 平铺为 dotted-path → FieldSchema 索引。
 *
 * 用途：UI 错误定位、search、按 path 反查 schema 描述（CM6 hover）。
 * 段约定：
 *   - object 已知 key      → "parent.key"
 *   - object 未知 key（additionalProperties: FieldSchema） → "parent.*"
 *   - array element        → "parent.[]"
 *   - kv-map element       → "parent.<key>"
 *
 * 根节点不入索引（prefix 为空）。
 *
 * **循环引用守门**（REVIEW_3 R_1·C6）：visit 内部用 visited Set 跟踪节点身份，
 * 已访问的 FieldSchema 跳过递归。当前手写 schema 不构造 cycle，但 PR-J `sync.ts`
 * 之后从上游 fetch 含 `$ref` 自循环的 JSON Schema 时立刻会触发 stack overflow，
 * 这里提前防御。
 */
export function buildFieldIndex(root: FieldSchema, prefix = ""): Map<string, FieldSchema> {
  const index = new Map<string, FieldSchema>();
  visit(root, prefix, index, new Set());
  return index;
}

function visit(
  node: FieldSchema,
  path: string,
  index: Map<string, FieldSchema>,
  visited: Set<FieldSchema>,
): void {
  // 先 set index：循环引用场景下子节点引用回根，子节点的 path 仍要入索引；
  // visited 检查仅阻止 *再次递归子树*，不阻止当前节点入 index
  if (path) index.set(path, node);
  if (visited.has(node)) return;
  visited.add(node);

  if (node.type === "object") {
    if (node.properties) {
      for (const [key, child] of Object.entries(node.properties)) {
        visit(child, joinPath(path, key), index, visited);
      }
    }
    if (typeof node.additionalProperties === "object") {
      visit(node.additionalProperties, joinPath(path, ANY_PROP_SEG), index, visited);
    }
  }

  if (node.type === "array" && node.itemSchema) {
    visit(node.itemSchema, joinPath(path, ARRAY_SEG), index, visited);
  }

  if (node.type === "kv-map" && node.valueSchema) {
    visit(node.valueSchema, joinPath(path, KV_SEG), index, visited);
  }
}

function joinPath(prefix: string, seg: string): string {
  if (!prefix) return seg;
  return `${prefix}.${seg}`;
}

/**
 * 按运行时 path 段定位 schema。
 *
 * path 段是真实运行时键名（string）或数组下标（number），不是 buildFieldIndex 用的模板段。
 * 返回 null 表示该路径在 schema 中未声明（schema 不认识该 key）——
 * 调用方负责 fallback 为 UnknownField（按 typeof 推断控件）。
 */
export function resolveFieldAtPath(
  root: FieldSchema,
  path: readonly (string | number)[],
): FieldSchema | null {
  let cur: FieldSchema | undefined = root;
  for (const seg of path) {
    if (!cur) return null;

    if (cur.type === "object") {
      if (typeof seg !== "string") return null;
      const next = cur.properties?.[seg];
      if (next) {
        cur = next;
        continue;
      }
      // additionalProperties:
      //   FieldSchema → 走它（kv-map 风格的 object）
      //   true / undefined / false → 未知字段，返回 null 由调用方 fallback
      if (typeof cur.additionalProperties === "object") {
        cur = cur.additionalProperties;
        continue;
      }
      return null;
    }

    if (cur.type === "array") {
      if (typeof seg !== "number") return null;
      cur = cur.itemSchema;
      continue;
    }

    if (cur.type === "kv-map") {
      if (typeof seg !== "string") return null;
      cur = cur.valueSchema;
      continue;
    }

    return null;
  }
  return cur ?? null;
}

/**
 * 把 EnumValue[] 升格为统一 EnumOption[]，控件渲染时无需 narrow 分支（REVIEW_3 R_1·C14）。
 * 短形式 `string | number` 自动包成 `{ value: x }`；EnumOption 透传。
 *
 * 例：
 *   normalizeEnum(["low", "high"]) → [{value:"low"}, {value:"high"}]
 *   normalizeEnum([{value:"low", label:"Low"}]) → [{value:"low", label:"Low"}]
 *   normalizeEnum(["low", {value:"high", description:"..."}]) → 混合升格
 */
export function normalizeEnum(values: readonly EnumValue[]): EnumOption[] {
  return values.map((v) =>
    typeof v === "object" && v !== null ? v : { value: v },
  );
}

/**
 * 把 path 段序列化为 dotted string（REVIEW_3 R_1·C15），用于 Diagnostic.path 展示。
 *
 * 数组下标段直接用数字字面量（与 buildFieldIndex 的模板段 `[]` / `<key>` 不同——
 * 那是 schema 索引用的，这里是诊断展示用的）。
 *
 * 例：["hooks", "PreToolUse", 0, "matcher"] → "hooks.PreToolUse.0.matcher"
 */
export function pathToString(path: readonly (string | number)[]): string {
  return path.map(String).join(".");
}
