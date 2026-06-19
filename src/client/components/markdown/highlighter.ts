/**
 * Shiki lazy 高亮（PR-H）。
 *
 * **加载策略**：首次调 `highlightCode` 时动态 import shiki 主体 + 创建 single-theme highlighter，
 * 后续按需 `loadLanguage` 增量。共享单例避免重复 init（shiki 实例较重）。
 *
 * **支持语言**：常见配置 / 文档场景：json / toml / yaml / shell / bash / typescript /
 * javascript / rust / python / markdown。其他语言 fallback 到 plain 渲染。
 *
 * **theme**：固定 vitesse-light（与当前白纸手写主题对齐）。
 */

import type { HighlighterCore } from "shiki";

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

const SUPPORTED_LANGS: ReadonlySet<string> = new Set([
  "json", "jsonc", "toml", "yaml", "yml",
  "shell", "sh", "bash", "zsh",
  "ts", "typescript", "tsx", "js", "javascript", "jsx",
  "rust", "rs", "python", "py", "markdown", "md",
  "html", "css", "diff",
]);

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighterCore } = await import("shiki/core");
      const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");
      const themeMod = await import("shiki/themes/vitesse-light.mjs");
      const hl = await createHighlighterCore({
        themes: [themeMod.default],
        langs: [],
        engine: createOnigurumaEngine(import("shiki/wasm")),
      });
      return hl;
    })();
  }
  return highlighterPromise;
}

async function ensureLang(hl: HighlighterCore, lang: string): Promise<string | null> {
  if (loadedLangs.has(lang)) return lang;
  if (!SUPPORTED_LANGS.has(lang)) return null;
  try {
    // REVIEW_4 H3 类型修：shiki 的 LanguageRegistration object 与 BundledLanguage（string union）不直接兼容；
    // 用 LanguageInput 是 hl.loadLanguage 真正接受的类型
    const mod = await import(`shiki/langs/${lang}.mjs`);
    await hl.loadLanguage(mod.default);
    loadedLangs.add(lang);
    return lang;
  } catch {
    return null;
  }
}

/**
 * 把代码 + 语言 → shiki 高亮 HTML。
 *
 * 失败（语言不支持 / shiki 加载失败）→ throw，caller fallback plain `<pre>`。
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  const realLang = await ensureLang(hl, lang);
  if (!realLang) throw new Error(`unsupported lang: ${lang}`);
  return hl.codeToHtml(code, { lang: realLang, theme: "vitesse-light" });
}
