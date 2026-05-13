# Dev Config Hub

本地桌面应用，用于可视化查看和编辑开发工具的配置文件，并在 **Claude Code / Codex CLI 的多套认证 profile 间快速切换**（订阅 vs API Key 等场景）。

基于 [Tauri v2](https://v2.tauri.app/)（Rust + WebView）构建，前后端均跑在 [Bun](https://bun.sh/) 上。**支持 macOS / Windows 10+ / Linux**（Win profile 切换自动用 NTFS junction 替代 symlink，无须开 Developer Mode 或提权）。

## 平台支持矩阵

| 平台 | 状态 | 说明 |
|---|---|---|
| **macOS 12+ (Apple Silicon / Intel)** | **GA** | 主要开发与测试平台；symlink + bash hook + zsh shell reader |
| **Windows 10 1703+ / 11** | **beta** | symlink 自动走 junction（无需 SeCreateSymbolicLinkPrivilege / Developer Mode）；hook 默认走 PowerShell（hook 字符串形式按 PowerShell 解析；object 形式 `{posix?, powershell?, cmd?}` 显式分平台）；shell reader 改读 `$PROFILE`；opencode 优先 `%APPDATA%\opencode\` |
| **Linux** | **beta** | symlink 与 macOS 同款行为；hook 走 bash；shell reader 读 zsh + bash 配置 |

Win 端真机 E2E 留待 CI 验证（参见 [REVIEW_1](reviews/REVIEW_1.md)）。

## 支持的工具

| 工具 | 配置文件 | 格式 |
|------|---------|------|
| **Shell** | macOS/Linux：`~/.zprofile`, `~/.zshrc`, `~/.bashrc` ／ Windows：`$PROFILE`（PowerShell 5.1 + 7） | dotfile / .ps1 |
| **Claude Code** | `~/.claude/settings.json`, `settings.local.json`, `CLAUDE.md`, `.mcp.json` | JSON / Markdown |
| **Codex CLI** | `~/.codex/config.toml` | TOML |
| **OpenCode** | macOS/Linux：`~/.config/opencode/opencode.json` ／ Windows：`%APPDATA%\opencode\opencode.json` | JSON |

## 核心能力

- **配置可视化**：按工具分组展示所有配置文件
- **源文件查看 + 直接编辑保存**：CodeMirror 6 语法高亮 + 行号 + 折叠 + 搜索（Cmd+F）；编辑模式带外部修改 TOCTOU 检测
- **Markdown 渲染**：`CLAUDE.md` 等 markdown 文件默认走 react-markdown + GFM + shiki 代码块
- **自动检测工具版本**
- **CLI + GUI 双入口**：`dch` 子命令完整覆盖功能；`dch gui` / `bun run dev` 启动桌面窗口
- **Profile 快速切换**：维护多套 Claude / Codex 配置（如 `claude-pro` / `claude-api`、`codex-plus` / `codex-api`），一键原子切换 `~/.claude` / `~/.codex` symlink，全局生效
- **切换前 / 后 Hook**：每个 profile 可定义 `preSwitch` / `postSwitch` shell 脚本，用于自动 kill 残留进程、起 VPN、健康探测、osascript 通知等。`preSwitch` 失败会中断切换
- **shell wrapper 注入 env**：`dch profile env` + `~/.zshrc` 子 shell wrapper，让 profile.env 落到 claude / codex 进程本身（OAuth / API 走代理）
- **备份与还原（.dchpack）**：所有 profile + 共享资源（hook 脚本 + `~/.agents/`）打成单文件，跨机器迁移 / 本地灾备 / 分享 profile 给同事。**默认脱敏 token / API key 为占位符**安全分享；CLI + UI 双入口

## 环境要求

- [Bun](https://bun.sh/) ≥ 1.1（Windows 用 `irm bun.sh/install.ps1 | iex` 安装）
- [Rust](https://rustup.rs/) ≥ 1.77
- 平台：macOS 12+ / **Windows 10 1703+**（Win 用 junction 不需要 Developer Mode）/ Linux（GTK + WebKitGTK）

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式（Tauri 桌面窗口 + HMR）
bun run dev

# 构建生产包
bun run build

# 装到 /Applications（macOS）
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/

# 装到 Windows（产物 .msi 在 src-tauri/target/release/bundle/msi/）
# bunx tauri build --bundles msi
# 双击安装即可

# CLI 模式
bun run cli                                # 总览
bun run cli claude                         # 查看 Claude Code 配置
bun run cli edit ~/.claude/settings.json   # 用 $EDITOR 编辑（Win 默认 notepad）
bun run cli gui                            # 启动桌面窗口

# Profile 子命令
bun run cli profile                              # 列出所有 profile
bun run cli profile init claude                  # 把 ~/.claude 转成 symlink/junction 并建立默认 profile
bun run cli profile add claude claude-api --dir ~/.claude-api --env ANTHROPIC_API_KEY=sk-...
bun run cli profile use claude-api               # 原子切换 + 跑 pre/post hook
```

首次 `bun run dev` 需要编译 Rust 依赖，约 2-3 分钟，后续启动秒开。

## CLI 用法

通过 `bun link` 注册全局命令后可直接使用 `dch`：

```bash
bun link

dch                   # 总览所有工具
dch shell             # Shell 配置
dch claude            # Claude Code 配置
dch codex             # Codex CLI 配置
dch opencode          # OpenCode 配置
dch all               # 全部展示
dch gui               # 启动桌面窗口（等同于 bun run dev）
dch edit <file>       # 用 $EDITOR 编辑指定配置文件

# Profile 管理
dch profile                                  # 列出所有 profile（按 tool 分组，标记 active）
dch profile show <id>                        # 打印 profile JSON
dch profile add <claude|codex> <id> [...]    # 添加 profile：--dir / --env K=V / --from / --desc
dch profile edit <id>                        # $EDITOR 打开 ~/.dch/profiles.json
dch profile remove <id> [--yes]              # 删除 profile（不删 configDir）
dch profile use <id>                         # 原子切换 ~/.claude / ~/.codex symlink + 跑 pre/post hook
dch profile current [tool]                   # 查询当前 active
dch profile env <claude|codex>               # 输出 active profile.env 为 shell-eval 格式
dch profile init <claude|codex>              # 把 ~/.claude / ~/.codex 转成 symlink，建立 default profile
dch profile hook test <id> <pre|post>        # 单独运行 hook 测试
dch profile config hookTimeoutMs <ms>        # 设置 hook 超时
dch profile backup [opts]                    # 备份所有 profile + 共享资源到 .dchpack
                                             # [--out <file>] [--profiles <id1,id2>] [--no-shared]
                                             # [--no-placeholder] [--yes]
dch profile restore <pack> [opts]            # 还原 .dchpack（自动加 -restored-<TS> 后缀避免撞名）
                                             # [--prefix <p>] [--rename OLD=NEW,...]
                                             # [--dry-run] [--yes]
```

## Profile 系统

### 数据模型

所有 profile 持久化在 `~/.dch/profiles.json`：

```jsonc
{
  "version": 1,
  "profiles": [
    {
      "id": "claude-api",
      "tool": "claude",
      "configDir": "~/.claude-api",
      "env": { "HTTP_PROXY": "http://127.0.0.1:1082" },
      "description": "Claude Code via API key",
      "hooks": {
        "preSwitch":  "pkill -f 'claude' || true",
        "postSwitch": "osascript -e 'display notification \"切到 API\" with title \"dch\"'"
      }
    }
  ],
  "active": { "claude": "claude-api", "codex": null },
  "preferences": {
    "hookTimeoutMs": 30000
  }
}
```

> `profile.env` 默认只在 `preSwitch` / `postSwitch` 脚本里可见（用于 hook 内 curl 走代理等）。**要让 env 也注入到 claude / codex 进程本身**（如 OAuth 登录走 HTTP 代理），用 `dch profile env <tool>` + zshrc shell wrapper（见下「shell wrapper」节）。或者把 env 写到 `<configDir>/settings.json` 的 `env` 块（仅 claude code 支持，codex 没有这个机制）。

### Hook 注入的环境变量

执行 `preSwitch` / `postSwitch` 脚本时注入以下变量：

```
DCH_PROFILE_ID         切到的 profile id
DCH_PROFILE_TOOL       claude | codex
DCH_PROFILE_CONFIG_DIR 该 profile 的绝对路径
DCH_SWITCH_TO          目标 profile id（同 DCH_PROFILE_ID）
DCH_SWITCH_FROM        先前 active profile id（首次 init 后可能为空）
```

**Hook 脚本两种形式**（types.ts `HookScript = string | { posix?, powershell?, cmd? }`）：

```jsonc
// 形式 1：string（向后兼容；按当前平台默认 shell 跑）
"hooks": {
  "preSwitch": "echo hello"   // POSIX → bash -lc / Win → powershell -NoProfile -Command
}

// 形式 2：object（推荐用于带平台特定语法的脚本）
"hooks": {
  "preSwitch": {
    "posix":      "pkill -f 'claude' || true",
    "powershell": "Get-Process claude -ErrorAction SilentlyContinue | Stop-Process -Force"
  }
}
```

变量在 PowerShell 内通过 `$env:DCH_PROFILE_ID` 访问；POSIX 通过 `$DCH_PROFILE_ID`。

`preSwitch` 退出码非零会中断切换、不更新 active 状态、不跑 postSwitch。`postSwitch` 失败仅警告。

### 切换语义

`dch profile use <id>` 做这几件事：

1. 跑 `preSwitch` hook（含 profile.env），失败则中断
2. 原子修改 `~/.claude` / `~/.codex` symlink 指向 `profile.configDir`
   - **macOS / Linux**：`ln -s` 临时名 + `mv` 覆盖（POSIX rename 原子）
   - **Windows**：`fs.symlink(target, path, 'junction')` NTFS reparse point；要求 target 是绝对路径目录、不能跨分区（profile configDir 都在用户主目录下，全部满足）
3. 写回 `~/.dch/profiles.json` 的 `active.<tool>`
4. 跑 `postSwitch` hook

第一次切换前必须跑一次 `dch profile init <tool>`：会把现有真实目录 `~/.claude` / `~/.codex` mv 到 `~/.<tool>-default`，再 ln -s / 建 junction 回去并注册成 default profile。

### Shell wrapper（让 profile.env 注入到 claude / codex 进程）

dch 切 profile 不会启动 claude / codex 进程，所以 `profile.env` 默认到不了 OAuth 登录 / API 调用的进程里。在 shell 启动文件里加 wrapper，每次跑 `claude` / `codex` 时从 active profile.env 取 env 注入：

**macOS / Linux**（`~/.zshrc` 或 `~/.bashrc`）：

```bash
claude() (
  eval "$(command dch profile env claude 2>/dev/null)"
  exec command claude "$@"
)
codex() (
  eval "$(command dch profile env codex 2>/dev/null)"
  exec command codex "$@"
)
```

**Windows**（PowerShell `$PROFILE`）：

```powershell
function claude {
  $env_lines = & dch profile env claude 2>$null
  if ($env_lines) {
    foreach ($line in ($env_lines -split "`n")) {
      if ($line -match '^export\s+(\w+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim("'"), "Process")
      }
    }
  }
  & claude.exe @args
}
# codex wrapper 同模式
```

要点：

- POSIX 子 shell `(...)` 包裹：env 只对 claude / codex 进程生效，**不污染父 shell**
- `exec command claude` 替换子 shell 进程，少一层 fork，且绕过 wrapper 自身防止递归
- Win PowerShell function 用 `[Environment]::SetEnvironmentVariable(..., "Process")` 写 process-scoped env（不污染当前 shell session 之外的进程）
- `dch profile env <tool>` active 为空 / env 空 → 静默无输出，wrapper 自然 fall-through 到原命令
- profile.env key 走严格 `^[A-Za-z_][A-Za-z0-9_]*$` 校验 + value 单引号包裹，**无 shell 注入风险**

切换 profile 后**新跑**的 claude / codex 自动用新 profile 的 env，无需 reload shell。

## 备份与还原（.dchpack）

把所有 profile + 共享资源（`~/.dch/scripts/` hook 脚本 + `~/.agents/` 全局 agent/skill）打成单文件 `.dchpack`，用于跨机器迁移 / 本地灾备 / 分享 profile 给同事。**默认脱敏 token / API key 为占位符**，安全分享。

### 命令

```bash
# 备份所有 profile + 共享资源 → ~/.dch/backups/dch-backup-<YYYYMMDD-HHMMSS>.dchpack
dch profile backup

# 备份子集
dch profile backup --profiles claude-pro,codex-pro --out /tmp/share.dchpack

# 不脱敏（保留原始 token / API key，强制二次确认）
dch profile backup --no-placeholder

# 还原（自动加 -restored-<TS> 后缀避免撞名；不切 active）
dch profile restore ~/.dch/backups/dch-backup-20260513-143025.dchpack

# dry-run 看冲突 / 占位符清单 / 共享资源 diff
dch profile restore <file> --dry-run

# 改名指定 profile（避免默认后缀太长）
dch profile restore <file> --rename claude-pro=claude-pro-v2,codex-pro=codex-pro-v2

# 全局后缀
dch profile restore <file> --prefix -from-mac
```

### UX

- ProfilePanel 顶部按钮：`📦 导出备份` / `📥 导入备份`
- 单 profile 卡片：`📦 导出` 按钮（只导该 profile + 共享资源）
- 还原 modal 显示来源元数据 / 撞名改名 / 共享资源 diff / 占位符待填清单

### 占位符填回（迁移到新机器后）

还原后，凭据字段被替换为 `<<DCH_PLACEHOLDER:KEY_NAME>>`。CLI 输出会列所有占位符位置（精确到 `~/.<dir>/<file>:<field_name>` + 提示）。

```
待填占位符 3 处:
  ~/.claude-pro-restored-20260513-143025/.mcp.json :: INTERN_TOKEN — Gitlab OAuth Token
  ~/.codex-default-restored-20260513-143025/config.toml :: experimental_bearer_token — Codex bearer token
  ~/.codex-default-restored-20260513-143025/auth.json :: AUTH — Codex OAuth payload (~/.codex/auth.json)
```

手动编辑这些文件填回真实值（用 `dch edit` 或 ConfigPanel），然后跑 `dch profile use <id>` 切换。

### 包含 / 排除规则

- **包含**（configDir 相对路径）：
  - 顶层：`CLAUDE.md` / `AGENTS.md` / `settings.json` / `settings.local.json` / `.mcp.json` / `auth.json` / `config.toml` / `credentials.json` / `version.json` / `hilo-skill-market.json`
  - 目录递归：`templates/**` / `SOPs/**` / `plans/*.md` / `providers/**` / `agents/**` / `commands/**` / `skills/**` / `plugins/{installed_plugins.json,known_marketplaces.json,blocklist.json,cache/**,local/**,marketplaces/**}` / `.claude-plugin/**` / `projects/*/memory/**`
- **排除**：`*.jsonl` 会话历史 / `*.sqlite` 数据库 / `*.log` / `*.lock` / `debug/` / `file-history/` / `session-env/` / `sessions/` / `paste-cache/` / `.cache/` / `cache/` / `backups/` / `statsig/` / `shell_snapshots/`
- **共享资源**：`~/.dch/scripts/*` + `~/.agents/**`（默认带，`--no-shared` 关）

完整规则见 `src/profiles/backup-rules.ts`。

### 加密迁移（含真凭据）

`--no-placeholder` 模式保留原始 token，需自己加密外层：

```bash
dch profile backup --no-placeholder
gpg --symmetric --cipher-algo AES256 ~/.dch/backups/dch-backup-<TS>.dchpack
# 传输 .gpg → 新机器 gpg --decrypt → dch profile restore（无占位符 → 立即可用）
```

## 项目结构

```
├── src/
│   ├── platform.ts           # 跨平台抽象：IS_DARWIN/IS_WIN/IS_LINUX、HOME、defaultShellRunner、defaultEditor
│   ├── platform.test.ts      # platform 工具单测
│   ├── cli.ts                # CLI 入口
│   ├── cli-colors.ts         # ANSI 颜色常量（cli.ts + cli-profile.ts 共享）
│   ├── cli-profile.ts        # `dch profile ...` 子命令实现，支持 --json
│   ├── types.ts              # 共享类型（ConfigScope / ToolConfig）
│   ├── schemas/              # 唯一保留：dch profiles.json 的 schema-aware 编辑器用
│   │   ├── types.ts          # FieldSchema / ToolSchema 类型
│   │   ├── dch-store.ts      # ~/.dch/profiles.json schema（ProfileStoreEditor 走 lint）
│   │   └── to-json-schema.ts # FieldSchema → JSON Schema（codemirror-json-schema 用）
│   ├── utils.ts              # 文件读取等工具
│   ├── profiles/             # Profile 系统核心（Bun-only）
│   │   ├── types.ts          # Profile / ProfileStore / HookScript / HookResult / ...
│   │   ├── store.ts          # ~/.dch/profiles.json 读写 + 跨平台 collapseHome
│   │   ├── store.test.ts     # store 工具单测
│   │   ├── hooks.ts          # 执行 pre/post shell 脚本（平台分流）+ pickScriptForRunner
│   │   ├── hooks.test.ts     # bun test 单元测试（含 Win/POSIX 分流）
│   │   ├── symlink.ts        # 符号链接切换（macOS/Linux symlink + Win junction）
│   │   ├── symlink.test.ts   # getSymlinkType / normalizeSymlinkTarget 跨平台测试
│   │   ├── manager.ts        # CRUD + switch 调度（共用核心）
│   │   ├── backup.ts         # createBackup / parseBackup / applyBackup（.dchpack 归档 + 还原）
│   │   ├── backup-rules.ts   # INCLUDE / EXCLUDE glob + 敏感字段判断
│   │   └── redact.ts         # JSON / TOML / 整文件级凭据脱敏
│   ├── readers/              # 各工具的配置读取器（平台分流：Win 路径/PowerShell）
│   │   ├── shell.ts          # POSIX zsh/bash / Win PowerShell $PROFILE
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   └── opencode.ts       # POSIX XDG / Win %APPDATA%
│   └── client/               # Tauri 前端（React）
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── bridge.ts         # Tauri IPC 桥接 + dchProfile.* 包装 + readFileWithMtime + getHomeDir
│       ├── styles.css
│       ├── dev-server.ts
│       └── components/
│           ├── ConfigPanel.tsx           # 配置主面板（view / edit / markdown render 三模式）
│           ├── ProfilePanel.tsx
│           ├── Select.tsx                # 自定义下拉框（替代原生 <select> 深色主题）
│           ├── editor/                   # CodeMirror 6 包装
│           │   ├── CMEditor.tsx          # React 19 受控包装（自包，非 @uiw）
│           │   ├── theme.ts              # one-dark + 项目颜色 token
│           │   ├── languages.ts          # ConfigScope.format → CM6 lang 扩展
│           │   └── schema-lint.ts        # codemirror-json-schema 包装（仅 ProfileStoreEditor 用）
│           ├── markdown/                 # react-markdown + shiki 代码块
│           ├── panel-visibility.tsx
│           └── profile/                  # ProfilePanel 拆出来的子组件
│               ├── AddProfileModal.tsx
│               ├── ProfileCard.tsx
│               ├── ProfileStoreEditor.tsx  # ~/.dch/profiles.json 的 schema-aware modal
│               ├── ExportBackupModal.tsx   # 导出 .dchpack（profile 多选 + 共享开关 + 占位符开关）
│               ├── RestoreBackupModal.tsx  # 导入 .dchpack（preview + 改名 + 占位符跳转）
│               ├── HookOutputModal.tsx
│               ├── PreferencesEditor.tsx
│               └── helpers.ts
├── src-tauri/                # Tauri 后端（Rust）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       └── lib.rs            # 文件读写 / 版本检测 / run_dch_command（spawn cli）
├── changelog/                # 功能变更记录
└── package.json
```

## License

MIT
