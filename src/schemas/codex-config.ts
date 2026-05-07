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
      // source: upstream `personality` (Codex CLI 新增) — 调整 Codex 系统 prompt 风格
      // 当前 enum 值是社区观察的常见取值；不确定全集，用 enumOpen 让用户填自定义也合法
      personality: {
        type: "enum",
        description: "Codex 系统 prompt 风格预设（影响回答语气 / 详尽度 / 主动性等）。",
        enum: [
          { value: "pragmatic", label: "Pragmatic", description: "务实、直接给方案" },
          { value: "concise", label: "Concise", description: "极简、最少话" },
          { value: "friendly", label: "Friendly", description: "友好、解释更详细" },
          { value: "formal", label: "Formal", description: "正式、商务化措辞" },
        ],
        enumStyle: "select",
        enumOpen: true,
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
      // source: upstream `web_search` enum: disabled/cached/live （已迁移到下方常见字段补全节）

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
        type: "kv-map",
        description: "MCP 服务器配置。key 为 server name，value 为 transport 配置 object。**注意**：此字段常用 inline-table 写，patch 会触发 fallback（重新序列化丢注释）。",
        keyHint: "MCP server name",
        valueSchema: {
          type: "object",
          description: "MCP server 配置 object（command / args / env / type / url 等）。",
          additionalProperties: true,
        },
      },
      agents: AGENTS_FIELD,
      tui: NESTED_OBJ,
      history: NESTED_OBJ,
      memories: NESTED_OBJ,
      permissions: NESTED_OBJ,
      otel: NESTED_OBJ,

      // ─── 补齐 codex-rs/core/config.schema.json 常见字段（CHANGELOG_8 后续） ───
      // source: upstream `notify` array of string (external command for end-user notification)
      notify: {
        type: "array",
        description: "外部通知命令（每项是命令 + 参数串），任务完成时触发。",
        itemSchema: { type: "string" },
      },
      // source: upstream `instructions` string (system instructions)
      instructions: {
        type: "string",
        description: "系统级 instructions（追加到 default system prompt）。",
        multiline: true,
      },
      // source: upstream `developer_instructions` string
      developer_instructions: {
        type: "string",
        description: "Developer 角色 instructions（仅开发者上下文场景使用）。",
        multiline: true,
      },
      // source: upstream `chatgpt_base_url` string
      chatgpt_base_url: {
        type: "url",
        description: "ChatGPT API 请求 base URL（区别于 `openai_base_url`）。",
      },
      // source: upstream `openai_base_url` string
      openai_base_url: {
        type: "url",
        description: "OpenAI API 请求 base URL（覆盖内置 `openai` provider）。",
      },
      // source: upstream `oss_provider` string (e.g. "lmstudio" / "ollama")
      oss_provider: {
        type: "enum",
        description: "本地 OSS 模型提供商。",
        enum: [
          { value: "lmstudio", label: "LM Studio" },
          { value: "ollama", label: "Ollama" },
        ],
        enumStyle: "select",
        enumOpen: true,
      },
      // source: upstream `commit_attribution` string (e.g. "Codex <noreply@openai.com>")
      commit_attribution: {
        type: "string",
        description: "Codex 生成的 commit message 归属署名（co-authored-by 行）。",
      },
      // source: upstream `default_permissions` string (permissions profile name)
      default_permissions: {
        type: "string",
        description: "默认应用的 permissions profile 名（对应 `permissions` 表的 key）。",
      },
      // source: upstream `service_tier` string (e.g. "auto" / "flex")
      service_tier: {
        type: "enum",
        description: "OpenAI API service tier 偏好（影响成本 / 速度 / 可用性）。",
        enum: [
          { value: "auto", label: "Auto", description: "自动选择" },
          { value: "default", label: "Default" },
          { value: "flex", label: "Flex", description: "弹性（更便宜，可能更慢）" },
          { value: "scale", label: "Scale", description: "Scale tier" },
        ],
        enumStyle: "select",
        enumOpen: true,
      },
      // source: upstream `review_model` string (override model for /review)
      review_model: {
        type: "string",
        description: "`/review` 功能使用的模型 ID（覆盖默认 model）。",
      },
      // source: upstream `tool_output_token_limit` integer
      tool_output_token_limit: {
        type: "integer",
        description: "工具 / 函数输出存储到 thread store 时的 Token 预算（避免单工具输出爆炸）。",
        min: 256,
        unit: "tokens",
      },

      // ─── 行为开关 ───
      // source: upstream `allow_login_shell` boolean
      allow_login_shell: {
        type: "boolean",
        description: "允许模型为 shell-based 工具请求登录式 shell。",
      },
      // source: upstream `check_for_update_on_startup` boolean
      check_for_update_on_startup: {
        type: "boolean",
        description: "启动时检查 Codex 更新。",
      },
      // source: upstream `hide_agent_reasoning` boolean
      hide_agent_reasoning: {
        type: "boolean",
        description: "隐藏 AgentReasoning 事件（清爽输出）。",
      },
      // source: upstream `show_raw_agent_reasoning` boolean
      show_raw_agent_reasoning: {
        type: "boolean",
        description: "显示原始 AgentReasoningRawContent 事件（调试用）。",
      },
      // source: upstream `disable_paste_burst` boolean
      disable_paste_burst: {
        type: "boolean",
        description: "禁用快速粘贴检测（输入处理）。",
      },
      // source: upstream `model_supports_reasoning_summaries` boolean
      model_supports_reasoning_summaries: {
        type: "boolean",
        description: "强制启用 reasoning summaries（即使模型未声明支持）。",
      },
      // source: upstream `include_apps_instructions` boolean
      include_apps_instructions: {
        type: "boolean",
        description: "注入 `<apps_instructions>` developer block。",
      },
      // source: upstream `include_environment_context` boolean
      include_environment_context: {
        type: "boolean",
        description: "注入 `<environment_context>` user block。",
      },
      // source: upstream `include_permissions_instructions` boolean
      include_permissions_instructions: {
        type: "boolean",
        description: "注入 `<permissions_instructions>` developer block。",
      },

      // ─── KV map 类（user-level 集合） ───
      // source: upstream `marketplaces` object (user-level marketplace entries by name)
      marketplaces: {
        type: "kv-map",
        description: "用户级 marketplace 注册表。key 为 marketplace 名。",
        keyHint: "marketplace 名",
        valueSchema: {
          type: "object",
          additionalProperties: true,
        },
      },
      // source: upstream `plugins` object (user-level plugin config by name)
      plugins: {
        type: "kv-map",
        description: "用户级 plugin 配置。key 为 plugin 名。",
        keyHint: "plugin 名",
        valueSchema: {
          type: "object",
          additionalProperties: true,
        },
      },
      // source: upstream `skills` object (user-level skill config by SKILL.md path)
      skills: {
        type: "kv-map",
        description: "用户级 skill 配置。key 为 SKILL.md 路径。",
        keyHint: "SKILL.md 路径",
        valueSchema: {
          type: "object",
          additionalProperties: true,
        },
      },

      // source: upstream `tools` (object) — feature toggles for built-in tools
      tools: NESTED_OBJ,
      // source: upstream `web_search` enum: disabled / cached / live
      web_search: {
        type: "enum",
        description: "Web search 工具模式。",
        enum: [
          { value: "disabled", label: "Disabled", description: "禁用" },
          { value: "cached", label: "Cached", description: "缓存模式" },
          { value: "live", label: "Live", description: "实时（成本最高）" },
        ],
        enumStyle: "radio",
      },
    },
  },
};
