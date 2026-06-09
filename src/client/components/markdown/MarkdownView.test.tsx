import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView.tsx";

describe("MarkdownView (PR-J follow-up #2)", () => {
  it("渲染 GFM 标题 + 段落 + 列表", () => {
    const { container } = render(
      <MarkdownView source={"# 标题\n\n段落\n\n- A\n- B\n"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelector("p")?.textContent).toBe("段落");
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("fenced code 带 language-xxx className", () => {
    const { container } = render(
      <MarkdownView source={"```ts\nconst x = 1;\n```\n"} />,
    );
    // shiki lazy 未就绪时显示 plain <pre><code class="language-ts">...
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.className).toMatch(/language-ts/);
  });

  it("inline code 走 .md-code-inline 而非 fenced", () => {
    const { container } = render(<MarkdownView source={"用 `code` 标 inline"} />);
    const inline = container.querySelector(".md-code-inline");
    expect(inline?.textContent).toBe("code");
  });

  it("rehype-sanitize 移除 <script>", () => {
    const { container } = render(
      <MarkdownView source={"段落\n\n<script>alert('XSS')</script>\n"} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("rehype-sanitize 移除 javascript: URL", () => {
    const { container } = render(
      <MarkdownView source={"[click](javascript:alert(1))"} />,
    );
    const link = container.querySelector("a");
    // SAFE_SCHEMA href 仅允许 http(s) / mailto / # → javascript: 被 strip
    expect(link?.getAttribute("href")).toBeFalsy();
  });

  it("外链强制 target=_blank + rel=noreferrer noopener", () => {
    const { container } = render(
      <MarkdownView source={"[example](https://example.com)"} />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("内部锚点链不加 target=_blank（避免新窗口）", () => {
    const { container } = render(<MarkdownView source={"[内部](#anchor)"} />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("target")).toBeFalsy();
  });

  it("GFM 表格渲染（remark-gfm 启用）", () => {
    const { container } = render(
      <MarkdownView source={"| A | B |\n|---|---|\n| 1 | 2 |\n"} />,
    );
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
  });
});
