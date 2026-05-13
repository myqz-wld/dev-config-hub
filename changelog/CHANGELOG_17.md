# CHANGELOG_17 — 备份三层模型（默认位 + 置顶 + 历史）+ UI 备份历史 modal

## 概要

dch profile backup 改三层模型：**默认位**（latest.dchpack 每次覆盖）+ **置顶**（带 .pinned sidecar 永不被覆盖）+ **历史**（--keep 创建的时间戳副本）。新增 `dch profile backups / backup-rm / backup-pin` 三个 CLI 子命令 + 顶部 `📚 备份历史` UI 按钮 + BackupHistoryModal 三区管理（还原 / 置顶 / 删除）。

## 变更内容

### 新增模块

- **`src/cli-shared.ts`**（154 行）：cli-profile / cli-backup 共享 helper —— `JSON_MODE` 状态 + setter / getter（`isJsonMode` / `setJsonMode`）+ `flushStdout` / `jsonOut` / `writeOut` / `err` / `ok` / `info` + `parseFlags` / `VALUE_FLAGS`（加 `out / profiles / prefix / rename` 4 项）+ `readStdinLine` + `formatBytes`。**解决 cli-profile.ts 588 行超 500 护栏**
- **`src/cli-backup.ts`**（259 行）：`cmdBackup` / `cmdRestore` / `cmdBackups` / `cmdBackupRm` / `cmdBackupPin` + `printRestorePreview` + 终端美化打印
- **`src/profiles/backup-manage.ts`**（228 行）：`listBackups` / `deleteBackup` / `pinBackup` + `BACKUP_DIR` / `DEFAULT_FILENAME = "latest.dchpack"` / `DEFAULT_PATH` / `resolveBackupPath`。Sidecar `.pinned` 文件存在 = 置顶
- **`src/client/components/profile/BackupHistoryModal.tsx`**（286 行）：三区列表（📌 默认位 / ⭐ 置顶 / 📜 历史）+ 每行 manifest 摘要（profile 数 / 占位符数 / 来源主机）+ 还原 / 置顶 / 删除按钮 + 内联确认

### 修改

- **`src/profiles/backup.ts`**：`CreateBackupOptions` 加 `keep?: boolean`；`createBackup` 默认 outFile 改成 `keep ? dch-backup-<TS>.dchpack : latest.dchpack`（外层 outFile 显式传仍最高优先级）
- **`src/cli-profile.ts`**（588 → 341 行 ✓ 护栏内）：删 helper（搬到 cli-shared）+ 删 cmdBackup / cmdRestore / printRestorePreview（搬到 cli-backup）+ `JSON_MODE` → `isJsonMode()` 调用换 + dispatcher 加 `backup / restore / backups / backup-rm / backup-pin` 5 个 else if + help 加新命令 + 兼容 re-export `parseFlags` / `VALUE_FLAGS` 让现有 test 不破
- **`src/client/bridge.ts`**：`BackupOpts` 加 `keep?: boolean`；`dchProfile.backup` 译 `--keep`；新增 `dchProfile.backups` / `backupRm` / `backupPin` IPC + 类型 export `BackupSummary` / `BackupManifestSummary` / `PinBackupResult`
- **`src/client/components/profile/ExportBackupModal.tsx`**：加「保留为历史」checkbox（默认 false = 覆盖 latest.dchpack；勾选 = 写时间戳历史副本）+ 完成提示区分两种 slot
- **`src/client/components/profile/RestoreBackupModal.tsx`**：加 `presetPackPath?: string` prop，mount 后自动 preview（来自 BackupHistoryModal「还原此备份」跳转）；`autoPreviewedRef` 防 React 19 StrictMode 双 mount 重复 preview
- **`src/client/components/ProfilePanel.tsx`**：顶部按钮区加 `📚 备份历史` + `state` `showHistory` / `restorePresetPath` + Modal mount + 还原跳转 callback
- **`src/cli-profile.parseFlags.test.ts`**：`VALUE_FLAGS.size` 5 → 9 加新断言（profile 5 + backup 4）

### 单测

- **`src/profiles/backup-manage.test.ts`**（131 行，14 个测试）：常量校验 + `resolveBackupPath` 纯函数 + `deleteBackup` / `pinBackup` 用绝对路径绕过 BACKUP_DIR 操作临时 fake .dchpack

总计 132 → 195 pass / 0 fail / 0 回归。

### README

- 「备份与还原」节加「三层备份模型」表格（默认位 / 置顶 / 历史）+ 完整命令清单（含 `--keep` / `backups` / `backup-rm` / `backup-pin`）
- 「CLI 用法」节加 4 个新子命令
- 「项目结构」加 cli-shared.ts / cli-backup.ts / backup-manage.ts / BackupHistoryModal.tsx

## 数据模型

### 三层

| 类别 | 文件名模式 | sidecar | 行为 |
|---|---|---|---|
| **default** | `latest.dchpack`（固定） | 无 | 每次 backup 覆盖 |
| **pinned** | 任意 | `<file>.pinned` 存在 | 永不被覆盖 |
| **history** | `dch-backup-<YYYYMMDD-HHMMSS>.dchpack` | 无 | --keep 创建，按时间累积 |

### 「置顶默认位」语义

`backup-pin latest.dchpack` 不直接给 latest.dchpack 加 sidecar（latest 命名约定 = 会被覆盖，sidecar 加上去也保护不了）。改为：
1. 复制 `latest.dchpack` → `dch-backup-<TS>.dchpack`
2. 给副本加 `.pinned` sidecar
3. 原 latest.dchpack 不动（继续是默认位会被下次 backup 覆盖）

返回 `{ pinnedPath: "<新副本绝对路径>", copiedFromLatest: true }`。

非默认位的 pin（如对历史副本置顶）= 原地 `touch <file>.pinned`，无复制。

### Sidecar 设计选择

`.pinned` 是空文件，存在 = 置顶。简单粗暴跨进程一致，无需 .index.json 中央索引（避免并发写状态分裂）。删除备份时同步 `rm <file>.pinned`。

## 端到端验证

```bash
$ dch profile backup --profiles claude-default
✓ 已写入 ~/.dch/backups/latest.dchpack (41.6MB) （默认位，已覆盖）

$ dch profile backups
📌 默认位（每次 backup 覆盖） (1)
  latest.dchpack 41.6MB · 2026-05-13 17:17:53
    profile:1 占位符:73
    profiles: claude-default

$ dch profile backup --profiles claude-default --keep
✓ 已写入 ~/.dch/backups/dch-backup-20260513-171753.dchpack (41.6MB) （历史副本，已保留）

$ dch profile backup-pin dch-backup-20260513-171753.dchpack
✓ 已置顶 ~/.dch/backups/dch-backup-20260513-171753.dchpack

$ dch profile backups
📌 默认位（1）
⭐ 置顶（1） dch-backup-20260513-171753.dchpack
（历史 0 — 已晋升为置顶）

$ dch profile backup-pin latest.dchpack
✓ 已置顶（默认位 → 复制副本 ~/.dch/backups/dch-backup-20260513-171757.dchpack）
原 ~/.dch/backups/latest.dchpack 仍是默认位，下次 backup 会被覆盖

$ dch profile backup-rm dch-backup-20260513-171753.dchpack --yes
✓ 已删除 ~/.dch/backups/dch-backup-20260513-171753.dchpack
（同名 .pinned sidecar 一并删）
```

## 设计决策

1. **默认位文件名 latest.dchpack**：明确"会被覆盖的最新一次"语义，比 default.dchpack 中性
2. **三层拆分（默认位 / 置顶 / 历史）**：默认位=最新快照随取随覆盖，置顶=重要里程碑永久保留，历史=按时间累积管理。三种用途清晰
3. **置顶默认位 = 复制 + 置顶**：latest.dchpack 命名约定不变，置顶通过派生新副本实现，避免"latest 被加 sidecar 后是否还应该被覆盖"的语义二义
4. **sidecar 文件**：每个 .dchpack 一个 `<file>.pinned` 空文件标置顶。简单、无中央状态、跨进程一致。`backup-rm` 同步删 sidecar
5. **manifest 摘要按需 tar -xzOf 拉**：listBackups N 个备份 = N 次 tar exec ≈ 50-100ms / 个，列表场景可接受。损坏 .dchpack → manifest=null + manifestError 字段
6. **Modal 三区独立 BackupGroup 组件**：每区数据 / 渲染 / 操作 self-contained，加新区只需复用组件
7. **删除内联确认**（CHANGELOG_5 教训）：Tauri 2 webview 不弹原生 window.confirm，所有删除走内联两步按钮

## 重构副作用

`cli-profile.ts` 拆分让 cli-shared.ts / cli-backup.ts / cli-profile.ts 三方协作。原 `JSON_MODE` 模块级 `let` 变 `_jsonMode` + `setJsonMode` / `isJsonMode` 函数 —— 因 ESM `export let` importer 看到 live binding 但不能 reassign（external module 必须走 setter）。所有 cmd 函数 `if (JSON_MODE) ...` 改 `if (isJsonMode()) ...`。

`parseFlags` / `VALUE_FLAGS` 从 cli-profile re-export 让 `src/cli-profile.parseFlags.test.ts` 现有 import 路径不破。

## 限定不做

- 不做「自动按数量轮换」（如保留最近 N 个），用户用 `find ~/.dch/backups -mtime +30 -delete` 或自己包脚本
- 不做 .pinned sidecar 含元数据（pin 时间 / pin 原因），如有需求未来加 `<file>.pinned.json`
- 不做备份内容增量 / dedupe（每次都全量打包）
- 不做 BackupHistoryModal 的"导出此 profile 子集"按钮，导出走现有 ExportBackupModal
