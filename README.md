# Dev Config Hub

一个本地桌面应用，用于可视化查看和编辑开发工具的配置文件。

基于 [Tauri v2](https://v2.tauri.app/) (Rust + WebView) 构建，支持以下工具：

| 工具 | 配置文件 | 格式 |
|------|---------|------|
| **Shell (Zsh)** | `~/.zprofile`, `~/.zshrc` | dotfile |
| **Claude Code** | `~/.claude/settings.json`, `settings.local.json`, `CLAUDE.md`, `.mcp.json` | JSON / Markdown |
| **Codex CLI** | `~/.codex/config.toml` | TOML |
| **OpenCode** | `~/.config/opencode/opencode.json` | JSON |

## 功能

- 按工具分组展示所有配置文件
- 每个配置项附带官方文档描述
- 支持查看源文件原文
- 支持直接编辑并保存
- 自动检测工具版本
- 同时提供 CLI 模式 (`dch`)

## 配置描述来源

描述文字均来自各工具的官方文档/Schema，未做自行推测：

- Claude Code: [claude-code-settings.json](https://json.schemastore.org/claude-code-settings.json)
- Codex CLI: [config-reference](https://developers.openai.com/codex/config-reference)
- OpenCode: [config docs](https://opencode.ai/docs/config/)
- Shell: 不做语法解析，直接展示原文

## 环境要求

- [Bun](https://bun.sh/) >= 1.1
- [Rust](https://rustup.rs/) >= 1.77
- macOS (Tauri 依赖 WebKit)

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
```

## 项目结构

```
├── src/
│   ├── cli.ts                # CLI 入口
│   ├── types.ts              # 共享类型定义
│   ├── descriptions.ts       # 配置项描述 (来自官方文档)
│   ├── utils.ts              # 文件读取等工具函数
│   ├── readers/              # 各工具的配置读取器
│   │   ├── shell.ts
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   └── opencode.ts
│   └── client/               # Tauri 前端 (React)
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── bridge.ts         # Tauri IPC 桥接层
│       ├── styles.css
│       ├── dev-server.ts     # Bun 开发服务器
│       └── components/
│           └── ConfigPanel.tsx
├── src-tauri/                # Tauri 后端 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       └── lib.rs            # 文件读写、版本检测命令
└── package.json
```

## License

MIT
