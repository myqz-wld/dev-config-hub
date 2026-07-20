---
changelog_id: 15
changed_at: 2026-05-13
---

# CHANGELOG_15: 切回窗口卡顿修复（focus reload 零进程 spawn）

## 概要

修「从其他应用切回 Dev Config Hub 窗口仍有明显卡顿」。CHANGELOG_13 已把 focus + visibilitychange 触发次数从 4 降到 1，但**单次触发本身的开销没动** — 每次切回仍跑 4 个 zsh spawn (get_tool_version) + 2 个 bun spawn (dch profile list/current)，加在一起 800-1500ms 用户感知。

## 根因（实测链路）

每次切回窗口跑 `App.tsx onAppActive` → `Promise.all([load(), loadProfileData(true)])`：

| 操作 | spawn 数 | 单次开销 |
|---|---|---|
| `get_tool_version × 4`（zsh / claude / codex / opencode --version） | **4 zsh** | 200-500ms / 个（登录式 + source .zshrc） |
| `loadAllConfigs()` 文件读 8 个 scope（file_exists + read_file 双 IPC） | 0 | 16 IPC |
| `dchProfile.list()` → `bun src/cli.ts profile list --json` | **1 bun** | ~500ms cold start |
| `dchProfile.current()` → `bun src/cli.ts profile current --json` | **1 bun** | ~500ms cold start |
| **总计** | **6 spawn + 21 IPC** | max(zsh×4, bun×2) ≈ 500-800ms + React commit |

观察：
- tool versions 几乎不会因为切窗口而变（brew upgrade 是用户主动罕见事件）
- `dchProfile.list()` CLI 实现就是单纯读 `~/.dch/profiles.json` (`src/profiles/store.ts:46 loadStore`)
- `dchProfile.current()` 就是读 profiles.json + readlink ~/.{tool} (`src/profiles/manager.ts:166 getActive` + `src/profiles/symlink.ts:150 currentSymlinkTarget`)
- 这俩纯读操作没必要 spawn bun CLI，可以直接走 Tauri 端 fs

## 修复后开销

| 操作 | spawn 数 | IPC 数 |
|---|---|---|
| versions（缓存到首屏，focus reload 跳过） | 0 | 0 |
| 8 个 scope 内容（readFileWithMtime 单 IPC） | 0 | 8 |
| profiles.json | 0 | 1（readFileWithMtime） |
| 2 个 symlink target | 0 | 2（read_link） |
| **总计** | **0** | **11** |

预计切回窗口卡顿从 800-1500ms 降到 < 50ms（纯 Rust fs + React commit）。

## 变更内容

### 新增 `src/profiles/store-shape.ts`

抽出 `applyStoreDefaults(raw): ProfileStore` + `EMPTY_STORE` 纯函数（零 fs / 零 Bun 依赖）。
前端 `loadProfileDataDirect` + CLI `loadStore` 共用，避免未来给 `preferences` 加新字段时
两边 default 分叉（一边改一边忘改 → CLI 落盘正常但 UI 显示 undefined，难定位）。

### `src/profiles/store.ts`

- `loadStore` 改成 `return applyStoreDefaults(await file.json())`，删本地 `DEFAULT_PREFERENCES` + `EMPTY_STORE` 字面量定义（已转移到 store-shape）

### `src-tauri/src/lib.rs`

- 新增 `read_link` Tauri 命令 + `read_link_inner` pure helper（接 home 不读 env，方便 cargo test 并发跑）：
  - HOME boundary check（与 `read_dir` 同源 defensive）
  - 单层 `read_link` 不 deref（与 CLI `currentSymlinkTarget` 行为一致）
  - 相对 link → 解析为绝对（join parent）
  - 非 symlink / 不存在 / IO 错 → `Ok(None)`（CLI 的 `pathState catch-all` 等价）
  - HOME 外路径 → `Err`（caller bug，应让前端开发者立即看到）
- 注册到 `invoke_handler![..., read_link]`

### `src/client/bridge.ts`

- **删 `readFile`**（双 IPC `file_exists` + `read_file`），caller 全改用 `readFileWithMtime`（单 IPC + 顺手拿 mtime）
- **新增 `readLink(path)`**：wrapping Tauri `read_link`；Err 也 catch 回 null（与 Rust 端 Ok(None) 行为对齐让 caller 路径平）
- **拆 `loadAllConfigs`**：
  - `loadAllVersions(): Promise<ToolVersions>` — 跑 4 × `version()` `Promise.all`（仅首屏跑一次）
  - `loadAllFiles(home, versions): Promise<ToolConfig[]>` — 接收预算好的 home + versions，并发 readScope
  - `loadAllConfigs()` 保留：内部串接 versions + files（首屏入口）
- **新增 `buildProfileData(storeContent, links): { store, active }`** pure 函数（抽出来给单测直接调，避免 mock @tauri-apps invoke）
- **新增 `loadProfileDataDirect()`**：`getHomeDir()` + `readFileWithMtime(~/.dch/profiles.json)` + `Promise.all readLink(~/.{claude,codex})` → `buildProfileData(...)`，与 `dchProfile.list() + current()` 输出 shape 等价但 0 spawn

### `src/client/App.tsx`

- 新增 `versionsRef = useRef<ToolVersions | null>(null)` 缓存首屏 versions
- 改 `load()`：`getHomeDir → loadAllVersions → 写 ref → loadAllFiles`，失败时 ref 不写
- 新增 `loadFilesOnly()` callback：仅刷文件内容（用 `versionsRef.current`）；ref null（首屏失败）→ fallback 到完整 `load()`
- 改 `loadProfileData(silent)`：从调 `dchProfile.list + current` 改成调 `loadProfileDataDirect`
- 改 `onAppActive`：从 `Promise.all([load(), loadProfileData(true)])` 改成 `Promise.all([loadFilesOnly(), loadProfileData(true)])`
- **首屏 useEffect 也用 `reloadingRef.current = true` 包住**（Plan agent Q5 race 防护）：首屏 load 还在跑时用户切走 + 切回 → onAppActive 触发 → versionsRef 还是 null → fallback 跑全量 load 第二份 = 8 zsh spawn × 2 比修复前还差。reloadingRef 已有，复用即可
- 删本地 `ProfileActive` type（改用 `bridge.ts` export 的）

### ProfilePanel CRUD 后刷新

`onReloadProfile` 现在指向 `loadProfileData` → `loadProfileDataDirect`（fs 直读）。dch CLI 写操作有 atomic lock + 写完关进程，前端 IPC 时间点 fs 一定可见，没问题。

## 测试

### 新增

- `src/profiles/store-shape.test.ts`（11 case）：
  - `applyStoreDefaults` 纯函数 8 个 case（空对象 / null / undefined / 缺 active.codex / 缺 preferences / 自定义 hookTimeoutMs / profiles 保留 / version 强制 1）
  - `loadStore ≡ applyStoreDefaults(JSON.parse(raw))` 双路径同源 snapshot test 3 case（真实 fs 路径 / 不存在文件 / structuredClone 防污染）
- `src/client/bridge.test.ts`（5 case）：
  - `buildProfileData` 纯函数：null storeContent / 完整 shape / link 全 null / 坏 JSON throw / store.active 缺 codex 仍补 null
  - **不 mock `@tauri-apps/api/core` invoke**（bun mock.module 跨 file 污染：`App.test.tsx` / `ConfigPanel.test.tsx` mock 了 `./bridge.ts` 让其他 file import 拿到 stub）
- `src/client/App.test.tsx` T8（race 回归保护）：首屏 load 还在跑时连 dispatch 两次 focus → versionsCallCount 仍 1（reloadingRef guard 工作）+ 完成首屏后 focus reload 路径仍只跑 loadAllFiles（不再调 versions）
- `src-tauri/src/lib.rs` `#[cfg(test)] mod tests`（5 case for `read_link_inner`）：
  - 真 symlink 拿到绝对 target
  - 非 symlink / 不存在 → None
  - HOME 外路径 → Err
  - 相对 target 解析为绝对

### 跑

- `bun test`：105 → **132 / 0 fail / 0 回归**（+18 新 case，T7 改写后保留语义）
- `cargo test`：5 → **10 / 0 fail / 0 回归**（+5 read_link case）
- `cargo check --release`：通过
- `bunx tauri build --bundles app`：通过 + 装到 `/Applications/Dev Config Hub.app`

### 端到端验证（手动）

- 打开 Tauri 窗口 → 切到其他应用（command-tab）→ 切回 → 应该「瞬时」无卡顿（< 100ms）
- profile data 外部修改：终端跑 `bun run cli profile add claude smoke --dir ~/.claude-smoke --desc test` → 切回 GUI ProfilePanel → 应能看到 smoke 出现
- profile use：UI 点切换 → toast → ProfilePanel active 即时刷新

## 关联 review

无（pure perf 修复 + 共享 module 重构，触发场景明确 + 修复方向单一；plan agent 1 轮反馈已吸收）

## 备注

- **versions 缓存 stale 是 trade-off**：用户外部 `brew upgrade claude` 后角标版本不更新，需重启 app（首屏会重读）。罕见场景；如有需求可后续追加「刷新版本」按钮（不在本次范围）
- **写操作仍走 dch CLI**：add / remove / use / init / config / testHook 涉及 store lock + hook 不能复刻，本次只 bypass list / current 这两个纯读操作
- **共享 store-shape.ts 模块设计**：让 CLI 和前端两套调用路径共享 default 补全 pure 函数。snapshot test 锁同源行为，未来给 `preferences` 加字段必须改 store-shape.ts 一处即可
- **bun mock.module 跨 file 污染坑**：`mock.module(path, factory)` 全局生效不会跨 test file 自动 reset，导致 `App.test.tsx` mock `./bridge.ts` 后 `bridge.test.ts` 引用真实 bridge 拿到 stub。本次 workaround：把 `loadProfileDataDirect` 拆出 `buildProfileData` pure 函数，测试直接测纯函数不依赖 IPC mock
