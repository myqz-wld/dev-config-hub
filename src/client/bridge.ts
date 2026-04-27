import { invoke } from "@tauri-apps/api/core";
import { parse as parseToml } from "smol-toml";
import type { ToolConfig, ConfigScope, ConfigEntry } from "../types.ts";
import { CLAUDE_CODE_DESCRIPTIONS, CODEX_DESCRIPTIONS, OPENCODE_DESCRIPTIONS } from "../descriptions.ts";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

function toEntries(parsed: Record<string, unknown>, descMap: Record<string, string>): ConfigEntry[] {
  return Object.entries(parsed).map(([key, value]) => ({ key, value, type: typeof value, description: descMap[key] }));
}

async function readFile(path: string): Promise<{ exists: boolean; content: string }> {
  const exists = await call<boolean>("file_exists", { path });
  if (!exists) return { exists: false, content: "" };
  const content = await call<string>("read_file", { path });
  return { exists: true, content };
}

function expandHomePath(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  return p;
}

// 读 profile configDir 下的某个文件（如 settings.json / config.toml）。不存在返回空串。
export async function readProfileConfigFile(configDir: string, filename: string): Promise<string> {
  const home = await call<string>("get_home_dir");
  const dirAbs = expandHomePath(configDir, home);
  const r = await readFile(`${dirAbs}/${filename}`);
  return r.exists ? r.content : "";
}

// 把内容写到 profile configDir 下的某个文件。父目录不存在时由 Rust 端 mkdir -p。
export async function writeProfileConfigFile(configDir: string, filename: string, content: string): Promise<void> {
  const home = await call<string>("get_home_dir");
  const dirAbs = expandHomePath(configDir, home);
  await saveFile(`${dirAbs}/${filename}`, content);
}

async function version(cmd: string): Promise<string> {
  return call<string>("get_tool_version", { command: cmd });
}

async function readJsonScope(path: string, level: ConfigScope["level"], label: string, descMap: Record<string, string>): Promise<ConfigScope> {
  const { exists, content } = await readFile(path);
  if (!exists) return { level, label, filePath: path, exists: false, format: "json", content: "", parsed: {}, categories: [] };
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(content); } catch {
    return { level, label, filePath: path, exists: true, format: "json", content, parsed: {}, categories: [] };
  }
  const items = toEntries(parsed, descMap);
  return { level, label, filePath: path, exists: true, format: "json", content, parsed,
    categories: items.length ? [{ name: "配置项", description: "", items }] : [] };
}

export async function loadAllConfigs(): Promise<ToolConfig[]> {
  const home = await call<string>("get_home_dir");
  const [shellV, claudeV, codexV, ocV] = await Promise.all([
    version("zsh --version"), version("claude --version"), version("codex --version"), version("opencode --version"),
  ]);

  const shellScopes: ConfigScope[] = [];
  for (const [level, label, file] of [["global", "~/.zprofile", ".zprofile"], ["user", "~/.zshrc", ".zshrc"]] as const) {
    const { exists, content } = await readFile(`${home}/${file}`);
    shellScopes.push({ level, label, filePath: `${home}/${file}`, exists, format: "dotfile", content, parsed: {}, categories: [] });
  }

  const claudeScopes = await Promise.all([
    readJsonScope(`${home}/.claude/settings.json`, "user", "~/.claude/settings.json", CLAUDE_CODE_DESCRIPTIONS),
    readJsonScope(`${home}/.claude/settings.local.json`, "local", "~/.claude/settings.local.json", CLAUDE_CODE_DESCRIPTIONS),
    (async () => {
      const { exists, content } = await readFile(`${home}/.claude/CLAUDE.md`);
      return { level: "user" as const, label: "~/.claude/CLAUDE.md", filePath: `${home}/.claude/CLAUDE.md`, exists, format: "markdown" as const, content, parsed: {}, categories: [] };
    })(),
    readJsonScope(`${home}/.claude/.mcp.json`, "user", "~/.claude/.mcp.json", {}),
  ]);

  const codexPath = `${home}/.codex/config.toml`;
  const codexFile = await readFile(codexPath);
  let codexScope: ConfigScope;
  if (codexFile.exists) {
    try {
      const parsed = parseToml(codexFile.content) as Record<string, unknown>;
      codexScope = { level: "global", label: "~/.codex/config.toml", filePath: codexPath, exists: true, format: "toml",
        content: codexFile.content, parsed, categories: [{ name: "配置项", description: "", items: toEntries(parsed, CODEX_DESCRIPTIONS) }] };
    } catch {
      codexScope = { level: "global", label: "~/.codex/config.toml", filePath: codexPath, exists: true, format: "toml", content: codexFile.content, parsed: {}, categories: [] };
    }
  } else {
    codexScope = { level: "global", label: "~/.codex/config.toml", filePath: codexPath, exists: false, format: "toml", content: "", parsed: {}, categories: [] };
  }

  const ocScope = await readJsonScope(`${home}/.config/opencode/opencode.json`, "global", "~/.config/opencode/opencode.json", OPENCODE_DESCRIPTIONS);

  return [
    { name: "Shell (Zsh)", version: shellV, icon: "terminal", description: "Zsh shell 环境配置", scopes: shellScopes },
    { name: "Claude Code", version: claudeV, icon: "claude", description: "Anthropic AI 编码助手", scopes: claudeScopes },
    { name: "Codex CLI", version: codexV, icon: "codex", description: "OpenAI AI 编码助手", scopes: [codexScope] },
    { name: "OpenCode", version: ocV, icon: "opencode", description: "开源 AI 编码助手", scopes: [ocScope] },
  ];
}

export async function saveFile(filePath: string, content: string): Promise<void> {
  await call("save_file", { path: filePath, content });
}

// ── Profile bridge: 通过 Tauri 调 dch CLI（--json 模式），结果统一 JSON ─────

export interface DchCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runDch<T = unknown>(args: string[]): Promise<T> {
  const r = await call<DchCommandResult>("run_dch_command", { args: ["profile", ...args, "--json"] });
  if (r.code !== 0) {
    let parsed: { error?: string } = {};
    try { parsed = JSON.parse(r.stdout) as { error?: string }; } catch {}
    throw new Error(parsed.error ?? r.stderr.trim() ?? `exit ${r.code}`);
  }
  if (!r.stdout.trim()) return undefined as T;
  return JSON.parse(r.stdout) as T;
}

import type {
  Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "../profiles/types.ts";

export type { Profile, ProfileStore, SwitchResult, ToolKind, HookResult };

export const dchProfile = {
  list: () => runDch<ProfileStore>(["list"]),

  add: (tool: ToolKind, id: string, opts: {
    dir?: string; env?: Record<string, string>; description?: string; from?: string;
    preHook?: string; postHook?: string;
  } = {}) => {
    const args = ["add", tool, id];
    if (opts.dir) args.push("--dir", opts.dir);
    if (opts.from) args.push("--from", opts.from);
    if (opts.description) args.push("--desc", opts.description);
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push("--env", `${k}=${v}`);
    if (opts.preHook) args.push("--pre-hook", opts.preHook);
    if (opts.postHook) args.push("--post-hook", opts.postHook);
    return runDch<{ ok: true; profile: Profile }>(args);
  },

  remove: (id: string) => runDch<{ ok: true; removed: string }>(["remove", id, "--yes"]),

  use: (id: string) => runDch<SwitchResult>(["use", id]),

  current: () => runDch<Record<ToolKind, { id: string | null; symlinkTarget: string | null }>>(["current"]),

  init: (tool: ToolKind) => runDch<{ ok: true; state: string; profileId: string; configDir: string }>(["init", tool]),

  testHook: (id: string, which: "pre" | "post") => runDch<HookResult | null>(["hook", "test", id, which]),

  config: (key: "hookTimeoutMs", value: number) =>
    runDch<{ ok: true }>(["config", key, String(value)]),
};
