import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import React from "react";

/**
 * REVIEW_8 H7 / Group E3 回归保护：ProfileStoreEditor mtime CAS。
 *
 * 验证 modal 自闭环 mtime CAS：
 *   - 打开 modal → readFileWithMtime 拿基线 mtime
 *   - save → saveFileIfMtime 透传基线
 *   - mtime mismatch / missing 抛 → inline conflict banner（reload / 保留 / 取消）
 *
 * mock isMtimeMismatch / isMtimeMissing 用 e.name 判断，与 ConfigPanel.test.tsx 同款规避
 * 跨 module class identity 不一致问题（详 bridge.ts 注释）。
 */
class MockMtimeMismatchError extends Error {
  constructor(public readonly expectedMtimeUs: number, public readonly actualMtimeUs: number) {
    super(`mtime mismatch ${expectedMtimeUs}/${actualMtimeUs}`);
    this.name = "MtimeMismatchError";
  }
}
class MockMtimeMissingError extends Error {
  constructor(public readonly expectedMtimeUs: number) {
    super(`mtime missing ${expectedMtimeUs}`);
    this.name = "MtimeMissingError";
  }
}

let saveFileIfMtimeImpl: (path: string, content: string, expected: number | null) => Promise<number>
  = () => Promise.resolve(2_000);
let readFileWithMtimeImpl: (path: string) => Promise<{ exists: boolean; content: string; mtimeUs: number | null }>
  = () => Promise.resolve({ exists: true, content: '{"profiles":[]}', mtimeUs: 1_000 });

mock.module("../../bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  readFileWithMtime: (path: string) => readFileWithMtimeImpl(path),
  saveFileIfMtime: (path: string, content: string, expected: number | null) =>
    saveFileIfMtimeImpl(path, content, expected),
  isMtimeMismatch: (e: unknown) => e instanceof Error && e.name === "MtimeMismatchError",
  isMtimeMissing: (e: unknown) => e instanceof Error && e.name === "MtimeMissingError",
}));

// stub schema lint extension（避免 codemirror-json-schema 在 happy-dom 下加载失败）
mock.module("../editor/schema-lint.ts", () => ({
  buildSchemaExtensions: () => [],
}));

mock.module("../editor/languages.ts", () => ({
  languageByName: () => undefined,
}));

import { ProfileStoreEditor } from "./ProfileStoreEditor.tsx";

describe("ProfileStoreEditor mtime CAS (REVIEW_8 H7 / Group E3)", () => {
  afterEach(() => {
    cleanup();
    saveFileIfMtimeImpl = () => Promise.resolve(2_000);
    readFileWithMtimeImpl = () => Promise.resolve({ exists: true, content: '{"profiles":[]}', mtimeUs: 1_000 });
  });

  it("T1: save 时把 readFileWithMtime 拿到的 mtimeUs 透传给 saveFileIfMtime", async () => {
    let capturedExpected: number | null | undefined;
    saveFileIfMtimeImpl = (_p, _c, expected) => {
      capturedExpected = expected;
      return Promise.resolve(3_000);
    };

    const onClose = mock(() => {});
    const onSaved = mock(() => {});
    const onToast = mock(() => {});

    const { container } = render(
      <ProfileStoreEditor onClose={onClose} onSaved={onSaved} onToast={onToast} />,
    );

    // 等 readFileWithMtime async 完成
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 关键断言：saveFileIfMtime 收到的 expected 是 readFileWithMtime 的 mtimeUs
    expect(capturedExpected).toBe(1_000);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("T2: saveFileIfMtime 抛 MtimeMismatchError → conflict banner 弹出", async () => {
    saveFileIfMtimeImpl = () =>
      Promise.reject(new MockMtimeMismatchError(1_000, 5_000));

    const onClose = mock(() => {});
    const onSaved = mock(() => {});
    const onToast = mock(() => {});

    const { container } = render(
      <ProfileStoreEditor onClose={onClose} onSaved={onSaved} onToast={onToast} />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(container.querySelector(".schema-conflict")).toBeNull();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 关键断言：conflict banner 弹出
    expect(container.querySelector(".schema-conflict")).toBeTruthy();
    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("外部修改");
    // onClose / onSaved 不应被调用（save 失败保留 modal 让用户决策）
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("T3: saveFileIfMtime 抛 MtimeMissingError → conflict banner 显示「已删除」文案", async () => {
    saveFileIfMtimeImpl = () => Promise.reject(new MockMtimeMissingError(1_000));

    const onClose = mock(() => {});
    const onSaved = mock(() => {});
    const onToast = mock(() => {});

    const { container } = render(
      <ProfileStoreEditor onClose={onClose} onSaved={onSaved} onToast={onToast} />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("已被外部删除");
  });

  it("T4: 「重新加载」按钮 → 重新调 readFileWithMtime 拿新内容 + 关闭 banner", async () => {
    saveFileIfMtimeImpl = () =>
      Promise.reject(new MockMtimeMismatchError(1_000, 5_000));

    let readCallCount = 0;
    readFileWithMtimeImpl = () => {
      readCallCount += 1;
      const next = readCallCount === 1
        ? { exists: true, content: '{"profiles":[]}', mtimeUs: 1_000 }
        : { exists: true, content: '{"profiles":[{"id":"new"}]}', mtimeUs: 5_000 };
      return Promise.resolve(next);
    };

    const onClose = mock(() => {});
    const onSaved = mock(() => {});
    const onToast = mock(() => {});

    const { container } = render(
      <ProfileStoreEditor onClose={onClose} onSaved={onSaved} onToast={onToast} />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 触发 mismatch banner
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container.querySelector(".schema-conflict")).toBeTruthy();

    // 点「重新加载」
    const reloadBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("重新加载")) as HTMLButtonElement | undefined;
    expect(reloadBtn).toBeTruthy();
    await act(async () => { fireEvent.click(reloadBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 关键断言：readFileWithMtime 被调 2 次（mount + reload）+ banner 消失
    expect(readCallCount).toBe(2);
    expect(container.querySelector(".schema-conflict")).toBeNull();
  });

  it("T5: 「保留我的改动」按钮 → enterEditMtimeRef 推 null 后再 save 第 3 参数 = null（CAS 弃权）", async () => {
    let capturedExpectedSecondCall: number | null | undefined;
    let saveCallCount = 0;
    saveFileIfMtimeImpl = (_p, _c, expected) => {
      saveCallCount += 1;
      if (saveCallCount === 1) {
        return Promise.reject(new MockMtimeMismatchError(1_000, 5_000));
      }
      capturedExpectedSecondCall = expected;
      return Promise.resolve(6_000);
    };

    const onClose = mock(() => {});
    const onSaved = mock(() => {});
    const onToast = mock(() => {});

    const { container } = render(
      <ProfileStoreEditor onClose={onClose} onSaved={onSaved} onToast={onToast} />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 1) save → mismatch → banner
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // 2) 点「保留我的改动」
    const keepBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("保留我的改动")) as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(keepBtn!); });
    expect(container.querySelector(".schema-conflict")).toBeNull();

    // 3) 再 save → 第 3 参数 = null（绕过 CAS）
    const saveBtn2 = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    await act(async () => { fireEvent.click(saveBtn2!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(capturedExpectedSecondCall).toBeNull();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
