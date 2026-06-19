import React, { useEffect, useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { highlightCode } from "./highlighter.ts";

/**
 * 通用 Markdown 渲染（PR-H）。
 *
 * **栈**：
 *   - react-markdown 10：纯 React 渲染（不接 raw HTML）
 *   - remark-gfm：GitHub Flavored Markdown（表格 / 任务列表 / strikethrough / autolink）
 *   - remark-breaks：单换行 → `<br>`（贴近 GitHub 默认体验）
 *   - rehype-sanitize：即使是本地文件也 sanitize（防 schema 描述 / CLAUDE.md 误带 `<script>` 或 `javascript:` URL 注入）
 *   - shiki（lazy import）：fenced code block 高亮，按需加载语言包；首次出现 markdown scope 才加载 highlighter
 *
 * **安全**：rehype-sanitize 默认 schema（`defaultSchema`）已 strip 危险 attribute（onerror / javascript: 等）；
 * 额外限制 `a.href` 仅允许 http / https / mailto / # 内部锚（不允许 file:// / data: 等）。
 *
 * **caller 记得**：value 必须是 markdown 文本（不要传 HTML）。
 */
// memo：source 不变时跳过整条 remark/rehype/sanitize 解析管线。父面板（ConfigPanel）
// 常驻挂载，App 每次重渲染会连带触发 MarkdownView 重渲染 = 大文件（如 CLAUDE.md）反复重解析。
export const MarkdownView = memo(function MarkdownView({ source, className = "md-view" }: { source: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, SAFE_SCHEMA]]}
        components={{
          code: CodeBlock,
          a: SafeLink,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

const SAFE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [
      // REVIEW_4 L2 注释修：实际防御 javascript: / data: 协议靠 defaultSchema.protocols.href
      // 白名单 [http, https, mailto, ...]；本 regex 仅作 belt-and-suspenders 装饰
      ...((defaultSchema.attributes?.a ?? []) as Array<string | [string, ...unknown[]]>),
      ["href", /^https?:|^mailto:|^#/],
      "target",
      "rel",
    ],
    // fenced code 的 className 让 shiki 能用 lang-xxx 类名
    code: [
      ...((defaultSchema.attributes?.code ?? []) as Array<string | [string, ...unknown[]]>),
      ["className", /^language-[\w-]+$/],
    ],
  },
};

/**
 * 代码块组件：lazy 调 shiki highlight；高亮就绪前显示 plain `<pre><code>`。
 *
 * react-markdown v10 的 code 组件签名：children = 文本，className 含 `language-xxx`。
 */
function CodeBlock(props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode; node?: unknown; inline?: boolean }) {
  const { className, children } = props;
  const code = String(children ?? "");
  const langMatch = /language-([\w-]+)/.exec(className ?? "");
  const lang = langMatch ? langMatch[1]! : "";
  const isInline = !className && !code.includes("\n");
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (isInline || !lang) return;
    let cancelled = false;
    highlightCode(code, lang)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [code, lang, isInline]);

  if (isInline) {
    return <code className="md-code-inline">{children}</code>;
  }
  if (html) {
    return <div className="md-code-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // shiki 未就绪 / 无 lang → 纯文本
  return (
    <pre className="md-code-block plain">
      <code className={className}>{children}</code>
    </pre>
  );
}

function SafeLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
  // 外链强制 target=_blank + noopener noreferrer
  const isExternal = !!href && /^https?:\/\//.test(href);
  return (
    <a href={href} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noreferrer noopener" : undefined}>
      {children}
    </a>
  );
}
