import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import React from "react";

// Mock bridge IPC（避免 happy-dom 下 invoke Tauri command）
mock.module("../../bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  readFileWithMtime: () => Promise.resolve({ exists: true, content: '{"theme":"dark"}', mtimeUs: 1_000 }),
  saveFile: () => Promise.resolve(),
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
function makeTool(content: string): ToolConfig {
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
    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("外部修改");

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
});
