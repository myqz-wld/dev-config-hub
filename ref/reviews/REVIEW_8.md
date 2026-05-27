# REVIEW_8 — Deep Code Review × 2 轮异构对抗 + Round 3 fix

## 触发场景

用户驱动「深度 code review」诉求 — Group A-E 已完成 Tauri v2 async + spawn_blocking 修复后想做最终质量闸门，覆盖近期所有 Profile / 备份 / CLI / UI 改动 + Tauri Rust 后端的 path safety / async 边界 / TOCTOU / 资源 lifecycle。两轮（R1 全量挖深 → 5 commit fix → R2 fix 验证）+ Round 3 fix 收口；用 `agent-deck:deep-code-review` SKILL 编排，跨 batch 共 8 个 reviewer 会话。

## 方法

- **双异构对抗**：reviewer-claude (Opus 4.7 thinking) × reviewer-codex (gpt-5.5 xhigh wrapper)，每轮每 team 各一对；finding 双方独立提出 = ✅ HIGH，单方独有 + 现场实测复现 = ✅，否则走反驳轮 / 降级 ❓ / ❌
- **Scope 切片**（避免单 reviewer 上下文过载）：`backend-core` (Rust + 后端 ts: profiles / backup / cli) × `cli-ui` (React + bridge + CLI flag + Modal)
- **工具**：mcp `agent-deck` (spawn_session / send_message / wait_for_message / shutdown_session) + lead 自己 grep / Read / 写小测 / 跑 `bun --eval` 实测复现做现场验证

## Round 1（base_commit = 0a136b6 → 5 commit fix）

R1 全量挖出 **10 HIGH + 19 MED**。Group A-E 5 commit 全收口。详见 plan `deep-review-fix-20260514.md` 的 Group A-E checklist；本节只列 HIGH 摘要：

| ID | 主题 | 严重度 | fix commit |
|---|---|---|---|
| H1 | 7 个 Tauri sync command 阻塞 webview（webview 假死直到完成） | HIGH | f392123 |
| H2 | backup walkFiles 不防 symlink dir → backup 含 /etc 内容 | HIGH | 3458a35 |
| H3 | store-lock 静态 staleMs=60s vs 持锁 1200s → multi-process lost update | HIGH | cc74bbd |
| H4 | backup latest.dchpack 非 atomic（半写废了用户最近 backup） | HIGH | 3458a35 |
| H5 | backup restore 写任意 path（恶意 .dchpack configDir_original 任意覆盖） | HIGH | 3458a35 |
| H6 | cli main.catch / cmdRemove prompt / use exit code missing 破坏 JSON 协议 | HIGH | a30816e |
| H7 | save_file mtime TOCTOU（前端 enter-edit 后外部改，save 静默覆盖） | HIGH | f392123 + c95f1e8 |
| H8 | CMEditor init 不响应 prop 变更（language / theme 切换 noop） | HIGH | c95f1e8 |
| H9 | save_file path 任意写（webview 可写 /etc/hosts / ~/.ssh） | HIGH | f392123 |
| H10 | main.tsx innerHTML XSS（unhandledrejection event.reason 未逃逸） | HIGH | c95f1e8 |

MED 详见各 commit。R1 验证：bun test 251/251 + cargo test 29/29 + cargo build --release ✓。

## Round 2 三态裁决（4 reviewer 全到 + 现场验证 + commit d40286c R3 fix 收口）

R2 验证 5 个 R1 fix commit (f392123 / a30816e / cc74bbd / 3458a35 / c95f1e8) 是否引入新 bug / 漏修边角。新挖 **5 HIGH + 5 MED + 1 LOW + 5 INFO/LOW**。

### ✅ 真问题（必修，已 R3 commit d40286c 收口）

| ID | 文件:行号 | 摘要 | 严重度 | 提出方 / 验证手段 |
|---|---|---|---|---|
| **R2-3** | backup-restore.ts:209 | `mp.id` 不校验 → `join(RESTORED_BASE, "../.ssh") = "$HOME/.ssh"` 真逃逸；addProfile 失败 catch 走 `rm -rf` 删任意 HOME 子目录（凭据 / SSH key 任意覆盖 + 删除） | **HIGH** | B-codex 单方；lead 现场 `bun --eval path.join` 实测 ✅ |
| **R2-4** | backup-restore.ts:309/318 | `manifest.shared.{dch_scripts,agents_paths}[i]` rel 不校验 → `join("$HOME/.dch/scripts", "../../.ssh/foo") = "$HOME/.ssh/foo"`；applySharedFile 直接 copyFile 写到任意 HOME 路径 | **HIGH** | B-codex 单方；现场实测 ✅ |
| **R2-6** | backup-restore.ts:62-78 | `validateRestorePath` 允许**黑名单祖先**（`$HOME` / `$HOME/Library`）→ `--allow-original-path` 模式 .dchpack 内 `LaunchAgents/x.plist` 落子树 | **HIGH** | U-codex 单方；现场实测 `validateRestorePath($HOME/Library)=null` ✅ |
| **R2-1** | atomic.rs:90 | tmp_name 仅 PID 区分 → Tauri spawn_blocking worker pool 多线程并发同 path 写互相覆盖、silent data corruption | **HIGH↑** | **B-codex + B-claude 双方独立**；B-claude 实测 20 thread 18/20 失败 ✅ |
| **R2-7+R2-8** | ConfigPanel.tsx 49-67 + App.tsx 167 | mtime ref 维护漏洞两 case：(R2-7) CAS 失败 banner 弹后用户点「重新加载」依赖父级 reload 但 App.tsx onSave catch 不调 loadFilesOnly → 旧 scope；(R2-8) edit 模式下外部 `touch`（mtime 变 content 不变）→ enterEditMtimeRef 不更新 → save 透传 stale → 误报 banner | **MED** | U-codex + U-claude 不同 case 同根；U-claude stateful test 复现 ✅ |
| **R2-9** | backup-restore.ts:296-302 | addProfile 失败 rm -rf 在 `--allow-original-path` + 撞已有非备份目录 → 误删用户原数据（注释里说 finalDirAbs 永远是本次新建的前提错） | **MED** | B-claude 单方；read 代码确认 existingDirs 只来自 store 不跟 fs 比 ✅ |
| **R2-10** | backup-restore.ts:71 | 黑名单大小写敏感（`.SSH` / `library/LaunchAgents` 通过校验，macOS APFS / HFS+ 默认 case-insensitive 同 inode） | **MED** | B-codex 单方；现场实测 ✅ |
| **R2-11** | redact.ts:204 | HTTP_AUTH regex 末尾 `/g` 不是 `/gi` → lowercase `authorization:` 漏脱敏（HTTP request log / curl 例子常见） | **MED** | B-codex 单方；read 代码 + 反向测复现 ✅ |
| **R2-12** | commands/dch.rs:122 | `DchCommandResult` 没透传 `truncated` 字段（M5 已实现 truncated_flag 但 dch.rs 没传给 TS bridge） | **MED** | B-codex 单方；read 代码确认 ✅ |
| **R2-2** | bridge.ts | 504 LOC 越过 ≤500 行护栏（c95f1e8 +95/-4 触发线） | **LOW** | **U-codex + U-claude 双独立**；wc -l = 504 ✅ |

### ❌ 反驳（不修）

| ID | 反驳依据 |
|---|---|
| **R2-5** path_policy.rs HomeOnly 不解析 symlink (B-codex-H3 提) | path_policy.rs:12-13 注释明示「symlink walk 不在本层处理；只做字符串/组件级校验，不解析 symlink」是有意取舍。攻击面：HOME 内 symlink 指外需用户**主动**建（webview 不能创建 symlink），attacker controlled scenario 难达成。**降 INFO 文档化 trust boundary**，不修 |

### ❓ LOW/INFO（不阻塞合并，记录）

- B-claude-L1 proc_timeout stderr cap 单测缺 → R3 G7 已补
- B-claude-L2 atomic.rs 失败 tmp 清理单测缺 → R3 G7 已补
- B-claude-L3 backup-safety.test M1 e2e 缺 → R3 G7 已补
- B-claude-L4 backup.ts spawnSimple 无 timeout（trade-off 接受，不修）
- B-claude-M3 *未验证* parseBackup schema check 缺（自降级 → 下个 PR）
- B-claude-I1-I4 文档 / cosmetic（不影响 runtime，下个 PR cosmetic 一并清理）
- U-claude-I3 CMEditor mount 时 5 个 compartment noop reconfigure（注释明示有意 trade-off，不修）
- U-claude-I2 ConfigPanel.test.tsx 缺 touch-only 回归测试 → R3 G7 已补 T7

## Round 3 fix（commit d40286c）

按 priority + 同根分组 G1-G7：

| Group | 修哪些 finding | 文件 |
|---|---|---|
| **G1** backup-restore path safety hardening | R2-3 + R2-4 + R2-6 + R2-9 + R2-10 | `backup-restore.ts` + `manager.ts`（export ID_RE） |
| **G2** redact case-insensitive | R2-11 | `redact.ts` |
| **G3** atomic tmp 唯一性 | R2-1 | `atomic.rs` |
| **G4** ConfigPanel mtime ref + App reload-on-CAS | R2-7 + R2-8 | `ConfigPanel.tsx` + `App.tsx` |
| **G5** bridge.ts 拆分 | R2-2 | `bridge.ts` 504 → 464 LOC + 新 `bridge-mtime.ts` 65 LOC |
| **G6** dch.rs truncated 透传 | R2-12 | `commands/dch.rs` + `bridge.ts` interface |
| **G7** 测试补全 | 6 新 bun test + 3 新 cargo test | `backup-safety.test.ts` × `redact.test.ts` × `ConfigPanel.test.tsx` × `atomic.rs` × `proc_timeout.rs` |

**G7 回归测覆盖**：
- backup-safety: R2-3 mp.id `..` 注入拒 + ~/.ssh sentinel 不被覆盖 / R2-4 shared.dch_scripts traversal 拒 / R2-4 shared.agents_paths traversal 拒 / R2-6 黑名单祖先（`$HOME` / `$HOME/Library`）拒 / R2-10 case-insensitive (`.SSH` / `library/LaunchAgents`) 拒
- redact: R2-11 lowercase `authorization` / scheme `bearer` 脱敏
- ConfigPanel: T7 (R2-8 touch-only mtime sync 不弹 banner + save 用最新 mtime) / T8 (R2-7 reload-on-CAS 后「重新加载」按钮使用最新 scope)
- atomic.rs: 16 thread 并发同 path 写全成功（无 tmp 撞名）+ 残留 tmp 全清理 / rename 失败 (dst 是非空 dir) tmp 已清理
- proc_timeout.rs: stderr 单独超 5MB cap + truncated=true（与 stdout 同款，不让 child hang）

## 验证

| 项 | R1 收口 | R3 收口 |
|---|---|---|
| bun test | 251/251 | 257/257 |
| cargo test | 29/29 | 32/32 |
| cargo build --release | ✓ 42s | ✓ 23.94s |

## 关联 changelog

CHANGELOG_18 — fix(review_8 r3): Round 2 三态裁决新挖 4 HIGH+5 MED+1 LOW path safety + atomic + UI 收口 (commit d40286c)

## 反驳轮 / 沉淀

- **R2-5 path_policy symlink 反驳**：注释明示设计取舍 + 攻击面窄；保留为「文档化 trust boundary」
- **R2-1 atomic tmp_name 同根 finding** 双方独立提出 + B-claude 实测 18/20 fail，**异构强冗余 + 现场验证** 升级 HIGH 必修
- **R2-3 + R2-4 + R2-6 + R2-9 + R2-10 同根**：全在 backup-restore.ts，根因是「path 校验链不严密」（mp.id / shared rel / validateRestorePath 黑名单 / 大小写 / addProfile rollback pre-stat 五个独立 checkpoint 各漏一处）；G1 一次修透：抽 `safeJoinUnderRoot` helper + ID_RE early validate + finalDirAbs 二道防线（startsWith expectedRoot）+ validateRestorePath 黑名单祖先 + case-insensitive lowercase 比较 + addProfile rollback pre-stat
- **agent-pitfall 候选**：Edit 工具的 old_string 中文标点（：vs :, ，vs ,）必须严格逐字符对齐 — 本会话 G5 多次 Edit fail 因抄写时混用中英文逗号 / 冒号；后续考虑加候选到 conventions tally
