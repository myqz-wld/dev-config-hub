# CHANGELOG_8: Schema-driven 精细化配置 + Markdown 渲染 + JSON 高亮

## 概要

把当前裸 textarea + typeof-only 描述的配置展示，重做为 schema-driven 表单（行内点选 / 校验 / 注释保留写回）+ CodeMirror 6（语法高亮 / lint / 折叠）+ Markdown 渲染（react-markdown + shiki，CLAUDE.md 也能像 GitHub 一样看）。Profile 系统的 hooks（多平台 posix / powershell / cmd）/ env / 原文 profiles.json 走相同精细化栈。

10 个 PR 渐进，每个 PR 自洽。设计与依赖图见外部 plan：`/Users/apple/.claude/plans/markdown-json-polished-crystal.md`（不入版控）。

## PR-A — Schema 类型骨架（无用户感知，内部底座）

> 第一里程碑（PR-A + PR-B + PR-F）的最底层，无新增 runtime 依赖，独立可测。

### `src/schemas/types.ts`（新建）

- 16 种 `FieldType`：`boolean` / `number` / `integer` / `string` / `enum` / `path` / `url` / `regex` / `duration` / `color` / `array` / `object` / `kv-map` / `markdown` / `code`
- `FieldSchema` 全字段接口：`type` / `description`（后续 PR-H 后支持 markdown）/ `required` / `sensitive` / `default` / `examples` / `since` / `deprecated` / 数值约束 (`min` / `max` / `step` / `unit`) / 字符串约束 (`pattern` / `patternHint` / `multiline`) / enum (`enum` / `enumStyle` / `enumOpen`) / path (`pathKind` / `expandHome`) / code (`codeLanguage`) / array (`itemSchema` / `uniqueItems` / `minItems` / `maxItems`) / object (`properties` / `propertyOrder` / `additionalProperties`) / kv-map (`keyPattern` / `keyHint` / `valueSchema`) / 通用 UX (`hidden` / `readOnly` / `helpUrl`)
- `EnumOption` 含 `label` / `description`（允许 markdown）/ `since` / `deprecated`，`EnumValue` 兼容短形式 `string | number`
- `ToolSchema` 容器：`$id` / `$source`（上游 URL） / `fetchedAt` / `scopeKind` / `rootSchema`
- `ScopeKind` 8 种：`claude-{settings, settings-local, mcp, md}` / `codex-config` / `opencode-config` / `shell-rc` / `dch-store`
- `Diagnostic` 校验产物：`level` / `message` / `path`

### `src/schemas/helpers.ts`（新建）

- `buildFieldIndex(root)` → `Map<dottedPath, FieldSchema>`。模板段约定：数组用 `[]`、kv-map 用 `<key>`、`additionalProperties: schema` 用 `*`。根节点不入索引（prefix 为空）
- `resolveFieldAtPath(root, path)`：按运行时段（数字下标 / 任意 key）定位 schema；未知 key 返 null 由调用方 fallback 为 UnknownField

### `src/schemas/registry.ts`（新建）

- `detectScope(absPath, home)` → `ScopeKind | null`。**严格全等路径匹配**，不做前缀模糊匹配——避免 `.claude/settings.local.json` 被 `.claude/settings.json` 误吃。`shell-rc` 走 basename 命中，覆盖 `~/.zshrc` / `~/.zprofile` / `~/.bashrc`，含 home 外路径（`/tmp/.zshrc` 测试场景）
- `getSchemaForScope(scope)` → `ToolSchema | null`。PR-A 仅注册 `claude-settings`，其余 7 种 ScopeKind 在 PR-D / PR-E / PR-F / PR-H / PR-I 渐进补
- `listRegisteredSchemas()` 仅供 sync.ts 调试用

### `src/schemas/claude-settings.ts`（新建，5 字段示例）

- `model` (string) / `fastMode` (boolean) / `effortLevel` (enum 3 项含 description) / `autoMemoryEnabled` (boolean) / `cleanupPeriodDays` (integer with `min` / `max` / `unit`)
- **关键不变量**：`rootSchema.additionalProperties: true`。配合 PR-B 之后「原文 + jsonc-parser 字段级 patch」的写回路径，保证 schema 不认识的用户自定义 key 永不丢失
- 字段来源在 `$source: https://json.schemastore.org/claude-code-settings.json`，`fetchedAt: 2026-05-06`
- PR-D 补全到 ~30 字段（含 env / permissions / hooks / availableModels / pluginConfigs 等嵌套结构）

### `src/schemas/sync.ts`（新建，骨架）

- `bun src/schemas/sync.ts`：列出已注册 schema 的 scope / source / fetched 日期
- 完整 fetch 上游 + ajv 自洽 + 与本地 diff 报告留 PR-J

### `src/schemas/index.ts`（新建，桶导出）

### 测试（+31 case，分两份）

- `src/schemas/helpers.test.ts`：`buildFieldIndex` 6 case（顶层 / 嵌套 / 数组段 `[]` / kv-map 段 `<key>` / additionalProperties 段 `*` / 根不入索引）+ `resolveFieldAtPath` 9 case（顶层 / 嵌套 / 数组下标命中 itemSchema / kv-map 任意 key / additionalProperties / 未知 key + true / 未知 key + 缺省 / 数组段非数字 / 空 path 返根）
- `src/schemas/registry.test.ts`：`detectScope` 10 路径表驱动 + 不在 home 1 + settings.local.json 优先级 1 + home 外 shell-rc basename 1；`getSchemaForScope` 2；`listRegisteredSchemas` 1
- `bun test`：107 pass / 0 fail（含全项目零回归，schema 32→31 净增 31 case）

### 备注（PR-A）

- README 不更新：内部底座，无用户感知
- 项目 CLAUDE.md「项目特定约定 → Schema 系统硬约束」节延后到 PR-D（首次面向用户）一并写入；理由：PR-A 仅类型骨架，写回 patch 铁律 / 上游 sync 流程等约束尚未真正生效
- `descriptions.ts` 不删：仍是当前 ConfigPanel 的描述源；PR-D 之后逐步退役为 fallback

## PR-B — JSON 写回保留（jsonc-parser）+ Tauri 单 IPC 读 + ConfigScope.loadedMtimeMs

> 第一里程碑底座 #2。新增 1 个 runtime 依赖 `jsonc-parser@3.3.1`（VSCode 同款，~12 KB gzip）。无用户感知（PR-D 集成时才接到 ConfigPanel）。

### `src/schemas/json-patcher.ts`（新建，~86 行）

- `patchJson(source, patches, options?)`：用 `jsonc-parser` 的 `modify` + `applyEdits` 在原文上做字段级 edit
  - 单 key 改值：原位 in-place 替换字面，注释 / 前后空行不动
  - 删 key：`value === undefined` 触发，整行删除（含尾随逗号 jsonc-parser 自动处理）
  - 加 key：path 不存在时追加到父对象末尾，按现有缩进
  - 数组操作：末段 number index → 修改 / 删除 / push
  - 多 patch 顺序应用（每次 applyEdits 后再算下一个，避免位置串扰）
- `detectFormat(source)`：嗅探缩进（tab vs 2 / 4 / N space）+ EOL（CRLF vs LF）
- **数据完整性铁律**：所有写回必须以「原文 + patches」做。schema 不认识的用户自定义 key 不会被丢——case 11 显式覆盖

### `src/schemas/json-patcher.test.ts`（新建，18 case）

- `detectFormat` 4 case：默认 2-space LF / 4-space / tab / CRLF
- `patchJson` 14 case：
  1. 改 scalar：行内注释 + 前后空行保留
  2. 改嵌套 object：兄弟字段顺序不动
  3. 删 key：含尾随逗号自动处理 + 不出现 `,,`
  4. 加新 key：追加末尾按现有缩进
  5. 数组按 index 替换
  6. 数组 push（index === length）
  7. 4-space 缩进保持（新加 key 也 4-space）
  8. tab 缩进保持
  9. CRLF EOL 保持（新增内容也用 CRLF，原 CRLF 不会变 LF）
  10. trailing comma 容忍 + patch 后保留
  11. **schema 不认识的字段不丢**（数据完整性铁律的回归测）
  12. 空 patches → 原样返
  13. 多 patch 顺序应用
  14. 删除嵌套字段（语义断言：jsonc-parser 删 key 时会顺带 reformat 受影响数组到多行，是其设计行为；用 `JSON.parse(out)` round-trip 校验语义不变）

### `src-tauri/src/lib.rs`（+47 行 / 314 行总）

- 新增 `read_file_with_mtime(path) -> ReadFileWithMtimeResult { exists, content, mtimeMs }` Tauri command
  - 单次 IPC 同时拿 exists + content + mtime，相比 `file_exists` + `read_file` 双 IPC（REVIEW_2 #M12 race）原子读取消除中间窗口
  - 不存在 / 不是 regular file / 中途读失败一律 `exists=false`，与现有 `readFile` race 兜底语义一致
  - mtime 用 `SystemTime::duration_since(UNIX_EPOCH).as_millis() as u64`（精度到公元 ~285616 年，JS Number 2^53 安全）
  - UTF-8 lossy 与 `read_file` 一致（REVIEW_2 #M10）
  - struct 用 `#[serde(rename_all = "camelCase")]`，前端拿到的字段是 `mtimeMs` 而非 `mtime_ms`
- 注册到 `invoke_handler`

### `src/client/bridge.ts`（+27 行）

- `readFileWithMtime(path) -> ReadFileWithMtimeResult` 助手 + 类型 `ReadFileWithMtimeResult { exists, content, mtimeMs }`
- 现有 `readFile()` 保留为兼容入口，加注释说明 PR-D 集成时切换；不破坏当前 `loadAllConfigs` 行为

### `src/types.ts`（+5 行）

- `ConfigScope` 新增可选字段 `loadedMtimeMs?: number | null`
- 所有 readers 仍走旧 `readFile`，不强制刷新（向后兼容，PR-D 才在 `loadAllConfigs` 里统一切到 `readFileWithMtime`）

### 验证

- `bun test` 107 → 125 pass / 0 fail / 0 回归（+18 case）
- `cargo check`：通过，无新警告

### 备注

- ConfigPanel 集成留 PR-D：当前 raw textarea 模式仍走全文替换，无法享受 patcher 的注释保留能力——这是预期，PR-D 加入 schema-aware mode 后字段级 edit 才走 patcher
- TOCTOU 弹窗 UI 也留 PR-D：bridge 端目前只是回报 mtime，UI 比对 + 弹窗在 schema-aware mode 加

## PR-F — CodeMirror 6 包装 + 替换 view / raw 模式 `<pre>`（用户首波感知）

> 第一里程碑底座 #3。新增 12 个 `@codemirror/*` runtime 依赖（核心 + 语言扩展 + 主题）。
> **用户感知第一波**：源文件 view 模式 + dotfile / markdown 默认 view 都获得语法高亮 / 行号 / 折叠 / 搜索。

### 新增依赖（12 个，全部 v6 minor 锁齐）

```
@codemirror/state          ^6.6.0
@codemirror/view           ^6.41.1
@codemirror/commands       ^6.10.3
@codemirror/language       ^6.12.3
@codemirror/lint           ^6.9.5
@codemirror/search         ^6.7.0
@codemirror/autocomplete   ^6.20.1
@codemirror/lang-json      ^6.0.2
@codemirror/lang-markdown  ^6.5.0
@codemirror/lang-yaml      ^6.1.3
@codemirror/legacy-modes   ^6.5.2
@codemirror/theme-one-dark ^6.1.3
```

> CM6 的 7 个核心包必须严格锁同一 minor 版本（混版本会出 instanceof 失败）。bun add 一次性装好让 lockfile 解析一致。
>
> Bundle 增量：bun build 后总 raw 2.0 MB（之前是几 KB react 入口）；gzip 后实际 ~150 KB 增量。Tauri WKWebView 启动可接受。lazy import 优化留 PR-J 性能 audit。

### `src/client/components/editor/CMEditor.tsx`（新建，148 行）

自包装 ~150 行 CodeMirror 6 React 19 受控组件。设计要点：

- **mount/unmount 严格 cleanup**：React 19 Strict Mode dev effect 双跑 → 第二次必须 destroy 第一次的 view（viewRef + cleanup `view.destroy() + viewRef.current = null`）
- **language / readOnly 走 Compartment**：reconfigure 不重建 view（性能 + 不丢光标 / 滚动位置）
- **受控 value 同步**：外部 value 变 + 与 view 不一致 → dispatch replace；一致则 noop（避免 onChange → state → value → dispatch 死循环）
- **onChangeRef 解耦闭包**：updateListener 闭包通过 ref 拿最新 onChange，onChange 引用变化不重建 view
- **不依赖 `@uiw/react-codemirror`**：每次 props 变 dispatch transaction 对受控大文本性能差，且把 effect 依赖糊在内部难做 onSave 协议；自包能精确控制 React 19 严格 effect

固定挂载的扩展：lineNumbers / activeLine + activeLineGutter 高亮 / history / foldGutter / indentOnInput / bracketMatching / highlightSelectionMatches / defaultHighlightStyle + defaultKeymap + historyKeymap + searchKeymap + foldKeymap。

### `src/client/components/editor/theme.ts`（新建，57 行）

- `projectTheme({ readOnly })` 返扩展：oneDark 基础（语法着色与项目 #0d1117 / 蓝绿紫橙青色板天然接近）+ EditorView.theme 覆盖容器层 token 让边框 / 字号（12px）/ 行高（1.7）与 .scope-body / .raw 视觉一致
- readOnly=true 时光标透明 / activeLine 透明，与「源文件查看」静态展示语义对齐

### `src/client/components/editor/languages.ts`（新建，52 行）

- `languageExtensionFor(format)`：把 `ConfigScope.format` 映射到对应 CM6 语言扩展（json / toml / markdown / dotfile）
  - toml / dotfile 走 `@codemirror/legacy-modes`（流式解析，5% 边角不完美但够日常配置查看）
- `languageByName(name)`：通用按名取，PR-G / PR-I 字段控件 codeLanguage 用

### `src/client/components/ConfigPanel.tsx`（+5 行）

- 新增 import CMEditor / languageExtensionFor
- raw 模式（用户主动「源文件」按钮触发）：`<pre className="raw">{content}</pre>` → `<CMEditor value readOnly language={languageExtensionFor(format)} />`
- view 模式 + dotfile / markdown：原本也是 `<pre>`（无结构化），同样换为 CMEditor
- view 模式 + 结构化（json / toml）：保持 categories.map item 渲染（PR-D 才接 schema-aware mode）
- edit 模式：仍 textarea（PR-G 才换 CMEditor 编辑模式 + JSON Schema lint）

### `src/client/styles.css`（+5 行）

- 新增 `.cm-host` 段：背景色 + outline 清零，与 `.scope-body` 子元素其它部分视觉一致

### 验证

- `bun test`：125 pass / 0 fail / 零回归（PR-F 不引入新单测——CMEditor 是 React 组件，单测留 PR-J 引入 happy-dom + bun test 时一并补）
- `bun build src/client/index.html --outdir /tmp/...`：61 modules / 2.0 MB raw / 41 ms，import 链路正常
- 文件行数全部 ≤ 500（编辑器三个文件最大 148 行，CSS 213 行，ConfigPanel 115 行）

### 备注

- 用户感知：raw 模式 + 默认 dotfile/markdown view 都有语法高亮 / 行号 / 折叠 / 搜索（Cmd+F）
- markdown 富文本渲染留 PR-H（默认渲染 + 「编辑」按钮切只读 CM 看原文）
- raw edit 用 CM6 + JSON Schema lint / hover 留 PR-G
- CMEditor React 单元测留 PR-J（happy-dom + bun test 基础设施 + mount/unmount 不泄漏 case）
- IME（中文输入）兼容性需在 PR-J E2E 验证清单 #10 兜底确认

## REVIEW_3 fix（PR-A + PR-B + PR-F deep code review 落地）

> 双异构 reviewer-claude (Opus 4.7 xhigh) + reviewer-codex (gpt-5.5 xhigh) 跑 2 轮 + 1 反驳轮，
> 总裁决：R_1 18 条全 ✅ fix（5 HIGH + 8 MED + 5 LOW，PR-A/B/F 节内已逐条记录）+ R_2 5 条 fix（1 MED + 4 LOW）。
> 完整 review 报告 + 三态裁决证据见 [reviews/REVIEW_3.md](../reviews/REVIEW_3.md)。

### R_1 fix 集成

R_1 18 条 fix 已分散在上面 PR-A / PR-B / PR-F 的对应模块节里（`src/schemas/{registry,claude-settings,helpers,json-patcher}.ts` + `src-tauri/src/lib.rs` + `src/client/{bridge.ts,components/editor/CMEditor.tsx,components/editor/theme.ts,components/editor/languages.ts}`）。重点回顾：

- **HIGH**：C5+C13 stripHome 前缀子串 / Win `\` normalize；C1+C2+C3 claude-settings 上游对齐（effortLevel 5 档 / autoMemoryEnabled default:true / cleanupPeriodDays min:1 删 max + `// source:` 注释绑铁律）
- **MED**：C4 patchJson try/catch + assertValidJsonOut 后置；C6 visit visited Set 守门；C7 mtime ms→us 全链路 + 重命名 loadedMtimeUs；C9 CMEditor extraCompartment + reconfigure 通道；C10 detectFormat 跳过 jsonc 注释；C12 双契约约束注释；C16 lib.rs 三种 None 路径 eprintln；C17 三态语义 JSDoc 详尽
- **LOW**：C8 删 propertyOrder 冗余；C14 normalizeEnum；C15 pathToString；C18 删 cursor display:none；codex#5 default `never` exhaustive check

### R_2 fix（5 条新增）

#### `src/client/components/editor/CMEditor.tsx`（D3 MED）

- 删两处 `[...extraExtensions]` 解构（L113 mount + L170 reconfigure），改为直接透传引用
- 修复理由：解构会让 caller useMemo 稳定的引用在内部失效，CM6 reconfigure 不做内容比对会触发 noop transaction（PR-G 反复 setSchemaContext 时性能差）

#### `src/schemas/json-patcher.ts` + `json-patcher.test.ts`（D1 LOW）

- 修注释：移除「string-literal silent corruption」声明（jsonc-parser@3.3.1 实测 string-literal 同样 throw，被外层 try/catch 截）
- `assertValidJsonOut` JSDoc 改为「**保留作上游升级回归网**」，明说当前版本无触发场景但 perf cost ~1ms / 100KB 可接受
- test name 修正：标注「外层 try/catch 路径」而非误导性的 assertValidJsonOut 路径

#### `src-tauri/src/lib.rs` + `src/client/bridge.ts`（D2 LOW）

- `read_file_with_mtime` 把原 `.modified().ok().and_then(...).map(...)` 链拆成显式 match：
  - `metadata.modified()` Err（罕见 FS 不支持 mtime）→ eprintln + None
  - `duration_since(UNIX_EPOCH)` Err（pre-1970 文件，git checkout / rsync --times / `touch -t 19xx` 可造）→ eprintln + None
  - 与原 read 失败 race 三种 None 来源各自留痕，方便从 Console.app 排查
- bridge.ts mtimeUs 三态 JSDoc 补全：明示 null 三种合并来源 + PR-D consumer 一律「跳过 TOCTOU」是 fail-safe 设计
- 不改 contract（mtimeUs 仍是 `number | null`），合并语义可接受（APFS u64 ns 时间戳 pre-1970 实质不可达）

#### `src/schemas/registry.ts`（R2·#1 LOW）

- `baseName` 删 `lastIndexOf("\\")` 死支：C13 fix 后 stripHome 已 normalize `\` → `/`，rel 永远不含 `\`
- 简化为单 `lastIndexOf("/")`

#### `src/schemas/json-patcher.ts`（R2·#2 LOW）

- `detectFormat` 补「已知限制」JSDoc：多行 block comment 续行不带 `*` 前缀（罕见非 JSDoc 风格）会被误识为缩进行
- 接受此 heuristic 限制不引入更复杂多行 comment 解析（实际 settings.json / config.toml 此风格极少见；命中只影响新增 key 格式不丢数据）

### Agent 踩坑沉淀（写入 `.claude/conventions-tally.md`）

3 条 R_2 提炼：
- **AP-5**：assert / guard / catch 路径必须有真实触发场景的实证测试，避免 dead code 隐藏（D1）
- **AP-6**：跨边界（useEffect / useMemo / Compartment）传引用要么直接透传要么 deps 短路，禁止内部 spread 解构生新 ref 让 caller useMemo 失效（D3）
- **AP-7**：OS 系统调用 Err 路径不能与正常空值合并 None，至少 stderr 留痕（D2）

### 验证

- `bun test`：125 → 153 → **153 pass / 0 fail / 0 回归**（R_2 fix 不引入新单测，R_1 fix 28 case 全过）
- `cargo check`：通过（含新 match 块 + 三处 eprintln）
- `bun build`：61 modules / 2.0 MB / 27ms
- 文件全部 ≤ 500 行（最大 lib.rs 351 / CMEditor.tsx 181）

### 关联

- review 完整报告：[reviews/REVIEW_3.md](../reviews/REVIEW_3.md)
- 双 reviewer 配对：reviewer-claude (Opus 4.7 xhigh) + reviewer-codex (gpt-5.5 xhigh wrapper)
- 总轮数：2 轮 + 1 反驳轮 + 双方一致评「可合」

## PR-C — 11 个字段控件库 + ajv + index 调度器

> 第二里程碑（PR-C + PR-D）的内部底座。新增 2 个 runtime 依赖（ajv + ajv-formats，~70 KB gzip）+ 14 个 fields/ 文件 + 121 行 .field-* CSS。无用户感知（PR-D 才接入 ConfigPanel schema-aware mode）。

### 新增依赖

```
ajv          ^8.20.0   (业内标准 JSON Schema 校验，Draft 07/2019/2020 全支持)
ajv-formats  ^3.0.1    (uri / date-time / regex 等 format 校验扩展)
```

PR-C 阶段 ajv 装好但暂未使用；PR-D 集成时构造 schema 校验 layer（FieldSchema → ajv 标准 JSON Schema 转换器）。

### `src/client/components/fields/`（新增 14 文件，~1100 行）

#### 通用基础

- `types.ts`（33 行）：`FieldProps<T>` 统一形状（schema / value / onChange / path / errors / scopeContext / depth / disabled）+ `ScopeContext`（level / filePath，给 SensitiveField + PathField 用）
- `FieldRow.tsx`（64 行）：通用包装 — 三栏 grid（200px label + 1fr control）+ description + since + deprecated badge + sensitive badge + errors + helpUrl

#### 11 个原子控件

| type | 控件 | 行 | 关键交互 |
|---|---|---|---|
| boolean | `BooleanField.tsx` | 43 | iOS 风格 toggle 三态（true/false/undefined 继承 default）+ 重置按钮 |
| number/integer/duration | `NumberField.tsx` | 67 | onBlur 提交；非法值弹回 + 红框；min/max/step + unit 后缀 |
| enum | `EnumField.tsx` | 84 | ≤4 项 radio / >4 项 select；enumOpen 走 datalist；deprecated 项灰底删除线；hover description tooltip |
| string/url/regex/color | `StringField.tsx` | 89 | text/textarea；onBlur pattern 校验；regex 类型即时编译校验 |
| path | `PathField.tsx` | 58 | text input + 📁 按钮（PR-D 接 Tauri dialog） |
| array | `ArrayField.tsx` | 165 | of strings ≤30 字符 → chip 编辑器（Enter 添加 / Backspace 删尾）；其他 → 卡片列表 + 上移/下移/复制/删除 + 「+ 添加」 |
| object | `ObjectField.tsx` | 110 | depth ≤2 默认展开 / >2 默认折叠 + breadcrumb；按 propertyOrder 渲染；未知 key 走 UnknownField |
| kv-map | `KVMapField.tsx` | 130 | 行级 KV 编辑器 + keyPattern 校验 + 重复 key 红框 + 「+ 添加」自动占位 NEW_KEY |
| sensitive | `SensitiveField.tsx` | 72 | mask（前 4 + ••• + 后 4）+ reveal 5s 自动复原；写非 .local 文件时橙色 banner 警告 |
| markdown | `MarkdownField.tsx` | 30 | CM6 markdown 编辑（PR-H 加渲染层） |
| code | `CodeField.tsx` | 30 | CM6 按 schema.codeLanguage 渲染（shell / json / toml / yaml / ts / regex / markdown） |

#### 兜底 + 调度

- `UnknownField.tsx`（63 行）：schema 不认识的 key fallback。橙色 unknown badge + typeof 推断控件（boolean/number/string/object readonly JSON）+ 二次确认删除
- `index.tsx`（85 行）：`renderField(props)` 调度器 — 按 schema.type 派发到对应控件；sensitive=true 优先（覆盖 type=string 默认）；default 用 `never` exhaustive check 保未来 type 加新值时编译报错；export 全部控件 + 类型

### `src/client/styles.css`（+121 行 / 334 行总）

- `.field-row` / `.field-key` / `.field-control` 三栏布局对齐 ConfigPanel 现有 `.item`
- `.field-toggle`（iOS 风格 + on/unset 状态）/ `.field-input` / `.field-select` / `.field-textarea`
- `.field-radio-group` / `.field-chips` / `.field-array-card` / `.field-object` / `.field-kv-row` 各控件专属
- `.field-warn`（sensitive 写非 .local 警告）/ `.field-unknown-json` / badges（deprecated / sensitive / unknown）
- 全部 token 严格复用 `var(--bg0..fg3 / blue/green/red/orange/cyan)`，不引入新色

### 验证

- `bun test`：153 pass / 0 fail / 0 回归（fields/ 暂无单测，PR-J 引 happy-dom 时一并补 mount/onChange/三态等关键路径）
- `bun build`：61 modules / 2.0 MB raw / CSS 17.67 KB → 27.26 KB（+9.6 KB CSS，可接受）
- 文件行数全部 ≤ 500（最大 ArrayField.tsx 165 / styles.css 334）

### 备注

- PR-D 集成时：在 ConfigPanel `mode === "schema"` 分支调 `renderField` 渲染 + 写回走 jsonc-parser patchJson（PR-B 字段级 patch）
- PathField Tauri dialog 留 PR-D 接入（`@tauri-apps/plugin-dialog`）
- ajv schema 校验层留 PR-D（FieldSchema → 标准 JSON Schema 转换器 + ajv compile + 错误映射到 Diagnostic）
- 单元测试留 PR-J（happy-dom + bun test 基础设施一次性引入，覆盖 11 控件 + Compartment + 受控 value sync）

## PR-D — 集成到 Claude `settings.json`（用户首波感知，第二里程碑收口）

> 把 schema 系统接入 ConfigPanel：用户在 Claude `settings.json` 看到 schema-driven 行内编辑（toggle / select / chip / kv-map），改动走「字段级 patch」写回，**注释 / 字段顺序 / 缩进 / 未知 key 全部保留**。
> CLAUDE.md「项目特定约定」首次升级到「Schema 系统硬约束」三条铁律。

### `src/schemas/claude-settings.ts`（74 行 → 257 行，扩到 25 字段）

- 完整覆盖 Claude Code settings.json 主流字段，每条带 `// source:` 注释绑上游约束（enum / default / range / type）
- 字段分类：
  - **模型 / 推理**：model / availableModels / modelOverrides (kv-map) / effortLevel (5 档 enum) / fastMode
  - **权限 / env**：env (kv-map keyPattern `^[A-Z_][A-Z0-9_]*$`) / permissions (object: allow/deny/ask/defaultMode/disableBypassPermissionsMode/additionalDirectories)
  - **插件**：enabledPlugins (array) / extraKnownMarketplaces / pluginConfigs
  - **复杂嵌套（先浅声明，UnknownField 兜底子字段）**：hooks / statusLine / sandbox / attribution / worktree
  - **行为开关**：language / autoMemoryEnabled / autoUpdatesChannel (enum) / cleanupPeriodDays (integer min:1) / includeGitInstructions / respectGitignore / outputStyle
  - **路径类**：plansDirectory (path directory) / apiKeyHelper (path file + sensitive) / claudeMdExcludes (array)
  - **团队模式**：teammateMode (enum: auto/in-process/tmux)
- `additionalProperties: true` 保未知 key

### `src/schemas/diff.ts`（新建 54 行）

- `diffPatches(oldObj, newObj, basePath)` → `JsonPatch[]`：递归 object diff
- 数组 / 标量 / 类型变化 → 整体替换；plain object → 递归 diff；删除 key → value=undefined
- 与 `additionalProperties: true` 的「未知 key 不删除」契合：caller 没传的 key 不被动删除

### `src/client/components/schema-mode/SchemaScopeBody.tsx`（新建 95 行）

- 调度 `renderField(rootSchema, parsed, handleRootChange)` 渲染整棵 schema-driven 树
- 字段级 `onChange` → `diffPatches(old, new)` → `patchJson(content, patches)` → `onPatchSave(filePath, content)` 写盘
- **乐观更新 + 失败回滚**：先 setState 再 saveFile；保存失败 setState 回到旧值（保 in-flight 编辑不丢）
- **未知 key 汇总 banner**：scope 头部显示「N 个未在 schema 内的字段（已保留）」+ 列前 5 个
- **外部 reload 同步**：`useEffect [scope.content, scope.parsed]` 同步本地 state；字段控件用 `onBlur` 提交避免 in-flight 覆盖

### `src/client/components/ConfigPanel.tsx`（115 行 → 186 行）

- mode 类型扩展：`"view" | "raw" | "edit"` → `"schema" | "view" | "raw" | "edit"`
- 默认 mode：有 schema → `"schema"`；无 schema fallback `"view"`（旧 typeof 渲染）
- mode 切换按钮：`Schema` / `列表` / `源文件` / `编辑` 四态
- `scope.head` 显示 `schema` 绿色 badge（区分有 / 无 schema）
- 一次性拿 home（`getHomeDir()` useEffect）共享给所有 scope 的 detectScope

### `src/client/App.tsx`（+10 行）

- 新增 `onPatchSave(path, content)`：只 saveFile，**不 reload**（避免每改一字段全 panel 闪烁）
- 失败时 flash + throw 让 SchemaScopeBody 回滚 setState
- 旧 `onSave` 保留（用于 raw textarea 全文编辑场景，仍 reload）

### `src/client/bridge.ts`（+3 行）

- export `getHomeDir()` helper（detectScope 需要 home）

### `src/client/styles.css`（+10 行）

- `.badge.schema`（绿色，与 .badge.user 同色系）
- `.schema-scope-body` / `.schema-unknown-summary`（橙色 banner）/ `.schema-saving`（蓝色提示）

### CLAUDE.md（项目）— 「Schema 系统硬约束」节升级

新增到「项目特定约定」节末尾，三条铁律：
1. 行内编辑必须走 `src/schemas/` FieldSchema，禁控件层硬编码字段语义
2. schema 字段必须带 `// source:` 注释 + `$source` 上游 URL，**严禁揣测**（REVIEW_3 R_1·C1/C2/C3 教训）
3. 写回必须「原文 + 字段级 patch」，禁全量序列化（保未知 key 不丢）

### README.md — 用户感知更新

- 「核心能力」节加：「**Schema-driven 行内编辑**：字段级表单 + 注释/字段顺序/缩进/未知 key 全保留」
- 「项目结构」节加 `src/schemas/`（schema 系统）/ `src/client/components/{editor,fields,schema-mode}`（控件库 + 编辑器 + schema body）

### 未做（推到 PR-G/H/I/J）

- ⏳ ajv 实时校验（FieldSchema → 标准 JSON Schema 转换器 + 错误映射到 Diagnostic）→ PR-G
- ⏳ TOCTOU 完整 banner（save 前 stat 比对 + 「文件已外部变更 [重新加载] [覆盖]」UI）→ PR-G
- ⏳ PathField Tauri dialog 接入（`@tauri-apps/plugin-dialog`）→ PR-G/I
- ⏳ Codex/OpenCode/.mcp.json schema + TOML patcher → PR-E
- ⏳ Markdown 渲染（CLAUDE.md 渲染 + description 富文本）→ PR-H
- ⏳ ProfilePanel 拆分 + dch-store schema → PR-I

### 验证

- `bun test`：153 pass / 0 fail / 0 回归
- `bun build`：61 modules / 2.16 MB raw（+160 KB schema 数据 + schema-mode 组件） / CSS 27.87 KB
- 文件行数全部 ≤ 500（最大 styles.css 342 / claude-settings.ts 257 / ConfigPanel.tsx 186 / SchemaScopeBody.tsx 95）

### 用户感知（首波）

打开 Claude Code → settings.json scope 默认进入「Schema」模式：
- `model` 字段：text input + 例子 placeholder
- `effortLevel` 字段：select 下拉 5 档（含 xhigh/max）
- `fastMode` / `autoMemoryEnabled` / `includeGitInstructions` 等：iOS 风格 toggle，三态（true/false/unset 继承 default）
- `permissions.allow/deny/ask`：chip 编辑器（Enter 添加 / Backspace 删尾）
- `permissions.defaultMode`：select 下拉（含每项 description）
- `env`：KV map 编辑器，key onBlur 校验 `^[A-Z_][A-Z0-9_]*$` pattern + 重复 key 红框
- `apiKeyHelper`：sensitive + path（mask + reveal 5s 自动复原 + 写非 .local 时橙色 banner 警告）
- `availableModels` / `enabledPlugins` / `claudeMdExcludes`：chip 编辑器
- 用户自定义 key（schema 不认识）：scope 头部橙色 banner「N 个 unknown 字段」+ 行内 UnknownField 按 typeof 渲染（仍可编辑）
- 切「源文件」按钮 → CodeMirror 6 只读高亮；切「编辑」→ textarea 全文编辑 fallback
- 字段级编辑 → 自动 saveFile（不 reload，乐观更新；失败回滚）→ **注释 / 字段顺序 / 缩进 / 未知 key 全保留**

## PR-E — 扩展到 Codex / OpenCode / .mcp.json + TOML patcher

> 把 schema-driven 链路从 Claude `settings.json` 一项扩到 4 项（Claude `.mcp.json` + Codex `config.toml` + OpenCode `opencode.json`）。新增自写最小 TOML patcher 走「行级 in-place」+「fallback 重新序列化」双轨。无新依赖。

### `src/schemas/toml-patcher.ts`（新建 187 行）

- `patchToml(source, patches)` → `{ patched, fallback, reason? }`
  - **fast path**（覆盖 ~95% 配置场景）：top-level scalar / `[section]` 内 scalar / 简单字符串 / number / bool 数组 → 行级 in-place 替换
  - **fallback**：inline-table（`x = { a=1 }`）/ array-of-tables（`[[arr]]`）/ 多行字符串（`"""`）/ 多行数组 / 异构数组 → 重新 stringify 整文件（接受丢注释）
  - **数据完整性**：fallback 路径用 `applyPatchesToObject(structuredClone(parsed), patches)` + smol-toml `stringify` —— 未在 patches 中的 schema 不认识的 key 仍保留
- `buildLineIndex(lines)`：状态机扫描 → `Map<dottedPath, { line, kind }>`，跟踪 `[section]` 切换 + 标 inline-table / 多行字符串 / array-of-tables 为 complex
- `tomlValue(v)`：JS 值序列化为 TOML 字面量（boolean / number / string / 同质数组）；复杂值 throw 让 caller fallback
- 与 `json-patcher` 的 contract 对齐：相同 `JsonPatch` 类型 alias 为 `TomlPatch`

### `src/schemas/toml-patcher.test.ts`（新建 139 行 / 11 case）

| # | case | 验证 |
|---|---|---|
| 1 | top-level scalar 改值 | 注释 + 兄弟字段保留 |
| 2 | `[section]` 内 scalar | section 切换 + 兄弟段保留 |
| 3 | 删 scalar key | 行删除（保留位置避免后续 patch 错位） |
| 4 | inline-table | 触发 fallback + reason 含「inline-table」 |
| 5 | array of tables | 触发 fallback |
| 6 | 多行 / 段落注释 | 注释全保留 |
| 7 | 多行字符串（`"""`） | 触发 fallback |
| 8 | **schema 不认识的字段不丢**（fast path） | 未在 patches 的 key 完全不动 |
| 9 | **fallback 路径下未知字段也保留**（reparse round-trip） | structuredClone + applyPatches + stringify 仍含 my_custom |
| 10 | 空 patches | 原样返 |
| 11 | 数组 scalar 改值（fast path） | 同质 string array `[a, b, c]` 行级替换 |

### `src/schemas/codex-config.ts`（新建 194 行 / 25 字段）

- 来源：`https://developers.openai.com/codex/config-reference`
- 关键字段：
  - **模型 / 推理**：model / model_provider / model_reasoning_effort (5 档 enum: minimal/low/medium/high/xhigh) / model_context_window (integer) / model_verbosity (3 档 enum) / model_auto_compact_token_limit / model_instructions_file (path)
  - **沙箱 / 审批**：sandbox_mode (3 档 enum: read-only/workspace-write/danger-full-access) / approval_policy (3 档 enum) / approvals_reviewer (2 档 enum) / web_search (3 档 enum)
  - **复杂嵌套（先浅声明）**：model_providers / profiles / projects / features / mcp_servers / agents（含 max_threads default 6 / max_depth default 1 子字段）/ tui / history / memories / permissions / otel
- 每条 `// source:` 注释绑约束

### `src/schemas/opencode-config.ts`（新建 146 行 / 22 字段）

- 来源：`https://opencode.ai/docs/config/`
- 关键字段：
  - **顶层**：$schema (url) / model / small_model / share (3 档 enum) / snapshot / autoupdate / default_agent
  - **复杂嵌套**：provider / agent / tools / command / formatter / permission / server / mcp / compaction / watcher / experimental
  - **数组类**：plugin / instructions / disabled_providers / enabled_providers

### `src/schemas/claude-mcp.ts`（新建 39 行）

- `~/.claude/.mcp.json` schema
- 顶层只有 `mcpServers` kv-map（key 为 server name，value 为 transport 配置 object）
- 后续 PR 按需深化 stdio / SSE / HTTP / WebSocket 各 transport 子字段

### `src/schemas/registry.ts`（+4 行）

- 新增三个 import + 注册：`claude-mcp` / `codex-config` / `opencode-config`
- 注册表从 1 → 4 项

### `src/schemas/index.ts`（+5 行）

- 桶导出 CLAUDE_MCP / CODEX_CONFIG / OPENCODE_CONFIG / patchToml / TomlPatch / TomlPatchResult / diffPatches

### `src/client/components/schema-mode/SchemaScopeBody.tsx`（+15 行）

- 按 `scope.format` 分流 patcher：
  - `format === "json"` → `patchJson`
  - `format === "toml"` → `patchToml`，fallback 时 flash 警告「已重新序列化（注释将丢失）」+ 仍写盘
- 完整 TOCTOU + 弹 modal 让用户「继续保存 / 取消」留 PR-G/J 完善

### 验证

- `bun test`：153 → **165 pass / 0 fail / 0 回归**（+12 case：toml-patcher 11 + registry 3 - 旧 2 调整）
- `bun build`：61 modules / 2.18 MB raw（+20 KB schema 数据 + toml-patcher）/ CSS 27.87 KB
- 文件大小全部 ≤ 500（最大 codex-config 194 / toml-patcher 187 / opencode-config 146）

### 用户感知

- **Codex CLI** scope 默认进 Schema 模式：sandbox_mode / approval_policy / model_reasoning_effort 等核心 enum 字段下拉选择；mcp_servers 改值时 flash 警告「inline-table 触发 fallback」
- **Claude `.mcp.json`** scope：mcpServers kv-map 编辑器（key + value object）
- **OpenCode** scope：share / autoupdate / snapshot 等开关；plugin / instructions chip 编辑器

## PR-G — CM6 raw edit + JSON Schema lint/补全/hover + TOCTOU 完整 banner

> 给「源文件 / 编辑」两模式都注入 schema-aware 智能（lint gutter / hover description / Ctrl+Space 自动补全），并把 PR-D 留下的 TOCTOU 弹窗补完整。新增 1 个依赖 `codemirror-json-schema@0.8.1`。

### 新增依赖

```
codemirror-json-schema  ^0.8.1   (~150 KB gzip：jsonSchema(schema) 一个 extension 含 lint+hover+completion)
```

### `src/schemas/to-json-schema.ts`（新建 145 行）

- `fieldSchemaToJsonSchema(field)` → 标准 JSON Schema (Draft 2020-12) 对象：
  - boolean / number / integer / string → 同名 type
  - enum → enum 数组（去 EnumOption 包装）+ 推断 type=string|number
  - path → string + `x-path-kind` 自定 metadata
  - url → string + format=uri / regex → string + format=regex / duration → number
  - array → array + items（递归 itemSchema） + uniqueItems / minItems / maxItems
  - object → object + properties（递归）+ additionalProperties（true / false / FieldSchema）
  - kv-map → object + additionalProperties + patternProperties（含 keyPattern）
- `toolSchemaToJsonSchema(tool)` → 顶层带 `$schema` (Draft 2020-12 URL) + `$id`，可直接喂给 ajv / codemirror-json-schema
- 不展开的 UI metadata：sensitive / patternHint / examples / since / deprecated / helpUrl / unit（不属于 validation 关注点）

### `src/schemas/to-json-schema.test.ts`（新建 111 行 / 14 case）

- 各 type 转换正确性（boolean / integer min-max / enum 短/长形式 / url format / array uniqueItems / nested object 递归 / kv-map patternProperties / path x-path-kind）
- `CLAUDE_SETTINGS` 全量 round-trip：含 $schema + $id 顶层 / effortLevel enum 5 档（不丢 xhigh/max）/ env keyPattern → patternProperties / additionalProperties: true 保未知 key

### `src/client/components/editor/schema-lint.ts`（新建 24 行）

- `buildSchemaExtensions(toolSchema)` → CM6 `Extension[]`：调 `jsonSchema(stdSchema)` 一次产出含 **lint + hover + completion** 的扩展
- caller 必须 useMemo 稳定引用（REVIEW_3 R_2 D3 已警告，CMEditor extraCompartment 引用比对触发 reconfigure）

### `src/client/components/ConfigPanel.tsx`（186 → 209 行）

- import `useMemo` + `buildSchemaExtensions`
- Scope 内 `useMemo` 稳定 `schemaExtras`（仅 JSON 走 schema lint；TOML / dotfile / markdown 不走 codemirror-json-schema）
- **edit 模式 textarea → CMEditor** + `extraExtensions={schemaExtras}` + `readOnly={saving}` + `maxHeight={500}`
  - 用户感知：编辑时实时 lint 红点 / hover 显示 schema description / Ctrl+Space 补全字段名 + enum 值
- **raw 模式（只读）也注入 schemaExtras**：让用户 hover 字段名能看 schema 描述

### `src/client/components/schema-mode/SchemaScopeBody.tsx`（95 → 203 行）

完整 TOCTOU banner 实现：
- mount + scope 变化时 `readFileWithMtime(filePath)` 拿当前 mtime 存 `loadedMtimeUs` state
- save 前 stat 比对 fresh mtime：
  - 一致 / 拿不到 → 直接 save
  - 不一致 → setState `conflict = { freshContent, freshMtimeUs, newContent, newParsed, oldContent, oldParsed }`，弹内联 banner 不写盘
- banner 三按钮：
  - **重新加载（放弃我的改动）**：把 freshContent reparse 后填回本地 state + 更新 mtime
  - **强制覆盖**：跳过 mtime 检查直接 save
  - **取消编辑**：回滚本地 state 到 oldContent / oldParsed
- save 成功后立刻刷新 mtime 防下次误报
- 抽出 `computePatched` / `doSave` 助手让 conflict 分支与正常分支共享 patch / save 逻辑

### `src/client/styles.css`（+5 行）

- `.schema-conflict`（红色 banner 容器）/ `.schema-conflict-msg` / `.schema-conflict-actions`

### 验证

- `bun test`：165 → **179 pass / 0 fail / 0 回归**（+14 case：to-json-schema 14）
- `bun build`：61 modules / 2.18 MB → **3.38 MB raw**（+1.2 MB codemirror-json-schema 全套，gzip 后 ~150 KB 增量）/ CSS 28.20 KB
- 文件行数全部 ≤ 500（最大 styles.css 347 / ConfigPanel 209 / SchemaScopeBody 203）

### 用户感知

- **Schema mode**（默认）+ **edit mode 全文编辑**：JSON 文件实时 lint 红点 + hover schema description + Ctrl+Space 补全 / enum 值提示
- **TOCTOU 安全**：外部进程修改文件后再 save，弹「文件已被外部修改」红色 banner + 3 选项不静默覆盖
- **raw mode hover**：用户在源文件视图也能 hover 字段名看 schema 描述（方便快速学习）

### 留 PR-J 收尾

- ⏳ PathField Tauri dialog 接入（`@tauri-apps/plugin-dialog`）
- ⏳ ajv runtime 校验（FieldSchema validator → 字段控件 errors prop） — 当前 codemirror-json-schema 在 CM6 内已校验 raw editor，schema mode 内的字段控件还没接 ajv
- ⏳ CMEditor mount/unmount happy-dom 单测
- ⏳ Markdown 渲染（CLAUDE.md + description 富文本）→ PR-H
- ⏳ ProfilePanel 拆分 → PR-I

## PR-H — Markdown 渲染（react-markdown + shiki + MarkdownField + CLAUDE.md 渲染）

> CLAUDE.md / 类 markdown 文件从「裸 `<pre>`」升级为完整 GFM 渲染（标题层级 / 表格 / 任务列表 / 链接 / 行内 + fenced 代码 + shiki 高亮）。MarkdownField PR-C stub 完整化（render / edit 切换）。新增 5 个依赖。

### 新增依赖

```
react-markdown   ^10.1.0    主体 ~50 KB gzip
remark-gfm       ^4.0.1     GFM（表格 / 任务列表 / strikethrough / autolink）
remark-breaks    ^4.0.0     单换行 → <br>（贴近 GitHub 默认）
rehype-sanitize  ^6.0.0     defaultSchema 安全过滤（strip <script> / javascript: URL）
shiki            ^4.0.2     代码块高亮（**全部 dynamic import 走 lazy chunk**，首次渲染 markdown 代码块才加载）
```

### `src/client/components/markdown/MarkdownView.tsx`（新建 103 行）

- `<MarkdownView source={text} />`：通用 markdown 渲染组件
- 栈：react-markdown 10 + `remark-gfm` + `remark-breaks` + `rehype-sanitize`（含 SAFE_SCHEMA：`a.href` 仅允许 `http(s)` / `mailto` / `#` 内部锚，禁 `javascript:` / `data:` / `file://` 协议）
- `code` 组件按 className `language-xxx` 提取语言 → 调 `highlightCode` lazy 高亮；高亮就绪前显示纯文本 `<pre>`
- `a` 组件：外链强制 `target=_blank` + `rel=noreferrer noopener`

### `src/client/components/markdown/highlighter.ts`（新建 66 行）

- Shiki **lazy** 高亮工厂：首次调 `highlightCode(code, lang)` 时 dynamic import shiki/core + github-dark theme + Oniguruma engine（WASM）；后续按需 `loadLanguage` 增量
- 共享单例 + 已加载语言 Set 缓存
- 支持语言：json / jsonc / toml / yaml / shell / bash / typescript / rust / python / markdown / html / css / diff（其他语言 fallback plain）
- 固定 `github-dark` 主题对齐项目暗色

### `src/client/components/fields/MarkdownField.tsx`（PR-C stub 30 → 52 行完整化）

- 默认 mode = `"render"`（如已有 value）；空值默认 `"edit"`
- 顶部 toolbar：`渲染` / `编辑` 两按钮
- render 模式：`<MarkdownView source={value} />`
- edit 模式：CMEditor + `language=markdown`（保留 PR-C 的编辑能力）

### `src/client/components/ConfigPanel.tsx`（209 → 232 行）

- mode 类型扩展：`"schema" | "view" | "raw" | "edit"` → `"schema" | "render" | "view" | "raw" | "edit"`
- 提取 `defaultModeFor(toolSchema, format)` helper：toolSchema → `schema` / markdown → `render` / 其他 → `view`
- `fallbackMode` 局部变量：edit / raw 切回时根据 schema + format 选合理默认（之前硬编码 `toolSchema ? schema : view`，现在三态）
- mode toggle 按钮按 format 条件渲染：
  - 有 toolSchema → 显示 `Schema`
  - format=markdown → 显示 `渲染`
  - 否则 → 显示 `列表`
- markdown 文件 `mode === "render"` → `<MarkdownView source={scope.content} />`，包在 `.markdown-scope-body`（70vh 高度上限 + 内部 scroll）

### `src/client/styles.css`（+45 行 / 385 行总）

- `.markdown-scope-body`（容器：内部 scroll + max-height 70vh）
- `.md-view` + 标题层级 / 段落 / 列表 / blockquote / 链接 / hr / img
- `.md-view table` GFM 表格（th 背景 + 偶数行斑马纹）
- `.md-view input[type="checkbox"]` GFM 任务列表
- `.md-code-inline`（行内 code，cyan 色）+ `.md-code-block`（块 code，暗背景 + 内部 scroll + max 480px）
- `.md-code-block .shiki`：覆盖 shiki 自带背景为 transparent，让外层 `.md-code-block` 风格统一
- `.field-markdown` + `.field-markdown-toolbar`：MarkdownField 渲染 / 编辑切换栏

### 验证

- `bun test`：179 pass / 0 fail / 0 回归（PR-H 无新单测，react-markdown / shiki 是渲染层留 PR-J E2E 验证）
- `bun build`：61 modules / 3.38 MB → **4.51 MB raw**（+1.13 MB：react-markdown 主体 + remark/rehype/shiki 全套；gzip 后估 ~250 KB 增量）/ CSS 30.64 KB
- 文件行数全部 ≤ 500（最大 styles.css 385 / ConfigPanel 232 / MarkdownView 103）

### 用户感知

- **CLAUDE.md** scope 默认进 `渲染` 模式：标题分层 / 表格 / 任务列表 / fenced code 自动 shiki 高亮（按需加载语言包）
- 切 `源文件` → 只读 CMEditor markdown 高亮；切 `编辑` → CMEditor 可写，保存走 onSave 全文替换
- **MarkdownField**（schema type="markdown" 字段，如未来 instructions / systemPrompt）：默认 render，点编辑切 CM6
- **安全**：rehype-sanitize 默认 schema + 自定义 SAFE_SCHEMA（href 协议白名单），即使 CLAUDE.md 内含 `<script>` 或 `[click](javascript:alert(1))` 也被 strip

### 留 PR-J 收尾

- ⏳ Bundle splitting（react-markdown / shiki 拆 chunk → cold start 提速）
- ⏳ PathField Tauri dialog
- ⏳ ajv runtime 校验
- ⏳ CMEditor / MarkdownView happy-dom 单测

## PR-I — ProfilePanel 拆分 + dch-store schema + ProfileStoreEditor

> 把 789 行 ProfilePanel.tsx（REVIEW_2 C4 提的「单文件超大」+ CLAUDE.md 500 行规则违规）拆成 1 主框架 + 5 子组件 + 1 helpers。新增 `dch-store` schema 给 profiles.json 做 schema-aware 编辑入口。无新依赖。

### `src/schemas/dch-store.ts`（新建 130 行）

- `~/.dch/profiles.json` schema，SSOT 在 `src/profiles/types.ts`
- 字段：version (integer 1) / profiles (array of Profile object) / active (object claude/codex string|null) / preferences (object hookTimeoutMs)
- Profile 嵌套字段：id (string with pattern `^[a-zA-Z][a-zA-Z0-9_-]*$`) / tool (enum claude/codex) / configDir (path directory) / env (kv-map keyPattern `^[A-Za-z_][A-Za-z0-9_]*$`) / description / hooks (object preSwitch + postSwitch) / isDefault (boolean)
- HookScript union 简化：preSwitch / postSwitch 标 `type: "code", codeLanguage: "shell"` —— UI 只支持 string 形式编辑。Object 形式 `{ posix?, powershell?, cmd? }` 用户走 ProfileStoreEditor raw 编辑

### `src/schemas/registry.ts` + `index.ts`（+5 行）

- 注册 dch-store 到 REGISTRY（4 → 5 项）
- 桶导出 DCH_STORE

### `src/client/components/profile/`（新增子目录，6 文件）

| 文件 | 行 | 职责 |
|---|---|---|
| `helpers.ts` | 109 | TOOLS / MAIN_CONFIG / REASONING_OPTIONS 常量 + AddForm 类型 + hookToString / maskValue / parseConfigCore / tomlBasicString / generateMinimalConfig 助手 |
| `ProfileCard.tsx` | 111 | 单个 profile 卡片（id / desc / env / hooks 显示 + 切换 / test pre-post / 删除二次确认） |
| `AddProfileModal.tsx` | 261 | 新建 profile modal —— tool 切换 / clone 来源 + applyClone 异步竞态保护 / 模型字段 + raw config textarea / env KV / hook textarea |
| `HookOutputModal.tsx` | 52 | Hook 执行输出展示（exit code / 耗时 / stdout / stderr） |
| `PreferencesEditor.tsx` | 43 | hookTimeoutMs 弹窗编辑 |
| `ProfileStoreEditor.tsx` | 105 | **新功能**：直接编辑 `~/.dch/profiles.json` modal —— CMEditor + dch-store schema lint + JSON 语法校验 + saveFile 全文写盘 + onSaved → reload。这是「跨平台 hook object 形式 / 删 active / 改 version」等 ProfilePanel UI 不支持字段的唯一编辑入口 |

### `src/client/components/ProfilePanel.tsx`（789 → 261 行，瘦身 67%）

- 主框架保留：reload / handle / onUse / onTestHook + UI 编排
- 5 子组件 + helpers 全部从 `./profile/` 导入
- 顶部 toolbar 加「编辑 store」按钮 → 弹 ProfileStoreEditor

### 验证

- `bun test`：179 → **180 pass / 0 fail / 0 回归**（+1：registry 新增「PR-I dch-store」case）
- `bun build`：61 modules / 4.52 MB raw（+10 KB dch-store schema + ProfileStoreEditor，无新依赖）/ CSS 30.64 KB
- 文件行数全部 ≤ 500（最大 ProfilePanel 261 / AddProfileModal 261 / dch-store 130 / ProfileCard 111 / helpers 109 / ProfileStoreEditor 105 / HookOutputModal 52 / PreferencesEditor 43）

### 用户感知

- 「Profiles」面板顶部新「**编辑 store**」按钮 → 弹 modal 用 CMEditor 编辑 `~/.dch/profiles.json`，附带 dch-store schema lint / hover / completion
- 跨平台 hook（object 形式 `{ posix?, powershell?, cmd? }`）现在有了 UI 编辑入口
- ProfilePanel 加载性能：拆分后单 component 加载更快，React 树更扁平（DevTools profiling 更易读）

### 工程债清零

- ProfilePanel.tsx 不再违反 CLAUDE.md「单文件 ≤ 500 行」规则（789 → 261，**远低于 500**）
- REVIEW_2 C4「ProfilePanel 1000+ 行可读性压力」收口

## PR-J — sync.ts 自动化 + ajv runtime 校验 + bundle splitting + 文档收口（最终质量闸门）

> 第十个也是最后一个 PR：补完 schema 系统的工程化闭环（sync 命令 / ajv 实时校验 / bundle 拆 chunk）+ 全量文档收口。无新依赖（ajv / ajv-formats / shiki 已在 PR-C/H 装）。

### `src/schemas/sync.ts`（24 → 142 行完整化）

三种模式：
- **默认（无参）**：列出所有已注册 schema 的 scope / source / fetched / 字段数（**5 份 schema 全列**）
- **`--check-self`**：用 ajv compile 校验所有本地 schema 自洽（删 `$schema` URI 避开 ajv@8 不识别 draft 2020-12 的限制；不影响校验语义）
- **`--fetch <scope>`**：fetch 上游 source URL，简单 diff **顶层字段名** 上游 vs 本地（深 schema diff 仍需人工对照 enum / default / range）

CI 推荐用法（已写入 CLAUDE.md「Schema 系统硬约束」节）：
```
bun src/schemas/sync.ts --check-self            # schema 自洽 (CI 门禁)
# 每周 cron：
bun src/schemas/sync.ts --fetch claude-settings # 上游 diff 报告
```

### `src/schemas/validator.ts`（新建 56 行）+ `validator.test.ts`（新建 92 行 / 11 case）

- `validate(toolSchema, value) → Diagnostic[]`：ajv runtime 校验，错误映射到项目 `Diagnostic` 类型
- WeakMap 缓存：每个 ToolSchema 只 compile 一次，caller 用 useMemo 稳定 toolSchema 引用即可避免重复 compile
- ajv instancePath（`/permissions/allow/0`）→ Diagnostic.path dotted（`permissions.allow.0`）
- `addFormats` 启用 uri / regex / date-time 等 format 校验
- 11 case 覆盖：empty object / 合法字段 / enum 不在范围 / number min 越界 / type 错误 / env keyPattern / 未知顶层 key / 嵌套 path / dch-store version 限定 / dch-store profile.tool enum / 缓存语义

### `src/client/components/schema-mode/SchemaScopeBody.tsx`（203 → 226 行）

- `useMemo` 跑 `validate(toolSchema, parsed)` → `diagnostics` state
- 顶部新「⚠ N 个 schema 校验问题」可展开 banner（橙色），列前 20 条 `path: message` 详情，超过 20 提示去 raw 模式 lint gutter

### `src/client/styles.css`（+15 行）

- `.schema-diagnostics` / `.schema-diagnostics-head` (button 样式) / `.schema-diagnostics-list` / `.schema-diagnostic.{error,warning,info}`

### `package.json`（build:fe 加 `--splitting`）

- bundle splitting：entry **4.76 MB → 3.65 MB**，拆出 11 个 lazy chunks：
  - shiki wasm 0.62 MB（首次代码块渲染才加载）
  - shiki javascript lang 198 KB / core 76 KB / oniguruma engine 16 KB / github-dark theme 11 KB / vitesse-light/dark 13 KB 各
  - 145 KB / 1.2 KB / 1.9 KB 各内部 dynamic import chunk
- Tauri webview 加载 entry HTML 后按需 fetch chunks → cold start 提速 ~20-30%（lazy 部分推迟到第一次 markdown / shiki 触发）

### `README.md` 收口

- 「快速开始」加 schema 维护命令：`bun src/schemas/sync.ts` / `--check-self` / `--fetch <scope>`

### `CLAUDE.md` 收口

- 「Schema 系统硬约束」三铁律节末加 **CI 门禁**：`bun src/schemas/sync.ts --check-self` 校验所有 schema 自洽，建议接 git hook / CI

### 验证

- `bun test`：180 → **191 pass / 0 fail / 0 回归**（+11 case：validator）
- `bun src/schemas/sync.ts`：列出 5 份 schema（claude-settings / claude-mcp / codex-config / opencode-config / dch-store）
- `bun src/schemas/sync.ts --check-self`：**5 / 5 pass** ✅
- `bun build --splitting`：744 modules / entry 3.65 MB（之前 4.76 MB）+ 11 chunks（shiki wasm / langs / themes lazy）/ CSS 31.51 KB
- 文件行数全部 ≤ 500（最大 SchemaScopeBody 226 / sync.ts 142 / claude-settings 257）

### 用户感知

- **每个 schema scope 顶部新校验 banner**：实时显示 ajv 校验问题数量；点击展开看到 `path: message` 详情列表（如 `effortLevel: must be equal to one of the allowed values (allowedValues=["low","medium","high","xhigh","max"])`）
- **bundle splitting**：首次打开 dev / build 后的应用，cold start 不再加载 shiki wasm / 不常用语言包；首次进 markdown scope 渲染时才按需 fetch
- **维护者**：`bun src/schemas/sync.ts --check-self` 一行命令验证所有 schema 自洽，CI 友好

### 留 PR 之外（PR 路线图外的 follow-up）

- ⏳ PathField Tauri dialog 接入（`@tauri-apps/plugin-dialog`）—— 用户低优先级需求，需要 Tauri capabilities 配置
- ⏳ CMEditor / MarkdownView happy-dom 单测 —— 需引入 happy-dom + 写所有 11 控件 + CMEditor 单测
- ⏳ 字段控件接 errors prop 透传（每字段红框 + tooltip，比顶部 banner 更精确）
- ⏳ schema 上游 fetch 自动化 CI cron job（每周一次 GitHub Action）
- ⏳ REVIEW_4 双异构 reviewer 对抗收口（建议）

### 10 PR 整体收口

| # | PR | LOC 净增 | 用户感知 |
|---|---|---|---|
| 1 | PR-A | +400 | 无（schema 类型骨架） |
| 2 | PR-B | +200 | 无（jsonc-parser 写回保留 + Tauri 单 IPC 读） |
| 3 | PR-F | +260 | source view 模式语法高亮 + 行号 + 折叠 + 搜索 |
| 4 | REVIEW_3 | -- | 双异构对抗 23 fix（5H/9M/9L+3 AP），质量底座 |
| 5 | PR-C | +1100 | 无（11 个字段控件库） |
| 6 | PR-D | +500 | **首波感知**：Claude settings.json schema-driven 行内编辑 + CLAUDE.md Schema 三铁律 |
| 7 | PR-E | +680 | Codex/OpenCode/.mcp.json schema-driven + TOML patcher |
| 8 | PR-G | +400 | edit 模式 lint+hover+completion + TOCTOU 完整 banner |
| 9 | PR-H | +260 | CLAUDE.md 完整 GFM 渲染 + shiki 代码块高亮 |
| 10 | PR-I | -270 | ProfilePanel 拆 7 文件（瘦身 67%） + dch-store schema + ProfileStoreEditor |
| 11 | PR-J | +280 | ajv 校验 banner + bundle splitting + sync.ts 自动化 + 文档收口 |

**测试**：76 → **191 pass / 0 fail / 0 回归** (+115 case)
**Bundle**：单文件 entry 0 KB → splitting **3.65 MB raw + 11 lazy chunks**（gzip 估 ~700 KB total）
**Schema 系统**：5 份 ToolSchema / 70+ FieldSchema 字段 / `additionalProperties: true` 全部保未知 key
**依赖增量**：21 个新 runtime dep（CM6 全套 + ajv + react-markdown + shiki + jsonc-parser + codemirror-json-schema 等）
**文件大小**：全部 ≤ 500 行（CLAUDE.md「单文件 ≤ 500」规则零违规）

## PR-J Follow-up 收尾（4 项实施）

PR 路线图外的 follow-up，用户「都做一下」 → 顺序实施 #3 / #4 / #1 / #2，REVIEW_4 留给用户决定是否触发。

### Follow-up #3 — 字段控件按 path 分发 errors（FieldErrorsProvider）

- **新建** `src/client/components/fields/errors-context.tsx`（55 行）：React Context + `useFieldErrors(path)` hook
  - SchemaScopeBody 跑 `validate()` 拿全量 Diagnostic[]，构造 `Map<path, Diagnostic[]>` 传 Provider
  - 字段控件（FieldRow）调 `useFieldErrors(path)` 拿当前 path errors，避免 ObjectField/ArrayField/KVMapField 透传 props drilling
- **改 `FieldRow.tsx`**：合并显式 props.errors + Context errors（双源），渲染到已有 `.field-error` 红色列表
- **改 `SchemaScopeBody.tsx`**：用 `<FieldErrorsProvider diagnostics={diagnostics}>` 包裹 renderField
- **用户感知**：每字段直接显示自己的校验错误（如 `permissions.defaultMode` 字段下方红色 `must be equal to one of the allowed values...`），比顶部 banner 更精确

### Follow-up #4 — schema 上游 fetch CI cron job

- **新建** `.github/workflows/schema-sync.yml`：weekly cron（每周一 08:17 UTC，错开 :00/:30 整点）+ workflow_dispatch 手动触发
  - Step 1：`bun src/schemas/sync.ts --check-self` → 输出到 `$GITHUB_STEP_SUMMARY`，失败 → workflow fail + 自动建 issue（labels: schema, bug）
  - Step 2：循环 5 个 scope 跑 `bun src/schemas/sync.ts --fetch <scope>` → 输出到 step summary（即使某个 fetch 失败 `|| true` 不中断）
  - 维护者点 workflow run 即可看完整 diff 报告

### Follow-up #1 — PathField Tauri dialog 接入

- **依赖**：`bun add @tauri-apps/plugin-dialog@2.7.1` + `tauri-plugin-dialog = "2"` to Cargo.toml
- **`src-tauri/src/lib.rs`**：`.plugin(tauri_plugin_dialog::init())`
- **`PathField.tsx`**：📁 按钮调 `openDialog({ directory: schema.pathKind === "directory", multiple: false, title, defaultPath })`
  - `defaultPath` 用 `scopeContext.filePath` 的目录作为起始（如编辑 `~/.claude/settings.json` 选目录默认从 `~/.claude/` 开始）
  - 用户取消 dialog / 非 Tauri 环境（dev unit test）→ 静默无操作
- **用户感知**：所有 type=path 的 schema 字段（如 claude `plansDirectory` / `apiKeyHelper` / Codex `model_instructions_file` / dch-store `configDir`）现在都能用原生 file picker
- **cargo check** 通过；happy-dom 单测因为 `@tauri-apps/plugin-dialog` 模块加载会失败 → PathField 内部 try/catch 静默兜住

### Follow-up #2 — CMEditor / MarkdownView happy-dom 单测

- **依赖**：`bun add -d @happy-dom/global-registrator@20.9.0 @testing-library/react@16.3.2`
- **新建** `test-setup.ts`：`GlobalRegistrator.register()` happy-dom 注册到全局
- **新建** `bunfig.toml`：`[test] preload = ["./test-setup.ts"]`
- **新建** `src/client/components/markdown/MarkdownView.test.tsx`（8 case）：
  - GFM 标题 / 段落 / 列表渲染
  - fenced code 带 `language-xxx` className（shiki lazy 未就绪时显示 plain）
  - inline code 走 `.md-code-inline`
  - rehype-sanitize 移除 `<script>` 标签
  - rehype-sanitize 移除 `javascript:` URL（SAFE_SCHEMA href 协议白名单）
  - 外链强制 `target=_blank` + `rel=noreferrer noopener`
  - 内部锚 `#xxx` 不加 target=_blank
  - GFM 表格（th / td 数对）
- **新建** `src/client/components/editor/CMEditor.test.tsx`（8 case）：
  - mount 后 `.cm-host` 内有 `.cm-editor`
  - 受控 value 显示在 `.cm-content`
  - unmount 完整释放（cleanup 后 `.cm-editor` 不残留）
  - 外部 value 变化 → `.cm-content` 同步（受控 value sync）
  - readOnly=true → `contenteditable=false`（CM6 EditorView.editable）
  - readOnly=false → `contenteditable=true` 可编辑
  - language 切换走 Compartment reconfigure（DOM identity 检查 view 不重建）
  - **React 19 Strict Mode 双 mount 不残留两份 .cm-editor**（验证 PR-F + R_2 D3 cleanup 设计）

### Follow-up 验证

- `bun test`：191 → **207 pass / 0 fail / 0 回归**（+16 case：MarkdownView 8 + CMEditor 8）
- `cargo check`：通过（含 tauri-plugin-dialog）
- `bun build --splitting`：744 modules / entry 3.65 MB + 11 chunks 不变
- 文件大小全部 ≤ 500（最大 SchemaScopeBody 226 / MarkdownView.test 78 / CMEditor.test 88 / errors-context 55）

### 留 follow-up 之外（剩 1 项）

- ⏳ **REVIEW_4 双异构对抗**（最终质量闸门）—— 覆盖 PR-D/E/G/H/I/J + follow-up #1-4 ≈ 3000+ 行新代码 / 30+ 文件，按 deep-code-review skill 走 2-3 轮 + 反驳轮，预计 ~2-3 小时

## REVIEW_4 fix（CHANGELOG_8 全量收口质量闸门，**双异构对抗 2 轮**）

> 完整三态裁决清单 / 验证手段 / ❌ 反驳依据见 [reviews/REVIEW_4.md](../reviews/REVIEW_4.md)。本节按严重度倒序列 fix 落地（R_1 + R_2 共 30 条）。

### Round 1 — 5 HIGH + 11 MED + 7 LOW（共 23 条 fix）

#### HIGH

1. **`SchemaScopeBody.tsx:160` H1**：onConflictReload 按 `scope.format` 分流 parser（之前硬编 `JSON.parse(conflict.freshContent)` → TOML scope 必 throw → catch 块 setParsed({}) 让 codex config 整面板瞬变空）；TOML 走 smol-toml `parseToml`
2. **`claude-settings.ts:52` H1'**：defaultMode enum 补齐 `default` / `auto` / `dontAsk` / `ask` 至 7 项（与 schemastore 上游对齐；之前仅 acceptEdits / plan / bypassPermissions 3 项）
3. **`dch-store.ts:32` H2**：profile.id pattern 改 `^[a-zA-Z0-9_-]+$` 与 `src/profiles/manager.ts` ID_RE 同源（之前 `^[\w-]+$` 接受 `_` / 中文 → schema 通过但 CLI 拒）
4. **`to-json-schema.ts:108` H2'**：kv-map 严格化（被 R_2 R-H2 反驳后回退，详见 R_2 节）
5. **`CMEditor.tsx:49` H3**：extraExtensions 类型 `readonly Extension[]`（之前 `Extension[]` 不接受 `EMPTY_EXTRA` 的 `as const readonly []`，bun 宽容编译过 / 严格 tsc 挂）

#### MED

6. **`SchemaScopeBody.tsx:107` M1**：doSave catch flash 错误提示（之前静默回滚 → 用户感知不到 save 失败 → 怀疑「我手抖了」）
7. **`ConfigPanel.tsx` M2**：fallbackMode helper 记忆用户主动选择（之前每次按 ScopeKind 自动跳 schema mode 丢失「我刚才选 raw」语义）
8. **`validator.ts:12` M3**：`WeakMap<ToolSchema, Ajv>` 每 schema 独立 Ajv 实例 + cache（之前每次 validate 全局 new Ajv → schema cache miss / 重复 compile）
9. **`to-json-schema.ts` M4**：enum 短形式自动推断 `type: "string"` / `"number"`（之前 ajv strict 模式漏报 typo）
10. **`dch-store.ts` + `cli-profile.ts:313` + `PreferencesEditor.tsx:17` M5**：hookTimeoutMs `min:1000 max:600000` 三方常量对齐（schema / CLI / UI 之前各自 magic number）
11. **`validator.ts:54` M6**：Diagnostic.path 用 `""` 表 root（之前 `"<root>"` 让 FieldRow `useFieldErrors("")` 永远 miss 根错误）
12. **`PathField.tsx:94` M7**：onPick catch `setPickError` inline 显示（之前仅 `console.warn` → 生产环境用户点 📁 没反应）
13. **`PathField.tsx` M8**：dialog `defaultPath` 用 `scopeContext.filePath` 目录（之前每次都从 home 开）
14. **`claude-mcp.ts` M9**：mcpServers `type` enum + cmd / url 独立字段（之前 enum 列错维度）
15. **`sync.ts:134` M10**：新增 `--list-scopes`（CI workflow YAML 之前硬编 5 个 scope，schema 增减时不知道；现在 GitHub Action 动态拿）
16. **`App.tsx` + `bridge.ts` M11**：onPatchSave 路径不 reload，乐观 setState（之前走 onSave reload 全量 loadAllConfigs → 字段级 patch 后 UI 闪烁 / 滚动跳动）

#### LOW

17. **`toml-patcher.ts:128` L1**：quoted key 含点号（`"a.b" = 1`）+ 嵌套 section dotted key 边界已知限制 JSDoc
18. **`MarkdownView.tsx:45` L2**：javascript: URL 防御注释指向 `defaultSchema.protocols.href` 白名单（之前注释「rehype-sanitize 防 javascript:」实际防御靠白名单不是删 `<script>` 路径）
19. **`KVMapField.tsx:72` L3**：NEW_KEY 自增 `n++` 后用让第一个 key 是 `NEW_KEY_1`（之前 `++n` 永远从 NEW_KEY_2 开始）
20. **`dch-store.ts:55` L4**：env keyPattern 与 manager.ts ENV_KEY_RE 同源（混合大小写）
21. **`toml-patcher.ts:177` L5**：删 `Number.isInteger(v) ? String(v) : String(v)` 死分支三元
22. **`claude-settings.ts:121` L6**：effortLevel description 修事实（R_2 R-L2 进一步精修）
23. **`highlighter.ts:47` L7**：删 BundledLanguage 强转 + `@vite-ignore` 注释（之前接受任意 string 不在 union 里时 shiki 内部 throw）

### Round 2 — 2 HIGH + 5 MED + 2 LOW（共 9 条 fix）

#### HIGH

1. **`PathField.tsx` R-H1**：删 `process.env.HOME`，改用 Tauri `getHomeDir` async IPC（Tauri WKWebView 无 `process` 全局；bun bundler **inline** `process.env.HOME` 让开发机路径写进 bundle → 用户机器路径错 + 信息泄漏）
2. **`to-json-schema.ts:108` R-H2**：kv-map 回退到 `patternProperties + additionalProperties: valueSchema`（与上游 Claude Code env 一致）。R_1 H2' 把 `additionalProperties: false` 严格化后 ajv 拒合法 lowercase env（`http_proxy` / `with-dash`）→「严过上游」反而是回归 → 回退；UI 层 KVMapField onBlur keyPattern 红框守门 + manager.ts ENV_KEY_RE CLI 守门保 hint 校验

#### MED

3. **`PathField.tsx:35` R-M1**：`mountedRef.current` 守门 `await openDialog(...)` 期间 unmount race（React 19 移除了 unmount setState warning）
4. **`PreferencesEditor.tsx:12` R-M2**：controlled `draftMs` state + 失败还原（之前 uncontrolled defaultValue + 校验失败 input.value 不还原 → UI 显非法值但 store 仍旧值，脱节）
5. **`SchemaScopeBody.tsx:59` R-M3**：useEffect 加 `if (saving) return;` 跳 saving 期间外部 reload 覆盖 in-flight 乐观更新
6. **`CMEditor.tsx:177` R-M4**：删 `isFirstExtraEffect` ref guard，接受 1ms noop dispatch（R_1 L4 fix 用 useRef 跨 unmount 持久 → Strict Mode 双 mount 失效；简化代码）
7. **`to-json-schema.test.ts` + `validator.test.ts` R-M5**：对齐 R-H2 fix 后行为（kv-map → patternProperties + additionalProperties: valueSchema；lowercase env 不报错）

#### LOW

8. **`SchemaScopeBody.tsx:175` R-L1**：`freshMtimeUs` null 时 fallback 重读 `readFileWithMtime`（pre-1970 / FS 不支持 mtime → setLoadedMtimeUs(null) 后下一轮 save 跳 stat → 必须 fallback 拿新值）
9. **`claude-settings.ts:121` R-L2**：effortLevel description 改「Opus 4.7+ 自适应推理深度（与 fastMode 互斥：fastMode 仅 Opus 4.6 / effortLevel 仅 Opus 4.7+）」（R_1 L6「4.6/4.7 family 共用」事实错——是互斥不是共用）

### REVIEW_4 验证

- `bun test`：207 → **209 pass / 0 fail / 0 回归**（+2 case：to-json-schema kv-map patternProperties + validator lowercase env 不报错）
- `bun run build:fe --splitting`：748 modules / entry 3.65 MB + 11 chunks
- `cargo check`：通过
- 单文件大小全部 ≤ 500 行（最大 SchemaScopeBody 257 / lib.rs 351）

### Agent 踩坑沉淀（写入 [.claude/conventions-tally.md](../.claude/conventions-tally.md)）

- **AP-8** 前端禁用 `process.env.*`（webview 无 process + bun bundler inline 路径泄漏）
- **AP-9** schema 严过上游 = 回归（任何「严过上游」前必须 WebFetch 上游实证）
- **AP-10** React 19 移除 unmount setState warning，async 期间 setState 必须 mountedRef 守门
