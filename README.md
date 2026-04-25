# Dev Config Hub

一个本地桌面应用，用于可视化查看和编辑开发工具的配置文件，并在 **Claude Code / Codex CLI 的多套认证 profile 间快速切换**（订阅 vs API Key 等场景）。

基于 [Tauri v2](https://v2.tauri.app/) (Rust + WebView) 构建，支持以下工具：

| 工具 | 配置文件 | 格式 |
|------|---------|------|
| **Shell (Zsh)** | `~/.zprofile`, `~/.zshrc` | dotfile |
| **Claude Code** | `~/.claude/settings.json`, `settings.local.json`, `CLAUDE.md`, `.mcp.json` | JSON / Markdown |
| **Codex CLI** | `~/.codex/config.toml` | TOML |
| **OpenCode** | `~/.config/opencode/opencode.json` | JSON |

## 功能

- 按工具分组展示所有配置文件，附官方文档描述
- 支持查看源文件原文 / 直接编辑保存
- 自动检测工具版本
- 同时提供 CLI 模式 (`dch`) 和桌面 GUI
- **Profile 快速切换**：维护多套 Claude / Codex 配置（如 `claude-pro` / `claude-api`、`codex-plus` / `codex-api`），一键切换
  - **env 注入式**：spawn 新终端，注入 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` + 自定义 env，旧终端不受影响
  - **符号链接式**：原子地修改 `~/.claude` / `~/.codex` 指向，全局生效
- **切换前/后 Hook**：每个 profile 可定义 `preSwitch` / `postSwitch` shell 脚本，自动 kill 残留进程、备份、osascript 通知等。`preSwitch` 失败会中断切换

## 配置描述来源

描述文字均来自各工具的官方文档/Schema，未做自行推测：

- Claude Code: [claude-code-settings.json](https://json.schemastore.org/claude-code-settings.json)
- Codex CLI: [config-reference](https://developers.openai.com/codex/config-reference)
- OpenCode: [config docs](https://opencode.ai/docs/config/)
- Shell: 不做语法解析，直接展示原文

## 环境要求

- [Bun](https://bun.sh/) >= 1.1
- [Rust](https://rustup.rs/) >= 1.77
- macOS (Tauri 依赖 WebKit；profile 的「env 注入式」依赖 osascript)

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式 (Tauri 桌面窗口 + HMR)
bun run dev

# 构建生产包
bun run build

# CLI 模式
bun run cli           # 总览
bun run cli claude    # 查看 Claude Code 配置
bun run cli edit ~/.claude/settings.json  # 用 $EDITOR 编辑
bun run cli gui       # 启动桌面窗口

# Profile 子命令
bun run cli profile               # 列出所有 profile
bun run cli profile init claude   # 把 ~/.claude 转成 symlink 并建立默认 profile
bun run cli profile add claude claude-api --dir ~/.claude-api --env ANTHROPIC_API_KEY=sk-...
bun run cli profile use claude-api          # 用 env 模式切换（spawn 新终端）
bun run cli profile use claude-api --mode symlink   # 全局符号链接切换
```

首次 `bun run dev` 需要编译 Rust 依赖，大约 2-3 分钟。后续启动秒开。

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
dch gui               # 启动桌面窗口 (等同于 bun run dev)
dch edit <file>       # 用 $EDITOR 编辑指定配置文件

# Profile 管理
dch profile                                  # 列出所有 profile（按 tool 分组，标记 active）
dch profile show <id>                        # 打印 profile JSON
dch profile add <claude|codex> <id> [...]    # 添加 profile：--dir / --env K=V / --from / --desc
dch profile edit <id>                        # $EDITOR 打开 ~/.dch/profiles.json
dch profile remove <id> [--yes]              # 删除 profile（不删 configDir）
dch profile use <id> [--mode env|symlink] [--terminal Terminal|iTerm|Ghostty]
dch profile current [tool]                   # 查询当前 active
dch profile init <claude|codex>              # 把 ~/.claude / ~/.codex 转成 symlink，建立 default profile
dch profile hook test <id> <pre|post>        # 单独运行 hook 测试
dch profile config <key> <value>             # 设置 preferences (terminal/defaultMode/hookTimeoutMs)
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
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." },
      "description": "Claude Code via API key",
      "hooks": {
        "preSwitch":  "pkill -f 'claude' || true",
        "postSwitch": "osascript -e 'display notification \"切到 API\" with title \"dch\"'"
      }
    }
  ],
  "active": { "claude": "claude-api", "codex": null },
  "preferences": {
    "terminal": "Terminal",
    "defaultMode": "env",
    "hookTimeoutMs": 30000
  }
}
```

### Hook 注入的环境变量

执行 `preSwitch` / `postSwitch` 脚本时注入以下变量：

```
DCH_PROFILE_ID         切到的 profile id
DCH_PROFILE_TOOL       claude | codex
DCH_PROFILE_CONFIG_DIR 该 profile 的绝对路径
DCH_SWITCH_TO          目标 profile id（同 DCH_PROFILE_ID）
DCH_SWITCH_FROM        先前 active profile id（仅 symlink 模式）
DCH_SWITCH_MODE        env | symlink
```

`preSwitch` 退出码非零会中断切换、回滚 active 状态、不跑 postSwitch。`postSwitch` 失败仅警告。

### 两种切换模式

| 模式 | 原理 | 影响范围 | 适用 |
|---|---|---|---|
| `env` | spawn 新终端，注入 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` + profile.env | 仅新窗口 | 临时切，多 profile 并存 |
| `symlink` | 原子改 `~/.claude` / `~/.codex` 指向 | 所有新启动的进程 | 长期切换默认环境 |

第一次用 symlink 模式前必须跑 `dch profile init <tool>`：会把现有真实目录 mv 到 `~/.<tool>-default`，再 ln -s 回去并注册成 default profile。

## 项目结构

```
├── src/
│   ├── cli.ts                # CLI 入口
│   ├── cli-colors.ts         # ANSI 颜色常量（cli.ts + cli-profile.ts 共享）
│   ├── cli-profile.ts        # `dch profile ...` 子命令实现，支持 --json
│   ├── types.ts              # 共享类型
│   ├── descriptions.ts       # 配置项描述 (官方文档)
│   ├── utils.ts              # 文件读取等工具
│   ├── profiles/             # Profile 系统核心（Bun-only）
│   │   ├── types.ts          # Profile / ProfileStore / HookResult / ...
│   │   ├── store.ts          # ~/.dch/profiles.json 读写
│   │   ├── hooks.ts          # 执行 pre/post shell 脚本，注入 DCH_* env
│   │   ├── symlink.ts        # 符号链接模式（init / switch / current）
│   │   ├── env.ts            # env 注入模式（osascript spawn 终端）
│   │   ├── manager.ts        # CRUD + switch 调度（共用核心）
│   │   └── hooks.test.ts     # bun test 单元测试
│   ├── readers/              # 各工具的配置读取器
│   │   ├── shell.ts
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   └── opencode.ts
│   └── client/               # Tauri 前端 (React)
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── bridge.ts         # Tauri IPC 桥接 + dchProfile.* 包装
│       ├── styles.css
│       ├── dev-server.ts
│       └── components/
│           ├── ConfigPanel.tsx
│           └── ProfilePanel.tsx
├── src-tauri/                # Tauri 后端 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       └── lib.rs            # 文件读写 / 版本检测 / run_dch_command (spawn cli)
├── changelog/                # 功能变更记录
└── package.json
```

## License

MIT

