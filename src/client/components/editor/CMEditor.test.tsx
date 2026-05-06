import { describe, expect, it } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { CMEditor } from "./CMEditor.tsx";
import { languageByName } from "./languages.ts";

describe("CMEditor (PR-J follow-up #2)", () => {
  it("mount 后 .cm-host 内有 CodeMirror 6 .cm-editor", () => {
    const { container } = render(<CMEditor value="hello" />);
    const host = container.querySelector(".cm-host");
    expect(host).toBeTruthy();
    expect(host?.querySelector(".cm-editor")).toBeTruthy();
    cleanup();
  });

  it("受控 value 显示在 .cm-content 里（happy-dom DOM 可见）", () => {
    const { container } = render(<CMEditor value="hello world" />);
    const content = container.querySelector(".cm-content");
    expect(content?.textContent).toContain("hello");
    cleanup();
  });

  it("unmount 完整释放 view（cleanup 后 .cm-editor 不残留）", () => {
    const { container, unmount } = render(<CMEditor value="abc" />);
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    unmount();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("外部 value 变化 → CMEditor 内容同步（受控 value sync）", async () => {
    const { container, rerender } = render(<CMEditor value="v1" />);
    expect(container.querySelector(".cm-content")?.textContent).toContain("v1");

    await act(async () => {
      rerender(<CMEditor value="v2" />);
    });
    expect(container.querySelector(".cm-content")?.textContent).toContain("v2");
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("v1");
    cleanup();
  });

  it("readOnly=true → contentEditable=false（CM6 EditorView.editable）", () => {
    const { container } = render(<CMEditor value="x" readOnly />);
    const content = container.querySelector(".cm-content");
    // CM6 readOnly 时 contentEditable 设为 "false"
    expect(content?.getAttribute("contenteditable")).toBe("false");
    cleanup();
  });

  it("readOnly=false（默认）→ contentEditable=true 可编辑", () => {
    const { container } = render(<CMEditor value="x" readOnly={false} />);
    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("true");
    cleanup();
  });

  it("language 切换走 Compartment reconfigure（不重建 view）", async () => {
    const { container, rerender } = render(
      <CMEditor value='{"a": 1}' language={languageByName("json")} />,
    );
    const view1 = container.querySelector(".cm-editor");
    expect(view1).toBeTruthy();

    await act(async () => {
      rerender(<CMEditor value='{"a": 1}' language={languageByName("yaml")} />);
    });
    // .cm-editor 应保持同一 DOM 节点（identity 检查通过 instance same）
    const view2 = container.querySelector(".cm-editor");
    expect(view2).toBe(view1);
    cleanup();
  });

  it("React 19 Strict Mode 双 mount 不残留两份 .cm-editor", () => {
    const { container, unmount } = render(
      <React.StrictMode>
        <CMEditor value="strict" />
      </React.StrictMode>,
    );
    // Strict Mode dev 双跑 effect 后应只剩一份 .cm-editor
    const editors = container.querySelectorAll(".cm-editor");
    expect(editors.length).toBe(1);
    unmount();
  });
});
