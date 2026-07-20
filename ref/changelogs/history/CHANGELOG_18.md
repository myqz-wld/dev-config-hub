---
changelog_id: 18
changed_at: 2026-05-14
---

# CHANGELOG_18 — Deep Code Review × 2 轮异构对抗 + 3 轮 fix 收口（REVIEW_8）

## 概要

用户驱动「深度 code review」诉求。`agent-deck:deep-code-review` SKILL 编排 2 轮 × 4 reviewer × 2 batch 双异构对抗（reviewer-claude Opus 4.7 × reviewer-codex gpt-5.5 xhigh）+ 3 轮 fix；R1 base_commit=0a136b6 全量挖深 10 HIGH + 19 MED → Group A-E 5 commit 收口；R2 验证又挖 4 HIGH + 5 MED + 1 LOW + 5 INFO → Group G1-G7 收口（commit d40286c）；1 HIGH 反驳 ❌（path_policy symlink 设计取舍）。**257 bun pass + 32 cargo pass / 0 回归**。

详见 [REVIEW_8.md](../../reviews/history/REVIEW_8.md)。

## 6 commit 时序

| commit | scope | 修哪些 finding |
|---|---|---|
| **f392123** | refactor(rust): split lib.rs + async fs/version + path_policy + atomic write | R1 H1 (Tauri sync command 阻塞) + H7 后端 (mtime CAS) + H9 (path 任意写) |
| **a30816e** | fix(cli): JSON 协议契约 — main.catch / cmdRemove prompt / use exit / spawn / parseFlags | R1 H6 + M9 + M10 + M11 |
| **cc74bbd** | fix(profiles): store-lock 动态 staleMs + hook 进程组 + reader 5MB cap + DCH_* 后注入 | R1 H3 + M3 + M4 + M5 |
| **3458a35** | fix(backup): symlink walk safety + atomic dchpack + restore path validator + plain-text redact | R1 H2 + H4 + H5 + M1 + M2 |
| **c95f1e8** | fix(ui): mtime CAS + CMEditor compartment + main.tsx XSS + AddProfileModal env regex | R1 H7 前端 + H8 + H10 + M14 |
| **d40286c** | fix(review_8 r3): R2 三态裁决新挖 4 HIGH+5 MED+1 LOW path safety + atomic + UI | R2 R2-1/R2-2/R2-3/R2-4/R2-6/R2-7/R2-8/R2-9/R2-10/R2-11/R2-12 |

## R1 → Group A-E（5 commit）

| Group | HIGH | 同根 MED | commit |
|---|---|---|---|
| **A** Rust async + boundary | H1 (7 sync command async + spawn_blocking) + H9 (PathPolicy::HomeOnly check_path) | — | f392123 |
| **B** JSON 协议 | H6 (cmdRemove + main.catch + jsonOut→exit) | M9 spawn exit + M10 --json filter + M11 parser flag | a30816e |
| **C** Store lock + 进程组 | H3 (staleMs 动态 = 2×hookTimeoutMs+grace) | M4 (runHook killpg) + M5 (buffer cap) + M3 (DCH_* 顺序) | cc74bbd |
| **D** Backup safety | H2 (walkFiles symlink) + H4 (latest.dchpack atomic) + H5 (restore path validator) | M1 (addProfile fail cleanup) + M2 (redact markdown) | 3458a35 |
| **E** TOCTOU + UI | H7 (mtime CAS Rust+TS) + H8 (CMEditor compartment) + H10 (main.tsx innerHTML XSS) | M14 (AddProfile env regex) | c95f1e8 |

## R2 → Group G1-G7（commit d40286c）

R2 验证 5 个 R1 fix commit 是否引入新 bug / 漏修边角。新挖：

### ✅ 真问题（已修）

| ID | 主题 | 严重度 |
|---|---|---|
| **R2-3** backup-restore.ts:209 mp.id `..` 注入 → join 逃逸 RESTORED_BASE + addProfile 失败 rm -rf 任意 HOME 子目录 | HIGH |
| **R2-4** backup-restore.ts:309/318 manifest.shared.{dch_scripts,agents_paths}[i] rel `..` 逃逸到 ~/.ssh / ~/Library/LaunchAgents | HIGH |
| **R2-6** backup-restore.ts validateRestorePath 允许黑名单祖先（`$HOME` / `$HOME/Library`） | HIGH |
| **R2-1** atomic.rs tmp_name 仅 PID → spawn_blocking 多线程并发同 path 写互相覆盖、silent data corruption | HIGH↑（双方独立 + 实测 18/20 fail） |
| **R2-7+R2-8** ConfigPanel mtime ref 维护漏洞两 case（CAS 后不 reload + touch-only stale） | MED |
| **R2-9** addProfile 失败 rm -rf `--allow-original-path` + 撞已有目录 → 误删用户数据 | MED |
| **R2-10** validateRestorePath 黑名单大小写敏感（macOS APFS / HFS+ 默认 case-insensitive） | MED |
| **R2-11** redact.ts HTTP_AUTH regex `/g` 不是 `/gi` → lowercase `authorization:` 漏脱敏 | MED |
| **R2-12** commands/dch.rs DchCommandResult 没透传 `truncated` 字段（M5 已实现 truncated_flag 但漏透传） | MED |
| **R2-2** bridge.ts 504 LOC 越过 ≤500 行护栏 | LOW |

### ❌ 反驳

- **R2-5** path_policy.rs HomeOnly 不解析 symlink — 注释明示设计取舍（HOME 内 symlink 指外需用户主动建，攻击面窄）→ 降 INFO 文档化 trust boundary

### G1-G7 修法

| Group | 修哪些 finding | 文件 |
|---|---|---|
| **G1** backup-restore path safety hardening | R2-3 + R2-4 + R2-6 + R2-9 + R2-10 | `backup-restore.ts` + `manager.ts`（export ID_RE） |
| **G2** redact case-insensitive | R2-11 | `redact.ts` |
| **G3** atomic tmp 唯一性 | R2-1 | `atomic.rs` |
| **G4** ConfigPanel mtime ref + App reload-on-CAS | R2-7 + R2-8 | `ConfigPanel.tsx` + `App.tsx` |
| **G5** bridge.ts 拆分 | R2-2 | `bridge.ts` 504 → 464 LOC + 新 `bridge-mtime.ts` 65 LOC |
| **G6** dch.rs truncated 透传 | R2-12 | `commands/dch.rs` + `bridge.ts` interface |
| **G7** 回归测补全 | 6 新 bun test + 3 新 cargo test | `backup-safety.test.ts` × `redact.test.ts` × `ConfigPanel.test.tsx` × `atomic.rs` × `proc_timeout.rs` |

### 新增模块

- **`src/client/bridge-mtime.ts`** (65 行)：mtime CAS 错误类型 + classifier 抽自 bridge.ts。self-contained pure 类型 + 字符串解析，bridge.ts re-export 保持 API 兼容

### 关键改动

- **`src/profiles/manager.ts`**：`ID_RE` 改 export 给 backup-restore.ts 早期校验
- **`src/profiles/backup-restore.ts`**（+147 行）：
  - 加 `safeJoinUnderRoot(rootAbs, rel)` helper 四道防线（null byte / 绝对路径 / `..` 段 / startsWith rootAbs）
  - applyBackup for-loop 头部加 `ID_RE.test(mp.id)` early validate + finalId 二道防线
  - finalDirAbs 三道防线 `startsWith(expectedRoot)`（默认 RESTORED_BASE / opt-in HOME）
  - manifest.shared.{dch_scripts,agents_paths}[i] 走 safeJoinUnderRoot
  - validateRestorePath 加「黑名单祖先」检查（`$HOME` / `$HOME/Library` 拒）+ 大小写不敏感比较
  - addProfile 失败 rm rollback pre-stat：dirPreExisted=true 时不 rm
- **`src/profiles/redact.ts`**：HTTP_AUTH regex `/g` → `/gi`
- **`src-tauri/src/atomic.rs`**：
  - 加 `static TMP_COUNTER: AtomicU64` + `unique_tmp_suffix() = pid + nanos + counter`
  - tmp_name 用 unique_tmp_suffix 杜绝同进程并发撞名
- **`src/client/components/ConfigPanel.tsx`**：useEffect else 分支补 `enterEditMtimeRef.current = scope.loadedMtimeUs`（touch-only mtime sync）
- **`src/client/App.tsx`**：onSave catch isMtimeMismatch 后调 `loadFilesOnly()`（让父级推最新 scope，「重新加载」按钮不再复用旧 scope）
- **`src/client/bridge.ts`**：mtime CAS class / classifySaveError 抽到 bridge-mtime.ts，bridge.ts 504 → 464 LOC（≤500 护栏 ✓）；DchCommandResult interface 加 `truncated: boolean`
- **`src-tauri/src/commands/dch.rs`**：DchCommandResult 加 `truncated` 字段 + serde camelCase + 透传 outcome.truncated

## 单测

R3 G7 加：
- `backup-safety.test.ts`（+3 测）：R2-3 mp.id 注入拒 + ~/.ssh sentinel 不被覆盖 / R2-4 shared.dch_scripts traversal 拒 / R2-4 shared.agents_paths traversal 拒；同时把 D3 validateRestorePath 测加 R2-6（HOME / HOME/Library 拒祖先）+ R2-10（`.SSH` / `library/LaunchAgents` 大小写不敏感拒）
- `redact.test.ts`（+1 测）：R2-11 lowercase `authorization:` / scheme `bearer` 脱敏
- `ConfigPanel.test.tsx`（+2 测）：T7 (R2-8 touch-only mtime sync) + T8 (R2-7 reload-on-CAS)
- `atomic.rs`（+2 测）：16 thread 并发同 path 写无撞名 + rename 失败 (dst 是非空 dir) tmp 已清理
- `proc_timeout.rs`（+1 测）：stderr 单独超 5MB cap + truncated=true（与 stdout 同款不让 child hang）

## 验证

| 项 | R1 收口（c95f1e8） | R3 收口（d40286c） |
|---|---|---|
| bun test | 251/251 | **257/257** |
| cargo test | 29/29 | **32/32** |
| cargo build --release | ✓ 42s | ✓ 23.94s |

## 关联

- [REVIEW_8.md](../../reviews/history/REVIEW_8.md) — 完整三态裁决清单 + R1+R2+R3 反驳/接受证据
- plan: [`<repo>/plans/deep-review-fix-20260514.md`](../../plans/history/deep-review-fix-20260514.md)（archive_plan 后归档到此）
