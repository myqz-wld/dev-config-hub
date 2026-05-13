import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

// Mock bridge：T7 套首次 loadAllVersions reject、retry 成功；T8 套首屏 reloadingRef guard 验 spawn ≤ 4。
let versionsCallCount = 0;
let versionsImpl: () => Promise<{ shell: string; claude: string; codex: string; opencode: string }> = () =>
  Promise.resolve({ shell: "5.9", claude: "1.0.0", codex: "0.1", opencode: "0.1" });
let filesCallCount = 0;

mock.module("./bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  loadAllVersions: () => {
    versionsCallCount += 1;
    return versionsImpl();
  },
  loadAllFiles: () => {
    filesCallCount += 1;
    return Promise.resolve([{
      name: "Test Tool",
      version: "1.0.0",
      icon: "claude",
      description: "test",
      scopes: [],
    }]);
  },
  saveFile: () => Promise.resolve(),
  loadProfileDataDirect: () => Promise.resolve({
    store: { version: 1, profiles: [], active: { claude: null, codex: null }, preferences: { hookTimeoutMs: 30_000 } },
    active: { claude: { id: null, symlinkTarget: null }, codex: { id: null, symlinkTarget: null } },
  }),
}));

import { App } from "./App.tsx";

describe("App.load() setError(null) (CHANGELOG_10 R_1·L1 fix)", () => {
  afterEach(() => {
    versionsCallCount = 0;
    filesCallCount = 0;
    versionsImpl = () =>
      Promise.resolve({ shell: "5.9", claude: "1.0.0", codex: "0.1", opencode: "0.1" });
    cleanup();
  });

  it("T7: 首次 load 失败 → error 屏；focus 触发 reload 成功 → setError(null) 让主 UI 恢复", async () => {
    versionsImpl = () => {
      versionsImpl = () =>
        Promise.resolve({ shell: "5.9", claude: "1.0.0", codex: "0.1", opencode: "0.1" });
      return Promise.reject(new Error("simulated first load fail"));
    };

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

  // CHANGELOG_15 Plan agent Q5 race 回归保护：首屏 load 还在跑时用户 focus → reloadingRef
  // 必须 skip 这次，否则 versionsRef.current 还是 null → loadFilesOnly fallback 跑全量
  // load = 8 zsh spawn × 2 比修复前还差。
  it("T8: 首屏 load 期间 focus 触发 → reloadingRef guard 让 loadAllVersions 仍只调一次", async () => {
    // 给 versions 一个慢 promise 模拟首屏未完成
    let resolveVersions: ((v: { shell: string; claude: string; codex: string; opencode: string }) => void) | null = null;
    versionsImpl = () =>
      new Promise((resolve) => {
        resolveVersions = resolve;
      });

    render(<App />);

    // 首屏 load 已起跑（reloadingRef = true）但还没 resolve
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(versionsCallCount).toBe(1);

    // 用户切走又切回 → onAppActive fire → reloadingRef.current=true 应让其 skip
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      await new Promise((r) => setTimeout(r, 10));
    });
    // 关键断言：versions 仍只调 1 次（race 没让首屏并发跑两次 versions）
    expect(versionsCallCount).toBe(1);

    // 让首屏 load 完成
    await act(async () => {
      resolveVersions!({ shell: "5.9", claude: "1.0.0", codex: "0.1", opencode: "0.1" });
      await new Promise((r) => setTimeout(r, 50));
    });

    // 现在 versions 还是 1 次（reload 路径走 loadFilesOnly 用缓存，不再调 versions）
    // 后续 focus 也只跑 loadAllFiles（不跑 versions）
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((r) => setTimeout(r, 200)); // > 100ms dedupe 窗口
    });
    expect(versionsCallCount).toBe(1);
    // loadAllFiles 至少跑过：首屏一次 + focus 一次（具体次数受 dedupe 窗口和 reloadingRef 影响）
    expect(filesCallCount).toBeGreaterThanOrEqual(2);
  });
});
