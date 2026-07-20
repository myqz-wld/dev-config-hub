import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { toml as legacyToml } from "@codemirror/legacy-modes/mode/toml";
import { shell as legacyShell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell as legacyPowerShell } from "@codemirror/legacy-modes/mode/powershell";
import type { ConfigScope } from "../../../types.ts";

/**
 * 把 ConfigScope.format 映射到 CodeMirror 6 语言扩展。
 *
 *   json     → @codemirror/lang-json（Lezer）
 *   toml     → legacy-modes toml（流式解析，5% 边角不完美但够日常配置查看）
 *   markdown → @codemirror/lang-markdown（含 GFM 基础）
 *   dotfile  → legacy-modes shell
 *
 * **未声明 default 分支**（REVIEW_3 codex#5）：用 `never` exhaustive check
 * 让将来 ConfigScope.format 联合类型加新值时编译期就报错，避免漏分支。
 */
export function languageExtensionFor(format: ConfigScope["format"]): Extension {
  switch (format) {
    case "json":
    case "jsonc":
      return json();
    case "toml":
      return StreamLanguage.define(legacyToml);
    case "markdown":
      return markdown();
    case "dotfile":
      return StreamLanguage.define(legacyShell);
    case "powershell":
      return StreamLanguage.define(legacyPowerShell);
    default: {
      // exhaustive check：format 加新值时编译报错
      const _exhaustive: never = format;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * 通用按名取语言扩展（PR-G / PR-I 字段控件 codeLanguage 用）。
 * 未识别返回空 extension（CM 仍能纯文本渲染）。
 */
export function languageByName(name: string): Extension {
  switch (name) {
    case "json":
      return json();
    case "yaml":
      return yaml();
    case "markdown":
      return markdown();
    case "toml":
      return StreamLanguage.define(legacyToml);
    case "shell":
      return StreamLanguage.define(legacyShell);
    default:
      return [];
  }
}
