import type {
  BackupContentSecretRule,
  BackupFieldSecretRule,
  BackupPolicyV1,
  BackupRuleBase,
  BackupSecretAction,
  BackupWholeFileSecretRule,
} from "./types.ts";

const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const PLACEHOLDER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/;
const MAX_PATTERN_LENGTH = 512;
const SECRET_ACTIONS = new Set<BackupSecretAction>([
  "placeholder", "exclude-file", "keep-original", "ignore",
]);

function assertRuleBase(rule: BackupRuleBase, ids: Set<string>): void {
  if (!RULE_ID_RE.test(rule.id)) {
    throw new Error(`备份规则 ID 非法: ${JSON.stringify(rule.id)}`);
  }
  if (ids.has(rule.id)) throw new Error(`备份规则 ID 重复: ${rule.id}`);
  ids.add(rule.id);
  if (!rule.label.trim()) throw new Error(`备份规则 ${rule.id} 缺少名称`);
  if (typeof rule.enabled !== "boolean") throw new Error(`备份规则 ${rule.id}.enabled 必须是布尔值`);
}

function compileRegex(pattern: string, caseSensitive = false): RegExp {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`正则表达式长度必须是 1-${MAX_PATTERN_LENGTH} 个字符`);
  }
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch (error) {
    throw new Error(`非法正则表达式 ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateGlob(pattern: string): void {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Glob 长度必须是 1-${MAX_PATTERN_LENGTH} 个字符`);
  }
  if (pattern.includes("\0")) throw new Error("Glob 不能包含空字符");
  const pairs: Record<string, string> = { "]": "[", "}": "{" };
  const stack: string[] = [];
  let escaped = false;
  for (const char of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" || char === "{") stack.push(char);
    else if (char === "]" || char === "}") {
      if (stack.pop() !== pairs[char]) {
        throw new Error(`非法 Glob ${JSON.stringify(pattern)}: 括号不匹配`);
      }
    }
  }
  if (escaped || stack.length > 0) {
    throw new Error(`非法 Glob ${JSON.stringify(pattern)}: 转义或括号未闭合`);
  }
  try {
    new Bun.Glob(pattern);
  } catch (error) {
    throw new Error(`非法 Glob ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validatePlaceholder(rule: {
  id: string;
  action: BackupSecretAction;
  placeholderName?: string;
}): void {
  if (!SECRET_ACTIONS.has(rule.action)) {
    throw new Error(`备份规则 ${rule.id} 的密钥动作非法: ${String(rule.action)}`);
  }
  if (rule.placeholderName !== undefined && !PLACEHOLDER_NAME_RE.test(rule.placeholderName)) {
    throw new Error(`备份规则 ${rule.id} 的占位符名称非法`);
  }
}

function validatePathSecretRule(
  rule: BackupWholeFileSecretRule,
  ids: Set<string>,
): void {
  assertRuleBase(rule, ids);
  if (rule.target !== "relative-path" && rule.target !== "basename") {
    throw new Error(`备份规则 ${rule.id} 的匹配目标非法`);
  }
  if (rule.match.kind === "glob") validateGlob(rule.match.pattern);
  else if (rule.match.kind === "regex") compileRegex(rule.match.pattern, rule.match.caseSensitive);
  else throw new Error(`备份规则 ${rule.id} 的匹配器非法`);
  validatePlaceholder(rule);
}

function validateFieldRule(rule: BackupFieldSecretRule, ids: Set<string>): void {
  assertRuleBase(rule, ids);
  if (rule.formats.length === 0 || rule.formats.some((f) => !["json", "jsonc", "toml"].includes(f))) {
    throw new Error(`备份规则 ${rule.id} 的结构化格式非法`);
  }
  if (!rule.match.pattern || rule.match.pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`备份规则 ${rule.id} 的字段匹配内容非法`);
  }
  if (rule.match.kind === "regex") compileRegex(rule.match.pattern, rule.match.caseSensitive);
  else if (rule.match.kind === "glob") validateGlob(rule.match.pattern);
  else if (!["exact", "contains", "suffix"].includes(rule.match.kind)) {
    throw new Error(`备份规则 ${rule.id} 的字段匹配器非法`);
  }
  validatePlaceholder(rule);
}

function validateContentRule(rule: BackupContentSecretRule, ids: Set<string>): void {
  assertRuleBase(rule, ids);
  if (
    rule.formats.length === 0 ||
    rule.formats.some((f) => !["json", "jsonc", "toml", "text"].includes(f))
  ) {
    throw new Error(`备份规则 ${rule.id} 的内容格式非法`);
  }
  if (rule.match.kind === "regex") {
    const regex = compileRegex(rule.match.pattern, rule.match.caseSensitive);
    if (rule.match.secretCaptureGroup !== undefined) {
      if (!Number.isInteger(rule.match.secretCaptureGroup) || rule.match.secretCaptureGroup < 0) {
        throw new Error(`备份规则 ${rule.id} 的 capture group 必须是非负整数`);
      }
      const sample = "DCH_CAPTURE_VALIDATION";
      const groupCount = new RegExp(`${regex.source}|(${sample})`).exec(sample)!.length - 2;
      if (rule.match.secretCaptureGroup > groupCount) {
        throw new Error(`备份规则 ${rule.id} 的 capture group 不存在`);
      }
    }
  } else if (rule.match.kind === "key-value") {
    compileRegex(rule.match.keyPattern, rule.match.caseSensitive);
    if (!Number.isInteger(rule.match.minValueLength) || rule.match.minValueLength < 1) {
      throw new Error(`备份规则 ${rule.id} 的最短密钥长度必须是正整数`);
    }
  } else {
    throw new Error(`备份规则 ${rule.id} 的内容匹配器非法`);
  }
  validatePlaceholder(rule);
}

export function validateBackupPolicy(policy: BackupPolicyV1): void {
  if (!policy || typeof policy !== "object") throw new Error("备份规则必须是对象");
  if (policy.schemaVersion !== 1) throw new Error(`不支持的备份规则版本: ${String(policy.schemaVersion)}`);
  if (!["include", "exclude"].includes(policy.defaultFileAction)) {
    throw new Error(`默认文件动作非法: ${String(policy.defaultFileAction)}`);
  }
  if (!["include-with-warning", "exclude"].includes(policy.unscannableFileAction)) {
    throw new Error(`不可扫描文件动作非法: ${String(policy.unscannableFileAction)}`);
  }
  if (
    !Array.isArray(policy.fileRules) ||
    !policy.secretRules ||
    !Array.isArray(policy.secretRules.wholeFile) ||
    !Array.isArray(policy.secretRules.field) ||
    !Array.isArray(policy.secretRules.content)
  ) {
    throw new Error("备份规则缺少文件或密钥规则数组");
  }

  const ids = new Set<string>();
  for (const rule of policy.fileRules) {
    assertRuleBase(rule, ids);
    if (rule.target !== "relative-path" && rule.target !== "basename") {
      throw new Error(`备份规则 ${rule.id} 的匹配目标非法`);
    }
    if (rule.match.kind === "glob") validateGlob(rule.match.pattern);
    else if (rule.match.kind === "regex") compileRegex(rule.match.pattern, rule.match.caseSensitive);
    else throw new Error(`备份规则 ${rule.id} 的匹配器非法`);
    if (rule.action !== "include" && rule.action !== "exclude") {
      throw new Error(`备份规则 ${rule.id} 的文件动作非法`);
    }
  }
  for (const rule of policy.secretRules.wholeFile) validatePathSecretRule(rule, ids);
  for (const rule of policy.secretRules.field) validateFieldRule(rule, ids);
  for (const rule of policy.secretRules.content) validateContentRule(rule, ids);
}

export function cloneBackupPolicy(policy: BackupPolicyV1): BackupPolicyV1 {
  return structuredClone(policy);
}
