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

## Follow-up bug fix：plain-text 路径漏 valueHash 导致 dedup 失效

### 现象

UI 升级清单后用户实测截图：540 个 logical key 里大量 `ACCESS_TOKEN-1..6` / `ANTHROPIC_API_KEY-1..3` 全部 count=1 + hint 标 `whole-file secret, claude-default`。同 token 在多处出现没合并成一个，dedup 比 585→540（1.08x，几乎为零压缩）。

### 根因

`src/profiles/redact.ts` 的 `redactPlainTextContent`（REVIEW_8 M2/D5 加的纯文本脱敏路径，覆盖 `.md` / `.sh` / `.yaml` 等非 JSON/TOML 文件）三组 regex 命中后 push 的 `PlaceholderHit` **没有 valueHash 字段**：

```ts
// before：HIGH_CONFIDENCE / KEY_VALUE / HTTP_AUTH 三组都漏 valueHash
hits.push({ fieldPath: `text.${name}`, fieldName: name });
```

而 `walkAndRedact` (JSON) / `redactProfileEnv` 都正确传了 `valueHash: shortHash(v)`。

下游 `secrets-index.buildSecretsIndex`：

```ts
const groupKey = hash === undefined
  ? `${entry.fieldName}|whole|${idx}`   // ← undefined 走「每条独立」分支
  : `${entry.fieldName}|${hash}`;       // ← 正常 dedup
```

→ plain-text 命中全走 `whole|<idx>` 分支 → 每条独立 logical key + `hintForGroup(isWhole=true)` 误标「whole-file secret」。

CHANGELOG_18 dch-secrets-dedup plan §Step 1 写「`walkAndRedact()` 命中 sensitive key 时计算 valueHash → `redactJsonContent` / `redactTomlContent` / `redactProfileEnv` 透传」**漏列 `redactPlainTextContent`**（REVIEW_8 plain-text path 比 secrets-dedup plan 后实施，两边没人发现没对齐），实施时也没补。

### 修法

`src/profiles/redact.ts:redactPlainTextContent`：

- HIGH_CONFIDENCE callback 接 match 整串：`(m: string) => { ... valueHash: shortHash(m) }`
- KEY_VALUE callback 接 capture group 2 (value)：`(_m, keyName, value) => { ... valueHash: shortHash(value) }`
- HTTP_AUTH callback 接 capture group 3 (token)：`(_m, headerName, scheme, token) => { ... valueHash: shortHash(token) }`

每组都用纯 `value` 算 hash，不掺 KEY 名 / scheme / header —— 同一 token 用不同 KEY 名出现也能合并（如 `ACCESS_TOKEN=abc` 与 `MY_ACCESS_TOKEN=abc` 视为同 token）。

### 验证

CLI E2E 实测同一 4-profile 备份：

| | placeholders | unique logical keys | 压缩比 | whole-file entries |
|---|---|---|---|---|
| **修复前** | 585 | 540 | 1.08x | 大量误判 |
| **修复后** | 585 | **110** | **5.32x** | 2（仅真正的 auth.json / credentials.json） |

ACCESS_TOKEN：6 个独立 logical key（count=1 各）→ **1 个 logical key (count=6)**。

### 单测

`src/profiles/redact.test.ts` +4 case：
- HIGH_CONFIDENCE 同 token 同 hash（dedup 关键）/ 异 token 异 hash
- KEY_VALUE：valueHash 来自 value 部分而非整 line（`ACCESS_TOKEN=x` 与 `MY_ACCESS_TOKEN=x` 同 hash）
- HTTP_AUTH：valueHash 来自 token（不含 scheme / header）

305 → **309 pass / 0 回归**。

### 已知遗留（不修）

- plain-text fan-out 仍走 `applyFilledSecrets:fillSingleFile` 的 `.json/.toml` only 分支，被记 errors 不实际写回 plain text 文件 —— 这是 CHANGELOG_19 既有边界（plain text 没有结构化 fieldPath 寻址，无法精确定位 line:col 替换）。dedup 现在正确，但 fan-out 仍要用户手改 plain text 文件。后续如需可加 plain text fill 路径（按 `<<DCH_PLACEHOLDER:NAME>>` 字面量全局替换）

## Follow-up algorithm change：cross-fieldName dedup

### 现象

plain-text bug 修完后实测 585 placeholder → 110 logical key（5.32x），仍远高于「~15」预期。分析 110 个分布发现：同一个 token 在多个 plugin 配置里被命名为不同字段名（如 `APP_SECRET / DEFAULT_APP_SECRET / FEISHU_APP_SECRET` 都配同一个 secret，`APIKEY / API_KEY` / `GITLAB_PERSONAL_ACCESS_TOKEN / TOKEN` 等同义命名），原算法 group key=`(fieldName, valueHash)` 把同 value 不同 fieldName 切成多个 logical key。

### 算法变更

`src/profiles/secrets-index.ts:buildSecretsIndex`：

| | before (CHANGELOG_19) | after (CHANGELOG_20) |
|---|---|---|
| group key | `(fieldName, valueHash)` | **`valueHash` only** |
| 同 hash 跨 fieldName | 切成多个 logical key | **合并 1 个 logical key** |
| `entry.fieldName` 语义 | 该 entry 唯一 fieldName | **primary** fieldName（出现最多；并列字典序最小） |
| 新增字段 `entry.fieldNames` | — | **distinct list 字典序**（optional 兼容旧 dchpack） |
| hint 多 fieldName 时 | — | 附 `· N field names: A / B / C +M more` |

### 验证

CLI E2E 同一 4-profile 备份：

| | placeholders | unique logical keys | 压缩比 |
|---|---|---|---|
| **原算法 (bug 修前)** | 585 | 540 | 1.08x |
| **plain-text bug 修后** | 585 | 110 | 5.32x |
| **cross-fieldName 合并后** | 585 | **99** | **5.91x** |

合并实例：`APIKEY-3` (count=6, fieldNames=APIKEY/API_KEY) / `DEFAULT_APP_SECRET-1` (count=8, fieldNames=APP_SECRET/DEFAULT_APP_SECRET/FEISHU_APP_SECRET) / `FOLDER_TOKEN-1` (count=32, fieldNames=FOLDER_TOKEN/TARGET_FOLDER_TOKEN) / `GITLAB_PERSONAL_ACCESS_TOKEN-6` (count=6, fieldNames=GITLAB_PERSONAL_ACCESS_TOKEN/TOKEN) 等。

### 99 是用户备份的真实 distinct token 数

进一步分析：剩余 99 个 logical key 的大头来自 plugin marketplace 安装目录的文档示例（如 `vibe-coding` plugin 的 `feishu-docs.yaml` 字面包含 12 个不同 `feishu_token: "..."` 字符串，每个 hash 不同 → 12 个独立 logical key 是 dedup 不可压缩的真值差异）。

要降到 ~15 需从「数据源」入手：在 `src/profiles/backup-rules.ts` 排除 plugin marketplace 安装目录的 .md / .yaml（plugin install 时会重拉，备份不需要）。这是数据范围设计决策，不属于 dedup 算法范围，本次未做。

### 单测

`src/profiles/secrets-index.test.ts` +3 case：
- 跨 fieldName 同 hash → 合并 1 个 logical key + fieldNames 列全部 fieldName + hint 含「N field names」
- primary fieldName 并列时按字典序最小（deterministic）
- 单 fieldName group：fieldNames 仅含 1 个 + hint 不含「N field names」段（向后兼容老体验 / 与 CHANGELOG_19 输出一致）

309 → **312 pass / 0 回归**。

### UI 配套

- `RestoreSecretsBody.tsx` SecretEntryRow：multi-fieldName entry 加黄色标签 `⚡ 跨 N 字段名` + hover tooltip 列全部 fieldName
- `ExportBackupModal.tsx` SecretsSummaryList：multi-fieldName 行尾加紧凑标签 `⚡N` + hover tooltip
- 单 fieldName entry 不显示标签（保持简洁，避免视觉污染）

### 兼容性

- `manifest.format_version=1` 不变；新增 optional `entry.fieldNames?: string[]` 旧 dchpack 读进来 undefined
- `entry.fieldName` 字段保留（语义改成 primary fieldName），旧 caller 不破坏
- UI 渲染 fallback：`entry.fieldNames ?? [entry.fieldName]` 兼容旧 dchpack
- 旧 dchpack restore 时仍按旧算法（CHANGELOG_19）切散的 logical key 列表展示，**用户填的还是 K_old 个值**；新 backup 出来的 dchpack 才走新算法（K_new ≤ K_old）
