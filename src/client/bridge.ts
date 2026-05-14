import { invoke } from "@tauri-apps/api/core";
import type { ToolConfig, ConfigScope } from "../types.ts";
import { applyStoreDefaults, EMPTY_STORE } from "../profiles/store-shape.ts";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
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

/**
 * 读 symlink target，单层不 deref（与 CLI src/profiles/symlink.ts:150 currentSymlinkTarget 行为对齐）。
 * - 非 symlink / 不存在 / IO 错 → null
 * - HOME 外路径 → Err（Rust 端拒，应是 caller bug）这里仍 catch 回 null 让 caller 路径平
 */
export async function readLink(path: string): Promise<string | null> {
  try {
    return await call<string | null>("read_link", { path });
  } catch (e) {
    console.warn(`readLink failed: ${path}:`, e);
    return null;
  }
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
  const r = await readFileWithMtime(`${dirAbs}/${filename}`);
  return r.exists ? r.content : "";
}

// 把内容写到 profile configDir 下的某个文件。父目录不存在时由 Rust 端 mkdir -p。
export async function writeProfileConfigFile(configDir: string, filename: string, content: string): Promise<void> {
  const home = await getHomeDir();
  const dirAbs = expandHomePath(configDir, home);
  await saveFile(`${dirAbs}/${filename}`, content);
}

/**
 * **REVIEW_9 C-HIGH-1 / C-codex H1**: tool 字段映射 Rust 端 ToolKind enum
 * (commands/version.rs)。serde rename_all = camelCase 让 OpenCode → "openCode";
 * 其他 lowercase。前端直接传 enum value 而非任意 string,关闭 IPC 直传 shell -c 的注入面。
 */
type ToolKind = "zsh" | "claude" | "codex" | "openCode";

async function version(tool: ToolKind): Promise<string> {
  return call<string>("get_tool_version", { tool });
}

async function readScope(
  path: string, level: ConfigScope["level"], label: string, format: ConfigScope["format"],
): Promise<ConfigScope> {
  // REVIEW_8 H7 / E2：灌入 mtimeUs 给 ConfigPanel edit 模式做 TOCTOU CAS。
  // 单次 IPC 同步拿 exists + content + mtime（消除 file_exists/read_file 双 IPC race）。
  const { exists, content, mtimeUs } = await readFileWithMtime(path);
  return { level, label, filePath: path, exists, format, content, loadedMtimeUs: mtimeUs };
}

export interface ToolVersions {
  shell: string;
  claude: string;
  codex: string;
  opencode: string;
}

/**
 * 拉 4 个工具的版本号 (zsh / claude / codex / opencode)。
 *
 * **慢路径**：每个 version() spawn 一次登录式 zsh + source rc → tool --version，单个 200-500ms。
 * 仅首屏跑一次，结果缓存到 App.tsx versionsRef；切回窗口（focus reload）跳过这步省 4 zsh spawn
 * （CHANGELOG_15）。需要刷新版本只能重启 app。
 */
export async function loadAllVersions(): Promise<ToolVersions> {
  const [shell, claude, codex, opencode] = await Promise.all([
    version("zsh"),
    version("claude"),
    version("codex"),
    version("openCode"),
  ]);
  return { shell, claude, codex, opencode };
}

/**
 * 拉所有 scope 文件内容；接收预算好的 home + versions（避免 focus reload 重新 spawn shell）。
 *
 * **快路径**：8 个 readFileWithMtime 并发，每个纯 Rust fs metadata + read，几 ms 总计。
 * 切回窗口走这一条 → 0 spawn 开销。
 */
export async function loadAllFiles(home: string, versions: ToolVersions): Promise<ToolConfig[]> {
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
    { name: "Shell (Zsh)", version: versions.shell, icon: "terminal", description: "Zsh shell 环境配置", scopes: shellScopes },
    { name: "Claude Code", version: versions.claude, icon: "claude", description: "Anthropic AI 编码助手", scopes: claudeScopes },
    { name: "Codex CLI", version: versions.codex, icon: "codex", description: "OpenAI AI 编码助手", scopes: [codexScope] },
    { name: "OpenCode", version: versions.opencode, icon: "opencode", description: "开源 AI 编码助手", scopes: [ocScope] },
  ];
}

/**
 * 完整加载（versions + files）。仅首屏 / 测试 mock 用；focus reload 走 loadAllFiles 单独。
 */
export async function loadAllConfigs(): Promise<ToolConfig[]> {
  const home = await call<string>("get_home_dir");
  const versions = await loadAllVersions();
  return loadAllFiles(home, versions);
}

export async function saveFile(filePath: string, content: string): Promise<void> {
  await call("save_file", { path: filePath, content });
}

/**
 * REVIEW_8 H7 (Group E1) / R3 G5：原子写 + mtime CAS（compare-and-swap）。
 *
 * 后端 Tauri command `save_file_if_mtime` 在写盘前 stat 比对 expectedMtimeUs：
 * - `expectedMtimeUs = number` → 不一致直接 reject（原子，避免 silent overwrite）
 * - `expectedMtimeUs = null` → 跳过 CAS（首次创建 / caller 显式不 care）
 *
 * 错误前缀（atomic.rs:write_atomic_check_mtime）：
 * - `MTIME_MISMATCH:<expected>:<actual>` → throw `MtimeMismatchError`（含 expected/actual）
 * - `MTIME_MISSING:<expected>`           → throw `MtimeMissingError`（caller 期望存在但已删）
 * - 其他 IO / boundary 失败 → 原始 Error 透传
 *
 * **返回新 mtime（us）** 让 caller 更新 loadedMtimeUs，避免再发 readFileWithMtime
 * 拿一次 IPC 才能继续 edit。
 *
 * R3 G5 拆分：mtime CAS 错误类型 + classifier 抽到 `bridge-mtime.ts`（self-contained pure
 * 类型 + 字符串解析），bridge.ts 落回 ≤500 LOC 护栏。re-export 让既有 caller
 * `import { MtimeMismatchError } from "./bridge.ts"` 仍可用，无 break change。
 */
export {
  MtimeMismatchError, MtimeMissingError,
  isMtimeMismatch, isMtimeMissing,
  classifySaveError,
} from "./bridge-mtime.ts";

import { classifySaveError } from "./bridge-mtime.ts";

export async function saveFileIfMtime(
  filePath: string,
  content: string,
  expectedMtimeUs: number | null,
): Promise<number> {
  try {
    return await call<number>("save_file_if_mtime", {
      path: filePath,
      content,
      // Tauri 2 自动 camelCase ↔ snake_case 转换，匹配 Rust 端 expected_mtime_us: Option<u64>
      expectedMtimeUs,
    });
  } catch (e) {
    throw classifySaveError(e);
  }
}

// ── Profile bridge: 通过 Tauri 调 dch CLI（--json 模式），结果统一 JSON ─────
//
// REVIEW_9 D-codex LOW 1 / G6: DchCommandResult / runDch / TIMEOUT_* 抽到 bridge-core.ts,
// bridge.ts ↔ bridge-backup.ts 单向依赖 bridge-core,消除旧实现两个 facade 互相 import 的
// 反向耦合。caller 仍 `import { ... } from "./bridge.ts"` 不变 — 通过下面 re-export 透传。
export {
  type DchCommandResult,
  runDch,
  TIMEOUT_FAST_MS,
  TIMEOUT_INIT_MS,
  TIMEOUT_BACKUP_MS,
} from "./bridge-core.ts";

import type {
  Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "../profiles/types.ts";

// 类型 surface 透传：caller 仍只 import "../bridge.ts" 拿到 backup / restore 全套类型。
// dchBackup 方法对象 spread 到下面的 dchProfile，让 caller 调 dchProfile.backup(...) 不变。
export * from "./bridge-backup.ts";
import { dchBackup } from "./bridge-backup.ts";

// 给本模块内 dchProfileMethods 用的 runDch / TIMEOUT_* 引用 (private import,与 above 公开 re-export 等价)
import { runDch, TIMEOUT_FAST_MS, TIMEOUT_INIT_MS } from "./bridge-core.ts";

export type { Profile, ProfileStore, SwitchResult, ToolKind, HookResult };

const dchProfileMethods = {
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

// dchProfile：profile 管理（add/remove/use/...） + backup 子组（spread 自 dchBackup）
// 拆出 dchBackup 让 bridge.ts 顶在 500 行护栏下；caller 只看到一个 dchProfile 入口。
export const dchProfile = {
  ...dchProfileMethods,
  ...dchBackup,
};

// ── Profile 直读 fs 路径（替代 dchProfile.{list,current} 双 bun spawn） ───────
//
// CHANGELOG_15：focus reload 时切回窗口卡顿根因之一是 list / current 各 spawn 一次
// `bun src/cli.ts profile <cmd>` cold start ~500ms × 2。CLI 端这俩命令本质就是
// 「读 ~/.dch/profiles.json + 4 次 readlink ~/.{tool}」，前端直读 fs 等价且零 spawn。
//
// 写操作（add/remove/use/init/config/testHook）仍走 dch CLI —— 涉及 store lock + hook
// 不能复刻；这里只 bypass 纯读路径。

export type ProfileActive = Record<ToolKind, { id: string | null; symlinkTarget: string | null }>;

const TOOL_KINDS: ToolKind[] = ["claude", "codex"];

/**
 * 纯函数：把 raw 输入（store JSON 串 / 各 link target）拼成 { store, active }。
 *
 * 抽出来给单测直接调（不 mock invoke），避免 bun test mock.module 跨 file 污染
 * （App.test.tsx / ConfigPanel.test.tsx mock `./bridge.ts` 让其他 file import 拿到 stub）。
 *
 * @param storeContent  null = profiles.json 不存在 → EMPTY_STORE；string = JSON.parse + applyStoreDefaults（坏 JSON throw）
 * @param links         按 TOOL_KINDS 顺序传 link target；非 symlink → null
 */
export function buildProfileData(
  storeContent: string | null,
  links: Record<ToolKind, string | null>,
): { store: ProfileStore; active: ProfileActive } {
  let store: ProfileStore;
  if (storeContent === null) {
    store = structuredClone(EMPTY_STORE);
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(storeContent);
    } catch (e) {
      throw new Error(`无法解析 profiles.json: ${e instanceof Error ? e.message : String(e)}`);
    }
    store = applyStoreDefaults(raw);
  }

  const active = {} as ProfileActive;
  for (const tool of TOOL_KINDS) {
    active[tool] = {
      id: store.active[tool] ?? null,
      symlinkTarget: links[tool] ?? null,
    };
  }
  return { store, active };
}

/**
 * 直读 fs 拿 profile store + active state；与 dchProfile.list() + current() 的输出 shape 等价。
 *
 * - profiles.json 不存在：返 EMPTY_STORE shape（同 CLI loadStore 行为）
 * - 坏 JSON：throw Error，让 caller silent catch（loadProfileData(silent=true) 的语义）
 * - active.symlinkTarget：用 readLink 拿（非 symlink / 失败 → null，与 CLI currentSymlinkTarget 一致）
 *
 * Default 补全走 store-shape.applyStoreDefaults，与 CLI loadStore 同源（防分叉）。
 */
export async function loadProfileDataDirect(): Promise<{
  store: ProfileStore;
  active: ProfileActive;
}> {
  const home = await getHomeDir();
  const storePath = `${home}/.dch/profiles.json`;
  const r = await readFileWithMtime(storePath);
  // 并发拿 link target；readLink 内部已 catch，所有失败回 null
  const targets = await Promise.all(TOOL_KINDS.map((t) => readLink(`${home}/.${t}`)));

  const links = {} as Record<ToolKind, string | null>;
  for (let i = 0; i < TOOL_KINDS.length; i++) {
    links[TOOL_KINDS[i]!] = targets[i] ?? null;
  }

  return buildProfileData(r.exists ? r.content : null, links);
}
