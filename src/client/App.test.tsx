import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

// Mock bridge：第一次 loadAllConfigs reject，第二次 resolve（模拟 first load fail → focus retry success）
let loadCallCount = 0;
mock.module("./bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  loadAllConfigs: () => {
    loadCallCount += 1;
    if (loadCallCount === 1) return Promise.reject(new Error("simulated first load fail"));
    return Promise.resolve([{
      name: "Test Tool",
      version: "1.0.0",
      icon: "claude",
      description: "test",
      scopes: [],
    }]);
  },
  saveFile: () => Promise.resolve(),
  dchProfile: {
    list: () => Promise.resolve({ version: 1, profiles: [], active: { claude: null, codex: null }, preferences: {} }),
    current: () => Promise.resolve({ claude: { id: null, symlinkTarget: null }, codex: { id: null, symlinkTarget: null } }),
  },
}));

import { App } from "./App.tsx";

describe("App.load() setError(null) (CHANGELOG_10 R_1·L1 fix)", () => {
  afterEach(() => {
    loadCallCount = 0;
    cleanup();
  });

  it("T7: 首次 load 失败 → error 屏；focus 触发 reload 成功 → setError(null) 让主 UI 恢复", async () => {
    const { container } = render(<App />);

    // 第一次 mount → load() reject → error 屏
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector(".error-text")?.textContent).toContain("simulated first load fail");

    // 模拟 focus 事件触发 retry
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((r) => setTimeout(r, 50));
    });

    // 核心断言：error 屏消失（setError(null) 生效）+ 主 UI 渲染
    expect(container.querySelector(".error-text")).toBeNull();
    expect(container.querySelector(".sidebar")).toBeTruthy();
    expect(container.querySelector(".logo-title")?.textContent).toBe("Dev Config Hub");
  });
});
