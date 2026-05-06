import type { JsonPatch } from "./json-patcher.ts";

/**
 * 简单 object diff → JsonPatch[]，给 ConfigPanel schema mode 字段级写回用。
 *
 * 设计取舍：
 *   - object：递归 diff，按 key 增/删/改生成 patches
 *   - 数组：**整数组替换**（不做精确 element diff）。理由：jsonc-parser modify 对数组元素位置变化的处理复杂，
 *     用户场景多是「整个数组的 ArrayField 内部已经组装好新 value」整体写回更可靠
 *   - 标量：path + value 即可
 *   - 删除 key：value 设 undefined（patchJson 内部 jsonc-parser modify 会删整行）
 *
 * **数据完整性保证**：仅生成「变化的 path」patches；oldObj 已有但 newObj 没的 key
 * 才删除（即用户主动删除字段）；newObj 没传的 key 不被动删除——
 * 这与 schema-driven UI 的「未知 key 永远保留」契合（UnknownField 也走 root onChange，
 * caller 不动 = 不删）。
 *
 * 注意：caller 必须保证 newObj 是「完整快照」而不是部分 patch。
 */
export function diffPatches(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  basePath: ReadonlyArray<string | number> = [],
): JsonPatch[] {
  const patches: JsonPatch[] = [];

  // 1. 删除：oldObj 有 newObj 没的 key
  for (const k of Object.keys(oldObj)) {
    if (!(k in newObj)) {
      patches.push({ path: [...basePath, k], value: undefined });
    }
  }

  // 2. 增 / 改
  for (const [k, v] of Object.entries(newObj)) {
    const old = oldObj[k];
    if (old === v) continue;  // 引用相等跳过（caller 用同一引用 = 没改）

    if (isPlainObject(v) && isPlainObject(old)) {
      // 都是 plain object → 递归 diff
      const sub = diffPatches(old, v, [...basePath, k]);
      patches.push(...sub);
    } else {
      // 标量 / 数组 / 类型变化 / new key → 整体替换
      patches.push({ path: [...basePath, k], value: v });
    }
  }

  return patches;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
