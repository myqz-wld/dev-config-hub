import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

/**
 * 与项目 styles.css token 对齐的 CodeMirror 6 主题包。
 *
 * 策略：oneDark 提供语法着色（与项目 #0d1117 / 蓝绿紫橙青色板天然接近），
 * 上层 EditorView.theme 覆盖容器 / gutter / 选区 token 让边框 / 字号 / 行高与
 * 现有 .scope-body / .raw / .json CSS 视觉一致。
 *
 * readOnly=true 时隐藏光标 + activeLine 高亮 = 透明，以求与「源文件查看」
 * 静态展示的语义对齐（用户不会以为是可编辑区）。
 */
export function projectTheme(opts: { readOnly?: boolean } = {}): Extension {
  const { readOnly = false } = opts;
  return [
    oneDark,
    EditorView.theme(
      {
        "&": {
          backgroundColor: "var(--bg0)",
          color: "var(--fg0)",
          fontSize: "12px",
        },
        ".cm-scroller": {
          fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: "1.7",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg1)",
          borderRight: "1px solid var(--border)",
          color: "var(--fg3)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: readOnly ? "transparent" : "rgba(88,166,255,.06)",
        },
        ".cm-activeLine": {
          backgroundColor: readOnly ? "transparent" : "rgba(88,166,255,.04)",
        },
        ".cm-content": {
          padding: "10px 0",
          // readOnly 时光标透明 = 不可见（与「源文件查看」静态展示语义对齐）
          // C18：caretColor: "transparent" 与 .cm-cursor display:none 双开关冗余，
          // 留 caretColor 一处（控原生 caret）；删 .cm-cursor（CM 自绘 cursor 不存在 readOnly 状态）
          caretColor: readOnly ? "transparent" : "var(--blue)",
        },
        ".cm-selectionBackground": {
          backgroundColor: "rgba(88,166,255,.18) !important",
        },
        "&.cm-focused .cm-selectionBackground": {
          backgroundColor: "rgba(88,166,255,.25) !important",
        },
        "&.cm-focused": { outline: "none" },
      },
      { dark: true },
    ),
  ];
}
