import type { ToolSchema, FieldSchema } from "./types.ts";

/**
 * Codex CLI config.toml schema（PR-E）。
 *
 * **字段来源**：上游 config-reference 文档（https://developers.openai.com/codex/config-reference）。
 * Codex 不提供公开 JSON Schema —— 字段语义按官方文档手工翻译，每条带 `// source:` 注释。
 * 上游漂移走 `bun src/schemas/sync.ts`（PR-J 完整化时可以从 docs 抓 enum / default）。
 *
 * **关键不变量**：rootSchema.additionalProperties = true，未知 key 永不丢失。
 *
 * **复杂嵌套字段**（mcp_servers / model_providers / projects / profiles）先浅声明
 * type=object additionalProperties=true，让 UnknownField 按 typeof 渲染子字段（用户仍可编辑）。
 * 后续 PR 按需深化（每个嵌套展开成深度 schema 是大工程，这里先保「能编辑 + 不丢字段」）。
 */

// ─── object：agents 多 Agent 控制 ───
const AGENTS_FIELD: FieldSchema = {
  type: "object",
  description: "多 Agent 并发和嵌套控制。",
  properties: {
    // source: upstream agents.max_threads default 6
    max_threads: {
      type: "integer",
      description: "最大并发 Agent 线程数。",
      min: 1,
      max: 64,
      default: 6,
    },
    // source: upstream agents.max_depth default 1
    max_depth: {
      type: "integer",
      description: "Agent 嵌套深度。",
      min: 1,
      max: 10,
      default: 1,
    },
  },
  additionalProperties: true,
};

const NESTED_OBJ: FieldSchema = {
  type: "object",
  additionalProperties: true,
};

export const CODEX_CONFIG: ToolSchema = {
  $id: "codex-config@1",
  $source: "https://developers.openai.com/codex/config-reference",
  fetchedAt: "2026-05-06",
  scopeKind: "codex-config",
  rootSchema: {
    type: "object",
    description: "Codex CLI 全局配置文件（TOML）。",
    additionalProperties: true,
    properties: {
      // ─── 模型 / 推理 ───
      // source: upstream `model` is string (model id)
      model: {
        type: "string",
        description: "默认使用的 AI 模型 ID。",
        examples: ["gpt-5", "gpt-5-thinking-min", "claude-opus-4-7"],
      },
      // source: upstream `model_provider` is string
      model_provider: {
        type: "string",
        description: "模型提供商 ID（对应 model_providers 中的 key）。",
      },
      // source: upstream `model_reasoning_effort` enum: minimal/low/medium/high/xhigh
      model_reasoning_effort: {
        type: "enum",
        description: "推理努力程度。",
        enum: [
          { value: "minimal", label: "Minimal", description: "最快，推理深度最浅" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium", description: "默认平衡档" },
          { value: "high", label: "High", description: "深度推理" },
          { value: "xhigh", label: "Extra High", description: "最深推理（高 token 消耗）" },
        ],
        enumStyle: "select",
      },
      // source: upstream `model_context_window` integer
      model_context_window: {
        type: "integer",
        description: "可用上下文窗口 Token 数（默认按模型决定）。",
        min: 1024,
        unit: "tokens",
      },
      // source: upstream `model_verbosity` enum: low/medium/high
      model_verbosity: {
        type: "enum",
        description: "输出详细程度。",
        enum: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        enumStyle: "radio",
      },
      // source: upstream `model_auto_compact_token_limit` integer
      model_auto_compact_token_limit: {
        type: "integer",
        description: "自动压缩上下文的 Token 阈值。",
        min: 1024,
        unit: "tokens",
      },
      // source: upstream `model_instructions_file` is string (path)
      model_instructions_file: {
        type: "path",
        description: "自定义指令文件路径（覆盖默认 system prompt）。",
        pathKind: "file",
        expandHome: true,
      },

      // ─── 沙箱 / 审批 ───
      // source: upstream `sandbox_mode` enum: read-only/workspace-write/danger-full-access
      sandbox_mode: {
        type: "enum",
        description: "沙箱模式（约束 Codex 文件系统访问范围）。",
        enum: [
          { value: "read-only", label: "Read-only", description: "只读" },
          { value: "workspace-write", label: "Workspace write", description: "仅当前工作区可写" },
          { value: "danger-full-access", label: "Danger full access", description: "完全访问（危险）" },
        ],
        enumStyle: "select",
      },
      // source: upstream `approval_policy` enum: untrusted/on-request/never
      approval_policy: {
        type: "enum",
        description: "审批策略（每次 Codex 操作前是否需用户确认）。",
        enum: [
          { value: "untrusted", label: "Untrusted", description: "默认不信任，每次询问" },
          { value: "on-request", label: "On request", description: "仅 Codex 请求时询问" },
          { value: "never", label: "Never", description: "从不询问（危险）" },
        ],
        enumStyle: "select",
      },
      // source: upstream `approvals_reviewer` enum: user/guardian_subagent
      approvals_reviewer: {
        type: "enum",
        description: "审批路由（谁来审批 Codex 操作）。",
        enum: [
          { value: "user", label: "User", description: "用户本人审批" },
          { value: "guardian_subagent", label: "Guardian subagent", description: "由专用 subagent 守门" },
        ],
        enumStyle: "radio",
      },
      // source: upstream `web_search` enum: disabled/cached/live
      web_search: {
        type: "enum",
        description: "Web 搜索能力。",
        enum: [
          { value: "disabled", label: "Disabled" },
          { value: "cached", label: "Cached", description: "仅查 cache" },
          { value: "live", label: "Live", description: "实时网络查询" },
        ],
        enumStyle: "radio",
      },

      // ─── 复杂嵌套（先浅声明，UnknownField 兜底） ───
      model_providers: {
        type: "object",
        description: "自定义模型提供商配置。子字段为 provider name → { name / base_url / wire_api / ... }。",
        additionalProperties: true,
      },
      profiles: {
        type: "object",
        description: "命名配置集，通过 `--profile` 切换。",
        additionalProperties: true,
      },
      projects: {
        type: "object",
        description: "项目级信任设置（key 为 project 路径，value 含 trust_level 等）。",
        additionalProperties: true,
      },
      features: {
        type: "object",
        description: "功能开关（shell_tool / multi_agent / web_search / memories 等）。",
        additionalProperties: true,
      },
      mcp_servers: {
        type: "object",
        description: "MCP 服务器配置。**注意**：此字段常用 inline-table 写，patch 会触发 fallback（重新序列化丢注释）。",
        additionalProperties: true,
      },
      agents: AGENTS_FIELD,
      tui: NESTED_OBJ,
      history: NESTED_OBJ,
      memories: NESTED_OBJ,
      permissions: NESTED_OBJ,
      otel: NESTED_OBJ,
    },
  },
};
