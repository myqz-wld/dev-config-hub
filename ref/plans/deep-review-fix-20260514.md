---
plan_id: "deep-review-fix-20260514"
created_at: "2026-05-14T00:00:00Z"
worktree_path: "/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/deep-review-fix-20260514"
status: "completed"
base_commit: "0a136b6"
final_commit: "0d18f4c8495dacd04edc543446f1a15fdab78b36"
completed_at: "2026-05-14"
---
# Deep Code Review Fix — Round 1 → fix → Round 2

## 总目标 & 不变量

- 修复 deep-code-review SKILL Round 1 异构对抗挖出的 **10 条 HIGH** 真问题（双方独立 ✅ 或反驳确认）。
- 顺带把 4 条与 HIGH 同根的关键 MED 一并修（M4 进程组 / M2 redact markdown / M3 profile.env DCH_* / M14 AddProfile env 校验）。
- **不变量**：
  - 改动全在 worktree 内（路径含 `.claude/worktrees/deep-review-fix-20260514/` 前缀）；主仓库零污染
  - 单文件 LOC ≤ 500（修复时若超必须先拆）
  - 不退已有约定（CHANGELOG_3-17 + CLAUDE.md「已踩的坑」节）
  - 每条 fix 都配回归测试（无测试不算 done）
  - 修完跑一轮 `bun test` 全绿 + Group A 跑 `bunx tauri build` 编译验证

## 设计决策（不再争论）

### D1. fix 分组 + 顺序

按 ROI + 修复独立性 + cross-cut 风险分 5 组，**Group A 最简最独立先做**，**Group D 风险最高放中段做透**：

| Group | HIGH | 同根 MED | 估时 |
|---|---|---|---|
| **A. Rust async + boundary** | H1（7 sync command async）+ H9（save_file boundary） | — | 1-2h |
| **B. JSON 协议** | H6（cmdRemove + main.catch + jsonOut→exit） | M9-11（spawn exit / --json filter / parser flag） | 1.5h |
| **C. Store lock + 进程组** | H3（staleMs 动态 = 2×hookTimeoutMs+grace） | M4（runHook killpg）+ M5（buffer cap） | 2h |
| **D. Backup safety** | H2（walkFiles symlink）+ H4（latest.dchpack atomic）+ H5（restore path 校验） | M1（addProfile fail cleanup）+ M2（redact markdown）| 4h |
| **E. TOCTOU + UI** | H7（mtime CAS Rust+TS）+ H8（CMEditor compartment + caller useMemo）+ H10（main.tsx innerHTML） | M14-19 部分 | 2-3h |

### D2. 共用 atomic_write helper

H4 (latest.dchpack) + H7 (save_file mtime CAS) + M5 (saveStore 半写) 三处都是 atomic write missing 同根问题 —— 抽 `src-tauri/src/atomic.rs` Rust helper（`write_atomic_check_mtime`），TS 端 `src/profiles/atomic-write.ts`（用 `writeFile` + `rename`）。Group A 时建好骨架，B/D/E 复用。

### D3. lib.rs 拆模块（顺手做掉）

Group A 改 6 个 sync command 时同步拆 lib.rs：
- `src-tauri/src/commands/fs.rs` — read_file / read_file_with_mtime / save_file / file_exists / read_dir / read_link
- `src-tauri/src/commands/shell.rs` — get_user_shell / shell_basename / shell_invocation
- `src-tauri/src/commands/version.rs` — get_tool_version
- `src-tauri/src/commands/dch.rs` — run_dch_command / run_dch_command_blocking
- `src-tauri/src/atomic.rs` — write_atomic_check_mtime（D2）
- `src-tauri/src/path_policy.rs` — HomeOnly / DchStoreOnly / ExplicitConfigDir
- `src-tauri/src/lib.rs` 只剩 `mod` 声明 + Tauri Builder + invoke_handler! + run

满足单文件 ≤ 500 + 配 H1/H9 一次性改透。

### D4. 安全语义保守

H5 restore 任意路径写：默认 **强制 prefix `~/.dch-restored/<finalId>/`**，`--allow-original-path` opt-in（即使 opt-in 也校验 `~/...` 前缀 + 不含 `..` + 黑名单 `~/.ssh` `~/.gnupg` `~/Library/Application Support/...`）。**与现有 .dchpack 不向后兼容是 acceptable**（review 之前没有 release）。

H7 mtime CAS：后端加 `save_file_if_mtime` Rust command（接受 `expected_mtime_us`，原子 check + write），不破坏现有 `save_file`（标 deprecated 留给 ProfileStoreEditor 等过渡）。前端 saveFile wrapper 默认走新接口。

H10 main.tsx innerHTML：用 `textContent` + DOM API 构造 `<h2><pre>`，不要 React fallback（main.tsx 是 root mount 之前的 catch，React 还没起）。

### D5. CMEditor 内部 compartment 修 + 不破坏现有 caller 契约

H8 拆两层：
- CMEditor 内部加 `themeCompartment` + `maxHeightCompartment` + `readOnlyCompartment`（line/124），prop 变更走 reconfigure 而非 init
- caller (ConfigPanel + ProfileStoreEditor) 仍要加 useMemo 稳定 language / extras 引用 —— 不修内部 cache 破坏 prop 契约

## 步骤 checklist

### Group A — Rust async + lib.rs 拆 + atomic helper（基建） ✅ 完成 (commit f392123)
- [x] Step A1 — 建 `src-tauri/src/{commands/fs.rs, commands/shell.rs, commands/version.rs, commands/dch.rs, atomic.rs, path_policy.rs, commands/mod.rs}` 骨架 — done by session 2 on 2026-05-14
- [x] Step A2 — `path_policy.rs` 实现 PathPolicy enum + check_path() helper（H9） — done by session 2 on 2026-05-14
- [x] Step A3 — `commands/fs.rs` 6 个 fn 全部 `async + spawn_blocking`，read/write 类走 PathPolicy（H1 + H9） — done by session 2 on 2026-05-14
- [x] Step A4 — `commands/version.rs` `get_tool_version` async + spawn_blocking（H1） — done by session 2 on 2026-05-14
- [x] Step A5 — `atomic.rs` `write_atomic_check_mtime(path, content, expected_mtime_us)` + `save_file_if_mtime` Tauri command（H7 后端） — done by session 2 on 2026-05-14
- [x] Step A6 — `lib.rs` 瘦身只剩 mod 声明 + Builder + invoke_handler + run（D3） — done by session 2 on 2026-05-14
- [x] Step A7 — `cargo build` 通过 + 27 cargo test 全绿 + 195 bun test 全绿（`bun run dev` 冒烟改 cargo test + bun test 等价覆盖；交互式窗口冒烟留给 Group F1 完整 `bunx tauri build`） — done by session 2 on 2026-05-14

### Group B — JSON 协议（CLI） ✅ 完成 (commit a30816e)
- [x] Step B1 — `cli.ts:151` main().catch 加 `if (isJsonMode()) jsonOut({error: String(e)}); else console.error(...)`（H6 第 1 处） — done by session 2 on 2026-05-14
- [x] Step B2 — `cli-profile.ts:130` cmdRemove 加 `!isJsonMode()` 短路 prompt（H6 第 2 处）+ json 模式直接 err() — done by session 2 on 2026-05-14
- [x] Step B3 — `cli-profile.ts:158/232` + `cli-backup.ts:115` jsonOut 后用 result.ok 决定 exit code，非 0 走 process.exit(1)（H6 第 3 处） — done by session 2 on 2026-05-14
- [x] Step B4 — `cli.ts:106/128` Bun.spawn 后读 `proc.exited`（已 await）+ `process.exit(proc.exitCode ?? 1)`（M9） — done by session 2 on 2026-05-14
- [x] Step B5 — `cli-profile.ts:298` `--json` 过滤改成只在已知 flag 后 / 走 parseFlags 之后处理（M10） — done by session 2 on 2026-05-14
- [x] Step B6 — `cli-shared.ts:106` parseFlags 加未知 flag 报错 + VALUE_FLAGS 缺值报错（M11） — done by session 2 on 2026-05-14
- [x] Step B7 — 补 cli e2e test 覆盖 cmdRemove --json / show --json error / spawn 失败传 exit code — done by session 2 on 2026-05-14（cli-json-protocol.test.ts 7 e2e + cli-profile.parseFlags.test.ts 5 新测）

### Group C — Store lock + 进程组 ✅ 完成 (commit cc74bbd)
- [x] Step C1 — `manager.ts` 6 处 withStoreLock 调用，统一走 `withProfileLock` helper（`staleMs/maxWaitMs = 2 * hookTimeoutMs + 5_000`，acquirer 视角和 holder 视角同步放大）（H3） — done by session 2 on 2026-05-14
- [x] Step C2 — `hooks.ts:64` runHook 用 process group spawn (`detached:true`)，timeout 时 `process.kill(-pid, SIGKILL)` 杀整组（M4）；同时调整 buildEnv 顺序：profile.env 先注入，DCH_* 后注入覆盖回权威值（M3 / E8 顺手做掉） — done by session 2 on 2026-05-14
- [x] Step C3 — `proc_timeout.rs` reader buffer 加 5MB 上限 + truncated 标志 + 加 buffer_cap_truncates_oversize_stdout / small_output_not_truncated 测试（M5） — done by session 2 on 2026-05-14
- [x] Step C4 — 补 `manager.stale-lock.test.ts` 长 hook + 并发 useProfile 不被 stale 抢占测试（spawn 真子进程 + tmpHome） — done by session 2 on 2026-05-14

### Group D — Backup safety（重点） ✅ 完成 (commit 3458a35)
- [x] Step D1 — `backup.ts:151 isDirSafe` 改 `lstat`；`walkFiles` 不递归 symlink dir，symlink file 也跳过（H2） — done by session 2 on 2026-05-14
- [x] Step D2 — `backup.ts:353` 改成 atomic write：`tar -chf - | gzip -1 > $tmp` + 验证 `tar -tzf $tmp` 通过 + `mv $tmp $outFile`（H4） — done by session 2 on 2026-05-14
- [x] Step D3 — `backup-restore.ts:160` 加 path validator：必须 `~/...` 前缀 + 不含 `..` + 黑名单；默认强制 `~/.dch-restored/<finalId>/`，`--allow-original-path` opt-in（H5） — done by session 2 on 2026-05-14（cli-backup --allow-original-path flag + bridge.RestoreApplyOpts.allowOriginalPath 透传）
- [x] Step D4 — `backup-restore.ts:199` addProfile 失败 catch 内 `rm(finalDirAbs, {recursive: true, force: true})` 回滚（M1） — done by session 2 on 2026-05-14
- [x] Step D5 — `redact.ts:165` fall-through 改成 `redactPlainTextContent`（HIGH_CONFIDENCE + KEY_VALUE + HTTP_AUTH regex 模板）（M2） — done by session 2 on 2026-05-14；同时 `backup.ts copyOrRedactFile` 移除 wantsRedact 扩展名 gate
- [x] Step D6 — `redact.test.ts:138` 反向锁定：assert markdown 内 `sk-ant-...` 被替换 — done by session 2 on 2026-05-14（+ 5 个 redactPlainTextContent 新测）
- [x] Step D7 — 补 backup roundtrip test（child-spawn e2e + validateRestorePath unit）：含 symlink dir / 默认 ~/.dch-restored/ / markdown 含 secret — done by session 2 on 2026-05-14（backup-safety.test.ts 9 测）

> **教训**：in-process 改 `process.env.HOME` 不影响 STORE_PATH module 常量（platform.ts `homedir()` 已缓存）；所有改 store / 创建 backup 的测试**必须** spawn 子进程 + `env: HOME=tmp` 隔离。本会话曾误用 in-process 模式污染了真实 ~/.dch/profiles.json 与 ~/.dch-restored，已用 latest.dchpack 恢复。tally 候选见下面。

### Group E — TOCTOU + UI ✅ 完成 (commit c95f1e8)
- [x] Step E1 — `bridge.ts:saveFile` wrapper 接受 `expectedMtimeUs` 参数；走 `save_file_if_mtime`（A5 已建后端）（H7 第 1 处） — done by session 3 on 2026-05-14（saveFileIfMtime + classifySaveError + isMtimeMismatch / isMtimeMissing helper + MtimeMismatchError / MtimeMissingError class，readScope 顺手灌 loadedMtimeUs）
- [x] Step E2 — `ConfigPanel.tsx` save 路径携带 enter-edit 时的 mtime（H7 第 2 处） — done by session 3 on 2026-05-14（Scope 加 enterEditMtimeRef，「重新加载」推 scope.loadedMtimeUs / 「保留」推 null 弃权 CAS / save catch MtimeMismatchError 弹现有 banner / App.tsx onSave 扩 expectedMtimeUs?）
- [x] Step E3 — `ProfileStoreEditor.tsx` 同上 + props 接 active reload 触发 banner（H7 第 3 处） — done by session 3 on 2026-05-14（自闭环 mtime CAS：modal 打开 snapshot mtime / save 透传 / inline conflict banner reload-保留-取消 / 不接 props content reload — modal short-lived 后端 CAS 兜底已覆盖）
- [x] Step E4 — `CMEditor.tsx:124` 加 themeCompartment + maxHeightCompartment + readOnlyCompartment，prop 变更走 reconfigure（H8 内部） — done by session 3 on 2026-05-14（readOnlyCompartment 之前已有，新加 themeCompartment + maxHeightCompartment 两个 + reconfigure useEffect）
- [x] Step E5 — `ConfigPanel.tsx:135/163` + `ProfileStoreEditor.tsx:88-89` caller 加 useMemo 稳定 language / extras（H8 caller） — done by session 3 on 2026-05-14
- [x] Step E6 — `main.tsx:5/88` 改 textContent + DOM 构造 `<h2><pre>`，不再 innerHTML（H10） — done by session 3 on 2026-05-14（抽 renderFatalError(parent, title, body) helper 严格逃逸；XSS payload 反向锁定 5 测）
- [x] Step E7 — `AddProfileModal.tsx:189` env 加 `^[A-Za-z_][A-Za-z0-9_]*$` 校验 + 错误提示（M14） — done by session 3 on 2026-05-14（helpers.ts 单独 export ENV_KEY_RE — manager.ts 含 Node-only deps 不能 bundle 进前端）
- [x] Step E8 — `hooks.ts:16` 调整注入顺序：profile.env 先注入，DCH_* 后注入覆盖回权威值（M3） — done by session 2 on 2026-05-14（Group C2 已顺手做掉）

### 收尾
- [x] Step F1 — 全 `bun test` 绿 + `bunx tauri build` 通过 — done by session 3 on 2026-05-14（251/251 + cargo test 29 + cargo build dev + cargo build --release + bundle Dev Config Hub.app 全绿）
- [ ] Step F2 — Round 2 reviewer **必须重 spawn**（4 原 reviewer 已 closed 不可复用），下一会话用 `/agent-deck:deep-code-review` SKILL 触发新 pair，prompt 模板见「下一会话第一步」节 step 4
- [ ] Step F3 — Round 2 三态裁决；如有新 HIGH → fix（可能 Round 3）；如全收口 → 拒合 / 收口
- [ ] Step F4 — 写 reviews/REVIEW_8.md 完整记录本次 deep review（含 Round 1/2 / 反驳轮 / 三态结论 / fix commit hash）
- [ ] Step F5 — 改 changelog/INDEX.md 加 CHANGELOG_18.md 引用（fix 总览）
- [ ] Step F6 — archive_plan ff merge worktree → main + mv plan → main-repo/plans/ + INDEX.md + commit + worktree remove + branch -D + shutdown 4 reviewer

## 当前进度

**Group A ✅ 完成 (commit f392123, session 2 / 2026-05-14)**：lib.rs 拆模块 + async fs/version + path policy + atomic write 后端

**Group B ✅ 完成 (commit a30816e, session 2 / 2026-05-14)**：JSON 协议 7 step 全收口

**Group C ✅ 完成 (commit cc74bbd, session 2 / 2026-05-14)**：store-lock 动态 staleMs / hook 进程组 / 5MB cap / DCH_* 后注入

**Group D ✅ 完成 (commit 3458a35, session 2 / 2026-05-14)**：backup symlink walk safety / atomic dchpack / restore path validator + ~/.dch-restored / addProfile rollback / plain-text regex redact

**Group E ✅ 完成 (commit c95f1e8, session 3 / 2026-05-14)**：mtime CAS（saveFileIfMtime wrapper + ConfigPanel/ProfileStoreEditor 双 caller 接） + CMEditor theme/maxHeight Compartment 补全 + caller useMemo + main.tsx XSS hardening（textContent helper）+ AddProfileModal env regex 校验。**+27 回归测（251/251 ✓ + cargo test 29 ✓）**。

**F1 ✅ 完成 (session 3 / 2026-05-14)**：`bunx tauri build --bundles app` release profile 编译通过 in 42s，bundle `Dev Config Hub.app` 输出 OK；bun test 251/251 + cargo test 29/29 + dev cargo build 全绿。

**下一步：F2 起 Round 2（必须重 spawn 新 reviewer pair）**

⚠️ 4 个原 reviewer **全部 lifecycle: closed**（不是 plan 之前写的 dormant；lifecycle scheduler 后续收口了）：
| Team | reviewer-claude | reviewer-codex |
|---|---|---|
| backend-core (b141edb1-acb2-4a02-83b5-a63907e84ad5) | f5685746-de16-47bd-bcc5-2c6b88da2226 ❌ closed | b359c60c-dc6e-4e6e-970d-fbf73bea2c5f ❌ closed |
| cli-ui (f2ccde6a-5f7a-4f08-b9cd-9c7cc85f24ff) | 12e92390-7f62-41a9-8a65-b7c38d50cc3c ❌ closed | 90af735d-e878-4f31-b6c6-a45f1398c338 ❌ closed |

按 user CLAUDE「shared-team 前置约束」选项 1：**重 spawn 新 reviewer pair**，丢弃 R1 reviewer mental model；R2 prompt 含 R1 finding 摘要 + 5 commit hash + skip 字段补回。

⚠️ 原 lead `263e93fc-25e4-4f46-b709-2285f816780d` 仍 active 且在两 team 内；理论上可让原 lead session（不是当前 session 3 = 8ed6bfe7）走 deep-code-review SKILL 触发 R2，但 R1 mental model 也已通过本 plan + commit hash 摘要传递，新 lead 起新 SKILL 是更干净路径。

## 下一会话第一步

session 3 收尾后 hand off 接力：

1. `Bash: cat /Users/apple/Repository/personal/dev-config-hub/.claude/plans/deep-review-fix-20260514.md` 全文
2. `EnterWorktree(path: "/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/deep-review-fix-20260514")` 进同 worktree
3. 自检 `git -C <worktree> log --oneline -7` 确认 HEAD = c95f1e8（Group E commit；F1 build 不入 git）
4. **直接动手 F2**：用 `deep-code-review` SKILL 起 Round 2 review pair（异构对抗）—— **不**复用原 4 个 closed reviewer（按 user CLAUDE「shared-team 前置约束」选项 1 重 spawn）。

   **F2 SKILL 触发模板**（直接喂给 SKILL）：

   ```
   /agent-deck:deep-code-review

   scope: Round 2 review — 验证 Group A-E 5 个 fix commit 是否引入新 bug / 漏修边角 / 破坏既有约定
   commits to review (按时序):
   - f392123 refactor(rust): split lib.rs + async fs/version + path_policy + atomic write
   - a30816e fix(cli): JSON 协议契约 — main.catch / cmdRemove prompt / use exit / spawn / parseFlags
   - cc74bbd fix(profiles): store-lock 动态 staleMs + hook 进程组 + reader 5MB cap + DCH_* 后注入
   - 3458a35 fix(backup): symlink walk safety + atomic dchpack + restore path validator + plain-text redact
   - c95f1e8 fix(ui): mtime CAS + CMEditor compartment + main.tsx XSS + AddProfileModal env regex

   focus:
   - 新代码自身是否有 bug（async race / leak / atomic 残留 tmp / mtime CAS 边角 / textContent helper 漏点）
   - 是否漏修 R1 finding 的某个 case（H1-H10 / M1-M19 任意条目的子情况）
   - 是否破坏既有约定（CLAUDE.md「已踩的坑」节 / CHANGELOG_3-17 / Bun first / Profile symlink only）
   - 测试是否真覆盖 fix 路径（251 测里有没有 silently 不调真路径的）

   skip:
   - R1 已 finding 的 H1-H10 / M1-M19 本身（除非这次 fix 引入新问题再回归）
   - Group A-E 之前的代码（已审基线 = base_commit 0a136b6）
   - 单元测试结构（已 251/251 全绿）

   两个 team 复用 R1 命名（避免 ID 复用 closed 撞车，加 -r2 后缀）：
   - dch-rev-backend-202611-r2（review f392123 + a30816e + cc74bbd + 3458a35 backend 部分）
   - dch-rev-cli-ui-202611-r2（review 3458a35 cli + c95f1e8 ui 部分）

   reviewer 仍走异构对：reviewer-claude (Opus 4.7) × reviewer-codex (gpt-5.5) 各 team 一对。
   ```

5. 等 4 个 reviewer reply 自动注入 lead conversation flow（不必主动 poll）→ 三态裁决（双方独立 ✅ / 反驳 ❌ / 部分 ❓）→ 必要时反驳轮 spawn 对方反驳 → 主 agent 现场验证（grep / 写小 test）
6. **F3** 完成 R2 三态裁决：如有新 HIGH → fix（可能 Round 3）；如全收口 → 走 F4
7. **F4** 写 `reviews/REVIEW_8.md`（在 main repo 不在 worktree — review 文件入 git 归档），含：
   - 触发场景（用户「深度 code review」诉求 + 4 reviewer 异构对抗 + Group A-E fix）
   - 方法（双对抗 / scope 切片 backend-core × cli-ui / 工具 mcp send_message）
   - Round 1 三态裁决清单（H1-H10 + M1-M19 全条 + ✅/❌/❓ 标记）
   - Round 2 反向 review 三态裁决清单
   - 修复条目（Group A-E commit hash + step 一一对应）
   - 同步更新 `reviews/INDEX.md` 加 REVIEW_8 一行
8. **F5** 写 `changelog/CHANGELOG_18.md`（在 main repo）总览引用 plan 归档 + REVIEW_8 + 5 个 commit；同步更新 `changelog/INDEX.md`
9. **F6** 走 `mcp__agent-deck__archive_plan({plan_id: "deep-review-fix-20260514", worktree_path: "/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/deep-review-fix-20260514", base_branch: "main", keep_teammates: false})`：
   - 自动 ff-merge worktree → main + mv plan → main-repo/plans/ + INDEX.md + commit + worktree remove + branch -D + shutdown 4 reviewer + archive caller session
   - 调用前必须先 `ExitWorktree(action: "keep")` 退出 worktree（mcp tool 不能调 ExitWorktree CLI 内部 tool）
10. F6 完成后会话使命结束，archive_plan 自动归档 caller。

> ⚠️ 所有 Group E 改动已 commit；F1 release bundle 落在 worktree 内（`src-tauri/target/release/bundle/macos/Dev Config Hub.app`），可手工 cp 到 /Applications 验证 UI 行为，但**不属于 plan 必做**（cargo test 29 + bun test 251 已覆盖等价回归）。

## 已知踩坑（避免回退）

- ❌ 不要再加 env 切换模式（settings.json env 块路径已删，CHANGELOG_3）
- ❌ 不要用 window.confirm（Tauri 2 webview 不支持，CHANGELOG_5）
- ❌ 新建 profile 表单一次填齐，不分步引导（CHANGELOG_5）
- ❌ React props 加字段必须 type + destructure 双手并改（tally AP-18）
- ✅ Tauri v2 #[tauri::command] 必须 async + spawn_blocking（tally AP-19，正是 H1 修的）
- ✅ dch profile env 严格 ENV_KEY_RE 校验（CHANGELOG_4，与 M14 同源）

## Reviewer 留着不 shutdown

4 个 reviewer dormant 中，Group F2 直接 send_message 复用（自动 SDK resume 复原 mental model）：

| Team | reviewer-claude | reviewer-codex |
|---|---|---|
| backend-core | f5685746-de16-47bd-bcc5-2c6b88da2226 | b359c60c-dc6e-4e6e-970d-fbf73bea2c5f |
| cli-ui | 12e92390-7f62-41a9-8a65-b7c38d50cc3c | 90af735d-e878-4f31-b6c6-a45f1398c338 |

team_id：
- backend-core: b141edb1-acb2-4a02-83b5-a63907e84ad5
- cli-ui: f2ccde6a-5f7a-4f08-b9cd-9c7cc85f24ff

`hand_off_session` 起新 session 必须显式传 `team_name` 让新 session 落入对应 team（否则 send_message 报 no-shared-team），但单次只能加入一个 team —— Round 2 多 team 联动需要新 session **手动**通过两次 send_message（lead 不在两个 team 内时通过 list_sessions 获取 reviewer sid 后跨 team 触发，按 CLAUDE.md「shared-team 前置约束」节走选项 1 重 spawn 即可，丢的 mental model 通过本 plan 文件 + Round 1 finding 摘要补回）。

实操建议：F2 时 lead session 主动新建一个 review-coordinator 会话或 spawn 新 review pair（携 R1 finding + fix commit hash 作为 spawn prompt 的 skip 字段），同样异构对抗 Round 2，避免跨 team 协调复杂度。

