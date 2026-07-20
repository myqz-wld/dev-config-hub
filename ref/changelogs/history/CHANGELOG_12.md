---
changelog_id: 12
changed_at: 2026-05-12
---

# CHANGELOG_12: 切 profile 卡死全链路修复（B+C 双层防御 + 端到端测试）

## 概要

修「切 profile 会卡死，重启发现切换成功了」根因 — REVIEW_7 双异构对抗 review 三态裁决落地 7 HIGH + 3 MED + 1 LOW 全套。CHANGELOG_7 PR-3 H1 修过 `runHook` **函数**卡死，但漏修 bun **进程**不退出 + Rust 端无 timeout，本轮全链路加固：

- **B 层**（CLI 末尾安全强退）：`jsonOut` 改 async write callback 防 macOS 65536 byte stdout 截断；`runProfileCommand` 末尾 `await flushStdout(); process.exit(0);` 兜底
- **C 层**（Rust 端 spawn + timeout）：抽 `proc_timeout::spawn_with_timeout` helper：process group + 增量收 stdout/stderr + 不 await reader join + `killpg(SIGKILL)` 杀整组；UI 按命令传 timeout（use=2×hookTimeout+5s）
- **同源**：`get_tool_version` 同根问题（loadAllConfigs Promise.all × 4 全踩）一并修
- **测试**：3 个 bun e2e + 5 个 cargo test 锁住「bun 进程退出时间 + JSON 完整 + Rust killpg」回归基线

233 pass + 5 cargo pass / 0 回归。

## 变更内容

### `src/cli-profile.ts`

- **新增 `flushStdout()` helper**（line 13-30）：用 `process.stdout.write("", () => resolve())` 强制 flush；macOS pipe buffer 上限 65536 byte，单纯 `process.exit(0)` 在 ≥65537 byte 必截断（双 reviewer 实测复核）
- **`jsonOut(data)` 改 async**（line 32-36）：内部走 `write(JSON.stringify(data) + "\n", () => resolve())` Promise 包装；`stdout.end(cb)` / `'drain' event` 都不能保证 flush（实测 Bun runtime 行为差异）
- **新增 `writeOut(s)` helper**（line 38-44）：`cmdEnv` 非 JSON 模式逐行 export 同样有截断风险（codex MED-A1：大 env 场景）
- **`err()` JSON 路径同改**（line 46-55）：`process.stdout.write(JSON.stringify({error: msg}) + "\n", () => process.exit(1))`，throw Error 兜 `never` 类型
- **`cmdEnv` line 304-310**：`process.stdout.write(\`export ...\`)` → `await writeOut(...)`
- **`cmdHook` line 332-336**：`process.exit(1)` 加 `await flushStdout()` 防 fmtHookResult 大输出截断
- **`runProfileCommand` line 380-401 重写**：
  - `cmdEdit` 例外提前 return（要 `await editor proc.exited` 长时交互）
  - 其他所有 cmd 走 `await cmdX(...)`（之前是 `return cmdX(...)` 直接返回 Promise）
  - 末尾统一 `await flushStdout(); process.exit(0);` 兜底强退
  - 解决：H7 `Promise.race` 输掉的 setTimeout 拖住 bun event loop（实测 hook=`echo ok` 函数 3ms vs bun 4510ms）+ REVIEW_2 H1 detach 子进程持 pipe FD

### `src-tauri/src/proc_timeout.rs`（新建）

新模块统一封装「spawn 子进程 + 强制限时 + 杀整组」：

- **`spawn_with_timeout(cmd, timeout) -> CommandOutcome`**：caller 传 `Command`（已配 args / env / cwd），内部强制 `stdout/stderr = piped()` + 跑：
  1. **Unix `pre_exec setsid()`**：fork 后立即 setsid 让 child 成为新 session leader（pgid == child pid）；setsid 是 async-signal-safe，pre_exec 内调用安全
  2. **双 reader thread `Arc<Mutex<Vec<u8>>>` 增量收 4KB chunk**：每次 read 立即 lock+append；主线程中途 take snapshot 也能拿到 partial bytes
  3. **主线程 `try_wait()` 50ms polling**：子进程退出走 50ms grace 收尾返回；超时走 `kill_process_group()` + 50ms 收尾 + return code = -2
  4. **`kill_process_group(child, pid)`**：Unix 走 `libc::killpg(pid, SIGKILL)` 杀整组（含 hook 孙子 / 异步上报 / detach 后台进程）+ child.kill 兜底；Windows fallback `child.kill()`（无 process group 概念，detach 触发面窄）
  5. **不 await reader join**：detach 孙子持 fd 时 `read_to_end` 永挂，强行 join 会卡（codex H3 反驳 reviewer-claude）→ 主线程超时立即 take snapshot 返回，reader thread 让 OS 在主进程 cleanup 时自然回收
- **5 cargo test 单元覆盖**：`normal_exit_collects_stdout` / `nonzero_exit_preserved` / `detach_child_does_not_block_after_parent_exits` / `watchdog_kills_process_group_on_timeout` / `double_large_output_no_deadlock`

### `src-tauri/Cargo.toml`

- 加 `[target.'cfg(unix)'.dependencies] libc = "0.2"`：`libc::setsid()` + `libc::killpg()` + `libc::SIGKILL` 用

### `src-tauri/src/lib.rs`

- **顶部 imports**：加 `use std::time::Duration;` + `mod proc_timeout; use proc_timeout::spawn_with_timeout;`
- **`get_tool_version`** line 207-235：`cmd.output()` → `spawn_with_timeout(cmd, Duration::from_secs(5))`；用户 .zshrc 含 `(bg-cmd &)` 时不会再卡 loadAllConfigs Promise.all × 4 → App 首屏 / focus reload / visibility 切换全保护
- **`run_dch_command`** line 263-345：
  - 新增第二个参数 `timeout_ms: Option<u64>`（UI 按命令传，缺省 1800s 兜底上限）
  - `command.output()` → `spawn_with_timeout(command, Duration::from_millis(timeout_ms.unwrap_or(1_800_000)))`
  - 返回 `code = -2` 时表 watchdog 杀（区分 CLI 内部 exit 1）

### `src/client/bridge.ts`

- **`runDch<T>(args, timeoutMs?)`** line 237-253：`call("run_dch_command", { args, timeoutMs })`；`code === -2` 抛专属错误「命令超时被强制终止」让 UI toast 区分卡死 vs CLI 失败
- **新增按命令分类常量**：`TIMEOUT_FAST_MS = 10_000`（list/show/add/remove/current/env/config）+ `TIMEOUT_INIT_MS = 30_000`（含 mv/ln 操作）
- **`dchProfile.use(id, hookTimeoutMs)` 改签名**：传 `2 × hookTimeoutMs + 5_000` 给 Rust（pre + post hook + grace）
- **`dchProfile.testHook(id, which, hookTimeoutMs)` 改签名**：传 `hookTimeoutMs + 5_000`
- 其他 cmd：list/add/remove/current/init/config 都按上面常量传 timeout

### `src/client/components/ProfilePanel.tsx`

- `onUse` line 86：`dchProfile.use(id)` → `dchProfile.use(id, store?.preferences.hookTimeoutMs ?? 30_000)`
- `onTestHook` line 114-116：`dchProfile.testHook(id, which)` → `dchProfile.testHook(id, which, store?.preferences.hookTimeoutMs ?? 30_000)`

### `src/cli-profile.exit-time.test.ts`（新建）

3 case e2e（IS_WIN skip）spawn 真实 `bun src/cli.ts profile use ... --json` 子进程：

- **case A**：preHook=`(sleep 30 &); echo immediate-stdout; exit 0` → bun 进程 < 3s 退（旧实现卡 30s）+ JSON 可 parse
- **case B**：preHook=`echo ok; exit 0` → bun 进程 < 2s 退（H7 race timer 回归保护：旧实现 hook 3ms 完成但 bun 因 race timer 拖到 hookTimeoutMs+1000ms）
- **case C**：preHook=`yes 'x' \| head -c 200000; echo; exit 0` → stdout 字节数 > 180000（H1 65536 截断回归保护）+ JSON parse OK + `parsed.hooks[0].stdout.length > 150_000`

测试用 tmpdir 隔离 HOME（`mkdtemp` + `~/.dch/profiles.json` + `~/.claude → ~/.claude-default` symlink），不污染真实环境。

## 测试统计

- bun test：230 → **233 pass / 0 fail / 0 回归**（+3 新 e2e exit-time）
- cargo test：0 → **5 pass / 0 fail**（proc_timeout 模块新加）
- 编译警告：0（`timed_out` field 仅在测试中读，acceptable）

## 关联 review

- [REVIEW_7.md](../../reviews/history/REVIEW_7.md)：完整三态裁决记录（7 HIGH + 3 MED + 1 LOW）

## 备注

- **不动文件保护清单**：本次未触发；所有 changeset 在已有 ≤ 500 行护栏内
- **Win 路径**：proc_timeout.rs 走 `cfg(unix)` / `cfg(windows)` 分流；Win 上 fallback `child.kill()`（无 process group 概念，且 Win 没有 `(... &)` detach 语法 → 触发面窄）
- **Rust reader thread 泄漏**：detach 场景超时后不 join reader，技术上 thread 泄漏直到 OS 清理。但 Tauri runtime 会复用进程长时间，理论可累积 N 次卡死后泄漏 N 个 reader thread。**实践可接受**：(1) 修复后 `run_dch_command` 卡的概率近零，detach 场景下也 < 1 次/小时量级；(2) reader thread 内存占用极小（4KB chunk + Mutex<Vec>）；(3) 替代方案（`select` / `epoll` 异步 I/O）需要大改 Rust 异步运行时，性价比低
- **AP 候选沉淀**：见 `.claude/conventions-tally.md` AP-14/15/16
