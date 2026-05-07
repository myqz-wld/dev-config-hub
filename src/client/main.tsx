import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

window.addEventListener("unhandledrejection", (e) => {
  document.body.style.background = "#0d1117";
  document.body.style.color = "#f85149";
  document.body.style.padding = "40px";
  document.body.style.fontFamily = "monospace";
  document.body.innerHTML = `<h2>Error</h2><pre>${e.reason}</pre>`;
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
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 留 console 痕迹，dev / Console.app 可查
    console.error("[ErrorBoundary] App crashed:", error, info.componentStack);
  }

  render() {
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
  document.body.style.background = "#0d1117";
  document.body.style.color = "#f85149";
  document.body.style.padding = "40px";
  document.body.innerHTML = `<h2>Render Error</h2><pre>${e}</pre>`;
}
