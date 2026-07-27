import type {
  BackupContentSecretRule,
  BackupFieldSecretRule,
  BackupFileRule,
  BackupPolicyV1,
  BackupWholeFileSecretRule,
  ToolKind,
} from "./types.ts";

function exclude(id: string, pattern: string, label = id): BackupFileRule {
  return {
    id,
    label,
    enabled: true,
    target: pattern.includes("/") ? "relative-path" : "basename",
    match: { kind: "glob", pattern },
    action: "exclude",
  };
}

const COMMON_FILE_RULES: BackupFileRule[] = [
  exclude("private-netrc", "**/.netrc", "排除 .netrc"),
  exclude("private-ssh-tree", "**/.ssh/**", "排除 .ssh 目录"),
  exclude("private-id-rsa", "**/id_rsa", "排除 RSA 私钥"),
  exclude("private-id-dsa", "**/id_dsa", "排除 DSA 私钥"),
  exclude("private-id-ecdsa", "**/id_ecdsa", "排除 ECDSA 私钥"),
  exclude("private-id-ed25519", "**/id_ed25519", "排除 Ed25519 私钥"),
  exclude("private-ssh-id-dir", "**/ssh/id_*", "排除 ssh/id_*"),
  exclude("private-pem", "**/*.pem", "排除 PEM"),
  exclude("private-key", "**/*.key", "排除 KEY"),
  exclude("private-p12", "**/*.p12", "排除 PKCS#12"),
  exclude("private-pfx", "**/*.pfx", "排除 PFX"),
  exclude("private-jks", "**/*.jks", "排除 JKS"),
  exclude("private-keystore", "**/*.keystore", "排除 keystore"),
  exclude("history-jsonl", "**/*.jsonl", "排除会话历史"),
  exclude("database-db", "**/*.db", "排除 DB"),
  exclude("database-db-shm", "**/*.db-shm", "排除 DB SHM"),
  exclude("database-db-wal", "**/*.db-wal", "排除 DB WAL"),
  exclude("database-db-journal", "**/*.db-journal", "排除 DB journal"),
  exclude("database-sqlite", "**/*.sqlite", "排除 SQLite"),
  exclude("database-sqlite-shm", "**/*.sqlite-shm", "排除 SQLite SHM"),
  exclude("database-sqlite-wal", "**/*.sqlite-wal", "排除 SQLite WAL"),
  exclude("database-sqlite-journal", "**/*.sqlite-journal", "排除 SQLite journal"),
  exclude("database-sqlite3", "**/*.sqlite3", "排除 SQLite3"),
  exclude("database-sqlite3-shm", "**/*.sqlite3-shm", "排除 SQLite3 SHM"),
  exclude("database-sqlite3-wal", "**/*.sqlite3-wal", "排除 SQLite3 WAL"),
  exclude("database-sqlite3-journal", "**/*.sqlite3-journal", "排除 SQLite3 journal"),
  exclude("runtime-log-file", "**/*.log", "排除日志文件"),
  exclude("runtime-lock-file", "**/*.lock", "排除锁文件"),
  exclude("maintenance-bak-copy", "**/*.bak.*", "排除 bak 副本"),
  exclude("maintenance-backup-copy", "**/*.backup.*", "排除 backup 副本"),
  exclude("mac-ds-store", "**/.DS_Store", "排除 .DS_Store"),
  exclude("hidden-cache", "**/.cache/**", "排除隐藏缓存目录"),
  exclude("hidden-temp", "**/.tmp/**", "排除隐藏临时目录"),
  exclude("root-debug", "debug/**", "排除根部 debug"),
  exclude("root-file-history", "file-history/**", "排除根部 file-history"),
  exclude("root-session-env", "session-env/**", "排除根部 session-env"),
  exclude("root-sessions", "sessions/**", "排除根部 sessions"),
  exclude("root-shell-snapshots", "shell_snapshots/**", "排除根部 shell_snapshots"),
  exclude("root-shell-snapshots-dash", "shell-snapshots/**", "排除根部 shell-snapshots"),
  exclude("root-paste-cache", "paste-cache/**", "排除根部 paste-cache"),
  exclude("root-cache", "cache/**", "排除根部 cache"),
  exclude("root-backups", "backups/**", "排除根部 backups"),
  exclude("root-ide", "ide/**", "排除根部 ide"),
  exclude("root-state", "state/**", "排除根部 state"),
  exclude("root-tasks", "tasks/**", "排除根部 tasks"),
  exclude("root-statsig", "statsig/**", "排除根部 statsig"),
  exclude("root-log", "log/**", "排除根部 log"),
  exclude("root-logs", "logs/**", "排除根部 logs"),
  exclude("root-tmp", "tmp/**", "排除根部 tmp"),
  exclude("root-memory", "memory/**", "排除根部 memory"),
  exclude("root-memories", "memories/**", "排除根部 memories"),
  exclude("root-ai-tracking", "ai-tracking/**", "排除根部 ai-tracking"),
  exclude("root-extensions", "extensions/**", "排除根部 extensions"),
  exclude("root-skills-cursor", "skills-cursor/**", "排除根部 skills-cursor"),
  exclude("maintenance-last-cleanup", ".last-cleanup", "排除清理标记"),
  exclude("maintenance-personality", ".personality_migration", "排除迁移标记"),
  exclude("maintenance-installation-id", "installation_id", "排除 installation_id"),
  exclude("maintenance-mcp-auth-cache", "mcp-needs-auth-cache.json", "排除 MCP auth cache"),
  exclude("maintenance-plugin-counts", "plugins/install-counts-cache.json", "排除插件计数缓存"),
  exclude("maintenance-claude-json", ".claude.json", "排除 Claude 运行状态"),
  exclude("maintenance-active-sessions", "active_sessions.json", "排除 active_sessions"),
  exclude("maintenance-leader-sock", "leader.sock", "排除 leader socket"),
];

const WHOLE_FILE_SECRET_RULES: BackupWholeFileSecretRule[] = [
  {
    id: "secret-auth-json",
    label: "排除 auth.json",
    enabled: true,
    target: "basename",
    match: { kind: "glob", pattern: "auth.json" },
    action: "exclude-file",
  },
  {
    id: "secret-credentials-json",
    label: "排除 credentials.json",
    enabled: true,
    target: "basename",
    match: { kind: "glob", pattern: "credentials.json" },
    action: "exclude-file",
  },
  {
    id: "secret-mcp-credentials-json",
    label: "排除 mcp_credentials.json",
    enabled: true,
    target: "basename",
    match: { kind: "glob", pattern: "mcp_credentials.json" },
    action: "exclude-file",
  },
];

function fieldRule(
  id: string,
  label: string,
  match: BackupFieldSecretRule["match"],
  action: BackupFieldSecretRule["action"],
): BackupFieldSecretRule {
  return {
    id,
    label,
    enabled: true,
    formats: ["json", "jsonc", "toml"],
    match,
    action,
  };
}

const FIELD_SECRET_RULES: BackupFieldSecretRule[] = [
  fieldRule("field-ignore-token-expiry", "忽略 tokenExpiry", { kind: "exact", pattern: "tokenExpiry" }, "ignore"),
  fieldRule("field-ignore-token-issued", "忽略 tokenIssuedAt", { kind: "exact", pattern: "tokenIssuedAt" }, "ignore"),
  fieldRule(
    "field-ignore-path-like",
    "忽略路径、URL 与目录字段",
    { kind: "regex", pattern: "(_path|_file|_url|_endpoint|_dir|_directory)$" },
    "ignore",
  ),
  ...["api_key", "apikey", "token", "secret", "password", "credential", "bearer", "authorization"]
    .map((pattern) => fieldRule(
      `field-redact-${pattern}`,
      `脱敏字段名包含 ${pattern}`,
      { kind: "contains", pattern },
      "placeholder",
    )),
];

function contentRegex(
  id: string,
  label: string,
  pattern: string,
  placeholderName: string,
  secretCaptureGroup?: number,
  caseSensitive = true,
): BackupContentSecretRule {
  return {
    id,
    label,
    enabled: true,
    formats: ["json", "jsonc", "toml", "text"],
    match: {
      kind: "regex",
      pattern,
      caseSensitive,
      ...(secretCaptureGroup === undefined ? {} : { secretCaptureGroup }),
    },
    action: "placeholder",
    placeholderName,
  };
}

const CONTENT_SECRET_RULES: BackupContentSecretRule[] = [
  contentRegex("content-anthropic", "Anthropic API Key", "sk-ant-[A-Za-z0-9_-]{20,}", "ANTHROPIC_API_KEY"),
  contentRegex("content-openai-project", "OpenAI Project Key", "sk-proj-[A-Za-z0-9_-]{20,}", "OPENAI_PROJ_KEY"),
  contentRegex("content-openai", "OpenAI API Key", "\\bsk-[A-Za-z0-9]{32,}\\b", "OPENAI_API_KEY"),
  contentRegex("content-github-pat", "GitHub PAT", "\\bghp_[A-Za-z0-9]{36,}\\b", "GITHUB_PAT"),
  contentRegex("content-github-oauth", "GitHub OAuth", "\\bgho_[A-Za-z0-9]{36,}\\b", "GITHUB_OAUTH"),
  contentRegex("content-github-user", "GitHub User OAuth", "\\bghu_[A-Za-z0-9]{36,}\\b", "GITHUB_USER_OAUTH"),
  contentRegex("content-github-server", "GitHub Server OAuth", "\\bghs_[A-Za-z0-9]{36,}\\b", "GITHUB_SERVER_OAUTH"),
  contentRegex("content-gitlab", "GitLab PAT", "\\bglpat-[A-Za-z0-9_-]{20,}\\b", "GITLAB_PAT"),
  contentRegex("content-slack-bot", "Slack Bot Token", "\\bxoxb-[A-Za-z0-9-]{20,}\\b", "SLACK_BOT_TOKEN"),
  contentRegex("content-slack-user", "Slack User Token", "\\bxoxp-[A-Za-z0-9-]{20,}\\b", "SLACK_USER_TOKEN"),
  contentRegex("content-aws-access-key", "AWS Access Key ID", "\\bAKIA[0-9A-Z]{16}\\b", "AWS_ACCESS_KEY_ID"),
  contentRegex(
    "content-http-auth",
    "HTTP Authorization",
    "\\b(?:Authorization|X-Api-Key|X-Auth-Token)\\s*:\\s*(?:Bearer|Basic|Token)?\\s*([A-Za-z0-9_+./=-]{16,})",
    "HTTP_AUTH_TOKEN",
    1,
    false,
  ),
  {
    id: "content-key-value",
    label: "敏感 KEY=VALUE",
    enabled: true,
    formats: ["text"],
    match: {
      kind: "key-value",
      keyPattern: "(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|BEARER|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|AUTH)",
      minValueLength: 8,
    },
    action: "placeholder",
  },
];

function basePolicy(extraFileRules: BackupFileRule[] = []): BackupPolicyV1 {
  return {
    schemaVersion: 1,
    defaultFileAction: "include",
    unscannableFileAction: "include-with-warning",
    fileRules: [...COMMON_FILE_RULES, ...extraFileRules],
    secretRules: {
      wholeFile: WHOLE_FILE_SECRET_RULES,
      field: FIELD_SECRET_RULES,
      content: CONTENT_SECRET_RULES,
    },
  };
}

const FACTORY_POLICIES: Record<ToolKind, BackupPolicyV1> = {
  claude: basePolicy([
    exclude("claude-plugin-cache", "plugins/cache/**", "排除 Claude 插件缓存"),
    exclude("claude-plugin-marketplaces", "plugins/marketplaces/**", "排除 Claude marketplace 下载"),
  ]),
  codex: basePolicy(),
  grok: basePolicy([
    exclude("grok-user-guide", "docs/user-guide/**", "排除 Grok 下载的用户指南"),
  ]),
  cursor: basePolicy([
    exclude("cursor-projects", "projects/**", "排除 Cursor 项目运行数据"),
  ]),
};

const SCRIPT_FILE_RULES = COMMON_FILE_RULES.filter((rule) => (
  rule.id.startsWith("private-") ||
  rule.id.startsWith("database-") ||
  rule.id.startsWith("runtime-") ||
  rule.id.startsWith("maintenance-bak") ||
  rule.id.startsWith("maintenance-backup") ||
  rule.id === "mac-ds-store" ||
  rule.id === "hidden-cache" ||
  rule.id === "hidden-temp"
));

const SCRIPT_POLICY: BackupPolicyV1 = {
  ...basePolicy(),
  fileRules: SCRIPT_FILE_RULES,
};

export function factoryBackupPolicy(tool: ToolKind): BackupPolicyV1 {
  return structuredClone(FACTORY_POLICIES[tool]);
}

export function factoryScriptsBackupPolicy(): BackupPolicyV1 {
  return structuredClone(SCRIPT_POLICY);
}
