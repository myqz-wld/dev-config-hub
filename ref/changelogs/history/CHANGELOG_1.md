---
changelog_id: 1
changed_at: 2026-04-25
---

# CHANGELOG_1: Profile 快速切换 + Hook 系统

## 概要

为 Claude Code 和 Codex CLI 的多套认证场景（订阅 vs API Key）加 profile 概念：每个 profile 关联独立的 configDir + env vars + 切换 hook，支持「env 注入新终端」和「符号链接全局生效」两种切换模式。CLI / UI 双入口，UI 端通过新加的 Tauri 命令 `run_dch_command` spawn CLI 子进程拿 JSON 结果，业务逻辑只在 TS 一处实现。

动机：iOS 订阅 GPT Plus / Claude Pro 都通过 OAuth 登录 CLI，但 OpenAI Codex 与 Claude Code 在「订阅 vs API Key」两种凭证共存时优先级行为不同（且互相覆盖），手动来回 logout/login + 改 env 繁琐易错；用 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 隔离配置目录是官方推荐的并行方案，但需要工具帮用户管多套目录、按需注入 env、跑切换前后的清理脚本。

## 变更内容

### `src/profiles/`（新增）

- `types.ts`：`Profile` / `ProfileStore` / `HookResult` / `SwitchResult` 等核心类型
- `store.ts`：`~/.dch/profiles.json` 读写 + `~` 路径展开 / 折叠
- `hooks.ts`：执行 `bash -lc <script>`，注入 `DCH_PROFILE_ID` / `DCH_PROFILE_TOOL` / `DCH_PROFILE_CONFIG_DIR` / `DCH_SWITCH_FROM` / `DCH_SWITCH_TO` / `DCH_SWITCH_MODE` 及 profile 自定义 env，支持超时
- `symlink.ts`：`initToolDir`（首次把真实目录 mv 到 `~/.<tool>-default` 再 ln -s）、`switchSymlink`（原子 rename：先 `ln -s` 临时名再 mv 覆盖）、`currentSymlinkTarget`
- `env.ts`：`spawnTerminal` 通过 osascript spawn Terminal / iTerm / Ghostty 新窗口，注入 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` + profile.env
- `manager.ts`：CRUD（id 校验 / 重复拒绝 / 删除时清 active）+ `useProfile` 调度器（preSwitch → 物理切换 → postSwitch，preSwitch 失败中断回滚）+ `initTool` / `getActive` / `testHook` / `setPreference`
- `hooks.test.ts`：9 个 bun test 单元测试，覆盖 hook 执行的成功 / 失败 / 超时 / env 注入

### `src/cli-profile.ts`（新增）+ `src/cli.ts`（修改）+ `src/cli-colors.ts`（新增）

- `dch profile <list|show|add|edit|remove|use|current|init|hook test|config>` 子命令族
- 全局 `--json` 标志：所有命令输出结构化 JSON，错误以 `{error: "..."}` 形式输出，UI 端复用
- ANSI 颜色常量从 `cli.ts` 抽到 `cli-colors.ts`，两个 CLI 入口共享

### `src-tauri/src/lib.rs`（修改）

- 新增 `run_dch_command(args)` Tauri 命令：spawn `bun src/cli.ts profile <args>` 子进程（登录式 shell 注入 PATH），返回 `{stdout, stderr, code}`。**业务逻辑不在 Rust 重写**，UI 端调它再 JSON.parse 即可
- 项目根从 `CARGO_MANIFEST_DIR/..` 解析（dev 模式可靠），生产模式可通过 `DCH_PROJECT_ROOT` 环境变量覆盖
- 复用现有 `serde::Serialize`，未引入新依赖

### `src/client/`（修改 + 新增）

- `bridge.ts`：新增 `dchProfile.{list,add,remove,use,current,init,testHook,config}` typed wrapper，内部调 `run_dch_command` + JSON.parse
- `components/ProfilePanel.tsx`（新增）：tool tab + profile 卡片列表（active dot / default badge / env count / hooks 标记 / configDir / hook 脚本预览）+ 操作按钮（启动 env 终端 / 设为 symlink / 测 pre/post hook / 删除）+ 「+ 新建 profile」表单 modal + 「⚙ 设置」popover（terminal / defaultMode / hookTimeoutMs）
- `App.tsx`：侧边栏顶部新增独立的「Profiles」入口（与工具列表分开），`active` 状态扩展为 `View` discriminated union
- `styles.css`：新增 ProfilePanel / 卡片 / modal / form / prefs popover 样式（继承现有暗色主题与 GitHub 配色）

### `README.md`（修改）

- 顶部介绍 + 功能列表加 profile 系统说明
- CLI 用法表新增 `dch profile` 子命令族
- 新增「Profile 系统」专节：数据模型示例 / Hook 注入的 env / 两种切换模式对比表
- 项目结构补充新增的文件

### `changelog/INDEX.md` + 本文件（新增）

按 `~/.claude/CLAUDE.md` 工程地基约定首次建立 changelog 索引和首个变更记录。

## 备注

- **macOS only**：`env` 模式 spawn 终端走 osascript（Terminal/iTerm/Ghostty），Linux/Windows 留 TODO
- **凭证明文**：profile.env 里的 API key 明文存在 `~/.dch/profiles.json`，未实现 `apiKeyHelper` 风格的「执行命令拿 key」字段（plan 里已注明留扩展）
- **生产打包**：`run_dch_command` 默认通过 `CARGO_MANIFEST_DIR/..` 找 `src/cli.ts`，dev 模式 OK；`bunx tauri build` 后用户需要设 `DCH_PROJECT_ROOT` 环境变量指向源码目录，或后续把 cli 逻辑也内嵌到 Tauri 包里（暂未实现）
- **跨工具同步切换**：当前每次 `use` 只切一个 tool，"一键切到全 API 模式" 需后续加 profile group 概念
