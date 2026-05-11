import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

// Mock bridge IPC，避免 happy-dom 下 invoke Tauri command
mock.module("../../bridge.ts", () => ({
  readFileWithMtime: () => Promise.resolve({ exists: true, content: '{"k":1}', mtimeUs: 1_000 }),
}));

import { SchemaScopeBody, isUserTyping } from "./SchemaScopeBody.tsx";
import { RootUiPrefsProvider } from "../fields/ui-prefs-context.tsx";
import type { ConfigScope } from "../../../types.ts";
import type { ToolSchema } from "../../../schemas/types.ts";

/** SchemaScopeBody 内部用 useScopedUiPrefs / RootUiPrefsContext，必须 wrap */
function withProvider(children: React.ReactNode) {
  return <RootUiPrefsProvider initial={{ hiddenFields: {} }}>{children}</RootUiPrefsProvider>;
}

const minimalScope = (parsed: Record<string, unknown>, content: string): ConfigScope => ({
  level: "user",
  label: "~/.test/settings.json",
  filePath: "/Users/test/.test/settings.json",
  exists: true,
  format: "json",
  content,
  parsed,
  categories: [],
});

const minimalSchema: ToolSchema = {
  $id: "test@1",
  $source: "test",
  fetchedAt: "2026-05-09",
  scopeKind: "claude-settings",
  rootSchema: {
    type: "object",
    properties: {
      k: { type: "integer" },
    },
    additionalProperties: true,
  },
};

describe("SchemaScopeBody isUserTyping helper (CHANGELOG_10 R_1·M1 / R_2·M1-followup)", () => {
  afterEach(() => {
    // 复位 activeElement
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur?.();
    }
    cleanup();
  });

  it("activeElement = body / null → false", () => {
    expect(isUserTyping()).toBe(false);
  });

  it("activeElement = INPUT → true", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isUserTyping()).toBe(true);
    input.remove();
  });

  it("activeElement = TEXTAREA → true", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    expect(isUserTyping()).toBe(true);
    ta.remove();
  });

  it("activeElement = contentEditable=true div → true", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    div.focus();
    expect(isUserTyping()).toBe(true);
    div.remove();
  });

  it("activeElement = contentEditable=false div → false（read-only CMEditor 不误触发）", () => {
    const div = document.createElement("div");
    div.contentEditable = "false";
    div.tabIndex = 0;  // 让 div focusable
    document.body.appendChild(div);
    div.focus();
    expect(isUserTyping()).toBe(false);
    div.remove();
  });

  it("activeElement = BUTTON / SELECT → false（非文本输入控件）", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    expect(isUserTyping()).toBe(false);
    btn.remove();
  });
});

describe("SchemaScopeBody prop-sync useEffect (CHANGELOG_10 R_1 + R_2 fix)", () => {
  afterEach(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur?.();
    }
    cleanup();
  });

  it("T4-baseline: scope.parsed prop 变化 → local parsed 同步", async () => {
    const onPatchSave = mock(() => Promise.resolve());
    const flash = mock(() => {});

    const { container, rerender } = render(withProvider(
      <SchemaScopeBody scope={minimalScope({ k: 1 }, '{"k":1}')} toolSchema={minimalSchema} onPatchSave={onPatchSave} flash={flash} />,
    ));

    // baseline：value 1 应渲染到 input
    let input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input?.value).toBe("1");

    // 推 prop 变化
    await act(async () => {
      rerender(withProvider(
        <SchemaScopeBody scope={minimalScope({ k: 2 }, '{"k":2}')} toolSchema={minimalSchema} onPatchSave={onPatchSave} flash={flash} />,
      ));
    });

    input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input?.value).toBe("2");
  });

  it("T4-isUserTyping: 用户 focus 在 INPUT 内 → prop-sync skip → local parsed 保持旧值", async () => {
    const onPatchSave = mock(() => Promise.resolve());
    const flash = mock(() => {});

    const { container, rerender } = render(withProvider(
      <SchemaScopeBody scope={minimalScope({ k: 1 }, '{"k":1}')} toolSchema={minimalSchema} onPatchSave={onPatchSave} flash={flash} />,
    ));

    // 用户 focus 到 input（模拟「正在打字」）
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(isUserTyping()).toBe(true);

    // 推 prop 变化（模拟外部 reload）
    await act(async () => {
      rerender(withProvider(
        <SchemaScopeBody scope={minimalScope({ k: 999 }, '{"k":999}')} toolSchema={minimalSchema} onPatchSave={onPatchSave} flash={flash} />,
      ));
    });

    // **核心断言**：isUserTyping guard 命中 → prop-sync skip → 显示仍是旧值 1（防 R_2·M1-followup MED 回归）
    const inputAfter = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(inputAfter?.value).toBe("1");
  });
});
