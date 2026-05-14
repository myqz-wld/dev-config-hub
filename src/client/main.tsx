import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

/**
 * REVIEW_8 H10 / Group E6：渲染 root 之前 / 渲染期顶层 throw 的 fatal error overlay。
 *
 * **不能用 `innerHTML`**：错误信息可能含 HTML / `<script>` 注入字符（用户 .zshrc 解析坏 →
 * unhandledrejection.reason 携带未消毒字符串 → `body.innerHTML = "...${reason}..."` 直接 XSS）。
 * React 还没起或已 unmount → 不能用 React fallback；走原生 DOM API + textContent 严格逃逸。
 *
 * 两处调用：
 *   1. unhandledrejection 全局监听（React mount 失败 / 异步 promise 没人 catch）
 *   2. createRoot.render() 同步 throw（最早期 root mount 失败）
 */
export function renderFatalError(parent: HTMLElement, title: string, body: string): void {
  // 容器样式与原 inline style 等价（保持视觉一致）
  parent.style.background = "#0d1117";
  parent.style.color = "#f85149";
  parent.style.padding = "40px";
  parent.style.fontFamily = "monospace";

  // 清空旧子节点（避免 React partially-mounted 残留 + 二次 fatal error 叠 DOM）
  while (parent.firstChild) parent.removeChild(parent.firstChild);

  const h2 = document.createElement("h2");
  h2.textContent = title;

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.textContent = body;

  parent.appendChild(h2);
  parent.appendChild(pre);
}

window.addEventListener("unhandledrejection", (e) => {
  // e.reason 可能是 Error / string / 任意对象；统一转 string，由 textContent 消毒
  const reason = e.reason instanceof Error
    ? (e.reason.stack || e.reason.message || String(e.reason))
    : String(e.reason);
  renderFatalError(document.body, "Error", reason);
});

/**
 * 顶层 ErrorBoundary：拦截 App 内任意子组件的渲染期 throw。
 *
 * 没有它时，单个 schema 字段的渲染异常（如 ArrayField 收到非数组 value）会让 React
 * 整个 root unmount，回到 index.html 默认 `<div>Loading...</div>`，从用户视角等同
 * 「永远卡 Loading」无法恢复（reviews/REVIEW_9.md）。
 *
 * React 19 仍要求 ErrorBoundary 用 class component（hooks 没等价 API）。
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 留 console 痕迹，dev / Console.app 可查
    console.error("[ErrorBoundary] App crashed:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      const err = this.state.error;
      const msg = err.message || String(err);
      const stack = err.stack || "";
      return (
        <div style={{
          background: "#0d1117", color: "#f85149", padding: 40,
          fontFamily: "monospace", minHeight: "100vh",
        }}>
          <h2 style={{ margin: "0 0 16px" }}>⚠ App 渲染错误</h2>
          {/* React 19 minified build 的 error.stack 不带 message 前缀，单独显示 */}
          <pre style={{
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            background: "#161b22", padding: 16, borderRadius: 6,
            color: "#f85149", fontWeight: 600, marginBottom: 12,
          }}>
            {msg}
          </pre>
          <pre style={{
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            background: "#161b22", padding: 16, borderRadius: 6, color: "#e6edf3",
            fontSize: 11,
          }}>
            {stack}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{
              marginTop: 16, padding: "8px 16px", background: "#238636",
              color: "white", border: 0, borderRadius: 6, cursor: "pointer",
              fontFamily: "inherit", fontSize: 13,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary><App /></ErrorBoundary>
  );
} catch (e) {
  // REVIEW_8 H10 / Group E6：root mount throw → 用 textContent helper 消毒
  // （不能用 innerHTML：e.toString() 可能含 HTML / `<script>`）
  const body = e instanceof Error ? (e.stack || e.message || String(e)) : String(e);
  renderFatalError(document.body, "Render Error", body);
}
