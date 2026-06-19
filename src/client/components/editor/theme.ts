import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * 与项目 styles.css token 对齐的 CodeMirror 6 主题包。
 *
 * 语法色由 CMEditor 注入的 defaultHighlightStyle 负责；这里仅控制容器、gutter、
 * 选区和纸面交互状态，让配置正文直接显示在便签颜色上。
 *
 * readOnly=true 时隐藏光标 + activeLine 高亮 = 透明，以求与「源文件查看」
 * 静态展示的语义对齐（用户不会以为是可编辑区）。
 */
export function projectTheme(opts: { readOnly?: boolean } = {}): Extension {
  const { readOnly = false } = opts;
  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: "transparent",
          color: "#2a2116",
          fontSize: "12px",
        },
        ".cm-scroller": {
          fontFamily: "'HanziPen SC', 'Kaiti SC', 'STKaiti', 'Marker Felt', 'Comic Sans MS', cursive",
          lineHeight: "1.78",
          backgroundColor: "transparent",
        },
        ".cm-line": {
          lineHeight: "1.78",
        },
        ".cm-gutterElement": {
          lineHeight: "1.78",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid rgba(203,88,76,.26)",
          color: "rgba(54,38,20,.50)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: readOnly ? "transparent" : "rgba(255,255,255,.22)",
        },
        ".cm-activeLine": {
          backgroundColor: readOnly ? "transparent" : "rgba(255,255,255,.18)",
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
      { dark: false },
    ),
  ];
}
