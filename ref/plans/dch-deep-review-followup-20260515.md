---
plan_id: dch-deep-review-followup-20260515
created_at: 2026-05-15T05:00:00+08:00
status: completed
final_commit: ba10574
completed_at: 2026-05-15T11:35:00+08:00
base_commit: 2c5b34e
base_branch: main
worktree_path: /Users/apple/Repository/personal/dev-config-hub
note: 项目惯例不进 worktree(REVIEW_2/4/6/7/8/9 同款),直接在主仓库 fix + commit。worktree_path 填 mainRepo 兼容 hand_off_session schema。
---

# Plan: dch-deep-review-followup-20260515

> REVIEW_9 + CHANGELOG_21 (deep review G1-G12 收口) 记录的 4 项 follow-up 落地。

## 用户授权(全程贯穿,hand off 时一路传下去)

> "你一路推进吧,hand off 的时机自己把握。上面在所有会话都保持,hand off 时一路传下去。"

含义:
- lead 自主推进,不停下问 user 决策(除非真有歧义/破坏性操作/反驳轮 50:50 拉扯)
- hand off 时机由 lead 自主判断
- hand off prompt 必须包含本条授权

## 总目标

落地 4 项 deep review follow-up(已记录在 reviews/REVIEW_9.md §Follow-up 节 + changelog/CHANGELOG_21.md §Follow-up 节)。每项独立修复 + 测试 + commit,完成后写 CHANGELOG_22 + plan 归档。

## 不变量

- 项目主仓库 base_commit = `2c5b34e`,fix 直接在主仓库 commit
- bun test + cargo test 必须 0 回归(R2 末态:bun 412 / cargo 40)
- 不引新依赖
- 单文件 LOC ≤ 500(项目 CLAUDE.md 护栏);本 plan 顺手把 backup-restore.ts 515 LOC 拆回 ≤ 500
- 不退已有约定(REVIEW_9 / CHANGELOG_21 落地的 12 commit 含 24 HIGH + 28 MED 修法不能回退)

## 设计决策(不再争论)

1. **不进 worktree**:同 dch-deep-review-20260515(项目历史惯例,REVIEW_2/4/6/7/8/9 全在主仓库 commit)
2. **4 项 follow-up 顺序**(简单 → 复杂):
   - F1 path_policy with_home env race(最简单,加 std::sync::Mutex 串行 env 改)
   - F2 backup-restore.ts 515 LOC 拆模块(顺手把 helper 抽 backup-shared.ts,降到 ≤ 500)
   - F3 createBackup --keep TOCTOU(改 fs.open(wx) atomic create-or-fail)
   - F4 plain-text fill UX surface(UI 处理 fill 失败 error 让用户感知)
3. **每项独立 commit**(F1 / F2 / F3 / F4 各一个 commit,方便 follow-up 之间互不依赖)
4. **plan 文件位置**:`.claude/plans/dch-deep-review-followup-20260515.md`(in_progress 短期工作目录,完成后挪到 `<main>/plans/` 入 git)

## 4 项 follow-up 详情

### F1 — path_policy with_home env race(cargo test multi-thread)

**位置**:`src-tauri/src/path_policy.rs` (mod tests)
**问题**:cargo test 默认 multi-thread 时 `accepts_home_root_and_subpath` 偶发 fail — 多个 with_home test 并发改 HOME env 互相覆盖,先 set 后被并发改 → starts_with 失败。当前 workaround 是跑 `cargo test -- --test-threads=1` 全过(40 pass)。
**修法**:加 `static HOME_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());` 让 `with_home` helper 内 acquire lock 让 env 改互斥串行。Mutex 保证多线程 cargo test 不撞 env race,默认 `cargo test`(无 `--test-threads=1`)也能稳定通过。
**验证**:跑 `cargo test`(默认多线程)看是否 40 pass / 0 fail
**预计 LOC**:~10-20 行(mutex 静态变量 + with_home 内 lock)

### F2 — backup-restore.ts 515 LOC 拆模块

**位置**:`src/profiles/backup-restore.ts`(515 行,超 500 护栏 15 行)
**问题**:G9 B-HIGH-2 collectPlaceholders helper + 详细注释让该文件涨到 515 LOC,超项目 CLAUDE.md「单文件 ≤ 500」护栏 15 行。Plan REVIEW_9 已记录 follow-up R3 / 后续 G6 拆分。
**修法**:把以下 helper 抽到 `backup-shared.ts`(当前 180 LOC,加这些 ~100 LOC = ~280 LOC,不超护栏):
- `fileSha256(path)` — sha256 计算
- `copyDirRecursive(src, dst)` — 递归 copy
- `applySharedFile(src, dst, preferred, dryRun)` — 共享文件 conflict 处理
- `defaultSuffix()` — `-restored-<TS>` 后缀
backup-restore.ts 留主流程 applyBackup / parseBackup / cleanupParsed 类型 + re-export,降回 ≤ 400 LOC ✓
**验证**:`wc -l src/profiles/backup-restore.ts` ≤ 500 + bun test 412 全过
**预计 LOC 净变化**:0(纯挪)

### F3 — createBackup --keep TOCTOU(B-LOW-1 codex MED-3 *未验证* 降)

**位置**:`src/profiles/backup.ts:169-180`(R1 G8 B-LOW-1 注释段)
**问题**:`fileExists(candidate)` 检查与后续 `Bun.write(outFile)` 之间存在 TOCTOU 窗口 — 同秒并发 createBackup 进程之间互见,fileExists 检查到不存在 → 之间被并发写入 → 我们的 write 覆盖。Bun 当前没暴露 O_CREAT|O_EXCL 原子 create-or-fail API。
**修法**:用 Node `fs.open(path, 'wx')` 替代 `Bun.write` 路径(`'wx'` flag = 等价 O_CREAT|O_EXCL,文件已存在抛 EEXIST)。catch EEXIST 后 retry 拼新 candidate,最多 999 次。
- 实现:`async function tryCreateExclusive(path: string, content: string | Buffer): Promise<boolean>` 返 true=成功 false=EEXIST
- 改 `createBackup --keep` 路径循环 candidate + 调 tryCreateExclusive 取代 fileExists + Bun.write
**验证**:加并发回归 test(spawn N 个并发 createBackup --keep,验证全部独立成功不撞名)+ bun test 全过
**预计 LOC**:~30-50 行(helper + 改 createBackup 路径 + 1 个并发 test)

### F4 — plain-text fill UX surface(A-LOW-1)

**位置**:UI 端 `RestoreSecretsBody.tsx` / `RestoreBackupModal.tsx` step 3 阶段
**问题**:R1 G1 已修 `field-path.ts:fillSingleFile` 的报清晰 error("文件后缀非 .json/.toml,不支持自动 fill"),但**只到 errors[] 数组**,UI step 4 还原报告页可能没显式 surface 让用户知道 plain-text 占位符没自动填。
**修法**:
- 检查 RestoreSecretsBody / RestoreBackupModal step 4 报告页是否显示 `secretsErrors[]` 字段(应来自 `ApplyBackupWithSecretsResult.secretsErrors`)
- 如果只显示 `result.errors[]` 不显示 `secretsErrors[]`,加一个独立的 "🔑 secret fill 失败" 段
- 或者在 secretsErrors 全是 "文件后缀非 .json/.toml" 时合并显示一句友好提示「plain-text 文件(`.md` / `.sh` 等)的占位符已写入但工具不支持自动 fill,请手动编辑文件填回真值」+ 列出文件路径
**验证**:UI 冒烟(用 R1 G1 已加的 plain-text fill 测试 dchpack 跑一次 restore 看 UI step 4 是否显示)+ bun test 全过
**预计 LOC**:~30-80 行(主要是 UI 渲染 + 友好文案,可能加 1-2 个 component test)

## 步骤 checklist

- [x] Step 1 — 基线自检(cwd / git log / bun test + cargo test 跑一遍确认 R2 末态干净)— bun 412 / cargo 40(单线程)pass
- [x] Step 2 — F1 path_policy with_home env race fix + commit — commit `2e6dcd6`,默认多线程 cargo test 40 pass 连跑 3 次稳定
- [x] Step 3 — F2 backup-restore.ts 拆模块 + commit — commit `01bd86b`,backup-restore.ts 515→474 / backup-shared.ts 180→282
- [x] Step 4 — F3 createBackup --keep TOCTOU fix + commit — commit `f4796e9`,10 并发 race 100% 触发,文件全独立 size>0 + tar -tzf 全过
- [x] Step 5 — F4 plain-text fill UX surface + commit — commit `ba10574`,splitErrorsForReport pure helper + 6 unit case 全过 + RestoreReportBody 渲染友好段
- [x] Step 6 — 写 CHANGELOG_22.md + 同步 changelog/INDEX.md + plan 归档(本 plan mv 到 `<main>/plans/` + frontmatter status=completed + commit)— 本 commit

## 当前进度

**位置**:全 done。bun test 412 → **419 pass / 0 fail**(+1 F3 / +6 F4) / cargo test **40 pass / 0 fail** 默认多线程稳定。
4 commit 落地 4 项 follow-up:`2e6dcd6` (F1) → `01bd86b` (F2) → `f4796e9` (F3) → `ba10574` (F4)。

## 下一会话第一步 (cold start hand off)

新 session 接力第一步:

1. **`Bash: cat /Users/apple/Repository/personal/dev-config-hub/.claude/plans/dch-deep-review-followup-20260515.md`** 读全本 plan(强制走 cat 不走 Read,详 user CLAUDE.md §选项 A 末 callout)
2. **不**进 worktree(本 plan 项目历史惯例不用 worktree,直接主仓库 fix + commit)
3. `git -C /Users/apple/Repository/personal/dev-config-hub log --oneline -10` 确认 HEAD = `2c5b34e`(R2 + 收口末态)
4. (可选自检)`zsh -i -l -c "bun test" | tail -5` + `zsh -i -l -c "cd src-tauri && cargo test -- --test-threads=1" | grep "test result"` 确认 412 / 40 全过
5. **按 §设计决策 2 顺序**(F1 → F4)依次落地,每项独立 commit
6. **Step 6 收口**:写 `changelog/CHANGELOG_22.md` + 同步 `changelog/INDEX.md` 加一行 + plan 归档(本 plan mv 到 `<main>/plans/dch-deep-review-followup-20260515.md` + 同步 `<main>/plans/INDEX.md` + frontmatter status=completed + final_commit + completed_at + git commit)

**用户授权(全程贯穿,务必继续保持 + hand off 时一路传给下一 session)**:

> "你一路推进吧,hand off 的时机自己把握。上面在所有会话都保持,hand off 时一路传下去。"

**关键纪律**(继承 REVIEW_9):
- 每个 follow-up 必须配回归测试(无测试不算 done)
- 不退已有约定(REVIEW_9 12 commit 修法不能回退)
- 改动遵循项目 CLAUDE.md(Bun first / 单文件 ≤ 500 / Tauri 不弹 window.confirm 等)
- bun test 必须走 `zsh -i -l -c "bun test"`(登录式 zsh 才能注入 PATH 让子进程 Bun.spawn 找到 bun)— 直接 `/Users/apple/.bun/bin/bun test` 会让 backup-safety.test.ts 报 ENOENT 假阳 fail(REVIEW_9 已记录)
- cargo test 默认走 `--test-threads=1`(F1 修完 with_home env race 后可以默认多线程跑;在 F1 之前**必须**单线程跑避免 env race 干扰)

**已知踩坑**(继承 REVIEW_9):
- backup-safety.test.ts `Bun.spawn(["bun", ...])` 需 PATH 含 bun → 必须 `zsh -i -l -c "bun test"`
- path_policy with_home env race(本 plan F1 要修)
- backup-restore.ts 515 LOC 超护栏(本 plan F2 要修)

**hand off 触发回头问 user 例外**(继承 REVIEW_9):
- 出现破坏性操作(rm -rf / git reset --hard / force push)
- 反驳轮后仍 50:50 拉扯不清 → user 拍板
