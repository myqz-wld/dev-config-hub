import React, { createContext, useContext } from "react";

/**
 * Panel 是否当前可见（tab 是否为 active view）。
 *
 * 用途：App.tsx 改成「所有 panel 常驻 + display 切换」消除 tab 切换 unmount/remount 卡顿后，
 * 后台隐藏的 panel 内 5s mtime poll 不应继续跑（4 工具 × 3-4 scope ≈ 12-16 个 timer 空转）。
 * SchemaScopeBody 用 usePanelVisible() 判断当前 panel 是否激活，hidden 时 useEffect 直接 return
 * 不启动 setInterval；切回 visible 时 useEffect deps 触发 → 重新挂上 poll。
 *
 * 默认 `true`：testing / 单 panel 场景下不需要 provider 也能跑（保持原有 5s poll 行为）。
 */
const PanelVisibilityContext = createContext<boolean>(true);

export function PanelVisibilityProvider({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <PanelVisibilityContext.Provider value={visible}>{children}</PanelVisibilityContext.Provider>;
}

export function usePanelVisible(): boolean {
  return useContext(PanelVisibilityContext);
}
