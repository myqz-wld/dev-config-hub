import type { ToolSchema, FieldSchema } from "./types.ts";

/**
 * `~/.dch/profiles.json` schema（PR-I）。
 *
 * **字段来源**：项目自维护，SSOT 在 `src/profiles/types.ts`：
 *   - ToolKind = "claude" | "codex" | "grok" | "cursor"
 *   - Profile / ProfileHooks / HookScript / Preferences / ProfileStore
 *
 * **HookScript union 简化**：HookScript 是 `string | { posix?, powershell?, cmd? }` union 类型。
 * FieldSchema 不直接表达 union；本 schema 把 hooks.preSwitch / postSwitch 标 `type: "code"`
 * (codeLanguage="shell")，让 schema-driven UI 用 CMEditor + shell 高亮编辑 string 形式。
 * 用户要写 object 形式（跨平台 hook）需走 raw editor 直接编 JSON —— UI scope 取舍。
 *
 * **关键不变量**：rootSchema.additionalProperties = true（与所有 schema 一致）。
 */

const HOOK_SCRIPT_FIELD: FieldSchema = {
  type: "code",
  description: "Shell 脚本（POSIX bash/zsh）。Win 平台同字符串走 PowerShell。要分平台请走 raw editor 编辑成 object 形式 `{ posix?, powershell?, cmd? }`。",
  codeLanguage: "shell",
};

const PROFILE_FIELD: FieldSchema = {
  type: "object",
  description: "单个 Profile 配置。",
  additionalProperties: true,
  properties: {
    id: {
      type: "string",
      description: "Profile 唯一标识。例如 `claude-api` / `codex-plus`。",
      // REVIEW_4 H2：与 src/profiles/manager.ts ID_RE = /^[a-zA-Z0-9_-]+$/ 对齐
      // 之前误用 `^[a-zA-Z][...]` 字母必开头会让 CLI 写入的数字开头 id 在 schema lint 报错
      pattern: "^[a-zA-Z0-9_-]+$",
      patternHint: "字母 / 数字 / _ / -（与 CLI manager.ts ID_RE 同源）",
    },
    tool: {
      type: "enum",
      description: "对应工具。",
      enum: [
        { value: "claude", label: "Claude Code" },
        { value: "codex", label: "Codex CLI" },
        { value: "grok", label: "Grok" },
        { value: "cursor", label: "Cursor" },
      ],
      enumStyle: "radio",
    },
    configDir: {
      type: "path",
      description: "配置目录绝对路径（可含 `~/` 前缀）。例如 `~/.claude-api`。",
      pathKind: "directory",
      expandHome: true,
    },
    env: {
      type: "kv-map",
      description: "环境变量。preSwitch / postSwitch hook 内可见，也可通过 `dch profile env` 注入工具进程。",
      // REVIEW_4 R_2 L4：与 src/profiles/manager.ts ENV_KEY_RE 同源（混合大小写）
      // **注意**：与 claude-settings.env 大写专用 `^[A-Z_][A-Z0-9_]*$` 不同 —— 那是上游 Claude Code 惯例约束；
      // 本字段是 dch profile.env，由 manager.ts 控制，允许混合大小写（兼容 `http_proxy` 等小写常量）
      keyPattern: "^[A-Za-z_][A-Za-z0-9_]*$",
      keyHint: "字母 / 下划线开头 + 字母 / 数字 / _（与 manager.ts ENV_KEY_RE 同源；profile.env 比 claude env 更宽松）",
      valueSchema: { type: "string", sensitive: false },
    },
    description: {
      type: "string",
      description: "人类可读说明。",
    },
    hooks: {
      type: "object",
      description: "切换前 / 后 hook 脚本。",
      additionalProperties: true,
      properties: {
        preSwitch: HOOK_SCRIPT_FIELD,
        postSwitch: HOOK_SCRIPT_FIELD,
      },
    },
    isDefault: {
      type: "boolean",
      description: "是否为 default profile（init 时建）。同 tool 内只能有一个 default。",
    },
  },
};

export const DCH_STORE: ToolSchema = {
  $id: "dch-store@1",
  $source: "self-maintained: src/profiles/types.ts (ProfileStore)",
  fetchedAt: "2026-05-06",
  scopeKind: "dch-store",
  rootSchema: {
    type: "object",
    description: "Dev Config Hub 状态文件 (`~/.dch/profiles.json`)。",
    additionalProperties: true,
    properties: {
      version: {
        type: "integer",
        description: "Schema 版本号（当前固定为 1）。",
        min: 1,
        max: 1,
      },
      profiles: {
        type: "array",
        description: "所有已注册的 profile 列表。",
        itemSchema: PROFILE_FIELD,
      },
      active: {
        type: "object",
        description: "每个工具当前激活的 profile id（null = 未设置）。",
        additionalProperties: true,
        properties: {
          claude: {
            type: "string",
            description: "当前激活的 claude profile id。",
          },
          codex: {
            type: "string",
            description: "当前激活的 codex profile id。",
          },
          grok: {
            type: "string",
            description: "当前激活的 grok profile id。",
          },
          cursor: {
            type: "string",
            description: "当前激活的 cursor profile id。",
          },
        },
      },
      preferences: {
        type: "object",
        description: "全局偏好。",
        additionalProperties: true,
        properties: {
          hookTimeoutMs: {
            type: "integer",
            description: "Hook 脚本超时时间（毫秒）。超过则 SIGTERM kill。",
            min: 1000,
            max: 600000,
            unit: "ms",
            default: 30000,
          },
        },
      },
    },
  },
};
