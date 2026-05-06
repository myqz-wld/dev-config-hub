import { parse as parseToml } from "smol-toml";
import type { HookScript } from "../../../profiles/types.ts";
import type { ToolKind } from "../../bridge.ts";

export const TOOLS: ToolKind[] = ["claude", "codex"];

export const MAIN_CONFIG: Record<ToolKind, {
  filename: string;
  format: "json" | "toml";
  placeholder: string;
}> = {
  claude: {
    filename: "settings.json",
    format: "json",
    placeholder: '{\n  "env": {\n    "DISABLE_TELEMETRY": "1"\n  },\n  "permissions": {\n    "allow": ["mcp__*"]\n  }\n}\n',
  },
  codex: {
    filename: "config.toml",
    format: "toml",
    placeholder: 'model = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n\n[projects."/Users/apple"]\ntrust_level = "trusted"\n',
  },
};

export const REASONING_OPTIONS = ["", "minimal", "low", "medium", "high", "xhigh"];

export interface AddForm {
  tool: ToolKind;
  id: string;
  dir: string;
  description: string;
  from: string;
  env: Record<string, string>;
  preHook: string;
  postHook: string;
  configContent: string;     // settings.json / config.toml 完整内容
  cfgModel: string;          // 核心字段：model（claude/codex 都支持）
  cfgReasoning: string;      // 核心字段：仅 codex（model_reasoning_effort）
}

/**
 * REVIEW_2 PR-4 修 typecheck：CHANGELOG_6 把 HookScript 改成 string | { posix?, powershell?, cmd? }
 * 但 ProfilePanel 仍按 string 渲染 / 编辑。UI 简化策略 — object 形式 hook 在 textarea 里
 * 显示其 posix 字段（POSIX 平台主用），用户编辑回写还是 string 形式（要写 object 形式
 * 直接编辑 ~/.dch/profiles.json 走 ProfileStoreEditor 即可）。
 */
export function hookToString(h: HookScript | undefined): string {
  if (!h) return "";
  if (typeof h === "string") return h;
  return h.posix ?? h.powershell ?? h.cmd ?? "";
}

/** 简单遮蔽看起来像 key/token 的值（仅显示）。 */
export function maskValue(k: string, v: string): string {
  if (/key|token|secret|password/i.test(k) && v.length > 8) {
    return v.slice(0, 4) + "•••" + v.slice(-4);
  }
  return v;
}

/**
 * 从主配置文件内容里抽核心字段（model / reasoning_effort）。
 * 解析失败 / 字段缺失都返回空串，让 UI 静默继续。
 */
export function parseConfigCore(content: string, format: "json" | "toml"): { cfgModel: string; cfgReasoning: string } {
  let cfgModel = "";
  let cfgReasoning = "";
  if (!content) return { cfgModel, cfgReasoning };
  try {
    if (format === "json") {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.model === "string") cfgModel = parsed.model;
    } else {
      const parsed = parseToml(content) as Record<string, unknown>;
      if (typeof parsed.model === "string") cfgModel = parsed.model;
      if (typeof parsed.model_reasoning_effort === "string") cfgReasoning = parsed.model_reasoning_effort;
    }
  } catch (e) {
    console.warn(`parseConfigCore (${format}) failed:`, e);
  }
  return { cfgModel, cfgReasoning };
}

/**
 * TOML basic string escape：\ → \\, " → \", control chars → \uXXXX。
 * 顺序很重要：必须先转 \ 再转 ", 否则后转的会把前转出来的 \ 再吃一次。
 */
export function tomlBasicString(s: string): string {
  const esc = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${esc}"`;
}

export function generateMinimalConfig(
  tool: ToolKind, fields: { model: string; reasoning: string },
): string {
  if (tool === "claude") {
    const obj: Record<string, unknown> = {};
    if (fields.model) obj.model = fields.model;
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "";
  }
  // codex toml — 用 tomlBasicString 完整转义，避免特殊字符（反斜杠 / 控制字符 / 换行）
  // 生成无效 TOML 让工具下次启动报错。
  const lines: string[] = [];
  if (fields.model) lines.push(`model = ${tomlBasicString(fields.model)}`);
  if (fields.reasoning) lines.push(`model_reasoning_effort = ${tomlBasicString(fields.reasoning)}`);
  return lines.join("\n");
}
