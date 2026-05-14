import React, { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { projectTheme } from "./theme.ts";

/**
 * 稳定的空数组引用作为 extraExtensions 默认值——避免每次 render 创建新 []
 * 触发 reconfigure useEffect（即使 caller 没传也不该 noop dispatch）。
 */
const EMPTY_EXTRA: readonly Extension[] = [];

export interface CMEditorProps {
  value: string;
  onChange?: (next: string) => void;
  language?: Extension;
  readOnly?: boolean;
  /** 容器最大高度（px 或 CSS 字符串）。CM 自身内部滚动；外层不要再 scroll 嵌套。 */
  maxHeight?: number | string;
  /**
   * 额外扩展（PR-G 注入 JSON Schema lint / hover；MarkdownField 注入 markdown 配置）。
   *
   * **caller 必须用 useMemo 稳定引用**（REVIEW_3 R_1·C9）：
   * 本组件用专属 Compartment 跟踪 extraExtensions 变化触发 reconfigure；
   * 但 deps 是引用比对，caller 每次 render 传新数组（即使内容相同）会触发
   * 一次 noop reconfigure，对大文件性能差。强烈建议：
   *
   *   const extras = useMemo(() => [jsonSchema(...), lintGutter()], [schema])
   *   <CMEditor extraExtensions={extras} ... />
   *
   * 已修复 PR-F 原始版本的 deps `[]` 闭包陷阱（PR-G 注入会被静默忽略）。
   *
   * REVIEW_4 H3 类型修：改成 `readonly Extension[]` 以接受 `EMPTY_EXTRA` 默认 readonly 数组。
   */
  extraExtensions?: readonly Extension[];
}

/**
 * CodeMirror 6 的 React 19 受控包装。
 *
 * 设计要点：
 *   1. **mount/unmount 严格 cleanup**：React 19 Strict Mode dev 模式 effect 双跑，
 *      第二次 mount 必须释放第一次的 view，否则父容器残留两份 .cm-editor。
 *   2. **language / readOnly / extraExtensions 走 Compartment**：reconfigure 不重建 view。
 *   3. **受控 value 同步**：外部 value 变（reload / 切 scope）+ 与 view 不一致 → dispatch replace；
 *      若一致则无操作（避免循环）。
 *   4. **onChangeRef 解耦闭包**：onChange 引用变化时不重建 view（updateListener 通过 ref 总拿最新 onChange）。
 *   5. **不依赖 @uiw/react-codemirror**：每次 props 变会 dispatch 新 transaction 对受控大文本性能差，
 *      且把 effect 依赖糊在内部难做 onSave 协议。自包 ~150 行能精确控制 React 19 严格 effect。
 */
export function CMEditor({
  value,
  onChange,
  language,
  readOnly = false,
  maxHeight = 480,
  extraExtensions = EMPTY_EXTRA,
}: CMEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const extraCompartment = useRef(new Compartment());
  // REVIEW_8 H8 / Group E4：theme + maxHeight 也走 Compartment，让 readOnly / maxHeight prop
  // 变化能 reconfigure 而不重建 view（旧版 spread 在 mount 数组 → caller 切 readOnly 时
  // projectTheme 不会重跑，cm-content caretColor 不更新；caller 切 maxHeight 时容器
  // 高度也不变）。修完后 readOnly 切换会同时触发 readOnlyCompartment + themeCompartment
  // 两条 reconfigure（前者管 EditorState/EditorView 行为开关、后者管视觉 token），是预期。
  const themeCompartment = useRef(new Compartment());
  const maxHeightCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);

  // onChange 引用同步：updateListener 闭包总能拿到最新 onChange
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // mount：建 view
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
        ]),
        langCompartment.current.of(language ?? []),
        readOnlyCompartment.current.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
        // PR-F 原始版本把 extraExtensions spread 到 mount 数组，deps `[]` →
        // PR-G 注入静默忽略（C9）。改用 Compartment 提供 reconfigure 通道
        // R_2 D3：直接传 extraExtensions 引用（**不**解构 [...]）——
        // 解构会让 caller useMemo 稳定的引用在内部失效，CM6 reconfigure 不做
        // 内容比对会触发 noop transaction
        extraCompartment.current.of(extraExtensions),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChangeRef.current) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
        themeCompartment.current.of(projectTheme({ readOnly })),
        maxHeightCompartment.current.of(EditorView.theme({
          "&": {
            maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          },
          ".cm-scroller": { overflow: "auto" },
        })),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化 → 同步到 view（仅当真不同；避免 onChange → state → value → dispatch 死循环）
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  // language 切换走 Compartment reconfigure
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: langCompartment.current.reconfigure(language ?? []),
    });
  }, [language]);

  // readOnly 切换走 Compartment reconfigure（含 readOnly + editable 双开关）
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // extraExtensions 切换走 Compartment reconfigure（REVIEW_3 R_1·C9 修复 + R_2 D3 微调）
  // 直接透传引用、**不**解构 [...]：caller useMemo 稳定时本组件就稳定，
  // 避免「caller 已 memo 但内部 spread 又生新数组 → reconfigure 总触发 noop transaction」
  //
  // REVIEW_4 R_2 L2：之前 L4 fix 用 isFirstExtraEffect ref guard 跳过初次 noop reconfigure；
  // 但 React 19 Strict Mode dev 双 mount 下 ref.current 在 unmount 后**不重置**，第二次 mount 仍 dispatch。
  // 既然 Strict Mode 下补救不彻底 + 生产环境本就只 mount 一次（节省 ~1ms），不如直接接受 noop dispatch
  // 简化逻辑（删 ref guard + 接受 1ms cost）。
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: extraCompartment.current.reconfigure(extraExtensions),
    });
  }, [extraExtensions]);

  // REVIEW_8 H8 / Group E4：projectTheme 跟随 readOnly reconfigure
  // （旧版 spread 在 mount 数组 → caller 切 readOnly 时 caretColor / activeLine 视觉不更新）。
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: themeCompartment.current.reconfigure(projectTheme({ readOnly })),
    });
  }, [readOnly]);

  // REVIEW_8 H8 / Group E4：maxHeight 跟随 prop reconfigure
  // （旧版 spread 在 mount 数组 → caller 切 maxHeight 时容器高度不更新）。
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: maxHeightCompartment.current.reconfigure(EditorView.theme({
        "&": {
          maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        },
        ".cm-scroller": { overflow: "auto" },
      })),
    });
  }, [maxHeight]);

  return <div ref={hostRef} className="cm-host" />;
}
