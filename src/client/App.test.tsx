import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

// Mock bridge：T7 套首次 loadAllVersions reject、retry 成功；T8 套首屏 reloadingRef guard 验 spawn ≤ 3。
let versionsCallCount = 0;
type MockVersions = { shell: string; claude: string; codex: string; grok: string; cursor: string };
const MOCK_VERSIONS: MockVersions = {
  shell: "5.9", claude: "1.0.0", codex: "0.1", grok: "0.2", cursor: "3.11",
};
let versionsImpl: () => Promise<MockVersions> = () => Promise.resolve(MOCK_VERSIONS);
let filesCallCount = 0;
const mockTool = (name: string, icon: string) => ({
  name,
  version: "1.0.0",
  icon,
  description: `${name} desc`,
  scopes: [],
});
let filesImpl = () => Promise.resolve([mockTool("Test Tool", "claude")]);
const visibleToolTitle = (container: HTMLElement) =>
  container.querySelector(".panel-host:not(.panel-hidden) .panel:not(.profile-panel) h1")?.textContent ?? "";

mock.module("./bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  getConfigEnvironment: () => Promise.resolve({
    home: "/Users/test",
    platform: "darwin",
    fishInstalled: false,
    powerShellProfiles: [],
  }),
  loadAllVersions: () => {
    versionsCallCount += 1;
    return versionsImpl();
  },
  loadAllFiles: () => {
    filesCallCount += 1;
    return filesImpl();
  },
  saveFile: () => Promise.resolve(),
  loadProfileDataDirect: () => Promise.resolve({
    store: { version: 2, profiles: [], active: { claude: null, codex: null, grok: null, cursor: null }, backup: { toolPolicies: {} } },
    active: {
      claude: { id: null, rootPath: "/Users/test/.claude", symlinkTarget: null },
      codex: { id: null, rootPath: "/Users/test/.codex", symlinkTarget: null },
      grok: { id: null, rootPath: "/Users/test/.grok", symlinkTarget: null },
      cursor: { id: null, rootPath: "/Users/test/.cursor", symlinkTarget: null },
    },
  }),
}));

import { App } from "./App.tsx";

describe("App.load() setError(null) (CHANGELOG_10 R_1·L1 fix)", () => {
  afterEach(() => {
    versionsCallCount = 0;
    filesCallCount = 0;
    versionsImpl = () => Promise.resolve(MOCK_VERSIONS);
    filesImpl = () => Promise.resolve([mockTool("Test Tool", "claude")]);
    cleanup();
  });

  it("T7: 首次 load 失败 → error 屏；focus 触发 reload 成功 → setError(null) 让主 UI 恢复", async () => {
    versionsImpl = () => {
      versionsImpl = () => Promise.resolve(MOCK_VERSIONS);
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
  // load = 6 zsh spawn × 2 比修复前还差。
  it("T8: 首屏 load 期间 focus 触发 → reloadingRef guard 让 loadAllVersions 仍只调一次", async () => {
    // 给 versions 一个慢 promise 模拟首屏未完成
    let resolveVersions: ((v: MockVersions) => void) | null = null;
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
      resolveVersions!(MOCK_VERSIONS);
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

  it("T9: focus reload 后工具列表重排，仍按工具名保持当前选中项", async () => {
    filesImpl = () => Promise.resolve([
      mockTool("Alpha App", "claude"),
      mockTool("Beta App", "codex"),
    ]);

    const { container } = render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const betaButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item"))
      .find((btn) => btn.textContent?.includes("Beta App"));
    expect(betaButton).toBeTruthy();

    await act(async () => { fireEvent.click(betaButton!); });
    expect(betaButton!.className).toContain("on");
    expect(visibleToolTitle(container)).toContain("Beta App");

    filesImpl = () => Promise.resolve([
      mockTool("Beta App", "codex"),
      mockTool("Alpha App", "claude"),
    ]);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((r) => setTimeout(r, 200));
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item"));
    const betaAfter = buttons.find((btn) => btn.textContent?.includes("Beta App"));
    const alphaAfter = buttons.find((btn) => btn.textContent?.includes("Alpha App"));

    expect(betaAfter?.className).toContain("on");
    expect(alphaAfter?.className).not.toContain("on");
    expect(visibleToolTitle(container)).toContain("Beta App");
  });

  it("T10: sidebar 选中项显示左侧红色铅笔小圈，重复点击会换一版形状", async () => {
    const originalRandom = Math.random;
    let randomValue = 0.14;
    Math.random = () => randomValue;

    try {
      filesImpl = () => Promise.resolve([mockTool("Sketch Tool", "claude")]);

      const { container } = render(<App />);
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      const activeButton = container.querySelector<HTMLButtonElement>(".nav-item.on");
      const firstCircle = activeButton?.querySelector<SVGPathElement>(".nav-pencil-circle-main");
      expect(activeButton?.textContent).toContain("Sketch Tool");
      expect(activeButton?.querySelector(".nav-pencil-circle")).toBeTruthy();
      expect(activeButton?.querySelector(".nav-todo")).toBeNull();
      expect(firstCircle).toBeTruthy();

      const firstPath = firstCircle!.getAttribute("d");
      randomValue = 0.86;
      await act(async () => { fireEvent.click(activeButton!); });

      const secondPath = activeButton!
        .querySelector<SVGPathElement>(".nav-pencil-circle-main")
        ?.getAttribute("d");
      expect(secondPath).toBeTruthy();
      expect(secondPath).not.toBe(firstPath);
    } finally {
      Math.random = originalRandom;
    }
  });
});
