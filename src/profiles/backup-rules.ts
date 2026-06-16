/**
 * 备份/还原的 path / 字段规则常量。
 *
 * - configDir 默认按目录语义打包：所有真文件都会纳入，除非命中 EXCLUDE_PATTERNS。
 * - EXCLUDE_PATTERNS：硬性**黑名单**（jsonl 历史 / 缓存 / 数据库 / lock / 临时目录）
 * - SENSITIVE_KEY_PATTERNS：敏感字段名子串（case-insensitive），用于占位符替换
 * - SENSITIVE_FILES：整文件级敏感（OAuth credentials / auth），整体置为占位符
 *
 * 命中顺序：先 EXCLUDE 黑名单；未命中即包含。
 *
 * 维护说明：新增一类历史/缓存/运行态目录时加到 EXCLUDE。不要为普通配置文件加白名单，
 * 否则新工具或用户自定义资产容易漏备份。
 */

export const EXCLUDE_PATTERNS: string[] = [
  "**/*.jsonl",
  "**/*.db",
  "**/*.db-shm",
  "**/*.db-wal",
  "**/*.db-journal",
  "**/*.sqlite",
  "**/*.sqlite-shm",
  "**/*.sqlite-wal",
  "**/*.sqlite-journal",
  "**/*.sqlite3",
  "**/*.sqlite3-shm",
  "**/*.sqlite3-wal",
  "**/*.sqlite3-journal",
  "**/*.log",
  "**/*.lock",
  "**/*.bak.*",
  "**/*.backup.*",
  "**/.DS_Store",

  "**/.netrc",
  "**/.ssh/**",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/ssh/id_*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",

  // 隐藏 cache/tmp 目录在任意深度都视为运行态；普通 state/tasks/log 等目录只排 root 级，
  // 避免把用户自定义 agents/skills/providers/commands 子树里的同名持久资产静默漏备份。
  "**/.cache/**",
  "**/.tmp/**",

  "debug/**",
  "file-history/**",
  "session-env/**",
  "sessions/**",
  "shell_snapshots/**",
  "shell-snapshots/**",
  "paste-cache/**",
  "cache/**",
  "backups/**",
  "ide/**",
  "state/**",
  "tasks/**",
  "statsig/**",
  "log/**",
  "tmp/**",
  "memories/**",

  ".last-cleanup",
  ".personality_migration",
  "installation_id",
  "mcp-needs-auth-cache.json",
  "plugins/install-counts-cache.json",
  ".claude.json",
];

export const SENSITIVE_KEY_PATTERNS: string[] = [
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
  "credential",
  "bearer",
  "authorization",
];

export const SENSITIVE_FILES = new Set<string>([
  "credentials.json",
  "auth.json",
]);

/**
 * 已知非敏感的 key 白名单 — 即使包含 SENSITIVE_KEY_PATTERNS 子串也不脱敏。
 * 例：profile.env 里的 `HTTP_PROXY` 不含敏感子串故不命中；但若用户有 `proxy_authorization` 类
 * key 且确实是 proxy basic auth 还是该脱。这里只列已知绝对安全的字段。
 */
export const NON_SENSITIVE_KEY_EXACT = new Set<string>([
  "tokenExpiry",
  "tokenIssuedAt",
]);

/**
 * key 后缀如果是路径 / URL / 端点 / 目录性质，value 就不是凭据本身（是指向凭据的路径），
 * 不脱敏。例：plugin.json 里的 `credentials_path = "~/.config/foo/cred"` 是路径，脱敏后
 * 反而破坏 plugin 配置。
 */
const PATH_LIKE_SUFFIX_RE = /(_path|_file|_url|_endpoint|_dir|_directory)$/i;

const excludeMatchers = EXCLUDE_PATTERNS.map((p) => new Bun.Glob(p.toLowerCase()));

/**
 * 单条相对路径是否应纳入备份。命中黑名单返回 false；否则默认包含。
 *
 * relPath 必须是 POSIX 风格相对路径（如 `templates/changelog.template.md`，无前导 /）。
 */
export function shouldIncludePath(relPath: string): boolean {
  const normalizedRelPath = relPath.toLowerCase();
  for (const g of excludeMatchers) {
    if (g.match(normalizedRelPath)) return false;
  }
  return true;
}

const sensitiveLower = SENSITIVE_KEY_PATTERNS.map((s) => s.toLowerCase());

/** key 是否含敏感子串（case-insensitive）。路径类后缀（_path/_url/_dir 等）豁免。 */
export function isSensitiveKey(key: string): boolean {
  if (NON_SENSITIVE_KEY_EXACT.has(key)) return false;
  if (PATH_LIKE_SUFFIX_RE.test(key)) return false;
  const k = key.toLowerCase();
  return sensitiveLower.some((p) => k.includes(p));
}

/** 整文件级敏感 — 整体替换为 placeholder。 */
export function isSensitiveFile(filename: string): boolean {
  return SENSITIVE_FILES.has(filename.toLowerCase());
}
