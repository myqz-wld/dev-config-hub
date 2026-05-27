---
plan_id: "dch-secrets-dedup-20260514"
topic: "dch-secrets-dedup"
created_at: "2026-05-14"
status: "completed"
worktree_path: "/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/dch-secrets-dedup-20260514"
base_commit: "0a136b6100a59338fe767d2d4d0348f7a0f269e9"
base_branch: "main"
target_repo: "/Users/apple/Repository/personal/dev-config-hub"
final_commit: "72256272a9a9119ae7deeec33cbe0fc13842eefb"
completed_at: "2026-05-14"
---
> **路径修正**（plan 内容里 `src/bridge.ts` 实际是 `src/client/bridge.ts`，Step 6 实施时按此修正）。
> **未读文件实际行数**：backup-restore.ts=276 / cli-shared.ts=154 / RestoreBackupModal.tsx=363（都 < 500 健康范围）。
> **bridge.ts 行数待确认**（首次进 Step 6 前再 wc）。

# DCH 备份/还原：敏感字段去重 + 交互式补值

## Context

**问题**：DCH 当前备份产出的 `.dchpack` 把每个敏感字段单独列成占位符，实测一次备份 148 处占位符。restore 时 CLI / UI 都只 dump 清单让用户事后**逐个手改文件**。

**根因**：占位符在 `manifest.placeholders[]` 是平铺数组，每个 (packPath, fieldPath) 各占一席，**没有按真值去重**。但实际重复率极高 —— 同一个 GitLab PAT 在 32 处 plugin.json 出现，同一个 ANTHROPIC_AUTH_TOKEN 在 4 个 provider 文件出现，跨 profile（default / pro）镜像放大一倍。148 处估算只对应 **10–20 个唯一真值**。

**目标**：
1. 备份阶段按真值 hash 全局合并，生成 `manifest.secrets_index`（K 个 logical key → N 个 locations 映射）
2. 还原阶段提供「填 K 个 secret」交互（CLI prompt + JSON 喂入 + UI modal），自动 fan-out 到所有 locations
3. 旧 dchpack（无 `secrets_index`）保留现有 dump 清单 fall back 路径
4. 用户单次 restore 操作从「填 148 次」降到「填 ~15 次」

**预期收益**：restore 体验质变；CI / 自动化场景可走 `--secrets-json` 喂入实现完全无人值守。

---

## 已拍板设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 去重粒度 | **全局合并** —— 同 fieldName + 同 value_hash 跨 profile 合并成 1 个 logical key | 备份重点是迁移；用户填一次最省事；想给某 profile 换新值后续手改即可 |
| logical key 命名 | **`<FIELD_NAME>-<idx>`** —— idx 从 1 起，按 fieldName 分组内排序 | 朴素直观；UI/CLI 旁边附 hint「N 处出现，含 …」；不依赖 hash 串 |
| 交互入口 | **CLI + UI 都做** —— CLI `--fill-secrets`（交互） + `--secrets-json <file>`（自动化）；UI `RestoreBackupModal` 加 step 「填 K 个 secret」 | CLI 给 CI / headless；UI 给桌面用户；都不传时 fall back 现有 dump 行为 |
| 占位符格式 | **保持不变** `<<DCH_PLACEHOLDER:FIELD_NAME>>` | 兼容 `redact.ts:33` 的 PLACEHOLDER_RE 正则与 `placeholderCount()`；fill 时按 secrets_index.locations 的 fieldPath 寻址替换，不靠字符串裸匹配 |
| Manifest 兼容 | **`format_version=1` 不变**，新增 optional `secrets_index?` 顶层字段 | 旧 dch restore 新 pack 时忽略 secrets_index 走 fall back（无破坏）；新 dch restore 旧 pack 时检测无 secrets_index 自动 fall back 到 dump 清单 |
| 整文件敏感处理 | **跳过 dedup**，每个 location 独立 logical key | `auth.json` / `credentials.json` 内容是 OAuth 整体，跨 profile 几乎必然不同；强行 hash 合并风险大 |
| 真值不写 manifest | value_hash 仅 backup 内存阶段做 group key，分配 logical key 后**立即丢弃** | 不能让 hash 串残留到 dchpack（弱泄露 + 违背脱敏初衷） |

---

## Manifest schema 扩展

`src/profiles/backup.ts:61-79` `Manifest` 类型新增 optional 顶层字段：

```typescript
export interface Manifest {
  // ...现有字段不变
  placeholders: PlaceholderEntry[];           // 保留（向后兼容 + UI 跳转编辑用）
  secrets_index?: SecretsIndex;               // 新增 optional
  security_warnings: string[];
}

export interface SecretsIndex {
  schema_version: 1;                          // 独立于 manifest.format_version
  total_logical_keys: number;
  total_occurrences: number;                  // 校验位 == sum(entries[i].count)
  entries: SecretLogicalEntry[];              // 按 fieldName 字典序 → idx 升序
}

export interface SecretLogicalEntry {
  name: string;                               // "GITLAB_PERSONAL_ACCESS_TOKEN-1"
  fieldName: string;                          // 原始字段名
  count: number;                              // == locations.length
  hint: string;                               // "32 occurrences across 2 profiles"（动态生成）
  locations: SecretLocation[];                // 按 packPath 字典序排序保证 deterministic
}

export interface SecretLocation {
  packPath: string;                           // 复用 PlaceholderEntry.packPath
  fieldPath: string;                          // 复用 PlaceholderEntry.fieldPath（JSON `$.a.b`/TOML `a.b`/env `env.K`）
}
```

JSON 样例（基于 `/tmp/dch-inspect/manifest.json` 实测改写）：

```json
{
  "secrets_index": {
    "schema_version": 1,
    "total_logical_keys": 14,
    "total_occurrences": 148,
    "entries": [
      {
        "name": "ANTHROPIC_AUTH_TOKEN-1",
        "fieldName": "ANTHROPIC_AUTH_TOKEN",
        "count": 13,
        "hint": "13 occurrences across 2 profiles",
        "locations": [
          { "packPath": "profiles/claude-default/configDir/providers/opus-4-6.json", "fieldPath": "$.env.ANTHROPIC_AUTH_TOKEN" },
          { "packPath": "profiles/claude-pro/configDir/providers/opus-4-6.json", "fieldPath": "$.env.ANTHROPIC_AUTH_TOKEN" }
        ]
      },
      {
        "name": "AUTH-1",
        "fieldName": "AUTH",
        "count": 1,
        "hint": "1 occurrence (whole-file secret, codex-default)",
        "locations": [
          { "packPath": "profiles/codex-default/configDir/auth.json", "fieldPath": "$.placeholder" }
        ]
      }
    ]
  }
}
```

---

## 改动 punch list（按依赖顺序）

### Step 1. `src/profiles/redact.ts` —— hits 加 valueHash

- `PlaceholderHit` interface 加 `valueHash?: string`（optional 让 wholeFile / env 可不携带）
- `walkAndRedact()` 命中 sensitive key 时计算 `sha256(rawValue).slice(0, 16)` → hits.push 时附 valueHash
- `redactJsonContent` / `redactTomlContent` / `redactProfileEnv` 透传
- `redactWholeFile()` **不带** valueHash（整文件不参与 dedup，下游按 `valueHash === undefined` 判断跳过 group）

复用：`crypto.subtle.digest("SHA-256", ...)` Bun 内置，**不引第三方**。

### Step 2. `src/profiles/secrets-index.ts` —— 新建模块

封装 dedup 算法 + fieldPath 寻址 + fill 写回，让 backup.ts / backup-restore.ts 不膨胀（500 行护栏）。

导出：
- `buildSecretsIndex(placeholders: PlaceholderEntry[], hashByEntry: Map<entry, hash>): SecretsIndex` —— 按 (fieldName, hash) group + 分配 idx + 排序
- `applyFilledSecrets(parsedDir: string, index: SecretsIndex, secretsMap: Record<string, string>): { written: number; skipped: string[] }` —— 按 entries 遍历，对每个 location 读 → fieldPath 寻址 → 替换 → 写回
- `parseFieldPath(fp: string): { kind: "json" | "toml" | "env"; segments: PathSegment[] }`
- `setByFieldPath(parsed: any, segs: PathSegment[], value: string): boolean`

fieldPath 寻址实现：
- JSON：用现有 `redact.ts:45-67` 的递归 walk 反向逻辑（`$.a.b[0].c` 拆 `[a, b, [0], c]`）
- TOML：smol-toml parse → 按 dot-path 走 → set leaf → stringifyToml（与 `redact.ts:102-121` 对称）
- env（profile.json 的 env 段）：JSON 子树寻址，prefix 是 `env.`

### Step 3. `src/profiles/backup.ts` —— createBackup 集成 secrets_index

`createBackup()` 流程改造（`backup.ts:221-364`）：
1. 现状 step 1-4 不变（写 dch / shared / profiles staging + collect placeholders）
2. **新增 step 4.5**：从 step 4 收集到的 placeholders 同步收集 hits 的 valueHash → 调 `secrets-index.buildSecretsIndex()` 生成 SecretsIndex
3. step 5 manifest 写入时附 `secrets_index`（仅当 entries 非空）
4. `readmeText()` (`backup.ts:366-394`) 在「待填占位符」节前面加新节「## 唯一凭据（去重后）」：列 K 个 logical key + count + hint，原 148 条详细清单保留为「## 占位符详细清单（共 N 处）」（用户偶尔需要看具体出处）

复用：`PLACEHOLDER_HINTS` (`backup.ts:28-35`) 字典 + `hintFor()` (`backup.ts:37-39`) 现有 hint 优先级，新 secrets_index entry 的 `hint` 字段在生成时拼装「count + profiles 数」动态文案。

### Step 4. `src/profiles/backup-restore.ts` —— 新增 applyBackupWithSecrets

新增公开 API（不动现有 `applyBackup` 签名 = fall back 路径）：

```typescript
export interface ApplyBackupWithSecretsOptions extends ApplyBackupOptions {
  secretsMap: Record<string /* logical_key */, string /* realValue */>;
}

export interface ApplyBackupWithSecretsResult extends ApplyBackupResult {
  secretsApplied: number;
  secretsSkipped: string[];                  // 用户跳过的 logical key 列表
  secretsUnknown: string[];                  // map 中存在但 manifest secrets_index 没有的 key（warn 不 fail）
}

export async function applyBackupWithSecrets(opts: ApplyBackupWithSecretsOptions): Promise<ApplyBackupWithSecretsResult>;
```

实现：在原 `applyBackup` 写盘后追加一步，调 `secrets-index.applyFilledSecrets()` 对所有 location 的真实 host fs 路径（用 ApplyBackupResult.placeholders 已 resolve 的 hostPath）替换占位符为真值。

### Step 5. `src/cli-backup.ts` —— cmdRestore 加 flag

`cmdRestore()` (`cli-backup.ts:81-141`) 改造：

- `parseFlags` 后新增：`fillSecrets = flags["fill-secrets"] === true; secretsJson = typeof flags["secrets-json"] === "string" ? flags["secrets-json"] : undefined;`
- 互斥校验：两者同传 → exit 2
- 流程分支：
  - **都不传 + manifest 有 secrets_index**：现状不变（dump 清单），尾部加提示「💡 use --fill-secrets to populate K secrets interactively, or --secrets-json <file> for automation」
  - **`--secrets-json <file>`**：parse JSON `{logical_key: value}`；走 `applyBackupWithSecrets`；缺 key 静默跳过（同 user-skip 语义），unknown key warn 不 fail；输出 `已填 K/N · 跳过 M`
  - **`--fill-secrets`**：preview 后按 `secrets_index.entries` 顺序逐个 prompt
    - 格式 `[k/N] <logical_key> (count=<n>, <hint>)\nLocations: <前 3 个 packPath>\nValue (hidden, ENTER 跳过): `
    - 隐藏输入：`process.stdin.setRawMode(true)` + 手动逐字节读 + 支持 backspace + 不回显（Bun 无内置 password prompt，**不引第三方**）
    - 空 ENTER → skip 累积；最后一次性 `applyBackupWithSecrets`

复用：`readStdinLine()` (`cli-shared.ts`) 的明文模式做对照；隐藏模式新写 `readStdinSecret()` 放 `cli-shared.ts`（让其他子命令将来也能用，但本次只在 cmdRestore 调）。

### Step 6. `src/bridge.ts` + `src-tauri/src/lib.rs` —— Tauri command 串通

⚠️ `bridge.ts` 已接近 500 行护栏（CLAUDE.md 「现存超标已知」标记）。本次不应再加大。

方案：把 backup/restore 相关 commands 拆出 `src/bridge-backup.ts`（与 `cli-backup.ts` 命名对称），`bridge.ts` re-export。本次新增的 commands：

```typescript
// 在 RestoreBackupModal preview 阶段（dryRun 后）调用，拿 K 个 logical key 给 UI 渲染
restorePreviewSecrets(packPath: string): Promise<{ entries: SecretLogicalEntry[] } | null>;

// 用户填完 secrets 后调用，等价 CLI --secrets-json 模式
restoreApplyWithSecrets(packPath: string, opts: {
  prefix?: string;
  renameMap?: Record<string, string>;
  secretsMap: Record<string, string>;
}): Promise<ApplyBackupWithSecretsResult>;
```

`src-tauri/src/lib.rs` 端只是 `run_dch_command` spawn cli 子进程，**不需要变** —— 用 `--secrets-json <tmp-file>` 串通：bridge.ts 把 secretsMap 写到 tempfile → spawn `dch profile restore <pack> --secrets-json <tmpfile> --yes` → 完成后 unlink tempfile（finally 兜底）。

### Step 7. `src/client/components/profile/RestoreBackupModal.tsx` —— UI 4 步流程

现有 3 步（preview → rename conflicts → apply+report）改成 4 步线性，**仅当 manifest 含 `secrets_index` 且 entries 非空**时显示 step 3，旧 pack 自动跳过保持 3 步。

新 step 3「填 K 个 secret」：
- 顶部说明 banner：「{K} unique secrets · {total_occurrences} placeholders will be filled」
- 列表渲染每个 logical key entry：
  - Label：monospace `<logical_key>`（如 `GITLAB_PERSONAL_ACCESS_TOKEN-1`）
  - Sublabel：`{count} occurrences · {hint}` + 可展开列表（默认前 3 个 packPath，N>3 显「+M more」）
  - Input：`type=password` 默认 + 右侧 eye 图标 toggle `type=text`
  - 「Skip this secret」checkbox：勾选后 input disabled + 灰显 + 跳过校验
  - 校验：未勾 skip 且 value 空 → Next 按钮禁用 + 红字 「Enter value or check skip」

UX 反馈（Next 按钮文案 + banner 颜色）：
- 全跳过：黄 banner「All N secrets unfilled — placeholders remain, edit before use」 + Next 文案「Restore with placeholders」
- 部分填：中性「Filling K of N · M skipped」+ Next「Restore」
- 全部填：绿「All N secrets ready」+ Next「Restore with secrets」

apply 阶段调 `restoreApplyWithSecrets`（替代现有 `restoreApply`），report 阶段加显「Filled K secrets · Skipped M」。

### Step 8. 测试

新建 `src/profiles/__tests__/`（如不存在则建）：

- `secrets-index.test.ts`：
  - 同 fieldName 3 个 distinct value → 3 个 idx 升序
  - 同 fieldName + 同 value 跨 5 profile → 1 logical key + count=5
  - `total_occurrences === sum(entries[i].count) === placeholders.length` 不变量
  - fieldPath 寻址：JSON 嵌套对象 / 数组 / TOML dot-path / env.K 三种 case 双向（写 → 读 → 改回 → 写出对称）
- `redact.test.ts` 加 case：valueHash 同输入同 hash、异输入异 hash；wholeFile 不带 valueHash
- `backup.test.ts` 加 case：manifest.secrets_index 完整结构断言
- `backup-restore.test.ts` 加 case：applyBackupWithSecrets 替换准确性 / map 缺 key fallback / unknown key 不 fail

E2E 冒烟（手工或 `tests/e2e/`）：
1. `bun run cli profile backup --keep` → 检查 `~/.dch/backups/dch-backup-*.dchpack` 含 `secrets_index`
2. 准备 `secrets.json` `{ "ANTHROPIC_AUTH_TOKEN-1": "sk-ant-test", ... }`
3. `bun run cli profile restore <pack> --secrets-json secrets.json --prefix smoke- --yes`
4. `grep -r "<<DCH_PLACEHOLDER:" ~/.claude-smoke-default/` 应为空（除整文件 `auth.json` 跳过的）
5. 旧 pack 回归：找一个本次改造前生成的 dchpack（如用户提供的 `~/.dch/backups/latest.dchpack`），restore 走 fall back（输出占位符清单 + 不报错）

### Step 9. `changelog/` + README.md

- 新建 `changelog/CHANGELOG_<X>.md`（X = 当前最大+1，先 `ls changelog/` 找）
- 同步 `changelog/INDEX.md` 加行
- README.md 「核心能力」→「备份与还原」节加新机制描述
- README.md 「CLI 用法」节加 `--fill-secrets` / `--secrets-json` flag

---

## 关键文件路径速查

| 文件 | 改动类型 | 现有行数估算 |
|---|---|---|
| `src/profiles/redact.ts` | 改：hits 加 valueHash | 171（仍 < 500） |
| `src/profiles/secrets-index.ts` | **新建** | 估 200-300 |
| `src/profiles/backup.ts` | 改：createBackup 集成 + readmeText 改造 | 415（接近 500，注意拆分） |
| `src/profiles/backup-restore.ts` | 改：新增 applyBackupWithSecrets | 未读，确认 < 500 |
| `src/profiles/backup-rules.ts` | 不动 | 142 |
| `src/cli-backup.ts` | 改：cmdRestore 加 flag | 260 |
| `src/cli-shared.ts` | 改：加 readStdinSecret() | 未读 |
| `src/bridge.ts` | 改：拆 backup commands 出 bridge-backup.ts | 接近 500 |
| `src/bridge-backup.ts` | **新建**（bridge.ts 拆分） | 估 100 |
| `src/client/components/profile/RestoreBackupModal.tsx` | 改：4 步流程 | 未读 |
| `src-tauri/src/lib.rs` | 不动（命令仍走 run_dch_command） | — |

---

## 复用现有函数（avoid 新造轮子）

- `redact.ts:29-31` `makePlaceholder()` / `redact.ts:33` `PLACEHOLDER_RE` —— 不变
- `redact.ts:45-67` `walkAndRedact()` 递归算法 —— Step 2 fieldPath 寻址写反向时参考
- `backup.ts:28-39` `PLACEHOLDER_HINTS` / `hintFor()` —— SecretsIndex.entries[i].hint 生成时复用
- `backup.ts:200-202` `entryFromHit()` —— hits→PlaceholderEntry 转换器，valueHash 在此环节传递
- `cli-shared.ts` `readStdinLine()` / `parseFlags()` / `jsonOut()` / `info()` / `err()` —— Step 5 直接用
- `cli-backup.ts:143-178` `printRestorePreview()` —— Step 5 加 secrets_index 总览段
- `smol-toml` `parse` / `stringify` —— Step 2 TOML 寻址用同款 lib

---

## 验证（end-to-end）

按 `CLAUDE.md` §验证流程：

```bash
# 1. 单测
bun test src/profiles/__tests__/secrets-index.test.ts
bun test src/profiles/__tests__/redact.test.ts
bun test src/profiles/__tests__/backup.test.ts
bun test src/profiles/__tests__/backup-restore.test.ts

# 2. CLI 端到端冒烟（默认 placeholder 模式）
bun run cli profile backup --keep --out /tmp/smoke.dchpack
bun run cli profile restore /tmp/smoke.dchpack --dry-run                    # 看 secrets_index 总览
echo '{"ANTHROPIC_AUTH_TOKEN-1":"sk-ant-test","GITLAB_PERSONAL_ACCESS_TOKEN-1":"glpat-test"}' > /tmp/secrets.json
bun run cli profile restore /tmp/smoke.dchpack \
  --secrets-json /tmp/secrets.json \
  --prefix smoke- --yes
grep -r "<<DCH_PLACEHOLDER:" ~/.claude-smoke-default/ || echo "✓ no placeholder remains"

# 3. CLI 交互模式（手工验证）
bun run cli profile restore /tmp/smoke.dchpack --fill-secrets --prefix smoke2- --yes

# 4. 旧 pack 回归（使用本次改造前的 ~/.dch/backups/latest.dchpack）
bun run cli profile restore ~/.dch/backups/latest.dchpack --dry-run         # 应走 fall back，输出 148 处清单

# 5. UI 端冒烟（重启 dev 让 Rust 后端重编）
bun run dev                                                                  # 打开 ProfilePanel → 📥 导入备份
                                                                             # 选 /tmp/smoke.dchpack → 走 4 步流程 → 在 step 3 填几个 secret 测试
```

清理：`bun run cli profile remove smoke-claude-default --yes` 等。

---

## 风险 / 已知踩坑

1. **真值绝对不能写 manifest** —— valueHash 仅 backup 内存阶段用作 group key，分配 logical key 后立即丢弃。代码里加 unit test 断言 `JSON.stringify(manifest).includes(rawValue) === false`
2. **整文件敏感跳过 dedup** —— `redactWholeFile()` (`redact.ts:129-135`) 输出的 hits 不带 valueHash，`buildSecretsIndex` 检测 `valueHash === undefined` → 每个独立 logical key（不参与 group），count=1
3. **fieldPath 寻址解析必须与 redact 阶段对称** —— Step 8 单测重点，写一段循环（redact → 取 fieldPath → 反向寻址回原 path → 替换 placeholder → 跑 placeholderCount 应为 0）保证不偏
4. **同一文件同 fieldName 多个不同 value** —— 如某 plugin.json 里两个 Authorization 是不同 token，redact 后两个 placeholder 都是 `<<DCH_PLACEHOLDER:Authorization>>` 看起来一样，但 secrets_index.entries 会分到 `Authorization-1` / `Authorization-2`（不同 hash），各有独立 location.fieldPath；fill 阶段按 fieldPath 精准寻址替换不会串
5. **bridge.ts 接近 500 行护栏** —— Step 6 必须先拆 `bridge-backup.ts`，本次新增 command 落到拆出的新文件
6. **隐藏输入 raw mode 异常退出** —— `setRawMode(true)` 后 process 异常退出会让用户终端 stuck。Step 5 必须 `try/finally` 恢复 `setRawMode(false)` + `process.on("SIGINT")` 兜底
7. **secretsMap 不要 console.log / 不要进 errors[]** —— 一旦泄露到 stdout 等于绕过整个脱敏机制；代码 review 必盯
8. **TOML stringify 丢注释 / 调 section 顺序** —— `redact.ts:99` 注释已说明现状；fill 阶段沿用同款 lib 不引入新 loss
9. **跨 profile 同 fieldName 同值 = 同 token 的假设** —— 99% 场景成立（用户在两个 profile 用同一个 GitLab PAT），万一有偶然碰撞（罕见）合并语义也无害（用户 fill 时填的也是同一个值）

---

## 跨会话准备

按 user CLAUDE.md §复杂 plan 触发条件评估：本改造 ~9 step / 跨 backup+restore / CLI+UI / 单测 + 文档 / 估 ≥ 数百行；可能需要 ≥ 1 整会话。**建议进 worktree** + plan 文件跨会话 hand off。

**动手第一步**（user approve 后）：
1. `EnterWorktree(name: "dch-secrets-dedup-20260514")` 进 worktree
2. 在 worktree 内 `Bash: git rev-parse HEAD` 取 base_commit 回填本 plan frontmatter
3. 把本 plan 文件 `mv` 到 `<dch-repo>/.claude/plans/dch-secrets-dedup-20260514.md`（项目 local 工作目录）+ 加 `.claude/plans/` 到 .gitignore（如未加）
4. 按 Step 1 → Step 2 → Step 3 顺序实施，每完成一个 step 在 plan 内打勾 + commit
5. 每会话末尾更新「当前进度」+「下一会话第一步」

完成后走 user CLAUDE.md §Step 4「完成」5 步收尾（推荐用 `mcp__agent-deck__archive_plan` 一行原子归档）。

---

## 步骤 checklist 与进度

- [x] **Setup** — done by session#1 on 2026-05-14
  - worktree 创建：`/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/dch-secrets-dedup-20260514` (branch `worktree-dch-secrets-dedup-20260514`, base commit `0a136b6`)
  - plan 文件 mv 到 `<dch-repo>/.claude/plans/dch-secrets-dedup-20260514.md`
  - `.gitignore` 加 `.claude/plans/` + `.claude/worktrees/`
  - 未读关键文件行数核实（见顶部说明）
- [x] **Step 1** — `redact.ts` hits 加 `valueHash` — done by session#1 on 2026-05-14, commit `939fd82`
- [x] **Step 2** — 新建 `src/profiles/secrets-index.ts` — done by session#2 on 2026-05-14, commit `2cd1310`
- [x] **Step 3** — `backup.ts` createBackup 集成 secrets_index + readmeText 改造 — done by session#3 on 2026-05-14, commit `2acdb13`
- [x] **Step 4** — `backup-restore.ts` 新增 `applyBackupWithSecrets` — done by session#3 on 2026-05-14, commit `afdb4fb`
- [x] **Step 5** — `cli-backup.ts` cmdRestore 加 `--fill-secrets` / `--secrets-json` flag — done by session#3 on 2026-05-14, commit `522348c`
- [x] **Step 6** — `src/client/bridge.ts` 拆 `bridge-backup.ts` + 新 Tauri command — done by session#4 on 2026-05-14, commit `1dc18b0`
- [x] **Step 7** — `RestoreBackupModal.tsx` UI 4 步流程 — done by session#5 on 2026-05-14, commit `832f734`
- [x] **Step 8** — 单测 + E2E 冒烟 — done by session#6 on 2026-05-14, commit `9bf3fe9`
- [x] **Step 9** — `changelog/CHANGELOG_19.md` + README.md 同步 — done by session#6 on 2026-05-14, commit `eb24ac6`（CHANGELOG_18 名字撞 main REVIEW_8 收口，本 plan 重命名 → 19）
- [x] **Merge** — main REVIEW_8 + Rust 拆模块 8 commit / 11 文件冲突 resolve — done by session#6 on 2026-05-14, commit `7225627`

## 当前进度（session#5 末尾，hand-off 前）

**已完成**：Setup + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7。

**Step 3 改动 detail**（commit `2acdb13`，单文件 `src/profiles/backup.ts` +49/-5）：详 commit message。

**Step 4 改动 detail**（commit `afdb4fb`，2 files +91/-1）：详 commit message。

**Step 5 改动 detail**（commit `522348c`，5 files +284/-35）：
- `cli-shared.ts`（154 → 218 行）：
  - 新加 `readStdinSecret()`：TTY → raw mode 隐藏行；非 TTY → fall back `readStdinLine()`（CI / pipe 兼容）。返回 `string | null`（null = Ctrl+C 中止，让 caller 跑 finally cleanupParsed）
  - try/finally 恢复 raw mode + 移除 SIGINT listener；支持 backspace（^H 0x08 / DEL 0x7f）
  - `VALUE_FLAGS` 加 `secrets-json`（避免 `--secrets-json --foo` 被解析成 boolean）
- `cli-backup.ts`（260 → 418 行）cmdRestore 三分支重构：
  - **flag 校验**：`--fill-secrets ⊕ --secrets-json` 互斥；`--fill-secrets / --secrets-json ⊕ --dry-run` 互斥；`--fill-secrets ⊕ --json` 互斥（json 模式 caller 应改用 --secrets-json 自动化）
  - **A. `--secrets-json <file>`**：`loadSecretsJson` schema 校验（plain object + 所有 value 是 string） → 调 `applyBackupWithSecrets` → 输出统计
  - **B. `--fill-secrets`**：`promptSecretsInteractive` 按 idx.entries 顺序逐个 prompt（label + count + hint + 前 3 个 packPath 预览 + 隐藏输入），ENTER 跳过 / Ctrl+C 中止 → 调 `applyBackupWithSecrets`
  - **C. 都不传**：走原 `applyBackup` + 尾部加 💡 提示让用户知道两个 flag 存在
  - 重构 `printRestoreResult` helper 兼容两种 result 类型（`"secretsApplied" in result` 区分）
  - 重构 `printRestorePreview`（dryRun）：含 `secrets_index` 时显示 32 个 logical key 总览段，旧 pack fall back 原 dump
  - **secretsMap 永不打 stdout**（plan 风险节第 7 条）：日志只用 logical key 名 / count / hint，从不传 value
- `cli-profile.parseFlags.test.ts`：VALUE_FLAGS 大小断言 9 → 10（加 secrets-json）

**Step 5 cross-step regression fix**（同 commit 522348c，附带修 Step 2/4 surface）：
- bug：原 Step 4 的 `applyBackupWithSecrets` 把 `result.placeholders` 直接透传 `manifest.placeholders`（stale），cli 输出「剩余占位符 N 处」永远是原始 148 处不反映 fill 后状态
- 第一次 fix 用 `filledPackPaths: Set<string>` 按 packPath dedup → over-filter（同一文件多个不同 fieldName placeholder 全被一刀切，剩余少 8 处）
- 第二次 fix 用 `filledLocations: Set<string>` 按 `${packPath}|${fieldPath}` 复合 key dedup → 准确 ✓
- backup-restore.ts.applyBackupWithSecrets 用 filledLocations filter `baseResult.placeholders` 让 result.placeholders 反映 fill 后真实状态

**Step 5 已验证**：
- `wc -l` cli-backup.ts=418 / cli-shared.ts=218 / backup-restore.ts=374 / secrets-index.ts=440，全 < 500 ✓
- `bunx tsc --noEmit` exit 0 ✓
- `bun test` 195/195 pass（含 VALUE_FLAGS 大小校验已更新）✓
- 端到端 case 全通：
  - case 1 mutex `--fill-secrets+--secrets-json` exit 1 ✓
  - case 2 `--secrets-json+--dry-run` exit 1 ✓
  - case 3 `--dry-run` 显示 32 个 logical key 总览（不再 dump 148 处）✓
  - case 4 `--secrets-json` 真填：8 处 cross-profile fan-out + **剩余精确 140 = 148 - 8** + unknown ["BOGUS_KEY-99"] ✓
  - case 5/5b/5c bad json（数值 / 非 object / 缺文件）全 exit 1 ✓
  - case 6 不传 flag → 加 💡 提示 ✓
  - case 7 `--json + --fill-secrets` JSON error exit 1 ✓
  - cleanup 20 profile entry + 20 dir 全干净

**未做**：Step 5 单测（loadSecretsJson 校验 + readStdinSecret TTY 模拟难测，留 Step 8 一起做；TTY 行为可能只覆盖非 TTY fall back 路径）。

**Step 6 改动 detail**（commit `1dc18b0`，3 files +281/-97）：

> **plan 偏差（合理）**：plan §Step 6 原文称 "Tauri / Rust 端不需变 —— bridge.ts 把 secretsMap 写到 tempfile"。**不可行**：webview TS 没法 `chmod 0600`，也没办法在 OS tempdir 路径下落盘 + finally unlink（save_file 通用 IPC + 无 delete_file IPC）。换成「加 1 个 Rust command 全包」方案：
> - **理由**：secret 只走一次 IPC 入参，Rust 端管 tempfile 全生命周期 + drop guard 强制清理，比 TS finally 更紧；webview 永远拿不到 tempfile 路径。
> - **代价**：lib.rs +69 行（1 个 async command + 1 个 _blocking helper，复用 run_dch_command_blocking）。

- `src-tauri/src/lib.rs`（570 → 639）：
  - 新加 async Tauri command `run_dch_with_secrets_temp(args, secrets_json, timeout_ms)`：
    1. `std::env::temp_dir().join("dch-secrets-<pid>-<nanos>.json")` 算 tempfile 路径
    2. `OpenOptions::create_new(true).mode(0o600)` 写 secret（unix-only mode；windows fallback 走默认 ACL，单用户 desktop 仍 OK）
    3. `args.push("--secrets-json"); args.push(<tmp_path>);` 后调 `run_dch_command_blocking`
    4. 完成（成功 / 失败都）`std::fs::remove_file(&tmp_path)`，失败仅 eprintln warn 不阻塞 result
  - register 在 invoke_handler! macro 末尾
- `src/client/bridge-backup.ts`（**新建** 192 行）：
  - 把 bridge.ts 的 6 个 backup 方法 (backup/restorePreview/restoreApply/backups/backupRm/backupPin) + 相关 `Manifest` / `AppliedProfile` / `SharedAction` / `PlaceholderEntry` / `ApplyBackupResult` / `BackupSummary` / `BackupManifestSummary` / `PinBackupResult` re-export 全搬过来
  - 加 secrets-dedup 新 surface：
    * `RestoreApplyWithSecretsOpts` extends `RestoreApplyOpts` 加 `secretsMap: Record<string, string>`
    * `RestoreApplyWithSecretsResponse` = `{ ok, manifest, ...ApplyBackupWithSecretsResult }` 与 cli `--secrets-json` JSON 输出对齐
    * `RestorePreviewSecretsResult` = `{ entries: SecretLogicalEntry[] }`
    * 新 type re-export: `SecretLogicalEntry` / `SecretLocation` / `SecretsIndex` / `ApplyBackupWithSecretsResult`
  - 新方法落 `dchBackup` 对象：
    * `restorePreviewSecrets(packFile)`：复用 `restorePreview` 结果 flatten 出 `entries | null`，**不**触发新 IPC（旧 dchpack 无 secrets_index 或 entries=0 → null）
    * `restoreApplyWithSecrets(packFile, opts)`：直接 `invoke<DchCommandResult>("run_dch_with_secrets_temp", { args, secretsJson, timeoutMs })` —— args 完整传 `["profile", "restore", packFile, "--yes", "--json", ...]`，secret 走 `JSON.stringify(opts.secretsMap)` 字符串化
- `src/client/bridge.ts`（413 → 336）：
  - export `runDch` / `TIMEOUT_FAST_MS` / `TIMEOUT_INIT_MS` / `TIMEOUT_BACKUP_MS` / `DchCommandResult` 让 bridge-backup 复用
  - 删 backup 类型 import（搬到 bridge-backup）
  - `dchProfileMethods` private const + `export const dchProfile = { ...dchProfileMethods, ...dchBackup }` spread 让 caller 调 `dchProfile.backup(...)` 完全不变
  - `export * from "./bridge-backup.ts"` 透传所有 backup 类型 + `dchBackup` 对象，caller import 路径不动

**Step 6 已验证**：
- `wc -l` bridge.ts=336 / bridge-backup.ts=192 / lib.rs=639 全 < 800 ✓
- `bunx tsc --noEmit` exit 0 ✓
- `bun test` 195/195 pass ✓
- `cargo check` + `cargo build --quiet` 全 exit 0 ✓
- Tauri 2 camelCase ↔ snake_case 自动转换确认：TS `{secretsJson, timeoutMs}` ↔ Rust `(secrets_json: String, timeout_ms: Option<u64>)` —— 已对照 `runDch(timeoutMs)` ↔ `run_dch_command(timeout_ms)` 现成例子
- 没现 caller 用新 commands（Step 7 才会接入），所以**手工 UI 冒烟 deferred to Step 7**：现有 `dchProfile.backup/restoreApply/...` 通过 spread 透传保持不变（typecheck + 现有测试覆盖），新 `restoreApplyWithSecrets` 真触发要等 RestoreBackupModal step 3 加完

**未做**：Step 6 单测（mock invoke 验 restoreApplyWithSecrets / restorePreviewSecrets 路径）—— 同 Step 5，留 Step 8 一起做。

**Step 7 改动 detail**（commit `832f734`，2 files +368/-23）：

- `src/client/components/profile/RestoreSecretsBody.tsx`（**新建** 237 行）：
  - `RestoreSecretsBody` 主组件：渲染 K 个 `SecretEntryRow` + 顶部 banner + section title
  - `SecretEntryRow` 子组件：每个 logical key 一行 — monospace label + count + hint + password input（type=password 默认） + eye icon button toggle reveal（type=text）+「跳过」checkbox + details 折叠 N 个 packPath 出现位置（默认前 3，>3 显「+M more」可点 details summary 展开全部）
  - 校验：`empty = !skipped && value.length === 0` → input 红边 + 下方红字「请填值或勾选『跳过』」
  - `computeBanner` 4 态：全跳过（黄）/ 全填（绿）/ 部分填部分跳无 pending（中性）/ 有 pending（蓝）
  - `computeSecretsButton` derived：`{ label, hasError }` 喂给 caller 当 footer 主按钮文案 + disable 判定
  - 安全：input value 仅通过 `onValueChange` callback 上传 caller，组件本身**不**写 console / localStorage / 任何旁路
- `src/client/components/profile/RestoreBackupModal.tsx`（363 → 471 行，仍 < 500）：
  - 新增 import：`SecretLogicalEntry` / `ApplyBackupWithSecretsResult` / `RestoreSecretsBody` / `computeSecretsButton` / `SecretsState`
  - 新 state：`secretEntries` (null = 跳过 step 3) / `secretsState` / `phase: "rename" | "secrets"`
  - `result` 类型扩展：`ApplyBackupResult | (ApplyBackupWithSecretsResult & { manifest: Manifest }) | null`
  - `onPreview` 直接从 `r.manifest.secrets_index?.entries` 提 entries（不做 second IPC，复用 dry-run preview 结果），entries 空 / 无 → setSecretEntries(null)，自动跳过 step 3
  - `onApply` 三分支：
    * `phase === "rename" && hasSecrets` → setPhase("secrets") **仅切 step 不调 IPC**（用户可来回 ← 上一步）
    * `phase === "rename"` → 原 `dchProfile.restoreApply` 不变（旧 pack / 新 pack 但 entries 空 fall back 路径）
    * `phase === "secrets"` → `dchProfile.restoreApplyWithSecrets`（filledMap 跳过 user-skip 项 + 跳过空值，让 CLI 走 user-skip 语义）
  - `hasError` 按 phase 分流：rename phase 用 `renameHasError` / secrets phase 用 `secretsButton.hasError`
  - footer：加「← 上一步」按钮（仅 secrets phase 显示，state 保留），主按钮文案随 phase 变（「下一步：填 K 个 secret」/「确认还原」/`secretsButton.label`）
  - `RestorePreviewBody` 接 `hasSecretsHint` prop（> 0 时 step 2 顶部加蓝 banner 预告下一步要填几个 secret）
  - `RestoreReportBody` 加 `secretsMetrics?` optional prop：result 是 `ApplyBackupWithSecretsResult` 时（用 `"secretsApplied" in result` 判断）显示「填值 N 处 · 跳过 M 个 logical key · 未知 K 个」绿/灰行
  - 重 preview 时自动重置 secretsState + setPhase("rename")（避免残留旧值）

**Step 7 已验证**：
- `wc -l` RestoreBackupModal.tsx=471 / RestoreSecretsBody.tsx=237，全 < 500 ✓
- `bunx tsc --noEmit` exit 0 ✓
- `bun test` 195/195 pass ✓
- **手工 UI 冒烟 deferred to user**：本会话 agent 没法模拟点击；Step 8 user 跑 `zsh -i -l -c "bun run dev"` 实测 4 步流程（具体 case 见「下一会话第一步」节）
- Tauri `cargo check` 不需重跑（Step 7 没动 Rust）；TS bundler 在 dev start 时验证

**未做**：Step 7 单测（React component test 难做且 4-step state machine 主要靠手工 e2e 验，留 Step 8 一起评估，可能直接靠 e2e）。

## 下一会话第一步（session#6 cold start，Phase: Step 8 + Step 9 合并 — 用户 session#5 末批准 Step 8/9 同一会话收口）

> **用户决策（session#5 末）**：Step 8 单测 + Step 9 CHANGELOG/README **同一会话完成 + 整 plan 收口归档**，避免再多起一个会话。手工 UI 冒烟由用户在 session#6 内并行做 + 反馈给 agent。

1. `Bash: cat /Users/apple/Repository/personal/dev-config-hub/.claude/plans/dch-secrets-dedup-20260514.md` 全文复习 plan
2. `EnterWorktree(path: "/Users/apple/Repository/personal/dev-config-hub/.claude/worktrees/dch-secrets-dedup-20260514")` 进 worktree
3. 自检：`Bash: git log --oneline -8` 应看到 HEAD = `832f734`「feat(ui): RestoreBackupModal 4-step flow with secrets fill」（base_commit `0a136b6` 之后七条：`939fd82` Step 1 → `2cd1310` Step 2 → `2acdb13` Step 3 → `afdb4fb` Step 4 → `522348c` Step 5 → `1dc18b0` Step 6 → `832f734` Step 7）
4. （可选自检）`zsh -i -l -c "bun test 2>&1 | tail -5"` 仍 195/195 pass
5. 进 **Step 8 — 单测 + E2E + 手工 UI 冒烟**：

   **Sub-step 8a. 单测**（按 plan §Step 8 列表 + 累积已 deferred 项）：
   - 新建 `src/profiles/__tests__/`（如不存在则建）：
     * `secrets-index.test.ts`：dedup 算法 + fieldPath 寻址（JSON / TOML / env 三种 case 双向 redact → 寻址 → 改回 → stringify 对称）
     * `redact.test.ts` 加 case：valueHash 同输入同 hash / 异输入异 hash / wholeFile 不带 valueHash
     * `backup.test.ts` 加 case：manifest.secrets_index 完整结构断言（含 `total_occurrences === sum(entries[i].count) === placeholders.length` 不变量 + manifest 不含 valueHash 真值断言）
     * `backup-restore.test.ts` 加 case：`applyBackupWithSecrets` 替换准确性 / map 缺 key fallback / unknown key 不 fail / `result.placeholders` filter 准确性（fan-out 后 stale data fix 验证）
   - **session#3 已 deferred Step 5 单测**：`loadSecretsJson` schema 校验 / `readStdinSecret()` 非 TTY fall back 路径
   - **session#4 已 deferred Step 6 单测**：mock `invoke` 验 `restoreApplyWithSecrets` / `restorePreviewSecrets` IPC 路径（用 `vi.mock` / 等价 bun test mock）
   - **session#5 deferred Step 7 单测**：React component test 评估能否做（state machine 4 phase 切换 / footer 按钮文案 / banner 颜色），如成本太高直接靠手工 e2e

   **Sub-step 8b. CLI E2E 冒烟**（按 plan §验证清单）：
   ```bash
   # 1. 默认 placeholder 模式 backup
   bun run cli profile backup --keep --out /tmp/smoke.dchpack
   # 2. dry-run 看 secrets_index 总览
   bun run cli profile restore /tmp/smoke.dchpack --dry-run
   # 3. --secrets-json 自动化
   echo '{"ANTHROPIC_AUTH_TOKEN-1":"sk-ant-test"}' > /tmp/secrets.json
   bun run cli profile restore /tmp/smoke.dchpack --secrets-json /tmp/secrets.json --prefix smoke- --yes
   grep -r "<<DCH_PLACEHOLDER:" ~/.claude-smoke-default/ || echo "✓ no placeholder remains"
   # 4. --fill-secrets 交互（手工验证）
   bun run cli profile restore /tmp/smoke.dchpack --fill-secrets --prefix smoke2- --yes
   # 5. 旧 pack 回归（找一个 step 1 之前生成的 dchpack；本次 Step 5 case 已部分覆盖）
   bun run cli profile restore ~/.dch/backups/some-old.dchpack --dry-run
   # 6. cleanup: bun run cli profile remove smoke-claude-default --yes 等
   ```

   **Sub-step 8c. 手工 UI 冒烟**（**必跑** —— Step 7 deferred 的核心验证）：
   ```bash
   zsh -i -l -c "bun run dev"   # 启 Tauri dev（Rust 已变 Step 6，第一次 build 慢；TS HMR 后续秒级）
   # 打开 Dev Config Hub → ProfilePanel → 📥 导入备份 → 选 ~/.dch/backups/latest.dchpack
   # 走 4 步流程，逐 case 验证：
   #   case A. 旧 pack（无 secrets_index）→ step 3 跳过保 3 步流程 ✓
   #   case B. 新 pack 全跳过 → step 2 顶部蓝 banner「将填 K 个」/ step 3 全勾「跳过」/ banner 黄色
   #          / 主按钮「保留占位符还原」→ Restore → grep 占位符 == 原始 N 处（fall back，但实际仍走
   #          restoreApplyWithSecrets({ secretsMap: {} }) 让所有 logical key 进 secretsSkipped）
   #   case C. 新 pack 部分填 → 部分 input 填值 / 部分勾跳过 / banner 中性 / 主按钮「还原（K 填 / M 跳过）」
   #          → Restore → grep 占位符 == 原始 - filled fan-out 总数 / report 显示「填值 N 处」
   #   case D. 新 pack 全填 → banner 绿 / 主按钮「填值还原」→ Restore → grep 占位符 == 0（除整文件 auth.json 跳 dedup 的）
   #   case E. step 3 在「← 上一步」回到 step 2 改 renameMap 再 next → secretsState 保留（用户已填的不丢）
   #   case F. eye icon toggle reveal / hide 切换 type=text ↔ type=password
   #   case G. 「跳过」勾选后 input disabled + 灰显 + 取消校验
   #   case H. details 折叠默认显示前 3 个 packPath，>3 时点 details summary 展开全部
   ```
   预期：以上 8 个 case 全通；任一不通走 fix → re-commit → 再验。

6. 验证收尾：
   - `bun test` 加新单测后总数应 > 195（按新单测数加）
   - `bunx tsc --noEmit` exit 0
   - 文件行数：所有 < 500（新单测放 `__tests__/` 下，单文件可放宽到 800）
7. Step 8 完成 → commit「test(secrets-dedup): unit tests + E2E smoke for backup/restore + UI 4-step」（如改了 fix bug 也包进去）→ plan checklist 标 Step 8 + 进 Step 9
8. 进 **Step 9** — 写 `changelog/CHANGELOG_18.md` + 同步 `changelog/INDEX.md` + README.md「核心能力 → 备份与还原」节加新机制描述 + 「CLI 用法」节加 `--fill-secrets` / `--secrets-json` flag。commit「docs(changelog): CHANGELOG_18 dch-secrets-dedup + README 同步」→ Step 9 完成 → 整 plan 完成 → 走 user CLAUDE.md §Step 4 收尾（推荐 `mcp__agent-deck__archive_plan` 一行原子归档）。


## 已知踩坑（session#1+#2+#3+#4 累积 + Step 6 新增）

- **EnterWorktree 工具要求 process cwd 在 git repo 内** —— session#1 cwd 是 `/Users/apple/Repository/personal`（非 git repo），导致 `EnterWorktree(path:)` 直接 reject。session#2/#3/#4 通过 hand_off_session plan-driven mode default cwd = mainRepo (`/Users/apple/Repository/personal/dev-config-hub`)，**就是 git repo 根**，EnterWorktree 立刻可用
- **`zsh -i -l` GVM 错只在某些 cwd 下出现**（session#1 在非 git repo 时撞 `ERROR: GVM_ROOT not set` exit 1 → bun 没 spawn；session#2/#3/#4 在 worktree cwd 内跑 `zsh -i -l -c "bun test ..."` 完全正常）。结论：worktree cwd 下放心用 `zsh -i -l`，仅当 cwd 在异常位置时才需绕道 `~/.bun/bin/bun`
- **plan 文件位置**：写在主 repo 的 `.claude/plans/<plan-id>.md`（已 gitignore 不入项目 git），不写到 worktree working tree（worktree 是独立 branch，main 看不到）
- **临时 ad-hoc 冒烟脚本**：放 worktree 根 `.tmp-*.ts` 跑完即删；如果用 `bun run /dev/stdin <<EOF` 走 stdin import 路径解析会出错（cwd 不识别），落实文件再跑可避坑
- **【Step 5 新踩】fan-out 后 result.placeholders 必须 filter**：原始 manifest.placeholders 是 1-to-N 平铺（每处独立 entry），fill 后透传不动等于 stale 数据，cli 输出「剩余占位符 N 处」永远报 148 不变。filter 用复合 key `${packPath}|${fieldPath}`（仅 packPath 会 over-filter，因为同一文件可能藏多个不同 fieldName 的 sensitive key，每个独立 placeholder）。**通用教训：fan-out 类操作输出别忘了同步抹掉已处理项**
- **【Step 6 新踩】plan 假定与现实差距 → 走「合理偏差」**：plan §Step 6 原文「Tauri / Rust 端不需变 —— bridge.ts 把 secretsMap 写到 tempfile」实测**不可行**（webview TS 没 chmod / 没 delete_file IPC / save_file 在 tempdir 路径下不报错但留垃圾文件）。处理：加 1 个 Rust command 全包 tempfile 生命周期，比强行用现有 IPC 拼凑更小风险面（secret 只走一次入参 + Rust drop guard）。**通用教训：plan「不动 X」的假设要在动手前 reality-check 当前 IPC surface 是否够用，发现差距时把 plan 当指引而非死规则**
- **【Step 6 新踩】Tauri 2 camelCase ↔ snake_case 自动转换是默认行为**：JS 传 `{secretsJson, timeoutMs}` Rust fn 参数名直接写 `secrets_json: String, timeout_ms: Option<u64>`，serde 自动 deserialize。无需在 fn 上加 `#[tauri::command(rename_all = "...")]`。对照已有 `runDch(timeoutMs)` ↔ `run_dch_command(timeout_ms)` 例证
- **【Step 6 新踩】bridge.ts 用 spread 合 dchBackup 对象**：`export const dchProfile = { ...dchProfileMethods, ...dchBackup }` 让 caller `dchProfile.backup(...)` 不变；`export *` 自动透传 backup 类型 re-export 让 caller import 路径不变。比改 caller 省事，且不留破坏性 API surface
- **【Step 6 新踩】Edit 工具 old_string 全角 vs 半角微差异致 match fail**：bridge.ts 注释里有 `（强制 yes，避免脚本误用泄露）` 全角括号，第一次 Edit 写成半角 `)` → "String to replace not found"。**经验**：大块 Edit 失败时先 Read 出实际 bytes 对比再重试，或直接拆小 chunk 走多次小 Edit

