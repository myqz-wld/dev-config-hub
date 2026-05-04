import { join, relative, sep, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { HOME } from "../platform.ts";
import type { ProfileStore, Preferences } from "./types.ts";

export { HOME };
export const DCH_DIR = join(HOME, ".dch");
export const STORE_PATH = join(DCH_DIR, "profiles.json");

const DEFAULT_PREFERENCES: Preferences = {
  hookTimeoutMs: 30_000,
};

const EMPTY_STORE: ProfileStore = {
  version: 1,
  profiles: [],
  active: { claude: null, codex: null },
  preferences: DEFAULT_PREFERENCES,
};

export function expandHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  return p;
}

/**
 * 把绝对路径折叠成 `~/...` 形式（相对 HOME）。
 *
 * 跨平台细节：
 * - 用 `path.relative(HOME, p)` 而不是字符串前缀比对，自动处理 Win 反斜杠 + POSIX 正斜杠
 * - 显示形式统一用 `/`（Win 也用正斜杠展示，与配置文件 ~ 路径风格一致；不影响 fs 读写）
 * - 路径不在 HOME 下（relative 出 `..`）→ 原样返回绝对路径
 */
export function collapseHome(p: string): string {
  if (p === HOME) return "~";
  const rel = relative(HOME, p);
  if (rel === "" || rel.startsWith("..") || (sep === "\\" && /^[A-Za-z]:/.test(rel))) {
    return p;
  }
  return "~/" + rel.split(sep).join("/");
}

// loadStore / saveStore 接受可选 path 参数让单测能注入 tmpdir，不污染 ~/.dch/profiles.json。
// 生产 caller（manager.ts 全 7 处写操作）走默认 STORE_PATH 不受影响。
export async function loadStore(path: string = STORE_PATH): Promise<ProfileStore> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return structuredClone(EMPTY_STORE);
  }
  let data: ProfileStore;
  try {
    data = (await file.json()) as ProfileStore;
  } catch (e) {
    throw new Error(`无法解析 ${path}: ${e}`);
  }
  const rawPrefs = (data.preferences ?? {}) as Partial<Preferences>;
  return {
    version: 1,
    profiles: data.profiles ?? [],
    active: { claude: null, codex: null, ...(data.active ?? {}) },
    preferences: {
      hookTimeoutMs: rawPrefs.hookTimeoutMs ?? DEFAULT_PREFERENCES.hookTimeoutMs,
    },
  };
}

export async function saveStore(store: ProfileStore, path: string = STORE_PATH): Promise<void> {
  const dir = path === STORE_PATH ? DCH_DIR : dirname(path);
  await mkdir(dir, { recursive: true });
  await Bun.write(path, JSON.stringify(store, null, 2) + "\n");
}
