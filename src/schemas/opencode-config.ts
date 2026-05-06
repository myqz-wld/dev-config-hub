import type { ToolSchema, FieldSchema } from "./types.ts";

/**
 * OpenCode config schema（PR-E）。
 *
 * **字段来源**：上游 docs（https://opencode.ai/docs/config/）。
 * 配置文件路径：POSIX `~/.config/opencode/opencode.json` / Win `%APPDATA%\opencode\opencode.json`。
 *
 * 复杂嵌套字段（provider / agent / mcp / formatter）先浅声明，UnknownField 兜底；
 * 后续 PR 按需深化。
 */

const NESTED_OBJ: FieldSchema = {
  type: "object",
  additionalProperties: true,
};

export const OPENCODE_CONFIG: ToolSchema = {
  $id: "opencode-config@1",
  $source: "https://opencode.ai/docs/config/",
  fetchedAt: "2026-05-06",
  scopeKind: "opencode-config",
  rootSchema: {
    type: "object",
    description: "OpenCode 主配置文件。",
    additionalProperties: true,
    properties: {
      // source: upstream `$schema` JSON Schema URL
      $schema: {
        type: "url",
        description: "JSON Schema URL（提供编辑器自动补全和校验）。",
      },
      // source: upstream `model` is string (provider/model-id)
      model: {
        type: "string",
        description: "默认主模型。格式 `provider/model-id`，例如 `anthropic/claude-opus-4-7`。",
        examples: ["anthropic/claude-opus-4-7", "openai/gpt-5"],
      },
      // source: upstream `small_model` is string
      small_model: {
        type: "string",
        description: "轻量级任务模型（用于 plan / 简单回答）。",
      },
      // source: upstream `share` enum: manual/auto/disabled
      share: {
        type: "enum",
        description: "会话分享模式。",
        enum: [
          { value: "manual", label: "Manual", description: "手动触发分享" },
          { value: "auto", label: "Auto", description: "自动分享每次会话" },
          { value: "disabled", label: "Disabled" },
        ],
        enumStyle: "radio",
      },
      // source: upstream `snapshot` is boolean
      snapshot: {
        type: "boolean",
        description: "启用基于内部 git 的变更追踪。",
      },
      // source: upstream `autoupdate` is boolean
      autoupdate: {
        type: "boolean",
        description: "自动更新行为。",
      },
      // source: upstream `default_agent` is string
      default_agent: {
        type: "string",
        description: "未指定时使用的默认 Agent。",
      },

      // ─── 复杂嵌套（先浅声明，PR-H/I 按需深化） ───
      provider: {
        type: "object",
        description: "模型提供商配置。子字段：whitelist / options（apiKey/baseURL）/ models / npm / env。",
        additionalProperties: true,
      },
      agent: {
        type: "object",
        description: "自定义 Agent 定义（description / model / prompt / tools）。",
        additionalProperties: true,
      },
      tools: {
        type: "object",
        description: "启用 / 禁用特定工具（write / bash 等）。",
        additionalProperties: true,
      },
      command: {
        type: "object",
        description: "自定义命令模板。",
        additionalProperties: true,
      },
      formatter: NESTED_OBJ,
      permission: {
        type: "object",
        description: "工具调用权限审批规则。",
        additionalProperties: true,
      },
      server: NESTED_OBJ,
      mcp: {
        type: "object",
        description: "Model Context Protocol 服务器连接。",
        additionalProperties: true,
      },
      compaction: {
        type: "object",
        description: "上下文窗口管理和自动压缩。",
        additionalProperties: true,
      },
      watcher: NESTED_OBJ,
      experimental: {
        type: "object",
        description: "实验性功能开关。",
        additionalProperties: true,
      },

      // ─── 数组类 ───
      // source: upstream `plugin` is array of npm package id
      plugin: {
        type: "array",
        description: "npm 插件标识符列表。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },
      // source: upstream `instructions` is array of glob path
      instructions: {
        type: "array",
        description: "指令文件路径模式（glob）。",
        itemSchema: { type: "string" },
      },
      // source: upstream `disabled_providers` is array of string
      disabled_providers: {
        type: "array",
        description: "禁用的 Provider 列表。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },
      // source: upstream `enabled_providers` is array of string
      enabled_providers: {
        type: "array",
        description: "启用的 Provider 白名单。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },
    },
  },
};
