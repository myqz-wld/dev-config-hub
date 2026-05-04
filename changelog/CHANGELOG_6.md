# CHANGELOG_6: 跨平台兼容性 — Windows 支持

## 概要

REVIEW_1 跨平台兼容性双对抗 review 的修复落地。把项目从「macOS-only」推进到「macOS GA + Windows beta + Linux beta」：symlink → junction、hooks 协议加 PowerShell/cmd 平台分流、Tauri Rust 后端全套 `#[cfg(target_os)]` 守门、readers 平台特定路径。Hook 协议向后兼容（string 形式仍可用）。Mac 端零回退（38 bun test 全过）。

## 变更内容

### 平台抽象层（新增）

#### `src/platform.ts`（新）
- 收口 `IS_DARWIN` / `IS_WIN` / `IS_LINUX` 常量
- `HOME = os.homedir()`（Win 默认无 `process.env.HOME`，用 USERPROFILE/HOMEDRIVE+HOMEPATH）
- `ShellRunner` 接口 + `defaultShellRunner()`：Win → `powershell -NoProfile -Command`；POSIX → `bash -lc`。Hooks/B3 与 Tauri 后端/B4 共用
- `defaultEditor()`：Win fallback `notepad` / POSIX fallback `vi`

### CLI / store 路径修复

#### `src/cli.ts`
- L172: `process.env.HOME \|\| ""` → `HOME` from `./platform`
- L151: `import.meta.dir + "/.."` → `path.resolve(import.meta.dir, '..')`
- L171: EDITOR fallback → `defaultEditor()`

#### `src/cli-profile.ts`
- L157: 同上 EDITOR fallback

#### `src/profiles/store.ts`
- `collapseHome` 改用 `path.relative(HOME, p)` + `sep` 处理；命中 HOME 子路径返回 `'~/' + relative.split(sep).join('/')`，跨平台一致；不在 HOME 下返回原路径（Win 也兜底跨盘符 `C:`）

### Symlink → junction 平台分流

#### `src/profiles/symlink.ts`
- 抽 `getSymlinkType(platform)` + `normalizeSymlinkTarget(p, platform)` 纯函数（让测试在 mac 主机也能验 Win 行为，无须 mock `process.platform`）
- `initToolDir` 两处 + `switchSymlink` 一处 symlink 调用都加第三参 `SYMLINK_TYPE`（Win = `'junction'` / POSIX = undefined）+ `symlinkTarget(p)` 包装（Win 强制 absolute）
- `switchSymlink` rename EXDEV 兜底改成 user-friendly 错误（引导用户把 configDir 放与 `~/.claude` 同卷）

### Hook 协议平台分流（向后兼容）

#### `src/profiles/types.ts`
- `HookScript = string | { posix?, powershell?, cmd? }`：
  - **string 形式**：按当前平台默认 shell 跑（POSIX → bash / Win → PowerShell）。向后兼容
  - **object 形式**：分平台单独提供脚本。优先级 powershell > cmd（Win family）/ posix（POSIX）

#### `src/profiles/hooks.ts`
- 新增纯函数 `pickScriptForRunner(s, runner)`：根据 runner.kind 选脚本字段，cmd / powershell 内部互为兜底；bash 严格只取 `posix`（不 fallback Win 字段，bash 跑不了 PowerShell 语法）
- `runHook` 用 `defaultShellRunner()` 选 shell；`Bun.spawn(["bash","-lc",script])` → `Bun.spawn([runner.cmd, ...runner.args(picked)])`

### Tauri Rust 后端 cfg 守门

#### `src-tauri/src/lib.rs`
- 新增 `get_user_shell()`：
  - macOS（`#[cfg(target_os = "macos")]`）：SHELL env > dscl Directory Services > `/bin/zsh`
  - Linux：SHELL env > `/bin/bash`
  - Windows：SHELL env > `powershell`
- 新增 `shell_basename()` + `shell_invocation()` 把「source rc + 跑命令」分平台/分 shell 拼装
  - POSIX zsh/bash/fish: `-c "source rc; cmd"`（GUI app 显式 source rc）
  - PowerShell: `-NoProfile -Command "cmd"`
  - cmd.exe: `/c "cmd"`
- `get_tool_version` / `run_dch_command` 都改用这套 helper；`run_dch_command` 对 POSIX / PowerShell / cmd 三类 shell 各写专门的 quoting
- `get_home_dir()` Windows 改用 `USERPROFILE`（fallback HOME）；POSIX 仍用 HOME

### readers 平台分流

#### `src/readers/shell.ts`
- Win 改读 PowerShell `$PROFILE`（CurrentUserCurrentHost）+ PowerShell 7 path
- POSIX 顺手补 `.bashrc`（macOS bash 也常见 / Linux 主流）
- Tool name + description 按平台调整（Win「Shell (PowerShell)」/ POSIX「Shell (Zsh / Bash)」）
- version 检测：Win 用 `$PSVersionTable.PSVersion`；POSIX 用 `zsh --version`

#### `src/readers/opencode.ts`
- Win 优先 `%APPDATA%\opencode\opencode.json`，找不到回退 XDG `~/.config/opencode/opencode.json`
- POSIX 路径不变；label 按命中路径动态显示

#### `src/utils.ts`
- `HOME` re-export from `platform.ts`（消除重复 `import { homedir } from "os"`）
- `getToolVersion` 加注释说明 `command.split(" ")` 限制（不能传带空格路径）+ Bun PATHEXT 行为

### 测试

- 新增 `src/platform.test.ts`（5 case）：`defaultEditor` EDITOR/VISUAL/fallback 三层优先级 + `defaultShellRunner` Win/POSIX 形态
- 新增 `src/profiles/store.test.ts`（8 case）：`expandHome` / `collapseHome` 跨平台往返一致
- 新增 `src/profiles/symlink.test.ts`（7 case）：`getSymlinkType('win32'/'darwin'/'linux'/默认)` + `normalizeSymlinkTarget` Win/POSIX 行为
- 改 `src/profiles/hooks.test.ts`：现有 9 case 改成跨平台兼容写法（`IS_WIN` 分支）；新增 5 case 测 `pickScriptForRunner` 4 路径 + 4 case 测 object 形式 runHook

38 bun test 全过（原 9 → 38）。Rust `cargo check` 通过 host (mac)；Win target 真编译留待 CI。

## 备注

- **Mac 端零回退**：dev / cli / hooks / Tauri Rust 全部按原行为；macOS 端 `bun src/cli.ts shell` 仍正确显示 zsh 配置
- **Win 端未端到端实测**：mac 主机受限，所有 Win 修复只保证「设计正确 + cargo check + bun test 全过」；真实 Win 主机 E2E 留给 CI runner
- **Hook 协议向后兼容性**：现有 string 形式 `"echo hi"` 在 Win 上会被 PowerShell 跑（不是 bash）。简单 echo / exit 通用；POSIX 特定语法（pipe / `&&` / `source`）建议改 object 形式 `{ posix: "...", powershell: "..." }`
- **junction 限制**：仅支持目录、必须用绝对路径、不能跨分区。dev-config-hub 的 profile configDir 都在用户主目录下子目录，全部满足
- **关联**：REVIEW_1 修复落地全集；dev-config-hub 平台支持矩阵更新见 README「## 平台支持矩阵」节
