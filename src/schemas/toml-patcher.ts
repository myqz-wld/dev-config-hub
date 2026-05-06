import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * 字段级 TOML patch：原文 + 行级 in-place edit，注释 / 字段顺序 / 空行尽可能保留。
 *
 * **数据完整性铁律**（同 json-patcher）：所有写回必须以 `patchToml(原文, patches)` 形式做，
 * 禁止「全量 stringify ConfigScope.parsed」 —— 那会丢 schema 不认识的用户自定义 key。
 *
 * **覆盖范围**（自写最小 patcher，95% 实际配置文件场景）：
 *   - **fast path**：top-level scalar（`model = "x"`）+ `[section]` 内 scalar（`[network] timeout = 30`）+ 简单字符串 / number / bool 数组
 *   - **fallback**：inline table（`x = { a = 1, b = 2 }`）+ array of tables（`[[arr]]`）+ 多行字符串 / 触发 fallback flag，caller 决定要不要重新序列化（接受丢注释）
 *
 * 真实项目命中率：codex `~/.codex/config.toml` 主用 `[model_providers.X]` / `[projects.X]` 等
 * 平铺 section + scalar，95% patch 走 fast path；只有 mcp_servers 这类 inline-table 才 fallback。
 */

import type { JsonPatch } from "./json-patcher.ts";

export type TomlPatch = JsonPatch;

export interface TomlPatchResult {
  patched: string;
  /** true = 走了 fallback（重新 stringify 整文件，注释会丢） */
  fallback: boolean;
  reason?: string;
}

interface LineLoc {
  line: number;
  /** scalar = 行级 in-place 替换；complex = 触发 fallback */
  kind: "scalar" | "complex";
}

/**
 * 在原文上按 patches 顺序做字段级 edit。
 *
 * 行为：
 *   - 单 scalar 改值：行级 in-place 替换，注释 / 空行不动
 *   - 删 key：删整行
 *   - 加 key：未实现的 fast path（fallback 重新 stringify）
 *   - 任一 patch 触发 fallback → 整文件 stringify（接受丢注释，caller 应弹 dialog 让用户确认）
 */
export function patchToml(source: string, patches: readonly TomlPatch[]): TomlPatchResult {
  if (patches.length === 0) return { patched: source, fallback: false };

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(source) as Record<string, unknown>;
  } catch (e) {
    return {
      patched: source,
      fallback: true,
      reason: `TOML parse 失败：${(e as Error).message}`,
    };
  }

  const lines = source.split(/\r?\n/);
  const idx = buildLineIndex(lines);

  const out = [...lines];
  // 离线累积新增的 (key, value)，没找到 LineLoc 的 patch 走 fallback
  for (const { path, value } of patches) {
    const pathStr = path.map(String).join(".");
    const loc = idx.get(pathStr);
    if (!loc || loc.kind === "complex") {
      // fallback：重新 stringify
      return doFallback(parsed, patches);
    }
    if (value === undefined) {
      out[loc.line] = "";  // 删整行（保留空行避免位置错位）
    } else {
      const lastSeg = String(path[path.length - 1] ?? "");
      try {
        out[loc.line] = `${lastSeg} = ${tomlValue(value)}`;
      } catch {
        return doFallback(parsed, patches);
      }
    }
  }
  return { patched: out.join("\n"), fallback: false };
}

function doFallback(parsed: Record<string, unknown>, patches: readonly TomlPatch[]): TomlPatchResult {
  const next = applyPatchesToObject(parsed, patches);
  try {
    return {
      patched: stringifyToml(next),
      fallback: true,
      reason: "存在 inline-table / array-of-tables / 复杂嵌套，已重新序列化（注释会丢）",
    };
  } catch (e) {
    return {
      patched: stringifyToml(parsed),
      fallback: true,
      reason: `stringify 失败：${(e as Error).message}`,
    };
  }
}

function applyPatchesToObject(
  obj: Record<string, unknown>,
  patches: readonly TomlPatch[],
): Record<string, unknown> {
  const next = structuredClone(obj);
  for (const { path, value } of patches) {
    let cur: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = String(path[i]);
      if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
      cur = cur[seg] as Record<string, unknown>;
    }
    const last = String(path[path.length - 1]);
    if (value === undefined) delete cur[last];
    else cur[last] = value;
  }
  return next;
}

/**
 * 状态机扫描：跟踪当前 [section]，对每个 `key = value` 行记录 path + 标 scalar / complex。
 *
 * 标 complex（触发 fallback）的情况：
 *   - inline table：`x = { ... }`
 *   - 多行字符串起始：`x = """`
 *   - array of tables 头：`[[arr]]`（path 不能简单 dotted 表达）
 *   - 多行数组：暂作 complex（保守）
 *
 * **已知限制**（REVIEW_4 L1）：quoted key 含点号（`"a.b" = 1`）与嵌套 section dotted key（`[s.a] b = 1`）
 * 都会生成 `s.a.b` map key 产生 collision；后到的覆盖先到的。极罕见配置文件场景，标 known limitation。
 */
function buildLineIndex(lines: string[]): Map<string, LineLoc> {
  const map = new Map<string, LineLoc>();
  let section = "";  // 当前 [section] 名（dotted）
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // [section] / [a.b.c]
    const sectionMatch = trimmed.match(/^\[([^\[\]]+)\]\s*(#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    // [[array of tables]] → 这一段直接标 complex
    const arrTblMatch = trimmed.match(/^\[\[([^\[\]]+)\]\]\s*(#.*)?$/);
    if (arrTblMatch) {
      const aotPath = arrTblMatch[1]!.trim();
      map.set(aotPath, { line: i, kind: "complex" });
      section = aotPath;
      continue;
    }
    // key = value（含 dotted key 如 a.b = 1，但保守只支持单段 key）
    const kvMatch = raw.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*|"[^"]+"|'[^']+')\s*=\s*(.+?)\s*(#.*)?$/);
    if (!kvMatch) continue;
    const key = kvMatch[2]!.replace(/^["']|["']$/g, "");
    const valuePart = (kvMatch[3] ?? "").trim();
    const path = section ? `${section}.${key}` : key;

    // 标 complex：inline table / 多行字符串起始 / 多行数组起始
    const isInlineTable = valuePart.startsWith("{");
    const isMultilineStr = valuePart === '"""' || valuePart === "'''" || valuePart.startsWith('"""') || valuePart.startsWith("'''");
    const isMultilineArr = valuePart === "[" || (valuePart.startsWith("[") && !valuePart.endsWith("]"));
    if (isInlineTable || isMultilineStr || isMultilineArr) {
      map.set(path, { line: i, kind: "complex" });
      continue;
    }
    map.set(path, { line: i, kind: "scalar" });
  }
  return map;
}

/** 把 JS 值序列化为 TOML 字面量。复杂值（嵌套 object / 异构数组）throw 让 caller fallback。 */
function tomlValue(v: unknown): string {
  if (v === null) throw new Error("TOML 不支持 null");
  if (typeof v === "boolean") return String(v);
  // REVIEW_4 L5：之前 `Number.isInteger(v) ? String(v) : String(v)` 死分支；smol-toml 序列化整数 / 浮点都用 String 即可
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return tomlBasicString(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return `[${v.map(tomlBasicString).join(", ")}]`;
    if (v.every((x) => typeof x === "number")) return `[${v.join(", ")}]`;
    if (v.every((x) => typeof x === "boolean")) return `[${v.map(String).join(", ")}]`;
    throw new Error("异构数组走 fallback");
  }
  throw new Error(`不支持的 TOML scalar 类型：${typeof v}`);
}

function tomlBasicString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r")}"`;
}
