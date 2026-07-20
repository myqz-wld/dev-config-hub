---
changelog_id: 13
changed_at: 2026-05-12
---

# CHANGELOG_13: 切到 Profile tab 卡顿修复 — IPC 风暴去重 + ProfilePanel 受控化

## 概要

修「切换到 profile 页时卡顿，> 2s + 面板出来后点按钮也慢」根因 — IPC 风暴。CHANGELOG_10/11 修过自动刷新和 mount/unmount 卡顿，但漏掉「focus + visibilitychange 双发 × ProfilePanel 与 App.tsx 各挂一对 listener = 14 IPC 并发砸 main thread」。

## 根因

外部切回 Tauri 窗口时 macOS 同时 fire `focus` event + `visibilitychange` event，而 App.tsx 与 ProfilePanel 各挂一对 listener：

```
1 次切回 →
  App.tsx onFocus → load() (loadAllConfigs: 4 version + N readFile = ~5 IPC)
  App.tsx onVisibility → load() 又一次
  ProfilePanel onFocus → reload(true) (list + current = 2 IPC)
  ProfilePanel onVisibility → reload(true) 又一次
= 14 个并发 IPC × spawn shell + bun startup ~568ms each
```

主线程在 React commit / pending state 间频繁切，**面板出来后点按钮也慢**。

场景 B（点启用切完 profile 后）也同源：`await dchProfile.use` (~2-3s) → `await reload()` (~500ms) → `onProfileChanged?.()` 又触发 `App.load()` (~1-2s 全量刷 tool configs，但 profile 切换跟 Claude/Codex 配置无关，根本不该全刷)。

## 变更内容

### `src/client/App.tsx`

- **新增 `profileStore` + `profileActive` state**：profile 数据上提到 App.tsx 单点持有
- **新增 `loadProfileData(silent)` callback**：调 `dchProfile.list() + current()`
- **首屏并发 load + loadProfileData**：进入主界面时 ProfilePanel 已有数据
- **focus + visibilitychange dedupe**：单点 listener + `lastReloadAtRef` 100ms 窗口去重 + `reloadingRef` guard（前一轮 IPC 没完，新 trigger 不入队）
- **同时刷 configs + profile**：用户可能在外部改 settings.json **或** ~/.dch/profiles.json，一次切回都覆盖
- ProfilePanel 调用改：`<ProfilePanel store={profileStore} active={profileActive} onToast={flash} onReloadProfile={loadProfileData} />`

### `src/client/components/ProfilePanel.tsx`

- **改受控组件**：props 改 `{ store, active, onToast, onReloadProfile }`；store/active 接 nullable（panel 常驻必须永远 mount，CHANGELOG_11 约定）
- **删自管 state**：`useState<ProfileStore>` / `useState<active>` / `reload useCallback` / 自己的 `useEffect mount` / 自己的 `useEffect focus/visibilitychange listener` 全删
- **handle / onUse / onTestHook 改调 `onReloadProfile`**：CRUD 后 `await onReloadProfile()` 让 App.tsx 刷新 + 通过 props propagate 下来
- **删 `onProfileChanged` prop**：不再反向调 `App.load()`（profile 切换 ≠ tool configs 变化）
- `PreferencesEditor.onChange` / `ProfileStoreEditor.onSaved` 改传 `() => onReloadProfile()`

## 修复后效果

```
1 次外部切回 →
  焦点事件被 App.tsx 单点接管 + 100ms 窗口 dedupe
  → load() 跑 1 次 (~5 IPC)
  → loadProfileData() 跑 1 次 (2 IPC)
= 7 个并发 IPC（之前 14 个）

场景 B（点启用切完 profile 后）→
  await dchProfile.use (~2-3s 真实切换 + hook)
  await onReloadProfile() (~500ms 仅刷 profile)
  不再调 App.load() (省 5 个 tool configs IPC)
```

## 测试统计

- bun test：233 → **233 / 0 fail / 0 回归**（happy-dom App.test.tsx 已覆盖 onAppActive dedupe 路径，未新增 case）
- cargo test：5 → **5 / 0 fail**

## 关联 review

无（pure perf 修复 + 架构小重构，不走对抗 review；触发场景明确 + 修复方向单一）

## 备注

- **panel 常驻**：CHANGELOG_11 不变，所有 panel 始终 mount + display 切换；ProfilePanel 受控化后 store/active null 时显示 placeholder
- **dedupe 不做 N 秒缓存**：磁盘新鲜度优先级 > 微秒级 IPC 节流；100ms 窗口仅去掉 focus + visibilitychange 双发的同源事件，不影响连续切回的真实刷新需求
- **后续优化方向**（不在本次范围）：dch CLI 子进程复用（避免每次 spawn shell + bun startup ~500ms）；目前每次 list/current 都新起一个 bun 进程，可考虑一个 long-living daemon
