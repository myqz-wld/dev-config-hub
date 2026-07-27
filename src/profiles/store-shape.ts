import type {
  BackupPolicyStore,
  Profile,
  ProfileStore,
} from "./types.ts";

const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
const MIN_HOOK_TIMEOUT_MS = 1_000;
const MAX_HOOK_TIMEOUT_MS = 600_000;

export const EMPTY_STORE: ProfileStore = {
  version: 2,
  profiles: [],
  active: { claude: null, codex: null, grok: null, cursor: null },
  backup: { toolPolicies: {} },
};

interface LegacyStoreInput {
  version?: unknown;
  profiles?: unknown;
  active?: unknown;
  backup?: unknown;
}

function normalizeHookTimeout(value: unknown): number {
  return Number.isInteger(value) &&
      (value as number) >= MIN_HOOK_TIMEOUT_MS &&
      (value as number) <= MAX_HOOK_TIMEOUT_MS
    ? value as number
    : DEFAULT_HOOK_TIMEOUT_MS;
}

function normalizeProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const profile = entry as Profile;
    return {
      ...profile,
      hookTimeoutMs: normalizeHookTimeout(profile?.hookTimeoutMs),
    };
  });
}

function normalizeBackup(value: unknown): BackupPolicyStore {
  const backup = value && typeof value === "object"
    ? value as Partial<BackupPolicyStore>
    : {};
  const toolPolicies = backup.toolPolicies && typeof backup.toolPolicies === "object"
    ? backup.toolPolicies
    : {};
  return {
    toolPolicies,
    ...(typeof backup.scriptsEnabled === "boolean"
      ? { scriptsEnabled: backup.scriptsEnabled }
      : {}),
    ...(backup.scriptsPolicy ? { scriptsPolicy: backup.scriptsPolicy } : {}),
  };
}

// 把任意 raw（含 v1 / 残缺输入）正规化成完整 ProfileStore。前端 / CLI 共用。
// 注意：旧 preferences.hookTimeoutMs 不迁移、不继承；每个方案缺少自身超时时
// 直接回落 30000ms。返回值没有 preferences，因此下次保存会清理旧结构。
//
// 纯函数：零 fs / 零 Bun 依赖 → 前端 bundler 也能 import。
export function applyStoreDefaults(raw: unknown): ProfileStore {
  const data = (raw ?? {}) as LegacyStoreInput;
  const active = data.active && typeof data.active === "object"
    ? data.active as ProfileStore["active"]
    : {};
  return {
    version: 2,
    profiles: normalizeProfiles(data.profiles),
    active: { claude: null, codex: null, grok: null, cursor: null, ...active },
    backup: normalizeBackup(data.backup),
  };
}
