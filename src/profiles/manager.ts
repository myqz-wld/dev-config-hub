import type {
  BackupPolicyV1, Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "./types.ts";
import { PROFILE_TOOL_IDS } from "./types.ts";
import {
  loadStore, saveStore, withStoreLock, STORE_LOCK_PATH, expandHome,
} from "./store.ts";
import { runHook, type HookContext } from "./hooks.ts";
import { switchSymlink, initToolDir, currentSymlinkTarget } from "./symlink.ts";
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  normalizeHookTimeout,
  profileHookTimeout,
  snapshotProfileBackupPolicy,
} from "./backup-policy.ts";
import { validateBackupPolicy } from "./backup-policy-validation.ts";
import { isAbsolute, resolve } from "node:path";
import { lstat, mkdir, rmdir } from "node:fs/promises";

// REVIEW_8 Round 2 R2-3 / Round 3 G1：export 给 backup-restore.ts 等 caller 早期校验
// 恶意 manifest 携带的 `mp.id`，避免 `join(RESTORED_BASE, "../.ssh")` 逃逸 RESTORED_BASE
// 子树。原本只在 addProfile 内部校验，但 backup-restore.ts 是先 join → mkdir → copyDirRecursive
// → addProfile，path traversal 在 addProfile 调用之前已经发生。
export const ID_RE = /^[a-zA-Z0-9_-]+$/;
// PR-6 (#M5)：profile.env key 校验 — 与 cli-profile.cmdEnv 输出 wrapper 用的同一 regex。
// 旧版只在输出处 skip 非法 key（用户在 UI/CLI 加 `MY KEY=v` / `1FOO=v` 落盘成功
// 但 wrapper 模式 silently 丢，难调试）。这里上游守口拦掉，统一行为。
// export 给单测用。
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateTool(tool: unknown): asserts tool is ToolKind {
  if (!PROFILE_TOOL_IDS.includes(tool as ToolKind)) {
    throw new Error(`非法 tool: ${JSON.stringify(tool)}（允许: ${PROFILE_TOOL_IDS.join(", ")}）`);
  }
}

/**
 * REVIEW_8 H3 / Group C：所有 manager 写操作统一走本 helper，自动按 hookTimeoutMs 算 staleMs。
 *
 * 旧问题：`withStoreLock` 默认 `staleMs=60_000`。`useProfile` 持锁期间会跑 preSwitch + postSwitch
 * 两个 hook，最坏耗时 `2 × hookTimeoutMs`。配置上限 hookTimeoutMs=600_000ms（10 min）→ useProfile
 * 可持锁 1200s，远 > 60s 默认 staleMs → 任何并发 `dch profile add/remove/use` 看 lockfile 时间戳
 * 都会判定 stale → unlink + 抢占 → 与 useProfile 并发写 store → multi-process lost update（PR-5
 * 修过的同一类问题再回归）。
 *
 * 每次写前取所有方案的最大 profile-local timeout。这样任意 acquirer 看到的 staleMs
 * 都不小于当前 holder 运行两个 hook 的最坏时间，不会误抢长 hook 持有的锁。
 */
async function withProfileLock<T>(fn: () => Promise<T>): Promise<T> {
  const storeForSize = await loadStore();
  const largestTimeout = Math.max(
    DEFAULT_HOOK_TIMEOUT_MS,
    ...storeForSize.profiles.map(profileHookTimeout),
  );
  const staleMs = 2 * largestTimeout + 5_000;
  const maxWaitMs = staleMs;
  return withStoreLock(STORE_LOCK_PATH, fn, { staleMs, maxWaitMs });
}

export function validateEnv(env: Record<string, string> | undefined): void {
  if (!env) return;
  for (const k of Object.keys(env)) {
    if (!ENV_KEY_RE.test(k)) {
      throw new Error(
        `非法 env key: ${JSON.stringify(k)}（必须匹配 /^[A-Za-z_][A-Za-z0-9_]*$/，否则 wrapper 模式 dch profile env 会跳过）`,
      );
    }
  }
}

export async function listProfiles(): Promise<ProfileStore> {
  return loadStore();
}

export async function getProfile(id: string): Promise<Profile> {
  const store = await loadStore();
  const p = store.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`未找到 profile: ${id}`);
  return p;
}

export type ProfileDirectoryMode = "create-empty" | "manage-existing";

function normalizedDirectoryKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" || process.platform === "darwin"
    ? absolute.toLocaleLowerCase("en-US")
    : absolute;
}

async function assertRealDirectory(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`配置目录不存在: ${path}`);
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`配置目录必须是真实目录，不能是符号链接: ${path}`);
  }
  if (!stats.isDirectory()) throw new Error(`配置路径不是目录: ${path}`);
}

function validateConfigDirectoryPath(configDir: string): string {
  const expanded = expandHome(configDir.trim());
  if (!expanded || !isAbsolute(expanded)) {
    throw new Error("配置目录必须是绝对路径或以 ~/ 开头");
  }
  return resolve(expanded);
}

function assertUniqueDirectory(
  profiles: Profile[],
  absoluteDir: string,
  exceptId?: string,
): void {
  const wanted = normalizedDirectoryKey(absoluteDir);
  const duplicate = profiles.find((profile) => (
    profile.id !== exceptId &&
    normalizedDirectoryKey(resolve(expandHome(profile.configDir))) === wanted
  ));
  if (duplicate) {
    throw new Error(`配置目录已由方案 ${duplicate.id} 管理: ${duplicate.configDir}`);
  }
}

export async function addProfile(
  input: Profile,
  directoryMode: ProfileDirectoryMode = "manage-existing",
): Promise<void> {
  const p: Profile = {
    ...input,
    configDir: input.configDir.trim(),
    hookTimeoutMs: normalizeHookTimeout(input.hookTimeoutMs),
  };
  validateTool(p.tool);
  if (!ID_RE.test(p.id)) {
    throw new Error("profile id 只允许字母数字 _ -");
  }
  validateEnv(p.env);
  if (p.backupPolicy) validateBackupPolicy(p.backupPolicy);
  const configDirAbs = validateConfigDirectoryPath(p.configDir);
  await withProfileLock(async () => {
    const store = await loadStore();
    if (store.profiles.some((x) => x.id === p.id)) {
      throw new Error(`profile id 重复: ${p.id}`);
    }
    assertUniqueDirectory(store.profiles, configDirAbs);

    let created = false;
    try {
      if (directoryMode === "create-empty") {
        try {
          await lstat(configDirAbs);
          throw new Error(`配置目录已存在；如需纳入管理，请选择“管理已有目录”: ${configDirAbs}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await mkdir(configDirAbs, { recursive: true });
        created = true;
      } else {
        await assertRealDirectory(configDirAbs);
      }
      store.profiles.push(p);
      await saveStore(store);
    } catch (error) {
      // 只尝试删除本次刚创建且仍为空的目录；rmdir 遇到任何内容都会安全失败。
      if (created) await rmdir(configDirAbs).catch(() => {});
      throw error;
    }
  });
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<void> {
  if (patch.tool !== undefined) validateTool(patch.tool);
  if (patch.env !== undefined) validateEnv(patch.env);
  if (patch.hookTimeoutMs !== undefined) {
    patch = { ...patch, hookTimeoutMs: normalizeHookTimeout(patch.hookTimeoutMs) };
  }
  if (patch.backupPolicy !== undefined) validateBackupPolicy(patch.backupPolicy);
  await withProfileLock(async () => {
    const store = await loadStore();
    const idx = store.profiles.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error(`未找到 profile: ${id}`);
    if (patch.configDir !== undefined) {
      const configDirAbs = validateConfigDirectoryPath(patch.configDir);
      await assertRealDirectory(configDirAbs);
      assertUniqueDirectory(store.profiles, configDirAbs, id);
      patch = { ...patch, configDir: patch.configDir.trim() };
    }
    store.profiles[idx] = { ...store.profiles[idx]!, ...patch, id };
    await saveStore(store);
  });
}

export async function removeProfile(id: string): Promise<void> {
  await withProfileLock(async () => {
    const store = await loadStore();
    store.profiles = store.profiles.filter((x) => x.id !== id);
    for (const k of Object.keys(store.active) as ToolKind[]) {
      if (store.active[k] === id) store.active[k] = null;
    }
    await saveStore(store);
  });
}

export async function useProfile(id: string): Promise<SwitchResult> {
  return withProfileLock(async () => {
    const store = await loadStore();
    const profile = store.profiles.find((x) => x.id === id);
    if (!profile) throw new Error(`未找到 profile: ${id}`);

    const fromId = store.active[profile.tool] ?? null;
    const ctx: HookContext = { profile, fromId, toId: id };
    const hooks: HookResult[] = [];
    const timeoutMs = profileHookTimeout(profile);

    const pre = await runHook(
      "preSwitch", profile.hooks?.preSwitch, ctx, timeoutMs,
    );
    if (pre) {
      hooks.push(pre);
      if (pre.exitCode !== 0) {
        return {
          ok: false, profile, previousActive: fromId, hooks,
          message: `preSwitch hook 失败 (exit ${pre.exitCode}${pre.timedOut ? ", 超时" : ""})，已中断切换`,
        };
      }
    }

    try {
      await switchSymlink(profile);
      store.active[profile.tool] = id;
      await saveStore(store);
    } catch (e) {
      // PR-6 (#M4)：switchSymlink 后 saveStore 失败时尝试回滚 symlink，避免
      // 「symlink 切了但 active 还是旧值」的状态分裂。fromId 为 null（首次切换）
      // 无法回滚 — 只能报错让用户手动处理。回滚自身失败不阻塞 — 已经够乱了，
      // 错误信息里把两次都说清楚。
      let rollbackNote = "";
      if (fromId && fromId !== id) {
        const fromProfile = store.profiles.find((x) => x.id === fromId);
        if (fromProfile) {
          try {
            await switchSymlink(fromProfile);
            rollbackNote = `（symlink 已回滚到 ${fromId}）`;
          } catch (re) {
            rollbackNote = `（回滚 symlink 到 ${fromId} 也失败：${re instanceof Error ? re.message : String(re)}）`;
          }
        }
      }
      return {
        ok: false, profile, previousActive: fromId, hooks,
        message: `切换失败: ${e instanceof Error ? e.message : String(e)}${rollbackNote}`,
      };
    }

    const post = await runHook(
      "postSwitch", profile.hooks?.postSwitch, ctx, timeoutMs,
    );
    if (post) hooks.push(post);

    return { ok: true, profile, previousActive: fromId, hooks };
  });
}

export async function initTool(tool: ToolKind): Promise<{
  state: string;
  profileId: string;
  configDir: string;
}> {
  // initToolDir 改 fs（mv + ln -s）在锁外做，避免持锁期间 fs 操作把锁有效期撑大。
  // 真正写 store 的 load+save 走锁。
  const result = await initToolDir(tool);
  await withProfileLock(async () => {
    const store = await loadStore();
    const idx = store.profiles.findIndex((p) => p.id === result.defaultProfile.id);
    if (idx < 0) {
      store.profiles.push(result.defaultProfile);
    } else {
      // PR-6 (#M9)：profile 已存在时也更新 configDir。否则用户手动改 symlink 后再 init，
      // store.active 指 `claude-default`(configDir=旧) 但 symlink 指新 dir，两者不一致。
      // 保留 description / env / hooks 等用户自定义字段，只同步 configDir + isDefault。
      store.profiles[idx] = {
        ...store.profiles[idx]!,
        configDir: result.defaultProfile.configDir,
        isDefault: true,
      };
    }
    store.active[tool] = result.defaultProfile.id;
    await saveStore(store);
  });
  return {
    state: result.state,
    profileId: result.defaultProfile.id,
    configDir: result.defaultProfile.configDir,
  };
}

export async function getActive(tool: ToolKind): Promise<{
  id: string | null;
  symlinkTarget: string | null;
}> {
  const store = await loadStore();
  return {
    id: store.active[tool] ?? null,
    symlinkTarget: await currentSymlinkTarget(tool),
  };
}

export async function testHook(
  id: string, which: "pre" | "post",
): Promise<HookResult | null> {
  const profile = await getProfile(id);
  const store = await loadStore();
  const hook = which === "pre" ? profile.hooks?.preSwitch : profile.hooks?.postSwitch;
  const ctx: HookContext = {
    profile,
    fromId: store.active[profile.tool] ?? null,
    toId: id,
  };
  return runHook(
    which === "pre" ? "preSwitch" : "postSwitch",
    hook, ctx, profileHookTimeout(profile),
  );
}

export async function setToolBackupPolicy(
  tool: ToolKind,
  policy: BackupPolicyV1 | null,
): Promise<void> {
  validateTool(tool);
  if (policy) validateBackupPolicy(policy);
  await withProfileLock(async () => {
    const store = await loadStore();
    if (policy) store.backup.toolPolicies[tool] = structuredClone(policy);
    else delete store.backup.toolPolicies[tool];
    await saveStore(store);
  });
}

export async function setProfileBackupPolicy(
  id: string,
  policy: BackupPolicyV1 | "snapshot-effective" | null,
): Promise<void> {
  if (policy && policy !== "snapshot-effective") validateBackupPolicy(policy);
  await withProfileLock(async () => {
    const store = await loadStore();
    const idx = store.profiles.findIndex((profile) => profile.id === id);
    if (idx < 0) throw new Error(`未找到 profile: ${id}`);
    const profile = store.profiles[idx]!;
    if (policy === "snapshot-effective") {
      profile.backupPolicy = snapshotProfileBackupPolicy(store, profile);
    } else if (policy) {
      profile.backupPolicy = structuredClone(policy);
    } else {
      delete profile.backupPolicy;
    }
    await saveStore(store);
  });
}

export async function setScriptsBackupPolicy(
  policy: BackupPolicyV1 | null,
): Promise<void> {
  if (policy) validateBackupPolicy(policy);
  await withProfileLock(async () => {
    const store = await loadStore();
    if (policy) store.backup.scriptsPolicy = structuredClone(policy);
    else delete store.backup.scriptsPolicy;
    await saveStore(store);
  });
}

export async function setScriptsBackupEnabled(enabled: boolean): Promise<void> {
  await withProfileLock(async () => {
    const store = await loadStore();
    store.backup.scriptsEnabled = enabled;
    await saveStore(store);
  });
}
