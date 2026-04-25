import { join, dirname, isAbsolute } from "path";
import { mkdir, lstat, readlink, rename, unlink, symlink } from "fs/promises";
import type { Profile, ToolKind } from "./types.ts";
import { expandHome, collapseHome, HOME } from "./store.ts";

export const TOOL_PATHS: Record<ToolKind, string> = {
  claude: join(HOME, ".claude"),
  codex: join(HOME, ".codex"),
};

export type PathState = "missing" | "symlink" | "directory" | "file";

export interface InitResult {
  tool: ToolKind;
  state: "created-empty" | "wrapped-existing-dir" | "adopted-existing-symlink";
  defaultProfile: Profile;
}

export async function pathState(p: string): Promise<PathState> {
  try {
    const st = await lstat(p);
    if (st.isSymbolicLink()) return "symlink";
    if (st.isDirectory()) return "directory";
    return "file";
  } catch {
    return "missing";
  }
}

/**
 * 把 ~/.claude 或 ~/.codex 转成 symlink，建立默认 profile 的目录基础。
 * - 真实目录：mv 到 ~/.<tool>-default，再 ln -s 回去
 * - 已是 symlink：读 target，注册成 default profile
 * - 不存在：创建空 ~/.<tool>-default 目录并 ln -s
 */
export async function initToolDir(tool: ToolKind): Promise<InitResult> {
  const target = TOOL_PATHS[tool];
  const defaultDir = join(HOME, `.${tool}-default`);
  const state = await pathState(target);

  if (state === "file") {
    throw new Error(`${target} 是普通文件，无法作为 ${tool} 的配置目录`);
  }

  let actualDir = defaultDir;
  let stateOut: InitResult["state"];

  if (state === "symlink") {
    let t = await readlink(target);
    if (!isAbsolute(t)) t = join(dirname(target), t);
    actualDir = t;
    stateOut = "adopted-existing-symlink";
  } else if (state === "directory") {
    if ((await pathState(defaultDir)) !== "missing") {
      throw new Error(`${defaultDir} 已存在但 ${target} 仍是真实目录，请手动清理后再 init`);
    }
    await rename(target, defaultDir);
    await symlink(defaultDir, target);
    stateOut = "wrapped-existing-dir";
  } else {
    if ((await pathState(defaultDir)) === "missing") {
      await mkdir(defaultDir, { recursive: true });
    }
    await symlink(defaultDir, target);
    stateOut = "created-empty";
  }

  const defaultProfile: Profile = {
    id: `${tool}-default`,
    tool,
    configDir: collapseHome(actualDir),
    env: {},
    description: "默认 profile（由 dch profile init 创建）",
    isDefault: true,
  };

  return { tool, state: stateOut, defaultProfile };
}

/**
 * 原子切换 symlink。前置：target 必须已是 symlink（init 过）。
 * 步骤：
 *   1. 确认 target 是 symlink
 *   2. 确保新 configDir 存在（不存在则 mkdir -p）
 *   3. ln -s 新目标到临时名
 *   4. rename 临时名 → target（原子）
 */
export async function switchSymlink(profile: Profile): Promise<void> {
  const target = TOOL_PATHS[profile.tool];
  const newDir = expandHome(profile.configDir);
  const state = await pathState(target);

  if (state === "missing") {
    throw new Error(`${target} 不存在，请先跑: dch profile init ${profile.tool}`);
  }
  if (state === "directory") {
    throw new Error(`${target} 当前是真实目录（非 symlink）。请先跑: dch profile init ${profile.tool}`);
  }
  if (state === "file") {
    throw new Error(`${target} 是普通文件，拒绝覆盖`);
  }

  if ((await pathState(newDir)) === "missing") {
    await mkdir(newDir, { recursive: true });
  }

  const tmp = `${target}.dch-switch-${Date.now()}`;
  await symlink(newDir, tmp);
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function currentSymlinkTarget(tool: ToolKind): Promise<string | null> {
  const target = TOOL_PATHS[tool];
  if ((await pathState(target)) !== "symlink") return null;
  let t = await readlink(target);
  if (!isAbsolute(t)) t = join(dirname(target), t);
  return t;
}
