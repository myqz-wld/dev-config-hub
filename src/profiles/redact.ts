/**
 * 配置文件凭据脱敏。
 *
 * - `redactJsonContent` / `redactTomlContent`：递归遍历 parse 后的对象，按 `isSensitiveKey`
 *   命中字符串 value → 替换为 `<<DCH_PLACEHOLDER:FIELD_NAME>>`，记录 placeholder hit
 * - `redactWholeFile`：整文件级敏感（如 OAuth credentials.json / codex auth.json）→ 整体置占位
 * - `redactProfileEnv`：给 profiles.json 里 profile.env 段用，敏感 key 的 value 也置占位
 * - `placeholderCount`：扫文件还剩几个未填的 `<<DCH_PLACEHOLDER:...>>`（UI 用于"待填提示"）
 *
 * Parse 失败（非严格 JSON / TOML）：不抛错，原样返回 content + 空 placeholders[]，
 * 由 caller 决定是否记 warning（避免备份因为单文件解析失败而整体失败）。
 *
 * Placeholder 格式：`<<DCH_PLACEHOLDER:KEY_NAME>>`。manifest 单独记录精确路径让 UI 可定位。
 */

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isSensitiveKey, isSensitiveFile } from "./backup-rules.ts";

export interface PlaceholderHit {
  /** JSON: `$.a.b.c`；TOML: `a.b.c`；profile.env: `env.KEY` */
  fieldPath: string;
  /** 字段名本体（用于占位符内嵌 + UI 提示） */
  fieldName: string;
}

const PLACEHOLDER_PREFIX = "<<DCH_PLACEHOLDER:";
const PLACEHOLDER_SUFFIX = ">>";

export function makePlaceholder(fieldName: string): string {
  return `${PLACEHOLDER_PREFIX}${fieldName}${PLACEHOLDER_SUFFIX}`;
}

const PLACEHOLDER_RE = /<<DCH_PLACEHOLDER:[^>]+>>/g;

/** 计文件内剩余未填的占位符个数，UI restore 后用作"待填提示"。 */
export function placeholderCount(content: string): number {
  const m = content.match(PLACEHOLDER_RE);
  return m ? m.length : 0;
}

/**
 * 递归遍历对象 / 数组，命中 sensitive key 的 string value 替换为 placeholder。
 * 数字 / 布尔 / null / 嵌套对象 value 不动（敏感字段实际都是字符串 token）。
 */
function walkAndRedact(
  node: unknown,
  pathPrefix: string,
  hits: PlaceholderHit[],
): unknown {
  if (Array.isArray(node)) {
    return node.map((item, i) => walkAndRedact(item, `${pathPrefix}[${i}]`, hits));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const fieldPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (typeof v === "string" && isSensitiveKey(k)) {
        hits.push({ fieldPath, fieldName: k });
        out[k] = makePlaceholder(k);
      } else {
        out[k] = walkAndRedact(v, fieldPath, hits);
      }
    }
    return out;
  }
  return node;
}

export interface RedactResult {
  content: string;
  placeholders: PlaceholderHit[];
}

/**
 * JSON 文件脱敏。Parse 失败 → 原样返回 + 空 placeholders（caller 自行 warning）。
 *
 * 输出 stringify 用 indent=2，原 formatting 会被 normalise。
 * 大多数 settings.json / .mcp.json 都是 ConfigPanel 用 JSON.stringify(content, null, 2)
 * 落盘的，loss 可接受。
 */
export function redactJsonContent(content: string): RedactResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { content, placeholders: [] };
  }
  const hits: PlaceholderHit[] = [];
  const redacted = walkAndRedact(raw, "$", hits);
  return {
    content: JSON.stringify(redacted, null, 2) + "\n",
    placeholders: hits,
  };
}

/**
 * TOML 文件脱敏。Parse 失败同上。
 *
 * smol-toml stringify 输出符合 TOML 1.0；原文件注释会丢，section 顺序可能调整。
 * 这是接受的代价 — 备份后人工还原前用户大多直接编辑 placeholder 不在意 formatting。
 */
export function redactTomlContent(content: string): RedactResult {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(content) as Record<string, unknown>;
  } catch {
    return { content, placeholders: [] };
  }
  const hits: PlaceholderHit[] = [];
  const redacted = walkAndRedact(raw, "", hits) as Record<string, unknown>;
  let out: string;
  try {
    out = stringifyToml(redacted);
  } catch {
    return { content, placeholders: [] };
  }
  return {
    content: out + (out.endsWith("\n") ? "" : "\n"),
    placeholders: hits,
  };
}

/**
 * 整文件级敏感：替换为 OAuth-shape 占位符（保留为 valid JSON）。
 *
 * 用例：~/.claude/credentials.json / ~/.codex/auth.json — 整个文件就是 OAuth payload，
 * 字段名不一定命中 SENSITIVE_KEY_PATTERNS 但整体是凭据，必须整体替换。
 */
export function redactWholeFile(_content: string, filename: string): RedactResult {
  const fieldName = filename.replace(/\.[^.]+$/, "").toUpperCase();
  return {
    content: JSON.stringify({ placeholder: makePlaceholder(fieldName) }, null, 2) + "\n",
    placeholders: [{ fieldPath: "$.placeholder", fieldName }],
  };
}

/**
 * profile.env 段脱敏：敏感 key 的 value 替换为 placeholder。
 * 不动 key 自身（key 名必须保留，否则 wrapper 模式 dch profile env 输出错）。
 */
export function redactProfileEnv(
  env: Record<string, string> | undefined,
): { env: Record<string, string>; placeholders: PlaceholderHit[] } {
  if (!env) return { env: {}, placeholders: [] };
  const out: Record<string, string> = {};
  const hits: PlaceholderHit[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (isSensitiveKey(k)) {
      out[k] = makePlaceholder(k);
      hits.push({ fieldPath: `env.${k}`, fieldName: k });
    } else {
      out[k] = v;
    }
  }
  return { env: out, placeholders: hits };
}

/**
 * 按文件名分发：扩展名 .json → JSON，.toml → TOML，整文件级（auth.json /
 * credentials.json）走 redactWholeFile。其他文件不处理。
 *
 * caller 拿到 filename 是 basename（如 `settings.json`），用于 sensitive-file 命中判断
 * + 选 parser。
 */
export function redactByFilename(content: string, filename: string): RedactResult {
  if (isSensitiveFile(filename)) return redactWholeFile(content, filename);
  if (filename.endsWith(".json")) return redactJsonContent(content);
  if (filename.endsWith(".toml")) return redactTomlContent(content);
  return { content, placeholders: [] };
}
