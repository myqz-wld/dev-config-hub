---
review_id: 1
reviewed_at: 2026-05-04
expired: false
heterogeneous_dual_completed: true
skipped_expired:
  # 本轮是项目首次 review（reviews/ 此前不存在），未触发文件级过期复审
---

# REVIEW_1: 跨平台兼容性 — Windows 支持基础设施盘点

## 触发场景

用户主动评估「如果今天就要在 Windows 上跑 / 打包 / 分发，会撞到哪些硬伤、哪些半软伤、哪些其实已经覆盖好了」。dev-config-hub 与 agent-deck 同期联合 review（agent-deck 见 [REVIEW_21](../../../../agent-deck/ref/reviews/history/REVIEW_21.md)）。

dev-config-hub 的 macOS 假设嵌在**核心抽象层**：symlink-as-switch / bash-as-hook / zsh-as-shell-source + Rust 后端零平台守门。本轮目的是把所有 Win hard wall 列清楚，并把架构改动一并做掉。

## 方法

**双对抗配对**（teammate 模式 + lead 三态裁决）：

- **reviewer-claude** (Opus 4.7 xhigh, teammate)：从代码 + 资料出发独立给两份工程 finding，每条 ✅/❌/❓ + HIGH/MED/LOW 标注 + `文件:行号` 证据 + 验证手段。
- **reviewer-codex** (gpt-5.5 xhigh, teammate wrapper)：同上独立路径，但走外部 codex CLI（异源原则）。

**反驳轮**：dev-config-hub 部分双方对 4 个 HIGH 完全一致，无单方独有 HIGH，**无需反驳轮**。MED/LOW 严重度有分歧，主 agent 综合采保守一档。

**范围**：所有「平台敏感」文件（path 处理 / shell 调用 / symlink / Tauri Rust 后端 / readers），共 17 文件 / ~1300 行。

```text
(scope 见末尾 review-scope 块)
```

**约束**：
- 严重度判定基线：HIGH = Win 装不上 / 启动崩 / 核心 happy path 死掉；MED = 核心功能不可用但 app 不崩；LOW = 边角行为退化或体验差
- 弱断言关键词只允许出现在 *未验证* 条目里

## 三态裁决结果

> 12 条裁决（双方一致），无 ❌ 反驳。

### ✅ 真问题（必修）

| # | 严重度 | 文件:行号 | 问题 | 验证手段 |
|---|---|---|---|---|
| B1 | HIGH | `src/profiles/symlink.ts:58,64,108` | `symlink(target, path)` 不带第三参；Win 普通用户默认无 `SeCreateSymbolicLinkPrivilege` → EPERM。Profile 系统是产品命脉，整套 init/use 完全死 | grep + Read；Win symlink 行为公开文档 |
| B2 | HIGH | `src/profiles/hooks.ts:39` | `Bun.spawn(["bash","-lc",script], ...)`；Win 默认无 bash → ENOENT。preSwitch 失败中断切换，整套 hook 协议死 | Read + grep |
| B3 | HIGH | `src-tauri/src/lib.rs:35,41,61,115,134` | `dscl` macOS 专属、`/bin/zsh` fallback、`Command::new(&shell).args(&["-c",...])` 在 Win 全 ENOENT。**lib.rs 全文零 `#[cfg(target_os)]` 守门**。`get_tool_version` / `run_dch_command` 是 UI 调 CLI 唯一通道 → Tauri GUI 所有 profile 操作全失败 | grep cfg / cfg_attr 全仓零命中除 mobile entry point |
| B4 | HIGH | `src/cli.ts:172` | `filePath.replace("~", process.env.HOME \|\| "")`；Win 默认无 `HOME` env（用 `USERPROFILE` / `HOMEDRIVE+HOMEPATH`）→ `~/.claude/settings.json` 替成 `/.claude/settings.json` → 编辑器打开错误路径 | grep + Read |
| B5 | MED | `src/readers/shell.ts:6-11` | 读 `~/.zprofile` / `~/.zshrc`；Win 不存在这两个文件 → UI 全空。Win 应识别 PowerShell `$PROFILE` | Read |
| B6 | MED | `src/cli.ts:171`, `src/cli-profile.ts:157` | 编辑器 fallback `vi`，Win 上 EDITOR/VISUAL 通常未设 + vi 不在 PATH → ENOENT。Win 应 fallback `notepad` | Read |
| B7 | MED | `src/cli.ts:151` | `Bun.spawn(["bunx","tauri","dev"], { cwd: import.meta.dir + "/.." })`：Win 上拼成 `C:\foo\src/..` 混合分隔符（Bun 实测能容忍但不规范） | Read |
| B8 | MED | `src/profiles/store.ts:29` | `collapseHome` 用 `HOME + "/"` 字面量；Win HOME `%USERPROFILE%` 拼 `"/"` 后混合分隔符，永不 startsWith Win 反斜杠路径 → UI 显示绝对路径不缩写 | Read |
| B9 | LOW | `src/utils.ts:22` | `Bun.spawn(command.split(" "))`；当前调用方都是短命令名，Win Bun 自动 PATHEXT 探 `.exe`/`.cmd` 能跑；含空格路径误切但不触发 | Read + Bun docs |
| B10 | LOW | `src/readers/opencode.ts:13` | XDG `~/.config/opencode/opencode.json`；Win opencode 配置可能在 `%APPDATA%\opencode\` | Read |
| B11 | LOW | `src/profiles/symlink.ts:107` | `rename(tmp, target)` 在跨盘符（EXDEV）会失败；要求用户把 configDir 与 `~/.claude` 同盘 | Read |
| B12 | ✅ pass | `src-tauri/Cargo.toml + tauri.conf.json` | Cargo.toml 干净（无 cocoa/objc/core-foundation 等 mac-only crate），`tauri.conf.json` icon 列 `.icns + .ico` 全套 → **Rust 跨平台编译能过、msi/nsis 打包侧不缺 icon**。这是 ✅ 通过项，留作 baseline | Read + ls icons/ |

### ❌ 反驳

无（双方对 HIGH 完全一致）。

### ❓ 部分 / 未验证

无。

## 修复（CHANGELOG_6 落地）

按 phase 拆 6 commit：

### HIGH
1. **B4** — Phase B0/B1：新增 `src/platform.ts` 收口 `IS_DARWIN/IS_WIN/IS_LINUX` + `HOME = os.homedir()` + `defaultShellRunner()` + `defaultEditor()`；`cli.ts:172` 用 `HOME`；同时修 B6 + B7 + B8（cli + store path）
2. **B1 (symlink)** — Phase B2：抽 `getSymlinkType(platform)` + `normalizeSymlinkTarget(p, platform)` 纯函数；Win 走 `symlink(target, path, 'junction')` + 强制 absolute target；switchSymlink rename EXDEV 兜底改成 user-friendly 错误（B11 一并）
3. **B2 (hooks)** — Phase B3：types.ts `HookScript = string | { posix?, powershell?, cmd? }`（向后兼容）；hooks.ts 用 `defaultShellRunner()` 选 shell + `pickScriptForRunner` 纯函数处理 fallback；hooks.test.ts 现有 9 case 改跨平台兼容写法 + 新增 9 case
4. **B3 (Tauri Rust)** — Phase B4：`lib.rs` 抽 `get_user_shell()` + `shell_basename()` + `shell_invocation()` 三个 helper；macOS 用 `#[cfg(target_os = "macos")]` 圈 dscl；Win 走 PowerShell；POSIX 走 user shell + source rc；`get_home_dir()` Win 改用 USERPROFILE

### MED
5. **B5 + B10 + B9** — Phase B5：`readers/shell.ts` Win 读 PowerShell `$PROFILE`（CurrentUserCurrentHost + PowerShell 7 AllUsersAllHosts），POSIX 顺手补 `.bashrc`；`readers/opencode.ts` Win 优先 `%APPDATA%\opencode\opencode.json` 兜底 XDG；`utils.ts` HOME re-export from `platform.ts`，加 split(" ") 限制注释
6. **B6 + B7 + B8** 已合到 Phase B0/B1

### LOW
- **B11** 已合到 Phase B2（EXDEV 兜底）
- **B12** ✅ 通过项不修

## 关联 changelog

- [CHANGELOG_6.md](../../changelogs/history/CHANGELOG_6.md)：本轮修复落地

## 风险与已知限制

1. **Mac 主机无法端到端验证 Win**：所有 Win 修复只能保证「设计正确 + Rust cargo check 过 + bun test 全过」（38 case）；真实 Win 主机 E2E 留给 CI runner（GitHub Actions windows-latest）
2. **Hook 协议向后兼容但语义微调**：现有 string 形式的 `preSwitch: "echo hi"` 在 Win 上会被 PowerShell 跑（不是 bash）。简单 `echo` 通用，但 POSIX 特定语法（pipe / `&&` / `source`）需改 object 形式分平台明确写
3. **junction 限制**：仅支持目录、必须用绝对路径、不能跨分区。dev-config-hub 的 profile configDir 都在用户主目录下子目录，全部满足
4. **Win Rust target 真编译留待 CI**：mac 主机需 mingw / lld 才能跨编 `cargo check --target x86_64-pc-windows-msvc`，本次只跑 `cargo check`（host = mac）

## Agent 踩坑沉淀

无新增 agent-pitfall 候选（本轮是「跨平台基底」类工程性 review）。

```review-scope
package.json
src/cli.ts
src/cli-profile.ts
src/utils.ts
src/types.ts
src/profiles/symlink.ts
src/profiles/hooks.ts
src/profiles/manager.ts
src/profiles/store.ts
src/profiles/defaults.ts
src/readers/claude-code.ts
src/readers/codex.ts
src/readers/shell.ts
src/readers/opencode.ts
src-tauri/src/lib.rs
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```
