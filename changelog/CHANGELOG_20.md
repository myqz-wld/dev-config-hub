# CHANGELOG_20 — UI 备份 / 还原显式呈现去重清单

## 概要

CHANGELOG_19 在 manifest 写了 `secrets_index`（148 处 → K 个 unique secret），但 UI 备份完成后只说「N 处脱敏」，UI 还原 step 2 也只 banner 显示「将填 K 个」一个数字 —— 用户备份完不知道自己将来要填几个、还原时进 rename 步骤也看不到具体 logical key 清单，错过 step 3「填 K 个 secret」的预期。

本次给 `ExportBackupModal` 备份完 result 区与 `RestoreBackupModal` step 2 顶部都加上完整去重清单（数字 + 列每个 logical key 名 + count + hint），让用户在备份完成与确认还原前都能直接看到「这次备份/还原涉及 K 个 unique secret，每个长这样」。step 3 填写界面（`RestoreSecretsBody`）保持 CHANGELOG_19 实现不动。

## 变更内容

### `src/client/components/profile/ExportBackupModal.tsx`（268 → 301 行）

- 备份完 result 区文案：`{placeholders.length} 处脱敏` → `{secrets_index.total_logical_keys} 个 unique secret（合并自 {total_occurrences} 处占位符）`；旧 pack / no-placeholder 模式（无 `secrets_index`）走 fall back 保留原文案
- 新增内部组件 `SecretsSummaryList`：展开式 `<details open>` 列每个 entry（`<code>{name}</code> · count={count} · {hint}`）+ 底部总结「还原时只需填这 K 个值」
- import 加 `SecretsIndex` 类型（已通过 bridge.ts `export *` 透传，无需改 bridge 层）

### `src/client/components/profile/RestoreBackupModal.tsx`（471 → 487 行）

- `RestorePreviewBody` prop 重构：`hasSecretsHint: number` → `secretEntries: SecretLogicalEntry[] | null`（一致传整个清单，不再只传数字）
- step 2 顶部蓝色 banner 升级：原「🔑 将填 N 个去重 secret」单行 → banner 内嵌 `<details open>` 清单，列 K 个 logical key 名 + count + hint，让用户在 rename 前就能看清楚下一步要填什么
- 数字部分 `<strong>{secretEntries!.length}</strong>` 加粗 + 文案改为「将填写」（明确动词避免「将提示」歧义），并显示 fan-out 总处数 `to all {totalOcc} 处`
- 主按钮文案 / step 3 输入区 / report 区不变（CHANGELOG_19 保持原状）
- 文件 487 < 500 ✓

## 验证

- `bunx tsc --noEmit`：本次改动 0 错（hooks.ts:109 Subprocess.kill signature mismatch 是 pre-existing 错误，CHANGELOG_19 已确认）
- `bun test`：305 / 305 pass / 0 回归
- 文件大小：ExportBackupModal 301 / RestoreBackupModal 487 / RestoreSecretsBody 237，全 < 500 ✓

## 已知遗留 / 未做

- **CLI `dch profile backup` stdout 未同步加去重清单**：当前只输出「⚠ 已脱敏 N 处凭据」，仍然不告诉用户「合并后是 K 个 unique secret」。`readmeText()` 写入的备份包内 README.md 已含「## 唯一凭据（去重后）」节，但 stdout 未 surface。本次按用户范围裁剪只改 UI；如有需要后续单独追加 CLI 改动
- 用户反馈的「还原 step 3 看不到」问题，经数据排查 `latest.dchpack` 已含 `secrets_index`（540 个 logical key）→ step 3 的代码路径 (`hasSecrets = true → setPhase("secrets")`) 应正常触发；最可能是用户测试时 `/Applications/Dev Config Hub.app` 未重新打包安装。本次 step 2 banner 升级后，用户在 rename 步骤就能直观看到「下一步要填 K 个 secret」与按钮文案「下一步：填 K 个 secret」，更难错过 step 3
