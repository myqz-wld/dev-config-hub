# Reviews 索引

> 周期性 / 触发性的 debug、code review、性能 audit、安全审查报告。功能变更去 [`changelog/`](../changelog/INDEX.md)，本目录专注**修问题与加固**。

## 命名

`REVIEW_X.md`（X 递增整数，跟 `CHANGELOG_X.md` 对齐）。新建前 `ls reviews/` 找最大 X。

## 单文件结构

- 触发场景（用户主动 / 周期性 / 大重构前 ...）
- 方法（双对抗 Agent 配对、范围、工具）
- 三态裁决清单（✅ / ❌ / ❓）+ 证据（文件:行号 + 代码片段）
- 修复条目（按严重度）
- 关联 changelog（本轮修复落地的 CHANGELOG 编号）

## 索引表

| 文件 | 主题 | 严重度分布 | 关联 changelog |
|------|------|-----------|----------------|
| [REVIEW_1.md](REVIEW_1.md) | 跨平台兼容性 Windows 支持基础设施盘点（双异构 reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 wrapper）：12 ✅（4 HIGH / 4 MED / 4 LOW）。修复 6 phase commit：platform.ts 抽象 + cli/store path 修复 + symlink → junction + hooks 协议平台分流 + Tauri Rust cfg 守门 + readers Win 平台分流 | 4 HIGH / 4 MED / 4 LOW | CHANGELOG_6 |
| [REVIEW_2.md](REVIEW_2.md) | 全维度首次 deep code review：架构 / bug / 安全 / 性能 / 测试盲区（双异构 reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 wrapper，3 轮 + 1 反驳轮）。3 HIGH（hook timeout 卡死 / onSave 数据丢失 / store lost update）+ 13 MED + ~30 LOW + 2 ❌ 实证证伪 | 3 HIGH / 13 MED / ~30 LOW | 待 PR-1..7 落地后回填 CHANGELOG_7..13 |
| [REVIEW_3.md](REVIEW_3.md) | CHANGELOG_8 第一里程碑（PR-A schema 骨架 + PR-B jsonc-parser/Tauri read_file_with_mtime + PR-F CodeMirror 6 集成）落盘前质量闸门，2 轮 + 1 反驳轮 双异构 reviewer 对抗（同 REVIEW_2 配对）。R_1: 5 HIGH（stripHome 前缀 / claude-settings 三连揣测 / patchJson throw guard）+ 8 MED + 5 LOW + 多 ❌；R_2: 1 MED（CMEditor [...]解构）+ 4 LOW + 双方评「可合」+ 3 AP 踩坑候选 | 5 HIGH / 9 MED / 9 LOW | CHANGELOG_8 |
| [REVIEW_4.md](REVIEW_4.md) | CHANGELOG_8 全量收口（PR-D 接入 Claude settings.json + PR-E TOML/OpenCode/.mcp.json + PR-G CM6 edit + JSON Schema lint+hover+completion + PR-H Markdown 渲染 + PR-I ProfilePanel 拆 7 文件 + PR-J sync.ts CI/ajv/bundle splitting + Follow-up #1-4），2 轮双异构 reviewer 对抗。R_1: 5 HIGH（H1 onConflictReload TOML 硬编 JSON.parse / H1' defaultMode enum 漏 4 项 / H2 dch-store profile.id pattern 与 manager.ts 不一致 / H2' kv-map 严格化（被 R_2 R-H2 反驳回退）/ H3 extraExtensions readonly 类型）+ 11 MED + 7 LOW；R_2: 2 HIGH（R-H1 process.env.HOME bun bundler inline / R-H2 严过上游回退）+ 5 MED + 2 LOW + 多 ❌ + 3 AP 候选 | 5 HIGH（H2' 反驳后 4 实修）/ 16 MED / 9 LOW | CHANGELOG_8 |
| [REVIEW_5.md](REVIEW_5.md) | prod build 卡 raw HTML "Loading..." 根因排查 + 防御加固（用户驱动 hot-fix，非周期 review）。链路：截图 vs index.html 对比 → 排除 IPC/dist 嵌入 → 切 dev 模式拿 webview console → 抓两个独立 throw：(1) ebnf CJS interop bug 让 React 起不来；(2) ArrayField 收非数组 value crash + 顶层无 ErrorBoundary → 用户视角永远卡 Loading。修：bun patch ebnf 持久化 + ArrayField 类型守卫 + main.tsx 加 ErrorBoundary。Follow-up #1：env KV value 列嵌套 FieldRow 撑爆布局（× 截断 + 重复显示 key），加 FieldProps.embedded prop，所有 leaf field 在 embedded=true 时跳过 FieldRow。Follow-up #2：StringChipEditor `<code>{item}</code>` 渲染 plain object（用户 array 元素是 object 但 schema 说是 string）→ React throw "Objects are not valid as a React child"，加 isStringChips 三重守卫 + chip 内 typeof 防御 + ErrorBoundary 显示 error.message。后续待办：支持用户自定义 schema | 2 HIGH / 2 MED + 2 Follow-up | 无（pure hot-fix） |
| [REVIEW_6.md](REVIEW_6.md) | CHANGELOG_10 自动刷新（focus + 5s mtime poll）落盘前质量闸门，3 轮 + 2 反驳轮 双异构 reviewer（Opus 4.7 xhigh + gpt-5.5 xhigh）。R_1: 1 HIGH（H1 edit 模式 silent overwrite）+ 2 MED（双方一致 useEffect saving guard race / 5s poll 抹打字 draft）+ 1 LOW（setError 不清零）；R_2: 1 HIGH（H1-followup banner 不禁用 save）+ 3 MED（PR-G TOCTOU banner 被 focus 静默清 / isUserTyping 漏 prop-sync 路径 / handleRootChange await ref hold 漏洞）；R_3: 0 HIGH/MED 双方均「可合」+ 1 INFO 死代码 + 2 LOW *未验证*（conflict commit delay / poll writingRef gap，conflict 对象兜底 data integrity）+ 必修 12 component test 防未来 PR 静默回退。沉淀 AP-1/AP-2/AP-3 三条 agent-pitfall 候选 | 2 HIGH / 5 MED / 1 LOW + 12 test | CHANGELOG_10 |
| [REVIEW_7.md](REVIEW_7.md) | 切 profile 卡死全链路修复（双异构 reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 high，wrapper 失败 3 轮后改 bash 直起拆 batch 并发）。根因：CHANGELOG_7 H1 修过 runHook 函数级，但漏 bun 进程级 — ReadableStream pump + race timer + detach 孙子继承 stdio pipe FD 让 bun event loop 不空 → bun 不退 → Rust `command.output()` 卡。7 HIGH（H1 stdout 65536 截断 / H2 Rust timeout 与 hookTimeout 不匹配 / H3 reader join 卡 detach / H4 child.kill 仅杀 direct child / H5 get_tool_version 同根 / H6 漏 e2e bun 进程退出测试 / H7 race timer 拖死 bun）+ 3 MED + 1 LOW；codex 单方 3 条 HIGH 全部主 agent 现场 ps + bun -e 实证。沉淀 AP-14/15/16 | 7 HIGH / 3 MED / 1 LOW + 3 e2e + 5 cargo | CHANGELOG_12 |
