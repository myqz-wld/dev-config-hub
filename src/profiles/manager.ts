import type {
  Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "./types.ts";
import { loadStore, saveStore, withStoreLock, STORE_LOCK_PATH } from "./store.ts";
import { runHook, type HookContext } from "./hooks.ts";
import { switchSymlink, initToolDir, currentSymlinkTarget } from "./symlink.ts";

const ID_RE = /^[a-zA-Z0-9_-]+$/;
// PR-6 (#M5)：profile.env key 校验 — 与 cli-profile.cmdEnv 输出 wrapper 用的同一 regex。
// 旧版只在输出处 skip 非法 key（用户在 UI/CLI 加 `MY KEY=v` / `1FOO=v` 落盘成功
// 但 wrapper 模式 silently 丢，难调试）。这里上游守口拦掉，统一行为。
// export 给单测用。
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export async function addProfile(p: Profile): Promise<void> {
  if (!ID_RE.test(p.id)) {
    throw new Error("profile id 只允许字母数字 _ -");
  }
  validateEnv(p.env);
  await withStoreLock(STORE_LOCK_PATH, async () => {
    const store = await loadStore();
    if (store.profiles.some((x) => x.id === p.id)) {
      throw new Error(`profile id 重复: ${p.id}`);
    }
    store.profiles.push(p);
    await saveStore(store);
  });
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<void> {
  if (patch.env !== undefined) validateEnv(patch.env);
  await withStoreLock(STORE_LOCK_PATH, async () => {
    const store = await loadStore();
    const idx = store.profiles.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error(`未找到 profile: ${id}`);
    store.profiles[idx] = { ...store.profiles[idx]!, ...patch, id };
    await saveStore(store);
  });
}

export async function removeProfile(id: string): Promise<void> {
  await withStoreLock(STORE_LOCK_PATH, async () => {
    const store = await loadStore();
    store.profiles = store.profiles.filter((x) => x.id !== id);
    for (const k of Object.keys(store.active) as ToolKind[]) {
      if (store.active[k] === id) store.active[k] = null;
    }
    await saveStore(store);
  });
}

export async function useProfile(id: string): Promise<SwitchResult> {
  return withStoreLock(STORE_LOCK_PATH, async () => {
    const store = await loadStore();
    const profile = store.profiles.find((x) => x.id === id);
    if (!profile) throw new Error(`未找到 profile: ${id}`);

    const fromId = store.active[profile.tool] ?? null;
    const ctx: HookContext = { profile, fromId, toId: id };
    const hooks: HookResult[] = [];

    const pre = await runHook(
      "preSwitch", profile.hooks?.preSwitch, ctx, store.preferences.hookTimeoutMs,
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
      "postSwitch", profile.hooks?.postSwitch, ctx, store.preferences.hookTimeoutMs,
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
  await withStoreLock(STORE_LOCK_PATH, async () => {
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
    hook, ctx, store.preferences.hookTimeoutMs,
  );
}

export async function setPreference<K extends keyof ProfileStore["preferences"]>(
  key: K, value: ProfileStore["preferences"][K],
): Promise<void> {
  await withStoreLock(STORE_LOCK_PATH, async () => {
    const store = await loadStore();
    store.preferences[key] = value;
    await saveStore(store);
  });
}
