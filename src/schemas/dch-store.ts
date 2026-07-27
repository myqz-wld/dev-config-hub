import type { ToolSchema, FieldSchema } from "./types.ts";

/**
 * `~/.dch/profiles.json` schema（PR-I）。
 *
 * **字段来源**：项目自维护，SSOT 在 `src/profiles/types.ts`：
 *   - ToolKind = "claude" | "codex" | "grok" | "cursor"
 *   - Profile / ProfileHooks / HookScript / BackupPolicyV1 / ProfileStore
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

const MATCH_FIELD: FieldSchema = {
  type: "object",
  description: "规则匹配器。表格编辑器负责按规则类型限制 kind；原始编辑模式保存时还会做完整校验。",
  additionalProperties: true,
  properties: {
    kind: {
      type: "enum",
      enum: ["glob", "regex", "exact", "contains", "suffix", "key-value"],
    },
    pattern: { type: "string" },
    keyPattern: { type: "string" },
    minValueLength: { type: "integer", min: 1 },
    caseSensitive: { type: "boolean", default: false },
    secretCaptureGroup: { type: "integer", min: 0 },
  },
};

const FILE_RULE_FIELD: FieldSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    target: { type: "enum", enum: ["relative-path", "basename"] },
    match: MATCH_FIELD,
    action: { type: "enum", enum: ["include", "exclude"] },
  },
};

const SECRET_RULE_FIELD: FieldSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    target: { type: "enum", enum: ["relative-path", "basename"] },
    formats: {
      type: "array",
      uniqueItems: true,
      itemSchema: { type: "enum", enum: ["json", "jsonc", "toml", "text"] },
    },
    match: MATCH_FIELD,
    action: {
      type: "enum",
      enum: [
        { value: "placeholder", label: "替换为占位符" },
        { value: "exclude-file", label: "排除整个文件" },
        { value: "keep-original", label: "保留原值（危险）" },
        { value: "ignore", label: "忽略命中" },
      ],
    },
    placeholderName: { type: "string" },
  },
};

const BACKUP_POLICY_FIELD: FieldSchema = {
  type: "object",
  description: "有序备份规则。文件规则第一条命中即停止；密钥规则按整文件、字段、内容处理。",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", min: 1, max: 1 },
    defaultFileAction: { type: "enum", enum: ["include", "exclude"] },
    unscannableFileAction: {
      type: "enum",
      enum: ["include-with-warning", "exclude"],
    },
    fileRules: {
      type: "array",
      description: "可排序的包含/排除规则。",
      itemSchema: FILE_RULE_FIELD,
    },
    secretRules: {
      type: "object",
      additionalProperties: false,
      properties: {
        wholeFile: { type: "array", itemSchema: SECRET_RULE_FIELD },
        field: { type: "array", itemSchema: SECRET_RULE_FIELD },
        content: { type: "array", itemSchema: SECRET_RULE_FIELD },
      },
    },
  },
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
    hookTimeoutMs: {
      type: "integer",
      description: "本方案切换脚本超时时间（毫秒）。旧全局 preferences.hookTimeoutMs 不会迁移。",
      min: 1000,
      max: 600000,
      unit: "ms",
      default: 30000,
    },
    backupPolicy: {
      ...BACKUP_POLICY_FIELD,
      description: "方案级独立规则快照。缺少该字段表示实时继承当前有效工具规则。",
    },
    isDefault: {
      type: "boolean",
      description: "是否为 default profile（init 时建）。同 tool 内只能有一个 default。",
    },
  },
};

export const DCH_STORE: ToolSchema = {
  $id: "dch-store@2",
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
        description: "Schema 版本号（当前固定为 2）。",
        min: 2,
        max: 2,
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
      backup: {
        type: "object",
        description: "工具级与切换脚本备份规则。方案级快照存放在对应 profile.backupPolicy。",
        additionalProperties: false,
        properties: {
          toolPolicies: {
            type: "object",
            additionalProperties: false,
            properties: {
              claude: BACKUP_POLICY_FIELD,
              codex: BACKUP_POLICY_FIELD,
              grok: BACKUP_POLICY_FIELD,
              cursor: BACKUP_POLICY_FIELD,
            },
          },
          scriptsEnabled: {
            type: "boolean",
            description: "是否启用 ~/.dch/scripts 备份。CLI --no-scripts 可单次强制跳过。",
            default: true,
          },
          scriptsPolicy: {
            ...BACKUP_POLICY_FIELD,
            description: "切换脚本全局规则；不提供方案级覆盖。",
          },
        },
      },
    },
  },
};
