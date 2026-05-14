/**
 * fieldPath 解析 + 寻址 + secrets 自动 fan-out 写盘。
 *
 * **REVIEW_9 G6 拆模块**: 从 secrets-index.ts 拆出 (secrets-index 顶 500 LOC 护栏);
 * caller 仍 `import {parseFieldPath / setByFieldPath / applyFilledSecrets} from "./secrets-index.ts"`
 * 不变 — secrets-index.ts 顶部 `export * from "./field-path.ts"` 透传。
 *
 * 5 个 export:
 * - `parseFieldPath`         字符串 fieldPath → PathSegment[](支持 `[i]` index 段 + `\.` `\[` 转义)
 * - `setByFieldPath`         在 parse 后对象上按 segments 把 string leaf set 为新值
 * - `applyFilledSecrets`     按 SecretsIndex 全局 fan-out 写盘(批 host file 读一次写一次)
 * - `PathSegment` / `ParsedFieldPath` / `ApplyFilledSecretsResult`  上述函数的类型 surface
 *
 * 关键设计:
 * - parseFieldPath 失败抛 Error;setByFieldPath 失败 return false(寻址语义,非异常路径)
 * - applyFilledSecrets 把所有 errors 累到 result.errors[] 不抛(让 partial restore 走完)
 * - fillSingleFile 三步原子写(write tmp → rename),避免半写损坏配置
 */

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { SecretsIndex } from "./secrets-index.ts";

// ─── fieldPath 寻址类型 ───────────────────────────────────────

export type PathSegment =
  | { type: "key"; key: string }
  | { type: "index"; index: number };

export interface ParsedFieldPath {
  /** json: 以 `$.` 开头(含 _meta.json 的 `$.env.K` 与整文件 `$.placeholder`);toml: 无前缀 */
  kind: "json" | "toml";
  segments: PathSegment[];
}

/**
 * 解析 fieldPath 字符串：
 * - **JSON 形式**：`$.a.b[0].c` / `$.env.OPENAI_API_KEY` / `$.placeholder`
 * - **JSON 根数组形式**：`$[0]...` / `$[0].name`（**REVIEW_9 A-MED-1 [NEW REGRESSION
 *   post-G1/G6]**: walkAndRedact 对 `JSON.parse("[...]")` 根数组生成 `$[0]...` fieldPath,旧
 *   parseFieldPath 只识别 `$.` 与单 `$` 不识别 `$[` → setByFieldPath 始终 false → 真凭据放在
 *   JSON 根数组里 fan-out fill 失败 silent 漏写。新版 `$[` 进 JSON 模式直接交给 tokenizer 解
 *   bracket 段)
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
  if (fp.startsWith("$[")) {
    // **REVIEW_9 A-MED-1**: JSON 根数组,从 `$` 后开始 tokenize 让 bracket parser 处理 `[i]` 段
    return { kind: "json", segments: parsePathTokens(fp.slice(1)) };
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
 * 不支持: 其他正则字符;**REVIEW_9 A-INFO-1**: 空 key (`a..b` / `.a` / `a.`) 视为契约破坏抛
 * Error,旧实现静默吞空 segment(`a..b` 拆成 `["a","b"]` 而非报错)→ 用户编辑 manifest typo
 * 时拼出错误的 dedup group key 静默错填;非整数 index。
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
    if (!buf) throw new Error(`empty key segment in fieldPath: ${s}`);
    segs.push({ type: "key", key: buf });
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
  // **REVIEW_9 A-MED-2**: tmpPath suffix 加 8 字符 UUID 防进程内并发 race。旧实现仅 `process.pid`,
  // 同进程并发 2 个 fillSingleFile 撞同一 hostPath(典型: 用户连续点击 fill 触发两轮)时
  // tmpPath 相同 → 后写覆盖前写 tmp 内容,rename 时把别人正在写的脏数据落盘。
  const tmpPath = `${hostPath}.dch-fill-tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
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
