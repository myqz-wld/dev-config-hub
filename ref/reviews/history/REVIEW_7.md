---
review_id: 7
reviewed_at: 2026-05-12
expired: false
skipped_expired: []
---

# REVIEW_7: 切 profile 卡死根因 — bun 进程不退出 + Rust 端 timeout 全链路加固

## 触发场景

用户反馈「切换 profile 会卡死，重启发现切换成功了」。CHANGELOG_7 PR-3 修过 REVIEW_2 H1（runHook 函数本身卡死），但本轮发现修复**不充分**——`runHook` 函数限时返回了，但 bun 主进程依然被 ReadableStream pump 任务 + race 输掉的 setTimeout + detach 孙子持 stdio pipe FD 拖住不退出，Rust 同步 `command.output()` 等 EOF 卡 N 秒。

## 方法

**双异构对抗 review**（详 `~/.claude/CLAUDE.md`「决策对抗」节）：

- **reviewer-claude**：Opus 4.7 xhigh subagent（`agent-deck:reviewer-claude`），全量 review
- **reviewer-codex**：先走 wrapper subagent 失败 3 轮（codex CLI xhigh + 大 prompt + 真实 repo 路径组合静默挂），改为**直接 bash 调 codex CLI**（`zsh -i -l -c "codex exec --sandbox read-only --skip-git-repo-check -c model_reasoning_effort=high -C <repo> - < /tmp/codex-review-X.txt"`），按 CLAUDE.md「大任务拆批」教训拆 Batch A（B 安全性 + 漏掉的卡死路径）+ Batch B（C 安全性 + 测试覆盖）并发跑

**范围**：根因诊断 + 修复 plan B（CLI 末尾强退）+ 修复 plan C（Rust spawn timeout）

```text
src/cli-profile.ts                                  CLI 路由 + jsonOut + runProfileCommand
src/cli.ts                                          main 三处长 await（不受影响路径锁定）
src/profiles/hooks.ts                               runHook（race timer 副作用）
src/profiles/manager.ts                             useProfile（链路分析）
src/client/bridge.ts                                runDch + dchProfile.use 接口
src/client/components/ProfilePanel.tsx              UI 调用
src-tauri/src/lib.rs                                run_dch_command + get_tool_version
```

**机器可读范围**（File-level Review Expiry 用）：

```review-scope
src-tauri/src/lib.rs
src-tauri/src/proc_timeout.rs
src/cli-profile.exit-time.test.ts
src/cli-profile.ts
src/client/bridge.ts
src/client/components/ProfilePanel.tsx
src/profiles/hooks.ts
src/profiles/manager.ts
```

**约束**：CHANGELOG 1-11 + REVIEW 1-6 已修过的不再列；本次只 focus「切 profile 卡死 / IPC 超时 / 大 stdout 截断」主线；UX / schema / 其他模块不在范围。

## 根因诊断（主 agent 实测）

```bash
# hook = `(sleep 30 &); echo immediate; exit 0`，timeout=500ms
[bun /tmp/dch-hang-repro.ts]
  runHook 函数返回 = 1010ms  ✅（CHANGELOG_7 H1 修复有效）
  bun 进程总耗时   = 30601ms  ❌（≈ sleep 30 寿命）
```

**机制链**：
1. hook 脚本 `(sleep N &)` detach 孙子 → fork 时**继承** bun 主进程的 stdout/stderr pipe FD
2. `hooks.ts:82-90` `new Response(proc.stdout).text()` 创建 ReadableStream pump task → 等不到 EOF（pipe 写端被孙子持续 hold）
3. `hardCap` 让 `runHook` **函数**返回，但 pump task **没 cancel** → bun event loop 不空 → bun 进程不退
4. Rust `lib.rs:327` `command.output()` 同步等 bun 子进程 EOF → 卡 N 秒
5. UI `await dchProfile.use(id)` 卡 → `setBusy(true)` 看起来卡死，但 saveStore 早已落盘 → **重启后切换实际成功**

CHANGELOG_7 PR-3 H1 fix 只测了 `runHook` 函数级返回（hooks.test.ts:108），完全漏测 bun 进程退出时间 → 长期暴露。

## 三态裁决结果

> 本节遵循「决策对抗」节验证纪律：每条 ✅ 必须带验证手段（grep / 写小 test / 跑命令 / 读真实代码）；纯推理结论自标 *未验证* 强制降级 ❓ + 非 HIGH。

### ✅ 真问题（必修，全部已落地 CHANGELOG_12）

| # | 严重度 | 文件:行号 | 问题 | claude | codex | 验证手段 |
|---|---|---|---|---|---|---|
| H1 | HIGH | `src/cli-profile.ts:17-19` jsonOut | `process.exit(0)` 截断大 stdout 到 macOS 65536 byte pipe buffer 上限；`SwitchResult.hooks[].stdout` 大输出 hook 时 UI `JSON.parse` 抛 SyntaxError —— 比卡死还难诊断（用户看到「Unexpected end of JSON input」） | ✅ HIGH-1 | ✅ HIGH-A1 | 双方独立 `bun -e "process.stdout.write('x'.repeat(N) + '\\n'); process.exit(0)" \| wc -c` 实测：N=65000→65000, N=65536→65536, N=65537→65536 truncate；只有 `write(data, callback)` 形式能保证 flush（`stdout.end(cb)` / `'drain' event` 实测都失败） |
| H2 | HIGH | `src-tauri/src/lib.rs:264-336` run_dch_command | `command.output()` 无 timeout，cli-profile.ts hookTimeoutMs 上限 600000ms × pre+post hook = 最坏 20 分钟；硬编码 90s/1800s 都钝 | ✅ HIGH-2 | ✅ MED-B1 | grep `cli-profile.ts:313` 上限 + `bridge.ts:238` 当前 invoke 不传 timeout。**采纳 codex 方案**：UI 按命令传 timeout（use=2×hookTimeout+5s, hook=hookTimeout+5s, init=30s, 其他=10s）；Rust 兜底 1800s 上限 |
| H3 | HIGH | `src-tauri/src/lib.rs:327` reader join | reviewer-claude 提的「双 thread 防 deadlock」写法对，但 codex 反驳 + 加深：detach 孙子持 fd 时 reader `read_to_end` **永不 EOF** → `join()` 卡到孙子关 fd → "返回 partial output" 做不到 | HIGH-3（部分） | ✅ HIGH-B1（更深） | 实施时**不 await reader join**：`Arc<Mutex<Vec<u8>>>` 增量收 + 主线程超时立即 `take` snapshot 返回；reader thread 让 OS 在主进程退出时 cleanup（可接受 thread 泄漏，因为 watchdog 后整个进程会被 Tauri runtime 复用）|
| H4 | HIGH | `src-tauri/src/lib.rs:321-328` child.kill | `Child::kill()` Unix 是 SIGKILL（不是 SIGTERM），但**只杀 direct child**（user shell 包 bun），bun 孙子 + hook 曾孙仍持 pipe FD | — | ✅ HIGH-B2 | 实测 `ps`：`(sh -c "(sleep 30 &); ...")` SIGKILL 父 sh 后孙子 sleep 30 (pid=56270) 仍存活被 init 收养。修：`pre_exec setsid()` 让子进程开新 pgid + timeout 时 `libc::killpg(pgid, SIGKILL)` 杀整组 |
| H5 | HIGH | `src-tauri/src/lib.rs:205-231` get_tool_version | 同 `Command::output()` + shell wrapper source rc 同源问题；用户 .zshrc 含 `(bg-cmd &)`（typical：proxy ensure / nvm preload / shell prompt async refresh）→ loadAllConfigs `Promise.all` × 4 全踩 → App 首屏 / focus reload / visibility 切换全卡 | — | ✅ HIGH-A4 | grep `bridge.ts:178-182` 显示 4 个 `version()` 并发；mock 实测 `(sleep 30 &); echo "Mock 4.0.0"; exit 0 \| cat` 总耗时 30419ms |
| H6 | HIGH | `src/profiles/hooks.test.ts:108` | 现有 H1 case 只测 `runHook` **函数**返回时间；漏 e2e 「bun 子进程退出时间 + JSON 输出 > 64KB 不截断」回归 → 任何修复都可能无声回退 | MED-1 | ✅ HIGH-B3 | 升级 HIGH。新增 `src/cli-profile.exit-time.test.ts`（3 case：detach hook 退出时间 + race timer 退出时间 + 200KB stdout 不截断）|
| H7 | HIGH | `src/profiles/hooks.ts:80-95` race timer 副作用 | runHook 内 `Promise.race` 输掉的 `setTimeout(... timeoutMs+GRACE)` 仍保活 bun event loop → 即使 hook 立即结束（`echo ok`）也让 bun 多挂 ~timeoutMs+1000ms | — | ✅ HIGH-A3 | 实测 `bun -e "import { runHook } from ...; await runHook(..., 'echo ok', ..., 3000)"`：函数 3ms 返回 vs bun 进程总耗时 4510ms（≈ timeoutMs 3000 + GRACE 500 × 2 + 余量）。修复 B 落地后 process.exit 兜住，但 H6 e2e 测试必须**专门**测非 detach 路径（`echo ok` hook），否则下次重构无声回退 |

### ❌ 反驳

| 报告方 | 报项 | 反驳依据 |
|---|---|---|
| reviewer-claude | LOW (隐含)：双 pipe deadlock 担心 | codex 反驳：标准库 `Command::output()` 内部就是双 thread 实现（实测 168KB+168KB 双 pipe 91ms 返回），双 thread 写法本来就无 deadlock 问题。但 H3 join-await 是更深层问题 |
| reviewer-claude | INFO：Bun stdout flush 三种 trick 对比 | 不算 finding，沉淀到 AP 候选 #14 |

### ❓ 部分 / 维持低优先级

| 现场 | 视角 | 是否已验证 | 结论 |
|---|---|---|---|
| `src-tauri/src/lib.rs:read_file/save_file/read_dir` 同步 FS 无 timeout | codex ❓：不是 pipe-fd 同类（FIFO/网络盘异常才挂） | ❓ 推理 | 不在本次 plan 范围；维持 ❓ 标 INFO |
| `src/cli.ts:152-178` main 三处长 await（gui/edit/tauri dev） | claude MED-3：plan 应明文锁定不受影响 | ✅ grep + 读代码 | INFO 性质：`gui` 走 `await tauri dev proc.exited`、`edit` 走 `await editor proc.exited`、`profile edit` 同 — 都是 `stdio:inherit` 长时交互场景，不在 `runProfileCommand` 内，process.exit(0) 不影响它们 |

## 修复（CHANGELOG_12 落地）

### HIGH（7 条）

1. **H1** — `src/cli-profile.ts:13-56`：新增 `flushStdout()` + 改 `jsonOut()` 走 `write(data, callback)` Promise 包装；`err()` JSON 路径同改；`writeOut()` helper 给 cmdEnv 用
2. **H7** + 主修 — `src/cli-profile.ts:391-401`：`runProfileCommand` 末尾 `await flushStdout(); process.exit(0);` 兜底强退；`cmdEdit` 例外提前 return
3. **H2** — `src-tauri/src/lib.rs:run_dch_command` 接受 `timeout_ms: Option<u64>`；`src/client/bridge.ts:runDch` 加 `timeoutMs?` 参数 + 按命令分类的常量（TIMEOUT_FAST_MS=10s, TIMEOUT_INIT_MS=30s）；`dchProfile.use(id, hookTimeoutMs)` 算 `2 × hookTimeoutMs + 5s grace`；`dchProfile.testHook(id, which, hookTimeoutMs)` 算 `hookTimeoutMs + 5s grace`；ProfilePanel.tsx caller 传 `store.preferences.hookTimeoutMs`
4. **H3 + H4** — `src-tauri/src/proc_timeout.rs` 新建：`spawn_with_timeout` helper：
   - `pre_exec setsid()` 开新 pgid（Unix only）
   - `Arc<Mutex<Vec<u8>>>` 双 reader thread 增量收 4KB chunk
   - 主线程 `try_wait()` 50ms polling + timeout `libc::killpg(pgid, SIGKILL)` 杀整组
   - **不 await reader join** → 立即 take snapshot 返回（detach 场景仍能限时）
   - Windows fallback 走 `child.kill()`（无 process group 概念，detach 触发面窄）
5. **H5** — `src-tauri/src/lib.rs:get_tool_version` 走 `spawn_with_timeout(_, 5s)` helper 同源修
6. **H6** — `src/cli-profile.exit-time.test.ts` 新建（3 case）+ `src-tauri/src/proc_timeout.rs` cargo test 单元测试（5 case）

### MED（3 条）

1. **M1** — `cli-profile.ts:err()` JSON 路径同走 `write(data, callback)`（与 H1 同根）
2. **M2** — `cli-profile.ts:cmdEnv` 非 JSON 模式 `process.stdout.write(export ...)` 改 `await writeOut(...)`（codex MED-A1：大 env 场景同样会被 process.exit 截断）
3. **M3** — Rust timeout helper 抽 `proc_timeout.rs` 模块独立 cargo test 覆盖（5 case：normal/nonzero/detach/timeout/double-large）

### LOW（1 条）

1. **L1** — `cli-profile.ts:cmdHook` 的 `process.exit(1)` 失败路径加 `await flushStdout()`（防 fmtHookResult 大输出场景下 stderr 截断）

## 测试覆盖

- `src-tauri/src/proc_timeout.rs::tests` 5 case：normal_exit_collects_stdout / nonzero_exit_preserved / detach_child_does_not_block_after_parent_exits / watchdog_kills_process_group_on_timeout / double_large_output_no_deadlock
- `src/cli-profile.exit-time.test.ts` 3 case（IS_WIN skip）：detach hook < 3s + JSON 完整 / `echo ok` hook < 2s（H7 race timer 回归） / hook stdout 200KB 不截断
- 全量回归：bun test 230 → **233 pass / 0 fail / 0 回归**；cargo test 0 → **5 pass / 0 fail**

## 关联 changelog

- [CHANGELOG_12.md](../../changelogs/history/CHANGELOG_12.md)：本次修复落地

## Agent 踩坑沉淀

本次 review 提炼出 3 条 agent-pitfall 候选（详 `.claude/conventions-tally.md`「Agent 踩坑候选」section）：

- **AP-14**：Bun stdout=pipe + `process.exit(0)` 必截断 ≥ 65537 byte 到 65536（macOS pipe buffer）；只有 `write(data, callback)` 形式能保证 flush，`stdout.end(cb)` / `'drain' event` 都失败 — 跨项目通用
- **AP-15**：`Promise.race(setTimeout(...))` 输掉的 timer 仍保活 Bun event loop —— 即使函数已 return，bun 进程被拖到 timer 触发；任何「race timeout cleanup」模式都要主动 `clearTimeout` 输方
- **AP-16**：`Child::kill()` 仅杀 direct child；任何 spawn 用户脚本（hook / shell wrapper）的链路都要建 process group + `killpg` 才能杀整个 process tree（bun 孙子 / detach 曾孙 / 异步上报进程等都会持父 stdio pipe FD 让 reader 永挂）
