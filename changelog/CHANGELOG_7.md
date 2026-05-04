# CHANGELOG_7: REVIEW_2 落地（综合 deep code review fix）

## 概要

REVIEW_2（首次全维度 deep code review，3 轮异构对抗 + 1 反驳轮，3 HIGH / 13 MED / ~30 LOW）的修复落地总账。按 reviewer-claude fix 时机提醒分 PR 推进，逐个 commit；本 changelog 在每个 PR 完成时追加一节。

REVIEW_2 主题与 REVIEW_1（跨平台 Win 支持，CHANGELOG_6 落地）正交：本轮聚焦 macOS 现网代码的综合质量（架构 / bug / 安全 / 性能 / 测试盲区）。

## PR-1 — 测试地基

> reviewer-claude fix 时机提醒：「没测试光修 finding 容易再退化，先做」。

### `src/profiles/store.ts`

- `loadStore` / `saveStore` 加可选 `path` 参数（默认 `STORE_PATH`），生产 caller（manager.ts 全 7 处写操作）不受影响。让单测能注入 tmpdir 不污染 `~/.dch/profiles.json`
- `saveStore` 用 `dirname(path)` 处理非默认路径的父目录 mkdir

### `src/profiles/store.test.ts`（+9 case）

`loadStore` 边界（覆盖 H3 lost update + L 系列回归保护）：
- 文件不存在 → 返 EMPTY_STORE 深拷贝（避免共享引用变形）
- corrupt JSON → throw 含明确 path
- 空文件 / 0 字节 → throw（与 corrupt 同语义）
- 缺 active 字段 → fallback `{ claude: null, codex: null }`
- 缺 preferences 字段 → fallback DEFAULT_PREFERENCES
- active 部分提供 → 与 default 合并

`saveStore + loadStore roundtrip`：
- 完整 ProfileStore 写入后读回保持一致
- saveStore 自动 mkdir 多层 parent dir

H3 lost update 回归测（`it.skip`，PR-5 修文件锁后反 skip）：
- spawn 5 child 各自 load → push → save，期望最终 6 条 profile

### `src/cli-profile.ts`

- `parseFlags` / `VALUE_FLAGS` 加 `export`（CHANGELOG_5 反复修过这块没 spec 易再退化）

### `src/cli-profile.parseFlags.test.ts`（new，+14 case）

- 空 argv / 纯 positional / VALUE_FLAGS 5 项分别 lock
- **`--pre-hook '--foo bar baz'` 字面值保留**（CHANGELOG_5 修复点回归保护）
- `--env KEY=VALUE` / 多对 / value 含 `=` 号 / value 为空（`KEY=`）
- 非 VALUE_FLAGS 的 flag 也允许带 value
- VALUE_FLAGS 末尾缺 value → 静默变 boolean true（lock 当前 LOW 行为）

### `src/profiles/symlink.test.ts`（+6 case）

`pathState` 四态（initToolDir / switchSymlink 决策核心）：
- missing：路径不存在
- file：普通文件
- directory：真实目录
- symlink：指向目录 / 指向文件 / dangling（target 不存在）— `lstat` 不 follow 行为锁定

### 测试基线

- 38 pass（CHANGELOG_6 后基线）→ **68 pass + 1 skip**（H3 lost update 等 PR-5 修复后反 skip）
- 0 fail，covered store/parseFlags/symlink 三个核心模块的单测保护层

## 备注

- **PR 切分原则**：每个 PR 单一目标 + 自带 test 自带 commit；reviewer-claude 给的合并顺序 PR-1 → PR-2 → PR-3..PR-7
- **不写 CHANGELOG_8/9/...**：本 review 落地走单文件追加节（PR-1/PR-2/...）而非每 PR 一个 CHANGELOG，便于一处看完总账。后续 PR 完成时本文件追加新节

## PR-3 — Hook 链路鲁棒性（H1 + L10 同 root cause）

> reviewer-claude fix 时机提醒：「H1 hook timeout 与 L10 SIGTERM 被 trap 同 root cause 同 PR 修，分开修反引漏」。

### `src/profiles/hooks.ts`

`runHook` 加 hard cap 强制超时返回，解决 H1 detach 子进程持 stdout pipe 让 useProfile 永久卡死：

- `setTimeout` 触发 → `proc.kill()` 给主 shell（POSIX 的 SIGTERM 可能被脚本 `trap "" TERM` 屏蔽，下面硬截断兜住）
- 新增 `GRACE_MS = 500` 缓冲；`Promise.race([drainAll, hardCap])` 在 `timeoutMs + GRACE_MS` 后强制返回 `["[truncated by timeout]", "[truncated by timeout]"]`
- `proc.exited` 也用 `Promise.race` 加上限 `timeoutMs + 2*GRACE_MS`，避免 detach 场景永挂

修复前：hook 脚本 `(sleep 10 &); echo immediate; exit 0` + `timeoutMs=500` 实测 useProfile 卡 ≥ 10000ms（claude reviewer 实测 10010ms）；
修复后：同样脚本 ≤ ~1500ms 必返回 `timedOut=true`。

### `src/profiles/hooks.test.ts`

- 新增 1 case：`detach 子进程 (sleep 10 &) 不阻塞 useProfile（H1 回归保护）`
  - `expect(elapsed).toBeLessThan(2500)` lock 死「不能再卡 10s」的 invariant
  - PowerShell 没等价 detach 语法，`test.skipIf(IS_WIN)` 跳过 Win 路径

### 测试基线

- 68 → 69 pass + 1 skip / 0 fail（新增 detach H1 回归）

### 备注

- **不试 SIGKILL 二阶兜底**：POSIX `proc.kill(9)` 对 detach 出去的孙进程无效（fork 后已脱离 dch session），不如直接 hard cap。孙进程残留是用户配的 hook 自己的事
- **GRACE_MS = 500 选取**：drain 完成正常 ≪ 100ms；500ms 给 SIGTERM 时间生效又不显著拖长 timeout 体感
- **Win 上 `proc.kill()` 行为**：Bun runtime 默认用 `TerminateProcess`，PowerShell 进程能立即死。Win 路径不存在 detach 的 `(... &)` 语义，H1 触发面窄

## PR-4 — UI 数据可靠性 + 错误回路（H2 + M11 + R3-M2 + M1）

### `src/client/App.tsx`

- `onSave` catch 块在 flash toast 后 `throw e` 让 caller 知道失败（旧版静默吞，让 ConfigPanel fire-and-forget 直接 setMode 丢内容）

### `src/client/components/ConfigPanel.tsx`（H2）

- `Scope` 组件保存按钮改 `async onClick + try/catch`：仅 `await onSave()` 成功才 setMode("view")；失败时 catch（App 已 toast）保留 edit 模式让用户继续改 textarea 或重试
- 新增 `saving` state + 「保存中…」按钮文案；保存中 textarea / 取消 / 保存按钮全 disabled 防误操作
- prop 类型 `(p, c) => void` → `(p, c) => Promise<void>` 匹配 async 实际签名

### `src/client/components/ProfilePanel.tsx`（M11 + R3-M2）

- `onUse` 失败不再 throw 简短 message，改：toast 失败原因 + 弹 `HookOutputModal` 显示失败 hook 完整 stdout/stderr（与 CLI `cmdUse` 的 `fmtHookResult` 完整打印对齐）
- 用户在 UI 切 profile 失败现在能看到 hook 内 `echo "代理 endpoint 不通"` 之类诊断
- 顺手修 CHANGELOG_6 后遗 typecheck 错（HookScript union 后 ProfilePanel 未同步）：
  - 新增 `hookToString(h: HookScript | undefined): string` helper
  - ProfileCard 显示用 `hookToString(profile.hooks!.preSwitch)`
  - applyClone 灌字段用 `hookToString(src.hooks?.preSwitch)` 替换 `src.hooks?.preSwitch || ""`（type union 后 || 不能赋 string）
  - object 形式 hook 在 textarea 显示其 `posix > powershell > cmd` 字段；用户 UI 编辑回写仍是 string 形式（要写 object 直接编辑 ~/.dch/profiles.json，UI scope 取舍）

### `src/client/bridge.ts`（M1）

- `runDch` 错误抛出：`parsed.error ?? r.stderr.trim() ?? ...` → `parsed.error || r.stderr.trim() || ...`
- `trim()` 永远返 string（可能空串），`??` 永不命中第三段 fallback；CLI fail 走 JSON_MODE `err()` 时 stderr 完全空 → UI toast 显示空字符串

### 验证

- `bunx tsc --noEmit -p .` 0 error（修了 CHANGELOG_6 后遗 3 处）
- `bun test` 69 pass + 1 skip / 0 fail（无回归）
- UI 路径手测留待 dev 启动验证（保存失败保留 buf / 切换失败弹 HookOutputModal）

### 备注

- **不动 `(p, c) => Promise<void>` 签名后的 unhandled rejection**：旧 caller 如有 `onSave(...)` 不 await，promise reject 会 console.warn 但不阻塞 UI；ConfigPanel 是唯一 caller 已经改成 await
- **HookOutputModal 复用**：原本只用于 `onTestHook` 主动测试；M11 修复直接复用同一 modal 不引新组件
- **R3-M1 onTestHook 无 busy 保护**未在本 PR 修，留给后续（PR-6 grab bag）



## PR-2 — Rust UTF-8 lossy（M10 一行改动，风险最小收益明显）

> reviewer-claude fix 时机提醒：「改一行 `from_utf8_lossy` 风险最小收益明显，建议单独 PR 优先合」。

### `src-tauri/src/lib.rs`

- `read_file` 命令：`fs::read_to_string` → `fs::read` + `String::from_utf8_lossy`
- 与 CLI 端 `Bun.file.text()` 行为一致（lossy）：遇非法 UTF-8 字节用 `U+FFFD` 替换而非 throw
- 修复触发场景：用户 `~/.zshrc` 用 GBK / Latin-1 写注释（亚洲开发者偶见混用 / 历史脚本），原版让 `loadAllConfigs` reject → App.tsx setError → UI 整个挂在「加载失败: ...」

### 验证

- `cargo check` 通过（host = mac）
- 无新增单测：`read_file` 是 `#[tauri::command]` 入口，需 Tauri runtime 完整启动才能调；M10 行为差异是 Rust stdlib level，单元测试投资远高于直接看 cargo check + 后续 UI 冒烟收益

