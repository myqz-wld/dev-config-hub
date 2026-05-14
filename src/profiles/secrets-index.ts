/**
 * 备份 placeholder 全局去重 + 还原阶段精准 fan-out。CHANGELOG_18 新模块,REVIEW_9 G6 拆模块。
 *
 * 设计动机：当前一次备份产出 ~148 处占位符（148 个 `manifest.placeholders[]` 条目），
 * 但跨 profile 镜像 + 同一 token 多文件复用导致**重复率极高**——实测对应 10–20 个唯一真值。
 * 本模块按 (fieldName, sha256(value).slice(0,16)) 全局合并，给每组分配 logical key
 * `<FIELD_NAME>-<idx>`，让 restore 阶段用户从「填 148 次」降到「填 ~15 次」。
 *
 * **REVIEW_9 G6 拆分**(本文件 500 LOC 护栏):
 * - **本文件**(~230 LOC): types (SecretLocation / SecretLogicalEntry / SecretsIndex) +
 *   `buildSecretsIndex` 备份阶段 placeholder 合并算法
 * - **field-path.ts**(~290 LOC): `parseFieldPath` / `setByFieldPath` / `applyFilledSecrets`
 *   + 还原阶段 fillSingleFile 写盘 + 寻址类型(PathSegment / ParsedFieldPath / ApplyFilledSecretsResult)
 *
 * caller 仍 `import {parseFieldPath / setByFieldPath / applyFilledSecrets} from "./secrets-index.ts"`
 * 不变 — 本文件底部 `export * from "./field-path.ts"` 把所有 publics 透传出去。
 *
 * 关键不变量：
 * - `total_occurrences === sum(entries[i].count) === placeholders.length`（buildSecretsIndex 后置断言）
 * - manifest.secrets_index 内**绝不**包含 valueHash / 任何真值（hash 仅 backup 内存阶段做 group key，
 *   分配 logical key 后立即丢弃，不入 dchpack）
 * - 排序 deterministic：entries[] 按 fieldName 字典序 → idx 升序；每个 locations[] 按 packPath 字典序
 *
 * 已知边界（Step 4 caller 需处理）：
 * - **整文件场景**（packPath 末尾 auth.json / credentials.json）：redactWholeFile 把整体压成
 *   `{"placeholder": "<<DCH_PLACEHOLDER:AUTH>>"}`，fill 后文件结构是 `{"placeholder": "<填入字符串>"}`
 *   仍非真正的 OAuth payload。caller 应在 UI / CLI 提示用户「整文件凭据请用工具自身重新登录获取」，
 *   而不是期待 fill 重建出有效 OAuth。本模块不阻止 set，只是结果无意义
 * - **env 段**（packPath 末尾 _meta.json）：fieldPath `$.env.K` 是面向 _meta.json 子树的，但 restore
 *   阶段 hostPath 被重写为 `~/.dch/profiles.json`（store 全局结构 `{ profiles: [...], active: {...} }`），
 *   `$.env.K` 与 profiles.json 顶层结构不对齐 → setByFieldPath 会 return false 计入 errors[]。caller
 *   应预先 filter 掉 _meta.json 来源的 location（resolveHostPath 返回 undefined）让它们保留为占位符，
 *   用户后续手改 profiles.json
 */

import type { PlaceholderEntry } from "./backup.ts";

// ─── manifest 写入用类型 ──────────────────────────────────────

export interface SecretLocation {
  /** 对应 PlaceholderEntry.packPath（dchpack 内相对路径） */
  packPath: string;
  /** 对应 PlaceholderEntry.fieldPath（JSON `$.a.b` / TOML `a.b`） */
  fieldPath: string;
}

export interface SecretLogicalEntry {
  /** logical key 名，如 `ANTHROPIC_AUTH_TOKEN-1`；按 primary fieldName 分组内 idx 从 1 起 */
  name: string;
  /**
   * primary fieldName —— 该 group 内出现次数最多的 fieldName（并列时字典序最小）。
   * CHANGELOG_20 (cross-fieldName dedup): group 现在按纯 valueHash 合并，**同一 secret 可能用
   * 多个 fieldName 命名**（如 `TOKEN` / `FEISHU_TOKEN` / `LARK_TOKEN` 都配同一个 token）；
   * 此字段是「主名」用于 logical key naming，完整 list 见 `fieldNames`。
   */
  fieldName: string;
  /**
   * 该 group 内所有出现过的 fieldName（distinct + 字典序）。CHANGELOG_20 加。
   * 单 fieldName group 时仅 1 项 = `fieldName`；多 fieldName group 时多项，UI 应 surface
   * 提示用户「这个 secret 在 N 个不同字段名下出现，填一次替换全部」。
   *
   * **optional 用于向后兼容**：旧 dchpack（CHANGELOG_19）写的 manifest 没有此字段，restore
   * 时读进来 undefined；新 backup 写的非 undefined。UI 渲染应 `entry.fieldNames ?? [entry.fieldName]` 兜底。
   */
  fieldNames?: string[];
  /** == locations.length */
  count: number;
  /** 动态生成的提示文案，如 "13 occurrences across 2 profiles · also as TOKEN/LARK_TOKEN" */
  hint: string;
  /** 按 packPath 字典序排序保证 deterministic */
  locations: SecretLocation[];
}

export interface SecretsIndex {
  /** 独立于 manifest.format_version；当前固定 1 */
  schema_version: 1;
  total_logical_keys: number;
  /** 校验位 == sum(entries[i].count) */
  total_occurrences: number;
  /** 按 fieldName 字典序 → idx 升序 */
  entries: SecretLogicalEntry[];
}

// ─── buildSecretsIndex ─────────────────────────────────────

/**
 * 内部 group：分配 logical key 前的中间态。CHANGELOG_20 cross-fieldName dedup 后扩展。
 *
 * group key 是纯 valueHash（不再带 fieldName）—— 同 valueHash 跨 fieldName 也合并到同一 group。
 * `fieldNameCounts` 记每个 fieldName 在本 group 的出现次数,用于:
 *   1) 选 primary fieldName（count 最大；并列字典序最小） → entry.fieldName + entry.name 命名
 *   2) 导出 fieldNames[] distinct 列表 → entry.fieldNames（UI 展示「跨 N 字段名」标签）
 */
type Group = {
  fieldNameCounts: Map<string, number>;
  locations: SecretLocation[];
  /** 提取自每个 location 的 packPath `profiles/<id>/...` 段，用于 hint 拼装 */
  profileSet: Set<string>;
  /** valueHash === undefined → 来自 redactWholeFile，每条独立 group 不参与 dedup */
  isWhole: boolean;
};

/**
 * 按 valueHash 全局合并 placeholders → SecretsIndex（**CHANGELOG_20 cross-fieldName dedup**：
 * group key 改为纯 valueHash，跨 fieldName 同 value 也合并；旧版 group key 是 (fieldName, valueHash)
 * 同 value 用不同 fieldName 命名时被切散）。
 *
 * 入参约定：
 * - `placeholders`：backup.ts createBackup 已收集的 PlaceholderEntry[] 平铺数组
 * - `hashByEntry`：与 placeholders 一一对应的 hash 映射；`undefined` 表示该 entry 来自
 *   `redactWholeFile`（整文件场景），不参与 dedup（每条独立 logical key，count=1）
 *
 * 不变量：返回值 `total_occurrences === sum(entries[i].count) === placeholders.length`。
 */
export function buildSecretsIndex(
  placeholders: PlaceholderEntry[],
  hashByEntry: Map<PlaceholderEntry, string | undefined>,
): SecretsIndex {
  // 1. 按 valueHash group（CHANGELOG_20: 不再带 fieldName）。hash undefined → 加 `whole|<idx>`
  //    确保每条独立。
  const groups = new Map<string, Group>();
  placeholders.forEach((entry, idx) => {
    const hash = hashByEntry.get(entry);
    const groupKey = hash === undefined
      ? `whole|${idx}`
      : hash;
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        fieldNameCounts: new Map(),
        locations: [],
        profileSet: new Set(),
        isWhole: hash === undefined,
      };
      groups.set(groupKey, g);
    }
    g.locations.push({ packPath: entry.packPath, fieldPath: entry.fieldPath });
    g.fieldNameCounts.set(entry.fieldName, (g.fieldNameCounts.get(entry.fieldName) ?? 0) + 1);
    // packPath 形如 `profiles/<id>/configDir/...` 或 `profiles/<id>/_meta.json`
    const m = entry.packPath.match(/^profiles\/([^/]+)\//);
    if (m) g.profileSet.add(m[1]!);
  });

  // 2. 给每个 group 选 primary fieldName（出现次数最多；并列时字典序最小）+ 计算 fieldNames distinct
  type ResolvedGroup = Group & { primaryFieldName: string; fieldNames: string[] };
  const resolved: ResolvedGroup[] = [];
  for (const g of groups.values()) {
    let primary = "";
    let primaryCount = -1;
    for (const [fn, c] of g.fieldNameCounts) {
      if (c > primaryCount || (c === primaryCount && fn < primary)) {
        primary = fn;
        primaryCount = c;
      }
    }
    const fieldNames = [...g.fieldNameCounts.keys()].sort();
    resolved.push({ ...g, primaryFieldName: primary, fieldNames });
  }

  // 3. 按 primaryFieldName 二级分桶
  const byPrimary = new Map<string, ResolvedGroup[]>();
  for (const rg of resolved) {
    const list = byPrimary.get(rg.primaryFieldName);
    if (list) list.push(rg);
    else byPrimary.set(rg.primaryFieldName, [rg]);
  }

  // 4. primaryFieldName 字典序 → 同 primary 内按 group「最小 packPath」字典序分配 idx
  const entries: SecretLogicalEntry[] = [];
  const primaryNames = [...byPrimary.keys()].sort();
  for (const fn of primaryNames) {
    const groupsForField = byPrimary.get(fn)!;
    groupsForField.sort((a, b) => firstPackPath(a).localeCompare(firstPackPath(b)));
    groupsForField.forEach((g, i) => {
      const idx = i + 1;
      const sortedLocations = [...g.locations].sort((x, y) => x.packPath.localeCompare(y.packPath));
      entries.push({
        name: `${fn}-${idx}`,
        fieldName: fn,
        fieldNames: g.fieldNames,
        count: g.locations.length,
        hint: hintForGroup(g.locations.length, g.profileSet, g.isWhole, g.fieldNames),
        locations: sortedLocations,
      });
    });
  }

  const totalOcc = entries.reduce((s, e) => s + e.count, 0);
  // 不变量自检：失败说明实现错（不该发生），抛 error 立即暴露
  if (totalOcc !== placeholders.length) {
    throw new Error(
      `secrets-index 不变量失败: total_occurrences=${totalOcc} != placeholders.length=${placeholders.length}`,
    );
  }
  return {
    schema_version: 1,
    total_logical_keys: entries.length,
    total_occurrences: totalOcc,
    entries,
  };
}

function firstPackPath(g: { locations: SecretLocation[] }): string {
  let min = g.locations[0]!.packPath;
  for (const loc of g.locations) {
    if (loc.packPath < min) min = loc.packPath;
  }
  return min;
}

function hintForGroup(count: number, profiles: Set<string>, isWhole: boolean, fieldNames: string[]): string {
  if (isWhole) {
    const profile = [...profiles][0] ?? "unknown";
    return `1 occurrence (whole-file secret, ${profile})`;
  }
  const occ = count === 1 ? "occurrence" : "occurrences";
  const profilePart =
    profiles.size === 0 ? "" :
    profiles.size === 1 ? " in 1 profile" :
    ` across ${profiles.size} profiles`;
  // CHANGELOG_20: 多 fieldName group 提示「跨 N 字段名」便于用户理解一次填值会替换多种命名
  let fnPart = "";
  if (fieldNames.length > 1) {
    const shown = fieldNames.slice(0, 3).join(" / ");
    const more = fieldNames.length > 3 ? ` +${fieldNames.length - 3} more` : "";
    fnPart = ` · ${fieldNames.length} field names: ${shown}${more}`;
  }
  return `${count} ${occ}${profilePart}${fnPart}`;
}

// ─── 透传 field-path.ts(REVIEW_9 G6 拆分) ───────────────────────────
// caller 仍 `import {parseFieldPath / setByFieldPath / applyFilledSecrets / PathSegment /
// ParsedFieldPath / ApplyFilledSecretsResult} from "./secrets-index.ts"` 不变
export type { PathSegment, ParsedFieldPath, ApplyFilledSecretsResult } from "./field-path.ts";
export { parseFieldPath, setByFieldPath, applyFilledSecrets } from "./field-path.ts";
