/**
 * 配置文件凭据脱敏。
 *
 * - `redactJsonContent` / `redactTomlContent`：递归遍历 parse 后的对象，按 `isSensitiveKey`
 *   命中字符串 value → 替换为 `<<DCH_PLACEHOLDER:FIELD_NAME>>`，记录 placeholder hit
 * - `redactWholeFile`：整文件级敏感（如 OAuth credentials.json / codex auth.json）→ 整体置占位
 * - `redactProfileEnv`：给 profiles.json 里 profile.env 段用，敏感 key 的 value 也置占位
 * - `placeholderCount`：扫文件还剩几个未填的 `<<DCH_PLACEHOLDER:...>>`（UI 用于"待填提示"）
 *
 * Parse 失败（非严格 JSON / TOML）：**REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批**：旧实现 fall back
 * 到 `return { content, placeholders: [] }` 让真凭据原样进 dchpack。新实现 fall back 到
 * `redactPlainTextContent(content)` regex 兜底 + push 一条 warning 到 `result.warnings`，由
 * caller (backup.ts copyOrRedactFile) 透传到 manifest.security_warnings 让用户/UI 可见。
 *
 * Placeholder 格式：`<<DCH_PLACEHOLDER:KEY_NAME>>`。manifest 单独记录精确路径让 UI 可定位。
 *
 * `valueHash` 字段：CHANGELOG_18 加。仅 backup 内存阶段用作 group key 给 secrets-index 去重；
 * 分配 logical key 后立即丢弃，**绝不写到 manifest / dchpack**。`redactWholeFile` 不带
 * valueHash（整文件场景内容是 OAuth 整体，跨 profile 几乎必然不同；下游识别 undefined 跳过 dedup）。
 *
 * **REVIEW_9 A-HIGH-3**: 空字符串 value 也不带 valueHash（旧行为把所有空 value 误合并成同一
 * group → fan-out 时 cross-fieldName 错填）。下游 buildSecretsIndex 识别 undefined 当
 * wholeFile 各自独立 logical key。
 */

import { CryptoHasher } from "bun";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isSensitiveKey, isSensitiveFile } from "./backup-rules.ts";

export interface PlaceholderHit {
  /**
   * JSON: `$.a.b.c`；TOML: `a.b.c`；profile.env: `env.KEY`。
   * **REVIEW_9 A-codex M2**: key 字面量含 `.` / `[` / `]` / `\` 的字符按 backslash 转义
   * （`a.b` → `a\.b`，`a[0]` → `a\[0\]`），让 parseFieldPath / setByFieldPath 能正确还原成
   * 单段 key。极端罕见但严肃修：未转义会让 `{"api.key": "secret"}` 拼出 `$.api.key` 三段被
   * fan-out fill 误寻址（写错字段或 set fail）。
   */
  fieldPath: string;
  /** 字段名本体（用于占位符内嵌 + UI 提示）。原始未转义字符串，用于 UI 显示。 */
  fieldName: string;
  /**
   * sha256(rawValue) 前 16 字符 hex 短串。仅 backup 内存阶段做 dedup group key，
   * 分配 logical key 后立即丢弃；wholeFile / 空字符串值不携带（undefined 表示「不参与 dedup」）。
   */
  valueHash?: string;
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
 * sha256(value) 前 16 字符 hex 短串。Bun 内置 CryptoHasher 是 sync API，不破坏
 * walkAndRedact 的 sync 签名，避免 cascade 上层 async 改动。
 *
 * 16 字符 = 64 bit 抗碰撞，对 backup dedup 场景（单次备份 < 1000 条 secret）足够；
 * 不暴露给用户也不写 manifest，仅内存比较。
 *
 * **REVIEW_9 A-HIGH-3**: 空字符串 value 返回 undefined（不参与 dedup）。旧实现把
 * `sha256("") = "e3b0c44298fc1c14"` 当合法 hash 让 buildSecretsIndex 把所有空 value 误合并成
 * 同一 group → fan-out 时把 fieldName-1 错填给所有空 value 字段。
 */
function shortHash(value: string): string | undefined {
  if (value === "") return undefined;
  return new CryptoHasher("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * **REVIEW_9 A-codex M2**: 把 key 字面量中的 `\` `.` `[` `]` backslash 转义，让
 * `${pathPrefix}.${escapeKey(k)}` 拼出的 fieldPath 在 parseFieldPath 阶段能正确还原成单段
 * key（而不是被当成多段 / 数组下标拆开）。极罕见但严肃修：未转义会让 `{"api.key": "secret"}`
 * 拼出 `$.api.key` 三段被 fan-out fill 误寻址。
 */
function escapeKey(k: string): string {
  return k.replace(/[\\.\[\]]/g, "\\$&");
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
      const escapedK = escapeKey(k);
      const fieldPath = pathPrefix ? `${pathPrefix}.${escapedK}` : escapedK;
      if (typeof v === "string" && isSensitiveKey(k)) {
        hits.push({ fieldPath, fieldName: k, valueHash: shortHash(v) });
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
  /**
   * **REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批**: parse-based 脱敏（JSON / TOML）失败时 fall back 到
   * `redactPlainTextContent` 后,把一条人类可读 warning push 进来。caller (backup.ts
   * copyOrRedactFile) 透传到 manifest.security_warnings,UI / README 让用户感知「文件 X 解析
   * 失败,已走 regex 兜底,可能漏脱敏不规范的 token」。omitted = 无 warning。
   */
  warnings?: string[];
}

/**
 * JSON 文件脱敏。**REVIEW_9 A-HIGH-2**: parse 失败 fall back 到 `redactPlainTextContent` 走
 * regex 兜底（不再原样返回让真凭据 leak 进 dchpack） + 加一条 warning。caller 透传到
 * manifest.security_warnings。
 *
 * 输出 stringify 用 indent=2，原 formatting 会被 normalise。
 * 大多数 settings.json / .mcp.json 都是 ConfigPanel 用 JSON.stringify(content, null, 2)
 * 落盘的，loss 可接受。
 */
export function redactJsonContent(content: string, filename = ""): RedactResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const fallback = redactPlainTextContent(content);
    const label = filename ? ` (${filename})` : "";
    return {
      ...fallback,
      warnings: [
        ...(fallback.warnings ?? []),
        `JSON 解析失败${label}: 已走 plain-text regex 兜底,可能漏脱敏不规范字段(如 JSONC // 注释 / trailing comma)`,
      ],
    };
  }
  const hits: PlaceholderHit[] = [];
  const redacted = walkAndRedact(raw, "$", hits);
  return {
    content: JSON.stringify(redacted, null, 2) + "\n",
    placeholders: hits,
  };
}

/**
 * TOML 文件脱敏。**REVIEW_9 A-HIGH-2**: parse / stringify 失败同 JSON 也 fall back 到
 * `redactPlainTextContent` + warning。
 *
 * smol-toml stringify 输出符合 TOML 1.0；原文件注释会丢，section 顺序可能调整。
 * 这是接受的代价 — 备份后人工还原前用户大多直接编辑 placeholder 不在意 formatting。
 */
export function redactTomlContent(content: string, filename = ""): RedactResult {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(content) as Record<string, unknown>;
  } catch {
    const fallback = redactPlainTextContent(content);
    const label = filename ? ` (${filename})` : "";
    return {
      ...fallback,
      warnings: [
        ...(fallback.warnings ?? []),
        `TOML 解析失败${label}: 已走 plain-text regex 兜底,可能漏脱敏不规范字段(typo / trailing 逗号)`,
      ],
    };
  }
  const hits: PlaceholderHit[] = [];
  const redacted = walkAndRedact(raw, "", hits) as Record<string, unknown>;
  let out: string;
  try {
    out = stringifyToml(redacted);
  } catch {
    const fallback = redactPlainTextContent(content);
    const label = filename ? ` (${filename})` : "";
    return {
      ...fallback,
      warnings: [
        ...(fallback.warnings ?? []),
        `TOML stringify 失败${label}: 已走 plain-text regex 兜底`,
      ],
    };
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
 *
 * 不带 valueHash：跨 profile 内容几乎必然不同（OAuth 是 per-account），下游 secrets-index
 * 识别 undefined 跳过 dedup，每个 location 独立一个 logical key。
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
      hits.push({ fieldPath: `env.${k}`, fieldName: k, valueHash: shortHash(v) });
    } else {
      out[k] = v;
    }
  }
  return { env: out, placeholders: hits };
}

/**
 * REVIEW_8 M2 / Group D5：纯文本文件（CLAUDE.md / hook .sh / .yaml / .conf 等）的脱敏。
 *
 * 旧 fall-through 直接 return 原 content → CLAUDE.md / hook 脚本里带 sk-ant-...，备份原样
 * 含明文凭据。本函数走 regex 替换而非语法解析（这些文件无统一结构），命中即换 placeholder。
 *
 * 三组模式：
 * - HIGH_CONFIDENCE_PATTERNS：token shape 极强特征（厂家固定前缀 + 长度），低假阳
 * - KEY_VALUE_PATTERNS：`KEY = VALUE` / `KEY: VALUE` / `export KEY=VALUE` 形式且 KEY 命中
 *   敏感词，VALUE 长度 ≥ 16
 * - HTTP_AUTH_PATTERNS：`Authorization: Bearer ...` 这类 HTTP header 内的 token
 *
 * 假阳风险：纯文本不像 JSON/TOML 有结构 — 可能错误替换正常代码片段（如 markdown 里
 * 解释 API key 用法的示例）。这是接受的代价 — review 之前没 release，错改总比泄漏好。
 *
 * 命中后写一条 placeholder hit（fieldPath 用 `text.line:col`，fieldName 用模式名前缀）让
 * UI 能定位（虽然 fieldPath 仅做提示，UI 不解析它）。
 */
const HIGH_CONFIDENCE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "ANTHROPIC_API_KEY", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OPENAI_PROJ_KEY", re: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { name: "OPENAI_API_KEY", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "GITHUB_PAT", re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: "GITHUB_OAUTH", re: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { name: "GITHUB_USER_OAUTH", re: /\bghu_[A-Za-z0-9]{36,}\b/g },
  { name: "GITHUB_SERVER_OAUTH", re: /\bghs_[A-Za-z0-9]{36,}\b/g },
  { name: "GITLAB_PAT", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "SLACK_BOT_TOKEN", re: /\bxoxb-[A-Za-z0-9-]{20,}\b/g },
  { name: "SLACK_USER_TOKEN", re: /\bxoxp-[A-Za-z0-9-]{20,}\b/g },
  { name: "AWS_ACCESS_KEY_ID", re: /\bAKIA[0-9A-Z]{16}\b/g },
];

// KEY = VALUE / KEY: VALUE / export KEY=VALUE
// 仅当 KEY 含敏感词（api_key / token / secret / password / bearer 等）才命中。
//
// **REVIEW_9 A-HIGH-4 + A-claude M1**: 重写。
// 旧 regex `[A-Za-z0-9_+./=-]{16,}` 字符集过窄,漏 `:` (Slack webhook url) /
// `password!@#$` (含 shell special) / `tok:abc...` 类组合,且 callback 一律重建为
// `KEY=value` 损坏 YAML (`api_key: "x"` → `api_key=<<placeholder>>`)、丢引号 (强 lint
// 工具报错)、丢空白对齐。
//
// 新设计:三组捕获 quote 区分(双引号 / 单引号 / 无引号)+ callback 拼回原 layout。
//   - 双引号: `KEY <sep> "value..."`  → 重建保留 `"`
//   - 单引号: `KEY <sep> 'value...'`  → 重建保留 `'`
//   - 无引号: `KEY <sep> value...`    → value 截到行尾下一个空白(允许任意 char 含 `:` `!@#$`)
// 分隔符 `<sep>` (`=` 或 `:` + 周围空白) + 引号都被 callback 原样拼回,YAML / properties / TS
// 等 syntax 不破坏。value 长度 ≥ 8(避免 `key=v` 短设置误命中)。
const KEY_VALUE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "GENERIC_KEY_VALUE",
    re: /\b((?:[A-Za-z][A-Za-z0-9_]*_)?(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|BEARER|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|AUTH))(\s*[:=]\s*)(?:"([^"\n]{8,})"|'([^'\n]{8,})'|([^\s"'\n][^\s\n\r]{7,}))/gi,
  },
];

// Authorization: Bearer xxx / Basic xxx / Token xxx
// REVIEW_8 R2 R2-11 / R3 G2：加 `i` flag 大小写不敏感（lowercase `authorization:` /
// scheme `bearer` 都常见于 HTTP request log / curl 例子，原 `/g` 漏脱敏）
const HTTP_AUTH_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "HTTP_AUTH",
    re: /\b(Authorization|X-Api-Key|X-Auth-Token)\s*:\s*(Bearer|Basic|Token)?\s*([A-Za-z0-9_+./=-]{16,})/gi,
  },
];

export function redactPlainTextContent(content: string): RedactResult {
  let out = content;
  const hits: PlaceholderHit[] = [];

  // 1. HIGH_CONFIDENCE：整 token 替换为 placeholder
  for (const { name, re } of HIGH_CONFIDENCE_PATTERNS) {
    out = out.replace(re, (m: string) => {
      hits.push({ fieldPath: `text.${name}`, fieldName: name, valueHash: shortHash(m) });
      return makePlaceholder(name);
    });
  }

  // 2. KEY_VALUE: 保留 key + 分隔符 + 引号(原样拼回 不损坏 YAML / properties / TS),
  //    仅替换 value 部分。**REVIEW_9 A-HIGH-4 + A-claude M1**: callback 重写。
  for (const { re } of KEY_VALUE_PATTERNS) {
    out = out.replace(re, (
      _m: string,
      keyName: string,
      sep: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      unquoted: string | undefined,
    ) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      if (!value) return _m;
      // **REVIEW_9 A-HIGH-4 防御**: value 已是 placeholder 形式(HIGH_CONFIDENCE 阶段刚换)
      // 时跳过 — 否则会用 KEY_VALUE 通用名(如 `API_KEY`)覆盖 HIGH_CONFIDENCE 精准名
      // (`ANTHROPIC_API_KEY`),用户填回时 logical key 错位。
      if (value.includes(PLACEHOLDER_PREFIX)) return _m;
      const upperKey = keyName.toUpperCase().replace(/-/g, "_");
      hits.push({ fieldPath: `text.${upperKey}`, fieldName: upperKey, valueHash: shortHash(value) });
      const ph = makePlaceholder(upperKey);
      // 重建保留原 layout
      if (doubleQuoted !== undefined) return `${keyName}${sep}"${ph}"`;
      if (singleQuoted !== undefined) return `${keyName}${sep}'${ph}'`;
      return `${keyName}${sep}${ph}`;
    });
  }

  // 3. HTTP_AUTH：保留 header 名 + scheme，仅替换 token
  for (const { re } of HTTP_AUTH_PATTERNS) {
    out = out.replace(re, (_m: string, headerName: string, scheme: string | undefined, token: string) => {
      const phName = "HTTP_AUTH_TOKEN";
      hits.push({ fieldPath: `text.${headerName}`, fieldName: phName, valueHash: shortHash(token) });
      const schemePart = scheme ? `${scheme} ` : "";
      return `${headerName}: ${schemePart}${makePlaceholder(phName)}`;
    });
  }

  return { content: out, placeholders: hits };
}

/**
 * 按文件名分发：扩展名 .json → JSON，.toml → TOML，整文件级（auth.json /
 * credentials.json）走 redactWholeFile。**REVIEW_8 M2 / D5**：其他文件类型 fall-through
 * 到 redactPlainTextContent（regex 替换 token），不再原样返回。
 *
 * **REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批**: 把 filename 一路传给 redactJsonContent /
 * redactTomlContent,parse 失败 fall back 到 plain-text 时 warning 能带上 filename 让用户
 * 知道哪个文件解析失败。
 *
 * caller 拿到 filename 是 basename（如 `settings.json`），用于 sensitive-file 命中判断
 * + 选 parser。
 */
export function redactByFilename(content: string, filename: string): RedactResult {
  if (isSensitiveFile(filename)) return redactWholeFile(content, filename);
  if (filename.endsWith(".json")) return redactJsonContent(content, filename);
  if (filename.endsWith(".toml")) return redactTomlContent(content, filename);
  return redactPlainTextContent(content);
}
