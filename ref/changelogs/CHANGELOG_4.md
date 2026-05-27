# CHANGELOG_4: 新增 `dch profile env` + shell wrapper 模式，让 profile.env 落到 claude / codex 进程

## 概要

CHANGELOG_3 把 `profile.env` 的语义收窄成「只对 hook 脚本可见」，但实测下来 `*-pro` profile 的 OAuth 登录 / API 调用拿不到 HTTP 代理（dch 切 profile 只换 symlink + 跑 hook，从不 spawn claude / codex，hook 里 export 也只活在 hook bash 子进程）。`<configDir>/settings.json` 的 env 块只 claude code 支持，codex 没这个机制，所以单走 settings.json 不能统一覆盖两个工具。

新增 `dch profile env <claude|codex>` 子命令输出当前 active profile.env 为 shell-eval 友好格式，配合 ~/.zshrc 里的 `claude()` / `codex()` 子 shell wrapper（`exec command claude "$@"`），让用户每次跑 claude / codex 时自动注入 active profile 的 env，对称覆盖两个工具，且不污染父 shell。

## 变更内容

### `src/cli-profile.ts`

- 新增 `cmdEnv(args)`：
  - 从 `listProfiles()` 取 active profile.env，逐行 `export KEY='value'` 输出
  - key 走 `^[A-Za-z_][A-Za-z0-9_]*$` 严格校验，非法 key 跳过；value 用 single-quote + `'\''` 转义，杜绝 shell 注入
  - active 为空 / env 空 → 不输出（wrapper 自然 fall-through 到原命令，不会因为 dch 异常而 break claude / codex）
  - 支持 `--json` 模式，输出 `{tool, active, env}`
- `runProfileCommand` 路由 `env` 子命令；help 文本同步加一行

### `~/.dch/profiles.json`（项目外的运行时配置）

- `claude-pro` / `codex-pro` 的 `env` 加 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` + 三个小写变体，值都是 `http://127.0.0.1:1082`（Shadowrocket HTTP 代理）
- `claude-default` / `codex-default` 的 `env` 留空（默认 profile 不走代理）
- 同时移除 `*-default` 的 `preSwitch: stop-vpn.sh`（切回 default 不再停 VPN，避免代理 endpoint 一并被 kill）

### `~/.dch/scripts/`（hook 脚本）

- `ensure-tun.sh` → `ensure-proxy.sh`（HTTP 代理模式不再叫 TUN）
- 删 `stop-vpn.sh`
- 撤掉 `ensure-proxy.sh` / `health-check.sh` 顶部硬编码的 `export HTTP_PROXY=...` 6 行——hook 子进程会从 `profile.env` 自动继承（[`src/profiles/hooks.ts:22-23`](../src/profiles/hooks.ts#L22-L23)），保持单一来源在 profiles.json，避免 1082 端口散落两处

### `README.md`

- CLI 用法节加 `dch profile env` 一行
- 「数据模型」节注释从「profile.env 仅在 hook 里可见」改成「默认仅 hook 可见，加 wrapper 后可注入到 claude / codex 进程」
- 新增「Shell wrapper」节：贴出 `claude() (...)` / `codex() (...)` 子 shell + `exec command` 模板，解释 4 个要点（不污染父 shell、exec 防递归、fall-through 友好、shell-quote 防注入）

## 备注

- **不破坏旧用法**：原有 hook 内对 profile.env 的依赖不变（`hooks.ts` 注入逻辑没动）。新加的 `dch profile env` 命令是只读副通道
- **wrapper 是用户侧选项**：不加 wrapper 也不影响 dch 切 profile 本身。只有要让 claude / codex 进程拿到 profile.env 时才需要
- **关联**：CHANGELOG_3「profile.env 角色变窄」的备注本轮事实修正——env 仍然主要给 hook，但通过 dch profile env + wrapper 也能落到工具进程
