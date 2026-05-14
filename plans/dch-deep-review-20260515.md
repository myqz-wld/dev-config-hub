---
plan_id: dch-deep-review-20260515
created_at: 2026-05-15T00:30:00+08:00
status: completed
base_commit: 8ad2fa0
base_branch: main
final_commit: 7d0bb75
completed_at: 2026-05-15
worktree_path: /Users/apple/Repository/personal/dev-config-hub
note: 项目 deep review 历史惯例不进 worktree,直接在主仓库 fix + commit(REVIEW_2/4/6/7/8 同款)。worktree_path 填 mainRepo 是兼容 hand_off_session schema,实际无 worktree 隔离。
---

# Plan: dch-deep-review-20260515

> 项目代码深度 review × 多轮异构对抗(reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 xhigh)+ fix 收口。

## 用户授权(全程贯穿,hand off 时一路传下去)

> "你一路推进吧,hand off 的时机自己把握。上面在所有会话都保持,hand off 时一路传下去。"

**含义**:
1. lead 自主推进整个 deep review × fix × 反驳轮 × 收口流程,不停下问 user 决策(除非真有歧义)
2. hand off 时机由 lead 自主判断(典型:context ≥ 60% / 完成独立 phase / 大批 fix 落地后等)
3. hand off prompt 必须包含本条授权,让下一 session 也保持自主推进 + hand off 自定姿势

**触发回头问 user 的例外**:
- reviewer 多次卡死 + 合规兜底也炸 → 必须 user 决策
- 出现破坏性操作(rm -rf / git reset --hard / force push)
- 反驳轮后仍 50:50 拉扯不清 → user 拍板

## 总目标

挖项目代码的优化 / 重构空间 + 顺手挖深层 bug。focus = 重构 / 优化为主 + 顺手挖 bug(用户 R1 选择)。

## 不变量

- 项目主仓库 `/Users/apple/Repository/personal/dev-config-hub` HEAD = base_commit 推进,fix 直接在主仓库 commit
- 收口前 README + changelog 不写,等 R1+R2(+RN)全收口后写 CHANGELOG_21 + REVIEW_9
- 不引新依赖(除非反驳轮共识必需)
- bun test + cargo test 必须 0 回归

## 设计决策(不再争论)

1. **不进 worktree**:项目历史 deep review 惯例(REVIEW_2/4/6/7/8 全在主仓库 commit),fix 都是确定要合的修复,worktree 收益小。worktree_path 填 mainRepo 兼容 hand_off_session schema
2. **scope 4 批并发**(用户选择):每批一对 reviewer = 8 reviewer 同时跑;撞 fan-out 5 上限,采用滑动窗口策略 — 前 5 起,A/B 收齐后 shutdown 释放 fan-out 给 D 一对
3. **focus = 重构 / 优化 + 顺手挖 bug**(用户 R1 选择)
4. **hand off 时机 lead 自定**(用户授权),典型:R1 全收齐裁决 + R1 fix commit 完成后,如果 context ≥ 60% 就 hand off
5. **plan 文件位置**:`.claude/plans/dch-deep-review-20260515.md`(in_progress 短期工作目录,完成后挪到 `<main>/plans/` 入 git)

## scope 切批

| 批 | 主题 | 文件 | 总 LOC |
|---|---|---|---|
| 🅰 secrets-dedup 算法 | secrets-index.ts (500) / redact.ts (283) / secrets-index.test.ts (526) / redact.test.ts (323) | 1632 |
| 🅱 backup/restore 流程 | backup.ts (488) / backup-restore.ts (559) / backup-manage.ts (231) / backup-rules.ts (~120) / cli-backup.ts (430) | 1828 |
| 🅲 Rust 拆模块 | atomic.rs (338) / commands/fs.rs (351) / commands/dch.rs (214) / proc_timeout.rs (341) / path_policy.rs (~150) / shell.rs (~140) | 1534 |
| 🅳 UI + bridge | RestoreBackupModal.tsx (487) / RestoreSecretsBody.tsx (264) / ExportBackupModal.tsx (319) / BackupHistoryModal.tsx (312) / bridge.ts (384) / bridge-backup.ts (~250) | 2016 |

## 步骤 checklist

- [x] Step 1 — scope 切批 + 8 reviewer spawn(A/B 完整 + C-claude 起;C-codex/D 待 fan-out)
- [x] Step 2 — 写本 plan 文件做时间隔离 hand off 准备
- [x] Step 3 — A 两 reply 收齐 → 反驳轮 → 三态裁决落定 → shutdown A 释放 fan-out
- [x] Step 3.5 — spawn C-codex(sid c7245249,fan-out 4/5)
- [x] Step 4 — 等齐 B 两反驳 reply → B 三态裁决 → shutdown B 释放 fan-out
- [x] Step 5 — spawn D 一对(B shutdown 释放后)
- [x] Step 6 — 等齐 C 两 reply → C 三态裁决 → shutdown C
- [x] Step 7 — 等齐 D 两 reply → D 三态裁决 → shutdown D
- [x] Step 8 — R1 真问题清单汇总 + fix commit(主仓库)— **G1-G4 已完成 + commit**
- [ ] Step 8.5 — G5 + G6 + G7 fix(UI / 拆模块 / 顺手 LOW/INFO)
- [ ] Step 9 — R2 spawn(同对 reviewer 复用 + skip 字段)
- [ ] Step 10 — R2 反驳轮 + fix
- [ ] Step 11 — 视情况 R3 / 收口
- [ ] Step 12 — 写 REVIEW_9.md + CHANGELOG_21.md + plans 归档

## C 批裁决落定(R1) — ✅ 收口

### C 批反驳轮 ✅ 同意 + 3 种攻击实测

✅ **C-HIGH-1**: proc_timeout reader thread leak (双方独立) — 已记 (修法:try_wait Some 分支也 killpg 兜底)

✅ **C-HIGH-2 (反驳后升 HIGH)**: path_policy HomeOnly 纯 lexical prefix HOME 内 symlink 绕过
- C-codex 单方 HIGH → C-claude 反驳同意 (sid e7cd0de2)
- **3 种攻击全部跑通实测**:
  1. `fs::read($HOME/symlink-to-etc/hosts)` → 读到 /etc/hosts 前 120 字节(信息泄漏)
  2. `fs::read_dir($HOME/symlink-to-etc)` → 列出 /etc 含 sudoers.d / krb5.keytab(枚举越权)
  3. `save_file($HOME/symlink-to-tmp/x)` → 实测写穿到 /tmp/outside-victim/(写越权 + 数据破坏)
- path_policy.rs 注释自相矛盾(声称防 webview 任意路径但只做 lexical check)
- 触发路径:XSS / 恶意依赖注入 + HOME 内既存 symlink (stow / chezmoi / 用户 ln -s)
- **修法选项 A (推荐)**:fs 操作前 `fs::canonicalize(path)` 解出真实路径再 check starts_with(home);save_file 写新文件用 path.parent().canonicalize() + basename 拼接;统一 `..` + symlink 拒绝到 path_policy.rs 一处(与 read_link_inner 漏 `..` 同一类 lexical-vs-canonical 问题一并处理)
- 回归测试约束:第 4 条要保留合法用例 — 用户 `dch profile add claude foo --dir /opt/shared/claude-conf` 把 `~/.claude` symlink 指向 HOME 外不能误伤

✅ **C-MED-1**: read_link_inner 漏 `..` (双方独立)
✅ **C-MED-2**: dch.rs panic secret tmp 残留 (双方独立 + D-codex 跨批再次确认)
✅ **C-MED-3**: file_exists 不走 PathPolicy (双方独立)
✅ **C-LOW-1**: tmp 文件名生成两份独立实现缺 counter (双方独立)

### C 批 lead 自验 (单方 MED 后续 R1 fix 阶段)
- C-codex MED 4: shell.rs source rc 不压 stdout 污染 JSON bridge / version 解析

### C 批 INFO / LOW 直接列 (R1 fix 顺手做)
- Command 构建 4 行重复 (build_shell_command helper)
- try_wait polling 50ms latency
- Regex::new hot path 重编译 (改 OnceLock)
- Cargo.toml 未使用依赖 (serde_json / tauri-plugin-shell / tauri-plugin-dialog)
- dch.rs:127 truncated 透传但 runDch 不消费 (与 D-codex M1 跨批同款,升级到 ✅ 双方独立 MED)

## D-claude R1 finding (已收,反驳轮已发)

### HIGH (2 条)
1. **D-claude H1 RestoreBackupModal.tsx:127-156** — 还原成功后 secret 仍以明文残留 React state
   - `setResult(r)` 后 secretsState.secretsMap 不清空,直到「关闭」按钮 unmount 才 GC
   - DevTools / Profiler / Time Travel debugging 能 attach 读完整 secret 树
   - 文件顶端注释 (line 23-25) 声称「secret 仅一次性 IPC 走 tempfile route」与实际行为冲突
   - 修法:`setResult(r)` 后立即 `setSecretsState({ secretsMap: {}, skipMap: {} })` (成功 + 失败两个分支都加);可同时在 IPC 调用前已构造完 filledMap 后立刻清 secretsState 把窗口最小化到 IPC in-flight 那 N 秒
   - **🟡 单方独有 HIGH → 反驳轮已发 (msg 5aa24b95)**

2. **D-claude H2 RestoreBackupModal.tsx:180-240** — step 3 任何关闭路径都丢全部 secret 输入,无 confirm
   - backdrop 点击 / ✕ 按钮 / 「取消」按钮三处都裸调 `onClose()`
   - 手填 99 个 secret 后不小心点 modal 外区域整批丢失
   - 修法:包 `attemptClose()`:`phase === "secrets"` 且 `filledCount > 0` 时弹**内联** confirm (CHANGELOG_5 不能用 window.confirm),三个入口统一走这函数
   - **✅ 双方独立** (D-codex M4 同根 — busy 时 backdrop / X 仍可关 modal,严重度更窄)

### MED (4 条)
1. **D-claude MED 1 RestoreSecretsBody.tsx:37-46, 69-79** — `updateValue` 每键 spread 整 state,99 entries 全 re-render (无 React.memo + 父无 useCallback) — **✅ 双方独立** (D-codex LOW 3 同款)
2. **D-claude MED 2 ExportBackupModal.tsx:270 + BackupHistoryModal.tsx:307** — formatBytes 完全重复定义 — **✅ 双方独立** (D-codex LOW 3 同款)
3. **D-claude MED 3 bridge-backup.ts:113-128 vs 138-165** — restoreApply / restoreApplyWithSecrets args 构造重复 + 错误处理重复 (与 runDch 也几乎重复)
4. **D-claude MED 4** — secret 清单 UI 跨 modal 不一致:Export 带 `⚡N` / RestorePreviewBody 不带 / SecretEntryRow 又带 (三处不一致,跨场景信息泄露)

### LOW (4 条)
1. ExportBackupModal useState 缺 lazy init (`useState(() => new Set(...))`)
2. ExportBackupModal elapsed timer 100ms 频率过头 (3s 备份 30 次 re-render),改 250-500ms
3. BackupHistoryModal 每 mount silent refresh 无 cache TTL (50 备份 ~5s 后台 IPC),用 `backupCache.fetchedAt` 检查
4. RestoreBackupModal step 2 没有 back to step 1 (换路径) 按钮

### INFO (3 条)
1. bridge.ts (385 行) 仍可拆 loadAllVersions/loadAllFiles → bridge-config-loader.ts (未到 500 强制拆,可选)
2. BackupHistoryModal BackupGroup onClose 重复传三遍 (封装传 onRestore)
3. RestoreSecretsBody step 3 顶部 hint 提示用户关闭 DevTools (Tauri webview dev mode 能 attach)

### *未验证* (1 条)
- bridge-backup.ts:155-159 错误处理依赖「CLI 不会在 error message 拼 secret 值」隐式契约,grep `cli-backup.ts:281: for (const e of r.secretsErrors.slice(0, 5))` 内容是否含 secret 值未验证

## D-codex R1 finding (已收,待 D-claude 配对)

### HIGH (1 条)
1. **D-codex H1 bridge.ts:245 + bridge-backup.ts:156 + RestoreBackupModal.tsx:130** — partial restore 已写盘但 UI 当成纯失败,报告页和 `onReloadProfile()` 都不可达
   - `bridge.ts:245` `if (r.code !== 0) throw new Error(parsed.error || ...)` 对任何 non-zero exit 直接 throw
   - 但 CLI JSON 模式 `errors.length > 0` 会 stdout 输出 `{ ok:false, manifest, ...result }` 后 `process.exit(1)`
   - 前端收到非零退出 throw → `setResult(r)` / 错误报告渲染 / `await onReloadProfile()` 全跳
   - 修法:非零退出但 stdout 是 restore result JSON 时返回 typed partial result,或抛 `PartialRestoreError` 让 modal 渲染结果并 reload
   - **与 B 批 H4/H5 是同根:partial restore + cleanup + UI 反馈一起修**

### MED (5 条)
1. **D-codex M1 bridge.ts:224**: `truncated` 已透传但前端忽略 — **跨批与 C-codex LOW 3 同款 → 升级到 ✅ MED 双方独立**
2. **D-codex M2 BackupHistoryModal.tsx:42**: 备份历史 silent refresh 与删除/置顶 reload 乱序覆盖 (race)
   - cache hit mount 跑 silent reload(true),仅设 refreshing 不 disable 行操作
   - 用户在 silent refresh 期间删除/置顶 → 二次 reload → 旧请求最后完成把旧 items 写回 state/cache
   - 修法:加 request sequence 只允许最后一次 reload commit;或 refreshing 期间禁用写操作
3. **D-codex M3 RestoreBackupModal.tsx:44 + RestoreSecretsBody.tsx:124**: secret 真值进 React state 受控 input,React DevTools 可读
   - 用户安装 React DevTools (常见 dev 设置) → 能读 secretsMap.* 真值
   - 修法:secret 值放 uncontrolled input refs,React state 只存 done/skipMap,提交时从 refs 组装并立即清空
4. **D-codex M4 RestoreBackupModal.tsx:180**: busy 时 footer 取消禁用,但 backdrop / 右上角 X 仍能卸载 modal → setState on unmounted
   - ExportBackupModal / BackupHistoryModal 同样模式
   - 修法:busy 时拦截 backdrop / X,或 mounted/request guard 禁止 unmounted setState
5. **D-codex M5 src-tauri/src/commands/dch.rs:183**: secrets tempfile 写入失败不清理 (与 C-claude MED M2 + C-codex MED 2 同款,跨批) — **再次确认 C-MED-2 RAII 修复必要性**

### LOW (3 条)
1. bridge-backup.ts 拆分后反向 import bridge.ts,bridge.ts re-export/import backup,职责边界仍混 — 修法:抽 `bridge-core.ts` 放 `call/runDch/timeouts/DchCommandResult`,bridge.ts 只 barrel + profile facade
2. `restorePreviewSecrets` 无 caller 且会重新跑 preview IPC — 修法:删掉或改纯函数 `extractPreviewSecrets(manifest)`
3. RestoreSecretsBody / BackupHistoryModal 大列表无虚拟化无 memo + `formatBytes` 重复 — 修法:抽共享 helper,secret rows React.memo,history 加分页/虚拟列表

### 验证
- `bun test RestoreSecretsBody.test.tsx + bridge.test.ts` 19 pass / 0 fail
- 测试覆盖纯 helper,**未覆盖** Restore modal 状态机 / bridge-backup IPC / partial restore / truncated / BackupHistory reload race

## C 批裁决进度(R1) — 待 C-claude 反驳 reply

### C 批 ✅ 双方独立确认

✅ **C-HIGH-1**: proc_timeout reader thread leak (C-claude HIGH 实测 + C-codex MED 3 同根因) — 双方独立 → ✅ HIGH 真问题
- 修法:try_wait Some 分支也 killpg 兜底;或保留 child.stdout/stderr 主线程持有副本超时后 drop 强关 fd 让 reader EOF

✅ **C-MED-1**: read_link_inner 漏 `..` (C-claude MED M1 实测 + C-codex U1 未验证) — 双方独立 (C-claude 实测 confirmed) → ✅ MED 真问题
- 修法:read_link_inner 第一行加 `if p.components().any(|c| matches!(c, Component::ParentDir)) { return Err(...); }`;最佳是抽 `check_path_with_home(path, home, policy)` pure 版供 read_link_inner 复用

✅ **C-MED-2**: dch.rs panic 路径 secret tmp 残留 (C-claude MED M2 实测 + C-codex MED 2 同款) — 双方独立 → ✅ MED 真问题
- 修法:`struct TmpFileGuard(PathBuf); impl Drop { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }` 替手工 remove_file

✅ **C-MED-3**: file_exists 不走 PathPolicy (C-claude MED M3 + C-codex MED 1) — 双方独立 → ✅ MED 真问题
- 修法:加 `check_path(&path, PathPolicy::HomeOnly)`,失败返 false (与现 unwrap_or(false) 语义对齐)
- C-codex 还指出:lib.rs:29 注册但 `rg` 没找到前端 invoke,可能完全删除更彻底

✅ **C-LOW-1 (双方独立 INFO/LOW)**: tmp 文件名生成两份独立实现 (atomic 有 pid+nanos+counter,dch.rs 少 counter) — C-claude INFO + C-codex LOW 2
- 修法:抽 `tmp_name(prefix, ext)` 公共 helper,两边复用

### C 批待反驳轮(C-codex 单方 HIGH)

🟡 **C-HIGH-2 (待反驳)**: path_policy HomeOnly 是纯 lexical prefix,HOME 内 symlink 可绕到 HOME 外读写
- C-codex 单方 HIGH,自标"动态 symlink 复现被只读沙箱阻断"未实测
- 反驳轮已发给 C-claude (msg id bd28a2e8)
- 待 reply 后做最终裁决

### C 批 lead 自验 (单方 MED)

❓ **C-codex MED 4**: shell.rs:66 source rc 不压 stdout,污染 JSON bridge / version 解析
- 单方 MED,典型踩坑场景 — lead 自验 grep `dch.rs` JSON parse caller 是否真有可能撞这个

### C 批 INFO / LOW (直接列)

- C-claude INFO: Command 构建 4 行重复 (build_shell_command helper)
- C-claude INFO: try_wait polling 50ms latency (短命令多 50-100ms 延迟,调 10-20ms)
- C-claude INFO: Regex::new hot path 每次冷启动编译 (改 OnceLock)
- C-codex LOW 1: Cargo.toml 未使用依赖 (serde_json / tauri-plugin-shell / tauri-plugin-dialog)
- C-codex LOW 3: dch.rs:127 truncated 透传但前端 `runDch` 不消费 (>5MB 成功 JSON 退化成 parse error 而非显式截断)

## B 批裁决落定(R1) — ✅ 收口

### B 批反驳轮全部 ✅ 同意

✅ **B-HIGH-1**: redact.ts plain-text YAML `:` → `=` 损坏配置 (B-claude H1 + 跨批 A-claude MED 同款) — 实测 yaml 损坏
- 修法:replace callback 多捕获分隔符 + 引号,callback 拼回原 layout

✅ **B-HIGH-2**: parseBackup manifest 损坏 leak tmpDir (B-codex H1 + B-claude H2 双方独立 + 用户已堆 44 个)
- 修法:`Bun.file(...).json()` 包 try/catch,catch 内 rm tmpDir + throw

✅ **B-HIGH-3 (降为 MED-架构债)**: backup-restore.ts 559 LOC 超护栏 — 机械事实
- 修法:拆 `backup-restore-paths.ts` (validateRestorePath / safeJoinUnderRoot / normalizePath / RESTORED_BASE / RESTORE_BLACKLIST,~100 行) + `backup-restore.ts` 主流程 (~400 行)

✅ **B-HIGH-4**: applyBackup 中段无 rollback (B-claude H4 + B-codex 反驳同意 sid a7d91a27)
- 修法:把 mkdir + copyDirRecursive + 读 meta + addProfile 整段进同一 try/catch,catch 内复用现 `dirPreExisted ? skip : rm` 逻辑;或抽 `applyOneProfile()` async 函数 + 主循环 try/catch wrap

✅ **B-HIGH-5**: cli-backup.ts process.exit 跳 finally tmpDir leak (B-codex H2 + B-claude 反驳同意 sid 6f2d645e)
- B-claude 真 CLI 端到端实测:用户系统 dch-restore- 目录 45 → 46 累积,leaked dir 含完整解压 dchpack
- 触发面:applyBackup 9 处 errors.push callsite 任一命中 + JSON mode → process.exit(1)
- 与 B-HIGH-2 是**两条独立 leak 路径**,要连体修
- 修法:让 printRestoreResult 返回 exit code 而非自己 exit,cmdRestore 在 finally 之后再 process.exit(exitCode);或 process.on("exit") 注册 sync rm 兜底

### B 批 MED (单方独有,lead 自验阶段)

- B-codex M1 (--keep 同秒覆盖): 修同 pinBackup 加 fileExists 循环
- B-codex M2 (backup-rm 任意路径): 加 `.dchpack` 后缀 + BACKUP_DIR 边界校验
- B-codex M3 (manifest schema 空 字段直接解引用): 加 lightweight schema parse
- B-claude M1 (ui-prefs 写但不读): applyBackup 末尾加 ui-prefs.json 还原
- B-claude M2 (spawnSimple 不消费 stdout + 无 timeout): footgun 加 stdout consume + AbortController timeout
- B-claude M3 (dryRun vs restore finalDirAbs 时序错位): renameMap 沉淀 dryPlan 决议结果

### B 批 LOW (3 条) + INFO (4 条)

按 R1 fix 顺手做。

## A 批裁决落定(R1)

✅ **A-HIGH-1**: TOML 数组-of-tables fieldPath 不可逆
- A-claude H1 单方 → A-codex 反驳 (sid 75b573b6 reply): bun -e 复现 setResult=false → ✅ 同意
- 修法:`parseDotPath` 也识别 `key[i]` 段;与 parseJsonPath 共享同一段 tokenizer

✅ **A-HIGH-2**: broken JSON/TOML 真凭据进 dchpack (双方独立)
- A-codex H1 + A-claude H2 同款,A-claude 实测 sk-ant-... LEAK 进 dchpack
- 修法:parse 失败时 fall back 到 `redactPlainTextContent(content)` regex 兜底,并 push warning 到 manifest.security_warnings

✅ **A-HIGH-3**: empty hash 跨字段误合并 (双方独立)
- A-claude H3 = A-codex M3 同根因,A-claude 论证后果 (fan-out 写错字段) 升 HIGH
- 修法:`shortHash` 在 v === "" 时 return undefined → buildSecretsIndex 把它当 wholeFile 各自独立 logical key

✅ **A-HIGH-4**: KEY=VALUE 正则字符集漏 `:` / 符号 (反驳后 ✅)
- A-codex H2 单方 → A-claude 反驳 (sid ee2892bb reply): bun -e 跑 6 个 case 全裸奔 → ✅ 同意 + 给了 3 case 强化 (Slack webhook url / BASIC_AUTH user:pass / 密码含 shell special)
- 修法:KEY_VALUE 命中后**完整截至行尾或匹配引号**,let value 整体进 placeholder,不 charset

✅ **A-MED-1**: secrets-index.ts 500 LOC 卡上限 (双方独立 + 机械事实)
- 修法:按 4 段拆 `secrets-index.ts`(types + buildSecretsIndex,~200 行)+ `field-path.ts`(parseFieldPath / setByFieldPath / applyFilledSecrets / fillSingleFile,~280 行)

❓ **lead 自验** (单方 MED 待 R1 fix 阶段验证):
- A-codex M1 (.md/.sh placeholder fill 失败 written=0) — 验后续是否真的 user 体验 broken
- A-codex M2 (fieldPath 不转义含 `.` / `[` 的 key) — A-codex 反驳里说这是 parseFieldPath 同根因子问题,与 H1 同修
- A-claude M2 (KEY_VALUE plain-text 破坏 YAML cosmetic 影响) — 与 H1/H2 修同时一并改

❓ **lead 自验** (单方 MED 但偏 LOW):
- A-claude M2 (fillSingleFile 非原子写) — `--allow-original-path` opt-in 模式才 risk,默认模式 risk 微

直接列:
- A-codex L1 (afterEach undefined tmpDir guard) — 测试代码鲁棒性,顺手 fix
- A-claude INFO 4 处测试盲区 — R1 fix commit 时附测试

## B 批裁决落定(R1) — 待 B-claude 反驳 reply

### B 批反驳轮进度

✅ **B-HIGH-4 confirmed** (B-claude finding,B-codex 反驳同意 sid a7d91a27): applyBackup 中段抛错无 rollback
- 代码事实核查 CONFIRMED: try/catch 从 :373 才开始,只 cover addProfile;前面 mkdir / copyDirRecursive / `Bun.file(metaPath).json()` 全裸 await
- 异常传播路径 CONFIRMED: 主循环 break,后续 profiles 不还原,shared assets 跳过
- Caller 核查 CONFIRMED: cli-backup.ts finally 只 cleanupParsed 不动 finalDirAbs
- B-codex 修正:`fileExists` 自身 catch stat 错误不是主要抛点,真正裸抛是 mkdir / copyDirRecursive / `Bun.file(metaPath).json()`
- 修法:把 mkdir + copyDirRecursive + 读 meta + addProfile 整段进同一 try/catch,catch 内复用现 `dirPreExisted ? skip : rm` 逻辑

🟡 待 B-claude 反驳 B-codex H2 (cli-backup.ts:246 process.exit 跳 finally)

## reviewer 状态(实时)

| Batch | reviewer-claude | reviewer-codex |
|---|---|---|
| A | ⛔ shutdown(R1 收口 + 反驳完) | ⛔ shutdown(R1 收口 + 反驳完) |
| B | 🟡 反驳中 (B-codex H2 process.exit 跳 finally) | 🟡 反驳中 (B-claude H4 applyBackup 中段无 rollback) |
| C | ✅ R1 reply 已收 (待 codex 配对) | 🟢 R1 review 进行中 (sid c7245249 刚 spawn) |
| D | ⏳ 待 spawn (B shutdown 释放 fan-out 后) | ⏳ 待 spawn |

fan-out: 4/5 (B-claude / B-codex / C-claude / C-codex)

## reviewer session id

| Batch | reviewer-claude sid | reviewer-codex sid | team_id |
|---|---|---|---|
| A | bd80a030-7efc-4044-b24a-3a2074bae89f | 6880986e-2602-47b9-a2c5-a0c58f5b4ecf | e4b64b6e-b1bf-4f13-98d3-d0a1ae350195 |
| B | e06e4a2b-a68c-453f-8063-7f1b177e62ff | 8febc9ac-7eb0-4c9e-864a-1e3b404a6316 | 9950d793-3d78-4bff-9ec3-844a2453c8a7 |
| C | e5235978-ab32-4337-8765-1516f8e614af | (待 fan-out 释放后 spawn) | c613b202-a92a-4113-a978-318264a32b5e |
| D | (待 fan-out 释放后 spawn) | (待 fan-out 释放后 spawn) | (待创建,team_name=dch-deep-review-D-ui-bridge) |

## 步骤 checklist

- [x] Step 1 — scope 切批 + 8 reviewer spawn(A/B 完整 + C-claude 起;C-codex/D 待 fan-out)
- [x] Step 2 — 写本 plan 文件做时间隔离 hand off 准备
- [x] Step 3 — A 三态裁决 (commit 0c3f144 G1)
- [x] Step 4 — B 三态裁决 (commit 79b9d3f G2 + db9fb40 G3)
- [x] Step 5 — C 三态裁决 (commit 30b7d85 G4)
- [x] Step 6 — D 三态裁决 (commit 6650967 G5a + d38461e G5b)
- [x] Step 7 — R1 真问题清单汇总 + 7 fix commit (G1-G7) 全部落地
- [x] Step 8 — R2 spawn(滑动窗口 2 批并发,A+B → 收口 → C+D)+ R2 review 全部收齐 + 反驳轮 + 三态裁决
- [x] Step 9 — R2 fix commit (G8-G12) 全部落地 ✓
- [ ] Step 10 — 视情况 R3 / 收口
- [ ] Step 11 — 写 REVIEW_9.md + CHANGELOG_21.md + plans 归档

## R2 reviewer session id (最终,全部 closed)

| Batch | reviewer-claude sid | reviewer-codex sid | team_id |
|---|---|---|---|
| A r2 | e5c05781-4ba6-4c37-bf65-78cc465b3e3b ⛔ | 2b3027b0-bc08-4fe9-a12b-61128b722b07 ⛔ | 3869e37a-d8bc-4254-a4d1-8769d55bb4ba |
| B r2 | fed57dc5-70eb-4c94-b1d0-adc094cb7dd7 ⛔ | 9446140c-3b37-41ec-9513-bec449ce90a5 ⛔ | 2f28c264-a0eb-43e1-8c50-86c1cfca8fae |
| C r2 | 6ac3a23c-17d9-497e-8234-48b9ab65d6b4 ⛔ | d4783794-0e75-44d7-9186-a3ffa8f0cb32 ⛔ | e6d7349a-83ef-4346-8d11-d6cf42e35516 |
| D r2 | e31416c2-849b-454c-88ba-848a9eead4e4 ⛔ | adcf7e56-f5c5-4149-8395-4fc56beb982a ⛔ | 5c7a89f7-18fd-4def-a7b4-5c5ea45e5d33 |

**lead session sid**:f62ecceb-dfb8-425e-a7a6-8d663552fe58(本会话,hand off 来的)

## R2 真问题清单(裁决落定)— 按 G8-G12 commit 分组

### G8 — A 批 secrets-dedup R2(~8 条)

**HIGH ×4**(walkAndRedact 3 sibling + KEY_VALUE URL 分支优先):
- A-HIGH-1 (codex HIGH-1 PoC + claude H1 同函数 sibling): `redact.ts:106` walkAndRedact 中性 key 漏脱敏 token-shape value(`{"value":"sk-ant-..."}` 直接进 dchpack)
  - 修法:walkAndRedact 加 token-shape regex 检测分支,即使 key 名不在 SENSITIVE_KEYS 也按 value shape 命中
- A-HIGH-2 (claude H1 PoC + codex 同 sibling): `redact.ts:106` sensitive key + array value 漏脱敏(`{tokens: ["sk-real-1", ...]}` 真值进 dchpack)
  - 修法:walkAndRedact 加 `Array.isArray(v) && isSensitiveKey(k)` 分支遍历 array,fieldPath 拼 `[i]`
- A-HIGH-3 (codex HIGH-2 PoC + claude 反驳同意 PoC): `redact.ts:101` walkAndRedact TOML Date 改写成空 table
  - 修法:walkAndRedact 入口加 `if (node instanceof Date) return node;` short-circuit
- A-HIGH-4 (claude H2 PoC + codex 反驳同意): `redact.ts:294` KEY_VALUE greedy 吞行内非空白分隔符 → 数据 silent 破坏
  - 修法:URL 分支优先整段匹配,普通 token 用 `[^\s,;|&\n\r]{7,}` charset + lookahead 边界

**MED ×2**:
- A-MED-1 (codex MED-1 PoC) [NEW REGRESSION post-G1/G6]: `redact.ts:98` JSON 根数组 fieldPath 生成 `$[0]...`,`field-path.ts:52` parseFieldPath 不识别 `$[`,setByFieldPath false
  - 修法:parseFieldPath 加 `if (fp.startsWith("$["))` 分支
- A-MED-2 (claude M1): `field-path.ts:303` fillSingleFile tmpPath 仅用 `process.pid`,future race
  - 修法:tmpPath 加 `crypto.randomUUID().slice(0,8)` 后缀

**LOW + INFO**:
- A-LOW-1 (codex MED-2 降): plain-text fill 失败 UX 不闭环 — R1 G1 已部分修(报清晰 error),follow-up
- A-INFO-1 (claude I1): `field-path.ts:72-107` parsePathTokens 静默吞空 segment(`$.a..b`)— 防御深度 throw
- A-INFO-2 (claude I2): `secrets-index.ts` empty fieldName logical key `-1` — 边角

### G9 — B 批 backup/restore R2(~8 条)

**HIGH ×2**:
- B-HIGH-1 (codex HIGH-1 + claude 反驳同意 + 端到端 PoC + 二阶 state corruption): `backup-restore.ts:377-401` shared 资源 applySharedFile 异常绕过 errors[]
  - 修法:shared 循环每个 applySharedFile 包 try/catch + errors.push + continue;`manifest.shared.{dch_scripts,agents_paths}[i]` 加 element-level `typeof rel === "string"` 校验
- B-HIGH-2 (claude H2 PoC + codex MED-1 [NEW REGRESSION post-G3]): `backup-restore.ts:286-368` applyBackup applied[]/placeholders[] 假阳性(addProfile 失败时已 push 不 splice)
  - 修法:把 applied.push / placeholder 收集 / existingIds.add / existingDirs.add 都挪进 try/catch 内,addProfile 成功后才 push;dryRun 路径继续早 push

**MED ×3**:
- B-MED-1 (claude H1 PoC + codex LOW-1): `backup-manage.ts:254-284` pinBackup 缺 BACKUP_DIR + `.dchpack` 后缀边界
  - 修法:复用 deleteBackup 同款两道保险 + allowOutsideBackupDir opt-out
- B-MED-2 (codex MED-2 + lead 自验) [NEW REG post-G3]: `backup-manage.ts:209` deleteBackup `../` 可逃逸(resolveBackupPath 绝对路径不 normalize)
  - 修法:resolveBackupPath 用 `resolve(abs)` 规范化或调用方加 normalize;deleteBackup `..` 段拒绝
- B-MED-3 (claude M1 实测): `backup-rules.ts:45-81` EXCLUDE_PATTERNS 子目录段不跨深度,INCLUDE 子树内 `.cache/` `.tmp/` 漏过滤
  - 修法:EXCLUDE_PATTERNS 子目录段统一加 `**/` 前缀(`**/.cache/**` 等);加回归 test

**LOW + INFO**:
- B-LOW-1 (codex MED-3 *未验证* 降): backup.ts:169 --keep TOCTOU
- B-LOW-2 (claude L1): backup-restore.ts ↔ backup-restore-secrets.ts G6 引入新循环 import — 修法:把 applyBackup 等挪到 backup-shared.ts
- B-INFO-1 (claude I1): backup-restore.ts:224-227 prefix 校验放循环内 noisy errors

### G10 — C 批 Rust 安全 R2(~8 条)

**HIGH ×2**:
- C-HIGH-1 (codex HIGH-1 + claude 反驳同意 + Tauri capability 未配 + CSP null): `commands/version.rs:14-18,28` get_tool_version IPC 直传 shell -c 无白名单
  - 修法 (推荐 B):重构 IPC 入参为 `enum ToolKind { Zsh, Claude, Codex, OpenCode }`,后端按 enum 拼固定命令;前端 `version("claude --version")` → `version(ToolKind.Claude)`。攻击面从「任意 string」收紧到「4 个 enum value」
- C-HIGH-2 (codex HIGH-2 + claude 反驳同意 + 端到端 PoC 写穿): `atomic.rs:148` save_file_if_mtime 仍用 lexical check_path 绕过 G4 write-side canonical policy
  - 修法:`check_path(&path, ...)` → `check_path_for_write(&path, ...)`(一行改),与 commands/fs.rs:164 对齐

**MED ×4**:
- C-MED-1 (codex MED-4 + claude MED-1 双方 PoC reproducer): `commands/fs.rs:254-284` read_link_inner 中间目录 symlink 漏(R1 G4 fix 不彻底)
  - 修法:`read_link_inner` 入口改 `check_path_canonical(p.parent())` style 让 parent 解 symlink + 允许 final 是 symlink
- C-MED-2 (codex MED-3 + claude MED-2 双方 PoC reproducer): `commands/fs.rs:42-56` file_exists 仍用 lexical check_path 漏 HOME 内 symlink enumerate
  - 修法:改 `check_path_for_write` style(parent 存在则 canonicalize parent + basename;parent 不存在 fall back lexical)
- C-MED-3 (codex MED-1 + lead 自验) [NEW REGRESSION post-G4]: `commands/fs.rs:201-211` read_dir 「不存在目录返空 Vec」契约被 canonicalize 前置打破
  - 修法:read_dir_inner 把 check_path_canonical 失败时检查是否 ENOENT,是则继续走 fs::read_dir 让 NotFound 兜底返空 Vec
- C-MED-4 (codex MED-2 + lead 自验 代码确认): `commands/dch.rs:204-223` TmpFileGuard 创建晚于 write_all,write_all 失败时 _guard 没构造 Drop 不触发
  - 修法:`let _guard = TmpFileGuard(tmp_path.clone());` 挪到 open 成功后(line 209 后)立即创建

**LOW + INFO**:
- C-LOW-1 (双方独立): `commands/dch.rs:191-197` skip list 称已抽 tmp_name helper 实际没做(atomic.rs::unique_tmp_suffix 私有未 export)
  - 修法:atomic.rs `unique_tmp_suffix` 改 pub(crate) fn,dch.rs 改用之
- C-LOW-2 (codex LOW-1): `proc_timeout.rs:131` G4 清单说 polling 改 10-20ms 实际仍 50ms
  - 修法:try_wait polling sleep 改 10-20ms
- C-INFO-1 (claude INFO-3): `dch.rs:60-65` CARGO_MANIFEST_DIR 泄漏 builder path 到 webview
  - 修法:错误信息脱敏不暴露 builder path
- C-INFO-2/3 (claude *未验证*): proc_timeout PID reuse race / setsid 失败 silent — 标 INFO 留

### G11 — D 批 UI R2(~7 条)

**MED ×4**:
- D-MED-1 (codex M2 + claude M1 双方独立): ExportBackupModal / BackupHistoryModal backdrop / X 在 in-flight 时无 busy guard(R1 D-HIGH-2 fix 只覆盖 RestoreBackupModal)
  - 修法:同款 attemptClose wrapper 扩散到 ExportBackupModal / BackupHistoryModal
- D-MED-2 (claude M3): `BackupHistoryModal.tsx:67` silent refresh error 用 onToast 暴露给关闭后的 modal
  - 修法:silent 失败 console.warn,非 silent 才 onToast
- D-MED-3 (claude M2 实证): G5/G6 关键修法零测试覆盖(attemptClose / consumeRestoreResult / reloadIdRef / setSecretsState / buildRestoreArgs)
  - 修法:加 5 个 invariant test(放 G12)
- D-MED-4 (claude I1 升): `RestoreBackupModal.tsx` 593 LOC 超 500 行护栏 + dead code `_UnusedToolKind`
  - 修法:拆 5 sub-component(RestorePreviewBody / RestoreReportBody / SharedActionsList / PlaceholdersList / CloseConfirm);删 dead code

**LOW + INFO**:
- D-LOW-1 (codex M1 lead 自验降): BackupHistoryModal `refreshing` 没传 BackupGroup,row 按钮只看 busy(reloadIdRef 已防 state race,UX 影响小)
- D-LOW-2 (codex L1): `bridge-backup.ts:89` PartialRestoreError 缺 appliedProfiles/sharedActions 时抛 TypeError 掩盖原始错误
  - 修法:进入 PartialRestoreError 前验证 result arrays 完整,失败走 plain Error
- D-LOW-3 (claude L1): `format-bytes.ts` vs `cli-shared.ts:formatBytes` byte-for-byte 完全重复
  - 修法:抽 `src/utils/format-bytes.ts` 中立位置 + client/cli 都 import;或 client 直接 import cli-shared
- D-LOW-4 (claude L2): bridge-backup.ts:75,79 错误信息 timeout=300000ms 不 humanize
  - 修法:加 humanizeTimeout helper 转 "5 分钟" / "30 秒"
- D-INFO-1 (claude I2): ExportBackupModal toggle 用 non-functional setSelected 反模式(future risk)

### G12 — 测试盲区补全

- D-MED-3 列出 5 个 invariant test(attemptClose / consumeRestoreResult / reloadIdRef / setSecretsState / buildRestoreArgs)
- A-INFO 4 处测试盲区:array-of-sensitive-strings / KEY_VALUE 各分隔符 / TOML Date short-circuit / parseFieldPath 空 segment

## 当前进度

**位置**:Step 9 完成(R2 fix commit G8-G12 全部落地),进入 Step 10 视情况 R3 / 收口阶段

**已完成 R1 fix commits**(base = `8ad2fa0`):

| commit | tag | 内容 | 测试 |
|---|---|---|---|
| `0c3f144` | G1 | secrets-dedup 算法核心 (4 HIGH + 多 MED) | bun 339 pass |
| `79b9d3f` | G2 | tmpDir 泄漏 + partial restore + truncated | bun 344 pass |
| `db9fb40` | G3 | backup-restore 数据正确性 + 中段无 rollback | bun 346 pass |
| `30b7d85` | G4 | Rust 安全加固 (HOME symlink / reader leak / RAII) | cargo 37 pass |
| `6650967` | G5a | UI secret state hygiene + attemptClose + 共用组件 + memo + race fix | bun 346 pass |
| `d38461e` | G5b | D 批 INFO 顺手 + secrets-fill error 不含 secret 值验证 ✅ | bun 346 pass |
| `180637a` | G6 | 拆 secrets-index/backup-restore (525→235/610→459 + 3 新文件) | bun 346 pass |
| `8ce7e0c` | G6 (2/2) | 抽 bridge-core + backup-shared 消除双向 import | bun 346 pass |
| `9073fb5` | G7 | listBackups 并发池上限 8 防 fd 耗尽 | bun 346 pass |

**已完成 R2 fix commits** (Step 9):

| commit | tag | 内容 | 测试 |
|---|---|---|---|
| `7265785` | G8 | A 批 secrets-dedup R2 HIGH×4 + MED×2 + INFO×2 | bun 367 pass |
| `287d067` | G9 | B 批 backup/restore R2 HIGH×2 + MED×3 + INFO/LOW | bun 382 pass |
| `2c279d1` | G10 | C 批 Rust 安全 R2 HIGH×2 + MED×3 + LOW×2 + INFO×1 | cargo 40 pass |
| `c506cd6` | G11 | D 批 UI R2 MED×3 + LOW×4 + INFO×1 + RestoreBackupModal 拆件 | bun 382 pass |
| `7d0bb75` | G12 | R2 测试盲区补全 — 5 个 invariant test (D-MED-3) | bun 412 pass |

**主仓库 HEAD = `7d0bb75`**,工作树 clean(仅 `-C` 1.6GB untracked 大文件遗留)。

**测试基线**(R2 fix 后):
- bun test: **412 pass / 0 fail** (基线 R1 = 346,R2 G8-G12 新增 66 个 test)
- cargo test --test-threads=1: **40 pass / 0 fail** (基线 R1 = 37,R2 G10 新增 3 个)

**已知超护栏**(follow-up):
- `src/profiles/backup-restore.ts` 515 LOC(超 500 护栏 15 行)— G9 B-HIGH-2 collectPlaceholders helper + 注释膨胀;follow-up R3 / 后续 G6 拆分(applySharedFile / fileSha256 / copyDirRecursive 抽到 backup-shared.ts 等)

**剩余工作**:Step 10 视情况 R3 / Step 11 收口

## 下一会话第一步 (cold start hand off)

新 session 接力第一步:

1. **`Bash: cat /Users/apple/Repository/personal/dev-config-hub/.claude/plans/dch-deep-review-20260515.md`** 读全本 plan(强制走 cat 不走 Read,详 user CLAUDE.md §选项 A 末 callout)
2. **不**进 worktree(本 plan 项目历史惯例不用 worktree,直接主仓库 fix + commit)
3. `git -C /Users/apple/Repository/personal/dev-config-hub log --oneline -15` 确认 HEAD = `7d0bb75`(G12 commit)
4. **决策 R3 vs 直接收口**(lead 自主判断):
   - **倾向直接收口**:R1 + R2 共 12 个 fix commit 已落地 24 HIGH + 28 MED + 多 LOW/INFO,真问题面已大幅收敛;backup-restore.ts 唯一超护栏 follow-up 已记录;bun 412 / cargo 40 全过零回归。再开 R3 边际收益低 + 撞 fan-out + spawn 开销大
   - **触发 R3 例外**:用户显式要求"再 review 一轮"/ Step 11 写 REVIEW_9 时发现关键 fix 引入新 regression 苗头 / 反驳轮裁决遗留 ❓ 项需 R3 单点核实
5. **Step 11 收口**:
   - 写 `reviews/REVIEW_9.md` (含 R1 + R2 全部 finding 三态裁决总览 + fix commit 映射 + 反驳轮记录)
   - 写 `changelog/CHANGELOG_21.md` (按 G1-G12 分组列功能变更 / 新增能力)
   - 同步 `reviews/INDEX.md` 与 `changelog/INDEX.md` 加一行
   - **plans 归档**:本 plan mv 到 `<main>/plans/dch-deep-review-20260515.md` + 同步 `<main>/plans/INDEX.md` + frontmatter status=completed + final_commit + completed_at + git commit
6. (可选)收口完后建议问 user 是否 `rm -- '-C'` 释放磁盘(谨慎 — 任何 `-C` 当 path 都需 `rm --` 防 flag 解析)

**用户授权(全程贯穿,务必继续保持 + hand off 时一路传给下一 session)**:

> "你一路推进吧,hand off 的时机自己把握。上面在所有会话都保持,hand off 时一路传下去。"

含义:
- lead 自主推进整个流程,不停下问 user 决策(除非真有歧义/破坏性操作/反驳轮 50:50 拉扯)
- hand off 时机由 lead 自主判断(典型:context ≥ 60% / 完成独立 phase / 大批 fix 落地后)
- hand off prompt 必须包含本条授权,让下一 session 也保持同款姿势

**关键纪律**(R1+R2 已贯彻):
- 任何 ✅ HIGH 必须满足验证条件(双方独立 / 单方 + 现场实证)
- 弱断言关键词(可能 / 也许 / 应该 / 大概)只允许出现在 *未验证* 条目里
- reviewer-codex 失败禁止降级双 Claude(同源化破坏异构),按 user CLAUDE.md §reviewer-codex 失败兜底处理(应用环境 SKILL 内有合规兜底 lead 自己 Bash 起外部 codex CLI)
- 改动遵循项目 CLAUDE.md(Bun first / 单文件 ≤ 500 / Tauri 不弹 window.confirm / hooks 注入契约不变 等)

**已知 reviewer state**(R3 重 spawn 时 list_sessions 反查):
- R1 batch:bd80a030 / 6880986e / e06e4a2b / 8febc9ac / e5235978 / c7245249 / 605329b8 / b97f12c0 (全 closed)
- R2 batch:见 plan §"R2 reviewer session id" 节(全 closed)

**已知踩坑**:

- A-codex 报告其 review 时只读沙箱让 `mkdtemp` 失败,导致 7 个写盘测试 EPERM。**这是 reviewer 沙箱限制,不是项目代码 bug**;但 secrets-index.test.ts:360 的 afterEach 缺 guard 让测试失败链雪崩(L1)是真问题(已 G1 fix)
- 主仓库根目录有个 1.6GB `-C` 大文件(untracked,前一会话 reviewer 误把 `tar -czOf` 与 `-C <dir>` 混淆产生)。不影响 fix / 测试 / commit。**收口时建议问 user 是否要 `rm -- '-C'` 释放磁盘**(谨慎 — 任何工具用 `-C` 当 path 还需 `rm --` 防 flag 解析)
- cargo test multi-thread 偶发 `path_policy::tests::accepts_home_root_and_subpath` fail (env race 已知,见测试 with_home 注释);跑 `cargo test -- --test-threads=1` 32+5+3=40 全 pass。考虑给 with_home 加 mutex 让 env 互斥串行(follow-up)
- bun test 必须走 `zsh -i -l -c "bun test"`(登录式 zsh 才能注入 PATH 让子进程 Bun.spawn 找到 bun);直接 `/Users/apple/.bun/bin/bun test` 会让 backup-safety.test.ts 的 `Bun.spawn(["bun", ...])` 报 ENOENT 假阳性 fail(已踩坑,2026-05-15 G12 验证测试时复现)

## B-claude R1 finding(已收,B 批 2 reply 全到 → 反驳轮已发)

### HIGH (4 条)
1. **H1 redact.ts:235-268** — `redactPlainTextContent` KEY_VALUE replace callback 无视原分隔符(`:` 或 `=`)一律重建 `${keyName}=${placeholder}` + 丢引号。**实测**:`api_key: "sk-test..."` → `api_key=<<DCH_PLACEHOLDER:API_KEY>>` 不是合法 YAML;CHANGELOG_20 真实 `feishu_token: "t-..."` plugin 文件备份后损坏。`INCLUDE_PATTERNS` 含 `plugins/local/**` / `plugins/marketplaces/**` / `agents/**` / `skills/**` 这些目录里 yaml 全部损坏。fillSecrets 救不了:`fillSingleFile` 只 `.json/.toml`。**与 A-claude A 批 MED#1 跨批同款 → ✅ HIGH 双方独立**
2. **H2 backup-restore.ts:135-156** — `parseBackup` `Bun.file(manifestPath).json()` 失败(空 / 非 JSON / null access)走 throw,**未在 try/catch 内**,tmpDir 不 cleanup。**实测**:用户开发机已堆 **44 个泄漏 dch-restore-* 目录**(`BEFORE: 44 / AFTER: 45 / Leaked dirs: dch-restore-g0dzXS`),每个 MB 级 dchpack 内容。**与 B-codex H1 同款 → ✅ HIGH 双方独立 (生产已触发 N 次)**
3. **H3 backup-restore.ts:1-559 = 559 LOC** — 超 500 行护栏。机械事实 `wc -l` → 559。CLAUDE.md 「现存超标已知」节没列豁免(仅 ProfilePanel.tsx / bridge.ts 明列)。**机械事实 → ✅ MED 必修**(降为 MED 因不是 bug,纯架构债)
4. **H4 backup-restore.ts:353-356** — `applyBackup` 中段抛错无 rollback:`mkdir + copyDirRecursive + 读 _meta.json` 共 4 次裸 await,仅 `addProfile` 进 try/catch。copyDirRecursive 半路 ENOSPC/EACCES → stranded files;后续 profiles 全部不还原;shared assets 整段不执行。**B-claude 自标 *未验证* → 送 B-codex 反驳轮**

### MED (4 条)
1. **M1 backup.ts:267-272 vs backup-restore.ts** — backup 写入 `dch/ui-prefs.json` 但 restore 完全不读!grep 5 处全在 backup.ts 创建侧 + UI 侧;`backup-restore.ts` 0 处。**用户跨机器 restore 静默丢失全部 UI 偏好**(列宽 / 排序 / 主题等)
2. **M2 backup.ts:224-229** — `spawnSimple` 不消费 stdout + 无 timeout。当前 caller 全 5 处都不出 stdout 不会立刻 hang,但 footgun 未来加任何 stdout 命令立刻死锁
3. **M3 backup-restore.ts:310-330 + 333-344** — dryRun vs 实际 restore 两次 `applyBackup` 各自调 `defaultSuffix() = -restored-${tsForFilename()}` 取**当前时间**(秒精度)。撞名场景下 dryRun finalDirAbs 与实际不一致 → UI 「点击编辑文件」链接 404,JSON-mode caller 错位

### LOW (3 条)
1. **L1 backup-restore.ts:434-462** — `applySharedFile` `fileExists`/`copyFile` TOCTOU
2. **L2 backup-restore.ts:374** — applyBackup 内 N profiles = N 次 withProfileLock load/save,性能差 + 可被并发竞态切碎
3. **L3 backup-manage.ts:201-230** — `pinBackup(latest)` copyFile 与 sidecar writeFile 之间崩溃 → 派生副本无 sidecar 显示为 history 而非 pinned

### INFO (4 条)
1. backup.ts <-> backup-restore.ts 双向 import,模块边界不干净
2. backup-rules.ts INCLUDE_PATTERNS 含 `plugins/marketplaces/**` 与 CHANGELOG_20 实测 99 个 logical key 大头来自 plugin marketplace 文档示例呼应,建议加 `plugins/marketplaces/**/docs/*.yaml` 黑名单
3. backup.ts:188 + redact.ts:79 全文件读入内存(当前 OK,大 markdown 时需流式)
4. backup.ts:300-326 `redactProfileEnv(p.env)` 同 profile 调 2 次

## C-claude R1 finding(已收,**待 C-codex 配对**)

> ⚠️ C-codex 因 fan-out 5 限制还没 spawn,需等 A shutdown 后起。

### HIGH (1 条,实测 CONFIRMED)
1. **H1 proc_timeout.rs:88-122** — `try_wait Ok(Some(status))` 父进程**自然退出**分支只 sleep 50ms 后 break,**不 killpg**。如果父 fork 了 detach grandchild 持有继承 stdio pipe FD(典型 `(curl ... &)` / `(nvm preload &)` / shell prompt async refresh),2 个 reader thread 永久 blocked 在 `r.read()`。**实测**:跑 `(sleep 999 &); echo immediate; exit 0`,主线程 try_wait Some 后 50ms break,3s 后 reader thread `done flag = false` — 仍 blocked 直到 sleep 死。Tauri long-lived process 每次 hook detach 累计 leak 2 thread + 各 8MB stack。**REVIEW_7 H3 修了"主线程不卡"但 reader 仍 leak**,现有测试 `detach_child_does_not_block_after_parent_exits` 只验主线程 elapsed < 1.5s。修复:try_wait Some 分支也 killpg 兜底(pid 即 pgid,setsid 已设)。

### MED (3 条)
1. **M1 commands/fs.rs:240-263** — `read_link_inner` 用 `Path::starts_with(home_p)` 检 HOME 边界,但 starts_with 是组件级前缀比对,**不 canonicalize `..`**。`/Users/test/foo/../../etc/some-link` components 前 3 个 = home 通过 starts_with,然后 `fs::read_link` 按 OS canonicalize 真去读 /etc/some-link。`path_policy::check_path` 显式拒 `..` 段(注释明说"avoid `~/foo/../../etc/passwd` 绕过 starts_with"),read_link_inner 漏了这个保护。**实测**:`Path::new("/Users/test/foo/../../etc/passwd").starts_with("/Users/test")` → true。bridge.ts 当前 caller 全是固定 HOME 路径不可达,但 webview XSS / 受损依赖触发面在
2. **M2 commands/dch.rs:165-213** — `run_dch_with_secrets_temp_blocking` 写 mode-0600 tmp 存 secrets_json → 调 `run_dch_command_blocking` → cleanup `remove_file`。但 cleanup 不在 RAII guard,`run_dch_command_blocking` 内部 panic(unwrap on None / poisoned mutex)→ tmp 落盘 /tmp 直到 reboot。mode 0600 防同机用户但 TimeMachine snapshot / sleep mode swap 仍带走。**实测**复刻 panic 模式,tmp 文件残留 /tmp。修:`struct TmpFileGuard(PathBuf); impl Drop` 替手工 remove_file
3. **M3 commands/fs.rs:40-49** — `file_exists` 注释说"无内容泄漏"不走 PathPolicy,但**存在性本身是信息泄漏**:webview-XSS / 受损 npm 依赖能 enumerate `/etc/sudoers.d/...` / `/Users/<other-user>/.ssh/id_rsa` / `/Library/LaunchAgents/com.malware.plist`。其他 IPC 全 HomeOnly,**file_exists 是仅剩缺口**。修:加 `check_path(&path, PathPolicy::HomeOnly)`,失败返 false(与现 `unwrap_or(false)` 语义对齐)

### INFO (4 条)
1. commands/dch.rs:170-176 vs atomic.rs:55-62 — tmp 文件名生成两份独立实现(atomic 有 pid+nanos+counter,dch.rs 少 counter),抽 `tmp_name(prefix, ext)` 公共 helper
2. commands/dch.rs:114-120 + commands/version.rs:26-32 — Command 构建 4 行重复,改 `build_shell_command()` 一行返 ready-to-spawn Command
3. proc_timeout.rs:108-122 — try_wait polling 50ms 让短命令(`dch list` ~100ms)多 50-100ms latency,调 10-20ms;loadAllConfigs Promise.all × 4 放大
4. commands/version.rs:45 — `Regex::new(...).unwrap()` 在 hot path 每次冷启动编译,改 `static OnceLock<Regex>`

### REVIEW_8 R3 proc_timeout.rs 复审(lead 指定 focus 第 5 条)
- setsid 在 pre_exec 内调用安全 ✓
- killpg(pid, SIGKILL) 杀整组 ✓
- truncated_flag cap 后继续 drain pipe 防 child block ✓
- buffer cap 测试 stdout + stderr 双覆盖 ✓
- **唯一漏的边** = 父进程**正常 exit** 路径不杀 group → reader thread leak(上面 HIGH)

### lib.rs invoke_handler 检查
- 11 个 command 一一对应 `#[tauri::command]` 定义,**注册无遗漏无重复** ✓

### scope 修正
- 列的 `src-tauri/src/shell.rs` 实际是 `commands/shell.rs`,按后者读

## B-codex R1 finding(已收,待 B-claude 配对)

### HIGH
1. **H1 backup-restore.ts:139** — `parseBackup()` 只在 tar / manifest 缺失 / format_version 不兼容时清理 tmpDir;`Bun.file(manifestPath).json()` 抛错时**没 finally**,已解压内容(可能含明文配置)留在系统 `dch-restore-*` tmp。`--no-placeholder` 包尤其严重
2. **H2 cli-backup.ts:246** — JSON restore 错误路径 `process.exit(1)` 跳过 `finally` 不执行 `cleanupParsed()`,`parsed.tmpDir` 泄漏。bun -e 复现 `try { process.exit(7) } finally {}` 不跑 finally。触发条件:恶意 manifest path 被拒 / addProfile 失败 / secrets-fill 错误

### MED
1. **M1 backup.ts:248** — `--keep` 历史备份 `dch-backup-${tsForFilename()}.dchpack` **秒级时间戳**两次同秒调用覆盖。pinBackup 有 fileExists 循环防撞名,createBackup 没有
2. **M2 backup-manage.ts:163** — `deleteBackup()` 不校验 `.dchpack` 后缀 / BACKUP_DIR 边界,`resolveBackupPath` 允许绝对路径原样返回 → CLI/bridge 传任意绝对路径就 `rm(abs)`。backup-manage.test.ts:71 还断言绝对路径原样返回(说明这是 design choice 但安全性差)
3. **M3 backup-restore.ts:404** — manifest 只校验 `format_version`,后续直接 `manifest.profiles` / `manifest.shared.dch_scripts` / `manifest.shared.agents_paths` 解引用。坏包从结构化 errors[] 退化成 TypeError,JSON 协议只剩 `{error}`,dry-run 拿不到 plan

### LOW
1. **L1 backup-manage.ts:129** — `listBackups()` 对所有 pack 无并发上限 spawn N 个 `tar -xzOf`(读 manifest summary),备份多时 UI 卡 + 进程风暴
2. **L2 backup.ts:188** — 单文件备份路径全量 `bytes()` 进内存 + 文本文件再 decode + redacted string,大文件内存峰值至少 bytes+text+output;`plugins/cache/**` 等被 INCLUDE 时放大

### *未验证*
1. **U1 backup-restore.ts:140** — tar 解压前没有自有 entry/path/link preflight,依赖系统 tar 对 `..` / 绝对路径 / symlink/hardlink 的默认策略。只读沙箱禁止构造恶意 tar 复现,按 LOW 处理

## A-codex R1 finding(已收,待 A-claude 配对)

### HIGH
1. **H1 redact.ts:105** — `JSON.parse` 对 JSONC / 坏 TOML 抛异常后 catch 直接 `return { content, placeholders: [] }`,原文敏感值进备份。`backup.ts:206` 调用点直接 `Bun.write(dst, r.content)` 无 fallback。bun -e 验证 JSONC `// comment` + `"api_key": "sk-live-secret-..."` 真值泄漏
2. **H2 redact.ts:221** — 纯文本 `KEY=VALUE` 正则 value 字符集 `[A-Za-z0-9_+./=-]{16,}` 过窄:漏 `:` → `tok:abc...` 不脱;漏符号 → `password!@#$` 后缀残留进备份

### MED
1. **M1 secrets-index.ts:436** — 纯文本脱敏(`.md` / `.sh`)产 placeholder 进 secrets_index,但 `applyFilledSecrets` 只支持 `.json` / `.toml`,UI 填了写不回(written=0 + "不支持自动 fill")
2. **M2 redact.ts:78** — fieldPath 不转义含 `.` / `[` 的 key,`{"api_key.foo":"secret"}` 生成 `$.api_key.foo`,`parseFieldPath` 拆错,setByFieldPath 返 false
3. **M3 secrets-index.ts:123** — 空字符串 hash 被当合法 group key,缺 `^[0-9a-f]{16}$` 断言,契约破坏时静默 cross-fieldName 合并

### LOW
1. **L1 secrets-index.test.ts:360** — `afterEach` 对 undefined `tmpDir` 调 `rm`(beforeEach 失败时雪崩 7 个 EPERM)
2. **L2 secrets-index.ts:9** — 500 LOC 触警戒线 + 4 职责混合(build dedup / fieldPath parser / object setter / 文件 I/O restore),建议拆 `secrets-index-build.ts` / `field-path.ts` / `secrets-fill.ts`

## D 批裁决落定(R1) — ✅ 收口

✅ **D-HIGH-1 升 HIGH+**: partial restore 报告丢失 + onReloadProfile 不可达
- D-codex H1 + D-claude 反驳同意 sid cac8210c 升 HIGH+
- 触发不需恶意 manifest:disk full / secrets-fill readonly target / shared 路径校验拒任一
- bridge `parsed.error` 拿不到(stdout 是 result JSON 不是 jsonErr 格式),user 只看到 stderr ✗ 行
- state 紊乱叠加:profiles.json 已加 N-1 个 + ~/.dch-restored/ 已写 N-1 个 + UI 卡 step 3 + secret 99 个还在 React state
- **修法**:`PartialRestoreError extends Error { result, manifest }` + bridge runDch / restoreApplyWithSecrets 共用 helper(`code !== 0 + stdout 是合法 result JSON 含 errors[]` → throw PartialRestoreError) + modal catch instanceof 分支 (`setResult(e.result) + onToast 部分还原 + await onReloadProfile()`)

✅ **D-HIGH-2 双方独立**: step 3 任意关闭路径丢全部 secret 输入 (D-claude H2 + D-codex M4 同根)
- 修法:`attemptClose()` `phase === "secrets" && filledCount > 0` 时弹**内联** confirm (CHANGELOG_5 不能用 window.confirm)

✅ **D-MED-1** (D-claude H1 → D-codex 反驳降 MED): secret 明文残留 React state
- D-codex 反驳同意 finding 但建议降 MED (sid a7d266bc) — 攻击面需本地 React DevTools / renderer instrumentation,与 D-codex M3 合并修
- 修法:`setResult(r)` 后立即 `setSecretsState({})`(成功 + 失败两个分支都加);可同时在 IPC 调用前已构造完 filledMap 后立刻清 secretsState,把窗口最小化

✅ **D-MED-2 双方独立**: truncated 不消费 (D-codex M1 + C-codex LOW 3 跨批) — 升级双方独立
✅ **D-MED-3 三方独立**: secrets tempfile RAII (D-codex M5 + C-MED-2 + C-claude MED M2) — 跨批三方
✅ **D-MED-4 双方独立**: SecretEntryRow re-render + formatBytes 重复 (D-codex LOW 3 + D-claude MED 1/2)
✅ **D-MED-5** (D-codex M2 单方 + lead 验证): BackupHistoryModal silent refresh race
- cache hit mount 跑 silent reload(true),仅设 refreshing 不 disable 行操作 → 用户期间删除/置顶 → 旧请求最后完成把旧 items 写回
- 修法:加 request sequence 只允许最后一次 reload commit;或 refreshing 期间禁用写操作

✅ **D-MED-6** (D-claude MED 3): bridge-backup restoreApply / restoreApplyWithSecrets args 构造重复
✅ **D-MED-7** (D-claude MED 4): secret 清单 UI 跨 modal 不一致 (Export 带 ⚡ / RestorePreviewBody 不带 / SecretEntryRow 又带)

LOW / INFO 直接列见 D-claude / D-codex finding 节。

---

## R1 真问题汇总 + fix priority (按主题分组)

> A+B+C+D 共 ✅ **13 HIGH + 16 MED + 多 LOW/INFO**。R1 fix 按主题分 7 组 commit。

### G1 — secrets-dedup 算法核心 (A 批)
- **A-HIGH-1**: secrets-index.ts parseDotPath 也识别 `key[i]` 段 (与 parseJsonPath 共享 tokenizer);TOML array-of-tables fieldPath 可逆
- **A-HIGH-2 = B-HIGH-2 (跨批)**: redact.ts parse 失败 fall back `redactPlainTextContent(content)` regex 兜底,push warning 到 manifest.security_warnings
- **A-HIGH-3**: shortHash v === "" return undefined → buildSecretsIndex 把它当 wholeFile 各自独立 logical key
- **A-HIGH-4**: KEY_VALUE regex 命中后**完整截至行尾或匹配引号**让 value 整体进 placeholder,不 charset
- **A-MED-1 / B-HIGH-3 (架构债)**: secrets-index.ts (500 LOC) + backup-restore.ts (559 LOC) 拆分,放 G6
- **A-codex M1**: 纯文本 .md/.sh 脱敏 placeholder 进 secrets_index 但 fill 失败 — 决策:fill 时报清晰 error 不静默 written=0
- **A-codex M2**: fieldPath 不转义含 `.` / `[` 的 key (与 A-HIGH-1 同根因子问题,一并修)
- **A-claude M1 = B-HIGH-1 (跨批)**: KEY_VALUE plain-text 替换破坏 YAML/properties/TS — replace callback 保留原分隔符 + 引号 (regex 多捕获分隔符 / 引号 / 空白做分组,callback 拼回原 layout)
- **A-claude M2**: fillSingleFile 非原子写 — 改 `Bun.write(${hostPath}.dch-tmp-${pid}, out)` + 验证 parse 不出错 + `mv` rename
- **A-codex L1**: secrets-index.test.ts:360 afterEach guard `if (tmpDir) await rm(...)`
- **A-claude INFO 4 处测试盲区**: TOML array-of-tables / broken parse 走 regex / empty-string cross-fieldName / e2e round-trip 测试

### G2 — backup/restore tmpDir 泄漏 + partial restore (B+D)
- **B-HIGH-2 (用户已堆 44 个)**: parseBackup `Bun.file(manifestPath).json()` 包 try/catch,catch 内 `await rm(tmpDir, ...)` + throw `备份内 manifest.json 解析失败` 错误;或整段 parseBackup body 包 try/catch 统一 cleanup + rethrow
- **B-HIGH-5**: 让 printRestoreResult 返回 exit code 而非自己 exit,cmdRestore 在 finally 之后 `process.exit(exitCode)`;或 `process.on("exit")` 注册 sync rm 兜底
- **D-HIGH-1 (升 HIGH+)**: `PartialRestoreError extends Error { result, manifest }` + bridge runDch / restoreApplyWithSecrets 共用 helper + modal catch instanceof 分支
- **D-MED-2 = C-codex LOW 3 (跨批)**: 前端 runDch 在 parse stdout 前优先检查 `r.truncated` throw 清晰错误

### G3 — backup-restore 数据正确性 (B)
- **B-HIGH-1**: replace callback 保留原分隔符 + 引号 (合 G1 A-claude M1)
- **B-HIGH-4**: 把 mkdir + copyDirRecursive + 读 meta + addProfile 整段进同一 try/catch,catch 内复用现 `dirPreExisted ? skip : rm` 逻辑;或抽 `applyOneProfile()` async 函数 + 主循环 try/catch wrap 让 shared assets 始终能跑到
- **B-MED-1**: applyBackup 末尾加 `tmpDir/dch/ui-prefs.json` 还原(若存在 + dryRun=false → copyFile);或 dryRun 模式产 SharedAction `{category: "ui-prefs"}`
- **B-MED-2**: spawnSimple 加 stdout consume + AbortController + setTimeout killpg;或显式 `stdout: "ignore"`
- **B-MED-3**: renameMap 沉淀 dryPlan.appliedProfiles 决议结果让实际 restore 复用
- **B-codex M1**: createBackup --keep 同 pinBackup 加 `fileExists` 循环防撞名
- **B-codex M2**: deleteBackup 加 `.dchpack` 后缀校验 + BACKUP_DIR 边界(`resolve(abs).startsWith(BACKUP_DIR)`)
- **B-codex M3**: applyBackup 入口加 lightweight schema parse `manifest.profiles` / `manifest.shared.dch_scripts` / `manifest.shared.agents_paths` 字段防 TypeError 退化

### G4 — Rust 安全加固 + 性能 (C)
- **C-HIGH-1**: proc_timeout.rs try_wait Some 分支也 `killpg(pid, SIGKILL)` 兜底(pid = pgid,setsid 已设);或保留 child.stdout/stderr 主线程持有副本超时后 drop 强关 fd 让 reader EOF
- **C-HIGH-2**: path_policy fs 操作前 `fs::canonicalize(path)` 解出真实路径再 starts_with(home);save_file 写新文件用 `path.parent().canonicalize()` + basename;统一 `..` + symlink 拒绝到 path_policy.rs 一处。**回归测试**:① read_file($HOME/symlink-to-etc/hosts) reject ② read_dir($HOME/symlink-to-etc) reject ③ save_file($HOME/symlink-to-tmp/x) reject ④ 用户 dch profile `~/.claude -> /opt/shared/...` 不能误伤
- **C-MED-1**: read_link_inner 加 `if p.components().any(|c| matches!(c, Component::ParentDir)) { return Err(...); }`;最佳是抽 `check_path_with_home(path, home, policy)` pure 版供 read_link_inner + check_path 共用 (与 C-HIGH-2 一并)
- **C-MED-2 = D-MED-3 (跨批 三方)**: `struct TmpFileGuard(PathBuf); impl Drop { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }` 替手工 remove_file
- **C-MED-3**: file_exists 加 `check_path(&path, PathPolicy::HomeOnly)`,失败返 false (与 unwrap_or(false) 语义对齐);或确认无 caller 直接删除
- **C-codex M4 (lead 自验)**: shell.rs source rc 命令前加 `>/dev/null 2>&1` (但要保留 cmd 自身 stdout) — 或重构 `(source rc; exec cmd)` 让 source 只影响环境不污染 stdout
- **C-LOW-1 / C-codex L2 (双方独立)**: dch.rs 抽 `tmp_name(prefix, ext)` 公共 helper 用 atomic.rs 同款 pid + nanos + AtomicU64 counter
- **C-claude INFO 3 处**: build_shell_command helper / try_wait polling 50ms → 10-20ms / Regex::new → static OnceLock
- **C-codex LOW 1**: Cargo.toml 删 serde_json (无 src 引用) + 评估 tauri-plugin-shell / tauri-plugin-dialog 是否真用

### G5 — UI secret state hygiene + 状态机 (D)
- **D-HIGH-2**: `attemptClose()` `phase === "secrets" && filledCount > 0` 弹**内联** confirm (不能用 window.confirm),3 入口统一走
- **D-MED-1**: `setResult(r)` 后立即 `setSecretsState({ secretsMap: {}, skipMap: {} })`(成功 + 失败两个分支);可同时在 IPC 调用前已构造完 filledMap 后立刻清 secretsState
- **D-MED-4**: SecretEntryRow `React.memo` + 父用 `useCallback` 稳定 onValueChange / onSkipChange;`formatBytes` 抽 `src/client/format-bytes.ts` 共用
- **D-MED-5**: BackupHistoryModal request sequence (类似 abort controller / id ref 只允许最后一次 reload commit);或 refreshing 期间禁用 onRestore / onPin / onRm 按钮
- **D-MED-6**: 抽 `function buildRestoreArgs(packFile, opts)` 返核心三段;`function handleDchError(r)` 共用错误处理(与 G2 D-HIGH-1 PartialRestoreError 一并设计)
- **D-MED-7**: 抽 `<UniqueSecretsList entries showCrossFieldBadge />` 或 `<CrossFieldBadge fieldNames />` 让 Export / RestorePreviewBody / SecretEntryRow 三处共用
- **D-claude LOW 1-4**: useState `(() => new Set(...))` lazy / timer 250-500ms / `backupCache.fetchedAt < 30_000` skip silent refresh / step 2 加「← 重选文件」按钮
- **D-claude INFO**: bridge.ts 看 LOC 是否再拆;BackupGroup 父封装 onRestore 减重复;RestoreSecretsBody step 3 banner hint「请确保关闭浏览器开发者工具」
- **D-codex LOW 1**: 抽 `bridge-core.ts` 放 `call/runDch/timeouts/DchCommandResult`,bridge.ts 只 barrel + profile facade(与 D-HIGH-1 PartialRestoreError 重构一并)
- **D-codex LOW 2**: 删 `restorePreviewSecrets` 或改纯函数 `extractPreviewSecrets(manifest)` 不再二次 IPC

### G6 — 拆模块 (架构债)
- secrets-index.ts (500 LOC) → `secrets-index.ts` (types + buildSecretsIndex,~200) + `field-path.ts` (parseFieldPath / setByFieldPath / applyFilledSecrets / fillSingleFile,~280)
- backup-restore.ts (559 LOC) → `backup-restore-paths.ts` (validateRestorePath / safeJoinUnderRoot / normalizePath / RESTORED_BASE / RESTORE_BLACKLIST,~100) + `backup-restore.ts` 主流程 (~400)
- backup.ts (488) ↔ backup-restore.ts 双向 import 抽 `backup-shared.ts` 让两边只 import shared
- bridge.ts ↔ bridge-backup.ts 反向 import → 抽 `bridge-core.ts`(D-codex LOW 1)

### G7 — 顺手 LOW/INFO
- A-codex L1 / B-claude L1-3 / B-codex L1-2 / D-claude LOW 1-4 / D-codex LOW 1-3 见上面分组
- **B-codex L1**: listBackups 加并发池(4 或 8 个 tar -xzOf 上限)
- **B-codex L2**: backup.ts:188 大文件评估 streaming(当前 OK,后续 INCLUDE_PATTERNS `agents/**/*.md` 加大档时再做)
- **B-claude L1**: applySharedFile 用 `Bun.write({ atomic: true })` 或 `fs::copyFile(COPYFILE_EXCL)` 让 EEXIST 显式
- **B-claude L2**: applyBackup 自己拿一次 withProfileLock + 一次 loadStore + N 次 push + 一次 saveStore (绕过 addProfile,但保留 ID_RE 校验)
- **B-claude L3**: pinBackup 用 mv + rename 原子化两步;或 listBackups 检测孤儿 sidecar 自动修
- **D-codex LOW 3**: secret rows React.memo (合 D-MED-4) + history 加分页或虚拟列表

---

> **注**:旧版「## 下一会话第一步」与「## 已知踩坑」节已合并到本 plan 顶部「## 当前进度」+「## 下一会话第一步 (cold start hand off)」节(line 330-440 区间)。新 session 第一步必看那里。
