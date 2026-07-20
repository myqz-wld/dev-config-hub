---
changelog_id: 11
changed_at: 2026-05-11
---

# CHANGELOG_11: tab 切换卡顿修复（panel 常驻 + visibility-aware poll）

## 概要

把 `App.tsx` 的「条件渲染 panel」改成「全部常驻 + CSS display 切换」，消除每次 tab
切换时整个 `ConfigPanel`/`ProfilePanel` unmount → remount 触发的全部重做开销
（N 次 `readFileWithMtime` IPC + spawn `dch` CLI + 整棵字段树重建 + Markdown shiki
重渲染 + 每个 scope 的 5s timer 重启 + 各 panel 内 state 全丢）。首屏多花一次性
mount 成本，后续切换近乎零延迟。配套引入 `PanelVisibilityProvider`，让隐藏 panel
的 5s mtime poll 暂停（4 工具 × 3-4 scope ≈ 12-16 个 timer 后台空转的隐性开销）。

## 变更内容

### `src/client/App.tsx`

- 把 `<main>` 内 `view.kind === "profile" ? <ProfilePanel/> : <ConfigPanel/>` 三元表达式
  改成 ProfilePanel + 所有 tools 的 ConfigPanel **同时渲染**，每个外层包
  `<PanelVisibilityProvider visible={isVisible}>` + `<div className="panel-host[ panel-hidden]">`，
  用 className 控制 `display: none` 切换可见性
- 副带收益：各 panel 内部 state（mode / open / collapsed / edit buf）切回时全保留，
  之前每次切回都跟首次访问一样

### `src/client/components/panel-visibility.tsx`（新增）

- `PanelVisibilityProvider` + `usePanelVisible()` hook，默认 `true` 让单 panel /
  test 场景不需 wrap 即生效原 5s poll 行为

### `src/client/components/schema-mode/SchemaScopeBody.tsx`

- 5s mtime poll useEffect 接 `usePanelVisible()`：`!panelVisible` 直接 return
  不挂 setInterval；切回时 deps 触发重新挂上。隐藏期间磁盘新鲜度由 App.tsx 的
  `focus` / `visibilitychange` reload 兜底（已存在）

### `src/client/styles.css`

- 加 `.panel-host` (display: block) + `.panel-host.panel-hidden` (display: none)

## 备注

- **数据新鲜度不退化**：`focus` / `visibilitychange` 全局 reload（App.tsx + ProfilePanel）
  仍工作；prop-sync useEffect（scope.parsed/scope.content → 本地 setParsed）仍工作；
  当前可见 panel 的 5s poll 也仍工作。Panel 隐藏只是不主动 poll，回到该 panel 时
  立刻恢复，外加 focus reload 提供快速兜底
- **测试零回退**：230 pass / 0 fail（与 CHANGELOG_10 持平）
- 改动很小（4 文件），但消除的卡顿很核心：用户感知最强的「切到 Profile / Claude tab
  慢」直接归零（不再 spawn dch CLI、不再 lazy load shiki + 重渲染 markdown）
