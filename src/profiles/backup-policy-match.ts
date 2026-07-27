import { basename } from "node:path";
import type {
  BackupFieldMatch,
  BackupFileAction,
  BackupMatchExpression,
  BackupPolicyV1,
} from "./types.ts";

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function regexMatches(pattern: string, value: string, caseSensitive = false): boolean {
  return new RegExp(pattern, caseSensitive ? "" : "i").test(value);
}

function globMatches(pattern: string, value: string, caseSensitive = false): boolean {
  const candidate = caseSensitive ? value : value.toLocaleLowerCase("en-US");
  const normalizedPattern = caseSensitive
    ? pattern
    : pattern.toLocaleLowerCase("en-US");
  return new Bun.Glob(normalizedPattern).match(candidate);
}

export function pathExpressionMatches(
  expression: BackupMatchExpression,
  value: string,
): boolean {
  return expression.kind === "glob"
    ? globMatches(expression.pattern, value, expression.caseSensitive)
    : regexMatches(expression.pattern, value, expression.caseSensitive);
}

export function pathRuleMatches(
  rule: {
    target: "relative-path" | "basename";
    match: BackupMatchExpression;
  },
  relativePath: string,
): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const candidate = rule.target === "basename"
    ? basename(normalized)
    : normalized;
  return pathExpressionMatches(rule.match, candidate);
}

export interface FileCoverageDecision {
  action: BackupFileAction;
  ruleId: string | null;
}

/** Enabled file rules are evaluated top-to-bottom; the first match is final. */
export function evaluateFileCoverage(
  policy: BackupPolicyV1,
  relativePath: string,
): FileCoverageDecision {
  for (const rule of policy.fileRules) {
    if (rule.enabled && pathRuleMatches(rule, relativePath)) {
      return { action: rule.action, ruleId: rule.id };
    }
  }
  return { action: policy.defaultFileAction, ruleId: null };
}

export function fieldMatchMatches(match: BackupFieldMatch, fieldName: string): boolean {
  const candidate = match.caseSensitive
    ? fieldName
    : fieldName.toLocaleLowerCase("en-US");
  const pattern = match.caseSensitive
    ? match.pattern
    : match.pattern.toLocaleLowerCase("en-US");
  switch (match.kind) {
    case "exact":
      return candidate === pattern;
    case "contains":
      return candidate.includes(pattern);
    case "suffix":
      return candidate.endsWith(pattern);
    case "glob":
      return new Bun.Glob(pattern).match(candidate);
    case "regex":
      return regexMatches(match.pattern, fieldName, match.caseSensitive);
  }
}
