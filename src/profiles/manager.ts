import type {
  Profile, ProfileStore, SwitchResult, ToolKind, HookResult,
} from "./types.ts";
import { loadStore, saveStore } from "./store.ts";
import { runHook, type HookContext } from "./hooks.ts";
import { switchSymlink, initToolDir, currentSymlinkTarget } from "./symlink.ts";

const ID_RE = /^[a-zA-Z0-9_-]+$/;

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
  const store = await loadStore();
  if (store.profiles.some((x) => x.id === p.id)) {
    throw new Error(`profile id 重复: ${p.id}`);
  }
  store.profiles.push(p);
  await saveStore(store);
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<void> {
  const store = await loadStore();
  const idx = store.profiles.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error(`未找到 profile: ${id}`);
  store.profiles[idx] = { ...store.profiles[idx]!, ...patch, id };
  await saveStore(store);
}

export async function removeProfile(id: string): Promise<void> {
  const store = await loadStore();
  store.profiles = store.profiles.filter((x) => x.id !== id);
  for (const k of Object.keys(store.active) as ToolKind[]) {
    if (store.active[k] === id) store.active[k] = null;
  }
  await saveStore(store);
}

export async function useProfile(id: string): Promise<SwitchResult> {
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
    return {
      ok: false, profile, previousActive: fromId, hooks,
      message: `切换失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const post = await runHook(
    "postSwitch", profile.hooks?.postSwitch, ctx, store.preferences.hookTimeoutMs,
  );
  if (post) hooks.push(post);

  return { ok: true, profile, previousActive: fromId, hooks };
}

export async function initTool(tool: ToolKind): Promise<{
  state: string;
  profileId: string;
  configDir: string;
}> {
  const result = await initToolDir(tool);
  const store = await loadStore();
  if (!store.profiles.some((p) => p.id === result.defaultProfile.id)) {
    store.profiles.push(result.defaultProfile);
  }
  store.active[tool] = result.defaultProfile.id;
  await saveStore(store);
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
  const store = await loadStore();
  store.preferences[key] = value;
  await saveStore(store);
}
