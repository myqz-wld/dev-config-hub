import { invoke } from "@tauri-apps/api/core";
import type { ToolConfig, ConfigScope } from "../types.ts";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

async function readFile(path: string): Promise<{ exists: boolean; content: string }> {
  const exists = await call<boolean>("file_exists", { path });
  if (!exists) return { exists: false, content: "" };
  // PR-4/PR-6 (#M12)：file_exists + read_file 双 IPC 之间有 async gap；
  // 另一进程 / profile 切换可能在此期间删除该文件 → read_file Err。
  // 失败时降级为「文件不存在」语义，让 UI 优雅退化。
  try {
    const content = await call<string>("read_file", { path });
    return { exists: true, content };
  } catch (e) {
    console.warn(`readFile race: ${path} 在 file_exists 与 read_file 之间消失:`, e);
    return { exists: false, content: "" };
  }
}

/**
 * Tauri `read_file_with_mtime` 命令的回报。
 *
 * 字段契约必须与 `src-tauri/src/lib.rs` 的 `ReadFileWithMtimeResult` Rust struct 同步
 * （REVIEW_3 R_1·C12）：Rust 端用 `#[serde(rename_all = "camelCase")]` 把 `mtime_us`
 * 序列化成 `mtimeUs`。改 Rust 端字段名时务必同步改这里。
 */
export interface ReadFileWithMtimeResult {
  exists: boolean;
  content: string;
  /**
   * Unix epoch microseconds；不存在 / 拿不到 mtime 时 null。
   *
   * us 精度（REVIEW_3 R_1·C7）：APFS 连续两次 fs::write 实测间隔 ~335 µs。
   * 三态语义：null = 文件不存在 / metadata 失败 / pre-1970；number = 正常 mtime。
   */
  mtimeUs: number | null;
}

/**
 * 单次 IPC 拿 exists + content + mtime。原子读取消除 file_exists/read_file 双 IPC race，
 * 且回报 mtime 给 ConfigPanel edit 模式做 TOCTOU 比对。
 */
export async function readFileWithMtime(path: string): Promise<ReadFileWithMtimeResult> {
  return call<ReadFileWithMtimeResult>("read_file_with_mtime", { path });
}

function expandHomePath(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  return p;
}

// 把 `~/.x/` / `~/.x` / `/Users/apple/.x/` / `/Users/apple/.x//` 都规范成同一字符串，
// 用于 dir 撞车校验。只展开 home + 折叠 `//` + 去尾 `/`，不解析 `..`。
export function normalizeProfileDir(p: string, home: string): string {
  if (!p) return "";
  let abs = expandHomePath(p, home);
  abs = abs.replace(/\/+/g, "/").replace(/\/+$/, "");
  return abs || "/";
}

export async function getHomeDir(): Promise<string> {
  return call<string>("get_home_dir");
}

/**
 * 读目录下文件列表（name + isFile）。
 *
 * Rust 端 `read_dir` 拒绝非 HOME 路径（webview 不能列任意目录）。
 * 不存在的目录返回空数组（不当 error）。
 */
export interface DirEntry {
  name: string;
  isFile: boolean;
}
export async function readDir(path: string): Promise<DirEntry[]> {
  return call<DirEntry[]>("read_dir", { path });
}

// 读 profile configDir 下的某个文件（如 settings.json / config.toml）。不存在返回空串。
export async function readProfileConfigFile(configDir: string, filename: string): Promise<string> {
  const home = await getHomeDir();
  const dirAbs = expandHomePath(configDir, home);
  const r = await readFile(`${dirAbs}/${filename}`);
  return r.exists ? r.content : "";
}

// 把内容写到 profile configDir 下的某个文件。父目录不存在时由 Rust 端 mkdir -p。
export async function writeProfileConfigFile(configDir: string, filename: string, content: string): Promise<void> {
  const home = await getHomeDir();
  const dirAbs = expandHomePath(configDir, home);
  await saveFile(`${dirAbs}/${filename}`, content);
}

async function version(cmd: string): Promise<string> {
  return call<string>("get_tool_version", { command: cmd });
}

async function readScope(
  path: string, level: ConfigScope["level"], label: string, format: ConfigScope["format"],
): Promise<ConfigScope> {
  const { exists, content } = await readFile(path);
  return { level, label, filePath: path, exists, format, content };
}

export async function loadAllConfigs(): Promise<ToolConfig[]> {
  const home = await call<string>("get_home_dir");
  const [shellV, claudeV, codexV, ocV] = await Promise.all([
    version("zsh --version"), version("claude --version"), version("codex --version"), version("opencode --version"),
  ]);

  const shellScopes: ConfigScope[] = await Promise.all([
    readScope(`${home}/.zprofile`, "global", "~/.zprofile", "dotfile"),
    readScope(`${home}/.zshrc`, "user", "~/.zshrc", "dotfile"),
  ]);

  const claudeScopes = await Promise.all([
    readScope(`${home}/.claude/settings.json`, "user", "~/.claude/settings.json", "json"),
    readScope(`${home}/.claude/settings.local.json`, "local", "~/.claude/settings.local.json", "json"),
    readScope(`${home}/.claude/CLAUDE.md`, "user", "~/.claude/CLAUDE.md", "markdown"),
    readScope(`${home}/.claude/.mcp.json`, "user", "~/.claude/.mcp.json", "json"),
  ]);

  const codexScope = await readScope(`${home}/.codex/config.toml`, "global", "~/.codex/config.toml", "toml");
  const ocScope = await readScope(`${home}/.config/opencode/opencode.json`, "global", "~/.config/opencode/opencode.json", "json");

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

async function runDch<T = unknown>(args: string[], timeoutMs?: number): Promise<T> {
  // REVIEW_7 H2：按命令传 timeoutMs；Rust 端 spawn_with_timeout 兜底 1800s 上限。
  // 不传 = Rust 默认（30 分钟，覆盖最坏 hookTimeoutMs 600000ms × 2 + 余量）。
  const r = await call<DchCommandResult>("run_dch_command", { args: ["profile", ...args, "--json"], timeoutMs });
  if (r.code === -2) {
    throw new Error(`命令超时被强制终止 (timeout=${timeoutMs ?? "default"}ms)。检查 hook 脚本是否阻塞`);
  }
  if (r.code !== 0) {
    let parsed: { error?: string } = {};
    try { parsed = JSON.parse(r.stdout) as { error?: string }; } catch {}
    throw new Error(parsed.error || r.stderr.trim() || `exit ${r.code}`);
  }
  if (!r.stdout.trim()) return undefined as T;
  return JSON.parse(r.stdout) as T;
}

const TIMEOUT_FAST_MS = 10_000;   // 纯文件读写：list / current / show / add / remove / env / config
const TIMEOUT_INIT_MS = 30_000;   // init：含 mv + ln 等 fs 操作

import type {
  Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "../profiles/types.ts";

export type { Profile, ProfileStore, SwitchResult, ToolKind, HookResult };

export const dchProfile = {
  list: () => runDch<ProfileStore>(["list"], TIMEOUT_FAST_MS),

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
    return runDch<{ ok: true; profile: Profile }>(args, TIMEOUT_FAST_MS);
  },

  remove: (id: string) => runDch<{ ok: true; removed: string }>(["remove", id, "--yes"], TIMEOUT_FAST_MS),

  use: (id: string, hookTimeoutMs: number) =>
    runDch<SwitchResult>(["use", id], 2 * hookTimeoutMs + 5_000),

  current: () => runDch<Record<ToolKind, { id: string | null; symlinkTarget: string | null }>>(["current"], TIMEOUT_FAST_MS),

  init: (tool: ToolKind) =>
    runDch<{ ok: true; state: string; profileId: string; configDir: string }>(["init", tool], TIMEOUT_INIT_MS),

  testHook: (id: string, which: "pre" | "post", hookTimeoutMs: number) =>
    runDch<HookResult | null>(["hook", "test", id, which], hookTimeoutMs + 5_000),

  config: (key: "hookTimeoutMs", value: number) =>
    runDch<{ ok: true }>(["config", key, String(value)], TIMEOUT_FAST_MS),
};
