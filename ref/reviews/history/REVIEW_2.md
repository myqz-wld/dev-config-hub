---
review_id: 2
reviewed_at: 2026-05-04
expired: false
heterogeneous_dual_completed: true
skipped_expired: []
---

# REVIEW_2: 全维度首次 deep code review（架构 / bug / 安全 / 性能 / 测试盲区）

> 与 [REVIEW_1](REVIEW_1.md)（跨平台 Windows 支持）独立并行。本轮聚焦 macOS 现网代码的综合质量，不涉及跨平台维度（已被 REVIEW_1 覆盖）。

## 触发场景

用户主动「看看架构/代码上有没有什么优化空间」。仓库迭代过 5 轮（CHANGELOG_1..5）但从未做过综合维度的正式 review，趁此机会全量打底，后续按文件级过期机制（`~/.claude/CLAUDE.md`「已审文件过期」节）增量推进。

REVIEW_1 同期落地了 Win 支持基础（CHANGELOG_6 已合）。本轮在写 review 期间 fix 推进暂停，等用户后续指示再统一推 PR。

## 方法

**双对抗配对**（见 `~/.claude/CLAUDE.md`「决策对抗」节 + `agent-deck:deep-code-review` skill）：

- **Agent A — `reviewer-claude`**（Claude Opus 4.7 xhigh，teammate context 跨轮持久化）
- **Agent B — `reviewer-codex`**（外部 Codex CLI gpt-5.5 xhigh wrapper，每轮新 codex 进程但 wrapper session 复用）

**节奏**：3 轮 review + 1 轮反驳轮；teammate context 跨轮复用，reviewer 不重读已读文件。

| Round | focus | 双方 finding 数 |
|---|---|---|
| 1 | 浅层正确性：bug / API 误用 / null & undefined / 测试质量 | codex 7 + claude 17 |
| 1 反驳轮 | 单方独有 HIGH（codex H2 ConfigPanel onSave fire-and-forget）→ sendMessage reviewer-claude 反驳 | claude ✅ 同意，HIGH 升级 |
| 2 | 边界 / 并发 race / 资源 lifecycle / 状态机边角 / Rust↔TS 边界 / schema 演化 | codex 10 + claude 14 + 2 条 R1 修正 |
| 3 | 架构耦合 / 安全 / 性能尾延迟 / 错误可观测性 / 测试 ROI / 文档漂移 | codex 7 + claude 12 |

**范围**：全量 25 文件 / 2712 LOC（首次综合 review，无历史豁免；与 REVIEW_1 scope 有重叠但 focus 维度互补）。

```text
src-tauri/        # Rust 后端：lib.rs（Tauri commands + run_dch_command）/ main.rs
src/cli*.ts       # CLI 入口：cli.ts / cli-profile.ts / cli-colors.ts / utils.ts / descriptions.ts / types.ts
src/profiles/     # Profile 系统命脉：manager / store / symlink / hooks / hooks.test / defaults / types
src/readers/      # 4 个工具配置 reader：claude-code / codex / opencode / shell
src/client/       # 前端 React/Tauri：App / main / bridge / dev-server / components/{ConfigPanel,ProfilePanel}
```

**机器可读范围**（File-level Review Expiry 用，按字典序）：

```review-scope
src-tauri/src/lib.rs
src-tauri/src/main.rs
src/cli-colors.ts
src/cli-profile.ts
src/cli.ts
src/client/App.tsx
src/client/bridge.ts
src/client/components/ConfigPanel.tsx
src/client/components/ProfilePanel.tsx
src/client/dev-server.ts
src/client/main.tsx
src/descriptions.ts
src/profiles/defaults.ts
src/profiles/hooks.test.ts
src/profiles/hooks.ts
src/profiles/manager.ts
src/profiles/store.ts
src/profiles/symlink.ts
src/profiles/types.ts
src/readers/claude-code.ts
src/readers/codex.ts
src/readers/opencode.ts
src/readers/shell.ts
src/types.ts
src/utils.ts
```

> 本文件首次加入 git 的 commit 视为该批文件覆盖基线；后续如某文件触发过期阈值（churn ≥ 200 行 / 30%、commits ≥ 3、≥ 90 天），下轮 review 必重新纳入。注意：CHANGELOG_6 跨平台 fix 改了多处文件，REVIEW_2 落 git 后这部分已自动算「最新覆盖基线」。

**约束**：
- skip CLAUDE.md「已踩坑」4 项（env 模式 / dch profile env shellQuote / window.confirm / 表单分步）— 仅看回归
- skip Round N+1 已收纳的 finding，避免重复
- HIGH/MED 必须实证或代码 path 完整推导；纯文本推理结论强制 ❓ 降级
- 弱断言关键词（"可能 / 也许 / 看起来 / 应该 / 大概"）只允许出现在 *未验证* 条目里

---

## 三态裁决结果

> 验证纪律遵循全局「决策对抗」：每条 ✅ 必须带验证手段。`r-claude` / `r-codex` 列填验证手段或 "—"。
> ⚠️ 本 review finding 基于 review 启动时（02:30 UTC）的代码快照；CHANGELOG_6 跨平台 fix 在 11:44 落地，可能已影响以下条目（特别是 `lib.rs` / `symlink.ts` / `cli.ts` / `hooks.ts` 行号定位）。fix 推进前需要按现网代码重新对位行号。

### ✅ HIGH（3 条 — 必修）

| # | 严重度 | 文件:行号 | 问题 | r-claude | r-codex | 验证手段 |
|---|---|---|---|---|---|---|
| H1 | HIGH | `src/profiles/hooks.ts:39-54` | `runHook` timeout 不 enforce — hook 脚本 detach 子进程（`(sleep 10 &)` / `nohup`）持 stdout pipe → `new Response(proc.stdout).text()` 永不 resolve → 整个 useProfile 卡死 N 秒 | 实测 timeout=5s 实际 10010ms 卡死，exitCode=0，stdout 拿到 `"immediate\n"` | 推理（标 MED） | claude `bun -e` 复现 detach 子进程场景 |
| H2 | HIGH | `src/client/components/ConfigPanel.tsx:70` | 编辑保存 `onClick={() => { onSave(...); setMode("view"); }}` fire-and-forget + 同步 setMode；保存失败 App.tsx 不 reload，Scope key 稳定 buf 留 state 但用户拿不到，再点「编辑」`setBuf(scope.content)` 覆盖 → 数据不可恢复 | 反驳轮 8 步证据链 ✅ 同意（含 lib.rs `save_file` Err 真实分支） | 提出 + 标 HIGH | grep `setBuf` 调用点 + 读 ConfigPanel.tsx:39-86 / App.tsx:43-46 / lib.rs:16-23 |
| H3 | HIGH | `src/profiles/store.ts:33-58` + manager 7 处写操作 | 多进程并发 `loadStore → mutate → saveStore` 三步无锁 → lost update。manager.{add,remove,update,useProfile,initTool,setPreference}Profile 全无锁 | spawn 5 child 各跑 push → save，初始 1 期望 6 实际 **2**（4 个 push 丢） | 提 R2-H1（标 HIGH，代码 path） | claude bun -e 5 child 实测；codex grep manager 写操作 |

### ✅ MED（13 条 — 必修）

**正确性 / 错误信息回路** (4)

| # | 文件:行号 | 问题 | 验证 |
|---|---|---|---|
| M1 | `src/client/bridge.ts:135` | `parsed.error ?? r.stderr.trim() ?? \`exit ${r.code}\`` — `trim()` 永远返回 string，第 3 段 fallback 永不触发；CLI fail 走 JSON_MODE `err()` 时 stderr 空 → UI toast 显示空字符串 | 双方独立 `bun -e` 实测，msg 长度 0 |
| M2 | `src/cli-profile.ts:127-129 + :146` | `cmdAdd --from <id>` 时 `base = { tool, configDir, env, hooks }` 漏 `description` → `base.description` 永远 undefined → clone 出来的 profile 描述永远丢失 | claude `bun -e` mock 实测 |
| M3 | `src/cli-profile.ts:169-179` | `cmdRemove` 二次确认只监听 `stdin.on("data")`，不监听 `end` → Ctrl+D（EOF 无换行）promise 永不 resolve，dch 进程 hang 必须 Ctrl+C | claude 代码 path 推导 + lead 复读 |
| M11 | `src/client/components/ProfilePanel.tsx:80-93` | `onUse` 失败只 `throw new Error(r.message)` → toast 仅显示「preSwitch hook 失败 (exit 2)」；`r.hooks[].stdout/stderr` 完整诊断信息丢失 — UI 用户调试无门 | 双方一致；对比 cli-profile.cmdUse fmtHookResult 完整打印路径 |

**状态机 / race / 一致性** (5)

| # | 文件:行号 | 问题 | 验证 |
|---|---|---|---|
| M4 | `src/profiles/manager.ts:73-75` | `useProfile` 先 `switchSymlink`（磁盘已切）再 `saveStore`；后者失败时 symlink 指向新 dir 但 `~/.dch/profiles.json` `active` 仍旧值，`current` 命令显示矛盾，无自愈 | codex 提 + lead 复读 catch 分支只 return message 未回滚 |
| M7 | `src/client/App.tsx:23-27` + `ProfilePanel.tsx:45-56` | 两处 `loadAllConfigs / Promise.all([list, current])` 不保序；快连点切换 + 保存触发并发 reload，旧请求晚返时旧覆盖新 → UI state 与 backend 不一致需 F5 | claude 实测 mock load #1(500ms) + #2(50ms)，setTools 顺序 #2 → #1 |
| M8 | `src/profiles/symlink.ts:107-113` | `${target}.dch-switch-${Date.now()}` symlink + rename 之间被 SIGKILL/panic → tmp symlink 残留累积，无启动清理。⚠️ REVIEW_1 B11 已就 EXDEV 兜底改了 switchSymlink 行号附近代码，复核时按现网定位 | 阅读 path；rename 是原子但 symlink + rename 之间无保护 |
| M9 | `src/profiles/manager.ts:91-108` | `initTool` 重复 init 时已存在 profile 不更新 `configDir` → 用户手动改 symlink 后再 init，`active` 指 `claude-default`(configDir=旧) 但 symlink 指新 dir，`getActive` 返回不一致 | codex 代码 path（R2-M4）；claude 也提 saveStore 失败孤儿 symlink 同子流程 |
| M12 | `src/client/bridge.ts:14-18` | `file_exists` + `read_file` 双 IPC TOCTOU；之间 profile 切换 / 删除 → `read_file` Err → `loadAllConfigs` 无 catch → App 「加载失败」 | 双方一致；阅读 readFile / readJsonScope 无 catch 路径 |

**安全 / 平台** (3)

| # | 文件:行号 | 问题 | 验证 |
|---|---|---|---|
| M5 | `ProfilePanel.tsx:619-630` + `cli-profile.ts:53,130-133` | UI 加 env 时 + CLI envPairs 透传都不校验 KEY；非法 key（如 `MY KEY` / `1FOO` / `K-K`）落盘 profile.env，hook 子进程能拿到，但 `dch profile env` wrapper 模式 ENV_KEY_RE 跳过 → 静默丢失，难调试 | grep ENV_KEY_RE 仅 cmdEnv 一处使用；双方独立提出 |
| M10 | `src-tauri/src/lib.rs:6-8` | `fs::read_to_string` 严格 UTF-8 → 用户 ~/.zshrc 用 GBK / Latin-1 写注释（亚洲开发者偶见混用）→ `loadAllConfigs` reject → App 「加载失败」整个 UI 挂；CLI 用 `Bun.file.text()` 是 lossy 不挂，UI 比 CLI 脆。⚠️ CHANGELOG_6 改过 lib.rs 文件结构，需按现网定位 | claude 写 4 字节 invalid UTF-8 实测对比 Bun vs Rust 行为 |
| M13 | `src-tauri/src/lib.rs:134-137` | `Command::output()` 阻塞调用无 Tauri 侧超时；CLI hook 因 H1 卡 30s 时该 Tokio blocking 线程占用 30s，UI `dchProfile.testHook()` 永远 pending | 阅读 lib.rs:90-144 + bridge runDch 路径 |

**架构 / 文档 / 性能 / 攻击面** (4)

| # | 文件:行号 | 问题 | 验证 |
|---|---|---|---|
| C1 | `ProfilePanel.tsx:188-235` vs `cli-profile.ts:119-154` | UI add 走 `dchProfile.add` + `writeProfileConfigFile` 写主配置；CLI add 只写 ~/.dch/profiles.json **不创建 configDir / 不写 settings.json** → 同概念两个入口给两种结果 README 没说 | grep `writeProfileConfigFile / generateMinimalConfig / tomlBasicString` 全在 ProfilePanel.tsx |
| C3 | `src-tauri/src/lib.rs:90-144` + `bridge.ts:130-138` | UI 路径 `zsh -c "source rc; bun cli"` 平均 **401ms**（vs 直接 bun 21ms）；每次 UI action = action + reload(list+current) = 3 个 bun 子进程 → 体感 ~1.3s | claude 实测 5 次：576/351/356/351/371ms |
| C5 | `README.md:179` + `cli-profile.ts:234,255` | README 「无 shell 注入风险」过强；ENV_KEY_RE 校验**只在** `dch profile env <tool>` 输出处跑；hook 子进程注入 + profiles.json 落盘都无校验 | grep ENV_KEY_RE 全仓 2 处 |
| C6 | `src/profiles/hooks.ts:10-26` | `buildEnv` 全量 inherit `process.env`（含 ANTHROPIC_API_KEY / GITHUB_TOKEN / AWS_*）暴露给 hook 子进程；`profile.env` 允许覆盖 PATH / LD_PRELOAD / DYLD_INSERT_LIBRARIES / BASH_ENV → 任何能改 profiles.json 的进程（含被 H3 lost-update 利用）能注入任意命令；CLAUDE.md / README 缺攻击面警告 | 双方一致（claude C6 + codex R3-L3）；阅读 buildEnv path |

### ✅ LOW / INFO（约 30 条 — 选修）

体验改进、双源死代码、极低概率边角、文档漂移。代表项（按文件分组）：

**cli / utils 维度**
- `src/cli.ts:172` `~` 替换不严谨 + `src/utils.ts:6` `expandHome` 死代码（与 store.ts 双源）— ⚠️ REVIEW_1 B4/B8 已就 path 抽 platform.ts 改了，按现网复核
- `src/utils.ts:20-33` `getToolVersion` 无超时（buggy CLI 自身 hang 时 dch 启动卡住；非 stderr pipe 满，已实证证伪 = false alarm）
- `src/cli.ts:137` `dch gui` 也跑 4 个 version subprocess 浪费 200-500ms 启动延迟
- `src/cli.ts:151` `bunx tauri dev` cwd 假设 dev 运行
- `src/cli.ts / src/cli-profile.ts` 大量 `console.log + process.exit` 模式 — 难单元测试 cmd 函数
- `src/cli-profile.ts:14` `JSON_MODE` 模块级状态进程内不 reset（影响未来 daemon 模式）
- `src/cli-profile.ts:43-52` `--env` 不带值静默吞为 `flags.env=true`
- `src/cli-profile.ts:171-178` `cmdRemove` `process.stdin.on("data")` listener 不 removeAllListeners
- `src/cli-profile.ts:235-237` `cmdEnv` shellQuote 不过滤 NUL byte
- `src/cli-profile.ts:286-297` `cmdConfig` framework 层 invariant 缺（未来加新交互命令易踩）
- `src/cli-profile.ts:296` `cmdConfig` JSON `value` 类型字串化

**client / UI 维度**
- `src/client/components/ConfigPanel.tsx:80` React 外层 `cat` map 缺 key
- `src/client/main.tsx:5-11` unhandledrejection `innerHTML` 注入（本地 Tauri 影响小但写法不好）
- `src/client/components/ProfilePanel.tsx` 单文件 764 行容纳 5 组件 + 4 helper，长期演化阻碍（C4）
- `src/client/components/ProfilePanel.tsx` `onSubmit` 双击竞态（`getHomeDir` 不受 busy 保护）
- `src/client/components/ProfilePanel.tsx:752-758` PreferencesEditor uncontrolled `defaultValue`
- `src/client/bridge.ts:36-46` `readProfileConfigFile` 每次 IPC `get_home_dir` 不 cache
- `src/client/bridge.ts:147-176` vs `src/cli-profile.ts:119-154` Bridge/CLI 契约非类型化字符串，flag 改名 / 漏加 / 顺序错都静默 fail

**profiles / store / hooks 维度**
- `src/profiles/symlink.ts:107` tmp 名 ms 精度并发 EEXIST 极低概率
- `src/profiles/hooks.ts:47` `proc.kill()` 默认 SIGTERM 被 trap 屏蔽（与 H1 一并修）
- `src/profiles/hooks.test.ts:72-76` test pollution（开发者 shell `export DCH_SWITCH_FROM=foo` 让 test 失败）
- `src/profiles/store.ts:33-43` corrupt JSON 无 recovery 路径（`dch profile reset/repair` 缺）
- `src/profiles/store.ts:14-19` schema versioning 缺位（`version: 1` 硬编码不验证 / 无 migration 入口）
- `src/profiles/store.ts:50` `hookTimeoutMs=0` 透传不校验下界（CLI 校验 `n > 0`，loadStore 不校验 → 手动写 0 让所有 hook 立即超时）
- `src/profiles/store.ts:55-57` `profiles.json` 创建为 0644 → 同机其他用户读 env 中的 API Key
- `src/profiles/manager.ts:33-39` `updateProfile` 死代码（R3-L1 提示 M9 修复直接可调用）

**Tauri / 资源 维度**
- `src-tauri/src/lib.rs:74-77` `get_home_dir` HOME 未设返 `""` → 路径静默变根路径前缀（⚠️ CHANGELOG_6 已改 lib.rs，按现网复核）
- `src-tauri/Cargo.toml:15` + `src-tauri/src/lib.rs:149` `tauri-plugin-shell` 引入但未用，bundle 增 100-300KB

**readers / 重复**
- `src/readers/*.ts` 4 个文件 `jsonToEntries / tomlToEntries` 重复 3 处

**文档漂移**
- `CLAUDE.md:103` `DCH_SWITCH_FROM` 文档「可能为空」vs 实现 unset，bash `[ -v ]` 行为不同
- `README.md:92` `dch profile edit <id>` id 参数未使用（实际打开整个 profiles.json）
- `README.md` wrapper 模式每次 claude/codex 启动多 ~400ms 尾延迟（dch profile env 无 cache）
- README L156 描述 symlink 切换严密 atomic 但实际可能留 `${target}.dch-switch-{ts}` 孤儿（与 M8 联动）
- 文档缺 `examples/hooks/` 示例脚本（CHANGELOG_4 提到 `ensure-proxy.sh` 仓库无对应模板）

### ❌ 反驳 / 实证证伪（已核实，不修）

| 报告方 | 报项 | 反驳依据 |
|---|---|---|
| codex R1 | `Math.max(...[])` padEnd 边界（claude 提到测） | claude `bun -e` 实测 padEnd(-Infinity).length=1 不崩；readers 已过滤空 items |
| codex R2-H2 | `Bun.write` 中途 SIGKILL → profiles.json 清空 corrupt（标 HIGH）| claude **实测 5 iter** spawn child Bun.write 1MB + kill -9 全部保留旧 18 byte 内容；推断 Bun runtime 内部用 tmp+rename / copy_file_range atomic |
| claude R1 L2 | `getToolVersion` 不 drain stderr → pipe 满 → child block writing → 永不 exit | claude **实测**：stderr 1MB 5ms exit / 10MB 14ms exit 后还能读出 9.4MB；Bun 自动 buffer，不会被 OS pipe-full 阻塞 → 修正为「buggy CLI 自身 hang 才会卡」LOW |
| claude R1 | `lib.rs run_dch_command` shell quote 注入 | grep + 推导每个 arg 单引号包裹 + `'\''` 转义 OK |
| claude R1 | `parseFlags VALUE_FLAGS` 白名单（CHANGELOG_5 已修） | grep CHANGELOG_5 修复点确认；`--pre-hook '--foo'` 字面值保留 |

### ❓ 部分 / 未验证（建议看一眼，不强制修）

| 现场 | A 视角 | B 视角 | 是否已验证 | 结论 |
|---|---|---|---|---|
| `hooks.ts:22-24` profile.env 可覆盖 DCH_* 契约变量 | — | codex Q1 推理 | 否 | 低概率；建议 buildEnv 末把 DCH_* 强制再写一遍 |
| `manager.initToolDir` 成功但 saveStore 失败 → 孤儿 symlink | 与 M9 重叠 | codex Q2 推理 | 否 | 与 M9 同一类问题，M9 修复一并覆盖 |
| `lib.rs:74-77` HOME 未设 macOS 沙箱场景 | — | codex R2-L4 推理 | 否 | macOS 极罕见；`Result<String, String>` 显式 Err 即可（与 REVIEW_1 B4 平台抽象联动） |
| `loadAllConfigs` 冷启动尾延迟（4 并发 version + 4 并发 readJsonScope） | C3 已抓 UI 路径 401ms | codex Q1 复杂 rc 推理 2-4s | 部分 | 复杂 rc 实测会更长，但 C3 修复同覆盖 |

---

## 测试 ROI — 双方一致 Top 3

按 **覆盖广度 / 投资成本** 排序：

### Tier 1（必补，5-15 min 投资覆盖大）
1. **`src/profiles/store.test.ts`** — `loadStore` 边界（覆盖 H3 + L 系列回归保护）：
   - 文件不存在 → 返 EMPTY_STORE
   - 空文件 / 0 字节 → 当前行为：JSON.parse "" throw
   - corrupt JSON → throw 含明确 message
   - 缺 active 字段 → fallback `{claude: null, codex: null}`
   - 缺 preferences 字段 → fallback DEFAULT_PREFERENCES
   - version != 1 → 当前不检查，应 throw 或 migrate
   - 并发 spawn 5 child 各跑 push → save，验证 lost update（H3 修复回归保护）
2. **`src/cli-profile.parseFlags.test.ts`** — CHANGELOG_5 修过这块没 spec 易再退化：
   - `--pre-hook '--foo'` 字面值保留
   - `--env KEY=VALUE` / `--env BADFORMAT` / `--env` 不带值
   - `--from id` 与 positional 混合
   - VALUE_FLAGS 完整白名单

### Tier 2（次补，30 min 投资）
3. **`src/profiles/symlink.test.ts`** — 用 `os.tmpdir()` 真 fs 测（覆盖 M8/M9 + REVIEW_1 B11 EXDEV 兜底）：
   - initToolDir 三态分支（missing / directory / symlink）
   - switchSymlink 拒绝场景（target 是 file / target missing 提示 init）
   - tmp rename 原子性（正常路径不留 tmp）

### 不建议优先做
- manager.useProfile 全链路测：依赖 hooks + symlink 两个 mock，投资大
- bridge.normalizeProfileDir：纯函数测试简单但 R2 已记 ⚠️ 词法层无法挡 case-insensitive，测了也只是 lock 现状

---

## 修复路径（按 PR 分组，依据 reviewer-claude fix 时机提醒）

> ⚠️ **当前状态**：另一个会话已落地 CHANGELOG_6 跨平台 fix（REVIEW_1）。本 review 的 fix 推进被用户暂停，等通知再继续。fix 推进前需要按 CHANGELOG_6 后的现网代码重新对位行号，避免冲突。
>
> **建议合并顺序**：PR-1 测试地基先行 → PR-2 一行 lossy 优先合 → PR-3..PR-6 按维度推进。

### PR-1 — 测试地基（5-10 min 投资覆盖大）
- 新增 `src/profiles/store.test.ts`：loadStore 边界 + 并发 lost update 复现测
- 新增 `src/cli-profile.parseFlags.test.ts`：CHANGELOG_5 修过的 VALUE_FLAGS / `--pre-hook '--foo'` / `--env` 边界
- 新增 `src/profiles/symlink.test.ts`：tmpdir mock，initToolDir 三态 + switchSymlink 拒绝场景

### PR-2 — Rust 一行 lossy（M10，风险最小收益明显）
- `src-tauri/src/lib.rs` `read_file` 内 `fs::read_to_string` → `fs::read` + `String::from_utf8_lossy`
- 与 CLI `Bun.file.text()` 行为一致

### PR-3 — Hook 链路鲁棒性（H1 + L10 同 root cause）
- `src/profiles/hooks.ts`：`Promise.race([drainStreams, sleep(timeoutMs).then(...)])` 强制 timeout enforce + `proc.kill(9)` 二阶兜底
- 同步补 hooks.test.ts：`(sleep 10 &); echo done; exit 0` 场景应在 timeout 内退出
- ⚠️ 注意 REVIEW_1 B2 已就 hooks.ts 改了 PowerShell/cmd 平台分流，本轮修需要在新接口上做

### PR-4 — UI 数据可靠性 + 错误回路（H2 + M11 + R3-M2）
- `ConfigPanel.tsx:70` 改 async click handler，await 成功后 setMode；onSave 改返回 Promise<boolean> 或 throw 让调用方决定
- `ProfilePanel.tsx:80-93` onUse 失败弹 HookOutputModal 显示 r.hooks[].stdout/stderr
- `bridge.ts:135` `??` → `||`

### PR-5 — Lost update 文件锁（H3，单独 PR 风险高）
- `src/profiles/store.ts` saveStore 加 advisory flock 或 tmp+rename + version 字段 CAS
- 所有 manager 写操作走同一 mutex；考虑 daemon 化或限定 dch CLI 为唯一写入口
- 同步补 store.test.ts spawn 5 child 并发 push 不丢

### PR-6 — 正确性 grab bag（M1-M4 + M5 + M9 + M12）
- `cli-profile.ts:127-129` base 加 `description: src.description`（M2）
- `cli-profile.ts:169-179` cmdRemove 加 `process.stdin.on("end", () => res(""))`（M3）
- `manager.ts:73-75` saveStore 失败时回滚 symlink，或先 saveStore 后 switchSymlink（M4）
- `manager.ts:91-108` initTool 已存在 profile 时调 `updateProfile(...)` 更新 configDir（M9 + R3-L1 联动）
- `manager.ts:21-31` addProfile 加 ENV_KEY_RE 校验；UI 端同步（M5）
- `bridge.ts:14-19` 单次 IPC 合并 file_exists+read_file（M12 同时改 perf）

### PR-7（可选）— 架构整理（C1 + C4 + C5 联动）
- 把 `generateMinimalConfig` / `tomlBasicString` 下沉到 `src/profiles/main-config.ts`，CLI cmdAdd 加 `--main-config` flag 复用（C1）
- 拆 `ProfilePanel.tsx` → `ProfilePanel/index.tsx` + `ProfileCard.tsx` + `AddProfileModal.tsx` + `HookOutputModal.tsx` + `PreferencesEditor.tsx` + `helpers.ts`（C4）
- README L179 安全声明改成精确范围；同步加 hook env 暴露面警告（C5 + C6 文档）

### 后续轮（优先级低，可入 backlog）
- C3 UI 冷启动 ~400ms × 3 子进程 → 短期 cache project_root + reload 用 mutation return value，长期 daemon 化
- M7 load/reload race → AbortController / requestId latest-wins
- M8 startup glob 清理过期 `${target}.dch-switch-*`
- M13 lib.rs run_dch_command 加 Tauri 侧超时
- 安全维度：buildEnv 黑名单 LD_PRELOAD/DYLD_*/BASH_ENV 不允许 profile.env 覆盖
- 文档维度：D1-D6 跟 PR-7 一起整 README

---

## 关联 changelog

待 PR 合入后回填（CHANGELOG_6 已被 REVIEW_1 占用）：

- PR-1 → `CHANGELOG_7.md`（测试地基）
- PR-2 → `CHANGELOG_8.md`（Rust UTF-8 lossy）
- PR-3..PR-7 → 各自递增 `CHANGELOG_9..13.md`

---

## Agent 踩坑沉淀

本轮 review 暴露 4 类模式化踩坑，已写入 `.claude/conventions-tally.md`「Agent 踩坑候选」section（首次创建）：

- **AP-1**：`??` 与 `||` 在 `String.trim()` 兜底场景的语义差异（M1）— 已知 JS 陷阱但 review 才抓到
- **AP-2**：UI fire-and-forget async + 同步 setState 关闭编辑视图 = 数据丢失隐患（H2）— React 类项目通用模式
- **AP-3**：read-modify-write 三步无锁多进程并发 = lost update（H3）— 任何持久化 single-writer 假设的项目都易踩
- **AP-4**：`Bun.spawn` `proc.kill()` 默认 SIGTERM 被 trap 屏蔽 + 子进程 fork 后 stdout pipe 持有 = timeout 名存实亡（H1）— Bun runtime 与 POSIX trap 交互盲区

同主题再撞 2 次会触发升级到 CLAUDE.md「项目特定约定」节。
