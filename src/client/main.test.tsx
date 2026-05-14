import { describe, expect, it, beforeEach } from "bun:test";

/**
 * REVIEW_8 H10 / Group E6 回归保护：renderFatalError 必须用 textContent 严格逃逸
 * 错误信息，绝不允许 innerHTML 字符串拼接（攻击者可控的 unhandledrejection.reason
 * 会塞进 body.innerHTML 直接 XSS）。
 *
 * happy-dom 提供完整 DOM API（document.createElement / textContent / innerHTML），
 * 可以直接验证：
 *   - 调 renderFatalError 后 parent.innerHTML 含 `<h2>` `<pre>` 但 `<script>` 标签是
 *     字面量字符串（textContent 已经把 < / > 转义成 &lt; / &gt;）
 *   - 多次调用清空旧子节点不叠加
 */
import { renderFatalError } from "./main.tsx";

describe("renderFatalError (REVIEW_8 H10 / Group E6)", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  it("T1: 普通错误信息正常渲染 <h2> + <pre>", () => {
    renderFatalError(parent, "Error", "TypeError: x is undefined");

    const h2 = parent.querySelector("h2");
    const pre = parent.querySelector("pre");
    expect(h2).toBeTruthy();
    expect(pre).toBeTruthy();
    expect(h2!.textContent).toBe("Error");
    expect(pre!.textContent).toBe("TypeError: x is undefined");
  });

  it("T2: XSS payload 被 textContent 字面量化（不会执行 script）", () => {
    const payload = '<script>window.__PWNED__=1</script><img src=x onerror="alert(1)">';
    renderFatalError(parent, "Error", payload);

    // 关键断言：parent 没有真正的 <script> / <img> 元素（textContent 已转义）
    expect(parent.querySelector("script")).toBeNull();
    expect(parent.querySelector("img")).toBeNull();

    // <pre> textContent 仍是原 payload 字面量
    const pre = parent.querySelector("pre");
    expect(pre!.textContent).toBe(payload);

    // innerHTML 里 < 必须出现成 &lt; 形式（textContent 转义副作用）
    expect(parent.innerHTML).toContain("&lt;script&gt;");
    expect(parent.innerHTML).not.toContain("<script>");
  });

  it("T3: 多次调用清空旧子节点（不叠加）", () => {
    renderFatalError(parent, "First", "first body");
    expect(parent.querySelectorAll("pre")).toHaveLength(1);
    expect(parent.querySelector("pre")!.textContent).toBe("first body");

    renderFatalError(parent, "Second", "second body");
    expect(parent.querySelectorAll("pre")).toHaveLength(1);
    expect(parent.querySelector("pre")!.textContent).toBe("second body");
    expect(parent.querySelector("h2")!.textContent).toBe("Second");
  });

  it("T4: title 也走 textContent 转义", () => {
    renderFatalError(parent, "<svg onload=alert(1)>", "x");
    expect(parent.querySelector("svg")).toBeNull();
    expect(parent.querySelector("h2")!.textContent).toBe("<svg onload=alert(1)>");
  });

  it("T5: parent style 被设置（视觉与原 inline 一致）", () => {
    renderFatalError(parent, "x", "y");
    // happy-dom 不做 hex → rgb 转换，直接保留字面量；浏览器实际渲染会标准化但语义等价
    expect(parent.style.background).toBe("#0d1117");
    expect(parent.style.color).toBe("#f85149");
    expect(parent.style.padding).toBe("40px");
    expect(parent.style.fontFamily).toBe("monospace");
  });
});
