# CHANGELOG_5: 修 UI 删除 profile 卡死 + 新建表单一次填齐 hooks

## 概要

UI 上点删除 profile 没反馈：根因是 ProfilePanel 用 `window.confirm()` 做删除二次确认，Tauri 2 webview 不弹原生 confirm dialog（默默吞掉 / 返回 false），导致 onDelete 永远被 early-return。同时新建 profile 的表单只覆盖 dir / env / desc，hooks (preSwitch / postSwitch) 必须事后用 `dch profile edit` 改 ~/.dch/profiles.json，体验差。

本轮把 confirm 换成卡片内联两步确认（删除 → 确认删除？/ 取消），AddProfileModal 加上 preHook / postHook 两个 textarea + clone 时自动带过来；CLI add 同步加 `--pre-hook` / `--post-hook` flag。

## 变更内容

### `src/client/components/ProfilePanel.tsx`

- ProfileCard 删除按钮改成内联两步：第一次点显示「确认删除？configDir 不会动 / 取消 / 确认删除」，4 秒无操作自动撤回；不再走 `window.confirm`，所以 toast 反馈链 (`handle → onToast → reload`) 必跑
- AddForm 类型加 `preHook` / `postHook` 字段；AddProfileModal 加两个 `<textarea class="form-hook-input">`
- 「从已有 profile clone」选中后自动把 src.configDir / description / env / preSwitch / postSwitch 灌进当前未填字段（已填字段不覆盖）
- 删除原 hint「hooks 暂时通过 dch profile edit 编辑 profiles.json 添加」
- env hint 文案微调，附带 README「Shell wrapper」节指引
- 底部加 hook 可用环境变量提示（DCH_PROFILE_ID / TOOL / CONFIG_DIR / DCH_SWITCH_TO / FROM）

### `src/client/bridge.ts`

- `dchProfile.add` 入参加 `preHook?: string` / `postHook?: string`，分别拼成 `--pre-hook <script>` / `--post-hook <script>` 传给 CLI

### `src/cli-profile.ts`

- `cmdAdd` 解析 `--pre-hook` / `--post-hook`，组合 `hooks = { preSwitch?, postSwitch? }`；与 `--from clone` 的 base.hooks 互补（命令行显式值优先，缺省用 base 的）
- help 文本同步加两个 flag

### `src/client/styles.css`

- 加 `.form-hook-input`：等宽字体 textarea，min-height 60px，可纵向 resize
- 加 `.profile-card-actions-spacer` / `.profile-confirm-hint` / `.btn-sm.danger.danger-solid`：内联确认状态布局 + 高亮样式
- `.form-row textarea:focus` 沿用蓝色描边

## 备注

- **为什么不引入 @tauri-apps/plugin-dialog**：单纯为了一个 confirm 弹窗加 plugin 太重，而且 inline confirm 比 modal dialog 反应更快、阻塞感更弱
- **多行 hook 传参**：实测 Bun process.argv 能完整接住 textarea 的换行符（Tauri Rust 端用单引号 quote 每个 arg，shell `-c` 解开后传给 bun，无 escape 损耗）
- **isDefault 字段不放进表单**：这是 `dch profile init` 自动给「default profile」打的标记，用户手建不应能设置
- **删除二次确认 4 秒自动撤回**：避免「点了删除离开屏幕回来又点确认」的误删；取消按钮也可手动撤回

## Review 修复（双对抗 Agent: Claude Opus 4.7 xhigh + Codex gpt-5.5 xhigh）

本轮 review 命中两条真问题，立即随本 changelog 修掉：

1. **clone hook 后清空 textarea，旧 hook 仍被保留**（Codex 独家）
   - 链路：UI applyClone 把 `src.hooks.preSwitch` 灌进 `form.preHook` → 用户清空 textarea → `bridge.add` 因 `form.preHook.trim() || undefined` 不传 `--pre-hook` → CLI `cmdAdd` 因 `--from` 走 `base.hooks.preSwitch` 兜底 → 保存的还是源 profile 的 hook
   - Fix：`ProfilePanel.tsx` `onSubmit` 不再传 `from`。applyClone 已把 src 字段灌进 form，submit 全部走 form 显式值，CLI 端 base 为空，「清空意图」被尊重
   - 副作用：用户清空 dir / desc / env 后，CLI 端也按「清空」处理，不再回退到 base — 这是用户期望的行为
   - CLI 单独使用时 `--from` 仍然可用，base.fallback 语义不变

2. **parseFlags 吞以 `--` 开头的 hook 字面值**（双方一致）
   - `cli-profile.ts:52` 旧逻辑 `next.startsWith("--")` 把 `--pre-hook '--foo'` 的 `--foo` 误判为新 flag
   - Fix：加 `VALUE_FLAGS = new Set(["dir", "desc", "from", "pre-hook", "post-hook"])` 白名单。已知值类 flag 无条件把下一个 arg 当 value，next 为 undefined 才退到 boolean
   - 实测 `--pre-hook '--foo bar'` 现在保存的 `preSwitch` 字面值就是 `"--foo bar"`

被反驳：Claude 报的「`form.dir || src.configDir` 空串/undefined 混淆」（实际是有意的「未填用 src」语义）、「ProfileCard 4s timer 父 reload 时泄漏」（key 不变 React 复用实例，cleanup 链路完整）、「shell 把多行 hook 分裂成多个 argv」（Rust 端单引号 quote 整个 arg，实测完整保留）— 三条均不成立。

## 第三轮补强：模型本身的配置也能在新建时填齐

用户反馈：dch profile 字段（id / dir / env / hooks）虽然在 UI 都能填了，但 claude `settings.json` / codex `config.toml` 里**模型本身的配置**（model / reasoning_effort / mcpServers / permissions 等）依然得切过去后跑命令或手动编辑文件。本轮把这块也搬进 AddProfileModal。

### 新增能力

- **「模型配置」section**：核心字段 + raw textarea 双轨
  - claude profile：`model` 输入框
  - codex profile：`model` 输入框 + `model_reasoning_effort` select (minimal/low/medium/high/xhigh)
  - 完整文件 textarea（claude → settings.json，codex → config.toml），带格式化 placeholder
  - **合并语义**：textarea 非空时直接落盘；textarea 留空但核心字段非空时，`generateMinimalConfig` 拼出最小 JSON / TOML 骨架；都为空时不创建文件（符合 Q3 选择）
- **clone 带主配置文件**：applyClone 异步读 `<src.configDir>/{settings.json|config.toml}` 灌进 textarea，并解析出 `model` / `model_reasoning_effort` 灌核心字段（解析失败不阻塞，raw 内容保留）
- **切换 tool 时 reset**：configContent / from / cfgReasoning 跟 tool 绑定，切换时清掉避免格式错配

### 改动

#### `src-tauri/src/lib.rs`
- `save_file` 写入前 `fs::create_dir_all(parent)`，避免新 profile 的 configDir 不存在导致 ENOENT

#### `src/client/bridge.ts`
- 新增 `readProfileConfigFile` / `writeProfileConfigFile`：用 `get_home_dir` + `expandHomePath` 把 `~/.claude-xxx/settings.json` 展开成绝对路径，再走 `read_file` / `save_file`

#### `src/client/components/ProfilePanel.tsx`
- 顶部加 `MAIN_CONFIG`：`{ claude: settings.json/json, codex: config.toml/toml }` 单一映射表
- AddForm 加 `configContent` / `cfgModel` / `cfgReasoning` 三字段
- AddProfileModal 加「模型配置」section + 「profile 元信息」section 视觉分隔；modal 加宽到 720px
- `onChangeTool` 切换 tool 时清掉 from / configContent / cfgReasoning（codex 独有字段）
- `onSubmit` 流程：先 `dchProfile.add` 创建 profile → 若有内容则 `writeProfileConfigFile` 写主配置文件；toast 文案带上「+ settings.json」让用户知道文件也写了

#### `src/client/styles.css`
- `.modal-wide`：720px 宽度
- `.form-section-title`：分隔标题样式（uppercase + 上分隔线）
- `.form-config-input`：textarea min-height 140px

### 备注

- **不做反向同步**：核心字段 → textarea 的合并只在 submit 时按「textarea 优先」做。如果用户先填 textarea 再填 model 字段，model 字段被忽略 — 简单可预测，避免 reactive merge 带来的诡异覆盖
- **TOML stringify 用手写**：smol-toml 1.6.1 暴露了 `stringify`，但只对最小骨架而言手写两行更可控（不会把 `model` 字段错放进顶层之外的位置）。复杂 TOML 用户直接在 textarea 里粘
- **写主配置文件失败不回滚 profile**：若 `dchProfile.add` 成功但 `writeProfileConfigFile` 失败（极少：磁盘满 / 权限），UI toast 报错，profile 已存在于 ~/.dch/profiles.json，用户可手动写文件或删 profile 重建。事务回滚不值当
- **核心字段 select 选项**：reasoning 的 `xhigh` 是 codex CLI 特有档位，不在 OpenAI 官方文档里，但跟 `~/.codex/config.toml` 一致，照实暴露

## 第三轮 review 修复（双对抗 Agent: Claude Opus 4.7 xhigh + Codex gpt-5.5 xhigh）

第三轮 review 命中 4 条真问题，全部修掉：

1. **clone 默认 dir 指向源 configDir → submit 时静默覆盖源 settings.json**（Codex 独家，最危险）
   - 触发：用户从 `claude-pro` clone，没改 dir → form.dir = `~/.claude-pro` → writeProfileConfigFile 覆盖源
   - Fix A：`applyClone` 不再灌 `dir`（删除 `dir: cur.dir || src.configDir`）。dir 走默认 placeholder `~/.${tool}-${id}`，是新目录
   - Fix B 双保险：`onSubmit` 加 dir 撞车校验 — 如果有内容要写且 `dir` 跟任意已存在 profile.configDir 重合，直接 toast 拒绝并 return，profile 都不会创建

2. **applyClone 异步竞态：连点 from=A → from=B 时旧 promise 回写 stale 字段**（双方一致）
   - Fix：加 `latestFromRef = useRef("")`，applyClone 入口立即 `latestFromRef.current = fromId`；await readProfileConfigFile 完成后 setForm 之前 check `if (latestFromRef.current !== fromId) return`
   - 滞后到达的旧请求被丢弃，只有最新一次 select 的结果会落到 form

3. **TOML 转义不完整：只转双引号，反斜杠 / 控制字符 / 换行未转**（双方一致）
   - 旧：`` `model = "${fields.model.replace(/"/g, '\\"')}"` `` → 用户填 `gpt-5\b"x` 生成无效 TOML
   - Fix：新增 `tomlBasicString(s)` 完整 escape：`\` → `\\`，`"` → `\"`，`\x00-\x1f` / `\x7f` → `\uXXXX`（顺序：先反斜杠再引号再控制字符，否则反向）
   - 实测 round-trip 通过：`gpt-5.5` / `a"b` / `a\b` / `line1\nline2` / `tab\there` / `mix\"x` 全部正确解回原值

4. **submit 顺序：profile 先落盘，写配置文件失败 → 半成品 profile，toast 不提示**（Codex 独家）
   - Fix：`writeProfileConfigFile` 包 try/catch，失败时 throw 含明确指引的 Error：「profile xxx 已建，但写 yyy/settings.json 失败：原因。请到 ConfigPanel 手动补，或删除该 profile 重建。」
   - 不做事务回滚（remove 调用还可能再失败，状态机更乱），把指引放在文案里

被反驳：
- Claude 报「expandHomePath 末尾斜杠产生双 //」— POSIX 路径解析容忍 `/foo//bar ≡ /foo/bar`，read/write 不受影响。归 ⚠️ 不修
- Claude 报「save_file mkdir 在 symlink/permission 边界」— `fs::create_dir_all` + `fs::write` 都返回 Result 链路完整，非本轮 feature bug。Codex 同样判定不算问题

⚠️ 边界（本轮不修）：
- 切 tool 保留 `cfgModel`（跨工具 model 名空间不同）— 跨场景模糊但无破坏性
- 核心字段与 textarea 矛盾时静默丢核心字段 — UI 没强提示但合并语义已在 hint 里说明
- MAIN_CONFIG 只覆盖单一主配置（claude 的 settings.local.json / .mcp.json / CLAUDE.md 没暴露）— scope 取舍

## 第四轮 review 修复（双对抗 Agent）

第四轮 review 又抓出 3 条真问题 + 2 条 ⚠️ 边界，全修：

1. **dir 撞车校验可绕过**（Codex 独家）
   - 旧：`store.profiles.some((p) => p.configDir === dir)` raw 字符串比较
   - 反例：`~/.claude-pro/`（末尾斜杠）/ `/Users/apple/.claude-pro`（绝对）/ `~/.x//foo`（双斜杠）跟已有 `~/.claude-pro` 不等但展开后是同一目录 → 绕过后仍 writeProfileConfigFile 覆盖源
   - Fix：bridge.ts 新增 `normalizeProfileDir(p, home)`：展开 `~/`、折叠 `//`、去尾 `/`；`getHomeDir()` 同步 export。onSubmit 用 `normalizeProfileDir(...) === normalizeProfileDir(...)` 比较

2. **dir 撞车只在 content 非空时跑 → 僵尸 profile**（双方一致）
   - 旧：`if (content && store.profiles.some(...))`
   - content 空 → 跳过校验 → profile 落盘但跟现有 profile 指向同一 configDir，dch 切换状态错乱
   - Fix：dir 撞车校验从 `if (content && ...)` 短路移出，**任何**情况都先校验

3. **写文件失败：modal 关闭、列表不刷新**（Codex 独家）
   - 旧：`handle` catch 只 onToast，`onSubmit` 无脑 `setShowAdd(false)` → 用户看到错误 toast + 关掉的 modal，不知道 profile 到底建没建
   - Fix A：`handle` 改返回 `Promise<boolean>`；catch 块也调 `reload()` 让列表跟实际状态一致
   - Fix B：`onSubmit` 根据 `handle` 返回值决定是否 `setShowAdd(false)` — 失败保留 modal，让用户改完再交

4. **applyClone closure src 过期**（Claude ✅，Codex ⚠️）
   - Fix：加 `existingRef = useRef(existing)` 镜像 props；await 完成后用 `existingRef.current.find(...)` 重新查 src（initial src 只用来查 configDir 读文件），避免父级 reload 同 id profile 内容变化时 setForm 灌的还是旧 src

5. **dir 默认值 `~/.${tool}-${id}` 在 UI / CLI 双份硬编码**（Codex 提出）
   - Fix：抽到 `src/profiles/defaults.ts` 的 `defaultProfileDir(tool, id)`，UI / CLI 共享。dirPlaceholder 也走它

6. **错误 toast 3 秒消失，长 message 看不完**（Claude 独家）
   - Fix：`App.tsx` flash 根据 `ok` 决定 timeout — 成功 3s，错误 8s

被反驳：
- TOML escape 是否「过度（tab over-escape）」/「不足（C1 控制字符）」 — 双方都判定现状 OK，tab 转 `	` 冗余但合规，C1 控制字符 TOML spec 允许不需 escape

⚠️ 仍未修的边界：
- handle catch 块 reload 也会失败的话只 toast 不会再 reload — 二阶 cascade 不深究
- modal 打开期间另一窗口 reload，onSubmit 校验用 closure 旧 store — 触发场景极少，不修

## 第五轮 review 修复（双对抗 Agent）

第五轮 review 又抓出 5 条真问题，4 条修，1 条（normalizeProfileDir 词法层无法挡 case-insensitive / symlink / `..`）按用户决定保留为 ⚠️：

1. **handle catch 后 reload 失败覆盖原 action toast**（双方一致）
   - 旧：handle catch → onToast(action err) → reload() → reload 内 catch onToast(reload err) → 后者覆盖前者
   - Fix：`reload(silent = false)` 加可选参数，handle catch 块用 `reload(true)`：reload 自身失败时 console.warn 不再 toast

2. **applyClone existingRef 修补不彻底：configDir 过期**（双方一致）
   - 旧：用 `initialSrc.configDir`（旧 closure）读文件；setForm 时用 latest src 拿元数据 → 内容跟元数据脱节
   - Fix：抽 `parseConfigCore(content, format)` helper；await 完成 + race-check 后，对比 `src.configDir !== initialSrc.configDir` / `src.tool !== initialSrc.tool`，不一致则用 latest 重读 + 二次 race-check
   - 触发场景罕见但路径完整

3. **App.tsx flash 嵌套 setTimeout 没 clear**（双方一致）
   - 旧：每次 flash 直接 setTimeout，旧 timer 仍在跑，连续 flash 时旧 timer 会清掉新 toast
   - Fix：`toastTimerRef = useRef<number | null>(null)`；flash 入口先 `clearTimeout(prev)`，setTimeout 返回值存 ref，回调内 `setToast(null)` + 清 ref

4. **submit 按钮 busy 期间不 disabled，可重复并发提交**（双方一致）
   - Fix：AddProfileModal 接 `busy: boolean` prop；提交按钮 `disabled={busy || ...}` + 文案 busy 时显示「提交中…」；取消按钮也跟着 disabled 防 modal 卡到中间状态被关
   - 父级 `<AddProfileModal busy={busy} ... />` 同步传

5. **normalizeProfileDir 仍可绕过：case-insensitive / symlink / `..`**（双方一致，按用户决定不修）
   - 词法层 normalize 无法解决 macOS APFS case-insensitive、symlink 解引用、`..` 路径解析
   - 真要彻底防御需 Rust 端 `canonicalize`，本轮决定保留为 ⚠️ — 当前是「劝阻常见误操作」（同字符串路径、末尾 / 双斜杠等），物理路径同一目录的对抗式输入由用户自负责

被反驳：
- handle 返回 `Promise<boolean>` 不破坏旧 caller — Codex 验证 React/prop void 上下文忽略返回值
- defaultProfileDir 抽出后是否有残留硬编码 — 双方搜过，剩下的 `~/.${tool}-${id}` 只在注释/字符串说明里
