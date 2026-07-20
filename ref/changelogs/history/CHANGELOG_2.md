---
changelog_id: 2
changed_at: 2026-04-26
---

# CHANGELOG_2: env 模式补做 symlink swap，修复 user-level settings.json env 泄漏

## 概要

修复 env 模式下 `~/.claude/settings.json` 的 env 块（如 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`）以最高优先级覆盖目标 profile 设置的 bug：env 模式现在在 spawn 新终端前也会原子地切换 `~/.claude` / `~/.codex` symlink，让 Claude Code 真正读到目标 profile 的 settings.json。

动机：实测发现 Claude Code 始终读 `~/.claude/settings.json`（路径硬编码，`CLAUDE_CONFIG_DIR` **不**替换 user-level settings 位置），且其 env 块以最高优先级覆盖 `process.env`——shell 端 `export` / `unset` / 空串都无法绕过；同名 key 冲突时 `~/.claude/settings.json` 也赢过 `<CLAUDE_CONFIG_DIR>/settings.json`。结果是：在 `claude-pro` 这种「OAuth 凭证 + 无 API token」的 profile 下走 env 模式时，spawn 出来的新终端里 Claude Code 仍然拿到 `claude-default` 的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`，被强制走第三方 platform-api 而不是 OAuth，profile 切换形同虚设。

## 变更内容

### `src/profiles/manager.ts`

- `useProfile` 不再按 mode 分支决定要不要 `switchSymlink`：env 和 symlink 模式现在都先做 symlink swap + 更新 `store.active`，env 模式只是额外多 spawn 一个新终端
- `fromId` 取值从「仅 symlink 模式取 active，env 模式始终为 null」改成「两种模式都取 active」，hook 的 `DCH_SWITCH_FROM` 在 env 模式下也能拿到正确值

### `src/cli-profile.ts`

- env 模式的成功消息从「已启动 Terminal 新窗口，注入 CLAUDE_CONFIG_DIR=...」改成「已切换 ... 并启动 ... 新窗口 (symlink: ...)」，明确反映现在 env 模式也改 symlink
- help 文本里 `DCH_SWITCH_FROM` 的备注从「仅 symlink 模式」改成「首次 init 后可能为空」

### `README.md`

- 顶部 Profile 功能列表里 env / symlink 两种模式描述同步更新
- 「两种切换模式」表格中 env 行的「原理 / 影响范围 / 适用」全部重写
- 表格下方新增一段说明，解释「为什么 env 模式也要改 symlink」（Claude Code 的 settings 加载机制 + env 优先级）
- 「Hook 注入的环境变量」节里 `DCH_SWITCH_FROM` 的备注同步修订

## 备注

- **行为变更**：env 模式的「仅新窗口、旧终端不受影响」承诺已废弃。这是无奈的取舍——Claude Code 当前的 settings 加载机制下，不改 symlink 的 env 模式根本就无法把 profile 隔离开。Codex 用的 `CODEX_HOME` 不存在该问题，但保持两个工具行为一致更省心。
- **运行中的 claude session 不会受影响**：Claude Code 在启动时读一次 settings.json，运行中不重读；symlink swap 只影响 swap 之后启动的 claude 进程
- **首次使用前提条件**：env 模式现在依赖 symlink 已 init，第一次用前必须先跑 `dch profile init <tool>`（之前 env 模式可以跳过 init，现在不行了）。错误信息里有清晰提示
- **未实现**：未做「自动检测 user-level settings.json 是否含冲突 env 并提示用户清理」的 CLI 工具，留作后续优化
