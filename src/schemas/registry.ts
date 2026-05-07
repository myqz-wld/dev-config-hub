import type { ScopeKind, ToolSchema } from "./types.ts";
import { CLAUDE_SETTINGS } from "./claude-settings.ts";
import { CLAUDE_MCP } from "./claude-mcp.ts";
import { CODEX_CONFIG } from "./codex-config.ts";
import { OPENCODE_CONFIG } from "./opencode-config.ts";
import { DCH_STORE } from "./dch-store.ts";
import { mergeSchemas } from "./custom-loader.ts";

export type { ScopeKind } from "./types.ts";

/**
 * ScopeKind → ToolSchema 注册表。
 *
 * PR-A 起 claude-settings；PR-E 加 claude-mcp / codex-config / opencode-config；
 * PR-I 加 dch-store（profile 系统状态文件）。
 * 其余 ScopeKind 在后续 PR 渐进补：
 *   - claude-settings-local → 复用 claude-settings（PR-D 已可用，本注册表暂无独立项）
 *   - claude-md → PR-H 已渲染（schema 仅占位，本注册表暂无独立项）
 *   - shell-rc → PR-J（type=code 占位）
 *
 * **PR-CSv1（custom schema）**：BUILTIN_REGISTRY 不变；运行时 effectiveRegistry 是 builtin
 * + 用户 ~/.dch/schemas/ 合并后的版本。getSchemaForScope 读 effective。CLI / 测试默认拿
 * builtin（不调 applyCustomSchemas）。
 */
const BUILTIN_REGISTRY: Partial<Record<ScopeKind, ToolSchema>> = {
  "claude-settings": CLAUDE_SETTINGS,
  "claude-mcp": CLAUDE_MCP,
  "codex-config": CODEX_CONFIG,
  "opencode-config": OPENCODE_CONFIG,
  "dch-store": DCH_STORE,
};

/**
 * 当前生效的 registry：app 启动时调 applyCustomSchemas 后会被替换。
 * UI 调 getSchemaForScope 总是拿这个；CLI / sync.ts 不调 applyCustomSchemas，相当于拿 builtin。
 */
let effectiveRegistry: Partial<Record<ScopeKind, ToolSchema>> = { ...BUILTIN_REGISTRY };

/**
 * 加载并应用用户自定义 schema override（PR-CSv1）。
 *
 * 由 App.tsx 在 startup 时调用一次。失败 / 文件不存在 → effectiveRegistry 保持 builtin。
 * 多次调用会**重新合并**（覆盖之前的 effective）。
 *
 * 返回 `{ applied, skipped }` 让 caller 决定是否给 UI toast 提示。
 */
export async function applyCustomSchemas(home: string): Promise<{
  applied: ScopeKind[];
  skipped: ScopeKind[];
}> {
  const { loadCustomSchemas } = await import("./custom-loader.ts");
  const overrides = await loadCustomSchemas(home);

  const next: Partial<Record<ScopeKind, ToolSchema>> = { ...BUILTIN_REGISTRY };
  const applied: ScopeKind[] = [];
  const skipped: ScopeKind[] = [];

  for (const [scope, override] of overrides.entries()) {
    const builtin = BUILTIN_REGISTRY[scope];
    if (!builtin) {
      // 已知 ScopeKind 但内置 registry 没注册（如 claude-md / shell-rc 等仅占位）
      skipped.push(scope);
      continue;
    }
    next[scope] = mergeSchemas(builtin, override);
    applied.push(scope);
  }

  effectiveRegistry = next;
  return { applied, skipped };
}

/** 仅测试 / 复位用：把 effectiveRegistry 重置回 builtin。 */
export function resetCustomSchemas(): void {
  effectiveRegistry = { ...BUILTIN_REGISTRY };
}

/**
 * 把绝对文件路径分流到 ScopeKind。
 *
 * home 由 caller 传入（Tauri 用 get_home_dir，CLI 用 utils.HOME），
 * 避免本模块依赖运行时上下文。
 *
 * 严格使用全等路径匹配，**不**做前缀模糊匹配——
 * 否则 `.claude/settings.local.json` 容易被 `.claude/settings.json` 误吃。
 *
 * **路径必须在 home 下**（含 home 自身），否则返 null：
 * detectScope 的语义是「这个文件路径在我的 home 配置体系中属于哪个 scope」，
 * 不是「这个 basename 看起来像哪种配置」。home 外路径（`/tmp/.zshrc` /
 * 另一用户 `/Users/other/.zshrc`）返 null（REVIEW_3 R_1·C5）。
 */
export function detectScope(absPath: string, home: string): ScopeKind | null {
  const rel = stripHome(absPath, home);
  if (rel === null) return null;

  // 显式枚举，settings.local.json 在前
  if (rel === ".claude/settings.local.json") return "claude-settings-local";
  if (rel === ".claude/settings.json") return "claude-settings";
  if (rel === ".claude/.mcp.json") return "claude-mcp";
  if (rel === ".claude/CLAUDE.md") return "claude-md";
  if (rel === ".codex/config.toml") return "codex-config";
  if (rel === ".config/opencode/opencode.json") return "opencode-config";
  if (rel === ".dch/profiles.json") return "dch-store";

  // shell rc 类（POSIX 系）：basename 命中即可（仍要求 home 内）
  const base = baseName(rel);
  if (base === ".zshrc" || base === ".zprofile" || base === ".bashrc") return "shell-rc";

  return null;
}

export function getSchemaForScope(scope: ScopeKind): ToolSchema | null {
  return effectiveRegistry[scope] ?? null;
}

/** 仅 sync.ts / 调试用：列出当前已注册的 schemas（不含 null）。 */
export function listRegisteredSchemas(): ToolSchema[] {
  return Object.values(effectiveRegistry).filter((s): s is ToolSchema => Boolean(s));
}

/**
 * 把绝对路径剥成 home 相对路径；home 外返 null。
 *
 * 跨平台 normalize：Win 后端可能传反斜杠路径，统一为正斜杠（C13），
 * 否则 detectScope 顶部所有显式 `=== ".claude/settings.json"` 比对会 miss。
 *
 * **必须严格 home + "/" 边界比对**（C5），不能用裸 startsWith(home)：
 *   home="/Users/test" + absPath="/Users/test_other/.zshrc"
 *     → 裸 startsWith 命中 → rel="_other/.zshrc" → baseName=".zshrc" → 误归 shell-rc
 *   home="/foo" + absPath="/foo.claude/settings.json"
 *     → 裸 startsWith 命中 → rel=".claude/settings.json" → 误归 claude-settings
 *
 * 严格边界后，相邻前缀不再误吃；非 home 内路径返 null（让 detectScope 直接 null）。
 */
function stripHome(absPath: string, home: string): string | null {
  if (!home) return null;
  const normPath = absPath.replace(/\\/g, "/");
  const normHome = home.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normPath === normHome) return "";
  const homeBoundary = normHome + "/";
  if (!normPath.startsWith(homeBoundary)) return null;
  return normPath.slice(homeBoundary.length);
}

function baseName(rel: string): string {
  // R_2 R2·#1：之前 `Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"))` 的 `\\` 分支
  // 在 stripHome 已 normalize `\` → `/` 之后是死代码。简化为单 / 查找
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(i + 1) : rel;
}
