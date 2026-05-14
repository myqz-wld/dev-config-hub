# CHANGELOG_19 — 备份敏感字段去重 + 还原阶段交互式补值

## 概要

`dch profile backup` 在 manifest 里新增 `secrets_index` 字段：按 (fieldName, sha256(value)) 全局合并，**实测 148 处占位符 → 32 logical key（4.6x 压缩）**。`dch profile restore` 加 `--fill-secrets`（交互隐藏输入）/ `--secrets-json <file>`（自动化）两个 flag，按 fieldPath 精准 fan-out 到所有 location；UI `RestoreBackupModal` 同步增 step 3「填 K 个 secret」。用户从「填 148 次」降到「填 ~15 次」，CI 场景可完全无人值守。旧 dchpack（无 `secrets_index`）restore 时自动 fall back 到原 dump 清单，向后兼容。

## 变更内容

### 新增模块

- **`src/profiles/secrets-index.ts`**（449 行）：dedup 算法 + fieldPath 寻址 + fill 写回封装
  - `buildSecretsIndex(placeholders, hashByEntry)` —— 按 (fieldName, valueHash) group + 分配 idx + deterministic 排序（fieldName 字典序 → idx 升序 → locations 字典序）
  - `parseFieldPath(fp)` —— `$.a.b[0].c` JSON-path / `a.b.c` TOML dot-path 兼容解析
  - `setByFieldPath(parsed, segs, value)` —— 按 PathSegment 把 string leaf 替换为新值；中间节点缺失 / 类型不符 / 非 string leaf → 静默 false（caller 决定是否记 errors）
  - `applyFilledSecrets(idx, secretsMap, resolveHostPath)` —— 同 host file 多 location 自动 batch（读 1 / parse 1 / set N / 写 1）；JSON / TOML parse 失败 → errors[] 跳过该文件全部 location（不部分写）；返回 `filledLocations: Set<string>` 复合 key `${packPath}|${fieldPath}` 让 caller 准确 filter
- **`src/client/components/profile/RestoreSecretsBody.tsx`**（237 行）：UI step 3 主组件
  - `RestoreSecretsBody` —— K 个 `SecretEntryRow` + 顶部 banner（4 状态：全跳过黄 / 全填绿 / 部分填中性 / 待处理蓝）+ section title
  - `SecretEntryRow` —— monospace label + `count + hint` + password input + eye icon toggle + 「跳过」checkbox + details 折叠 packPath 列表（默认前 3，>3 显「+M more」可展开）
  - `computeSecretsButton` —— derived 还原按钮文案 + disable 判定，与 banner 4 状态对齐

### 新增 IPC（Tauri）

- **`src-tauri/src/lib.rs`**（570 → 639 行）：新增 async command `run_dch_with_secrets_temp(args, secrets_json, timeout_ms)`
  - `temp_dir().join("dch-secrets-<pid>-<nanos>.json")` 算 tempfile 路径
  - `OpenOptions::create_new(true).mode(0o600)` 写 secret（unix-only mode；windows fallback 走默认 ACL，单用户 desktop 仍 OK）
  - `args.push("--secrets-json"); args.push(<tmp_path>)` 后调 `run_dch_command_blocking`
  - 完成（成功 / 失败都）`std::fs::remove_file(&tmp_path)`，失败仅 eprintln warn 不阻塞 result
  - 注：原 plan §Step 6 假定 webview TS 写 tempfile + finally unlink，实测**不可行**（webview 无 chmod / 无 delete_file IPC / save_file 在 tempdir 路径下不报错但留垃圾文件）。改为 Rust 全包 tempfile 生命周期 —— secret 只走一次 IPC 入参，drop guard 强制清理，比 TS finally 更紧

### 新增 bridge surface

- **`src/client/bridge-backup.ts`**（**新建** 192 行）：把 bridge.ts 的 6 个 backup 方法 + 类型 re-export 全搬过来 + 加 secrets-dedup 新 surface
  - `restorePreviewSecrets(packFile)` —— 复用 `restorePreview` 结果 flatten 出 `entries | null`，**不**触发新 IPC（旧 dchpack 无 secrets_index 或 entries=0 → null）
  - `restoreApplyWithSecrets(packFile, opts)` —— `invoke<DchCommandResult>("run_dch_with_secrets_temp", ...)` IPC 调 Rust tempfile route
  - 类型 re-export：`SecretLogicalEntry` / `SecretLocation` / `SecretsIndex` / `ApplyBackupWithSecretsResult` / `RestoreApplyWithSecretsOpts` / `RestoreApplyWithSecretsResponse` / `RestorePreviewSecretsResult`

### 修改

- **`src/profiles/redact.ts`**（171 → 196 行）：`PlaceholderHit` 加 optional `valueHash?: string` —— `walkAndRedact()` / `redactJsonContent` / `redactTomlContent` / `redactProfileEnv` 命中 sensitive key 时算 `sha256(rawValue).slice(0, 16)` hex 短串透传；`redactWholeFile()` **不带** valueHash（整文件场景 OAuth 内容跨 profile 必然不同，下游识别 undefined → 每条独立 logical key 不参与 dedup）。复用 Bun 内置 `CryptoHasher`（sync API 不破坏 walkAndRedact 签名）
- **`src/profiles/backup.ts`**（415 → 459 行）：`createBackup` 流程加 step 4.5 —— 收集 `hashByEntry: Map<PlaceholderEntry, string | undefined>` → 调 `buildSecretsIndex` → 仅当 entries 非空时挂到 `manifest.secrets_index`；`Manifest` interface 加 optional `secrets_index?: SecretsIndex`；`readmeText()` 加「## 唯一凭据（去重后）」节列 K 个 logical key 总览，原 N 处详细清单保留为「## 占位符详细清单」
- **`src/profiles/backup-restore.ts`**（284 → 374 行）：新增 `applyBackupWithSecrets(opts)` 公开 API，在原 `applyBackup` 写盘后追加一步 fan-out
  - `ApplyBackupWithSecretsOptions extends ApplyBackupOptions { secretsMap: Record<string, string> }`
  - `ApplyBackupWithSecretsResult extends ApplyBackupResult { secretsApplied / secretsSkipped / secretsUnknown / secretsErrors }`
  - 用 `baseResult.placeholders` 构建 `packPath → hostPath` Map 排除 `_meta.json` 段（env 段 fieldPath `$.env.K` 与 profiles.json 顶层结构不对齐 → 让它们保留为占位符让用户后续手改）
  - 调 `applyFilledSecrets(idx, secretsMap, resolveHostPath)` 后用 `fillResult.filledLocations`（复合 key `${packPath}|${fieldPath}`）filter `baseResult.placeholders`，让 result.placeholders 反映 fill 后真实状态而非 stale manifest 数据
  - fillResult.errors 镜像 push 到 baseResult.errors 加前缀 `secrets-fill: ` 区分来源
- **`src/cli-shared.ts`**（154 → 218 行）：
  - 新加 `readStdinSecret()` —— TTY 走 raw mode 隐藏行（disable echo / 支持 backspace ^H 0x08 + DEL 0x7f / Ctrl+D 提交 / Ctrl+C 返回 null 让 caller 跑 finally cleanup 不直接 process.exit）；非 TTY（CI / pipe）fall back `readStdinLine()`；try/finally 恢复 raw mode + 移除 SIGINT listener，**任一路径都 cleanup**（plan 风险节第 6 条）
  - `VALUE_FLAGS` 加 `secrets-json`（避免 `--secrets-json --foo` 被解析成 boolean）
- **`src/cli-backup.ts`**（260 → 418 行）：`cmdRestore` 三分支重构
  - **flag 校验**：`--fill-secrets ⊕ --secrets-json` 互斥 / `--fill-secrets / --secrets-json ⊕ --dry-run` 互斥 / `--fill-secrets ⊕ --json` 互斥（json 模式 caller 应改用 --secrets-json 自动化）
  - **A. `--secrets-json <file>`**：`loadSecretsJson` schema 校验（plain object + 所有 value 是 string）→ 调 `applyBackupWithSecrets` → 输出统计；schema 失败立即 `err()` exit 1，**绝不**把文件内容打回 stdout（含真值）
  - **B. `--fill-secrets`**：`promptSecretsInteractive` 按 idx.entries 顺序逐个 prompt（label + count + hint + 前 3 个 packPath 预览 + 隐藏输入），ENTER 跳过 / Ctrl+C 中止 → 调 `applyBackupWithSecrets`
  - **C. 都不传**：走原 `applyBackup` + 尾部加「💡 备份内含 N 个唯一凭据；下次可用 --fill-secrets / --secrets-json」提示
  - 重构 `printRestoreResult` helper 兼容两种 result 类型（`"secretsApplied" in result` 区分）
  - 重构 `printRestorePreview`（dryRun）：含 `secrets_index` 时显示 K 个 logical key 总览段，旧 pack fall back 原 dump
  - **secretsMap 永不打 stdout**（plan 风险节第 7 条）：日志只用 logical key 名 / count / hint
- **`src/client/bridge.ts`**（413 → 336 行）：`export runDch` / `TIMEOUT_*` / `DchCommandResult` 让 bridge-backup 复用；删 backup 类型 import（搬到 bridge-backup）；`dchProfileMethods` private const + `export const dchProfile = { ...dchProfileMethods, ...dchBackup }` spread 让 caller 调 `dchProfile.backup(...)` 完全不变；`export * from "./bridge-backup.ts"` 透传所有 backup 类型 + `dchBackup` 对象
- **`src/client/components/profile/RestoreBackupModal.tsx`**（363 → 471 行）：3 步 → 4 步
  - 新 state：`secretEntries` (null = 跳过 step 3 fall back 旧 pack 走 3 步) / `secretsState` / `phase: "rename" | "secrets"`
  - `result` 类型扩展：`ApplyBackupResult | (ApplyBackupWithSecretsResult & { manifest: Manifest }) | null`
  - `onPreview` 直接从 `r.manifest.secrets_index?.entries` 提 entries（不做 second IPC，复用 dry-run preview 结果）
  - `onApply` 三分支：rename phase 有 secrets → 切到 secrets phase（不调 IPC，可来回 ← 上一步） / rename phase 无 secrets → 原 `dchProfile.restoreApply` / secrets phase → `dchProfile.restoreApplyWithSecrets`
  - footer 加「← 上一步」按钮（仅 secrets phase 显示，state 保留），主按钮文案随 phase 变
  - `RestorePreviewBody` 接 `hasSecretsHint` prop（> 0 时 step 2 顶部加蓝 banner 预告下一步要填几个 secret）
  - `RestoreReportBody` 加 `secretsMetrics?` optional prop：result 是 `ApplyBackupWithSecretsResult` 时显示「填值 N 处 · 跳过 M 个 logical key · 未知 K 个」
- **`.gitignore`**：加 `.claude/plans/` + `.claude/worktrees/`（plan 文件 + worktree 隔离）

### 单测

- **`src/profiles/secrets-index.test.ts`**（**新建** 33 个测试）：dedup 不变量（同 hash 跨 5 profile → count=5 / 异 hash → 多 logical key idx 升序 / `total_occurrences === sum(count) === placeholders.length` / 整文件不参与 dedup / 排序 deterministic / **manifest 不应包含真值或 valueHash 任何痕迹**）+ fieldPath 解析 8 case（JSON 嵌套 / 数组 / 二维数组 / TOML dot-path / env.K / 整文件 $.placeholder / 根 $ / 未闭合 [ 抛错）+ setByFieldPath 7 case（嵌套 string leaf / 数组 leaf / 中间节点缺失 false / leaf 非 string false / 数组越界 false / 空 segments false / hasOwnProperty 缺失 false）+ 对称循环 4 case（redact → fieldPath → setByFieldPath JSON 嵌套 / 数组 / TOML section / env.K）+ applyFilledSecrets 7 case（跨 2 文件 fan-out + filledLocations 复合 key 准确 / secretsMap 缺 key 计入 skipped / 多 key 计入 unknown 不 fail / hostPath unresolved 跳过不计 errors / 文件后缀非 .json/.toml 记 errors / parse 失败记 errors 不动文件 / 寻址失败单条不阻断同文件其他 location）
- **`src/profiles/redact.test.ts`**（+7 个测试，17 → 24）：valueHash 同输入同 hash deterministic / 异输入异 hash / 长度 = 16 hex 字符短 sha256 / wholeFile 不带 valueHash / TOML 也带 valueHash / env 段也带 valueHash / 不变量脱敏后 content 内不含真值或 valueHash 字符串
- **`src/client/components/profile/RestoreSecretsBody.test.tsx`**（**新建** 8 个测试）：`computeSecretsButton` 5 状态分支（全空 / 部分填仍 pending / 部分填部分跳过无 pending / 全跳过 / 全填）+ skip 优先 + 空字符串短路 + 空 entries 边界（分支次序 skipped===total 0===0 命中）

总计 257 → 305 pass / 0 fail / 0 回归（pre-merge baseline 195；merge main REVIEW_8 后 257；本 plan 单测追加 48）。typecheck：本 plan 改动 0 错；main 预存 1 tsc 错误（hooks.ts:109 Subprocess.kill signature mismatch，不是本 plan 引入）。

### scope 决定（plan §Step 8 wishlist 部分项目按现实裁剪）

- 跳过 `backup.test.ts` / `backup-restore.test.ts`（createBackup / addProfile 触碰真实 `~/.dch/profiles.json`，HOME 走 `os.homedir()` import 后不可 mock；secrets-index dedup 不变量 + applyFilledSecrets 都已覆盖；端到端见 Sub-step 8b CLI E2E）
- 跳过 cli `loadSecretsJson` 单测（`err()` 走 `process.exit(1)`；session#5 末已 spawn-CLI E2E 验过 case 5/5b/5c bad json）
- 跳过 `RestoreBackupModal` 单测（state machine + IPC mock；mock.module 跨 file 污染问题，遵循 `bridge.test.ts` 既有约定）
- 跳过 `bridge-backup` 单测（同 mock.module 限制）

### CLI E2E 冒烟

- backup → manifest.secrets_index 5 不变量全 ✓（`total_occurrences === sum(count) === placeholders.length` / 不含 valueHash 16-hex / 排序 deterministic）
- 实测 148 占位符 → 32 logical key（4.6x dedup 压缩比）
- `--secrets-json` 填 3 logical key (ANTHROPIC_AUTH_TOKEN-1 / API_KEY-1 / Authorization-1) → fan-out 34 处（4 + 10 + 20）grep -o 实测精确匹配
- 剩余占位符 = 148 - 34 = 114 ✓（排除 .md 文件里的字面量文档）
- 9 case mutex / bad json / unknown key warn / 不传 flag tip 全 exit 1 / OK
- 0 残留 profile / dchpack / smoke 目录

## 数据模型

### Manifest 扩展（向后兼容）

`format_version=1` **不变**，新增 optional 顶层字段 `secrets_index?: SecretsIndex`：

```jsonc
{
  "secrets_index": {
    "schema_version": 1,
    "total_logical_keys": 32,
    "total_occurrences": 148,
    "entries": [
      {
        "name": "ANTHROPIC_AUTH_TOKEN-1",
        "fieldName": "ANTHROPIC_AUTH_TOKEN",
        "count": 4,
        "hint": "4 occurrences across 2 profiles",
        "locations": [
          { "packPath": "profiles/claude-default/configDir/providers/opus.json", "fieldPath": "$.env.ANTHROPIC_AUTH_TOKEN" },
          { "packPath": "profiles/claude-pro/configDir/providers/opus.json",     "fieldPath": "$.env.ANTHROPIC_AUTH_TOKEN" }
        ]
      }
    ]
  }
}
```

旧 dch restore 新 pack 时忽略 `secrets_index` 走 `placeholders[]` fall back（无破坏）；新 dch restore 旧 pack 时检测无 `secrets_index` 自动 fall back 到 dump 清单。

### dedup 粒度

**全局合并** —— 同 fieldName + 同 sha256(value) 跨 profile 合并成 1 个 logical key（`<FIELD_NAME>-<idx>`）。99% 场景成立（用户在两个 profile 用同一个 GitLab PAT），万一有偶然 hash 碰撞（罕见）合并语义也无害（用户 fill 时填的也是同一个值）。

**整文件场景**（`auth.json` / `credentials.json`）：跳过 dedup（OAuth payload 跨 profile 几乎必然不同），每个 location 独立 logical key，count=1，hint 含 `whole-file secret`。

### 不变量（构建后置断言）

- `total_occurrences === sum(entries[i].count) === placeholders.length`
- 排序 deterministic：entries[] 按 fieldName 字典序 → idx 升序；每个 locations[] 按 packPath 字典序
- manifest.secrets_index 内**绝不**包含 valueHash / 任何真值（hash 仅 backup 内存阶段做 group key，分配 logical key 后立即丢弃）

## 安全约束

- **真值绝对不写 manifest** —— valueHash 仅 backup 内存阶段用作 group key，分配 logical key 后立即丢弃。secrets-index.test.ts 加 unit test 断言 `JSON.stringify(idx).includes(realValue) === false` + 也不含 16-hex hash 短串
- **secretsMap 永不打 stdout**（cli-backup.ts）：日志只用 logical key 名 / count / hint，从不传 value
- **secretsMap 不入 console / localStorage / 任何旁路**（RestoreSecretsBody.tsx）：仅在 caller 调 `dchProfile.restoreApplyWithSecrets` 时一次性走 Rust tempfile route
- **Tauri tempfile 生命周期 Rust 侧管**（lib.rs `run_dch_with_secrets_temp`）：webview TS 永远拿不到 tempfile 路径；`OpenOptions::create_new(true).mode(0o600)` 限本用户读写；finally 强制 `remove_file` 失败仅 warn 不阻塞 result
- **隐藏输入 raw mode try/finally 恢复**（cli-shared.ts `readStdinSecret`）：onData / onEnd / SIGINT 任一路径都 `setRawMode(false)` + 移除 SIGINT listener，避免 ctrl+c 让用户终端 stuck
- **TOCTOU 防部分写**（applyFilledSecrets）：当且仅当至少 1 个 set 成功才会写盘；write 成功才 commit tentative → filledLocations（避免 stringify/write fail 时虚报已填）

## 设计决策

1. **logical key 命名 `<FIELD_NAME>-<idx>`** —— idx 从 1 起，按 fieldName 分组内排序；朴素直观，UI/CLI 旁边附 hint「N 处出现，含 …」；不依赖 hash 串
2. **占位符格式不变** `<<DCH_PLACEHOLDER:FIELD_NAME>>` —— 兼容 `redact.ts:43` 的 PLACEHOLDER_RE 与 `placeholderCount()`；fill 时按 secrets_index.locations 的 fieldPath 寻址替换，不靠字符串裸匹配
3. **fan-out 后 filter 复合 key `${packPath}|${fieldPath}`** —— 同一 packPath 内可能多个不同 fieldName 的 placeholder（如 plugin.json 同时含 IAM_SECRET_KEY 和 GITLAB_PAT），仅靠 packPath dedup 会 over-filter；复合 key 准确
4. **Rust tempfile 全包**（plan 偏差）—— 原 plan §Step 6 假定 webview 写 tempfile 实测不可行（无 chmod / 无 delete_file IPC / save_file 在 tempdir 路径下不报错但留垃圾文件）；改 Rust 一个 command 全包 tempfile 生命周期，secret 只走一次 IPC 入参 + drop guard 强制清理
5. **`_meta.json` env 段排除 fan-out** —— fieldPath `$.env.K` 是面向 profile _meta.json 子树的，但 restore 阶段 hostPath 重写为 `~/.dch/profiles.json`（store 全局结构 `{ profiles: [...], active: {...} }`），强行 set 必失败；`applyBackupWithSecrets` 用 `packPath.endsWith("/_meta.json")` 双保险（build packToHost + resolveHostPath 都 check）
6. **bridge.ts spread 合 dchBackup**（CHANGELOG_18 兼容性）：`export const dchProfile = { ...dchProfileMethods, ...dchBackup }` 让 caller 调 `dchProfile.backup(...)` 完全不变；`export * from "./bridge-backup.ts"` 透传所有 backup 类型 re-export 让 caller import 路径不变

## 重构副作用

- `bridge.ts` 413 行 → 336 行（CLAUDE.md 「现存超标已知」之前接近 500 护栏，本次拆 192 行到 bridge-backup.ts 让原文件回到健康范围）
- `dchProfile` 对象通过 spread 合成，IDE 跳转看到 `backup` 方法落 bridge-backup.ts 而非 bridge.ts；caller 无感知
- `cli-backup.ts` 260 → 418 行（仍 < 500），加新分支 + 重构 print helper 兼容两种 result 类型

## 限定不做

- 不做 fieldPath 寻址支持 key 含 `.` 或 `[` 字面量（walkAndRedact 固有限制；遇到这类 key 名实际不会 trigger redact，落到 fall back dump 清单）
- 不做按 profile 分别 dedup（与全局合并互斥；用户场景几乎全是「跨 profile 同 token」，全局合并最省事）
- 不做 secret 长度/格式校验（用户填什么 fan-out 什么；拼写错 / 格式错 caller 自己负责）
- 不做 secret cache（每次 restore 都需要重填；密码管理不在 dch 范围内）

## 用户体验

```bash
# 默认（不传 flag）：dump 清单 + 加新 hint
$ dch profile restore latest.dchpack
✓ 已还原 4 个 profile
剩余占位符 148 处:
  ...
💡 备份内含 32 个唯一凭据；下次可用 --fill-secrets 交互填入或 --secrets-json <file> 自动化

# 自动化：CI / 脚本场景一次性喂入
$ echo '{"ANTHROPIC_AUTH_TOKEN-1":"sk-...","API_KEY-1":"sk-...","Authorization-1":"Bearer ..."}' > secrets.json
$ dch profile restore latest.dchpack --secrets-json secrets.json --yes
✓ 已还原 4 个 profile
凭据填入: 已填 34 处 · 跳过 29 个 logical key · 未知 0
剩余占位符 114 处（fan-out 后未替换的，多为 _meta.json env 段，需手改 ~/.dch/profiles.json）

# 交互：手动填几个最常用的，剩下的 ENTER 跳过
$ dch profile restore latest.dchpack --fill-secrets --yes
填入 32 个唯一凭据 (148 处占位符 · ENTER 跳过 · Ctrl+C 中止)

[1/32] ANTHROPIC_AUTH_TOKEN-1 (count=4, 4 occurrences across 2 profiles)
  ↳ profiles/claude-default/configDir/providers/opus.json
  ↳ profiles/claude-pro/configDir/providers/opus.json
  ↳ profiles/claude-default/configDir/providers/sonnet.json
  ↳ +1 more
Value (隐藏，ENTER 跳过): ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●

[2/32] ...
```

UI 「📥 导入备份」走 4 步流程：preview → rename conflicts → **填 K 个 secret**（**新增**）→ apply+report。step 3 仅当 manifest 含 `secrets_index` 时显示，旧 pack 自动跳过保 3 步。
