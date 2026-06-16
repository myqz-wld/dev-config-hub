import { describe, expect, it, mock, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

/**
 * REVIEW_8 H7-同源 / Group E7 回归保护：AddProfileModal env KEY regex 校验。
 *
 * 必须与 src/profiles/manager.ts:ENV_KEY_RE 同源 (`/^[A-Za-z_][A-Za-z0-9_]*$/`)。
 * 旧版 UI 只验 `!envKey || !envVal` → 用户能输 `MY KEY=v` / `1FOO=v` / `K-K=v` 这些
 * 落盘但 wrapper 模式 silently 丢的非法 key（CHANGELOG_4 守口仅在 CLI 端）。
 */

mock.module("../../bridge.ts", () => ({
  readProfileConfigFile: () => Promise.resolve(""),
}));

import { AddProfileModal } from "./AddProfileModal.tsx";

describe("AddProfileModal env KEY regex (REVIEW_8 / Group E7)", () => {
  afterEach(() => cleanup());

  function renderModal() {
    return render(
      <AddProfileModal
        tool="claude"
        busy={false}
        existing={[]}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
  }

  function envInputs(container: HTMLElement) {
    const inputs = Array.from(container.querySelectorAll("input"));
    const keyInput = inputs.find((i) => i.placeholder === "变量名") as HTMLInputElement | undefined;
    const valInput = inputs.find((i) => i.placeholder === "值") as HTMLInputElement | undefined;
    const addBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "+") as HTMLButtonElement | undefined;
    return { keyInput, valInput, addBtn };
  }

  it("T1: 合法 KEY (FOO) + VALUE → + 按钮 enabled + 无错误提示", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);
    expect(keyInput && valInput && addBtn).toBeTruthy();

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "FOO" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });

    expect(addBtn!.disabled).toBe(false);
    expect(container.querySelector(".form-hint-error")).toBeNull();
  });

  it("T2: 数字开头 KEY (1FOO) → + 按钮 disabled + 错误提示出现", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "1FOO" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });

    expect(addBtn!.disabled).toBe(true);
    expect(container.querySelector(".form-hint-error")).toBeTruthy();
    expect(container.querySelector(".form-hint-error")?.textContent).toContain("变量名不符合规则");
  });

  it("T3: 含空格 KEY (MY KEY) → disabled", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "MY KEY" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });

    expect(addBtn!.disabled).toBe(true);
    expect(container.querySelector(".form-hint-error")).toBeTruthy();
  });

  it("T4: 含连字符 KEY (K-K) → disabled", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "K-K" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });

    expect(addBtn!.disabled).toBe(true);
  });

  it("T5: 含等号 KEY (K=V) → disabled（防被 = 当 separator 解析）", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "K=V" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });

    expect(addBtn!.disabled).toBe(true);
  });

  it("T6: 下划线开头 KEY (_PROXY) → enabled", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "_PROXY" } });
      fireEvent.input(valInput!, { target: { value: "http://x" } });
    });

    expect(addBtn!.disabled).toBe(false);
    expect(container.querySelector(".form-hint-error")).toBeNull();
  });

  it("T7: 大小写混合 + 数字 + 下划线 (httpProxy_v2) → enabled", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "httpProxy_v2" } });
      fireEvent.input(valInput!, { target: { value: "1.2.3.4" } });
    });

    expect(addBtn!.disabled).toBe(false);
  });

  it("T8: 输入合法 KEY 后改成非法 KEY → 错误提示出现 + 按钮变 disabled", async () => {
    const { container } = renderModal();
    const { keyInput, valInput, addBtn } = envInputs(container);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "FOO" } });
      fireEvent.input(valInput!, { target: { value: "bar" } });
    });
    expect(addBtn!.disabled).toBe(false);

    await act(async () => {
      fireEvent.input(keyInput!, { target: { value: "1FOO" } });
    });
    expect(addBtn!.disabled).toBe(true);
    expect(container.querySelector(".form-hint-error")).toBeTruthy();
  });
});
