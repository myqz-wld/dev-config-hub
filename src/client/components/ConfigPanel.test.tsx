import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import React from "react";

// Mock bridge IPC（getHomeDir / readFileWithMtime / saveFile）以避免 happy-dom 下 invoke Tauri command
// 必须在 ConfigPanel import 之前 mock；bun:test mock.module 会替换整个模块
mock.module("../../bridge.ts", () => ({
  getHomeDir: () => Promise.resolve("/Users/test"),
  readFileWithMtime: () => Promise.resolve({ exists: true, content: '{"theme":"dark"}', mtimeUs: 1_000 }),
  saveFile: () => Promise.resolve(),
}));

// 同样 mock CMEditor 的语言扩展（不需要真编辑器逻辑，只测 banner / disabled 行为）
mock.module("./editor/languages.ts", () => ({
  languageExtensionFor: () => undefined,
  languageByName: () => undefined,
}));

// schema-lint 用到的 codemirror-json-schema 在 happy-dom 偶尔报 navigator/clipboard 缺失，stub 掉
mock.module("./editor/schema-lint.ts", () => ({
  buildSchemaExtensions: () => [],
}));

import { ConfigPanel } from "./ConfigPanel.tsx";
import type { ToolConfig } from "../../types.ts";

/**
 * 构造一份最小化 ToolConfig，仅 1 个 JSON scope（claude settings.json 形态）。
 * 不带 schema 也能跑（无 toolSchema 时 mode 默认 view，加「编辑」按钮触发 edit 模式）。
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
      parsed: JSON.parse(content),
      categories: [],
    }],
  };
}

describe("ConfigPanel H1 fix (CHANGELOG_10 R_2·H1-followup)", () => {
  beforeEach(() => {});
  afterEach(() => cleanup());

  it("T1: edit 模式下外部 reload 推 scope.content 变 → banner 出现 + 保存按钮 disabled", async () => {
    const onSave = mock(() => Promise.resolve());
    const onPatchSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    );

    // 进 edit 模式：点「编辑」按钮（最后一个 .btn-sm 即「编辑」）
    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    expect(editBtn).toBeTruthy();
    await act(async () => { fireEvent.click(editBtn!); });

    // 现在应该在 edit 模式：保存按钮可见 + 当前 enabled（没外部变化）
    let saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    expect(saveBtn!.disabled).toBe(false);
    // banner 不应显示
    expect(container.querySelector(".schema-conflict")).toBeNull();

    // 模拟外部 reload 推 scope.content 变化
    const newTool = makeTool('{"theme":"light"}');
    await act(async () => { rerender(
      <ConfigPanel tool={newTool} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    ); });

    // banner 应出现（externalChanged=true）
    expect(container.querySelector(".schema-conflict")).toBeTruthy();
    expect(container.querySelector(".schema-conflict-msg")?.textContent).toContain("外部修改");

    // **核心断言**：保存按钮 disabled = true（H1-followup HIGH 必修：banner 期间硬拦截 save）
    saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "保存") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    expect(saveBtn!.disabled).toBe(true);
  });

  it("T2: 「保留我的改动」按钮在 buf===enterEditRef（用户没真改过）时 disabled", async () => {
    const onSave = mock(() => Promise.resolve());
    const onPatchSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // 触发 banner（外部 reload 推变化）
    const newTool = makeTool('{"theme":"light"}');
    await act(async () => { rerender(
      <ConfigPanel tool={newTool} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    ); });

    // 「保留我的改动」按钮应 disabled（用户进 edit 后没动过 buf，buf === enterEditRef.current = "{...dark}")
    const keepBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("保留我的改动")) as HTMLButtonElement | undefined;
    expect(keepBtn).toBeTruthy();
    expect(keepBtn!.disabled).toBe(true);
  });

  it("T3: scope.content 回退到 enterEditRef 基线时 banner 自动消失（else 对称清零）", async () => {
    const onSave = mock(() => Promise.resolve());
    const onPatchSave = mock(() => Promise.resolve());
    const onToast = mock(() => {});
    const tool = makeTool('{"theme":"dark"}');

    const { container, rerender } = render(
      <ConfigPanel tool={tool} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    );

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "编辑");
    await act(async () => { fireEvent.click(editBtn!); });

    // 1) 外部改 → banner 出现
    await act(async () => { rerender(
      <ConfigPanel tool={makeTool('{"theme":"light"}')} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    ); });
    expect(container.querySelector(".schema-conflict")).toBeTruthy();

    // 2) 外部撤销回基线（如 git checkout）→ scope.content === enterEditRef.current → banner 消失
    await act(async () => { rerender(
      <ConfigPanel tool={makeTool('{"theme":"dark"}')} onSave={onSave} onPatchSave={onPatchSave} onToast={onToast} />,
    ); });
    expect(container.querySelector(".schema-conflict")).toBeNull();
  });
});
