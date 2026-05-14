import type { HookScript } from "../../../profiles/types.ts";
import type { ToolKind } from "../../bridge.ts";

/**
 * REVIEW_8 H7-同源 / Group E7：env key 校验 regex。
 *
 * **必须与 `src/profiles/manager.ts:ENV_KEY_RE` / `src/cli-profile.ts:233 ENV_KEY_RE`
 * 完全一致**（任何分叉会让 UI 通过的 key 在 CLI / wrapper 阶段被静默丢弃，难调试）。
 *
 * **为什么前端单独定义而不 import manager.ts**：manager.ts 依赖 store.ts / hooks.ts /
 * symlink.ts（Node-only 模块：fs / lockfile / spawn），bundle 进前端必失败 —— 复制 1
 * 行 regex 比把 Node 模块塞进前端 bundle 安全得多。如果将来要保证不分叉可以加
 * cargo-style consistency check，但现在两处都是 1 行常量 + tally AP 已可发现。
 */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const TOOLS: ToolKind[] = ["claude", "codex"];

export const MAIN_CONFIG: Record<ToolKind, {
  filename: string;
  format: "json" | "toml";
  placeholder: string;
}> = {
  claude: {
    filename: "settings.json",
    format: "json",
    placeholder: '{\n  "model": "claude-opus-4-7",\n  "env": {\n    "DISABLE_TELEMETRY": "1"\n  },\n  "permissions": {\n    "allow": ["mcp__*"]\n  }\n}\n',
  },
  codex: {
    filename: "config.toml",
    format: "toml",
    placeholder: 'model = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n\n[projects."/Users/apple"]\ntrust_level = "trusted"\n',
  },
};

export interface AddForm {
  tool: ToolKind;
  id: string;
  dir: string;
  description: string;
  from: string;
  env: Record<string, string>;
  preHook: string;
  postHook: string;
  configContent: string;     // settings.json / config.toml 完整内容（空 = 不创建该文件）
}

/**
 * REVIEW_2 PR-4 修 typecheck：HookScript = string | { posix?, powershell?, cmd? }
 * UI 简化策略 — object 形式 hook 在 textarea 里显示其 posix 字段（POSIX 平台主用），
 * 用户编辑回写还是 string 形式（要写 object 形式直接编辑 ~/.dch/profiles.json 走 ProfileStoreEditor 即可）。
 */
export function hookToString(h: HookScript | undefined): string {
  if (!h) return "";
  if (typeof h === "string") return h;
  return h.posix ?? h.powershell ?? h.cmd ?? "";
}

/** 简单遮蔽看起来像 key/token 的值（仅显示）。 */
export function maskValue(k: string, v: string): string {
  if (/key|token|secret|password/i.test(k) && v.length > 8) {
    return v.slice(0, 4) + "•••" + v.slice(-4);
  }
  return v;
}
