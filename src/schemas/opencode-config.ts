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

      // ─── 复杂嵌套（KV-map：key 为标识符，value 为配置 object 浅声明） ───
      // 这些字段上游都是「key 任意标识 → 配置 object」结构，用 kv-map 而非 object。
      // 否则 ObjectField 把每个 key 当 unknown 渲染，UI 会塞一堆橙色 UNKNOWN badge。
      provider: {
        type: "kv-map",
        description: "模型提供商配置。key 为 provider id（如 `anthropic` / `openai` / `azure`），value 为该 provider 的配置（whitelist / options.apiKey / options.baseURL / models / npm / env）。",
        keyHint: "provider id（任意标识）",
        valueSchema: {
          type: "object",
          description: "Provider 配置 object（whitelist / options / models / npm / env）。",
          additionalProperties: true,
        },
      },
      agent: {
        type: "kv-map",
        description: "自定义 Agent 定义。key 为 agent name，value 为 agent 定义（description / model / prompt / tools）。",
        keyHint: "agent name",
        valueSchema: {
          type: "object",
          description: "Agent 定义 object（description / model / prompt / tools）。",
          additionalProperties: true,
        },
      },
      tools: {
        type: "kv-map",
        description: "启用 / 禁用特定工具。key 为 tool name（write / bash / read 等），value 为 boolean。",
        keyHint: "tool name",
        valueSchema: { type: "boolean" },
      },
      command: {
        type: "kv-map",
        description: "自定义命令模板。key 为 command name，value 为命令定义 object。",
        keyHint: "command name",
        valueSchema: {
          type: "object",
          description: "命令定义 object。",
          additionalProperties: true,
        },
      },
      formatter: NESTED_OBJ,
      permission: {
        type: "object",
        description: "工具调用权限审批规则。",
        additionalProperties: true,
      },
      server: NESTED_OBJ,
      mcp: {
        type: "kv-map",
        description: "Model Context Protocol 服务器连接。key 为 server name，value 为 transport 配置（stdio / SSE / HTTP）。",
        keyHint: "MCP server name",
        valueSchema: {
          type: "object",
          description: "MCP server 配置 object（command / args / env / type / url 等，按 transport 类型不同）。",
          additionalProperties: true,
        },
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

      // ─── 补齐 opencode.ai/config.json 常见字段（CHANGELOG_8 后续） ───
      // source: upstream `lsp` (object | false) — LSP 服务器配置
      lsp: {
        type: "object",
        description: "LSP（Language Server Protocol）服务器配置。设为 false 可禁用全部 LSP。",
        additionalProperties: true,
      },
      // source: upstream `tool_output` (object) — 工具输出截断阈值
      tool_output: {
        type: "object",
        description: "工具输出截断阈值（避免单工具输出爆掉 context window）。",
        additionalProperties: true,
      },
      // source: upstream `logLevel` enum: DEBUG / INFO / WARN / ERROR
      logLevel: {
        type: "enum",
        description: "日志级别。",
        enum: [
          { value: "DEBUG", label: "DEBUG", description: "最详细（含每次 prompt）" },
          { value: "INFO", label: "INFO" },
          { value: "WARN", label: "WARN" },
          { value: "ERROR", label: "ERROR", description: "最少（仅错误）" },
        ],
        enumStyle: "radio",
      },
      // source: upstream `shell` string (default shell for terminal/bash tool)
      shell: {
        type: "path",
        description: "终端 / bash 工具默认 shell 路径（如 `/bin/zsh`）。",
        pathKind: "file",
        expandHome: true,
      },
      // source: upstream `username` string (custom display name in conversations)
      username: {
        type: "string",
        description: "对话中显示的自定义用户名（覆盖系统用户名）。",
      },
    },
  },
};
