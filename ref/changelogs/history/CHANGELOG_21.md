---
changelog_id: 21
changed_at: 2026-05-15
---

# CHANGELOG_21 — Deep code review × R1 + R2 异构对抗 + G1-G12 收口

> base_commit: `8ad2fa0` → final_commit: `7d0bb75`
> 完成时间:2026-05-15
> 关联 review:[reviews/REVIEW_9.md](../../reviews/history/REVIEW_9.md)
> 关联 plan:[plans/dch-deep-review-20260515.md](../../plans/history/dch-deep-review-20260515.md)

## 概要

CHANGELOG_20 落地后开新一轮深度 code review,挖项目代码的优化 / 重构空间 + 顺手挖深层 bug。**12 个 fix commit (G1-G12)** 落地 R1 + R2 全部 ✅ HIGH (24) + MED (28) + 多 LOW/INFO,bun test 339 → **412 pass / 0 fail / 0 回归**,cargo test --test-threads=1 32 → **40 pass / 0 fail / 0 回归**。

scope 切 4 批并发(滑动窗口避撞 fan-out 5 上限):
- 🅰 secrets-dedup 算法 (secrets-index.ts / redact.ts + 测试)
- 🅱 backup / restore (backup.ts / backup-restore.ts / backup-manage.ts / backup-rules.ts)
- 🅲 Rust 安全 (path_policy.rs / atomic.rs / proc_timeout.rs / commands/{fs,dch,version,shell}.rs)
- 🅳 UI (RestoreBackupModal / BackupHistoryModal / ExportBackupModal / RestoreSecretsBody / bridge-backup.ts)

每批一对独立 reviewer-claude (Opus 4.7) + reviewer-codex (gpt-5.5 xhigh) 出 finding → 反驳轮(单方 HIGH 必走)→ 三态裁决 → fix commit。

## 主要变更(按 commit 分组)

### G1-G7 — R1 fix commit(已落地 R1 全部 ✅ HIGH/MED)

#### G1 (commit 0c3f144) — secrets-dedup 算法核心

- **redact.ts walkAndRedact**: 加 backslash 转义让含 `.` `[` `]` 的 key 名 fieldPath 单段还原(防 `{"api.key": "secret"}` 拼出 `$.api.key` 三段被 fan-out fill 误寻址)
- **redact.ts shortHash**: 空字符串 value 返 undefined 不参与 dedup(防把所有空 value 误合并成同 group → fan-out 时把 fieldName-1 错填给所有空 value 字段)
- **redact.ts redactJsonContent / redactTomlContent**: parse 失败 fall back `redactPlainTextContent` 兜底 + push warning 到 `result.warnings`(旧实现直接 `return { content, placeholders: [] }` 让真凭据原样进 dchpack)
- **redact.ts KEY_VALUE plain-text**: callback 重写保留分隔符 + 引号 + value 完整截至行尾或匹配引号(YAML / properties / TS 等 syntax 不破坏)
- **secrets-index.test.ts afterEach guard**: 防 beforeEach 失败时雪崩 7 个 EPERM

#### G2 (commit 79b9d3f) — backup/restore tmpDir 泄漏 + partial restore

- **backup-restore.ts parseBackup**: 整段包 try/catch 统一 cleanup tmpDir + rethrow(用户开发机已堆 44 个泄漏 `dch-restore-*` 目录)
- **backup-restore.ts**: PartialRestoreError 类 + bridge runDch / restoreApplyWithSecrets 共用 helper(`code !== 0 + stdout 是合法 result JSON 含 errors[]` → throw PartialRestoreError);UI catch instanceof 分支 setResult + onToast + await onReloadProfile 让用户看到部分还原报告
- **bridge.ts truncated**: parse stdout 前优先检查 `r.truncated` throw 清晰错误

#### G3 (commit db9fb40) — backup-restore 数据正确性

- **backup-restore.ts applyBackup**: mkdir + copyDirRecursive + 读 meta + addProfile 整段进同一 try/catch,catch 内复用 dirPreExisted 同款 rollback 逻辑;让单个 profile 失败不阻塞主流程,errors.push + continue 让 shared assets 阶段仍能跑
- **backup-manage.ts**: deleteBackup 加 `.dchpack` 后缀必检 + BACKUP_DIR 边界默认 enforce + allowOutsideBackupDir opt-out
- **backup-rules.ts**: 多个边界修正

#### G4 (commit 30b7d85) — Rust 安全加固 + 性能

- **proc_timeout.rs**: try_wait Some 父正常退出分支也 killpg 杀整组(detach grandchild 收尾 → reader EOF 退出避免每次 hook 累计 leak 2 thread × 8MB stack)
- **path_policy.rs**: 新增 check_path_canonical / check_path_for_write 加 fs::canonicalize 解 symlink 后再 boundary check(关闭「HOME 内 symlink 指向 HOME 外」攻击通道,3 种攻击实测堵死)
- **commands/fs.rs**: read_file / read_file_with_mtime / read_dir 走 check_path_canonical;save_file 走 check_path_for_write
- **commands/dch.rs**: TmpFileGuard RAII Drop trait 强制清理 tempfile(panic-safe)
- **atomic.rs**: tmp_name = pid + nanos + AtomicU64 counter 保证同进程任意 thread 调用唯一(并发写测试 16 thread 全成功)

#### G5a (commit 6650967) — UI secret state hygiene + 状态机 + 共用组件

- **RestoreBackupModal.tsx**: attemptClose 中央关闭逻辑 — secrets phase + 已填值时弹内联 confirm(CHANGELOG_5 不能用 window.confirm);3 入口(backdrop / X / 取消按钮)统一走
- **secret state hygiene**: setResult(r) 后立即 setSecretsState({}) 把明文残留窗口最小化到 IPC in-flight 那 N 秒
- **BackupHistoryModal.tsx**: silent refresh request sequence(reloadIdRef 单调递增 id,response 回到时只 commit id === latest 的结果,旧 stale 请求不污染新数据)
- **bridge-backup.ts**: PartialRestoreError + buildRestoreArgs helper(restoreApply / restoreApplyWithSecrets 共用)
- **format-bytes.ts**: 抽 src/client/format-bytes.ts 共用(ExportBackupModal / BackupHistoryModal / RestoreBackupModal 三处)
- **UniqueSecretsList.tsx**: 抽出共用 secret 清单组件 + CrossFieldBadge

#### G5b (commit d38461e) — D 批 INFO 顺手 + secrets-fill error 不含 secret 值验证

#### G6 (commit 180637a / 8ce7e0c) — 拆模块(架构债)

- **secrets-index.ts** (525 → 235 LOC): 拆出 `field-path.ts` (~280 LOC,parseFieldPath / setByFieldPath / applyFilledSecrets / fillSingleFile)
- **backup-restore.ts** (610 → 459 LOC): 拆出 `backup-restore-paths.ts` (~100 LOC,validateRestorePath / safeJoinUnderRoot / normalizePath / RESTORED_BASE / RESTORE_BLACKLIST)
- **backup-restore-secrets.ts** 新增 99 LOC: applyBackupWithSecrets 实现挪出
- **backup-shared.ts** 新增 180 LOC: 抽 backup.ts ↔ backup-restore.ts 双向 import 的共享 helper
- **bridge-core.ts** 新增 59 LOC: 抽 bridge.ts ↔ bridge-backup.ts 反向 import 的核心(call / runDch / timeouts / DchCommandResult)

#### G7 (commit 9073fb5) — listBackups 并发池上限 8

- **backup-manage.ts listBackups**: 用 `mapWithConcurrency` 限并发上限 8(避免 N=200 备份一次 spawn 200 tar 子进程 + EMFILE 风险)

### G8-G12 — R2 fix commit(R2 验证 R1 fix 不引 regression + 挖深一层)

#### G8 (commit 7265785) — A 批 secrets-dedup R2 HIGH×4 + MED×2 + INFO×2

- **redact.ts walkAndRedact 4 HIGH 全修**:
  - **detectTokenShape 兜底**: 中性 key (`{value: "sk-ant-..."}`) 配 token-shape value 也按 HIGH_CONFIDENCE_PATTERNS 命中
  - **sensitive key + array value**: 加 `Array.isArray(v) && isSensitiveKey(k)` 分支遍历 array 把 string item 换 placeholder
  - **TOML Date short-circuit**: walkAndRedact 入口加 `instanceof Date return node`(防 smol-toml Date 实例被 Object.entries 改写成空 table 损坏数据)
  - **KEY_VALUE charset**: unquoted 改 `[^\s,;|&"'\n\r]{8,}` + URL 整段优先分支(query 内 `&` 不截断)
- **field-path.ts**:
  - **parseFieldPath 加 `$[` 分支**: JSON 根数组 fan-out fill 不再 silent 漏写
  - **fillSingleFile tmpPath**: 加 randomUUID().slice(0,8) 后缀防同进程并发 race 撞名
  - **parsePathTokens**: 空 segment throw 而非静默吞(防御深度)
- 21 个新 redact / secrets-index 测试覆盖 4 HIGH 修法

#### G9 (commit 287d067) — B 批 backup/restore R2 HIGH×2 + MED×3 + INFO/LOW

- **backup-restore.ts applyBackup 2 HIGH**:
  - **applySharedFile 异常包 try/catch**: dch_scripts / agents_paths / ui-prefs 三处用 runSharedItem helper 统一 errors.push + continue + element-level `typeof rel === "string"` 校验
  - **applied/placeholders 假阳性 [NEW REGRESSION post-G3]**: 按 dryRun 分流 — dryRun 早 push;dryRun=false 进 try 后 addProfile 成功才 push,失败仅 errors.push 不污染
- **backup-manage.ts 2 MED**:
  - **pinBackup BACKUP_DIR + .dchpack 边界**: 复用 deleteBackup 同款双道保险 + allowOutsideBackupDir opt-out
  - **resolveBackupPath `..` 折叠 [NEW REG post-G3]**: 末尾 `path.resolve(abs)` 规范化 `..` 段(防 `${BACKUP_DIR}/../../etc/passwd` 字符串前缀绕过 startsWith)
- **backup-rules.ts EXCLUDE_PATTERNS**: 子目录段统一加 `**/` 前缀让任意深度匹配(INCLUDE 子树内 `.cache` / `.tmp` / `debug` / `sessions` 等都被 exclude;例外 `cache/**` 保留 root-only 防误伤 plugins/cache)
- **bridge-restore.ts 模块循环 import 修**: facade backup.ts 拆开 re-export 源(parseBackup/applyBackup 来自 backup-restore.ts;applyBackupWithSecrets 来自 backup-restore-secrets.ts),backup-restore.ts 不再 import / re-export secrets 模块,单向依赖干净
- 15 个新 backup-rules / backup-manage 测试覆盖 B-MED-3 / B-MED-2 / B-MED-1

#### G10 (commit 2c279d1) — C 批 Rust 安全 R2 HIGH×2 + MED×3 + LOW×2 + INFO×1

- **commands/version.rs C-HIGH-1**: get_tool_version IPC 入参从 `command: String` 重构为 `tool: ToolKind` enum (Zsh / Claude / Codex / OpenCode 4 个固定值)。后端按 enum 拼固定命令字符串,关闭 webview XSS / 受损 npm 调 `version("claude --version; rm -rf $HOME")` 的 shell -c 注入面;攻击面从「任意 string」收紧到「4 个 enum value」。bridge.ts ToolKind type 与 Rust enum 同步(serde rename_all = camelCase 让 OpenCode → "openCode")
- **atomic.rs C-HIGH-2**: save_file_if_mtime check_path → check_path_for_write 与 commands/fs.rs:164 save_file 对齐(端到端 PoC 实测旧 lexical 让 `$HOME/symlink-to-tmp/x` 写穿到 /tmp/outside-victim/)
- **commands/fs.rs 3 MED**:
  - **read_link_inner**: 中间目录 symlink 漏 → parent canonicalize + basename 拼接做 boundary check;允许 final 是 symlink (这正是 read_link 要读的)
  - **file_exists**: 改 check_path_for_write style 杜绝 HOME 内 symlink 指向 `/etc/sudoers.d/*` 等 enumerate 信息泄漏
  - **read_dir 契约 [NEW REGRESSION post-G4]**: 「不存在目录返空 Vec」契约被 R1 G4 canonicalize 前置打破(canonicalize 必报 ENOENT 让 caller 走错误路径) → check_path_canonical 失败时先做 lexical check 拒 boundary 攻击,通过 lexical 但 canonical 失败 → return Ok(空 Vec) 维持契约
- **commands/dch.rs C-MED-4 / C-LOW-1 / C-INFO-1**:
  - TmpFileGuard 创建挪到 open 成功后立即 wrap(panic-safe)
  - 复用 atomic::unique_tmp_suffix(pid + nanos + AtomicU64 counter)消除 R1 G4 清单"已抽 tmp_name helper 实际没做"债;atomic.rs unique_tmp_suffix 改 `pub(crate)`
  - run_dch_command_blocking 错误信息脱敏不暴露 builder path(env!("CARGO_MANIFEST_DIR") 编译时硬编码 builder username 让 webview 错误串泄漏)
- **proc_timeout.rs C-LOW-2**: polling sleep 50ms → 15ms(R1 G4 清单本说 10-20ms 实际未做);短命令 latency 显著降低,grace 仍 50ms 不变
- 3 个新 fs.rs cargo test 覆盖 read_link parent symlink / read_dir 契约 / read_dir HOME 外不存在路径仍拒

#### G11 (commit c506cd6) — D 批 UI R2 MED×3 + LOW×4 + INFO×1 + RestoreBackupModal 拆件

- **D-MED-1**: ExportBackupModal / BackupHistoryModal attemptClose 扩散(busy 中 backdrop / X 直接 no-op);R1 D-HIGH-2 fix 只覆盖 RestoreBackupModal,本两 modal 同款 vulnerable
- **D-MED-2**: BackupHistoryModal silent reload 失败仅 console.warn 不 toast(silent reload 是后台同步,toast 暴露给关闭后的 modal 让用户困惑;非 silent 是用户显式刷新 / pin / rm 后的 reload,toast 让用户看到失败原因)
- **D-MED-4 (升 MED)**: RestoreBackupModal.tsx 593 LOC 超 500 行护栏 + dead code `_UnusedToolKind` → 拆 5 sub-component 到 restore-modal-bodies.tsx (CloseConfirm / RestorePreviewBody / RestoreReportBody / SharedActionsList / PlaceholdersList);RestoreBackupModal.tsx 593 → 352 LOC ✓;新文件 258 LOC ≤ 500 ✓
- **D-LOW-1**: BackupHistoryModal refreshing 也 disable row 操作(busy={busy || refreshing})
- **D-LOW-2**: bridge-backup.ts PartialRestoreError 缺 appliedProfiles/sharedActions 时构造抛 TypeError 掩盖原因 → 进入 PartialRestoreError 前显式校验两个 array 完整,失败走 plain Error 含描述
- **D-LOW-3**: format-bytes.ts vs cli-shared.ts:formatBytes byte-for-byte 完全重复 → 抽 `src/format-bytes.ts` 中立位置,client/format-bytes.ts re-export 保持 caller import 路径不变;cli-shared.ts 改 re-export
- **D-LOW-4**: bridge-backup.ts 错误信息 timeout=300000ms 不 humanize → 加 humanizeTimeout helper 转 "5 分钟" / "30 秒"
- **D-INFO-1**: ExportBackupModal toggle setSelected functional update 替代闭包捕获(防 React batched render 下 stale state)

#### G12 (commit 7d0bb75) — D 批 5 个 invariant test (D-MED-3)

抽 3 个 pure decide helper 到 `restore-modal-helpers.ts`(decideAttemptClose / countFilledSecrets / shouldCommitReloadResponse / nextSecretsStateAfterIPC),让 invariant test 不需 RTL render 整 component。RestoreBackupModal.tsx attemptClose handler 改为「计算 filledCount + 调 helper 决策 + dispatch」,setSecretsState 5 处 reset 调用统一改 nextSecretsStateAfterIPC() helper。

bridge-backup.ts 同款 export 2 个 helper(consumeRestoreResult / buildRestoreArgs)给 invariant test 直接调。

5 个 invariant test (bridge-backup.invariants.test.ts, **30 个 it**):
1. **consumeRestoreResult** (D-HIGH-1 + D-LOW-2): timeout / truncated / partial restore valid / partial restore 缺 array 走 plain Error 不抛 TypeError / 正常 success
2. **buildRestoreArgs** (D-MED-6): 各 opts 组合 args 顺序与内容
3. **decideAttemptClose** (D-HIGH-2): busy / phase / hasSecrets / filledCount 各分支
4. **shouldCommitReloadResponse** (D-MED-5): reload race resolution(reloadIdRef 模式 pure 抽出)
5. **nextSecretsStateAfterIPC** (D-MED-1): secret state hygiene reset

## 测试增量

| 阶段 | bun test | cargo test (--test-threads=1) |
|---|---|---|
| 基线 (8ad2fa0) | 339 pass | 32 pass |
| R1 末态 (9073fb5) | 346 pass (+7) | 37 pass (+5) |
| R2 末态 (7d0bb75) | **412 pass (+66)** | **40 pass (+3)** |

零回归(每个 commit 后 bun + cargo 全过)。

## Follow-up(已记录,未实施)

- `src/profiles/backup-restore.ts` 515 LOC(超 500 护栏 15 行)— G9 B-HIGH-2 collectPlaceholders helper + 注释膨胀;留待后续 G6 类拆分(applySharedFile / fileSha256 / copyDirRecursive 抽到 backup-shared.ts)
- B-LOW-1 (codex MED-3 *未验证* 降): createBackup --keep TOCTOU。Bun 当前没暴露 O_CREAT|O_EXCL 原子创建-或-失败 API,接受边界,follow-up 重写为 fs.open(wx) 时一并修
- path_policy `with_home` env race: cargo test multi-thread 偶发 `accepts_home_root_and_subpath` fail(已知,跑 `--test-threads=1` 全过);follow-up 给 with_home 加 mutex 让 env 互斥串行
- A-LOW-1: plain-text fill 失败 UX 不闭环。R1 G1 已部分修(报清晰 error),follow-up 加 UI surface 处理
