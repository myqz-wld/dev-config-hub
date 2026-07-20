---
review_id: 5
reviewed_at: 2026-05-07
expired: false
skipped_expired:
---

# REVIEW_5: prod build 卡 raw HTML "Loading..." 根因排查 + 防御加固

## 触发场景

用户反馈：`bunx tauri build --bundles app` + 拷到 `/Applications` 后，启动 Dev Config Hub 一直卡在简单 "Loading..." 文字界面，无法进入主 UI。dev / build 命令均无报错。

> 这次不是周期性 review，是用户驱动的 hot-fix bug 排查。范围聚焦根因 + 防御加固，没做更广 audit。

## 方法

不走双 reviewer 对抗（trivial 例外按全局 CLAUDE.md「决策对抗」节定义不适用 —— 这是单点根因排查 + 实证修复，不是定性判断 / plan 评审）。

排查链：
1. 主 agent 直接静态读源码：`App.tsx` Loading 文本 vs `index.html` 默认 fallback HTML 的视觉差异。**关键观察**：截图里的 "Loading..." 没有 spinner，与 `App.tsx:64` 的「读取配置中... + spinner」不符 → 推断 React 根本没挂载，停在 `index.html:10` 的 raw fallback HTML
2. 排除 IPC / wrapper 卡死假设：实测 `zsh -c "source rc; claude --version"` 8s 内返回；4 并发 `version()` 总耗时 2.9s
3. 排除 build 嵌入资源缺失假设：`strings binary | grep index-XXX.js` 验证 dist 文件名都被嵌入；binary mtime 晚于 dist
4. **真正根因定位**：发现 `Cargo.toml` 没开 `devtools` feature → release build 无 webview console → 错误被静默吞 → 切 dev 模式（`bun run tauri dev`）跑，dev server 直接打印 webview throw stack
5. dev 模式截获两个独立 throw（一前一后）：
   - 第一个：`TypeError: undefined is not a constructor (evaluating 'new import_W3CEBNF.default.Parser(...)')` —— 模块加载阶段
   - 第二个（patch 第一个后暴露）：`TypeError: value.map is not a function` 在 `StringChipEditor` —— 渲染阶段

**范围**（命中根因 / 修复 / 加固的全部文件）：

```text
src/client/components/fields/ArrayField.tsx   非数组类型守卫
src/client/main.tsx                             顶层 ErrorBoundary
patches/ebnf@1.9.1.patch                        bun patch 持久化（新增）
package.json                                    patchedDependencies 注册
node_modules/ebnf/dist/Grammars/W3CEBNF.js      被 bun patch 反向同步（不入 git）
```

**机器可读范围**（File-level Review Expiry 用）：

```review-scope
package.json
patches/ebnf@1.9.1.patch
src/client/components/fields/ArrayField.tsx
src/client/main.tsx
```

## 三态裁决结果

### ✅ 真问题（实证抓到 + 修复后实证消失）

| # | 严重度 | 文件:行号 | 问题 | 验证手段 |
|---|---|---|---|---|
| 1 | HIGH | `node_modules/ebnf/dist/Grammars/W3CEBNF.js` 末尾 + `@sagold/json-query/dist/module/lib/parser/index.js:1` | Bun bundler 处理 CJS `exports.default = BNF` 互操作失败：`@sagold/json-query` 顶层 `import EBNF from "ebnf/dist/Grammars/W3CEBNF"` + `new EBNF.Parser(...)` 在 Bun build 下被编译成 `new import_W3CEBNF.default.Parser(...)`，但 `import_W3CEBNF.default` 解析为 undefined → 顶层 throw → 所有依赖 `codemirror-json-schema` 的入口 module 加载失败 → React 整个起不来 → Tauri webview 停在 `index.html` 默认 `<div>Loading...</div>` HTML | dev 模式实测：未 patch 时 dev server 抓到 throw（错误堆栈 ↑见方法第 5 步）；patch 后该 throw 消失，React 正常渲染（暴露下一个 ✅2 错误，证明走过了模块加载阶段） |
| 2 | HIGH | `src/client/components/fields/ArrayField.tsx:14` 旧版 `const arr = value ?? []` | `??` 仅 fallback null/undefined，value 是 string/number/object 时直接当数组用，传到 `StringChipEditor:141` 的 `value.map(...)` 立即 throw。**没有 ErrorBoundary 时**，单字段 throw 导致 React root unmount → 回到 `index.html` raw HTML "Loading..." → 用户感知等同「永远卡 Loading」（即使根因是单字段类型不匹配，无法定位也无法跳过）| dev 模式 patch ✅1 后立刻抓到 stack：`StringChipEditor (...:99236:22) at ... index-000000002c4223e3.js`；触发字段未定位（未输出 path），但守卫修复后即使触发该 case 也只警告不 throw |
| 3 | MED | `src-tauri/Cargo.toml:9` `tauri = { version = "2", features = [] }` | release build 缺 `devtools` feature → webview 无内置 console → 上述 ✅1/✅2 在 prod 完全静默 → 用户和开发者都看不到错误 → 「卡 Loading」无法自助排查。这是「**根因可发现性**」级别的问题，比单个 bug 更深 | 切 dev 模式（默认带 devtools）才看到 throw stack；prod app 进程 stderr/stdout 完全空 |
| 4 | MED | `src/client/main.tsx` 旧版顶层无 ErrorBoundary | 任意子组件渲染期 throw → React 顶层 unmount → 回 `index.html` raw HTML → 用户视角「卡 Loading」。`window.unhandledrejection` handler 救不了同步渲染 throw | 与 ✅2 同栈实证；ErrorBoundary 加上后，再有同类 throw 会显示「⚠ App 渲染错误」+ 错误栈 + 「重新加载」按钮 |

### ❌ 反驳（排查链中被实证证伪的初始假设）

| 假设 | 反驳依据（验证手段 + 结论）|
|---|---|
| `loadAllConfigs()` 4 并发 `version()` 子进程卡死（zsh wrapper / dch profile env） | 实测 4 并发 zsh `source rc; <tool> --version` 总耗时 2.9s；单次 8s 内返回 → 不是源头 |
| Tauri build 嵌入 dist 资源缺失（`Resources/` 只有 `icon.icns`） | Tauri 2 嵌入资产到 binary 而非 `Resources/`；`strings binary` 验证所有 dist hash 文件名都在 → 不缺失 |
| Bun build `--splitting` 与 Tauri `tauri://` 协议 ESM import 解析冲突 | 切 dev 模式（不走 splitting，走 Bun dev server）同样报 ebnf throw → splitting 不是因，是 Bun bundler 的 CJS interop 通用问题 |

### ❓ 部分 / 未验证（未深入排查的潜在风险）

| 现场 | 描述 | 当前结论 |
|---|---|---|
| 触发 ✅2 的具体 schema 字段 | dev stack 显示 `StringChipEditor` throw 但无字段 path；未通过 grep schema / 实测复现定位到具体哪个 settings.json 字段是非数组 | 守卫修复让症状不再致命；后续如要定位上游脏数据来源，需 schema-driven 字段加载时打 path 日志 |
| 其他 fields/* 是否也有同类「类型不匹配 → throw」 | 仅审了 ArrayField；ObjectField / KVMapField / EnumField 等若 caller 传错类型，可能也会 crash | ErrorBoundary 兜底；后续可主动 audit fields/ 加 isXXX guard（属于约定升级范畴） |
| Cargo.toml 是否应升级 `features = ["devtools"]` 默认开 release devtools | 需权衡（开了 release 用户右键能 inspect，方便排查但暴露 webview 内部）；本次未改，仅口头建议 | 用户决定 |

## 修复（无对应 CHANGELOG 落地，本次纯 review/hot-fix）

### HIGH

1. **`patches/ebnf@1.9.1.patch`**（新增）+ **`package.json` `patchedDependencies`**：通过 `bun patch ebnf` 持久化 `node_modules/ebnf/dist/Grammars/W3CEBNF.js` 修复，加 `module.exports = Object.assign(BNF, { default: BNF })` 让 Bun 能正确解析 default import。`bun install` 之后 patch 自动重应用，不会丢
2. **`src/client/components/fields/ArrayField.tsx:13-30`**：`Array.isArray(value)` 守卫，非数组时渲染「⚠ 期望数组类型，实际为 typeof X：JSON.stringify(value) + 转为单元素数组按钮」，让用户能可见、可自助修
3. **`src/client/components/fields/ArrayField.tsx:131-167` `StringChipEditor`**：内部再加一层 `Array.isArray` 守卫（防御深度 — 未来如有别的 caller 直接调 StringChipEditor 也不致命）

### MED

4. **`src/client/main.tsx:13-71`**：加 React class `ErrorBoundary` 包整个 `<App />`，`getDerivedStateFromError` + `componentDidCatch`。错误页面显示 stack + 「重新加载」按钮，避免静默白屏卡 Loading

### LOW

5. **`Cargo.toml`** 加 `devtools` feature：本次**未改**，但记入「下次 bug 排查前先开」的待办建议（用户决定）

---

## Follow-up #1：env 字段展示截断（同次 hot-fix 第二轮）

### 触发

主修复后 app 进入主界面，但用户截图反馈 Claude Code 的 `env` 字段右侧 chip 被截断、`×` 按钮被裁切到右边界外、行内重复显示 `ANTHROPIC_AUTH_TOKEN` 两次。

### 根因

`KVMapField.tsx`（旧版本第 54 行）调 `renderField()` 渲染 KV value 列；`renderField` 派发给 `StringField`，但 `StringField` 内部包了一层 `<FieldRow>`（200px label + 1fr 控件 grid）。结果 KV row 被嵌套两层 grid：

```
[KV row: 160px key | 1fr value | auto ×]
                     ↓
              [200px nested-label | 1fr input]   ← 把 value 列吃掉
                                                ← × 被挤到右边裁切
                                                ← nested label 显示 lastSegment(path) = "ANTHROPIC_AUTH_TOKEN" 与 KV key 重复
```

KV row 内部的 nested FieldRow 是个**结构性问题**：所有 leaf field（StringField/NumberField/EnumField/BooleanField/PathField/SensitiveField/CodeField/MarkdownField/ObjectField/UnknownField）在 KV / Array 嵌套场景下都会有同样问题，只不过 visual 严重程度不同。

### 修复

**通用方案**：FieldProps 加 `embedded?: boolean`，所有 leaf field 在 `embedded=true` 时**只渲染裸控件，跳过 FieldRow**。父容器（KVMapField / ArrayItemCard）调 `renderField` 时显式传 `embedded: true`。

涉及文件：
- `src/client/components/fields/types.ts`：FieldProps 加 embedded（带文档注释）
- `src/client/components/fields/KVMapField.tsx`：调 renderField 时传 `embedded: true`；自身签名也接受 embedded（KV 嵌套 KV 场景 mcp_servers 有用）
- `src/client/components/fields/ArrayField.tsx`：ArrayItemCard 内 renderField 也传 `embedded: true`；StringChipEditor 接受 + 转发 embedded
- `src/client/components/fields/StringField.tsx` / `NumberField.tsx` / `BooleanField.tsx` / `EnumField.tsx` / `PathField.tsx` / `SensitiveField.tsx` / `ObjectField.tsx` / `CodeField.tsx` / `MarkdownField.tsx` / `UnknownField.tsx`：每个 leaf field 在 `embedded` 时直接 return inner control，否则照旧包 FieldRow

`ObjectField` 内部子字段 `renderField` 调用**仍不**传 embedded（Object 子字段需要自己的 label）；只有 `ArrayItemCard.body` 和 `KVMapField.value` 这两个明确「父容器自己已显示 label/index」的位置传 `embedded: true`。

### 验证

- `bun test src/schemas` 117/117 pass（无回归）
- `bunx tauri build --bundles app` exit 0
- Smoke test：app 启动后 5s 进程稳定无 crash；新 binary 拷到 `/Applications`，等待用户实测确认 env 字段渲染正常

---

## 后续待办（用户提，本次不做）

1. **支持自定义 schema**：当前 schema 写死在 `src/schemas/*.ts`，用户希望以后能自己加自定义 schema（不改源码、不重 build）。预设方向 = 读 `~/.dch/schemas/*.json`（JSON Schema 格式 / 或 ToolSchema 内部格式）合并到 registry。**当前先按现有的配置文件展示**，自定义 schema 留下次迭代

---

## Follow-up #2：StringChipEditor 渲染 plain object 致 React throw

### 触发

Follow-up #1 重 build 后 app 启动 → ErrorBoundary 接住一个新错误，dev 模式抓到完整 stack：

```
The above error occurred in the <code> component
  ... StringChipEditor → ArrayField → ObjectField → SchemaScopeBody → ConfigPanel → App
```

错误是 `Objects are not valid as a React child` —— React reconcile 时发现 `<code>{item}</code>` 的 child 是 plain object。

### 根因

`ArrayField` 判断 `isStringChips`（chip 编辑器模式）只看 schema：

```ts
const isStringChips = itemType === "string" && (!schema.itemSchema?.maxLength || schema.itemSchema.maxLength <= 30);
```

但**用户实际数据里 array 元素可能是 object**（典型：用户旧版 `permissions.allow` 写成 `[{ name: "Bash", action: "allow" }, ...]`，schema 期望的是 string `["Bash(...)"]`）。schema 说是 string 数组就强行走 `StringChipEditor` → 内部 `<code>{item}</code>` 收 object → React throw。

跟 REVIEW_5 ✅2 / Follow-up #1 同源 —— **用户数据 ≠ schema 类型**这条 bug 模式在 fields/ 内多处潜伏（不止 ArrayField 顶层非数组）。

### 修复

涉及文件：
- `src/client/components/fields/ArrayField.tsx`：`isStringChips` 加第三个守卫 `arr.every((x) => typeof x === "string")`，数据不全 string 时 fallback 到 ArrayItemCard 卡片模式（ArrayItemCard 内 renderField 会按子 item 实际类型走 ObjectField/StringField）
- `src/client/components/fields/ArrayField.tsx` `StringChipEditor`：`<code>{item}</code>` 改为 `<code>{display}</code>`，`display = typeof item === "string" ? item : JSON.stringify(item)`（防御深度，防未来其他 caller 直接调 StringChipEditor）
- `src/client/main.tsx` `ErrorBoundary`：分两段显示 `error.message`（红色加粗）和 `error.stack`（小号灰色），便于排查 —— 之前用户只看到 stack 没看到 message（React 19 minified build 的 stack 不带 message 前缀）

### 验证

- `bun test` 209/209 pass
- `bunx tauri build --bundles app` exit 0
- Smoke test：app 启动后 5s 进程稳定无 crash；新 binary 拷到 `/Applications`，等用户实测确认 array 字段不再 crash

## 关联 changelog

- 无（本次纯 review/hot-fix，未引入新功能。后续如把 fields/ 全量 type-guard 化或开 devtools 升级，再走 changelog）

## Agent 踩坑沉淀（候选）

本次提炼出 N 条 agent-pitfall 候选，已写入 `.claude/conventions-tally.md`「Agent 踩坑候选」section（如同主题再撞 2 次会触发升级到本仓库 CLAUDE.md 项目约定）：

1. **Tauri release build 默认无 devtools / 无 stderr → 「卡 Loading」类问题排查必先切 dev 模式才能拿到 webview 错误栈**（不要在 prod build 上反复试，浪费时间）
2. **Bun bundler 对 CJS `exports.default = X` 互操作有 bug**：处理这类包时 `import X from "cjs-module"` 编译产物 `import_X.default` 可能为 undefined。遇到「new ...Parser is not a constructor」类型错先怀疑这个，直接 `bun patch <pkg>` 在 cjs export 末尾追加 `module.exports = Object.assign(X, { default: X })`
3. **React 顶层必须有 ErrorBoundary**：任意单组件渲染 throw 会 unmount 整个 root 回 index.html raw HTML，用户视角等同「永远卡」无法定位
4. **`schema-driven` field 必须做 type guard**：`value ?? []` 只防 null/undefined，不防 string/number/object — 用户的 settings.json 可能与 schema 不一致，单字段 throw 一旦没 ErrorBoundary 就 fatal
