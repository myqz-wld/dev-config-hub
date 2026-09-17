import { PROFILE_TOOL_IDS, type Profile, type ProfileStore } from "./types.ts";
import { normalizeHookTimeout } from "./hook-timeout.ts";

export const EMPTY_STORE: ProfileStore = {
  version: 2,
  profiles: [],
  active: { claude: null, codex: null, grok: null, cursor: null },
};

function normalizeProfile(entry: unknown): Profile {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("配置方案必须是 JSON 对象");
  }
  const profile = entry as Profile;
  // Persist only the current public shape, including both supported hook forms.
  return {
    id: profile.id,
    tool: profile.tool,
    configDir: profile.configDir,
    ...(profile.env === undefined ? {} : { env: profile.env }),
    ...(profile.description === undefined ? {} : { description: profile.description }),
    ...(profile.hooks === undefined ? {} : { hooks: profile.hooks }),
    ...(profile.isDefault === undefined ? {} : { isDefault: profile.isDefault }),
    hookTimeoutMs: normalizeHookTimeout(profile.hookTimeoutMs),
  };
}

/** Shared by CLI and frontend; unsupported store versions never auto-convert. */
export function applyStoreDefaults(raw: unknown): ProfileStore {
  const data = raw as Partial<ProfileStore> | null;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 2) {
    throw new Error("不支持的配置方案版本：仅支持 version: 2");
  }
  if (data.profiles !== undefined && !Array.isArray(data.profiles)) {
    throw new Error("配置方案 profiles 必须是数组");
  }
  const active = { ...EMPTY_STORE.active };
  for (const tool of PROFILE_TOOL_IDS) active[tool] = data.active?.[tool] ?? null;
  return {
    version: 2,
    profiles: (data.profiles ?? []).map(normalizeProfile),
    active,
  };
}
