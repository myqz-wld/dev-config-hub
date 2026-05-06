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
  // PR-4/PR-6 (#M12)：file_exists + read_file 双 IPC 之间有 async gap；
  // 另一进程 / profile 切换可能在此期间删除该文件 → read_file Err。
  // 旧版无 catch → 异常上抛 loadAllConfigs reject → App 「加载失败」整个 UI 挂。
  // 改：失败时降级为「文件不存在」语义，让 UI 优雅退化。
  // **PR-B 后**：PR-D 集成时切换到下面的 readFileWithMtime（单次 IPC + mtime 回报），
  // 顺带消除 file_exists/read_file 双 IPC race；本函数保留为兼容入口。
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
 * **字段契约必须与 `src-tauri/src/lib.rs` 的 `ReadFileWithMtimeResult` Rust struct 同步**
 * （REVIEW_3 R_1·C12）：Rust 端用 `#[serde(rename_all = "camelCase")]` 把 `mtime_us`
 * 序列化成 `mtimeUs`。改 Rust 端字段名时务必同步改这里，否则前端 `r.mtimeUs` 静默
 * undefined → PR-D loadedMtime 比对永远不命中 → 误报「文件已外部变更」。
 */
export interface ReadFileWithMtimeResult {
  exists: boolean;
  content: string;
  /**
   * Unix epoch microseconds；不存在 / 拿不到 mtime 时 null。
   *
   * 用 us 精度而非 ms（REVIEW_3 R_1·C7）：APFS 连续两次 fs::write 实测间隔
   * ~335 µs（< 1 ms）→ ms 精度看不出差异 → TOCTOU 漏判。us 精度 + JS Number
   * 2^53 上限到公元 ~285616 年，安全。
   *
   * **三态语义**（REVIEW_3 R_1·C17 + R_2 D2 补全）：
   *   - `null` 三种合并来源（PR-D consumer 一律跳过 TOCTOU，是 fail-safe）：
   *     1. 文件不存在 / 不是 regular file
   *     2. metadata.modified() 失败（罕见 FS 不支持 mtime）
   *     3. mtime 早于 UNIX_EPOCH（pre-1970 文件，APFS u64 ns 时间戳实质不可达，但
   *        rsync --times / git checkout 老仓库 / `touch -t 196812310000` 可造）
   *     上述三种 lib.rs 端各自 eprintln 留痕，可从 Console.app 区分（前端不区分）
   *   - `number`：正常 mtime
   *   PR-D consumer 禁止用 `if (!r.mtimeUs)`（false 分支会覆盖 0 / null 双语义），
   *   必须用 `if (r.mtimeUs == null)` 显式判 null。
   */
  mtimeUs: number | null;
}

/**
 * 单次 IPC 拿 exists + content + mtime。
 *
 * 相比 readFile（file_exists + read_file 双 IPC），原子读取消除中间 race，
 * 且回报 mtime 给 PR-D 之后的 schema-aware 写回路径做 TOCTOU 比对。
 *
 * Rust 端 `read_file_with_mtime` 内部已 graceful degrade（不存在 / 不是 regular file /
 * 中途读失败 → exists=false），不会抛 IPC 异常。
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
// 用于 dir 撞车校验。只展开 home + 折叠 `//` + 去尾 `/`，不解析 `..`（用户极少写）。
export function normalizeProfileDir(p: string, home: string): string {
  if (!p) return "";
  let abs = expandHomePath(p, home);
  abs = abs.replace(/\/+/g, "/").replace(/\/+$/, "");
  return abs || "/";
}

export async function getHomeDir(): Promise<string> {
  return call<string>("get_home_dir");
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
    // PR-4 (#M1)：用 || 而非 ??。stderr.trim() 永远是 string（可能空串），?? 永远不命中
    // 第三段 fallback；CLI fail 走 JSON_MODE err() 时 stderr 完全空 → UI toast 显示空字符串
    throw new Error(parsed.error || r.stderr.trim() || `exit ${r.code}`);
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
