import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

// REVIEW_8 H7 / Group E2：mock bridge.ts 时一并 stub MtimeMismatchError / MtimeMissingError
// 让 ConfigPanel.tsx 内 `e instanceof MtimeMismatchError` 路径能正确触发。
// 必须用 module 顶层 class（不是 file-local），mock 共享给 ConfigPanel + 本测共用同一引用。
class MockMtimeMismatchError extends Error {
  constructor(public readonly expectedMtimeUs: number, public readonly actualMtimeUs: number) {
    super(`mtime mismatch expected=${expectedMtimeUs} actual=${actualMtimeUs}`);
    this.name = "MtimeMismatchError";
  }
}
class MockMtimeMissingError extends Error {
  constructor(public readonly expectedMtimeUs: number) {
    super(`mtime missing expected=${expectedMtimeUs}`);
    this.name = "MtimeMissingError";
  }
}

// Mock bridge IPC（避免 happy-dom 下 invoke Tauri command）
mock.module("../../bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  readFileWithMtime: () => Promise.resolve({ exists: true, content: '{"theme":"dark"}', mtimeUs: 1_000 }),
  saveFile: () => Promise.resolve(),
  saveFileIfMtime: () => Promise.resolve(2_000),
  MtimeMismatchError: MockMtimeMismatchError,
  MtimeMissingError: MockMtimeMissingError,
  // isMtimeMismatch / isMtimeMissing 用 e.name 判断，与 bridge.ts 真实实现一致
  isMtimeMismatch: (e: unknown) => e instanceof Error && e.name === "MtimeMismatchError",
  isMtimeMissing: (e: unknown) => e instanceof Error && e.name === "MtimeMissingError",
}));

// stub CMEditor 的语言扩展
mock.module("./editor/languages.ts", () => ({
  languageExtensionFor: () => undefined,
  languageByName: () => undefined,
}));

import { ConfigPanel } from "./ConfigPanel.tsx";
import type { ToolConfig } from "../../types.ts";

/**
 * 构造一份最小化 ToolConfig，仅 1 个 JSON scope。
 * 默认 view 模式（CMEditor 只读），点「编辑」进 edit。
 */
function makeTool(content: string, loadedMtimeUs?: number | null): ToolConfig {
  return {
    name: "Test Tool",
    version: "1.0.0",
    icon: "claude",
    description: "test",
    scopes: [{
      level: "user",
      label: "~/.test/settings.json",
      filePath: "/Users/test/.test/settings.json",
      exists: true,
      format: "json",
      content,
      ...(loadedMtimeUs !== undefined ? { loadedMtimeUs } : {}),
    }],
  };
}

describe("ConfigPanel TOCTOU banner (CHANGELOG_10 R_2·H1-followup)", () => {
  beforeEach(() => {});
  afterEach(() => cleanup());

  it("T1: edit 模式下外部 reload 推 scope.content 变 → banner 出现 + 保存按钮 disabled", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    // 进 edit 模式：点「编辑」按钮
    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    expect(editBtn).toBeTruthy();
    await act(async () => { fireEvent.click(editBtn!); });

    // 现在应该在 edit 模式：保存按钮可见 + 当前 enabled（没外部变化）
    let saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    expect(saveBtn!.disabled).toBe(false);
    expect(container.querySelector(".schema-conflict")).toBeNull();

    // 模拟外部 reload 推 scope.content 变化
    const newTool = makeTool('{"theme":"light"}');
    await act(async () => { rerender(
      <ConfigPanel tool={newTool} onSave={onSave} onToast={onToast} />,
    ); });

    // banner 应出现
    expect(container.querySelector(".schema-conflict")).toBeTruthy();
    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("其他程序修改");

    // 核心断言：保存按钮 disabled = true
    saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    expect(saveBtn!.disabled).toBe(true);
  });

  it("T2: 「保留我的改动」按钮在 buf===enterEditRef（用户没真改过）时 disabled", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    const newTool = makeTool('{"theme":"light"}');
    await act(async () => { rerender(
      <ConfigPanel tool={newTool} onSave={onSave} onToast={onToast} />,
    ); });

    const keepBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("保留我的改动")) as HTMLButtonElement | undefined;
    expect(keepBtn).toBeTruthy();
    expect(keepBtn!.disabled).toBe(true);
  });

  it("T3: scope.content 回退到 enterEditRef 基线时 banner 自动消失（else 对称清零）", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // 1) 外部改 → banner 出现
    await act(async () => { rerender(
      <ConfigPanel tool={makeTool('{"theme":"light"}')} onSave={onSave} onToast={onToast} />,
    ); });
    expect(container.querySelector(".schema-conflict")).toBeTruthy();

    // 2) 外部撤销回基线 → banner 消失
    await act(async () => { rerender(
      <ConfigPanel tool={makeTool('{"theme":"dark"}')} onSave={onSave} onToast={onToast} />,
    ); });
    expect(container.querySelector(".schema-conflict")).toBeNull();
  });

  // REVIEW_8 H7 / Group E2: mtime CAS last-line defense 回归保护
  it("T4: enter-edit 拿到 loadedMtimeUs，点 save 时透传给 onSave 第 3 参数", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}', 12345);

    const { container } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });

    // onSave 第 3 参数 === enter-edit 时的 loadedMtimeUs
    expect(onSave).toHaveBeenCalledWith(
      "/Users/test/.test/settings.json",
      '{"theme":"dark"}',
      12345,
    );
  });

  it("T5: onSave 抛 MtimeMismatchError → externalChanged banner 自动弹出（与父级 reload 同款 UX）", async () => {
    const onSave = mock(() => Promise.reject(new MockMtimeMismatchError(1000, 2000)));
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}', 1000);

    const { container } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // banner 起初不存在
    expect(container.querySelector(".schema-conflict")).toBeNull();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    // 分两段 act：先 fire click，再单独 act 让 async onSave reject + catch + setState 完整 flush
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // 验 onSave 真被调用（catch 路径必经 await）
    expect(onSave).toHaveBeenCalledTimes(1);
    // 关键断言：banner 弹出（catch 路径触发，不等父级 reload）
    expect(container.querySelector(".schema-conflict")).toBeTruthy();
    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("其他程序修改");
  });

  it("T6: onSave reject MtimeMismatchError 后 banner 弹出 + 取消编辑能退出", async () => {
    const onSave = mock(() => Promise.reject(new MockMtimeMismatchError(1000, 2000)));
    const onToast = mock(() => {});

    const { container } = render(
      <ConfigPanel tool={makeTool('{"theme":"dark"}', 1000)} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector(".schema-conflict")).toBeTruthy();

    // 走「取消编辑」退出 edit 模式（buf 没改过 → 「保留我的改动」按钮 CHANGELOG_10 R_2·H1-followup
    // 设计 disabled，本测验另一条路径：取消编辑后 banner 消失 + 退回 view 模式）
    const cancelEditBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "取消编辑") as HTMLButtonElement | undefined;
    expect(cancelEditBtn).toBeTruthy();
    await act(async () => { fireEvent.click(cancelEditBtn!); });
    expect(container.querySelector(".schema-conflict")).toBeNull();
  });

  // REVIEW_8 R2 R2-8 / R3 G4：touch-only 回归测（外部 touch mtime 变 content 不变 → 不应弹 banner
  // 且下次 save 用最新 mtime 不是 stale 1000）
  it("T7 (R2-8 / G4): touch-only 场景 — content 不变 mtime 变 → banner 不弹 + save 用最新 mtime", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}', 1000);

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    // 进 edit 模式（mtime=1000 snapshot 到 enterEditMtimeRef）
    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // 模拟外部 `touch` 文件：content 不变，mtime 变 1000 → 2000
    const touchedTool = makeTool('{"theme":"dark"}', 2000);
    await act(async () => { rerender(
      <ConfigPanel tool={touchedTool} onSave={onSave} onToast={onToast} />,
    ); });

    // 断言 1：banner 不弹（content 未变）
    expect(container.querySelector(".schema-conflict")).toBeNull();

    // 断言 2：save 用最新 mtime=2000 而非 stale 1000（旧实现 enterEditMtimeRef 不更新 → 透传 1000 →
    // 后端 CAS stat 拿到 2000 → 抛 MtimeMismatchError → 用户莫名其妙看到 banner）
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    expect(onSave).toHaveBeenCalledWith(
      "/Users/test/.test/settings.json",
      '{"theme":"dark"}',
      2000, // 最新 mtime, 不是 enter-edit 时的 1000
    );
  });

  // REVIEW_8 R2 R2-7 / R3 G4：CAS 失败后用户在 banner 上点「使用磁盘版本」按钮，scope.content /
  // loadedMtimeUs 应是 reload 后的最新值（G4: App.tsx 在 catch isMtimeMismatch 后主动调
  // loadFilesOnly，让父级推 scope 更新 → ConfigPanel banner 弹出 +「使用磁盘版本」按钮 setBuf
  // 拿到的是新 content/新 mtime）。
  // 本测在 ConfigPanel 单元层验：rerender 推新 scope 后，「使用磁盘版本」按钮把 buf / enterEditMtimeRef
  // 切到新 scope，下次 save 用新 mtime 不再撞 CAS。
  it("T8 (R2-7 / G4): banner 弹出后「使用磁盘版本」按钮使下次 save 用最新 mtime（不再撞 CAS）", async () => {
    const onSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}', 1000);

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // 模拟 CAS 失败 → App.tsx 调 loadFilesOnly → 父级推新 scope（content + mtime 都变）
    const reloadedTool = makeTool('{"theme":"light"}', 3000);
    await act(async () => { rerender(
      <ConfigPanel tool={reloadedTool} onSave={onSave} onToast={onToast} />,
    ); });

    // banner 应弹出（content 变了）
    expect(container.querySelector(".schema-conflict")).toBeTruthy();

    // 用户点「使用磁盘版本（放弃我的改动）」按钮
    const reloadBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("使用磁盘版本")) as HTMLButtonElement | undefined;
    expect(reloadBtn).toBeTruthy();
    await act(async () => { fireEvent.click(reloadBtn!); });

    // banner 消失，buf 切到新 content
    expect(container.querySelector(".schema-conflict")).toBeNull();

    // 现在 save 应用新 mtime=3000 而非 stale 1000（旧实现 R2-7 的问题：scope.content/mtime
    // 没真 reload，「使用磁盘版本」按钮只复用旧 scope 仍是 stale）
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    expect(onSave).toHaveBeenCalledWith(
      "/Users/test/.test/settings.json",
      '{"theme":"light"}', // reload 后的新 content
      3000,                 // reload 后的新 mtime（不是 stale 1000）
    );
  });
});
