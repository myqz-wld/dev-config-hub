import type { ProfileStore, Preferences } from "./types.ts";

const DEFAULT_PREFERENCES: Preferences = {
  hookTimeoutMs: 30_000,
};

export const EMPTY_STORE: ProfileStore = {
  version: 1,
  profiles: [],
  active: { claude: null, codex: null },
  preferences: DEFAULT_PREFERENCES,
};

// 把任意 raw（含残缺）输入合并成完整 ProfileStore。前端 / CLI 共用，
// 避免两份 default 补全分叉（preferences 加新字段时 CLI 改了前端忘改 →
// UI undefined / CLI 落盘正常 难定位）。
//
// 纯函数：零 fs / 零 Bun 依赖 → 前端 bundler 也能 import。
export function applyStoreDefaults(raw: unknown): ProfileStore {
  const data = (raw ?? {}) as Partial<ProfileStore>;
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
