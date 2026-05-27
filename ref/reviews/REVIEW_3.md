---
review_id: 3
reviewed_at: 2026-05-06
expired: false
skipped_expired: []
---

# REVIEW_3: PR-A schema 骨架 + PR-B jsonc-parser/Tauri read_file_with_mtime + PR-F CodeMirror 6 集成

## 触发场景

CHANGELOG_8 第一里程碑（PR-A schema 骨架 + PR-B JSON 写回保留 + PR-F CodeMirror 6 集成）落盘前的质量闸门。本里程碑是「Schema-driven 精细化配置 + Markdown 渲染 + JSON 高亮」10 PR 路线图的内部底座，奠定 schema 类型 / 字段级 patch / 编辑器三大基础，影响后续 PR-C/D/G/H/I/J 全链路。

## 方法

**双对抗配对**（见 `~/.claude/CLAUDE.md`「决策对抗」节 + `agent-deck:deep-code-review` skill）：

- **reviewer-claude**（Opus 4.7 xhigh）：teammate 模式，跨轮 context 持久化
- **reviewer-codex**（gpt-5.5 xhigh wrapper，Bash 调外部 codex CLI `model_reasoning_effort=xhigh`）：teammate 模式

**轮次**：

- **Round 1**（修复正确性 / 是否引新问题 / 测试质量）：双 reviewer 同时给完整 finding；reviewer-claude 18 ✅ + 4 ❌ + 3 ❓；reviewer-codex 6 ✅ + 5 ❌ + 5 ❓
- **C4 反驳轮**（reviewer-claude 单方独有 HIGH `patchJson` 顶层非 object throw guard）：sendMessage reviewer-codex 反驳 → 部分同意（注释错 + silent corruption case 误判）+ ❌ HIGH 严重度（grep 确认 PR-B 无生产 caller，PR-D 合理实现可避开）→ lead 裁决降为 MED
- **Round 2**（fix 验证 + 边界 / 并发 race / 资源 lifecycle / 性能尾延迟）：双 reviewer sendMessage 复用 R_1 context；reviewer-claude 3 MED + 1 LOW + 4 ❓ + 8 ❌；reviewer-codex 2 LOW + 1 INFO + 6 ❌ + 双方一致评「可合」

**范围**：18 文件 / ~1000 行新增（schemas/ + editor/ 目录 + lib.rs 增 67 行 + bridge.ts 增 42 行 + types.ts/ConfigPanel.tsx/styles.css 微调）

```text
PR-A schema 骨架（10 文件）：
  src/schemas/{types,helpers,registry,claude-settings,sync,index}.ts + 3 测试

PR-B JSON 写回保留 + 单 IPC 读（5 文件）：
  src/schemas/{json-patcher,json-patcher.test}.ts
  src-tauri/src/lib.rs（read_file_with_mtime + ReadFileWithMtimeResult）
  src/client/bridge.ts（readFileWithMtime + 类型）
  src/types.ts（ConfigScope.loadedMtimeUs）

PR-F CodeMirror 6 集成（5 文件）：
  src/client/components/editor/{CMEditor.tsx,theme.ts,languages.ts}
  src/client/components/ConfigPanel.tsx（raw/markdown/dotfile view 走 CMEditor）
  src/client/styles.css（.cm-host 段）
```

**机器可读范围**（File-level Review Expiry 用；一行一个仓库相对路径，按字典序、去重；禁止目录 / glob / brace expansion）：

```review-scope
src-tauri/src/lib.rs
src/client/bridge.ts
src/client/components/ConfigPanel.tsx
src/client/components/editor/CMEditor.tsx
src/client/components/editor/languages.ts
src/client/components/editor/theme.ts
src/client/styles.css
src/schemas/claude-settings.ts
src/schemas/helpers.test.ts
src/schemas/helpers.ts
src/schemas/index.ts
src/schemas/json-patcher.test.ts
src/schemas/json-patcher.ts
src/schemas/registry.test.ts
src/schemas/registry.ts
src/schemas/sync.ts
src/types.ts
```

**约束**：deep-code-review skill 默认（teammate 模式 + 跨轮 sendMessage 复用 context + 反驳轮针对单方独有 HIGH + 三态裁决「不接受没验证的 ✅ HIGH」）。

## 三态裁决结果

> 本节遵循全局「决策对抗」节的验证纪律：每条 ✅ 必须带**验证手段**（grep / 写小 test / 跑命令 / 读真实代码），未验证的 finding 强制降级 ❓ + 非 HIGH。弱断言关键词（"可能 / 也许 / 看起来"）只允许出现在 *未验证* 条目里。

### ✅ 真问题（双方独立提出 / 一方提出且现场实践验证成立）

#### Round 1 — 5 HIGH + 8 MED + 5 LOW（共 18 条）

| # | 严重度 | 文件:行号 | 问题 | A (claude) | B (codex) | 验证手段 |
|---|---|---|---|---|---|---|
| C5/codex#1 | HIGH | `src/schemas/registry.ts:54` `stripHome` | home 前缀子串误判：`startsWith(home)` 在相邻路径 `/Users/test_other/.zshrc` + home `/Users/test` / `/foo.claude/...` + home `/foo` 也命中 → stripHome 后 baseName 误归 shell-rc / claude-settings | C5 HIGH | #1 MED | claude bun repro `/Users/test_other/.zshrc` → shell-rc 错；codex repro `/foo.claude/settings.json` → 错 |
| C1 | HIGH | `claude-settings.ts:39-43` `effortLevel` enum | 漏 `xhigh` / `max` 两档（上游真实 5 档：low/medium/high/xhigh/max） | HIGH | — | WebFetch `https://www.schemastore.org/claude-code-settings.json` 拿到上游真实 enum |
| C2 | HIGH | `claude-settings.ts:50` `autoMemoryEnabled` | `default: false` 与上游 `default: true` **反转**，UI 写回会静默关闭用户自动记忆 | HIGH | — | 同上 web fetch |
| C3 | HIGH | `claude-settings.ts:55-56` `cleanupPeriodDays` | `min: 0 / max: 3650` 与上游 `min: 1 / 无 max` 不符（违反 CLAUDE.md「严禁揣测字段语义」） | HIGH | — | 同上 web fetch |
| C4 | MED（lead 裁决降级） | `json-patcher.ts:46-47` 注释 + 全函数无 guard | 注释「顶层非 object 重写为 object」与实测「modify throw」不符；patchJson 无 try/catch | claude-HIGH（提出） | codex 反驳轮：✅ 注释错 + 多发现 silent corruption case，❌ HIGH（PR-B 无生产 caller） | claude bun repro modify("null"...) throw 等；codex 反驳轮 grep 确认无生产 caller |
| C6 | MED | `helpers.ts:29-50` `visit` | 无 visited Set，循环引用 schema 直接 stack overflow（PR-J fetch 含 $ref 上游 schema 时炸） | MED | #2 MED | claude bun repro 自引用 throw |
| C7 | MED | `lib.rs:45` `mtime_us as u64` | mtime ms 精度不足，APFS 实测连续两次 fs::write 间隔 ~335 µs（< 1 ms）→ TOCTOU 漏判 sub-ms 写入 | MED | — | claude rustc 实证 dt_ns=335209 / dt_ms=0 |
| C8 | LOW（claude MED → 降级） | `claude-settings.ts:24` `propertyOrder` | 与 properties 自然顺序 100% 重复，维护时易两处不同步 | MED | — | 静态阅读 |
| C9 | MED | `CMEditor.tsx:67-114` `extraExtensions` | deps `[]` + 闭包陷阱，PR-G 注入静默忽略；无 reconfigure 通道 | MED | #6 LOW | 静态阅读 + R19 effect 语义推演 |
| C10 | MED | `json-patcher.ts:81` `detectFormat` regex | 正则不跳过 jsonc 顶部行注释 + 紧凑怪缩进嗅成 tabSize=3 | MED | #3 LOW | claude bun repro `{\n   "a":...}` 嗅成 3-space；codex repro `{\n// comment\n    "a"...}` 嗅成 fallback 2-space |
| C11 | MED | `json-patcher.test.ts` 全文件 | 测试盲区：多 patch 顺序串扰 / 嵌套 unknown sibling / key 含 dot / 删后剩空 object / 顶层非 object throw guard | MED | 测试盲区表 | 静态阅读 |
| C12 | MED | `lib.rs:31-51` ↔ `bridge.ts:32-37` | `ReadFileWithMtimeResult` Rust ↔ TS 双契约手维护，无 codegen / 共享 IDL | MED | — | 静态检查 |
| C13 | MED | `registry.ts:54-58` `stripHome` | 不处理 Win 反斜杠，`C:\Users\test\.claude\settings.json` 全部分流 miss | MED | 测试盲区 LOW | claude bun repro Win 路径返 null |
| C14 | LOW | `types.ts:32-41` `EnumValue` | 短 / 长形式混写时 caller TS narrow 易漏分支 | LOW | — | 静态推演 |
| C15 | LOW | `types.ts:127` ↔ `helpers.ts:64-67` | `Diagnostic.path` `string` vs path arg `(string\|number)[]` 类型不一致 | LOW | — | 静态推演 |
| C16 | LOW | `lib.rs:30-51` `read_file_with_mtime` | read 失败 vs metadata 失败合并 missing 语义，caller 无法区分 race | LOW | — | 阅读源码 match 分支 |
| C17/codex#4 | MED | `types.ts:30` `loadedMtimeMs` | `number \| null \| undefined` 三态语义易让 PR-D consumer `if (!v)` 误判 | LOW | #4 MED | 静态推演 + codex bun repro `!undefined === !null === !0 === true` |
| C18 | LOW | `theme.ts:43-45` | `caretColor: transparent` + `.cm-cursor display: none` 双开关冗余 | LOW | — | CM6 文档：caretColor 控原生 caret，.cm-cursor 是 CM 自绘 |
| codex#5 | INFO | `languages.ts:18-31` | switch 有 `default: return []` 阻止 TS 穷举检查；将来 ConfigScope.format 加新值不会编译报错 | — | INFO | 类型定义阅读 |

#### Round 2 — 1 MED + 4 LOW（共 5 条新）

| # | 严重度 | 文件:行号 | 问题 | A (claude) | B (codex) | 验证手段 |
|---|---|---|---|---|---|---|
| D3 | MED | `CMEditor.tsx:113` mount + `:170-176` reconfigure | `extraCompartment.current.of([...extraExtensions])` + reconfigure `[...extraExtensions]` 解构生新数组，让 caller useMemo 稳定的引用在内部失效 → CM6 reconfigure 总产 noop transaction | D3 MED | ❓「可接受文档已警告」 | claude bun repro：[...x] 两次产 different ref + Compartment 不 short-circuit |
| D1/codex#INFO | LOW | `json-patcher.ts:48-50` 注释 + `:86-100` `assertValidJsonOut` + test:239-244 | assertValidJsonOut 在 jsonc-parser@3.3.1 实测无触发场景（所有 silent corruption 候选都被外层 try/catch 截）；注释 + test name 误导 | D1 MED | INFO 补注释 | claude 12 种顶层输入实证全部 throw；codex 解释 ESM/CJS 双路径让 assert 仍是 net |
| D2 | LOW | `lib.rs:52-56` `mtime_us` and_then 链 + `bridge.ts:50-56` 三态注释 | `SystemTime::duration_since(UNIX_EPOCH)` Err 路径与文件不存在合并 None，PR-D consumer 无法区分 pre-1970 文件场景 | D2 MED | ❌ macOS APFS u64 ns 不可达 + 即便触发跳过 TOCTOU 是更安全 fail-safe | claude 静态推演 Rust std 文档 + lead R_2 prompt 主动指出 R_1 没列 |
| codex R2·#1 | LOW | `registry.ts:86` `baseName` | `lastIndexOf("\\")` 是 C13 fix 引入的死代码（stripHome 已 normalize `\` → `/`） | — | LOW | grep 确认 baseName 唯一 caller 是 detectScope，rel 来源 stripHome 永远不含 `\` |
| codex R2·#2 | LOW | `json-patcher.ts:139` `detectFormat` | 不跳无 `*` 前缀的 block comment 续行（罕见非 JSDoc 风格）会被误识为缩进行 | — | LOW | codex bun repro `/* ... \n   no-star */ \n    "a"...` 嗅成 tabSize=3 |

### ❌ 反驳（被对抗或现场核实证伪）

| 报告方 | 报项 | 反驳依据（验证手段 + 结论） |
|---|---|---|
| claude focus | theme.ts CSS 变量 var(--bg0) 在 EditorView.theme 内是字面量不生效 | claude WebSearch + CM6 docs：CM6 用 style-mod 生成 `<style>` 注入 document，`var(--bg0)` 是合法 CSS 值，浏览器 paint cascade 正常解析。`@codemirror/theme-one-dark` 同模式。证伪 |
| claude focus | CMEditor cleanup 顺序 `view.destroy()` 先于 `viewRef.current = null` 读 stale view | CM6 `destroy()` 同步 release 不 fire userland listener；updateListener 仅 dispatch 触发，不 destroy 触发。证伪 |
| claude focus | resolveFieldAtPath 数组段接 string 返 undefined | claude bun 实测返 null（不是 undefined）；?.type undefined 是可选链结果 |
| claude focus | detectScope settings.local.json 表驱动会回归 | 当前 if-else `===` 全等已避免；改表驱动只要保 `===` 也不回归（建议加测试加固） |
| codex focus 4 | EnumValue 短 / 长混写 type narrow 陷阱（HIGH 升级） | codex 运行时 `typeof v === "object"` 精确区分 EnumOption vs string|number。证伪 |
| codex focus 5 | CMEditor cleanup 顺序读 stale view（同 claude） | 同上一致证伪 |
| codex R_1 反驳 | C4 patchJson HIGH 严重度 | grep PR-B 无生产 caller；PR-D 合理实现可避开（typeof guard + TOCTOU 中断） → lead 裁决降 MED |
| R_2 双方一致 | assertValidJsonOut 性能让 UI 卡顿 | claude 实测 100KB ~1ms / 1000 fields 290KB ~2.35ms；codex 100KB ~0.8ms。绝对值 << 16ms 单帧 |
| R_2 双方一致 | detectFormat 大文件 split 性能差 | claude 290KB 0.2ms / codex 406KB 0.15ms |
| R_2 claude | stripHome 反斜杠 normalize macOS perf 损失 | macOS 路径 `/`，replace 0 命中 |
| R_2 codex | CMEditor mount/unmount 泄漏 destroyed view listener | Compartment 跨 EditorState 隔离；view.destroy() 同步 release |
| R_2 codex | Compartment useRef 在 Strict Mode 双 mount 间复用 binding 冲突 | bun 实证 c.of(s1) 与 c.of(s2) 隔离 |
| R_2 codex | detectFormat 跳注释行的 `*` 误判 JSON 字符串内 `*` 行 | JSON spec 不允许字面 newline 在 string 内，必须 `\n` 转义 |
| R_2 双方一致 | read_file_with_mtime + save_file 仍非原子 TOCTOU 是新 bug | 这是 user-space 经典 TOCTOU，纯 user-space 解不掉（OS-level FD-locking 才能解）；不是 fix 引入的回归 |
| R_2 双方一致 | readFile + readFileWithMtime 在 PR-D 之前混用引入新 race | grep 确认 readFileWithMtime 仅 export 定义无 caller，loadAllConfigs 全走旧 readFile，loadedMtimeUs 永远 undefined（兼容期设计行为） |
| R_2 claude focus | mtime us 精度 ABA 问题 | R_1 实测 dt_ns=335209 → us 精度下 dt_us=335 远 > 0；sub-us 同 us 写概率极低 |
| R_2 claude D2 严重度 | mtimeUs Err 路径与文件不存在合并 → MED | codex 反驳：APFS u64 ns 时间戳无法表示负值，pre-1970 实质不可达；即便触发，「跳过 TOCTOU」是更安全 fail-safe，与文件不存在合并语义可接受 → 降 LOW |

### ❓ 部分 / 未验证（双方角度不同 / 一方提出但未实践验证）

| 现场 | 视角 | 是否已验证 | 结论 |
|---|---|---|---|
| ScopeKind 8 项 vs registry 1 注册无编译期约束 | claude C12 / R_2 复述 | 设计如此（PR-D/E/H/I 渐进补） | 推到下轮（建议 `Required<Record<ScopeKind, ToolSchema \| null>>` 占位） |
| helpers `joinPath` 用 `.` 但 key 名本身是 `"."` / `"[]"` / `"<key>"` 与模板段歧义 | claude Q1 | 概率 < 0.1% | 文档注明 + 测试断言，标 LOW |
| CMEditor mode 切换大对象（120 row settings.json）流畅度 | R_2 Q5 | 未实测 cold start | INFO，PR-G 之后再实测 |
| Tauri WKWebView 加载 150KB gzip cold start | R_2 Q5 | 未跑 Tauri build | INFO，PR-J 性能 audit 时实测 |

## 修复（CHANGELOG_8 落地）

### HIGH（5 条全修）

1. **`registry.ts:54-87`** — stripHome `home + "/"` 边界严格匹配 + Win `\` normalize + home 外路径返 null（C5 + C13）；删 `/tmp/.zshrc` 宽松语义
2. **`claude-settings.ts:39-72`** — effortLevel 5 档（含 xhigh/max）+ autoMemoryEnabled default:true + cleanupPeriodDays min:1 删 max + 每字段 `// source:` 注释绑「严禁揣测」铁律（C1+C2+C3）
3. **同上** — 删 propertyOrder 冗余（C8 顺手）

### MED（8 条全修）

1. **`json-patcher.ts:62-100`** — patchJson 加 try/catch + assertValidJsonOut 后置校验 + 注释修正（C4）
2. **`helpers.ts:29-72`** — visit visited Set 守门循环引用（C6）
3. **`lib.rs:32-83`** — mtime ms→us + 全链路重命名 loadedMtimeUs + 三种 None 路径各自 eprintln（C7+C16+R_2 D2）
4. **`CMEditor.tsx:55-180`** — 加 extraCompartment + reconfigure useEffect + EMPTY_EXTRA 稳定空数组（C9）
5. **`json-patcher.ts:117-150`** — detectFormat 改 line-by-line 跳过 jsonc 注释行（C10）
6. **`bridge.ts:32-78`** + `lib.rs:31-83` — ReadFileWithMtimeResult 双契约约束注释（C12）
7. **`types.ts:30-46`** + `bridge.ts:39-67` — loadedMtimeUs / mtimeUs 三态 JSDoc 详尽（undefined / null / number 区分，禁用 `!v`，R_2 D2 补全 null 三种合并来源）（C17）
8. **`CMEditor.tsx:113, 170`** — 删两处 `[...extraExtensions]` 解构，避免 caller useMemo 失效（R_2 D3）

### LOW（5 + 4 共 9 条全修）

1. **`helpers.ts:99-125`** — normalizeEnum + pathToString helper（C14 + C15）
2. **`theme.ts:43-46`** — 删 cursor display:none 双开关冗余（C18）
3. **`languages.ts:30-34`** — default 用 `never` exhaustive check（codex#5）
4. **`json-patcher.test.ts`** — 改 string-literal test name 不误导 + assertValidJsonOut 注释明说「实测无触发场景，留作回归网」（R_2 D1）
5. **`registry.ts:86-90`** — baseName 删 `lastIndexOf("\\")` 死支（R_2 codex R2·#1）
6. **`json-patcher.ts:117-135`** — detectFormat 补「已知限制」JSDoc（R_2 codex R2·#2）

### 测试盲区补（28 case）

- `helpers.test.ts`：循环引用 3 case（self-ref / mutual-ref / array self-ref）+ properties vs additionalProperties 同名 1 case + normalizeEnum 4 case + pathToString 3 case
- `registry.test.ts`：stripHome 7 case（home 前缀子串 / `/foo.claude/...` / absPath===home / 末尾斜杠 / 反斜杠 normalize / home 外严格 null）
- `json-patcher.test.ts`：detectFormat 5 case（注释穿透 / 多空行 / 紧凑 JSON）+ 顶层非 object 6 case（null/number/array/string-literal/empty/empty-obj）+ nested array of objects

## 关联 changelog

- [CHANGELOG_8.md](../changelog/CHANGELOG_8.md)：本次修复在 PR-A / PR-B / PR-F 节内 + 末尾「REVIEW_3 fix」节追加

## Agent 踩坑沉淀

本次 review 提炼出 3 条 agent-pitfall 候选（写入 [.claude/conventions-tally.md](../.claude/conventions-tally.md) 「Agent 踩坑候选」section）：

- **AP-5**：assert / guard / catch 路径必须有真实触发场景的实证测试，避免 dead code 隐藏（D1）
- **AP-6**：跨边界（useEffect / useMemo / Compartment）传引用要么直接透传要么 deps 短路（D3）
- **AP-7**：OS 系统调用 Err 路径不能与正常空值合并 None（D2）

同主题再撞 2 次会触发升级到项目 CLAUDE.md「项目特定约定」节。
