import type {
  BackupPolicyStore,
  BackupPolicyV1,
  BackupRuleSource,
  Profile,
  ProfileStore,
  ToolKind,
} from "./types.ts";
import {
  factoryBackupPolicy,
  factoryScriptsBackupPolicy,
} from "./backup-policy-defaults.ts";
import {
  cloneBackupPolicy,
  validateBackupPolicy,
} from "./backup-policy-validation.ts";

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
export const MIN_HOOK_TIMEOUT_MS = 1_000;
export const MAX_HOOK_TIMEOUT_MS = 600_000;

export function normalizeHookTimeout(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= MIN_HOOK_TIMEOUT_MS &&
      (value as number) <= MAX_HOOK_TIMEOUT_MS
    ? value as number
    : DEFAULT_HOOK_TIMEOUT_MS;
}

export function profileHookTimeout(profile: Profile): number {
  return normalizeHookTimeout(profile.hookTimeoutMs);
}

export function emptyBackupPolicyStore(raw?: Partial<BackupPolicyStore>): BackupPolicyStore {
  return {
    toolPolicies: raw?.toolPolicies ?? {},
    ...(raw?.scriptsEnabled === undefined ? {} : { scriptsEnabled: raw.scriptsEnabled }),
    ...(raw?.scriptsPolicy === undefined ? {} : { scriptsPolicy: raw.scriptsPolicy }),
  };
}

export interface ResolvedBackupPolicy {
  policy: BackupPolicyV1;
  source: BackupRuleSource;
}

export function resolveToolBackupPolicy(
  store: Pick<ProfileStore, "backup">,
  tool: ToolKind,
): ResolvedBackupPolicy {
  const saved = store.backup.toolPolicies[tool];
  if (saved) return { policy: cloneBackupPolicy(saved), source: "tool" };
  return { policy: factoryBackupPolicy(tool), source: "factory" };
}

export function resolveProfileBackupPolicy(
  store: Pick<ProfileStore, "backup">,
  profile: Profile,
): ResolvedBackupPolicy {
  if (profile.backupPolicy) {
    return { policy: cloneBackupPolicy(profile.backupPolicy), source: "profile-snapshot" };
  }
  return resolveToolBackupPolicy(store, profile.tool);
}

export function resolveScriptsBackupPolicy(
  store: Pick<ProfileStore, "backup">,
): ResolvedBackupPolicy {
  if (store.backup.scriptsPolicy) {
    return { policy: cloneBackupPolicy(store.backup.scriptsPolicy), source: "scripts" };
  }
  return { policy: factoryScriptsBackupPolicy(), source: "factory" };
}

export function scriptsBackupEnabled(store: Pick<ProfileStore, "backup">): boolean {
  return store.backup.scriptsEnabled !== false;
}

export function snapshotProfileBackupPolicy(
  store: Pick<ProfileStore, "backup">,
  profile: Profile,
): BackupPolicyV1 {
  return resolveProfileBackupPolicy(store, profile).policy;
}

export function validateStoreBackupPolicies(store: Pick<ProfileStore, "backup" | "profiles">): void {
  for (const [tool, policy] of Object.entries(store.backup.toolPolicies)) {
    try {
      validateBackupPolicy(policy);
    } catch (error) {
      throw new Error(`${tool} 备份规则无效: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (store.backup.scriptsPolicy) {
    try {
      validateBackupPolicy(store.backup.scriptsPolicy);
    } catch (error) {
      throw new Error(`切换脚本备份规则无效: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const profile of store.profiles) {
    if (!profile.backupPolicy) continue;
    try {
      validateBackupPolicy(profile.backupPolicy);
    } catch (error) {
      throw new Error(`方案 ${profile.id} 的备份规则无效: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
