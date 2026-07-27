import { CryptoHasher } from "bun";
import { basename, extname } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  BackupContentSecretRule,
  BackupPolicyV1,
  BackupSecretAction,
  BackupTextFormat,
} from "./types.ts";
import {
  fieldMatchMatches,
  pathRuleMatches,
} from "./backup-policy-match.ts";
import {
  makePlaceholder,
  type PlaceholderHit,
} from "./redact.ts";

export interface BackupSecretAuditHit {
  ruleId: string;
  action: BackupSecretAction;
  fieldPath: string;
}

export interface BackupTransformResult {
  outcome: "include" | "exclude";
  content: Uint8Array;
  format: BackupTextFormat | "binary";
  placeholders: PlaceholderHit[];
  secretHits: BackupSecretAuditHit[];
  warnings: string[];
  rawSecret: boolean;
  unscannable: boolean;
}

interface TextSpan {
  start: number;
  end: number;
  value: string;
  placeholderName?: string;
}

function shortHash(value: string): string | undefined {
  if (!value) return undefined;
  return new CryptoHasher("sha256").update(value).digest("hex").slice(0, 16);
}

function escapeKey(key: string): string {
  return key.replace(/[\\.\[\]]/g, "\\$&");
}

function safePlaceholderName(value: string): string {
  const normalized = value
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[^A-Za-z_]+/, "")
    .toUpperCase();
  return normalized || "SECRET";
}

function effectiveAction(
  action: BackupSecretAction,
  noPlaceholder: boolean,
): BackupSecretAction {
  return noPlaceholder && action === "placeholder" ? "keep-original" : action;
}

function formatFor(relativePath: string): BackupTextFormat {
  const extension = extname(relativePath).toLocaleLowerCase("en-US");
  if (extension === ".jsonc") return "jsonc";
  if (extension === ".json") return "json";
  if (extension === ".toml") return "toml";
  return "text";
}

function regexSpans(rule: BackupContentSecretRule, text: string): TextSpan[] {
  if (rule.match.kind !== "regex") return [];
  const flags = `${rule.match.caseSensitive ? "" : "i"}gd`;
  const regex = new RegExp(rule.match.pattern, flags);
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(regex)) {
    const group = rule.match.secretCaptureGroup ?? 0;
    const indices = match.indices?.[group];
    const value = match[group];
    if (!indices || value === undefined || indices[0] === indices[1]) continue;
    spans.push({ start: indices[0], end: indices[1], value });
  }
  return spans;
}

function keyValueSpans(rule: BackupContentSecretRule, text: string): TextSpan[] {
  if (rule.match.kind !== "key-value") return [];
  const assignment = /(?:^|[\n\r,{])[\t ]*(?:export[\t ]+)?(?:"(?<doubleKey>[A-Za-z_][A-Za-z0-9_.-]*)"|'(?<singleKey>[A-Za-z_][A-Za-z0-9_.-]*)'|(?<plainKey>[A-Za-z_][A-Za-z0-9_.-]*))[\t ]*[:=][\t ]*(?:"(?<doubleValue>[^"\r\n]*)"|'(?<singleValue>[^'\r\n]*)'|(?<plainValue>[^\s,;|&"'\r\n}]+))/gd;
  const keyRegex = new RegExp(
    `^(?:${rule.match.keyPattern})$`,
    rule.match.caseSensitive ? "" : "i",
  );
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(assignment)) {
    const key = match.groups?.doubleKey ??
      match.groups?.singleKey ??
      match.groups?.plainKey ??
      "";
    if (!keyRegex.test(key)) continue;
    const valueGroup = match.groups?.doubleValue !== undefined
      ? "doubleValue"
      : match.groups?.singleValue !== undefined
      ? "singleValue"
      : "plainValue";
    const value = match.groups?.[valueGroup] ?? "";
    const indices = match.indices?.groups?.[valueGroup];
    if (!indices || value.length < rule.match.minValueLength) continue;
    spans.push({
      start: indices[0],
      end: indices[1],
      value,
      placeholderName: safePlaceholderName(key),
    });
  }
  return spans;
}

function contentSpans(rule: BackupContentSecretRule, text: string): TextSpan[] {
  return rule.match.kind === "regex"
    ? regexSpans(rule, text)
    : keyValueSpans(rule, text);
}

function spansOverlap(a: TextSpan, b: TextSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function replaceSpans(
  text: string,
  replacements: Array<TextSpan & { replacement: string }>,
): string {
  let out = text;
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, item.start) + item.replacement + out.slice(item.end);
  }
  return out;
}

function applyContentRules(
  text: string,
  format: BackupTextFormat,
  fieldPath: string,
  rules: BackupContentSecretRule[],
  noPlaceholder: boolean,
  stopAfterFirstRule: boolean,
): {
  text: string;
  placeholders: PlaceholderHit[];
  hits: BackupSecretAuditHit[];
  exclude: boolean;
  rawSecret: boolean;
} {
  const claimed: TextSpan[] = [];
  const replacements: Array<TextSpan & { replacement: string }> = [];
  const placeholders: PlaceholderHit[] = [];
  const hits: BackupSecretAuditHit[] = [];
  let exclude = false;
  let rawSecret = false;

  for (const rule of rules) {
    if (!rule.enabled || !rule.formats.includes(format)) continue;
    const spans = contentSpans(rule, text).filter(
      (span) => !claimed.some((taken) => spansOverlap(span, taken)),
    );
    if (spans.length === 0) continue;
    const action = effectiveAction(rule.action, noPlaceholder);
    for (const span of spans) {
      claimed.push(span);
      hits.push({ ruleId: rule.id, action, fieldPath });
      if (action === "exclude-file") exclude = true;
      if (action === "keep-original") rawSecret = true;
      if (action === "placeholder") {
        const fieldName = rule.placeholderName ??
          span.placeholderName ??
          safePlaceholderName(rule.id);
        const replacement = makePlaceholder(fieldName);
        replacements.push({ ...span, replacement });
        placeholders.push({
          fieldPath,
          fieldName,
          valueHash: shortHash(span.value),
        });
      }
    }
    if (stopAfterFirstRule) break;
  }
  return {
    text: replaceSpans(text, replacements),
    placeholders,
    hits,
    exclude,
    rawSecret,
  };
}

interface StructuredState {
  placeholders: PlaceholderHit[];
  hits: BackupSecretAuditHit[];
  exclude: boolean;
  rawSecret: boolean;
}

function transformStructured(
  node: unknown,
  path: string,
  parentField: string | undefined,
  format: "json" | "jsonc" | "toml",
  policy: BackupPolicyV1,
  noPlaceholder: boolean,
  state: StructuredState,
): unknown {
  if (node instanceof Date) return node;
  if (Array.isArray(node)) {
    return node.map((value, index) => transformStructured(
      value,
      `${path}[${index}]`,
      parentField,
      format,
      policy,
      noPlaceholder,
      state,
    ));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${escapeKey(key)}` : escapeKey(key);
      out[key] = transformStructured(
        value,
        childPath,
        key,
        format,
        policy,
        noPlaceholder,
        state,
      );
    }
    return out;
  }
  if (typeof node !== "string") return node;

  const fieldRule = parentField
    ? policy.secretRules.field.find((rule) => (
      rule.enabled &&
      rule.formats.includes(format) &&
      fieldMatchMatches(rule.match, parentField)
    ))
    : undefined;
  if (fieldRule) {
    const action = effectiveAction(fieldRule.action, noPlaceholder);
    state.hits.push({ ruleId: fieldRule.id, action, fieldPath: path });
    if (action === "exclude-file") state.exclude = true;
    if (action === "keep-original") state.rawSecret = true;
    if (action === "placeholder") {
      const fieldName = fieldRule.placeholderName ?? safePlaceholderName(parentField!);
      state.placeholders.push({
        fieldPath: path,
        fieldName,
        valueHash: shortHash(node),
      });
      return makePlaceholder(fieldName);
    }
    return node;
  }

  const content = applyContentRules(
    node,
    format,
    path,
    policy.secretRules.content,
    noPlaceholder,
    false,
  );
  state.placeholders.push(...content.placeholders);
  state.hits.push(...content.hits);
  state.exclude ||= content.exclude;
  state.rawSecret ||= content.rawSecret;
  return content.text;
}

function wholeFileResult(
  bytes: Uint8Array,
  relativePath: string,
  format: BackupTextFormat,
  action: BackupSecretAction,
  ruleId: string,
  placeholderName: string | undefined,
): BackupTransformResult {
  const fieldName = placeholderName ?? safePlaceholderName(basename(relativePath));
  const hit = { ruleId, action, fieldPath: "$" };
  if (action === "exclude-file") {
    return {
      outcome: "exclude", content: bytes, format, placeholders: [],
      secretHits: [hit], warnings: [], rawSecret: false, unscannable: false,
    };
  }
  if (action !== "placeholder") {
    return {
      outcome: "include", content: bytes, format, placeholders: [],
      secretHits: [hit], warnings: [], rawSecret: action === "keep-original",
      unscannable: false,
    };
  }
  const placeholder = makePlaceholder(fieldName);
  const text = format === "toml"
    ? `placeholder = ${JSON.stringify(placeholder)}\n`
    : format === "json" || format === "jsonc"
    ? JSON.stringify({ placeholder }, null, 2) + "\n"
    : placeholder + "\n";
  return {
    outcome: "include",
    content: new TextEncoder().encode(text),
    format,
    placeholders: [{ fieldPath: format === "toml" ? "placeholder" : "$.placeholder", fieldName }],
    secretHits: [hit],
    warnings: [],
    rawSecret: false,
    unscannable: false,
  };
}

export function transformBackupFile(
  bytes: Uint8Array,
  relativePath: string,
  policy: BackupPolicyV1,
  opts: { noPlaceholder?: boolean } = {},
): BackupTransformResult {
  const format = formatFor(relativePath);
  const wholeRule = policy.secretRules.wholeFile.find(
    (rule) => rule.enabled && pathRuleMatches(rule, relativePath),
  );
  if (wholeRule) {
    return wholeFileResult(
      bytes,
      relativePath,
      format,
      effectiveAction(wholeRule.action, !!opts.noPlaceholder),
      wholeRule.id,
      wholeRule.placeholderName,
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const exclude = policy.unscannableFileAction === "exclude";
    return {
      outcome: exclude ? "exclude" : "include",
      content: bytes,
      format: "binary",
      placeholders: [],
      secretHits: [],
      warnings: [exclude
        ? "不可扫描的二进制文件已按规则排除"
        : "不可扫描的二进制文件已原样包含，未执行密钥检测"],
      rawSecret: false,
      unscannable: true,
    };
  }

  if (format === "text") {
    const transformed = applyContentRules(
      text,
      format,
      "text",
      policy.secretRules.content,
      !!opts.noPlaceholder,
      false,
    );
    return {
      outcome: transformed.exclude ? "exclude" : "include",
      content: new TextEncoder().encode(transformed.text),
      format,
      placeholders: transformed.placeholders,
      secretHits: transformed.hits,
      warnings: [],
      rawSecret: transformed.rawSecret,
      unscannable: false,
    };
  }

  let parsed: unknown;
  let parseWarning: string | undefined;
  try {
    if (format === "toml") parsed = parseToml(text);
    else if (format === "json") parsed = JSON.parse(text);
    else {
      const errors: ParseError[] = [];
      parsed = parseJsonc(text, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      });
      if (errors.length > 0) throw new Error("JSONC parse error");
    }
  } catch {
    parseWarning = `${format.toUpperCase()} 解析失败，已按纯文本规则处理`;
    const fallback = applyContentRules(
      text,
      "text",
      "text",
      policy.secretRules.content,
      !!opts.noPlaceholder,
      false,
    );
    return {
      outcome: fallback.exclude ? "exclude" : "include",
      content: new TextEncoder().encode(fallback.text),
      format,
      placeholders: fallback.placeholders,
      secretHits: fallback.hits,
      warnings: [parseWarning],
      rawSecret: fallback.rawSecret,
      unscannable: false,
    };
  }

  const state: StructuredState = {
    placeholders: [], hits: [], exclude: false, rawSecret: false,
  };
  const rootPath = format === "toml" ? "" : "$";
  const transformed = transformStructured(
    parsed,
    rootPath,
    undefined,
    format,
    policy,
    !!opts.noPlaceholder,
    state,
  );
  let out: string;
  try {
    out = format === "toml"
      ? stringifyToml(transformed as Record<string, unknown>)
      : JSON.stringify(transformed, null, 2);
  } catch {
    return {
      outcome: "exclude",
      content: bytes,
      format,
      placeholders: [],
      secretHits: [],
      warnings: [`${format.toUpperCase()} 序列化失败，已安全排除文件`],
      rawSecret: false,
      unscannable: false,
    };
  }
  if (!out.endsWith("\n")) out += "\n";
  return {
    outcome: state.exclude ? "exclude" : "include",
    content: new TextEncoder().encode(out),
    format,
    placeholders: state.placeholders,
    secretHits: state.hits,
    warnings: parseWarning ? [parseWarning] : [],
    rawSecret: state.rawSecret,
    unscannable: false,
  };
}
