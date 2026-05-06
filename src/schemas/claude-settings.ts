import type { ToolSchema, FieldSchema } from "./types.ts";

/**
 * Claude Code 用户级配置 schema（PR-D 扩到 30+ 字段）。
 *
 * **字段来源铁律**（CLAUDE.md「配置描述来源」）：
 * 上游 JSON Schema：https://www.schemastore.org/claude-code-settings.json
 * 每个字段必须带 `// source:` 注释绑约束（enum / default / range / type）。**严禁揣测**。
 * 上游 schema 漂移时跑 `bun src/schemas/sync.ts` 拉 diff 后人工对照修改。
 *
 * **关键不变量**：rootSchema.additionalProperties = true。
 * 配合 PR-B 的 patchJson 字段级 patch，schema 不认识的用户自定义 key 永不丢失。
 *
 * **嵌套深度策略**：复杂嵌套字段（hooks / sandbox / statusLine）先声明 type=object 不深入
 * properties，让 UnknownField 按 typeof 渲染子字段（用户仍可编辑）；后续 PR 按需深化。
 */

// ─── kv-map：env 环境变量 ───
const ENV_FIELD: FieldSchema = {
  type: "kv-map",
  description: "环境变量。key 必须匹配 `^[A-Z_][A-Z0-9_]*$`（大写字母/数字/下划线）。",
  // source: upstream env keys 模式（descriptions.ts:3）
  keyPattern: "^[A-Z_][A-Z0-9_]*$",
  keyHint: "大写字母 / 数字 / 下划线",
  valueSchema: { type: "string" },
};

// ─── object：permissions 嵌套 ───
const PERMISSIONS_FIELD: FieldSchema = {
  type: "object",
  description: "工具执行权限控制。",
  properties: {
    // source: upstream permissions.allow array of string rules
    allow: {
      type: "array",
      description: "允许自动执行的操作规则列表。",
      itemSchema: { type: "string" },
      uniqueItems: true,
    },
    deny: {
      type: "array",
      description: "禁止执行的操作规则列表。",
      itemSchema: { type: "string" },
      uniqueItems: true,
    },
    ask: {
      type: "array",
      description: "每次需要用户确认的操作规则列表。",
      itemSchema: { type: "string" },
      uniqueItems: true,
    },
    // source: upstream defaultMode enum 7 项（REVIEW_4 H1'：补齐 bypassPermissions / default / auto 三个之前漏的）
    defaultMode: {
      type: "enum",
      description: "默认权限模式。",
      enum: [
        { value: "default", label: "Default", description: "标准询问行为（上游默认）" },
        { value: "acceptEdits", label: "Accept edits", description: "默认接受所有编辑" },
        { value: "plan", label: "Plan", description: "先出 plan 由用户确认" },
        { value: "delegate", label: "Delegate", description: "委托给 subagent" },
        { value: "dontAsk", label: "Don't ask", description: "完全不询问（危险）" },
        { value: "bypassPermissions", label: "Bypass permissions", description: "绕过所有权限检查（最危险）" },
        { value: "auto", label: "Auto", description: "自动模式" },
      ],
      enumStyle: "select",
    },
    // source: upstream permissions.disableBypassPermissionsMode is boolean
    disableBypassPermissionsMode: {
      type: "boolean",
      description: "禁止绕过权限提示。",
    },
    // source: upstream permissions.additionalDirectories is array of paths
    additionalDirectories: {
      type: "array",
      description: "纳入权限范围的额外目录。",
      itemSchema: { type: "path", pathKind: "directory", expandHome: true },
    },
  },
  additionalProperties: true,
};

// ─── object：插件相关（嵌套深，先浅声明）───
const PLUGINS_OBJ: FieldSchema = {
  type: "object",
  additionalProperties: true,
};

export const CLAUDE_SETTINGS: ToolSchema = {
  $id: "claude-settings@1",
  $source: "https://www.schemastore.org/claude-code-settings.json",
  fetchedAt: "2026-05-06",
  scopeKind: "claude-settings",
  rootSchema: {
    type: "object",
    description: "Claude Code 用户级配置文件。",
    additionalProperties: true,
    properties: {
      // ─── 模型 / 推理 ───
      // source: upstream `model` is `string` (用户自定义模型 ID)
      model: {
        type: "string",
        description: "覆盖默认使用的模型。例如 `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`。",
        examples: ["claude-opus-4-7", "claude-sonnet-4-6"],
      },
      // source: upstream `availableModels` is array of string
      availableModels: {
        type: "array",
        description: "限制用户可选择的模型列表（空 = 不限制）。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },
      // source: upstream `modelOverrides` is object (Anthropic 模型 ID → Provider 特定 ID)
      modelOverrides: {
        type: "kv-map",
        description: "把 Anthropic 模型 ID 映射到 Provider 特定 ID。",
        valueSchema: { type: "string" },
      },
      // source: upstream `effortLevel` enum: [low, medium, high, xhigh, max]
      effortLevel: {
        type: "enum",
        description: "Opus 4.7+ 自适应推理深度（与 fastMode 互斥：fastMode 仅 Opus 4.6 / effortLevel 仅 Opus 4.7+）。",
        enum: [
          { value: "low", label: "Low", description: "最省 token，快速响应" },
          { value: "medium", label: "Medium", description: "默认平衡档" },
          { value: "high", label: "High", description: "深度推理" },
          { value: "xhigh", label: "Extra High", description: "更深推理（高 token 消耗）" },
          { value: "max", label: "Max", description: "最深推理（最高 token 消耗）" },
        ],
        enumStyle: "select",
      },
      // source: upstream `fastMode` is boolean
      fastMode: {
        type: "boolean",
        description: "启用 Opus 4.6 快速模式（仅 Opus 4.6 可用）。",
      },

      // ─── 权限 / env ───
      env: ENV_FIELD,
      permissions: PERMISSIONS_FIELD,

      // ─── 插件 ───
      // source: upstream `enabledPlugins` is array of string (pluginName@marketplace)
      enabledPlugins: {
        type: "array",
        description: "已启用的插件，格式为 `pluginName@marketplace`。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },
      // source: upstream `extraKnownMarketplaces` is object map
      extraKnownMarketplaces: PLUGINS_OBJ,
      // source: upstream `pluginConfigs` is object map (各插件运行时配置)
      pluginConfigs: PLUGINS_OBJ,

      // ─── hooks / 沙箱 / 状态栏（复杂嵌套先浅声明） ───
      // source: upstream `hooks` is object (PreToolUse / PostToolUse / Stop / ... 嵌套数组结构)
      hooks: {
        type: "object",
        description: "自定义命令钩子（PreToolUse / PostToolUse / Stop 等）。子字段嵌套较深，建议直接编辑 raw JSON。",
        additionalProperties: true,
      },
      // source: upstream `statusLine` is object
      statusLine: {
        type: "object",
        description: "自定义状态栏显示命令。",
        additionalProperties: true,
      },
      // source: upstream `sandbox` is object
      sandbox: {
        type: "object",
        description: "沙箱执行配置。",
        additionalProperties: true,
      },
      // source: upstream `attribution` is object
      attribution: {
        type: "object",
        description: "Git 归属信息配置。",
        additionalProperties: true,
      },
      // source: upstream `worktree` is object
      worktree: {
        type: "object",
        description: "Git worktree 配置。",
        additionalProperties: true,
      },

      // ─── 行为开关 ───
      // source: upstream `language` is string (preferred response language)
      language: {
        type: "string",
        description: "Claude 响应的首选语言。例如 `中文` / `English`。",
      },
      // source: upstream `autoMemoryEnabled` is boolean, default: true
      autoMemoryEnabled: {
        type: "boolean",
        description: "启用自动记忆保存到 `.claude/memory/`。",
        default: true,
      },
      // source: upstream `autoUpdatesChannel` enum: [stable, latest]
      autoUpdatesChannel: {
        type: "enum",
        description: "更新频道。",
        enum: [
          { value: "stable", label: "Stable" },
          { value: "latest", label: "Latest" },
        ],
        enumStyle: "radio",
      },
      // source: upstream `cleanupPeriodDays` integer minimum: 1
      cleanupPeriodDays: {
        type: "integer",
        description: "聊天记录保留天数。",
        min: 1,
        unit: "days",
      },
      // source: upstream `includeGitInstructions` is boolean
      includeGitInstructions: {
        type: "boolean",
        description: "包含内置 git commit 和 PR 工作流指令。",
      },
      // source: upstream `respectGitignore` is boolean
      respectGitignore: {
        type: "boolean",
        description: "@ 文件选择器是否遵循 .gitignore。",
      },
      // source: upstream `outputStyle` is string
      outputStyle: {
        type: "string",
        description: "助手响应的输出风格（engineer / casual / 自定义模板等）。",
      },

      // ─── 路径类 ───
      // source: upstream `plansDirectory` is string (path)
      plansDirectory: {
        type: "path",
        description: "Plan 文件存储目录。",
        pathKind: "directory",
        expandHome: true,
      },
      // source: upstream `apiKeyHelper` is string (script path)
      apiKeyHelper: {
        type: "path",
        description: "输出 API Key 值的脚本路径（用于动态获取 API Key）。",
        pathKind: "file",
        expandHome: true,
        sensitive: true,
      },
      // source: upstream `claudeMdExcludes` is array of glob patterns
      claudeMdExcludes: {
        type: "array",
        description: "排除加载的 CLAUDE.md glob 模式。",
        itemSchema: { type: "string" },
        uniqueItems: true,
      },

      // ─── 团队模式 ───
      // source: upstream `teammateMode` enum: [auto, in-process, tmux]
      teammateMode: {
        type: "enum",
        description: "Agent 团队模式。",
        enum: [
          { value: "auto", label: "Auto", description: "自动选择" },
          { value: "in-process", label: "In-process", description: "进程内 spawn（轻量）" },
          { value: "tmux", label: "tmux", description: "tmux 多窗格（独立可见）" },
        ],
        enumStyle: "radio",
      },
    },
  },
};
