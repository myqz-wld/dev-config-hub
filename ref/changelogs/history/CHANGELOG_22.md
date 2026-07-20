---
changelog_id: 22
changed_at: 2026-05-15
---

# CHANGELOG_22 — REVIEW_9 follow-up F1-F4 收口

> base_commit: `2c5b34e` → final_commit: `ba10574`
> 完成时间:2026-05-15
> 关联 review:[reviews/REVIEW_9.md](../../reviews/history/REVIEW_9.md) §Follow-up 节
> 关联 plan:[plans/dch-deep-review-followup-20260515.md](../../plans/history/dch-deep-review-followup-20260515.md)

## 概要

REVIEW_9 + CHANGELOG_21(deep review G1-G12 收口)记录的 4 项 follow-up 落地。每项独立修复 + 测试 + commit,合计 4 commit。

- bun test:412 → **419 pass / 0 fail / 0 回归**(+1 F3 并发回归 + 6 F4 unit case)
- cargo test:**40 pass / 0 fail / 0 回归** + 默认多线程稳定(F1 落地后不再要求 `--test-threads=1`)
- 单文件 LOC:backup-restore.ts 515 → **474** 回到护栏 ✓

## 主要变更(按 commit 分组)

### F1 (commit 2e6dcd6) — path_policy HOME env race(cargo test 默认多线程稳定)

- **path_policy.rs / commands/fs.rs tests**: 旧实现 `with_home` helper / `commands::fs::tests` 内手写 `set_var("HOME", ...)` 不加锁,cargo test 默认多线程并发改 HOME 互相覆盖 → starts_with 拿错 home 偶发 fail。之前 workaround 是 `cargo test -- --test-threads=1`。
- **修法**:`path_policy.rs` 顶级 `#[cfg(test)] pub(crate) static HOME_ENV_LOCK: Mutex<()>`,所有改 HOME env 的 test 路径(path_policy::with_home + 3 个手写 set_var symlink test + commands/fs.rs 2 个 read_dir test)统一 lock 串行 env 改。`pub(crate)` 让 cross-module test 共享同把锁,仅 `#[cfg(test)]` 编译时存在不污染 release binary。
- **验证**:`cargo test`(默认多线程,无 `--test-threads=1`)连跑 3 次稳定 40 pass / 0 fail。

### F2 (commit 01bd86b) — backup-restore.ts 515 LOC 拆模块

- **backup-restore.ts**: G9 B-HIGH-2 collectPlaceholders helper + 详细注释让其涨到 515 LOC,超项目「单文件 ≤ 500」护栏 15 行。
- **修法**:把 4 个 file-private helper(`defaultSuffix` / `fileSha256` / `copyDirRecursive` / `applySharedFile`)与 2 个 type alias(`ConflictAction` / `SharedActionResult`)抽到 `backup-shared.ts`(180 → 282 LOC)。`backup-restore.ts` 删 local 实现 + import 自 backup-shared.ts + re-export `ConflictAction` 让 backup.ts → backup-restore.ts → backup-shared.ts re-export chain 不断。`SharedAction.action` 字段改用 `SharedActionResult` alias 防 type 漂移(改 alias 两侧自动一致)。
- **LOC**:backup-restore.ts 515 → **474** ≤ 500 护栏 ✓
- **caller 兼容**:外部仍 `import { applyBackup, parseBackup, ConflictAction, ... } from "./backup.ts"` 不变(facade 顶部 re-export 透传链未动)。

### F3 (commit f4796e9) — createBackup --keep TOCTOU(B-LOW-1 / B-codex MED-3 *未验证* 降)

- **backup.ts createBackup --keep 路径**: 旧 `fileExists(candidate)` check 与后续 `mv tmpOut→outFile` 之间 TOCTOU 窗口 — 同秒并发 createBackup 进程 A/B 同时 fileExists 都返 false → 都选同名 candidate → A mv 完后 B mv 直接覆盖 A → A 的备份丢失。
- **修法**:helper `tryReserveCandidate` 用 Node `fs.open(path, 'wx')` = `O_CREAT|O_EXCL`,candidate 选定时立刻原子占位 0 字节 placeholder;并发进程下次 wx 见 EEXIST 自动走下一个 suffix。失败 path(tar / verify / mv 任一失败 throw)主 try/finally + `mvSucceeded` flag 触发 placeholder cleanup 防 leak 0 字节占位。mv 成功的 happy path 已被 `rename(2)` 原子覆盖 placeholder,跳过 cleanup。
- **回归 test** `backup-create-toctou.test.ts`:spawn 10 个并发 `dch profile backup --keep`,验证 (1) 全部 exit 0 (2) `dch-backup-*.dchpack` 文件数 = 10 (3) 每个 size > 0 不 leak placeholder (4) 每个 `tar -tzf` 通过 + 诊断输出 baseTs 撞秒数(实测 10/10 全撞同秒,race 100% 触发,新实现完美隔离)。

### F4 (commit ba10574) — plain-text fill UX surface(A-LOW-1)

- **restore-modal-bodies.tsx RestoreReportBody**: R1 G1 已修 `field-path.ts:fillSingleFile` 报清晰 error("文件后缀非 .json/.toml,不支持自动 fill"),但只到 `secretsErrors[]` + 镜像加 `secrets-fill: ` 前缀进 `result.errors[]` 里堆所有 error 一起显示 — 用户可能不知道这意味着「写到 .md / .sh 等 plain-text 文件的占位符没自动填,请手动编辑文件填回真值」。
- **修法**:抽 pure helper `splitErrorsForReport(errors)` 把 `result.errors[]` 拆成两组:`plainTextFillFiles`(后缀拒型 error 提取出文件路径,与 field-path.ts:261 文案同源 RE)+ `otherErrors`(普通错误 + 非后缀拒的 secrets-fill error)。`RestoreReportBody` 单独渲染 plain-text fill 友好段(yellow border + 列出文件路径 + 提示「请手动编辑这些文件填入对应 secret」),其他错误段只显示 `otherErrors`。
- **回归 test** `restore-modal-bodies.test.tsx`:6 case 覆盖 splitErrorsForReport pure helper(空 errors / 仅普通 error / 后缀拒提取 / 混合分流 / 中文+空格+括号 hostPath 路径不挂 / 子串不误匹配)。React 渲染走手工 UI 冒烟(与 RestoreSecretsBody.test.tsx 同款风格)。

## 关联文件

修改 / 新建文件清单:
- 修改:`src-tauri/src/path_policy.rs`(F1)
- 修改:`src-tauri/src/commands/fs.rs`(F1)
- 修改:`src/profiles/backup-restore.ts`(F2)
- 修改:`src/profiles/backup-shared.ts`(F2)
- 修改:`src/profiles/backup.ts`(F3)
- 新建:`src/profiles/backup-create-toctou.test.ts`(F3 回归)
- 修改:`src/client/components/profile/restore-modal-bodies.tsx`(F4)
- 新建:`src/client/components/profile/restore-modal-bodies.test.tsx`(F4 unit)

## 验证

```bash
zsh -i -l -c "bun test"          # 419 pass / 0 fail
cd src-tauri && cargo test       # 40 pass / 0 fail (默认多线程,F1 后不再需要 --test-threads=1)
```
