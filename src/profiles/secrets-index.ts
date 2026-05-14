/**
 * 备份 placeholder 全局去重 + 还原阶段精准 fan-out。CHANGELOG_18 新模块。
 *
 * 设计动机：当前一次备份产出 ~148 处占位符（148 个 `manifest.placeholders[]` 条目），
 * 但跨 profile 镜像 + 同一 token 多文件复用导致**重复率极高**——实测对应 10–20 个唯一真值。
 * 本模块按 (fieldName, sha256(value).slice(0,16)) 全局合并，给每组分配 logical key
 * `<FIELD_NAME>-<idx>`，让 restore 阶段用户从「填 148 次」降到「填 ~15 次」。
 *
 * 4 个 export：
 * - `buildSecretsIndex`     备份阶段调，把 redact.ts 输出的 placeholders[] + per-entry hash
 *                           合并成 `SecretsIndex`（写入 manifest.secrets_index）
 * - `parseFieldPath`        通用：把 fieldPath 字符串拆 PathSegment[] 用于寻址
 * - `setByFieldPath`        通用：在 parse 后的对象上按 PathSegment[] 把 string leaf set 为新值
 * - `applyFilledSecrets`    还原阶段调，按 secrets_index.entries 遍历 → resolve hostPath →
 *                           读 → parse → set → 写回
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

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { rename, rm } from "node:fs/promises";
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

// ─── fieldPath 寻址 ────────────────────────────────────────

export type PathSegment =
  | { type: "key"; key: string }
  | { type: "index"; index: number };

export interface ParsedFieldPath {
  /** json: 以 `$.` 开头（含 _meta.json 的 `$.env.K` 与整文件 `$.placeholder`）；toml: 无前缀 */
  kind: "json" | "toml";
  segments: PathSegment[];
}

/**
 * 解析 fieldPath 字符串：
 * - **JSON 形式**：`$.a.b[0].c` / `$.env.OPENAI_API_KEY` / `$.placeholder`
 * - **TOML 形式**：`a.b.c` / `a.b[0].c`（**REVIEW_9 A-HIGH-1**: 也识别 `key[i]` 段——TOML
 *   array-of-tables 备份后 fieldPath 含 `[i]` 但旧 parseDotPath 只 `s.split(".")` 拆,导致
 *   secrets-fill 寻址失败,真凭据无法回填到 array-of-tables。新版与 parseJsonPath 共享
 *   tokenizer)
 *
 * env 形式（如 `env.K`，redact.ts:175 内部生成）实际不会进 manifest（backup.ts:300 已重写为
 * `$.env.K`），但仍按 TOML dot-path 兼容处理以防御未来变动。
 *
 * **REVIEW_9 A-codex M2**: tokenizer 识别 backslash 转义 `\\` `\.` `\[` `\]`(让含特殊字符
 * 的 key 名能正确还原成单段;walkAndRedact 已对 key 做 escapeKey 转义)。
 *
 * 解析失败抛 Error（caller 应捕获并记入 errors[]）。
 */
export function parseFieldPath(fp: string): ParsedFieldPath {
  if (fp.startsWith("$.")) {
    return { kind: "json", segments: parsePathTokens(fp.slice(2)) };
  }
  if (fp === "$") {
    return { kind: "json", segments: [] };
  }
  return { kind: "toml", segments: parsePathTokens(fp) };
}

/**
 * 通用路径 tokenizer:JSON / TOML 共用。
 *
 * 支持:
 * - dot 段: `a.b.c` → 三段 key
 * - bracket 段: `a[0].b` / `a[0][1]` → key + index 混排
 * - escape 段: `a\.b.c` → key=`a.b` + key=`c`(`\.` 表字面 `.`,`\[` `\]` `\\` 同理)
 *
 * 不支持: 其他正则字符;空 key;非整数 index。
 */
function parsePathTokens(s: string): PathSegment[] {
  if (!s) return [];
  const segs: PathSegment[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "[") {
      const end = s.indexOf("]", i + 1);
      if (end < 0) throw new Error(`unclosed [ in fieldPath: ${s}`);
      const idx = Number(s.slice(i + 1, end));
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`bad index in fieldPath: ${s}`);
      }
      segs.push({ type: "index", index: idx });
      i = end + 1;
      if (s[i] === ".") i++;
      continue;
    }
    // 收集 key 字符直到 unescape 的 `.` / `[`(支持 `\\` `\.` `\[` `\]` 转义)
    let buf = "";
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "\\" && i + 1 < s.length) {
        // 任意被 escape 的字符按字面取(覆盖 `\\` `\.` `\[` `\]`)
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "." || ch === "[") break;
      buf += ch;
      i++;
    }
    if (buf) segs.push({ type: "key", key: buf });
    if (s[i] === ".") i++;
  }
  return segs;
}

/**
 * 按 segments 在 parsed 对象上把 leaf string 替换为 value。
 *
 * 寻址失败（中间节点缺失 / 类型不符 / leaf 非 string）→ return false，caller 决定是否记 errors。
 * 成功 set → return true（原 parsed 对象被原地修改）。
 *
 * **不**允许 set root（`segments.length === 0`）→ return false。
 */
export function setByFieldPath(parsed: unknown, segs: PathSegment[], value: string): boolean {
  if (segs.length === 0) return false;
  let node: unknown = parsed;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const next = stepInto(node, s);
    if (next === undefined) return false;
    node = next;
  }
  return setLeaf(node, segs[segs.length - 1]!, value);
}

function stepInto(node: unknown, s: PathSegment): unknown {
  if (node === null || node === undefined) return undefined;
  if (s.type === "key") {
    if (typeof node !== "object" || Array.isArray(node)) return undefined;
    const obj = node as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, s.key)) return undefined;
    return obj[s.key];
  }
  if (!Array.isArray(node)) return undefined;
  if (s.index >= node.length) return undefined;
  return node[s.index];
}

function setLeaf(node: unknown, last: PathSegment, value: string): boolean {
  if (node === null || node === undefined) return false;
  if (last.type === "key") {
    if (typeof node !== "object" || Array.isArray(node)) return false;
    const obj = node as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, last.key)) return false;
    if (typeof obj[last.key] !== "string") return false;
    obj[last.key] = value;
    return true;
  }
  if (!Array.isArray(node)) return false;
  if (last.index >= node.length) return false;
  if (typeof node[last.index] !== "string") return false;
  node[last.index] = value;
  return true;
}

// ─── applyFilledSecrets ────────────────────────────────────

export interface ApplyFilledSecretsResult {
  /** 实际成功写入的 location 总数（≤ index.total_occurrences） */
  written: number;
  /**
   * 成功写入的 location 集合，元素是 `${packPath}|${fieldPath}` 复合 key（同一 packPath 内可能
   * 多个不同 fieldName 的 placeholder，不能仅靠 packPath dedup —— 否则 caller filter 时会误删
   * 同文件内未填的其他 placeholder）。Caller（applyBackupWithSecrets）按此复合 key 从原
   * placeholders[] filter 出「真正仍未填」的占位符，让 ApplyBackupResult.placeholders 反映
   * fill 后状态而非 stale manifest 数据（Step 4 originally returned only `written: number`；
   * CHANGELOG_18 fix）。
   */
  filledLocations: Set<string>;
  /** secretsMap 没传值的 logical_key 列表（用户主动跳过） */
  skipped: string[];
  /** secretsMap 里有但 index.entries 里没有的 key（warn 不 fail） */
  unknown: string[];
  /** 寻址 / IO / parse 失败的描述（warn 不 fail，由 caller 上报 ApplyBackupResult.errors） */
  errors: string[];
}

/**
 * 按 secretsMap 把 secrets fan-out 到所有 location 的 host fs 路径。
 *
 * - `resolveHostPath(packPath) → undefined`：跳过该 location（caller 已知该 packPath 不可解析为
 *   host fs，如 _meta.json 段 hostPath = STORE_PATH 但 fieldPath `$.env.K` 与 profiles.json
 *   顶层结构不对齐——caller 应预先 filter 这类）
 * - 同一 host file 多 location 自动 batch（读一次 / parse 一次 / set 多次 / 写一次），减少 IO
 * - JSON / TOML parse 失败 → errors[] 记一条，跳过该文件全部 location（不部分写）
 * - 文件后缀非 `.json` / `.toml` → 记 errors[] 跳过（不在本模块支持范围）
 */
export async function applyFilledSecrets(
  index: SecretsIndex,
  secretsMap: Record<string, string>,
  resolveHostPath: (packPath: string) => string | undefined,
): Promise<ApplyFilledSecretsResult> {
  const skipped: string[] = [];
  const errors: string[] = [];
  const filledLocations = new Set<string>();

  // 1. 收集每个 host file 的待写入项；同时累 skipped
  type Pending = { packPath: string; fieldPath: string; value: string };
  const byHostFile = new Map<string, Pending[]>();
  for (const entry of index.entries) {
    const value = secretsMap[entry.name];
    if (value === undefined) {
      skipped.push(entry.name);
      continue;
    }
    for (const loc of entry.locations) {
      const hostPath = resolveHostPath(loc.packPath);
      if (!hostPath) continue;
      const list = byHostFile.get(hostPath);
      if (list) list.push({ packPath: loc.packPath, fieldPath: loc.fieldPath, value });
      else byHostFile.set(hostPath, [{ packPath: loc.packPath, fieldPath: loc.fieldPath, value }]);
    }
  }

  // 2. 算 unknown（secretsMap 里有但 index 没有的 key）
  const knownNames = new Set(index.entries.map((e) => e.name));
  const unknown = Object.keys(secretsMap).filter((k) => !knownNames.has(k));

  // 3. 逐文件 read → parse → set → stringify → write
  let written = 0;
  for (const [hostPath, pendings] of byHostFile) {
    const fileWritten = await fillSingleFile(hostPath, pendings, errors, filledLocations);
    written += fileWritten;
  }

  return { written, filledLocations, skipped, unknown, errors };
}

/**
 * 单文件 fill：read → parse → 多 set → stringify → write。
 *
 * 任何失败（parse / 寻址 / write）都记 errors[] 不抛；成功 set 的 `${packPath}|${fieldPath}`
 * 复合 key 累到 `filledLocations`，返回成功 set 数。当且仅当至少 1 个 set 成功才会写盘
 * （避免只读操作误写）。
 */
async function fillSingleFile(
  hostPath: string,
  pendings: Array<{ packPath: string; fieldPath: string; value: string }>,
  errors: string[],
  filledLocations: Set<string>,
): Promise<number> {
  const isJson = hostPath.endsWith(".json");
  const isToml = hostPath.endsWith(".toml");
  if (!isJson && !isToml) {
    errors.push(`${hostPath}: 文件后缀非 .json/.toml，不支持自动 fill（${pendings.length} 处占位符跳过）`);
    return 0;
  }

  let text: string;
  try {
    text = await Bun.file(hostPath).text();
  } catch (e) {
    errors.push(`${hostPath}: 读取失败: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = isJson ? JSON.parse(text) : (parseToml(text) as Record<string, unknown>);
  } catch (e) {
    errors.push(`${hostPath}: parse 失败: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }

  let okCount = 0;
  const tentative = new Set<string>();
  for (const p of pendings) {
    let pf: ParsedFieldPath;
    try {
      pf = parseFieldPath(p.fieldPath);
    } catch (e) {
      errors.push(`${hostPath} :: ${p.fieldPath}: parse fieldPath 失败: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (setByFieldPath(parsed, pf.segments, p.value)) {
      okCount++;
      tentative.add(`${p.packPath}|${p.fieldPath}`);
    } else {
      errors.push(`${hostPath} :: ${p.fieldPath}: 寻址失败（节点缺失 / 类型不符 / 非 string leaf）`);
    }
  }

  if (okCount === 0) return 0;

  let out: string;
  try {
    if (isJson) {
      out = JSON.stringify(parsed, null, 2) + "\n";
    } else {
      const tomlStr = stringifyToml(parsed as Record<string, unknown>);
      out = tomlStr + (tomlStr.endsWith("\n") ? "" : "\n");
    }
  } catch (e) {
    errors.push(`${hostPath}: stringify 失败: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  // **REVIEW_9 A-claude M2**: 原子写。旧实现 `Bun.write(hostPath, out)` 半写时会留破坏后的
  // 配置(JSON / TOML 解析失败让 Claude / codex 启动崩溃)。三步原子:写 tmp → mv → rename。
  // 同 fs 内 mv = rename(2) 原子,半写时 hostPath 仍指向上次内容。
  const tmpPath = `${hostPath}.dch-fill-tmp-${process.pid}`;
  try {
    await Bun.write(tmpPath, out);
  } catch (e) {
    errors.push(`${hostPath}: 写临时文件失败: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  try {
    await rename(tmpPath, hostPath);
  } catch (e) {
    try { await rm(tmpPath, { force: true }); } catch {}
    errors.push(`${hostPath}: rename 失败: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  // write 成功才 commit tentative → filledLocations（避免 stringify/write fail 时虚报已填）
  for (const key of tentative) filledLocations.add(key);
  return okCount;
}
