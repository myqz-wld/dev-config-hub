# REVIEW_9 — Deep Code Review × R1 + R2 异构对抗(G1-G12 收口)

> base_commit: `8ad2fa0` → final_commit: `7d0bb75`
> 完成时间:2026-05-15
> 关联 changelog:[CHANGELOG_21.md](../changelogs/CHANGELOG_21.md)
> 关联 plan:[plans/dch-deep-review-20260515.md](../plans/dch-deep-review-20260515.md)

## 触发场景

用户主动深度 review:挖项目代码的优化 / 重构空间 + 顺手挖深层 bug。focus = 重构 / 优化为主 + 顺手挖 bug(用户 R1 选择)。R1 base_commit `8ad2fa0`(CHANGELOG_20 落地后)。

## 方法

### 异构对抗 reviewer 配对

按 plan §设计决策 2「scope 4 批并发」+ 滑动窗口策略(避撞 fan-out 5 上限)。

| 批 | scope | LOC | reviewer 配对 |
|---|---|---|---|
| 🅰 | secrets-dedup 算法 (secrets-index.ts / redact.ts + 测试) | 1632 | reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 xhigh |
| 🅱 | backup / restore (backup.ts / backup-restore.ts / backup-manage.ts / backup-rules.ts) | ~1500 | 同款异构 |
| 🅲 | Rust 安全 (path_policy.rs / atomic.rs / proc_timeout.rs / commands/{fs,dch,version,shell}.rs) | ~1700 | 同款异构 |
| 🅳 | UI (RestoreBackupModal / BackupHistoryModal / ExportBackupModal / RestoreSecretsBody / bridge-backup.ts) | ~1700 | 同款异构 |

### 流程

- **R1**:每批一对独立 reviewer 出 finding → 反驳轮(单方 HIGH 必走)→ 三态裁决(✅/❌/❓)→ R1 fix commit (G1-G7)
- **R2**:重 spawn 同对 reviewer + skip 字段列 R1 已修 finding → R2 finding(验证 fix 不引 regression + 挖深一层)→ 反驳轮 → 三态裁决 → R2 fix commit (G8-G12)

### 关键纪律(R1+R2 全程)

- 任何 ✅ HIGH 必须满足验证条件:**双方独立提出** OR **单方 + lead 现场实证**(grep 出 N 处证据 / 写小 test 复现挂掉 / 跑命令确认)
- 弱断言关键词(可能 / 也许 / 应该 / 大概)只允许出现在 *未验证* 条目
- reviewer-codex 失败禁止降级双 Claude(同源化破坏异构)

## R1 三态裁决总览(commit 0c3f144 G1 → 9073fb5 G7)

> 基线 base_commit = `8ad2fa0`,bun test 339 pass / cargo 32 pass。

### A 批 secrets-dedup R1

- ✅ HIGH ×4(双方 + 跨批):
  - A-HIGH-1: secrets-index.ts parseDotPath 也识别 `key[i]` 段(TOML array-of-tables fieldPath 可逆)
  - A-HIGH-2 = B-HIGH-2 跨批: redact.ts parse 失败 fall back regex 兜底 + warning(不再 leak 真凭据进 dchpack)
  - A-HIGH-3: shortHash 空字符串 → undefined(buildSecretsIndex 不把空 value 误合并成同 group)
  - A-HIGH-4: KEY_VALUE regex 命中后 callback 保留分隔符 + 引号(不损坏 YAML / TS / properties)
- ✅ MED 多条 + LOW + INFO 顺手做

### B 批 backup/restore R1

- ✅ HIGH ×4(双方 + 一条跨批):
  - B-HIGH-1 = A-claude M1 跨批: KEY_VALUE plain-text 替换破坏 YAML(同 A-HIGH-4)
  - B-HIGH-2 = A-HIGH-2 跨批: parseBackup `Bun.file(manifestPath).json()` 失败不 cleanup tmpDir(用户已堆 44 个泄漏)
  - B-HIGH-3 (架构债): backup-restore.ts 559 LOC 超 500 护栏 → 拆模块(G6)
  - B-HIGH-4: applyBackup 中段抛错无 rollback → 整段进 try/catch
- ✅ MED ×4 + LOW + INFO

### C 批 Rust 安全 R1

- ✅ HIGH ×1(实测 CONFIRMED):
  - C-HIGH-1: proc_timeout.rs try_wait Some 父正常退出分支不 killpg → reader thread leak(detach 孙子持 stdio pipe FD)
- ✅ MED ×3:
  - C-MED-1: read_link_inner Path::starts_with 不 canonicalize `..` → traversal
  - C-MED-2: dch.rs run_dch_with_secrets_temp_blocking cleanup 不在 RAII guard,panic 跳过
  - C-MED-3: file_exists 没走 PathPolicy → 信息泄漏

### D 批 UI R1

- ✅ HIGH ×2:
  - D-HIGH-1 升 HIGH+: partial restore 报告丢失 + onReloadProfile 不可达 → PartialRestoreError 类
  - D-HIGH-2: step 3 任意关闭路径丢全部 secret 输入 → attemptClose + 内联 confirm
- ✅ MED ×7(含跨批多方):
  - D-MED-1: secret 明文残留 React state → setSecretsState 立即清
  - D-MED-2 = C-codex LOW 跨批: truncated 不消费
  - D-MED-3 三方独立: secrets tempfile RAII(同 C-MED-2)
  - D-MED-4: SecretEntryRow re-render + formatBytes 重复
  - D-MED-5: BackupHistoryModal silent refresh race → request sequence
  - D-MED-6: bridge-backup args 构造重复 → buildRestoreArgs helper
  - D-MED-7: secret 清单跨 modal 不一致 → UniqueSecretsList 共用

## R2 三态裁决总览(commit 7265785 G8 → 7d0bb75 G12)

> 基线 R1 末态 = `9073fb5`,bun test 346 pass / cargo 37 pass。
> R2 重 spawn 同款 reviewer 配对 + skip 字段列 R1 已修。

### A 批 secrets-dedup R2

- ✅ HIGH ×4 全部 walkAndRedact / KEY_VALUE 边界全修:
  - A-HIGH-1 (双方): walkAndRedact 中性 key 漏脱敏 token-shape value(`{value: "sk-ant-..."}` 直接进 dchpack)→ detectTokenShape 兜底
  - A-HIGH-2 (双方): sensitive key + array value 漏脱敏(`{tokens: ["sk-real-1", ...]}`)→ Array.isArray + isSensitiveKey 分支
  - A-HIGH-3 (双方): walkAndRedact TOML Date 改写成空 table → instanceof Date short-circuit
  - A-HIGH-4 (双方): KEY_VALUE unquoted greedy 吞 `,;|&` → charset 改 `[^\s,;|&"'\n\r]{8,}` + URL 整段优先
- ✅ MED ×2:
  - A-MED-1 [NEW REGRESSION post-G1/G6]: parseFieldPath 不识别 `$[i]` JSON 根数组 → 加 `$.startsWith("$[")` 分支
  - A-MED-2: fillSingleFile tmpPath 同进程并发 race → 加 randomUUID().slice(0,8) 后缀
- ✅ LOW + INFO 顺手做

### B 批 backup/restore R2

- ✅ HIGH ×2:
  - B-HIGH-1 (双方): applyBackup shared 资源 applySharedFile 异常逃出 try/catch → runSharedItem helper 包 try/catch + element-level `typeof rel === "string"`
  - B-HIGH-2 [NEW REGRESSION post-G3] (双方): applyBackup applied[]/placeholders[] 假阳性(addProfile 失败时已 push 不 splice)→ 按 dryRun 分流,addProfile 成功后才 push
- ✅ MED ×3:
  - B-MED-1: pinBackup 缺 BACKUP_DIR + .dchpack 后缀边界(同 deleteBackup R1 修法扩散)
  - B-MED-2 [NEW REG post-G3]: deleteBackup `..` 可逃逸(resolveBackupPath 不 normalize)→ resolve(abs) 折叠 `..`
  - B-MED-3: EXCLUDE_PATTERNS 子目录段不跨深度 → `**/<name>/**` 前缀(例外 `cache/**` 保留 root-only 防误伤 plugins/cache)
- ✅ LOW + INFO

### C 批 Rust 安全 R2

- ✅ HIGH ×2:
  - C-HIGH-1 (Tauri capability 默认 allow + CSP null): get_tool_version IPC 入参 `command: String` 重构为 `tool: ToolKind` enum(Zsh / Claude / Codex / OpenCode 4 个固定值)。攻击面从「任意 string」收紧到「4 个 enum value」
  - C-HIGH-2 (双方 + 端到端 PoC 写穿): atomic.rs save_file_if_mtime 仍用 lexical check_path → 改 check_path_for_write,与 fs.rs:164 save_file 对齐
- ✅ MED ×4:
  - C-MED-1 (双方 PoC reproducer): commands/fs.rs read_link_inner 中间目录 symlink 漏 → parent canonicalize + basename 拼接做 boundary check
  - C-MED-2 (双方 PoC reproducer): file_exists 仍用 lexical check_path → 改 check_path_for_write style
  - C-MED-3 [NEW REGRESSION post-G4]: read_dir 「不存在目录返空 Vec」契约被 canonicalize 前置打破 → check_path_canonical 失败检测 ENOENT 走 fs::read_dir 兜底
  - C-MED-4: TmpFileGuard 创建晚于 write_all → 挪到 open 成功后立即创建
- ✅ LOW ×2 + INFO ×1

### D 批 UI R2

- ✅ MED ×3(D-MED-3 测试盲区移到 G12):
  - D-MED-1 (双方独立): ExportBackupModal / BackupHistoryModal backdrop / X 在 in-flight 时无 busy guard → attemptClose 扩散
  - D-MED-2: BackupHistoryModal silent refresh error onToast 暴露给关闭后的 modal → silent 失败仅 console.warn
  - D-MED-4 (升 MED): RestoreBackupModal.tsx 593 LOC 超 500 + dead code → 拆 5 sub-component 到 restore-modal-bodies.tsx + 删 dead code(593 → 352 LOC)
- ✅ LOW ×4:
  - D-LOW-1: BackupHistoryModal refreshing 没传 BackupGroup → busy={busy || refreshing}
  - D-LOW-2: PartialRestoreError 缺 appliedProfiles/sharedActions 时抛 TypeError 掩盖原因 → 显式 array 校验失败走 plain Error
  - D-LOW-3: format-bytes.ts vs cli-shared.ts:formatBytes 重复 → 抽 src/format-bytes.ts 中立位置
  - D-LOW-4: bridge-backup.ts timeout=300000ms 不 humanize → humanizeTimeout helper "5 分钟"
- ✅ INFO ×1: ExportBackupModal toggle setSelected 反模式 → functional update

### G12 测试盲区补全(D-MED-3)

5 个 invariant test (bridge-backup.invariants.test.ts, 30 个 it):
1. consumeRestoreResult — partial restore / timeout / truncated / D-LOW-2 array 缺失保护
2. buildRestoreArgs — 各 opts 组合 args 顺序与内容
3. decideAttemptClose — busy / phase / hasSecrets / filledCount 各分支
4. shouldCommitReloadResponse — reload race resolution(reloadIdRef 模式 pure 抽出)
5. nextSecretsStateAfterIPC — secret state hygiene reset

为支撑测试,抽 3 个 pure decide helper 到 `restore-modal-helpers.ts`:
- `decideAttemptClose` — attemptClose 决策
- `countFilledSecrets` — 计算待 fill secrets phase 已填值数量(skip 优先 / 空 value 不算)
- `shouldCommitReloadResponse` — reload race resolution

## R1 + R2 fix commit 映射

| commit | tag | 主题 | finding 范围 |
|---|---|---|---|
| `0c3f144` | G1 (R1) | secrets-dedup 算法核心 | A-HIGH-1/2/3/4 + 多 MED |
| `79b9d3f` | G2 (R1) | tmpDir 泄漏 + partial restore + truncated | B-HIGH-2/5 + D-HIGH-1 + D-MED-2 |
| `db9fb40` | G3 (R1) | backup-restore 数据正确性 + 中段无 rollback | B-HIGH-1/4 + B-MED-1/2/3 |
| `30b7d85` | G4 (R1) | Rust 安全加固 (HOME symlink / reader leak / RAII) | C-HIGH-1/2 + C-MED-1/2/3 + C-codex M4 + C-LOW-1 |
| `6650967` | G5a (R1) | UI secret state hygiene + attemptClose + 共用组件 + memo + race fix | D-HIGH-1/2 + D-MED-1/4/5/6/7 |
| `d38461e` | G5b (R1) | D 批 INFO 顺手 + secrets-fill error 不含 secret 值验证 | D-INFO 等 |
| `180637a` | G6 (R1) | 拆 secrets-index/backup-restore (525→235/610→459 + 3 新文件) | A-MED-1 + B-HIGH-3 架构债 |
| `8ce7e0c` | G6 2/2 (R1) | 抽 bridge-core + backup-shared 消除双向 import | 模块边界 |
| `9073fb5` | G7 (R1) | listBackups 并发池上限 8 防 fd 耗尽 | B-codex L1 |
| `7265785` | G8 (R2) | A 批 secrets-dedup R2 HIGH×4 + MED×2 + INFO×2 + 21 新测试 | A-R2 全 |
| `287d067` | G9 (R2) | B 批 backup/restore R2 HIGH×2 + MED×3 + INFO/LOW + 15 新测试 | B-R2 全 |
| `2c279d1` | G10 (R2) | C 批 Rust 安全 R2 HIGH×2 + MED×3 + LOW×2 + INFO×1 + 3 新 cargo test | C-R2 全 |
| `c506cd6` | G11 (R2) | D 批 UI R2 MED×3 + LOW×4 + INFO×1 + RestoreBackupModal 拆件 | D-R2 (除 D-MED-3 测试) |
| `7d0bb75` | G12 (R2) | R2 测试盲区补全 — 5 个 invariant test (D-MED-3) | D-MED-3 |

## 反驳轮记录(关键反驳)

R1 + R2 共触发反驳轮 ~10 次,关键 3 次:

1. **D-claude H1 → D-codex 反驳降 MED**(secret 明文残留 React state):D-codex 反驳同意 finding 但建议降 MED — 攻击面需本地 React DevTools / renderer instrumentation,与 D-codex M3 合并修
2. **B-claude H4 自标 *未验证* → 送 B-codex 反驳轮**(applyBackup 中段无 rollback):B-codex 反驳同意 → 升 ✅ HIGH
3. **R2 反驳轮**:多个 [NEW REGRESSION post-Gx] 类 finding(如 A-MED-1 / B-HIGH-2 / B-MED-2 / C-MED-3)是 R1 fix 引入的回归,R2 反驳轮全部 ✅ 同意立即修

## 已实施 / 未实施 / Follow-up

### 已实施(全部 ✅)

R1 + R2 全部 ✅ HIGH + MED 都已 commit 落地;LOW + INFO 大部分顺手做。

### Follow-up(已记录,未实施)

- **`src/profiles/backup-restore.ts` 515 LOC**(超 500 护栏 15 行)— G9 B-HIGH-2 collectPlaceholders helper + 注释膨胀;留待后续 G6 类拆分(applySharedFile / fileSha256 / copyDirRecursive 抽到 backup-shared.ts)
- **B-LOW-1 (codex MED-3 *未验证* 降)**: createBackup --keep TOCTOU。Bun 当前没暴露 O_CREAT|O_EXCL 原子创建-或-失败 API,接受边界,follow-up 重写为 fs.open(wx) 时一并修
- **path_policy `with_home` env race**: cargo test multi-thread 偶发 `accepts_home_root_and_subpath` fail(已知,跑 `--test-threads=1` 全过)。follow-up 给 with_home 加 mutex 让 env 互斥串行
- **A-LOW-1**: plain-text fill 失败 UX 不闭环。R1 G1 已部分修(报清晰 error),follow-up 加 UI surface 处理

### 反驳证伪(❌ — 暂无)

R1+R2 所有 finding 反驳后均 ✅ 或部分 ❓ 后 lead 现场验证;暂无明确 ❌ 证伪条目。

## 测试覆盖

| 阶段 | bun test | cargo test (--test-threads=1) | 说明 |
|---|---|---|---|
| 基线 (8ad2fa0) | 339 pass | 32 pass | R1 起点 |
| R1 末态 (9073fb5) | 346 pass | 37 pass | +7 bun test (G1 / G2 / G6 等) + 5 cargo test (G4) |
| R2 末态 (7d0bb75) | **412 pass** | **40 pass** | +66 bun test (G8 +21 / G9 +15 / G11 0 + G12 +30) + 3 cargo test (G10) |

零回归(每个 commit 后 bun + cargo 全过)。

## 已知踩坑

- A-codex 报告其 review 时只读沙箱让 `mkdtemp` 失败 → 7 个写盘测试 EPERM。**reviewer 沙箱限制,不是项目代码 bug**;但 secrets-index.test.ts:360 的 afterEach 缺 guard 让测试失败链雪崩(L1)是真问题(已 G1 fix)
- 主仓库根目录有个 1.6GB `-C` 大文件(untracked,前一会话 reviewer 误把 `tar -czOf` 与 `-C <dir>` 混淆产生)。不影响 fix / 测试 / commit。**收口时建议问 user 是否要 `rm -- '-C'` 释放磁盘**(谨慎 — 任何工具用 `-C` 当 path 还需 `rm --` 防 flag 解析)
- bun test 必须走 `zsh -i -l -c "bun test"`(登录式 zsh 才能注入 PATH 让子进程 `Bun.spawn` 找到 bun);直接 `/Users/apple/.bun/bin/bun test` 会让 backup-safety.test.ts 的 `Bun.spawn(["bun", ...])` 报 ENOENT 假阳 fail(已踩坑,2026-05-15 G12 验证测试时复现)
