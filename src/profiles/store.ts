import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";
import type { ProfileStore, Preferences } from "./types.ts";

export const HOME = homedir();
export const DCH_DIR = join(HOME, ".dch");
export const STORE_PATH = join(DCH_DIR, "profiles.json");

const DEFAULT_PREFERENCES: Preferences = {
  terminal: "Terminal",
  defaultMode: "env",
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

export function collapseHome(p: string): string {
  if (p === HOME) return "~";
  if (p.startsWith(HOME + "/")) return "~" + p.slice(HOME.length);
  return p;
}

export async function loadStore(): Promise<ProfileStore> {
  const file = Bun.file(STORE_PATH);
  if (!(await file.exists())) {
    return structuredClone(EMPTY_STORE);
  }
  let data: ProfileStore;
  try {
    data = (await file.json()) as ProfileStore;
  } catch (e) {
    throw new Error(`无法解析 ${STORE_PATH}: ${e}`);
  }
  return {
    version: 1,
    profiles: data.profiles ?? [],
    active: { claude: null, codex: null, ...(data.active ?? {}) },
    preferences: { ...DEFAULT_PREFERENCES, ...(data.preferences ?? {}) },
  };
}

export async function saveStore(store: ProfileStore): Promise<void> {
  await mkdir(DCH_DIR, { recursive: true });
  await Bun.write(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}
