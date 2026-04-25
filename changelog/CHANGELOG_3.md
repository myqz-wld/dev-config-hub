# CHANGELOG_3: 移除 env 切换模式，统一只走 symlink

## 概要

彻底删除 `env` 切换模式（`spawnTerminal` osascript 开新终端、`SwitchMode` / `TerminalApp` 类型、`--mode` / `--terminal` CLI flag、`preferences.terminal` / `preferences.defaultMode` 配置项、UI 上「▶ 启动新终端」按钮等）。`dch profile use <id>` 现在永远是「跑 preSwitch → 原子换 symlink → 跑 postSwitch」，不再开终端、不再有 mode 概念。

动机：CHANGELOG_2 把 env 模式 patch 成「symlink swap + spawn 终端」之后，env 模式相对 symlink 模式只多了一个「顺手开新终端」的副作用——这个副作用并不强相关于 profile 切换（用户随时可以自己 `open -a Terminal`），但带来了 osascript / Terminal/iTerm/Ghostty 三种实现、TerminalApp 类型、preference 字段等一连串复杂度。两种模式的存在反而让 UI / CLI 接口比单一模式更难理解，违反「不为假设性需求设计」的原则，所以直接砍掉。

## 变更内容

### `src/profiles/`

- 删 `env.ts`（spawnTerminal + osascript 三家终端适配）
- `types.ts`：删 `SwitchMode` / `TerminalApp` 类型；`Preferences` 只剩 `hookTimeoutMs`；`HookContext` 删 `mode`；`SwitchResult` 删 `mode` 与 `spawnedTerminal`
- `store.ts`：`DEFAULT_PREFERENCES` 只剩 `hookTimeoutMs`；`loadStore` 显式只取 `hookTimeoutMs`，旧 `~/.dch/profiles.json` 里的 `terminal` / `defaultMode` 字段下次写回时会被丢弃
- `hooks.ts`：`HookContext` 不再有 `mode`，`buildEnv` 不再注入 `DCH_SWITCH_MODE`
- `manager.ts`：`useProfile` 签名从 `(id, opts)` 缩成 `(id)`，永远 swap symlink，再也不分支
- `hooks.test.ts`：去掉 `mode: "symlink"` 字段和 `DCH_SWITCH_MODE` 断言

### `src/cli-profile.ts`

- `cmdUse` 删 `--mode` / `--terminal` flag 解析；成功消息只剩单一形态
- `cmdConfig` 删 `terminal` / `defaultMode`，只接受 `hookTimeoutMs`
- `cmdList` 底部状态行不再打印「默认模式 / 终端」，只剩 hook 超时
- help 文本同步精简

### `src/client/`

- `bridge.ts`：去掉 `SwitchMode` / `TerminalApp` re-export；`dchProfile.use(id)` 不再接收 opts；`dchProfile.config` 类型改成 `(key: "hookTimeoutMs", value: number)`
- `components/ProfilePanel.tsx`：`ProfileCard` 两个按钮合并成单个「🔗 切换到此 profile」；`PreferencesEditor` 只剩 hook 超时输入；`AddProfileModal` 的 env hint 改成「env 仅在 hook 脚本里生效，不会注入给 claude / codex 进程」；顶部状态条不再展示「默认模式 / 终端」

### `README.md`

- 顶部 Profile 功能列表合并成一行「一键原子切换 symlink，全局生效」
- 「环境要求」节删 osascript 备注
- 「快速开始」 / 「CLI 用法」节删除 `--mode` / `--terminal` 示例与 `terminal/defaultMode` 配置项
- 「数据模型」示例改成只有 `hookTimeoutMs`，加注「`profile.env` 只在 hook 脚本里可见，不会进 claude / codex 进程」
- 「Hook 注入的环境变量」节删 `DCH_SWITCH_MODE`
- 「两种切换模式」表格 + 「为什么 env 模式也要改 symlink」整段删掉，替换为「切换语义」节描述单一切换流程
- 「项目结构」树形图删 `env.ts` 一行

## 备注

- **不向后兼容**：`dch profile use <id> --mode env --terminal Terminal` 之类的旧调用会以「未知 flag」忽略 flag，仍按新行为执行。GUI 直接走 `dchProfile.use(id)`，不受影响
- **profile.env 的角色变窄**：现在只对 hook 脚本可见。Claude / Codex 进程自身的 env / token 应放在各自 `<configDir>/settings.json` 的 `env` 块里（如 `~/.claude-default/settings.json`），通过 symlink swap 在切换时自然替换
- **想开新终端的用户**：自己 `open -a Terminal` 或在当前终端重新跑 `claude` 即可——Claude Code 启动时读 settings，符号链接已经指向新 profile
