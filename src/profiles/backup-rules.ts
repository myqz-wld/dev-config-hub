/**
 * 备份/还原的 path / 字段规则常量。
 *
 * - INCLUDE_PATTERNS：configDir 内**白名单**相对路径，递归匹配
 * - EXCLUDE_PATTERNS：硬性**黑名单**，即使白名单也排除（jsonl 历史 / 缓存 / 数据库 / lock）
 * - SENSITIVE_KEY_PATTERNS：敏感字段名子串（case-insensitive），用于占位符替换
 * - SENSITIVE_FILES：整文件级敏感（OAuth credentials / auth），整体置为占位符
 *
 * 命中顺序：先 EXCLUDE 黑名单，再 INCLUDE 白名单。
 *
 * 维护说明：新增一类配置文件时把相对路径加到 INCLUDE；新增一类历史/缓存目录加到 EXCLUDE。
 */

export const INCLUDE_PATTERNS: string[] = [
  "CLAUDE.md",
  "AGENTS.md",
  "settings.json",
  "settings.local.json",
  "hilo-skill-market.json",
  "version.json",
  ".mcp.json",
  "auth.json",
  "config.toml",
  "credentials.json",

  "templates/**",
  "SOPs/**",
  "plans/*.md",
  "providers/**",
  "agents/**",
  "commands/**",
  "skills/**",

  "plugins/installed_plugins.json",
  "plugins/known_marketplaces.json",
  "plugins/blocklist.json",
  "plugins/cache/**",
  "plugins/local/**",
  "plugins/marketplaces/**",
  ".claude-plugin/**",

  "projects/*/memory/**",
];

export const EXCLUDE_PATTERNS: string[] = [
  "**/*.jsonl",
  "**/*.sqlite",
  "**/*.sqlite-shm",
  "**/*.sqlite-wal",
  "**/*.log",
  "**/*.lock",
  "**/*.bak.*",
  "**/*.backup.*",
  "**/.DS_Store",

  // **REVIEW_9 B-MED-3 / B-claude M1**: 子目录段统一加 `**/` 前缀让任意深度匹配。旧实现仅
  // root 级匹配 → INCLUDE 子树(`templates/**` / `agents/**` / `plugins/local/**` 等)内嵌
  // 的 `.cache/` / `.tmp/` / `debug/` 等都漏过滤。Bun.Glob `**/x/**` 同时匹配
  // `x/foo` (root) 与 `nested/x/foo` (深度)。
  //
  // 例外:`cache/**` 保留 root-only — `plugins/cache/**` 是 INCLUDE 主动允许的 plugin
  // marketplace 合法 cache 数据,跨深度匹配会误伤;靠 `**/.cache/**` (隐藏目录)兜底子树内
  // 真临时目录。
  "**/debug/**",
  "**/file-history/**",
  "**/session-env/**",
  "**/sessions/**",
  "**/shell_snapshots/**",
  "**/shell-snapshots/**",
  "**/paste-cache/**",
  "**/.cache/**",
  "cache/**",
  "**/backups/**",
  "**/ide/**",
  "**/state/**",
  "**/tasks/**",
  "**/statsig/**",
  "**/log/**",
  "**/tmp/**",
  "**/.tmp/**",
  "**/memories/**",

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

const includeMatchers = INCLUDE_PATTERNS.map((p) => new Bun.Glob(p));
const excludeMatchers = EXCLUDE_PATTERNS.map((p) => new Bun.Glob(p));

/**
 * 单条相对路径是否应纳入备份。先黑后白；命中黑名单立即返回 false。
 *
 * relPath 必须是 POSIX 风格相对路径（如 `templates/changelog.template.md`，无前导 /）。
 */
export function shouldIncludePath(relPath: string): boolean {
  for (const g of excludeMatchers) {
    if (g.match(relPath)) return false;
  }
  for (const g of includeMatchers) {
    if (g.match(relPath)) return true;
  }
  return false;
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
  return SENSITIVE_FILES.has(filename);
}
