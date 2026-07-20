---
changelog_id: 29
changed_at: 2026-06-16
---

# CHANGELOG_29: 备份规则改为目录语义 + 排除清单

## 概要

`dch profile backup` 的 profile configDir 筛选从「固定包含白名单」改成「默认打包目录内所有真文件，命中排除清单才跳过」。这样新工具配置、用户自定义资产、未来新增文件名不需要再改代码白名单，降低漏备份风险。

## 变更内容

### `src/profiles/backup-rules.ts`

- 删除 `INCLUDE_PATTERNS` 白名单；`shouldIncludePath()` 现在只检查 `EXCLUDE_PATTERNS`，未命中排除项即纳入备份。
- 保留现有运行态 / 缓存 / 历史 / 数据库排除项，例如 `*.jsonl`、`*.sqlite*`、`*.log`、`*.lock`、`debug/`、`sessions/`、`.cache/`、`tmp/`、`backups/` 等。
- 保留 symlink 跳过逻辑在 `walkFiles()` 层处理，目录语义不跨 profile 边界跟随外部链接。
- simple-review 后补安全排除：`.netrc`、`.ssh/**`、常见 SSH 私钥名、`*.pem`、`*.key`、`*.p12`、`*.pfx`、`*.jks`、`*.keystore` 不进入默认备份，避免 placeholder 模式无法脱敏的私钥 / keystore 原样进包。
- 补数据库 sidecar 排除：`*.db` / `*.db-wal` / `*.db-shm` / `*.db-journal` 与 `*.sqlite3*`。
- 排除匹配改为大小写不敏感，覆盖 `client.PEM`、`.NETRC`、`history.DB-WAL` 等 macOS 常见大小写保留文件名。
- 脱敏分发同样改为大小写不敏感，`Credentials.JSON` / `AUTH.JSON` / `Settings.JSON` / `Config.TOML` 不会因扩展名大小写绕过整文件或结构化脱敏。
- 收窄普通 runtime 目录名排除范围：`state/`、`tasks/`、`memories/`、`debug/`、`log/` 等只排 configDir 根级；自定义 `agents/` / `skills/` / `providers/` / `commands/` 子树内同名目录默认保留。

### `src/profiles/backup-rules.test.ts`

- 更新断言：未知配置文件和自定义目录默认进入备份。
- 保留黑名单优先断言，确保会话历史、缓存、数据库、私钥、keystore、lock/log 等运行态或敏感数据仍被排除。
- 增加大小写混合路径断言，避免 PEM / DB / NETRC 等排除项被大小写绕过。
- 增加 `Credentials.JSON` / `AUTH.JSON` / `.JSON` / `.TOML` 脱敏分发回归测试。
- 新增正向断言，确保自定义配置子树中的 `tasks/`、`state/`、`memories/` 等目录不会被根级 runtime 排除项误伤。

### `README.md`

- 「包含 / 排除规则」改为「打包规则」。
- 文档不再列举具体要包含的配置文件名，改为说明：profile configDir 默认整目录打包，只列排除项和 shared 资源行为。

## 验证

- `bun test src/profiles/backup-rules.test.ts`
- `bun test`
